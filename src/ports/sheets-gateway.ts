/**
 * Escritura y lectura de la hoja de cuadre en Google Sheets. El resto del bot solo
 * ve este puerto: en pruebas, y mientras no haya service account, se usa una hoja
 * simulada en memoria.
 */

/** Contenido de una celda. Al escribir, `''` deja la celda vacía y `=...` es una fórmula. */
export type CellValue = string | number | boolean;

/** Filas de un rango. Sheets omite las celdas vacías del final de cada fila. */
export type Grid = CellValue[][];

export const RENDER = {
  /** Fórmulas como texto (`=B2*E2`); los valores sin fórmula, tal cual. */
  FORMULA: 'FORMULA',
  /** Resultados ya calculados. */
  VALUE: 'UNFORMATTED_VALUE',
} as const;

export type Render = (typeof RENDER)[keyof typeof RENDER];

export interface TabInfo {
  sheetId: number;
  title: string;
  hidden: boolean;
  index: number;
}

/** Rango dentro de una pestaña, en notación A1 sin el nombre de la pestaña (`A2:N86`). */
export interface TabRange {
  tab: string;
  a1: string;
}

export interface RangeWrite extends TabRange {
  values: Grid;
}

/** Color de fondo con componentes entre 0 y 1, como los usa la API de Sheets. */
export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export const YELLOW: RgbColor = { red: 1, green: 1, blue: 0 };

export interface DuplicateOptions {
  /** La copia de `_plantilla` (oculta) nace visible. */
  hidden: boolean;
}

export interface SheetsGateway {
  listTabs(): Promise<TabInfo[]>;
  addTab(title: string, options: DuplicateOptions): Promise<TabInfo>;
  duplicateTab(source: string, title: string, options: DuplicateOptions): Promise<TabInfo>;
  deleteTab(title: string): Promise<void>;
  setHidden(title: string, hidden: boolean): Promise<void>;
  /** Un resultado por rango, en el mismo orden. */
  readRanges(ranges: readonly TabRange[], render: Render): Promise<Grid[]>;
  /** Escribe como si alguien lo tecleara (`USER_ENTERED`): las fórmulas se calculan. */
  writeRanges(writes: readonly RangeWrite[]): Promise<void>;
  /** Borra los valores de toda la pestaña. */
  clearTab(title: string): Promise<void>;
  setBackground(tab: string, cells: readonly string[], color: RgbColor): Promise<void>;
}
