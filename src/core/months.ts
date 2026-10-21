import type { CalendarDate } from './expense.js';
import type { DayRef } from './types.js';

/**
 * Un libro de cuadre por mes (`Cuadre K12 2026-11`), con una pestaña por día (`01`…).
 * Puro: decide a qué mes pertenece un día, nombra las pestañas de otro mes y cuándo
 * recordar a las dueñas que falta el libro del mes siguiente.
 */

/** Mes como `AAAA-MM` (`2026-11`). */
export type MonthKey = string;

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
/** Pestaña de otro mes en una lista que mezcla meses: `28/10`. */
const QUALIFIED_TAB_PATTERN = /^(\d{1,2})\/(\d{1,2})$/;
/** ID de una hoja de Google: el que va en `/spreadsheets/d/<id>/edit`. */
const SPREADSHEET_URL_PATTERN = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/;
const SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Día desde el que se recuerda crear el libro del mes siguiente. */
export const BOOK_REMINDER_DAY = 25;

const pad2 = (value: number): string => String(value).padStart(2, '0');

export function monthKey(year: number, month: number): MonthKey {
  return `${String(year)}-${pad2(month)}`;
}

export function parseMonthKey(raw: string): { year: number; month: number } | null {
  const match = MONTH_KEY_PATTERN.exec(raw.trim());
  if (!match?.[1] || !match[2]) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

export function isMonthKey(raw: string): boolean {
  return parseMonthKey(raw) !== null;
}

/** `2026-11` + (−1) → `2026-10`; `2026-12` + 1 → `2027-01`. */
export function addMonths(key: MonthKey, delta: number): MonthKey {
  const parsed = parseMonthKey(key);
  if (parsed === null) throw new Error(`Mes no válido: ${key}`);
  const index = parsed.year * 12 + (parsed.month - 1) + delta;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

export function monthOfDate(date: CalendarDate): MonthKey {
  return monthKey(date.year, date.month);
}

/**
 * Mes de un día que no trae año (`3 oct`, `Turno 18 10-14`): el de este año, salvo
 * que el mes todavía no haya llegado (un IPV de diciembre cargado en enero).
 */
export function monthOfRef(ref: DayRef, today: CalendarDate): MonthKey {
  const year = ref.month > today.month ? today.year - 1 : today.year;
  return monthKey(year, ref.month);
}

/**
 * Mes de un día escrito solo con el número (`/tc 780 31`): este mes si el día ya
 * pasó o es hoy; si es mayor que hoy, el mes anterior (un día futuro no tiene cuadre).
 */
export function monthOfDayNumber(day: number, today: CalendarDate): MonthKey {
  const current = monthOfDate(today);
  return day > today.day ? addMonths(current, -1) : current;
}

/** `2026-11` → `noviembre 2026`. */
export function monthName(key: MonthKey): string {
  const parsed = parseMonthKey(key);
  if (parsed === null) return key;
  return `${MONTH_NAMES[parsed.month - 1] ?? key} ${String(parsed.year)}`;
}

/** Pestaña de otro mes en una lista que mezcla meses: `28` de octubre → `28/10`. */
export function qualifyTab(tab: string, key: MonthKey): string {
  const parsed = parseMonthKey(key);
  return parsed === null ? tab.trim() : `${tab.trim()}/${pad2(parsed.month)}`;
}

/** `28/10` → pestaña `28` del mes 10. Null si es una pestaña del mes en curso (`28`). */
export function parseQualifiedTab(name: string): { tab: string; month: number } | null {
  const match = QUALIFIED_TAB_PATTERN.exec(name.trim());
  if (!match?.[1] || !match[2]) return null;
  return { tab: match[1].padStart(2, '0'), month: Number(match[2]) };
}

export function isQualifiedTab(name: string): boolean {
  return parseQualifiedTab(name) !== null;
}

/**
 * Busca un día en una lista que puede mezclar meses. Gana la pestaña del mes en curso
 * (`28`); si no está, la del mes anterior (`28/10`). Null si no hay ninguna.
 */
export function resolveDayTab(days: readonly string[], wanted: string): string | null {
  const target = wanted.trim();
  const exact = days.find((day) => day.trim() === target);
  if (exact !== undefined) return exact;
  const qualified = parseQualifiedTab(target);
  if (qualified !== null) return null;
  const other = days.filter((day) => parseQualifiedTab(day)?.tab === target.padStart(2, '0'));
  return other[other.length - 1] ?? null;
}

/** ID de la hoja a partir del enlace (`…/spreadsheets/d/<id>/edit…`) o del ID solo. */
export function parseSpreadsheetId(raw: string): string | null {
  const value = raw.trim();
  const fromUrl = SPREADSHEET_URL_PATTERN.exec(value)?.[1];
  if (fromUrl !== undefined) return fromUrl;
  return SPREADSHEET_ID_PATTERN.test(value) ? value : null;
}

export interface BookReminderInput {
  today: CalendarDate;
  /** Minutos desde la medianoche en la zona del negocio. */
  minutesNow: number;
  /** Hora del recordatorio en minutos (la apertura, 09:00 = 540). */
  atMinutes: number;
  registered: ReadonlySet<MonthKey>;
  /** Último día en que se envió (`AAAA-MM-DD`); el recordatorio sale una vez por día. */
  lastSent: string | null;
  fromDay?: number;
}

/**
 * Mes que falta y hay que recordar hoy, o null. Desde el día 25, a partir de la hora
 * de apertura, una vez por día hasta que se registre el libro del mes siguiente.
 */
export function bookReminderDue({
  today,
  minutesNow,
  atMinutes,
  registered,
  lastSent,
  fromDay = BOOK_REMINDER_DAY,
}: BookReminderInput): MonthKey | null {
  if (today.day < fromDay || minutesNow < atMinutes) return null;
  if (lastSent === isoDate(today)) return null;
  const next = addMonths(monthOfDate(today), 1);
  return registered.has(next) ? null : next;
}

export function isoDate({ year, month, day }: CalendarDate): string {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

/** `09:00` → 540. Null si no es una hora válida. */
export function parseClockTime(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match?.[1] || !match[2]) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Días del mes: `2026-02` → 28, `2026-10` → 31. */
export function daysInMonth(key: MonthKey): number {
  const parsed = parseMonthKey(key);
  if (parsed === null) throw new Error(`Mes no válido: ${key}`);
  return new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
}

/** Hasta este día del mes, /cierremes sin mes cierra el mes anterior. */
export const CLOSE_PREVIOUS_UNTIL_DAY = 10;

/**
 * Mes que cierra /cierremes sin argumentos: del 1 al 10 el mes anterior (se cierra
 * con unos días de margen para cargar lo que falte); desde el 11, el mes en curso.
 */
export function defaultCloseMonth(today: CalendarDate): MonthKey {
  const current = monthOfDate(today);
  return today.day <= CLOSE_PREVIOUS_UNTIL_DAY ? addMonths(current, -1) : current;
}

/**
 * Días del mes que deberían tener pestaña y no la tienen. Un mes pasado se revisa
 * completo; el mes en curso, hasta ayer (el IPV de hoy se carga al cierre); un mes
 * futuro, nada.
 */
export function missingDays(key: MonthKey, tabs: readonly string[], today: CalendarDate): number[] {
  const current = monthOfDate(today);
  const last = key < current ? daysInMonth(key) : key === current ? today.day - 1 : 0;
  const present = new Set(
    tabs
      .map((tab) => tab.trim())
      .filter((tab) => /^\d{1,2}$/.test(tab))
      .map(Number),
  );
  return Array.from({ length: Math.max(last, 0) }, (_, i) => i + 1).filter(
    (day) => !present.has(day),
  );
}
