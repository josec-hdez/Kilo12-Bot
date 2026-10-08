import type { CuadreSheet } from '../core/types.js';

/** Lectura del cuadre: hoy un .xlsx exportado; después, la hoja de Google Sheets. */
export interface CuadreSource {
  /** Pestañas de días (`01`, `02`…), en el orden del archivo. */
  listDays(): string[];
  readDay(tabName: string): CuadreSheet;
}

/**
 * Lectura asíncrona del cuadre, para /validar: la hoja de Google Sheets (o la
 * simulada) o, mientras no haya hoja, el .xlsx exportado.
 */
export interface CuadreReader {
  /** Pestañas de días (`01`, `02`…), en el orden de la hoja. */
  listDays(): Promise<string[]>;
  readDay(tabName: string): Promise<CuadreSheet>;
  /** Varios días de una vez, en el mismo orden (en Sheets: dos llamadas en total). */
  readDays(tabNames: readonly string[]): Promise<CuadreSheet[]>;
}
