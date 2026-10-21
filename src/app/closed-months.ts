import { isMonthKey, monthName, type MonthKey } from '../core/months.js';
import type { SettingsRepository } from '../ports/repositories.js';

/**
 * Meses cerrados con /cierremes. Un mes cerrado no se escribe sin querer: /ipv, /tc
 * y /deshacer sobre él solo se confirman con "⚠️ Confirmar igual" (dueña + motivo).
 */

/** Clave en la tabla de configuración: `["2026-10"]`. */
export const CLOSED_MONTHS_SETTING = 'closed_months';

export function readClosedMonths(settings: SettingsRepository): MonthKey[] {
  const raw = settings.get(CLOSED_MONTHS_SETTING);
  if (!Array.isArray(raw)) return [];
  return raw.filter((month): month is string => typeof month === 'string' && isMonthKey(month));
}

export function isMonthClosed(settings: SettingsRepository, month: MonthKey): boolean {
  return readClosedMonths(settings).includes(month);
}

export function markMonthClosed(settings: SettingsRepository, month: MonthKey): void {
  const closed = new Set(readClosedMonths(settings));
  closed.add(month);
  settings.set(CLOSED_MONTHS_SETTING, [...closed].sort());
}

/** Quita el mes de los cerrados. Devuelve false si no estaba cerrado. */
export function reopenMonth(settings: SettingsRepository, month: MonthKey): boolean {
  const closed = readClosedMonths(settings);
  if (!closed.includes(month)) return false;
  settings.set(
    CLOSED_MONTHS_SETTING,
    closed.filter((other) => other !== month),
  );
  return true;
}

/** Motivo de bloqueo de una escritura en un mes cerrado. */
export function closedMonthBlocker(month: MonthKey): string {
  return `${monthName(month)} está cerrado (/cierremes): solo una dueña puede cambiarlo, con "⚠️ Confirmar igual" y el motivo`;
}
