import { ROLE } from '../core/auth.js';
import { buildCostCatalog, type CostSource } from '../core/costs.js';
import type { Equivalence } from '../core/equivalences.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import type {
  CatalogRepository,
  SettingsRepository,
  UserRepository,
} from '../ports/repositories.js';

/**
 * Datos iniciales. Todas las funciones son idempotentes: se pueden correr en cada
 * arranque sin duplicar nada ni pisar lo que las dueñas cambiaron después.
 */

/** Las dueñas de `OWNER_IDS` siempre quedan activas con rol dueño. */
export function seedOwners(users: UserRepository, ownerIds: readonly number[]): void {
  const existing = new Map(users.list().map((user) => [user.telegramId, user]));
  for (const telegramId of ownerIds) {
    users.upsert({
      telegramId,
      name: existing.get(telegramId)?.name ?? null,
      role: ROLE.OWNER,
      active: true,
    });
  }
}

export interface CatalogSeedResult {
  created: number;
  /** Productos que recibieron costo en esta corrida. */
  costed: number;
  /** Productos que siguen sin costo: se marcan en amarillo al armar la hoja. */
  withoutCost: string[];
}

/**
 * Catálogo y costos desde una hoja del cuadre (la fuente de verdad de costos).
 * Usa el nombre exacto del cuadre. Un costo vacío o 0 queda como "sin costo".
 * Nunca pisa un costo que ya existe en la base.
 */
export function seedCatalogFromCuadre(
  catalog: CatalogRepository,
  rows: readonly CostSource[],
  source: string,
): CatalogSeedResult {
  const result: CatalogSeedResult = { created: 0, costed: 0, withoutCost: [] };

  for (const entry of buildCostCatalog(rows).values()) {
    const existing = catalog.findProduct(entry.product);
    const product = existing ?? catalog.ensureProduct(entry.product);
    if (existing === undefined) result.created++;

    if (product.cost === null && entry.costo !== null) {
      catalog.setCost({ product: product.name, cost: entry.costo, source, changedBy: null });
      result.costed++;
    } else if (product.cost === null) {
      result.withoutCost.push(product.name);
    }
  }
  return result;
}

export interface EquivalenceConflict {
  alias: string;
  product: string;
  reason: string;
}

export interface EquivalenceSeedResult {
  createdProducts: string[];
  addedAliases: number;
  /** Alias que ya pertenecen a otro producto: no se tocan, se reportan. */
  conflicts: EquivalenceConflict[];
}

/** Tabla de equivalencias IPV ↔ cuadre. Crea sin costo los productos que falten. */
export function seedEquivalences(
  catalog: CatalogRepository,
  equivalences: readonly Equivalence[],
): EquivalenceSeedResult {
  const result: EquivalenceSeedResult = { createdProducts: [], addedAliases: 0, conflicts: [] };

  for (const { cuadre, ipv } of equivalences) {
    const existing = catalog.findProduct(cuadre);
    const product = existing ?? catalog.ensureProduct(cuadre);
    if (existing === undefined) result.createdProducts.push(product.name);

    for (const alias of ipv) {
      const before = catalog.findProduct(product.name)?.aliases.length ?? 0;
      try {
        catalog.addAlias(product.name, alias);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result.conflicts.push({ alias, product: product.name, reason });
        continue;
      }
      const after = catalog.findProduct(product.name)?.aliases.length ?? 0;
      result.addedAliases += after - before;
    }
  }
  return result;
}

/** Escribe los valores por defecto que falten. */
export function seedSettings(settings: SettingsRepository): void {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (settings.get(key) === undefined) settings.set(key, value);
  }
}

export interface SeedDeps {
  users: UserRepository;
  catalog: CatalogRepository;
  settings: SettingsRepository;
}

/** Filas de la última hoja del cuadre y su origen (queda en el historial de costos). */
export interface CuadreSeedSource {
  rows: readonly CostSource[];
  source: string;
}

export interface SeedInput {
  ownerIds: readonly number[];
  equivalences: readonly Equivalence[];
  /**
   * Sin cuadre, el catálogo y las equivalencias esperan: si las equivalencias se
   * cargaran primero, el producto quedaría con el nombre de la tabla y no con el
   * nombre exacto del cuadre.
   */
  cuadre: CuadreSeedSource | null;
}

export interface SeedSummary {
  catalog: CatalogSeedResult | null;
  equivalences: EquivalenceSeedResult | null;
}

/** Carga inicial en el orden correcto: dueñas, configuración, catálogo y equivalencias. */
export function seedAll(deps: SeedDeps, input: SeedInput): SeedSummary {
  seedOwners(deps.users, input.ownerIds);
  seedSettings(deps.settings);
  if (input.cuadre === null) return { catalog: null, equivalences: null };

  const catalog = seedCatalogFromCuadre(deps.catalog, input.cuadre.rows, input.cuadre.source);
  const equivalences = seedEquivalences(deps.catalog, input.equivalences);
  return { catalog, equivalences };
}
