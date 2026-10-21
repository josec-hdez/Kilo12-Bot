import { SUMMARY_CELL } from './cuadre-layout.js';

/**
 * Pestaña `Resumen` de cada libro mensual: una fila por día (01–31) con las cifras
 * del resumen P:Q de su pestaña y una fila de totales. Las dueñas ven el mes sin el
 * bot.
 *
 * Cada celda lee su día con INDIRECT y IFERROR: un día que todavía no existe (o que
 * se borró con /deshacer) queda en blanco en lugar de mostrar #REF!. Por eso la
 * pestaña se escribe una sola vez y no hay que tocarla al crear o borrar un día; y
 * como siempre tiene 31 filas, viaja intacta en la copia del libro del mes siguiente.
 */

export const SUMMARY_TAB = 'Resumen';
export const SUMMARY_DAYS = 31;

export const SUMMARY_HEADERS = [
  'Día',
  'Venta',
  'Costo',
  'Utilidad bruta',
  '% margen',
  'Otros gastos',
  'Utilidad neta',
  'TC',
  'Venta USD',
  'Inversión final',
] as const;

/** Columnas A:J; la fila 1 son los encabezados, los días van de la 2 a la 32. */
export const SUMMARY_RANGE_END_COLUMN = 'J';
const FIRST_DAY_ROW = 2;
const LAST_DAY_ROW = FIRST_DAY_ROW + SUMMARY_DAYS - 1;
export const SUMMARY_TOTAL_ROW = LAST_DAY_ROW + 1;

export type SummaryGridValue = string | number;

/** `='01'!Q4` sin #REF!: blanco si la pestaña del día no existe. */
const dayCell = (row: number, address: string): string =>
  `=IFERROR(INDIRECT("'"&TEXT($A${String(row)},"00")&"'!${address}"),"")`;

function dayRow(day: number): SummaryGridValue[] {
  const row = FIRST_DAY_ROW + day - 1;
  const r = String(row);
  return [
    day,
    dayCell(row, SUMMARY_CELL.VENTA),
    dayCell(row, SUMMARY_CELL.COSTO),
    dayCell(row, SUMMARY_CELL.UTILIDAD_BRUTA),
    `=IF(AND(ISNUMBER(B${r}),B${r}<>0),ROUND(D${r}/B${r}*100,1),"")`,
    dayCell(row, SUMMARY_CELL.GASTOS_TOTAL),
    dayCell(row, SUMMARY_CELL.UTILIDAD_NETA),
    dayCell(row, SUMMARY_CELL.TC),
    `=IF(AND(ISNUMBER(B${r}),ISNUMBER(H${r}),H${r}>0),ROUND(B${r}/H${r},2),"")`,
    dayCell(row, SUMMARY_CELL.INVERSION_FINAL),
  ];
}

/**
 * Totales: sumas de las columnas de dinero. El margen sale de los totales (utilidad
 * bruta ÷ venta), no del promedio de los márgenes; la venta en USD es la suma de la
 * de cada día (cada uno con su TC); la inversión final es la del último día cargado.
 */
function totalRow(): SummaryGridValue[] {
  const t = String(SUMMARY_TOTAL_ROW);
  const span = (column: string) =>
    `${column}${String(FIRST_DAY_ROW)}:${column}${String(LAST_DAY_ROW)}`;
  const sum = (column: string) => `=SUM(${span(column)})`;
  return [
    'Total',
    sum('B'),
    sum('C'),
    sum('D'),
    `=IF(B${t}<>0,ROUND(D${t}/B${t}*100,1),"")`,
    sum('F'),
    sum('G'),
    '',
    sum('I'),
    `=IFERROR(INDEX(FILTER(${span('J')},${span('J')}<>""),COUNT(${span('J')})),"")`,
  ];
}

/** Contenido completo de `Resumen`, A1:J33. */
export function summaryTabGrid(): SummaryGridValue[][] {
  return [
    [...SUMMARY_HEADERS],
    ...Array.from({ length: SUMMARY_DAYS }, (_, i) => dayRow(i + 1)),
    totalRow(),
  ];
}

/** Rango A1 que ocupa la pestaña: `A1:J33`. */
export function summaryTabRange(): string {
  return `A1:${SUMMARY_RANGE_END_COLUMN}${String(SUMMARY_TOTAL_ROW)}`;
}
