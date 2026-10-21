import type { CalendarDate } from '../core/expense.js';
import type { DayRef } from '../core/types.js';

/** Día y mes de `now` en la zona horaria del negocio (America/Havana). */
export function todayIn(now: Date, timeZone: string): DayRef {
  const { day, month } = todayDateIn(now, timeZone);
  return { day, month };
}

/** Fecha completa (con año) de `now` en la zona horaria del negocio. */
export function todayDateIn(now: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const value = (type: 'day' | 'month' | 'year') =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}
