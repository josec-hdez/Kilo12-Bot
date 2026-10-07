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
