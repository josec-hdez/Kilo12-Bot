import { asc, eq, sql } from 'drizzle-orm';
import type { CostSource } from '../../core/costs.js';
import type { Equivalence } from '../../core/equivalences.js';
import { normalizeName } from '../../core/tabs.js';
import type {
  CatalogRepository,
  CostChange,
  CostHistoryEntry,
  Product,
} from '../../ports/repositories.js';
import type { Database } from './db.js';
import { costHistory, productAliases, products } from './schema.js';

type ProductRow = typeof products.$inferSelect;

/** Un costo 0 o negativo no es un costo real: el producto queda "sin costo". */
const knownCost = (cost: number | null): number | null => (cost !== null && cost > 0 ? cost : null);

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export class SqliteCatalogRepository implements CatalogRepository {
  constructor(private readonly db: Database) {}

  listProducts(): Product[] {
    const aliases = this.aliasesByProduct();
    return this.db
      .select()
      .from(products)
      .orderBy(asc(products.id))
      .all()
      .map((row) => this.toProduct(row, aliases.get(row.id) ?? []));
  }

  findProduct(name: string): Product | undefined {
    const row = this.findRow(name);
    if (row === undefined) return undefined;
    return this.toProduct(row, this.aliasesByProduct().get(row.id) ?? []);
  }

  ensureProduct(name: string): Product {
    const normalizedName = normalizeName(name);
    if (normalizedName === '') throw new Error('El nombre del producto está vacío.');
    this.db.insert(products).values({ name, normalizedName }).onConflictDoNothing().run();
    const product = this.findProduct(name);
    if (product === undefined) throw new Error(`No se pudo crear el producto "${name}".`);
    return product;
  }

  addAlias(product: string, alias: string): void {
    const target = this.requireRow(product);
    const normalizedAlias = normalizeName(alias);
    const existing = this.db
      .select({ productId: productAliases.productId, owner: products.name })
      .from(productAliases)
      .innerJoin(products, eq(products.id, productAliases.productId))
      .where(eq(productAliases.normalizedAlias, normalizedAlias))
      .get();

    if (existing !== undefined) {
      if (existing.productId === target.id) return;
      throw new Error(`El alias "${alias}" ya pertenece a "${existing.owner}".`);
    }
    this.db.insert(productAliases).values({ productId: target.id, alias, normalizedAlias }).run();
  }

  setCost(change: CostChange): void {
    const row = this.requireRow(change.product);
    const cost = knownCost(change.cost);
    this.db.transaction((tx) => {
      tx.update(products).set({ cost, updatedAt: nowIso }).where(eq(products.id, row.id)).run();
      tx.insert(costHistory)
        .values({
          productId: row.id,
          previousCost: row.cost,
          cost,
          source: change.source,
          changedBy: change.changedBy,
        })
        .run();
    });
  }

  costHistory(product: string): CostHistoryEntry[] {
    const row = this.requireRow(product);
    return this.db
      .select({
        previousCost: costHistory.previousCost,
        cost: costHistory.cost,
        source: costHistory.source,
        changedBy: costHistory.changedBy,
        at: costHistory.at,
      })
      .from(costHistory)
      .where(eq(costHistory.productId, row.id))
      .orderBy(asc(costHistory.id))
      .all();
  }

  equivalences(): Equivalence[] {
    return this.listProducts()
      .filter((product) => product.aliases.length > 0)
      .map((product) => ({ cuadre: product.name, ipv: product.aliases }));
  }

  costSources(): CostSource[] {
    return this.db
      .select({ product: products.name, costo: products.cost })
      .from(products)
      .orderBy(asc(products.id))
      .all();
  }

  private findRow(name: string): ProductRow | undefined {
    return this.db
      .select()
      .from(products)
      .where(eq(products.normalizedName, normalizeName(name)))
      .get();
  }

  private requireRow(name: string): ProductRow {
    const row = this.findRow(name);
    if (row === undefined) throw new Error(`El producto "${name}" no está en el catálogo.`);
    return row;
  }

  private aliasesByProduct(): Map<number, string[]> {
    const map = new Map<number, string[]>();
    for (const { productId, alias } of this.db
      .select({ productId: productAliases.productId, alias: productAliases.alias })
      .from(productAliases)
      .orderBy(asc(productAliases.id))
      .all()) {
      map.set(productId, [...(map.get(productId) ?? []), alias]);
    }
    return map;
  }

  private toProduct(row: ProductRow, aliases: string[]): Product {
    return {
      id: row.id,
      name: row.name,
      cost: row.cost,
      category: row.category,
      perishable: row.perishable,
      minStock: row.minStock,
      aliases,
    };
  }
}
