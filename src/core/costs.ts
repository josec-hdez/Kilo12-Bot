import { normalizeName } from './tabs.js';

export interface CostSource {
  product: string;
  costo: number | null;
}

export interface CatalogEntry {
  /** Nombre tal como está en el cuadre. Un producto conserva siempre el mismo nombre. */
  product: string;
  /** Último costo conocido. `null` si nunca tuvo costo o tuvo 0. */
  costo: number | null;
}

/** Nombre normalizado → producto y costo vigente. */
export type CostCatalog = ReadonlyMap<string, CatalogEntry>;

const knownCost = (costo: number | null): number | null =>
  costo !== null && costo > 0 ? costo : null;

/**
 * Catálogo de costos a partir de las filas de un cuadre (fuente de verdad de costos).
 * Un costo vacío o 0 no borra el último costo conocido del mismo producto.
 */
export function buildCostCatalog(rows: readonly CostSource[]): CostCatalog {
  const catalog = new Map<string, CatalogEntry>();
  for (const { product, costo } of rows) {
    const key = normalizeName(product);
    if (key === '') continue;
    const previous = catalog.get(key);
    catalog.set(key, { product, costo: knownCost(costo) ?? previous?.costo ?? null });
  }
  return catalog;
}

export function lookupCost(catalog: CostCatalog, product: string): CatalogEntry | undefined {
  return catalog.get(normalizeName(product));
}

export function catalogProducts(catalog: CostCatalog): string[] {
  return [...catalog.values()].map((entry) => entry.product);
}

/**
 * Pestañas del cuadre anteriores a un día (`01`…`13` para el 14), de la más vieja a la
 * más nueva: de ahí sale el último costo conocido de cada producto.
 */
export function cuadreTabsBefore(tabs: readonly string[], day: number): string[] {
  return tabs
    .map((tab) => tab.trim())
    .filter((tab) => /^\d{1,2}$/.test(tab) && Number(tab) < day)
    .sort((a, b) => Number(a) - Number(b));
}

/**
 * Último costo conocido de cada producto. Manda el cuadre, fuente de verdad de costos:
 * sus pestañas en orden cronológico pisan al respaldo (el catálogo de SQLite), y un
 * costo vacío o 0 no borra el que ya se conocía.
 */
export function buildLastKnownCosts(
  fallback: readonly CostSource[],
  days: readonly (readonly CostSource[])[],
): CostCatalog {
  return buildCostCatalog([...fallback, ...days.flat()]);
}

export interface CostUpdate {
  product: string;
  cost: number;
  previous: number | null;
}

export interface CatalogSyncPlan {
  /** Productos del cuadre que el catálogo todavía no tiene. */
  newProducts: string[];
  /** Costos del cuadre (> 0) distintos del que guarda el catálogo. */
  costUpdates: CostUpdate[];
}

/**
 * Qué falta en el catálogo de SQLite para reflejar el cuadre: productos que no tiene y
 * costos que cambiaron. Un costo igual, vacío o 0 no genera cambio (no se repite el
 * historial). Los nombres que ya son equivalencia de otro producto se ignoran: son
 * filas viejas escritas con el nombre del IPV antes de existir la equivalencia.
 */
export function planCatalogSync(
  catalog: readonly CostSource[],
  cuadre: readonly CostSource[],
  aliases: readonly string[] = [],
): CatalogSyncPlan {
  const known = new Map(catalog.map((entry) => [normalizeName(entry.product), entry]));
  const aliasKeys = new Set(aliases.map(normalizeName));
  const newProducts: string[] = [];
  const costUpdates: CostUpdate[] = [];
  const latest = buildCostCatalog(
    cuadre.filter((row) => !aliasKeys.has(normalizeName(row.product))),
  );

  for (const [key, { product, costo }] of latest) {
    const current = known.get(key);
    if (current === undefined) newProducts.push(product);
    const previous = knownCost(current?.costo ?? null);
    if (costo !== null && costo !== previous) {
      costUpdates.push({ product: current?.product ?? product, cost: costo, previous });
    }
  }
  return { newProducts, costUpdates };
}
