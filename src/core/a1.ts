/**
 * Notación A1 de las hojas de cálculo (`B12`, `A2:N86`). Columnas en base 0,
 * filas en base 1, igual que se leen en la hoja.
 */

export interface CellRef {
  /** Índice de columna en base 0 (`A` = 0). */
  column: number;
  /** Número de fila en base 1, como aparece en la hoja. */
  row: number;
}

export interface RangeRef {
  start: CellRef;
  end: CellRef;
}

const CELL_PATTERN = /^([A-Z]+)(\d+)$/;

export function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

export function columnLetter(index: number): string {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

export function parseCell(address: string): CellRef {
  const match = CELL_PATTERN.exec(address.trim().toUpperCase());
  const [, letters, digits] = match ?? [];
  if (letters === undefined || digits === undefined || Number(digits) < 1) {
    throw new Error(`Dirección de celda inválida: "${address}"`);
  }
  return { column: columnIndex(letters), row: Number(digits) };
}

export function cellAddress(ref: CellRef): string {
  return `${columnLetter(ref.column)}${ref.row}`;
}

/** `A2:N86` o una celda suelta (`Q18`). No acepta columnas completas (`A:C`). */
export function parseRange(range: string): RangeRef {
  const [from, to, ...rest] = range.split(':');
  if (from === undefined || rest.length > 0) throw new Error(`Rango inválido: "${range}"`);
  try {
    const start = parseCell(from);
    const end = to === undefined ? start : parseCell(to);
    return { start, end };
  } catch {
    throw new Error(`Rango inválido: "${range}"`);
  }
}
