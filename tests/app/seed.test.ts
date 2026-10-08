import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteCatalogRepository } from '../../src/adapters/sqlite/catalog-repo.js';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import { SqliteSettingsRepository } from '../../src/adapters/sqlite/settings-repo.js';
import { SqliteUserRepository } from '../../src/adapters/sqlite/users-repo.js';
import { CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import {
  initialCuadreSeed,
  seedAll,
  seedCatalogFromCuadre,
  seedEquivalences,
  seedOwners,
  seedSettings,
} from '../../src/app/seed.js';
import { ROLE } from '../../src/core/auth.js';
import { buildAliasIndex, resolveIpvProduct } from '../../src/core/mapping.js';
import { EQUIVALENCES } from '../../src/core/equivalences.js';
import { DEFAULT_SETTINGS, SETTING } from '../../src/core/settings.js';
import type { CuadreRow } from '../../src/core/types.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

let rows05: CuadreRow[];
let catalog: SqliteCatalogRepository;

beforeAll(async () => {
  const cuadre = await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx'));
  rows05 = cuadre.readDay('05').rows;
});

beforeEach(() => {
  catalog = new SqliteCatalogRepository(openDatabase(':memory:'));
});

describe('seedOwners', () => {
  it('registra las dueñas de OWNER_IDS con rol dueño y respeta el nombre que ya tenían', () => {
    const users = new SqliteUserRepository(openDatabase(':memory:'));
    users.upsert({ telegramId: 10, name: 'Claudia', role: ROLE.CLERK, active: false });
    seedOwners(users, [10, 20]);
    seedOwners(users, [10, 20]);
    expect(users.list()).toEqual([
      { telegramId: 10, name: 'Claudia', role: ROLE.OWNER, active: true },
      { telegramId: 20, name: null, role: ROLE.OWNER, active: true },
    ]);
  });
});

describe('seedCatalogFromCuadre (hoja 05)', () => {
  it('carga los productos con el nombre exacto del cuadre y sus costos', () => {
    const result = seedCatalogFromCuadre(catalog, rows05, 'seed:cuadre-05');
    expect(result.created).toBe(catalog.listProducts().length);
    expect(result.created).toBeGreaterThan(80);
    expect(catalog.findProduct('agua 1.5 l')?.name).toBe('agua  1.5 l');
    expect(catalog.costHistory('arroz')).toMatchObject([{ source: 'seed:cuadre-05' }]);
  });

  it('el pollo (costo 0 en la hoja 05) y los demás sin costo quedan con costo vacío', () => {
    const result = seedCatalogFromCuadre(catalog, rows05, 'seed:cuadre-05');
    expect(catalog.findProduct('pollo')?.cost).toBeNull();
    expect(result.withoutCost).toEqual(
      expect.arrayContaining(['pollo', 'chupachupa', 'fanguito', 'peter biskiato']),
    );
  });

  it('es idempotente y no pisa un costo que ya se cargó con /costo', () => {
    seedCatalogFromCuadre(catalog, rows05, 'seed:cuadre-05');
    catalog.setCost({ product: 'pollo', cost: 420, source: '/costo', changedBy: 1 });
    catalog.setCost({ product: 'arroz', cost: 999, source: '/costo', changedBy: 1 });
    const again = seedCatalogFromCuadre(catalog, rows05, 'seed:cuadre-05');
    expect(again.created).toBe(0);
    expect(catalog.findProduct('pollo')?.cost).toBe(420);
    expect(catalog.findProduct('arroz')?.cost).toBe(999);
  });
});

describe('seedEquivalences', () => {
  it('carga la tabla de CLAUDE.md sin crear duplicados de los productos del cuadre', () => {
    seedCatalogFromCuadre(catalog, rows05, 'seed:cuadre-05');
    const before = catalog.listProducts().length;
    const result = seedEquivalences(catalog, EQUIVALENCES);
    expect(result.conflicts).toEqual([]);
    expect(catalog.findProduct('agua 1.5 l')?.aliases).toEqual(['agua grande']);
    expect(catalog.findProduct('refresco reenvasado')?.aliases).toEqual([
      'refresco cola dispensado',
      'refresco naranja dispensado',
    ]);
    // Solo se crean los productos de la tabla que la hoja 05 no tiene.
    expect(catalog.listProducts().length - before).toBe(result.createdProducts.length);
  });

  it('las equivalencias guardadas emparejan el IPV igual que la tabla del core', () => {
    seedCatalogFromCuadre(catalog, rows05, 'seed:cuadre-05');
    seedEquivalences(catalog, EQUIVALENCES);
    const index = buildAliasIndex(catalog.equivalences());
    expect(resolveIpvProduct('agua grande', index, [])?.product).toBe('agua  1.5 l');
    expect(resolveIpvProduct('zumo de limon', index, [])?.product).toBe('zumo limon');
  });

  it('es idempotente', () => {
    seedEquivalences(catalog, EQUIVALENCES);
    const again = seedEquivalences(catalog, EQUIVALENCES);
    expect(again).toEqual({ createdProducts: [], addedAliases: 0, conflicts: [] });
  });
});

describe('seedSettings', () => {
  it('escribe los valores por defecto sin pisar los que ya cambiaron', () => {
    const settings = new SqliteSettingsRepository(openDatabase(':memory:'));
    settings.set(SETTING.CLOSING_TIME, '21:30');
    seedSettings(settings);
    expect(settings.all()).toEqual({ ...DEFAULT_SETTINGS, [SETTING.CLOSING_TIME]: '21:30' });
  });
});

describe('seedAll', () => {
  it('carga el catálogo antes que las equivalencias: gana el nombre exacto del cuadre', () => {
    const db = openDatabase(':memory:');
    const deps = {
      users: new SqliteUserRepository(db),
      catalog: new SqliteCatalogRepository(db),
      settings: new SqliteSettingsRepository(db),
    };
    const summary = seedAll(deps, {
      ownerIds: [10],
      equivalences: EQUIVALENCES,
      cuadre: { rows: rows05, source: 'seed:cuadre-05' },
    });
    expect(deps.catalog.findProduct('agua 1.5 l')?.name).toBe('agua  1.5 l');
    expect(summary.equivalences?.conflicts).toEqual([]);
    expect(deps.users.list()).toHaveLength(1);
    expect(deps.settings.get(SETTING.INVENTORY_TARGET_DAYS)).toBe(1);
  });

  it('sin cuadre solo carga dueñas y configuración; el catálogo espera', () => {
    const db = openDatabase(':memory:');
    const deps = {
      users: new SqliteUserRepository(db),
      catalog: new SqliteCatalogRepository(db),
      settings: new SqliteSettingsRepository(db),
    };
    const summary = seedAll(deps, { ownerIds: [10, 20], equivalences: EQUIVALENCES, cuadre: null });
    expect(summary).toEqual({ catalog: null, equivalences: null });
    expect(deps.catalog.listProducts()).toEqual([]);
    expect(deps.users.list()).toHaveLength(2);
  });
});

describe('initialCuadreSeed', () => {
  it('usa la última pestaña del cuadre solo si el catálogo está vacío', async () => {
    const cuadre = await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx'));
    const seed = initialCuadreSeed(catalog, cuadre);
    expect(seed?.source).toBe('seed:cuadre-05');
    expect(seed?.rows).toHaveLength(rows05.length);
    expect(initialCuadreSeed(catalog, null)).toBeNull();

    catalog.ensureProduct('arroz');
    expect(initialCuadreSeed(catalog, cuadre)).toBeNull();
  });
});
