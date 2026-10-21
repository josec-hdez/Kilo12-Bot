import type { CalendarDate } from '../core/expense.js';
import {
  addMonths,
  isMonthKey,
  monthName,
  monthOfDate,
  parseSpreadsheetId,
  type MonthKey,
} from '../core/months.js';
import type { SettingsRepository } from '../ports/repositories.js';
import type { CuadreBooks } from '../ports/cuadre-books.js';
import { readBookRegistry, registerBook } from './cuadre-books.js';
import { ensureSummaryTab, TEMPLATE_TAB } from './sheet-structure.js';

/**
 * /cuadremes: las dueñas registran el libro de cuadre de cada mes. El bot revisa que
 * puede abrirlo y cómo viene (plantilla, pestañas de días) antes de pedir ✅.
 */

/** Lee las pestañas de una hoja con la cuenta del bot. Falla si no tiene acceso. */
export type BookInspector = (spreadsheetId: string) => Promise<string[]>;

export interface BookAdminDeps {
  settings: SettingsRepository;
  /** Null con la hoja simulada: no hay libros de Google que registrar. */
  inspect: BookInspector | null;
  /** Correo de la service account, para decir con quién compartir el libro. */
  serviceAccountEmail: string | null;
  today: CalendarDate;
}

export const BOOK_PREPARE = {
  READY: 'ready',
  REJECTED: 'rejected',
} as const;

export interface BookRegistration {
  month: MonthKey;
  spreadsheetId: string;
}

export type BookPrepareResult =
  | { status: typeof BOOK_PREPARE.READY; registration: BookRegistration; preview: string }
  | { status: typeof BOOK_PREPARE.REJECTED; message: string };

const USAGE =
  'Uso: /cuadremes 2026-11 <enlace de la hoja>. Sin datos, /cuadremes muestra los libros registrados.';
const DAY_TAB_PATTERN = /^\d{1,2}$/;
const SHOWN_DAY_TABS = 5;

const sheetUrl = (spreadsheetId: string): string =>
  `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

const rejected = (message: string): BookPrepareResult => ({
  status: BOOK_PREPARE.REJECTED,
  message,
});

/** Lista de libros registrados, del mes más viejo al más nuevo. */
export function bookListText(deps: Pick<BookAdminDeps, 'settings' | 'today'>): string {
  const registry = readBookRegistry(deps.settings);
  const months = Object.keys(registry).sort();
  const next = addMonths(monthOfDate(deps.today), 1);
  const lines = ['📒 Libros de cuadre registrados:', ''];
  if (months.length === 0) lines.push('Ninguno todavía.');
  for (const month of months) {
    lines.push(`• ${monthName(month)}: ${sheetUrl(registry[month] ?? '')}`);
  }
  if (registry[next] === undefined) {
    lines.push('', `⚠️ Falta el de ${monthName(next)}.`);
  }
  lines.push('', USAGE);
  return lines.join('\n');
}

function accessHelp(email: string | null): string {
  return email === null
    ? 'Compártela con la cuenta del bot como Editor.'
    : `Compártela con ${email} como Editor.`;
}

/**
 * `2026-11 <enlace o ID>`: revisa el pedido y la hoja, y arma la vista previa. No
 * guarda nada: el registro se hace al tocar ✅.
 */
export async function prepareBookRegistration(
  deps: BookAdminDeps,
  raw: string,
): Promise<BookPrepareResult> {
  const [rawMonth = '', rawSheet = '', ...rest] = raw.trim().split(/\s+/);
  if (!isMonthKey(rawMonth) || rawSheet === '' || rest.length > 0) return rejected(USAGE);
  const month = rawMonth;
  const spreadsheetId = parseSpreadsheetId(rawSheet);
  if (spreadsheetId === null) {
    return rejected(`No reconozco ese enlace como una hoja de Google. ${USAGE}`);
  }
  if (deps.inspect === null) {
    return rejected(
      'El bot usa la hoja simulada (faltan GOOGLE_SA_JSON o CUADRE_SHEET_ID): no hay libros de Google que registrar.',
    );
  }

  let tabs: string[];
  try {
    tabs = await deps.inspect(spreadsheetId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return rejected(
      `No pude abrir esa hoja (${reason}). ${accessHelp(deps.serviceAccountEmail)} Después repite /cuadremes.`,
    );
  }

  const registry = readBookRegistry(deps.settings);
  const dayTabs = tabs.filter((tab) => DAY_TAB_PATTERN.test(tab.trim()));
  const otherMonth = Object.entries(registry).find(
    ([registered, id]) => id === spreadsheetId && registered !== month,
  )?.[0];
  const current = registry[month];

  const lines = [`📒 Libro de cuadre de ${monthName(month)}`, sheetUrl(spreadsheetId), ''];
  lines.push(
    tabs.some((tab) => tab === TEMPLATE_TAB)
      ? `✅ Tiene la pestaña ${TEMPLATE_TAB}.`
      : `⚠️ No tiene la pestaña ${TEMPLATE_TAB}: el bot la crea en la primera carga, pero se pierde el formato que le dieron.`,
  );
  if (dayTabs.length > 0) {
    const shown = dayTabs.slice(0, SHOWN_DAY_TABS).join(', ');
    lines.push(
      `⚠️ Ya tiene ${String(dayTabs.length)} pestañas de días (${shown}${dayTabs.length > SHOWN_DAY_TABS ? '…' : ''}). ¿Es la copia correcta? En un libro nuevo se borran los días del mes anterior.`,
    );
  }
  if (otherMonth !== undefined) {
    lines.push(`⚠️ Esa hoja ya es el libro de ${monthName(otherMonth)}.`);
  }
  if (current === spreadsheetId) {
    lines.push(`ℹ️ Ya es el libro de ${monthName(month)}; no cambia nada.`);
  } else if (current !== undefined) {
    lines.push(`⚠️ ${monthName(month)} ya tenía otro libro (${sheetUrl(current)}): se reemplaza.`);
  }
  lines.push('', `Desde que lo registres, los días de ${monthName(month)} se escriben ahí.`);

  return {
    status: BOOK_PREPARE.READY,
    registration: { month, spreadsheetId },
    preview: lines.join('\n'),
  };
}

/**
 * ✅ Registrar. Si se pasan los libros, además crea la pestaña `Resumen` en el libro
 * nuevo cuando no la trae (un fallo ahí no deshace el registro).
 */
export async function confirmBookRegistration(
  settings: SettingsRepository,
  { month, spreadsheetId }: BookRegistration,
  books?: CuadreBooks,
): Promise<string> {
  registerBook(settings, month, spreadsheetId);
  const lines = [
    `✅ Libro de ${monthName(month)} registrado. Los días de ${monthName(month)} se escriben en ${sheetUrl(spreadsheetId)}.`,
  ];
  const book = books?.forMonth(month) ?? null;
  if (book !== null) {
    try {
      if ((await ensureSummaryTab(book.sheets)).created) {
        lines.push('📊 Agregué la pestaña Resumen (una fila por día).');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      lines.push(`⚠️ No pude crear la pestaña Resumen: ${reason}. Se crea en la primera carga.`);
    }
  }
  return lines.join('\n');
}
