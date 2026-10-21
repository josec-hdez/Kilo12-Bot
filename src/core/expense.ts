/**
 * Gasto del historial (hoja "Gastos"): una fila `Fecha | Cantidad | Moneda | Descripcion`.
 * Es solo un registro: no toca el cuadre, cuyas "Otros Gastos" se llenan a mano.
 */

export const EXPENSE_CURRENCY = {
  CUP: 'CUP',
  USD: 'USD',
} as const;

export type ExpenseCurrency = (typeof EXPENSE_CURRENCY)[keyof typeof EXPENSE_CURRENCY];

export const EXPENSE_CURRENCIES: readonly ExpenseCurrency[] = Object.values(EXPENSE_CURRENCY);

/** Fecha de calendario completa (con año), sin hora ni zona. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface Expense {
  date: CalendarDate;
  amount: number;
  currency: ExpenseCurrency;
  description: string;
}

/** Más largo que esto ya no es una descripción, es un mensaje pegado por error. */
export const MAX_DESCRIPTION_LENGTH = 200;

/** Fecha real del calendario (descarta 31/02 y similares). */
export function isValidDate({ year, month, day }: CalendarDate): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Fecha escrita por el usuario: `20/10/2026`, `20-10-2026`, `20/10/26`, `20/10` (año
 * de `today`) o `2026-10-20`. Siempre día antes que mes, como se escribe en Cuba. No
 * acepta fechas futuras: un gasto se registra cuando ya ocurrió.
 */
export function parseExpenseDate(raw: string, today: CalendarDate): CalendarDate | null {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const local = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(text);
  let date: CalendarDate;
  if (iso !== null) {
    date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  } else if (local !== null) {
    const rawYear = local[3];
    const year =
      rawYear === undefined
        ? today.year
        : rawYear.length === 2
          ? 2000 + Number(rawYear)
          : Number(rawYear);
    date = { year, month: Number(local[2]), day: Number(local[1]) };
  } else {
    return null;
  }
  if (!isValidDate(date) || compareDates(date, today) > 0) return null;
  return date;
}

/** `1500`, `1500.50`, `1,500` (miles) o `1500,5` (decimal). Solo montos positivos. */
export function parseExpenseAmount(raw: string): number | null {
  const value = raw.trim().replace(/\s+/g, '');
  if (!/^\d[\d.,]*$/.test(value)) return null;
  const normalized = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)
    ? value.replace(/,/g, '')
    : value.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** `cup`, `USD `, `$usd`… → la moneda; cualquier otra cosa → null. */
export function parseExpenseCurrency(raw: string): ExpenseCurrency | null {
  const value = raw.trim().replace(/^\$/, '').toUpperCase();
  return EXPENSE_CURRENCIES.find((currency) => currency === value) ?? null;
}

/** Descripción limpia (espacios colapsados) o null si está vacía o es demasiado larga. */
export function parseExpenseDescription(raw: string): string | null {
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value === '' || value.length > MAX_DESCRIPTION_LENGTH) return null;
  return value;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `20/10/2026`: como se muestra en Telegram. */
export function formatExpenseDate({ year, month, day }: CalendarDate): string {
  return `${pad(day)}/${pad(month)}/${String(year)}`;
}

/** `2026-10-20`: Sheets lo reconoce como fecha en cualquier configuración regional. */
export function isoDate({ year, month, day }: CalendarDate): string {
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/**
 * Un texto que empieza con `=`, `+`, `-` o `@` Sheets lo interpretaría como fórmula
 * (USER_ENTERED). El apóstrofo inicial lo fuerza a texto y no se ve en la celda.
 */
export function asPlainText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** La fila a agregar, en el orden de las columnas de la hoja. */
export function expenseRow(expense: Expense): [string, number, string, string] {
  return [
    isoDate(expense.date),
    expense.amount,
    expense.currency,
    asPlainText(expense.description),
  ];
}
