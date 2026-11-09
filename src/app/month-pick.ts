import { monthName, type MonthKey } from '../core/months.js';
import type { CuadreBooks } from '../ports/cuadre-books.js';
import type { SettingsRepository } from '../ports/repositories.js';
import { isMonthClosed } from './closed-months.js';

/**
 * Selector de mes: antes de cada operación sobre el cuadre el bot pregunta de qué mes
 * (libro) se trata, con un botón por mes. Puro salvo `availableMonths`, que lee las
 * pestañas de cada libro para ocultar los meses todavía vacíos.
 */

/**
 * Comandos que corren sobre un mes elegido (también la escritura de `/tc`). `/ipv`
 * pregunta el mes solo con una hoja sin fecha, dentro de su propio flujo.
 */
export const MONTH_SCOPED_COMMANDS: ReadonlySet<string> = new Set([
  'validar',
  'dia',
  'rango',
  'fila',
  'semana',
  'mes',
  'ganancia',
  'gastos',
  'inversion',
  'top',
  'margen',
  'producto',
  'tc',
]);

/** ¿Este comando pregunta el mes antes de correr? */
export function needsMonth(command: string): boolean {
  return MONTH_SCOPED_COMMANDS.has(command);
}

/** Como mucho, los 12 meses más recientes. */
export const MAX_MONTH_OPTIONS = 12;

/** Pestaña de un día del libro: `03`, `3`. */
const DAY_TAB = /^\d{1,2}$/;

export interface MonthOption {
  month: MonthKey;
  /** Cerrado con /cierremes: se muestra con 🔒. */
  closed: boolean;
}

export interface AvailableMonthsOptions {
  /** Mes que se ofrece aunque no tenga días, si tiene libro registrado. */
  include?: MonthKey;
}

/** ¿El libro del mes tiene al menos una pestaña de día? Si no se puede leer, se asume que sí. */
async function hasDays(books: CuadreBooks, month: MonthKey): Promise<boolean> {
  const book = books.forMonth(month);
  if (book === null) return false;
  try {
    const tabs = await book.cuadre.listDays();
    return tabs.some((tab) => DAY_TAB.test(tab.trim()));
  } catch (error) {
    // Un libro que no responde no se esconde en silencio: el error real sale en el reporte.
    console.warn(`No pude listar las pestañas de ${month}:`, error);
    return true;
  }
}

/**
 * Meses que ofrece el selector: los que tienen libro registrado y al menos un día
 * cargado (más `include`), del más reciente al más antiguo, hasta `MAX_MONTH_OPTIONS`.
 */
export async function availableMonths(
  books: CuadreBooks,
  settings: SettingsRepository,
  options: AvailableMonthsOptions = {},
): Promise<MonthOption[]> {
  const registered = [...new Set(books.months())].sort().reverse();
  const shown = await Promise.all(
    registered.map(async (month) => month === options.include || (await hasDays(books, month))),
  );
  return registered
    .filter((_, index) => shown[index] === true)
    .slice(0, MAX_MONTH_OPTIONS)
    .map((month) => ({ month, closed: isMonthClosed(settings, month) }));
}

/** Etiqueta del botón: `octubre 2026` o `🔒 octubre 2026`. */
export function monthOptionLabel(option: MonthOption): string {
  return option.closed ? `🔒 ${monthName(option.month)}` : monthName(option.month);
}

/** Encabezado de una respuesta en HTML: `📒 <b>octubre 2026</b>`. */
export function monthHeader(month: MonthKey): string {
  return `📒 <b>${monthName(month)}</b>`;
}

/** Encabezado en texto plano: `📒 octubre 2026`. */
export function monthHeaderPlain(month: MonthKey): string {
  return `📒 ${monthName(month)}`;
}

export const MONTH_PICK_TEXT = {
  ASK: '📒 ¿De qué mes?',
  NO_MONTHS: 'Todavía no hay meses con días cargados en el cuadre.',
} as const;

/**
 * /tc sin día en un mes que no es el en curso: no hay "hoy" en ese libro, se pide el
 * día escrito (sin botones de día).
 */
export function tcDayRequired(month: MonthKey): string {
  return `Para ${monthName(month)} escribe también el día, por ejemplo: /tc 780 05.`;
}

/** 💱 TC con un mes que no es el en curso: se piden el número y el día juntos. */
export function askTcValueAndDay(month: MonthKey): string {
  return `💱 TC de ${monthName(month)}: escribe el número y el día, por ejemplo: 780 05. /cancelar para salir.`;
}

/** Pregunta del selector para un comando escrito: `📒 /mes: ¿de qué mes?`. */
export function askMonthForCommand(command: string): string {
  return `📒 /${command}: ¿de qué mes?`;
}
