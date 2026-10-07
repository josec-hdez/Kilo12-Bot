import type { CuadreSheet } from '../core/types.js';

/** Lectura del cuadre: hoy un .xlsx exportado; después, la hoja de Google Sheets. */
export interface CuadreSource {
  /** Pestañas de días (`01`, `02`…), en el orden del archivo. */
  listDays(): string[];
  readDay(tabName: string): CuadreSheet;
}
