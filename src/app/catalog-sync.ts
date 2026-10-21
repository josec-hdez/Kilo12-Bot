import { planCatalogSync, type CostSource } from '../core/costs.js';
import type { CuadreBooks } from '../ports/cuadre-books.js';
import type { CatalogRepository, SettingsRepository } from '../ports/repositories.js';
import { readBookRegistry } from './cuadre-books.js';

/**
 * El catálogo de SQLite sigue al cuadre, fuente de verdad de productos y costos: guarda
 * los productos que se escriben en él y los costos que las dueñas cambian a mano. Es el
 * respaldo de costos y la lista de candidatos de las equivalencias.
 */

export interface CatalogSyncResult {
  added: string[];
  costsUpdated: number;
}

/**
 * Aplica al catálogo lo que falta según `rows`. `source` queda en el historial de costos.
 * Con `costs: false` solo agrega productos (filas de un día que no es el más reciente).
 */
export function syncCatalog(
  catalog: CatalogRepository,
  rows: readonly CostSource[],
  source: string,
  { costs = true }: { costs?: boolean } = {},
): CatalogSyncResult {
  const aliases = catalog.listProducts().flatMap((product) => product.aliases);
  const plan = planCatalogSync(catalog.costSources(), rows, aliases);
  for (const product of plan.newProducts) catalog.ensureProduct(product);
  if (!costs) return { added: plan.newProducts, costsUpdated: 0 };
  for (const update of plan.costUpdates) {
    catalog.setCost({ product: update.product, cost: update.cost, source, changedBy: null });
  }
  return { added: plan.newProducts, costsUpdated: plan.costUpdates.length };
}

/** Filas `[producto, costo, …]` que se escriben en una pestaña del día. */
export function sheetCostRows(values: readonly (readonly (string | number)[])[]): CostSource[] {
  return values
    .map(([product, cost]) => ({
      product: typeof product === 'string' ? product.trim() : '',
      costo: typeof cost === 'number' ? cost : null,
    }))
    .filter((row) => row.product !== '');
}

export interface StartupSyncResult extends CatalogSyncResult {
  month: string;
  tab: string;
}

/**
 * Al arrancar: pone el catálogo al día con la última pestaña del libro más reciente.
 * Devuelve null si no hay libro ni pestañas de días.
 */
export async function syncCatalogAtStartup(
  catalog: CatalogRepository,
  books: CuadreBooks,
  settings: SettingsRepository,
): Promise<StartupSyncResult | null> {
  const months = Object.keys(readBookRegistry(settings)).sort();
  for (const month of months.reverse()) {
    const book = books.forMonth(month);
    if (book === null) continue;
    const days = (await book.cuadre.listDays()).filter((tab) => /^\d{1,2}$/.test(tab.trim()));
    const tab = days.sort((a, b) => Number(a) - Number(b)).at(-1);
    if (tab === undefined) continue;
    const sheet = await book.cuadre.readDay(tab);
    const result = syncCatalog(catalog, sheet.rows, `cuadre:${month}-${tab.trim()}`);
    return { ...result, month, tab: tab.trim() };
  }
  return null;
}
