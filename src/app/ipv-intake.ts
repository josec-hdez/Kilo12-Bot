import { formatDayRef, parseIpvTabDate } from '../core/tabs.js';
import type { DayRef, IpvTabRef } from '../core/types.js';

/**
 * Elige qué día del IPV cargar a partir de las pestañas del archivo y del argumento
 * opcional de /ipv (`3oct`, `3 oct`, `03`, `3`).
 */

/** Día pedido; `month: null` si solo se dio el número (`/ipv 03`). */
export interface DayArg {
  day: number;
  month: number | null;
}

/** `''` → `null` (sin argumento); texto que no es un día → `undefined`. */
export function parseDayArg(raw: string): DayArg | null | undefined {
  const arg = raw.trim();
  if (arg === '') return null;
  if (/^\d{1,2}$/.test(arg)) {
    const day = Number(arg);
    return day >= 1 && day <= 31 ? { day, month: null } : undefined;
  }
  const parsed = parseIpvTabDate(arg);
  return parsed === null ? undefined : { day: parsed.day, month: parsed.month };
}

export const INTAKE_STATUS = {
  /** Un solo día posible: cargarlo. */
  DAY: 'day',
  /** Varios días posibles: ofrecer botones. */
  CHOOSE: 'choose',
  ERROR: 'error',
} as const;

export type IntakeResult =
  | { status: typeof INTAKE_STATUS.DAY; ref: DayRef }
  | { status: typeof INTAKE_STATUS.CHOOSE; options: IpvTabRef[] }
  | { status: typeof INTAKE_STATUS.ERROR; message: string };

/** Máximo de días ofrecidos como botones (los más recientes). */
export const MAX_DAY_CHOICES = 8;

const chronological = (a: DayRef, b: DayRef) => a.month - b.month || a.day - b.day;

function available(days: readonly IpvTabRef[]): string {
  return days.map(formatDayRef).join(', ');
}

export function resolveIpvDay(days: readonly IpvTabRef[], arg: DayArg | null): IntakeResult {
  if (days.length === 0) {
    return {
      status: INTAKE_STATUS.ERROR,
      message: 'El archivo no tiene pestañas de días (por ejemplo "3 oct").',
    };
  }
  const sorted = [...days].sort(chronological);
  const candidates =
    arg === null
      ? sorted
      : sorted.filter((d) => d.day === arg.day && (arg.month === null || d.month === arg.month));

  if (candidates.length === 0) {
    const asked =
      arg === null
        ? ''
        : arg.month === null
          ? `el día ${String(arg.day)}`
          : formatDayRef({ day: arg.day, month: arg.month });
    return {
      status: INTAKE_STATUS.ERROR,
      message: `El archivo no tiene ${asked}. Días disponibles: ${available(sorted)}.`,
    };
  }
  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) {
    return { status: INTAKE_STATUS.DAY, ref: { day: only.day, month: only.month } };
  }
  return { status: INTAKE_STATUS.CHOOSE, options: candidates.slice(-MAX_DAY_CHOICES) };
}
