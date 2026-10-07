/**
 * Layout de la hoja diaria del cuadre, copiado de las hojas reales (01–05).
 * Columnas A:N por producto y resumen en P:Q. No se agregan ni mueven columnas.
 */

export const CUADRE_HEADERS = [
  ' Producto',
  'Costo',
  'Invs inicial',
  'P. Venta',
  'Cant. Inicio',
  'Entradas',
  'Merma',
  'Consumo',
  'Salida',
  'Cant. Final',
  'Venta Bruta',
  'Costo Final',
  'Invs. Final',
  'Utilidad',
] as const;

export const FIRST_DATA_ROW = 2;
/** Las hojas originales usan rangos fijos (2:98, 2:104); la plantilla deja espacio hasta 300. */
export const LAST_DATA_ROW = 300;

export const FORMULA_COLUMNS = ['C', 'I', 'K', 'L', 'M', 'N'] as const;
export type FormulaColumn = (typeof FORMULA_COLUMNS)[number];
export type RowFormulas = Readonly<Record<FormulaColumn, string>>;

/** Fórmulas de la fila `n`, según CLAUDE.md. */
export function rowFormulas(n: number): RowFormulas {
  return {
    C: `=B${n}*E${n}`,
    I: `=E${n}+F${n}-G${n}-H${n}-J${n}`,
    K: `=I${n}*D${n}`,
    L: `=I${n}*B${n}`,
    M: `=J${n}*B${n}`,
    N: `=K${n}-L${n}`,
  };
}

export interface SummaryCell {
  address: string;
  value: string | number | null;
}

const sumOf = (column: string): string =>
  `=SUM(${column}${FIRST_DATA_ROW}:${column}${LAST_DATA_ROW})`;

/** Celda de la TC: etiqueta en P18 y valor numérico en Q18 (aprobado por las dueñas). */
export const TC_LABEL_CELL = 'P18';
export const TC_VALUE_CELL = 'Q18';

/**
 * Resumen P:Q. Igual al original salvo dos correcciones aprobadas:
 * Q14 = Utilidad Bruta − Gastos (el original restaba los gastos a la venta)
 * y la TC como número en Q18 para poder usarla en fórmulas.
 */
export function summaryCells(tc: number | null): SummaryCell[] {
  return [
    { address: 'P2', value: 'Inversion Inicial' },
    { address: 'Q2', value: sumOf('C') },
    { address: 'P3', value: 'Inversion Final' },
    { address: 'Q3', value: sumOf('M') },
    { address: 'P4', value: 'Venta Total' },
    { address: 'Q4', value: sumOf('K') },
    { address: 'P5', value: 'Costo Total' },
    { address: 'Q5', value: sumOf('L') },
    { address: 'P6', value: 'Utilidad Bruta' },
    { address: 'Q6', value: '=Q4-Q5' },
    { address: 'P8', value: 'Otros Gastos' },
    { address: 'P13', value: 'Total' },
    { address: 'Q13', value: '=SUM(Q8:Q12)' },
    { address: 'P14', value: 'Utilidad' },
    { address: 'Q14', value: '=Q6-Q13' },
    { address: TC_LABEL_CELL, value: 'TC.' },
    { address: TC_VALUE_CELL, value: tc },
  ];
}

const LEGACY_TC_PATTERN = /tc\.?\s*([\d.,]+)/i;

/**
 * Lee la TC de un día. Primero el número de Q18; si no hay, el formato antiguo
 * escrito como texto en P18 (`TC. 780`).
 */
export function parseTc(labelCell: unknown, valueCell: unknown): number | null {
  if (typeof valueCell === 'number' && Number.isFinite(valueCell)) return valueCell;
  if (typeof labelCell !== 'string') return null;

  const match = LEGACY_TC_PATTERN.exec(labelCell);
  if (!match?.[1]) return null;
  // La coma es separador de miles ("1,050"); el punto, decimal.
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
