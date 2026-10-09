import type { DayRef, IpvDay, IpvTabRef } from '../core/types.js';

/**
 * Origen del IPV. Hoy es un .xlsx con una pestaña por día; más adelante puede ser
 * un archivo por día en Drive o un Google Sheet, sin que cambie el resto del bot.
 */
export interface IpvSource {
  /** Todas las hojas del archivo, en su orden y con su nombre exacto. */
  listSheets(): string[];
  /** Hojas cuyo nombre es un día (`3 oct`). */
  listDays(): IpvTabRef[];
  readDay(ref: DayRef): IpvDay;
  /** Lee una hoja por su nombre exacto; `ref` es el día del cuadre al que corresponde. */
  readSheet(tabName: string, ref: DayRef): IpvDay;
}
