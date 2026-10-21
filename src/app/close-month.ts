import type { CalendarDate } from '../core/expense.js';
import { analyzeMonthClose, closeIssues, count, type MonthClose } from '../core/month-close.js';
import {
  addMonths,
  defaultCloseMonth,
  isMonthKey,
  monthName,
  qualifyTab,
  type MonthKey,
} from '../core/months.js';
import { SEVERITY, SEVERITY_ICON, type Finding } from '../core/validations.js';
import type { CuadreBooks } from '../ports/cuadre-books.js';
import type { ChangeLogRepository, SettingsRepository } from '../ports/repositories.js';
import { isMonthClosed, markMonthClosed, reopenMonth } from './closed-months.js';
import { noBookMessage, previousBook } from './cuadre-books.js';
import { compact, cup, esc, packMessages, pct, table, usd } from './report-format.js';

/**
 * /cierremes [AAAA-MM] [reabrir]: revisa el mes completo (días faltantes, T3,
 * continuidad, productos sin costo, inventario final) y, con 🔒 Cerrar mes, lo marca
 * cerrado. Después, /ipv, /tc y /deshacer sobre ese mes piden "⚠️ Confirmar igual".
 */

export interface CloseMonthDeps {
  books: CuadreBooks;
  settings: SettingsRepository;
  changeLog: ChangeLogRepository;
  hasFixedExpenses: boolean;
  today: CalendarDate;
}

export const CLOSE_REQUEST = {
  REVIEW: 'review',
  REOPEN: 'reopen',
  INVALID: 'invalid',
} as const;

export type CloseRequest =
  | { kind: typeof CLOSE_REQUEST.REVIEW; month: MonthKey }
  | { kind: typeof CLOSE_REQUEST.REOPEN; month: MonthKey }
  | { kind: typeof CLOSE_REQUEST.INVALID; message: string };

const USAGE =
  'Uso: /cierremes (del 1 al 10, el mes anterior; después, el mes en curso), /cierremes 2026-10 o /cierremes 2026-10 reabrir.';

export function parseCloseArgs(raw: string, today: CalendarDate): CloseRequest {
  const [first = '', second = '', ...rest] = raw.trim().toLowerCase().split(/\s+/);
  if (first === '') return { kind: CLOSE_REQUEST.REVIEW, month: defaultCloseMonth(today) };
  if (!isMonthKey(first) || rest.length > 0) return { kind: CLOSE_REQUEST.INVALID, message: USAGE };
  if (second === '') return { kind: CLOSE_REQUEST.REVIEW, month: first };
  if (second === 'reabrir') return { kind: CLOSE_REQUEST.REOPEN, month: first };
  return { kind: CLOSE_REQUEST.INVALID, message: USAGE };
}

export interface CloseReview {
  /** Mensajes HTML, en orden. */
  messages: string[];
  /** Null si no se puede cerrar (ya cerrado, sin libro, sin días). */
  closable: MonthKey | null;
  close: MonthClose | null;
}

const LIST_LIMIT = 8;
const UNCOSTED_LIMIT = 10;

const plainReview = (message: string): CloseReview => ({
  messages: [esc(message)],
  closable: null,
  close: null,
});

function findingLine(finding: Finding): string {
  const product = finding.product === null ? '' : `${finding.product}: `;
  return `• [${finding.day.trim()}] ${esc(product + finding.detail)}`;
}

function limited(lines: readonly string[], limit = LIST_LIMIT): string[] {
  return lines.length <= limit
    ? [...lines]
    : [...lines.slice(0, limit), `… y ${String(lines.length - limit)} más.`];
}

const dayList = (days: readonly number[]): string =>
  days.map((day) => String(day).padStart(2, '0')).join(', ');

/** Resumen de 3–5 líneas: la cifra clave primero. */
function summaryBlock(close: MonthClose, closed: boolean): string {
  const { period } = close;
  const name = monthName(close.month);
  const loaded = period.days.length;
  const lines = [
    `🔒 <b>Cierre de ${esc(name)}</b> (${String(loaded)} ${loaded === 1 ? 'día cargado' : 'días cargados'})${closed ? ' · ya cerrado' : ''}`,
    `Utilidad neta: <b>${cup(period.utilidadNeta)} CUP</b> (USD ${usd(period.usd.utilidadNeta)}) · venta ${cup(period.venta)} CUP · margen ${pct(period.margenPonderado)}`,
  ];
  if (close.openingInventory !== null && close.lastDay !== null) {
    lines.push(
      `Inventario final (${close.lastDay}): <b>${cup(close.openingInventory)} CUP</b> al costo → apertura de ${esc(monthName(addMonths(close.month, 1)))}.`,
    );
  }
  lines.push(
    `${SEVERITY_ICON[SEVERITY.RED]} ${String(count(close.findings, SEVERITY.RED))} · ${SEVERITY_ICON[SEVERITY.YELLOW]} ${String(count(close.findings, SEVERITY.YELLOW))} · ${SEVERITY_ICON[SEVERITY.WHITE]} ${String(count(close.findings, SEVERITY.WHITE))} · faltan ${String(close.missing.length)} días · ${String(close.uncosted.length)} productos sin costo`,
  );
  lines.push(
    closeIssues(close).length === 0
      ? '✅ El mes está limpio: se puede cerrar.'
      : '⚠️ Hay pendientes (abajo): se puede cerrar igual, pero conviene resolverlos antes.',
  );
  return lines.join('\n');
}

function daysTable(close: MonthClose): string {
  const { period } = close;
  const rows = period.days.map((d) => [
    d.day,
    compact(d.venta),
    compact(d.utilidadNeta),
    pct(d.margen),
  ]);
  rows.push([
    'Total',
    compact(period.venta),
    compact(period.utilidadNeta),
    pct(period.margenPonderado),
  ]);
  return [
    table(['Día', 'Venta', 'Neta', 'Marg'], rows),
    `Costo de lo vendido: ${cup(period.costo)} CUP · gastos: ${cup(period.gastos)} CUP · utilidad bruta: ${cup(period.utilidadBruta)} CUP.`,
    `<i>Ganancia ajustada (estimado, margen de los productos con costo): ${cup(close.adjusted.bajo)}–${cup(close.adjusted.alto)} CUP de utilidad bruta, contra ${cup(close.adjusted.segunHojas)} según las hojas.</i>`,
  ].join('\n');
}

function checksBlock(close: MonthClose): string {
  const lines = ['<b>Revisión</b>'];
  lines.push(
    close.missing.length === 0
      ? '✅ No falta ningún día.'
      : `🔴 Faltan ${String(close.missing.length)} días: ${dayList(close.missing)}.`,
  );
  if (close.continuity.length === 0) {
    lines.push('✅ Continuidad: cada final coincide con el inicial del día siguiente.');
  } else {
    lines.push(`🟡 ${String(close.continuity.length)} cortes de continuidad:`);
    lines.push(...limited(close.continuity.map(findingLine)));
  }
  const red = close.findings.filter((f) => f.severity === SEVERITY.RED);
  if (red.length > 0) {
    lines.push(`🔴 ${String(red.length)} hallazgos que afectan la ganancia:`);
    lines.push(...limited(red.map(findingLine)));
  }
  if (close.uncosted.length > 0) {
    lines.push(`🔴 ${String(close.uncosted.length)} productos vendidos sin costo:`);
    lines.push(
      table(
        ['Producto', 'Venta'],
        close.uncosted.slice(0, UNCOSTED_LIMIT).map((u) => [u.product, compact(u.venta)]),
      ),
    );
    if (close.uncosted.length > UNCOSTED_LIMIT) {
      lines.push(`… y ${String(close.uncosted.length - UNCOSTED_LIMIT)} más.`);
    }
  }
  if (close.period.usd.daysWithoutTc.length > 0) {
    lines.push(`🟡 Días sin TC (no entran en USD): ${close.period.usd.daysWithoutTc.join(', ')}.`);
  }
  const next = addMonths(close.month, 1);
  lines.push(
    close.nextBookRegistered
      ? `✅ El libro de ${esc(monthName(next))} está registrado.`
      : `⚠️ Falta el libro de ${esc(monthName(next))}: /cuadremes ${next} &lt;enlace&gt;.`,
  );
  return lines.join('\n');
}

/** Sugerencias con qué hacer, por qué, impacto y prioridad (CLAUDE.md, T5). */
function suggestionsBlock(close: MonthClose): string {
  const items: string[] = [];
  if (close.missing.length > 0) {
    items.push(
      `• <b>Alta</b> — Carga el IPV de los días ${dayList(close.missing)} antes de cerrar. Por qué: sin esos días la venta y el inventario del mes están incompletos.`,
    );
  }
  if (close.uncosted.length > 0) {
    const inflated = close.adjusted.segunHojas - close.adjusted.central;
    items.push(
      `• <b>Alta</b> — Pon el costo de ${String(close.uncosted.length)} productos (en amarillo en el cuadre). Por qué: ${cup(close.adjusted.ventaSinCosto)} CUP se vendieron sin costo. Impacto: la utilidad del mes está inflada en unos ${cup(inflated)} CUP (estimado).`,
    );
  }
  if (close.continuity.length > 0) {
    items.push(
      `• <b>Media</b> — Revisa los ${String(close.continuity.length)} cortes de continuidad (final de un día ≠ inicial del siguiente). Por qué: descuadran el inventario y la venta de esos días.`,
    );
  }
  if (!close.nextBookRegistered) {
    const next = addMonths(close.month, 1);
    items.push(
      `• <b>Alta</b> — Registra el libro de ${esc(monthName(next))} con /cuadremes ${next} &lt;enlace&gt;. Por qué: sin libro, el bot no carga ningún día de ese mes.`,
    );
  }
  if (items.length === 0) return '<b>Sugerencias</b>\nNinguna: el mes cuadra.';
  return ['<b>Sugerencias</b>', ...items].join('\n');
}

/** Lee el mes y arma la revisión. No escribe nada. */
export async function reviewMonthClose(
  deps: CloseMonthDeps,
  month: MonthKey,
): Promise<CloseReview> {
  const book = deps.books.forMonth(month);
  if (book === null) return plainReview(noBookMessage(month));

  const tabs = (await book.cuadre.listDays()).filter((tab) => /^\d{1,2}$/.test(tab.trim()));
  if (tabs.length === 0) {
    return plainReview(
      `El libro de ${monthName(month)} no tiene pestañas de días: no hay nada que cerrar.`,
    );
  }
  const sheets = await book.cuadre.readDays(tabs);

  const before = previousBook(deps.books, book);
  let previousLast = null;
  if (before !== null) {
    const previousTabs = await before.cuadre.listDays();
    const last = previousTabs[previousTabs.length - 1];
    if (last !== undefined) {
      const [sheet] = await before.cuadre.readDays([last]);
      if (sheet !== undefined) previousLast = { ...sheet, tabName: qualifyTab(last, before.month) };
    }
  }

  const close = analyzeMonthClose({
    month,
    sheets,
    previousLast,
    today: deps.today,
    hasFixedExpenses: deps.hasFixedExpenses,
    nextBookRegistered: deps.books.forMonth(addMonths(month, 1)) !== null,
  });
  const closed = isMonthClosed(deps.settings, month);
  const messages = packMessages([
    summaryBlock(close, closed),
    daysTable(close),
    checksBlock(close),
    suggestionsBlock(close),
    closed ? `Para volver a abrirlo: /cierremes ${month} reabrir` : '',
  ]);
  return { messages, closable: closed ? null : month, close };
}

/** 🔒 Cerrar mes: lo marca cerrado y deja en el log el inventario final como apertura. */
export function confirmMonthClose(
  deps: Pick<CloseMonthDeps, 'settings' | 'changeLog'>,
  telegramId: number,
  close: MonthClose,
): string {
  markMonthClosed(deps.settings, close.month);
  deps.changeLog.record({
    telegramId,
    action: 'close_month',
    target: close.month,
    detail: {
      lastDay: close.lastDay,
      openingInventory: close.openingInventory,
      venta: close.period.venta,
      utilidadNeta: close.period.utilidadNeta,
      missingDays: close.missing,
      red: count(close.findings, SEVERITY.RED),
      uncosted: close.uncosted.length,
    },
  });
  const opening =
    close.openingInventory === null
      ? ''
      : ` Inventario final: ${cup(close.openingInventory)} CUP al costo (apertura de ${monthName(addMonths(close.month, 1))}).`;
  return `🔒 ${monthName(close.month)} cerrado.${opening} Desde ahora, /ipv, /tc y /deshacer sobre ese mes piden "⚠️ Confirmar igual". Para reabrirlo: /cierremes ${close.month} reabrir`;
}

export function reopenMonthClose(
  deps: Pick<CloseMonthDeps, 'settings' | 'changeLog'>,
  telegramId: number,
  month: MonthKey,
): string {
  if (!reopenMonth(deps.settings, month)) return `${monthName(month)} no estaba cerrado.`;
  deps.changeLog.record({ telegramId, action: 'reopen_month', target: month, detail: {} });
  return `🔓 ${monthName(month)} reabierto: se puede escribir sin confirmar igual.`;
}
