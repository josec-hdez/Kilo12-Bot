import type { TotalsRow } from './calc.js';
import { catalogProducts, lookupCost, type CostCatalog } from './costs.js';
import { FIRST_DATA_ROW, rowFormulas, type RowFormulas } from './cuadre-layout.js';
import type { Equivalence } from './equivalences.js';
import {
  buildAliasIndex,
  resolveIpvProduct,
  suggestMatches,
  type MatchSuggestion,
} from './mapping.js';
import type { DayRef, IpvDay, IpvRow } from './types.js';

export interface CuadreRowDraft extends TotalsRow {
  rowNumber: number;
  /** Nombre en el cuadre. Para un producto sin emparejar, el nombre del IPV. */
  product: string;
  /** Filas del IPV que forman esta fila (más de una si se suman). */
  sourceIpvProducts: string[];
  /** Producto del IPV sin equivalencia: se agrega al final con costo vacío. */
  isNew: boolean;
  missingCost: boolean;
  formulas: RowFormulas;
}

export interface UnmatchedProduct {
  ipvProduct: string;
  suggestions: MatchSuggestion[];
}

/** Celda escrita con USER_ENTERED: número, texto o fórmula (`=...`). Vacío = ''. */
export type SheetValue = string | number;

export interface CuadreDraft extends DayRef {
  rows: CuadreRowDraft[];
  /** Filas A:N en orden, desde la fila 2, listas para escribir. */
  sheetValues: SheetValue[][];
  /** Productos (nombre del cuadre) sin costo conocido. */
  missingCost: string[];
  /** Celdas a resaltar en amarillo (costos faltantes). */
  yellowCells: string[];
  /** Productos del IPV sin equivalencia, con sugerencias para que las dueñas confirmen. */
  unmatched: UnmatchedProduct[];
  /** Productos del IPV sin existencia ni movimiento, que no se escriben. */
  omitted: string[];
  warnings: string[];
  ipvImporteTotal: number | null;
}

interface Group {
  product: string;
  isNew: boolean;
  rows: IpvRow[];
}

const QUANTITY_FIELDS = ['inicial', 'entrada', 'merma', 'consumo', 'salida', 'final'] as const;

function hasStockOrMovement(row: IpvRow): boolean {
  return QUANTITY_FIELDS.some((field) => (row[field] ?? 0) !== 0);
}

/** Suma valores que pueden estar vacíos. Si todos están vacíos, el resultado también. */
function sumNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((total, value) => total + value, 0) * 1000) / 1000;
}

function groupPrice(group: Group, warnings: string[]): number | null {
  const prices = [...new Set(group.rows.map((row) => row.precio).filter((p) => p !== null))];
  if (prices.length <= 1) return prices[0] ?? null;

  warnings.push(
    `${group.product}: las filas sumadas del IPV tienen precios distintos (${prices.join(', ')}). ` +
      'Se usa el primero; revisa la venta antes de confirmar.',
  );
  return prices[0] ?? null;
}

/**
 * Arma la hoja del día a partir del IPV (cantidades y precios) y del catálogo
 * (costos). Es puro: no escribe nada. Los productos sin equivalencia se agregan
 * al final con costo vacío, nunca se emparejan solos.
 */
export function buildCuadreDraft(
  ipv: IpvDay,
  catalog: CostCatalog,
  equivalences: readonly Equivalence[],
): CuadreDraft {
  const aliases = buildAliasIndex(equivalences);
  const products = catalogProducts(catalog);
  const known = new Map<string, Group>();
  const added = new Map<string, Group>();
  const unmatched: UnmatchedProduct[] = [];
  const omitted: string[] = [];
  const warnings: string[] = [];

  for (const row of ipv.rows) {
    if (!hasStockOrMovement(row)) {
      omitted.push(row.product);
      continue;
    }

    const match = resolveIpvProduct(row.product, aliases, products);
    const target = match === null ? added : known;
    const product = match?.product ?? row.product;
    const group = target.get(product);
    if (group) {
      group.rows.push(row);
    } else {
      target.set(product, { product, isNew: match === null, rows: [row] });
      if (match === null) {
        unmatched.push({
          ipvProduct: row.product,
          suggestions: suggestMatches(row.product, products),
        });
      }
    }
  }

  const rows = [...known.values(), ...added.values()].map((group, index): CuadreRowDraft => {
    const rowNumber = FIRST_DATA_ROW + index;
    const costo = group.isNew ? null : (lookupCost(catalog, group.product)?.costo ?? null);
    const sum = (field: (typeof QUANTITY_FIELDS)[number]) =>
      sumNullable(group.rows.map((row) => row[field]));

    return {
      rowNumber,
      product: group.product,
      costo,
      precio: groupPrice(group, warnings),
      inicio: sum('inicial'),
      entradas: sum('entrada'),
      merma: sum('merma'),
      consumo: sum('consumo'),
      final: sum('final'),
      sourceIpvProducts: group.rows.map((row) => row.product),
      isNew: group.isNew,
      missingCost: costo === null,
      formulas: rowFormulas(rowNumber),
    };
  });

  const withoutCost = rows.filter((row) => row.missingCost);

  return {
    day: ipv.day,
    month: ipv.month,
    rows,
    sheetValues: rows.map(toSheetRow),
    missingCost: withoutCost.map((row) => row.product),
    yellowCells: withoutCost.map((row) => `B${row.rowNumber}`),
    unmatched,
    omitted,
    warnings,
    ipvImporteTotal: ipv.importeTotal,
  };
}

const cell = (value: number | null): SheetValue => value ?? '';

function toSheetRow(row: CuadreRowDraft): SheetValue[] {
  const { formulas: f } = row;
  return [
    row.product,
    cell(row.costo),
    f.C,
    cell(row.precio),
    cell(row.inicio),
    cell(row.entradas),
    cell(row.merma),
    cell(row.consumo),
    f.I,
    cell(row.final),
    f.K,
    f.L,
    f.M,
    f.N,
  ];
}
