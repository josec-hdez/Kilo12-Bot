import { computeTotals, salida } from './calc.js';
import { normalizeName } from './tabs.js';
import type { CuadreRow, CuadreSheet } from './types.js';

/**
 * Reportes T4 de CLAUDE.md. Todo es puro y se recalcula desde las entradas de cada
 * fila (costo, precio, inicio, entradas, merma, consumo, final) con las fórmulas de
 * la hoja: no se confía en las celdas calculadas, que pueden tener errores (Q14,
 * valores escritos a mano). Una celda vacía vale 0, igual que en Sheets.
 */

const n = (value: number | null): number => value ?? 0;
const money = (value: number): number => Math.round(value * 100) / 100;
const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

/** Un costo vacío o 0 no es un costo real: la utilidad de esa fila sale inflada. */
export function hasCost(row: Pick<CuadreRow, 'costo'>): boolean {
  return row.costo !== null && row.costo > 0;
}

export const productKey = (product: string): string => normalizeName(product);

// ---------------------------------------------------------------- gastos

export interface ExpenseItem {
  concept: string;
  amount: number;
  cell: string;
}

export interface DayExpenses {
  /** `false` si la hoja no tiene la sección "Otros Gastos": los gastos no se conocen. */
  found: boolean;
  total: number;
  items: ExpenseItem[];
}

const EXPENSES_LABEL = 'otros gastos';
const TOTAL_LABEL = 'total';
/** Filas de gastos de la plantilla (Q8:Q12) si no aparece la etiqueta "Total". */
const DEFAULT_EXPENSE_ROWS = 5;
const NO_CONCEPT = 'sin concepto';

function labelRows(sheet: CuadreSheet): Map<number, string> {
  const rows = new Map<number, string>();
  for (const [address, content] of Object.entries(sheet.summary)) {
    const row = /^P(\d+)$/.exec(address)?.[1];
    if (row !== undefined && typeof content?.value === 'string') {
      rows.set(Number(row), content.value.trim());
    }
  }
  return rows;
}

/**
 * Gastos del día: los valores de Q entre la etiqueta "Otros Gastos" y la etiqueta
 * "Total" (se suman los gastos, no la celda Total). Se busca por texto porque
 * algunas hojas tienen el resumen corrido una fila.
 */
export function expensesOf(sheet: CuadreSheet): DayExpenses {
  const labels = labelRows(sheet);
  const start = [...labels].find(([, text]) => normalizeName(text) === EXPENSES_LABEL)?.[0];
  if (start === undefined) return { found: false, total: 0, items: [] };

  const end =
    [...labels]
      .filter(([row, text]) => row > start && normalizeName(text) === TOTAL_LABEL)
      .map(([row]) => row)
      .sort((a, b) => a - b)[0] ?? start + DEFAULT_EXPENSE_ROWS;

  const items: ExpenseItem[] = [];
  for (let row = start; row < end; row++) {
    const cell = `Q${String(row)}`;
    const value = sheet.summary[cell]?.value;
    if (typeof value !== 'number' || value === 0) continue;
    const label = row === start ? '' : (labels.get(row) ?? '');
    items.push({ concept: label === '' ? NO_CONCEPT : label, amount: value, cell });
  }
  return { found: true, total: money(items.reduce((sum, item) => sum + item.amount, 0)), items };
}

// ---------------------------------------------------------------- día

export interface UncostedSale {
  product: string;
  units: number;
  venta: number;
}

export interface DaySummary {
  /** Pestaña del cuadre, sin espacios (`03`). */
  day: string;
  venta: number;
  costo: number;
  utilidadBruta: number;
  /** Utilidad bruta ÷ venta; `null` si no hubo venta. */
  margen: number | null;
  gastos: DayExpenses;
  /** Utilidad bruta − gastos. Nunca venta − gastos. */
  utilidadNeta: number;
  tc: number | null;
  inversionInicial: number;
  inversionFinal: number;
  /** Σ entradas × costo: lo que se compró ese día, valorado al costo. */
  compras: number;
  /** Filas que vendieron sin costo: su utilidad cuenta la venta completa. */
  uncosted: UncostedSale[];
  ventaSinCosto: number;
  /** Venta y utilidad solo de las filas con costo (para estimar la ganancia ajustada). */
  ventaConCosto: number;
  utilidadConCosto: number;
}

export function summarizeDay(sheet: CuadreSheet): DaySummary {
  const totals = computeTotals(sheet.rows);
  const gastos = expensesOf(sheet);

  let compras = 0;
  let ventaConCosto = 0;
  let costoConCosto = 0;
  const uncosted: UncostedSale[] = [];
  for (const row of sheet.rows) {
    const units = salida(row);
    const venta = units * n(row.precio);
    if (hasCost(row)) {
      compras += n(row.entradas) * n(row.costo);
      ventaConCosto += venta;
      costoConCosto += units * n(row.costo);
    } else if (venta !== 0) {
      uncosted.push({ product: row.product, units, venta: money(venta) });
    }
  }

  return {
    day: sheet.tabName.trim(),
    venta: totals.ventaTotal,
    costo: totals.costoTotal,
    utilidadBruta: totals.utilidadBruta,
    margen: ratio(totals.utilidadBruta, totals.ventaTotal),
    gastos,
    utilidadNeta: money(totals.utilidadBruta - gastos.total),
    tc: sheet.tc,
    inversionInicial: totals.inversionInicial,
    inversionFinal: totals.inversionFinal,
    compras: money(compras),
    uncosted,
    ventaSinCosto: money(uncosted.reduce((sum, sale) => sum + sale.venta, 0)),
    ventaConCosto: money(ventaConCosto),
    utilidadConCosto: money(ventaConCosto - costoConCosto),
  };
}

// ---------------------------------------------------------------- período

export interface UsdTotals {
  venta: number;
  utilidadBruta: number;
  utilidadNeta: number;
  /** Días sin TC: no entran en los totales en USD. */
  daysWithoutTc: string[];
}

export interface PeriodSummary {
  days: DaySummary[];
  venta: number;
  costo: number;
  utilidadBruta: number;
  gastos: number;
  utilidadNeta: number;
  /** Promedio de los márgenes diarios: cada día pesa igual. */
  margenSimple: number | null;
  /** Σ utilidad bruta ÷ Σ venta: los días que más venden pesan más. */
  margenPonderado: number | null;
  usd: UsdTotals;
  /** Día con mayor y menor utilidad neta. */
  best: DaySummary | null;
  worst: DaySummary | null;
  ventaSinCosto: number;
  /** Días sin la sección "Otros Gastos": sus gastos no se conocen. */
  daysWithoutExpenses: string[];
}

const sum = (days: readonly DaySummary[], pick: (day: DaySummary) => number): number =>
  money(days.reduce((total, day) => total + pick(day), 0));

export function summarizePeriod(days: readonly DaySummary[]): PeriodSummary {
  const venta = sum(days, (d) => d.venta);
  const utilidadBruta = sum(days, (d) => d.utilidadBruta);
  const margins = days.map((d) => d.margen).filter((m): m is number => m !== null);

  const withTc = days.filter((d) => d.tc !== null && d.tc > 0);
  const usd = (pick: (day: DaySummary) => number): number =>
    money(withTc.reduce((total, day) => total + pick(day) / (day.tc ?? 1), 0));

  const byNet = [...days].sort((a, b) => b.utilidadNeta - a.utilidadNeta);

  return {
    days: [...days],
    venta,
    costo: sum(days, (d) => d.costo),
    utilidadBruta,
    gastos: sum(days, (d) => d.gastos.total),
    utilidadNeta: sum(days, (d) => d.utilidadNeta),
    margenSimple: margins.length === 0 ? null : margins.reduce((a, b) => a + b, 0) / margins.length,
    margenPonderado: ratio(utilidadBruta, venta),
    usd: {
      venta: usd((d) => d.venta),
      utilidadBruta: usd((d) => d.utilidadBruta),
      utilidadNeta: usd((d) => d.utilidadNeta),
      daysWithoutTc: days.filter((d) => !withTc.includes(d)).map((d) => d.day),
    },
    best: byNet[0] ?? null,
    worst: byNet[byNet.length - 1] ?? null,
    ventaSinCosto: sum(days, (d) => d.ventaSinCosto),
    daysWithoutExpenses: days.filter((d) => !d.gastos.found).map((d) => d.day),
  };
}

// ---------------------------------------------------------------- ganancia ajustada

export interface AdjustedProfit {
  /** Utilidad bruta según las hojas (productos sin costo cuentan la venta completa). */
  segunHojas: number;
  ventaSinCosto: number;
  /** Margen ponderado de las filas con costo: el que se asume para las que no tienen. */
  margenReferencia: number | null;
  /** Utilidad bruta estimada con el margen mínimo, el de referencia y el máximo diario. */
  bajo: number;
  central: number;
  alto: number;
  gastos: number;
}

/**
 * Estimación (no dato): a la venta sin costo se le asigna el margen de los productos
 * que sí tienen costo. El rango usa el menor y el mayor margen diario de esos productos.
 */
export function adjustedProfit(period: PeriodSummary): AdjustedProfit {
  const ventaConCosto = sum(period.days, (d) => d.ventaConCosto);
  const utilidadConCosto = sum(period.days, (d) => d.utilidadConCosto);
  const reference = ratio(utilidadConCosto, ventaConCosto);
  const dailyMargins = period.days
    .map((d) => ratio(d.utilidadConCosto, d.ventaConCosto))
    .filter((m): m is number => m !== null);

  const estimate = (margin: number | null): number =>
    money(period.utilidadBruta - period.ventaSinCosto * (1 - (margin ?? 0)));

  return {
    segunHojas: period.utilidadBruta,
    ventaSinCosto: period.ventaSinCosto,
    margenReferencia: reference,
    bajo: estimate(dailyMargins.length === 0 ? reference : Math.min(...dailyMargins)),
    central: estimate(reference),
    alto: estimate(dailyMargins.length === 0 ? reference : Math.max(...dailyMargins)),
    gastos: period.gastos,
  };
}

// ---------------------------------------------------------------- una fila (/fila)

export const ROW_FIELD = {
  COSTO: 'costo',
  INVS_INICIAL: 'invsInicial',
  PRECIO: 'precio',
  INICIO: 'inicio',
  ENTRADAS: 'entradas',
  MERMA: 'merma',
  CONSUMO: 'consumo',
  SALIDA: 'salida',
  FINAL: 'final',
  VENTA_BRUTA: 'ventaBruta',
  COSTO_FINAL: 'costoFinal',
  INVS_FINAL: 'invsFinal',
  UTILIDAD: 'utilidad',
} as const;

export type RowFieldKey = (typeof ROW_FIELD)[keyof typeof ROW_FIELD];

export interface RowField {
  key: RowFieldKey;
  /** Columna de la hoja (`B`, `C`…). */
  column: string;
  /** Valor de entrada o recalculado con la fórmula de la columna. */
  value: number | null;
  /** Lo que guardó la hoja en las columnas calculadas; `null` en las de entrada. */
  stored: number | null;
  /** La hoja guarda un valor distinto del recalculado (fórmula rota o valor a mano). */
  differs: boolean;
}

export interface RowReport {
  day: string;
  product: string;
  rowNumber: number;
  fields: RowField[];
  margen: number | null;
  hasCost: boolean;
}

const STORED_TOLERANCE = 0.005;

function computed(
  key: RowFieldKey,
  column: string,
  value: number,
  stored: number | null,
): RowField {
  const rounded = money(value);
  return {
    key,
    column,
    value: rounded,
    stored,
    differs: stored !== null && Math.abs(stored - rounded) > STORED_TOLERANCE,
  };
}

const input = (key: RowFieldKey, column: string, value: number | null): RowField => ({
  key,
  column,
  value,
  stored: null,
  differs: false,
});

export function findRow(sheet: CuadreSheet, product: string): CuadreRow | undefined {
  const key = productKey(product);
  return sheet.rows.find((row) => productKey(row.product) === key);
}

/** Toda la fila de un producto en un día, recalculada y comparada con lo guardado. */
export function productRow(sheet: CuadreSheet, product: string): RowReport | null {
  const row = findRow(sheet, product);
  if (row === undefined) return null;

  const units = salida(row);
  const venta = units * n(row.precio);
  const costoVenta = units * n(row.costo);
  return {
    day: sheet.tabName.trim(),
    product: row.product,
    rowNumber: row.rowNumber,
    fields: [
      input(ROW_FIELD.COSTO, 'B', row.costo),
      computed(ROW_FIELD.INVS_INICIAL, 'C', n(row.costo) * n(row.inicio), row.invsInicial),
      input(ROW_FIELD.PRECIO, 'D', row.precio),
      input(ROW_FIELD.INICIO, 'E', row.inicio),
      input(ROW_FIELD.ENTRADAS, 'F', row.entradas),
      input(ROW_FIELD.MERMA, 'G', row.merma),
      input(ROW_FIELD.CONSUMO, 'H', row.consumo),
      computed(ROW_FIELD.SALIDA, 'I', units, row.salida),
      input(ROW_FIELD.FINAL, 'J', row.final),
      computed(ROW_FIELD.VENTA_BRUTA, 'K', venta, row.ventaBruta),
      computed(ROW_FIELD.COSTO_FINAL, 'L', costoVenta, row.costoFinal),
      computed(ROW_FIELD.INVS_FINAL, 'M', n(row.final) * n(row.costo), row.invsFinal),
      computed(ROW_FIELD.UTILIDAD, 'N', venta - costoVenta, row.utilidad),
    ],
    margen: ratio(venta - costoVenta, venta),
    hasCost: hasCost(row),
  };
}

// ---------------------------------------------------------------- un producto en varios días

export interface ProductDayLine {
  day: string;
  costo: number | null;
  precio: number | null;
  inicio: number;
  entradas: number;
  merma: number;
  consumo: number;
  unidades: number;
  final: number | null;
  venta: number;
  costoVenta: number;
  utilidad: number;
}

export interface ValueChange {
  day: string;
  from: number | null;
  to: number | null;
}

export interface ProductTotals {
  product: string;
  lines: ProductDayLine[];
  /** Días del período en los que el producto no aparece en la hoja. */
  missingDays: string[];
  entradas: number;
  merma: number;
  consumo: number;
  unidades: number;
  venta: number;
  costo: number;
  utilidad: number;
  margen: number | null;
  priceChanges: ValueChange[];
  costChanges: ValueChange[];
  /** Cant. final del último día en que aparece. */
  stock: number | null;
  /** Unidades vendidas ÷ días del período. */
  ventaDiaria: number;
  /** Existencia ÷ venta diaria; `null` si no vendió. */
  diasInventario: number | null;
  daysWithoutCost: string[];
}

function changes(
  lines: readonly ProductDayLine[],
  pick: (line: ProductDayLine) => number | null,
): ValueChange[] {
  const out: ValueChange[] = [];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    if (prev === undefined || line === undefined) continue;
    if (pick(prev) !== pick(line)) out.push({ day: line.day, from: pick(prev), to: pick(line) });
  }
  return out;
}

/** Suma de todas las filas de un producto en las hojas dadas, con el detalle por día. */
export function productTotals(
  sheets: readonly CuadreSheet[],
  product: string,
): ProductTotals | null {
  const lines: ProductDayLine[] = [];
  const missingDays: string[] = [];
  let name: string | null = null;

  for (const sheet of sheets) {
    const row = findRow(sheet, product);
    if (row === undefined) {
      missingDays.push(sheet.tabName.trim());
      continue;
    }
    name = row.product;
    const units = salida(row);
    const venta = money(units * n(row.precio));
    const costoVenta = money(units * n(row.costo));
    lines.push({
      day: sheet.tabName.trim(),
      costo: row.costo,
      precio: row.precio,
      inicio: n(row.inicio),
      entradas: n(row.entradas),
      merma: n(row.merma),
      consumo: n(row.consumo),
      unidades: units,
      final: row.final,
      venta,
      costoVenta,
      utilidad: money(venta - costoVenta),
    });
  }
  if (name === null) return null;

  const total = (pick: (line: ProductDayLine) => number): number =>
    money(lines.reduce((acc, line) => acc + pick(line), 0));
  const unidades = total((l) => l.unidades);
  const venta = total((l) => l.venta);
  const utilidad = total((l) => l.utilidad);
  const stock = lines[lines.length - 1]?.final ?? null;
  const ventaDiaria = sheets.length === 0 ? 0 : unidades / sheets.length;

  return {
    product: name,
    lines,
    missingDays,
    entradas: total((l) => l.entradas),
    merma: total((l) => l.merma),
    consumo: total((l) => l.consumo),
    unidades,
    venta,
    costo: total((l) => l.costoVenta),
    utilidad,
    margen: ratio(utilidad, venta),
    priceChanges: changes(lines, (l) => l.precio),
    costChanges: changes(lines, (l) => l.costo),
    stock,
    ventaDiaria,
    diasInventario: ventaDiaria > 0 && stock !== null ? stock / ventaDiaria : null,
    daysWithoutCost: lines.filter((l) => l.costo === null || l.costo <= 0).map((l) => l.day),
  };
}

// ---------------------------------------------------------------- ranking y márgenes

export interface ProductAggregate {
  product: string;
  unidades: number;
  venta: number;
  costo: number;
  utilidad: number;
  margen: number | null;
  /** Vendió algún día sin costo: su utilidad sale inflada. */
  missingCost: boolean;
}

/** Totales por producto en las hojas dadas (nombre del último día en que aparece). */
export function aggregateProducts(sheets: readonly CuadreSheet[]): ProductAggregate[] {
  const byKey = new Map<string, ProductAggregate>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const key = productKey(row.product);
      if (key === '') continue;
      const units = salida(row);
      const venta = units * n(row.precio);
      const costo = units * n(row.costo);
      const current = byKey.get(key) ?? {
        product: row.product,
        unidades: 0,
        venta: 0,
        costo: 0,
        utilidad: 0,
        margen: null,
        missingCost: false,
      };
      byKey.set(key, {
        product: row.product,
        unidades: current.unidades + units,
        venta: current.venta + venta,
        costo: current.costo + costo,
        utilidad: current.utilidad + venta - costo,
        margen: null,
        missingCost: current.missingCost || (!hasCost(row) && venta !== 0),
      });
    }
  }
  return [...byKey.values()].map((p) => ({
    ...p,
    unidades: money(p.unidades),
    venta: money(p.venta),
    costo: money(p.costo),
    utilidad: money(p.utilidad),
    margen: p.missingCost ? null : ratio(p.utilidad, p.venta),
  }));
}

export const TOP_METRIC = {
  VENTA: 'venta',
  UTILIDAD: 'utilidad',
  UNIDADES: 'unidades',
} as const;

export type TopMetric = (typeof TOP_METRIC)[keyof typeof TOP_METRIC];

export function topProducts(
  products: readonly ProductAggregate[],
  metric: TopMetric,
  limit: number,
): ProductAggregate[] {
  return products
    .filter((p) => p[metric] > 0)
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit);
}

/** Margen por debajo del cual un producto de alta rotación se alerta (CLAUDE.md T5). */
export const LOW_MARGIN_THRESHOLD = 0.15;
/** Alta rotación = el 25% de los productos que más unidades venden en el período. */
export const HIGH_ROTATION_QUANTILE = 0.25;

export interface MarginReport {
  /** Productos con costo, de menor a mayor margen. */
  ranked: ProductAggregate[];
  /** Alta rotación con margen menor al 15%. */
  lowMarginHighRotation: ProductAggregate[];
  /** Vendieron sin costo: no se puede calcular su margen. */
  withoutCost: ProductAggregate[];
  /** Unidades mínimas para contar como alta rotación. */
  highRotationMinUnits: number;
}

export function marginReport(products: readonly ProductAggregate[]): MarginReport {
  const sold = products.filter((p) => p.unidades > 0 && p.venta > 0);
  const byUnits = [...sold].sort((a, b) => b.unidades - a.unidades);
  const topCount = Math.max(1, Math.ceil(byUnits.length * HIGH_ROTATION_QUANTILE));
  const highRotationMinUnits = byUnits[topCount - 1]?.unidades ?? 0;
  const ranked = sold
    .filter((p) => p.margen !== null)
    .sort((a, b) => (a.margen ?? 0) - (b.margen ?? 0));

  return {
    ranked,
    lowMarginHighRotation: ranked.filter(
      (p) =>
        p.unidades >= highRotationMinUnits && p.margen !== null && p.margen < LOW_MARGIN_THRESHOLD,
    ),
    withoutCost: sold.filter((p) => p.margen === null),
    highRotationMinUnits,
  };
}
