import type { DayRef, IpvDay, IpvTabRef } from '../core/types.js';

/**
 * Origen del IPV. Hoy es un .xlsx (el del programa de control o el hecho a mano); más adelante puede ser
 * un archivo por día en Drive o un Google Sheet, sin que cambie el resto del bot.
 */
export interface IpvSource {
  /** Todas las hojas del archivo, en su orden y con su nombre exacto. */
  listSheets(): string[];
  /** Hojas que dicen su día: por su título del POS o por su nombre (`3 oct`). */
  listDays(): IpvTabRef[];
  /** Día que dice una hoja (título A1 del POS o nombre); null si no lo dice. */
  sheetDate(tabName: string): DayRef | null;
  readDay(ref: DayRef): IpvDay;
  /** Lee una hoja por su nombre exacto; `ref` es el día del cuadre al que corresponde. */
  readSheet(tabName: string, ref: DayRef): IpvDay;
}
