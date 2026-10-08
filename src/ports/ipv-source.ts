import type { DayRef, IpvDay, IpvTabRef } from '../core/types.js';

/**
 * Origen del IPV. Hoy es un .xlsx con una pestaña por día; más adelante puede ser
 * un archivo por día en Drive o un Google Sheet, sin que cambie el resto del bot.
 */
export interface IpvSource {
  listDays(): IpvTabRef[];
  readDay(ref: DayRef): IpvDay;
}
