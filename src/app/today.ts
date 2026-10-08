import type { DayRef } from '../core/types.js';

/** Día y mes de `now` en la zona horaria del negocio (America/Havana). */
export function todayIn(now: Date, timeZone: string): DayRef {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const value = (type: 'day' | 'month') => Number(parts.find((part) => part.type === type)?.value);
  return { day: value('day'), month: value('month') };
}
