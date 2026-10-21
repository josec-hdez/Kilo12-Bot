import { describe, expect, it } from 'vitest';
import { FakeSheetsGateway } from '../../src/adapters/sheets/fake-sheets-gateway.js';
import { SqliteCatalogRepository } from '../../src/adapters/sqlite/catalog-repo.js';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import { SqliteSettingsRepository } from '../../src/adapters/sqlite/settings-repo.js';
import { sheetCostRows, syncCatalog, syncCatalogAtStartup } from '../../src/app/catalog-sync.js';
import { registerBook, RegistryCuadreBooks } from '../../src/app/cuadre-books.js';
import type { CuadreSheet } from '../../src/core/types.js';
import type { CuadreReader } from '../../src/ports/cuadre-source.js';

function setup() {
  const db = openDatabase(':memory:');
  return { catalog: new SqliteCatalogRepository(db), settings: new SqliteSettingsRepository(db) };
}

describe('syncCatalog', () => {
  it('agrega productos nuevos y actualiza solo los costos que cambiaron', () => {
    const { catalog } = setup();
    catalog.ensureProduct('pollo');
    catalog.setCost({ product: 'pollo', cost: 800, source: 'seed', changedBy: null });
    catalog.ensureProduct('sal');
    catalog.setCost({ product: 'sal', cost: 500, source: 'seed', changedBy: null });

    const result = syncCatalog(
      catalog,
      [
        { product: 'pollo', costo: 809 },
        { product: 'sal', costo: 500 },
        { product: 'toallitas humedas DOXA', costo: null },
      ],
      'cuadre:2026-10-14',
    );

    expect(result).toEqual({ added: ['toallitas humedas DOXA'], costsUpdated: 1 });
    expect(catalog.findProduct('pollo')?.cost).toBe(809);
    expect(catalog.costHistory('pollo').at(-1)).toMatchObject({
      previousCost: 800,
      cost: 809,
      source: 'cuadre:2026-10-14',
      changedBy: null,
    });
    expect(catalog.costHistory('sal')).toHaveLength(1);
    expect(catalog.findProduct('toallitas humedas DOXA')?.cost).toBeNull();
  });

  it('con costs: false solo agrega productos', () => {
    const { catalog } = setup();
    catalog.ensureProduct('pollo');
    const result = syncCatalog(
      catalog,
      [
        { product: 'pollo', costo: 809 },
        { product: 'bijol', costo: 300 },
      ],
      'cuadre:2026-10-03',
      { costs: false },
    );
    expect(result).toEqual({ added: ['bijol'], costsUpdated: 0 });
    expect(catalog.findProduct('pollo')?.cost).toBeNull();
    expect(catalog.findProduct('bijol')?.cost).toBeNull();
  });

  it('un nombre que ya es equivalencia de otro producto no se crea como producto', () => {
    const { catalog } = setup();
    catalog.ensureProduct('chupachupa');
    catalog.addAlias('chupachupa', 'chupa-chupa');
    const result = syncCatalog(catalog, [{ product: 'chupa-chupa', costo: 65 }], 'cuadre:x');
    expect(result).toEqual({ added: [], costsUpdated: 0 });
    expect(catalog.listProducts().map((product) => product.name)).toEqual(['chupachupa']);
  });
});

describe('sheetCostRows', () => {
  it('toma producto y costo de las filas escritas; un costo vacío es null', () => {
    expect(
      sheetCostRows([
        ['pollo', 809, '=B2*E2'],
        ['  bijol ', '', '=B3*E3'],
        ['', 5],
      ]),
    ).toEqual([
      { product: 'pollo', costo: 809 },
      { product: 'bijol', costo: null },
    ]);
  });
});

describe('syncCatalogAtStartup', () => {
  /** Libro simulado: pestaña → filas `[producto, costo]`. */
  function book(days: Record<string, [string, number | null][]>): CuadreReader {
    const sheet = (tab: string): CuadreSheet => ({
      tabName: tab,
      rows: (days[tab] ?? []).map(([product, costo], index) => ({
        rowNumber: index + 2,
        product,
        costo,
        precio: null,
        inicio: null,
        entradas: null,
        merma: null,
        consumo: null,
        salida: null,
        final: null,
      })) as CuadreSheet['rows'],
      summary: {},
      tc: null,
    });
    return {
      listDays: () => Promise.resolve(Object.keys(days)),
      readDay: (tab) => Promise.resolve(sheet(tab)),
      readDays: (tabs) => Promise.resolve(tabs.map(sheet)),
    };
  }

  const books = (settings: SqliteSettingsRepository, byId: Record<string, CuadreReader>) =>
    new RegistryCuadreBooks(
      settings,
      (id) => ({ sheets: new FakeSheetsGateway(), cuadre: byId[id] ?? book({}) }),
      '2026-10',
    );

  it('usa la última pestaña del libro más reciente', async () => {
    const { catalog, settings } = setup();
    registerBook(settings, '2026-10', 'oct');
    registerBook(settings, '2026-11', 'nov');
    const registry = books(settings, {
      oct: book({ '13': [['pollo', 700]] }),
      nov: book({
        '02': [
          ['pollo', 809],
          ['bijol', 300],
        ],
        '01': [['pollo', 790]],
        _plantilla: [['x', 1]],
      }),
    });

    const result = await syncCatalogAtStartup(catalog, registry, settings);

    expect(result).toEqual({
      added: ['pollo', 'bijol'],
      costsUpdated: 2,
      month: '2026-11',
      tab: '02',
    });
    expect(catalog.findProduct('pollo')?.cost).toBe(809);
    expect(catalog.costHistory('pollo')[0]?.source).toBe('cuadre:2026-11-02');
    // Una segunda vuelta no cambia nada.
    expect(await syncCatalogAtStartup(catalog, registry, settings)).toMatchObject({
      added: [],
      costsUpdated: 0,
    });
  });

  it('un libro sin días se salta y se usa el del mes anterior', async () => {
    const { catalog, settings } = setup();
    registerBook(settings, '2026-10', 'oct');
    registerBook(settings, '2026-11', 'nov');
    const registry = books(settings, { oct: book({ '13': [['pollo', 700]] }), nov: book({}) });
    expect(await syncCatalogAtStartup(catalog, registry, settings)).toMatchObject({
      month: '2026-10',
      tab: '13',
    });
  });

  it('sin libros con días no hace nada', async () => {
    const { catalog, settings } = setup();
    registerBook(settings, '2026-10', 'oct');
    expect(await syncCatalogAtStartup(catalog, books(settings, {}), settings)).toBeNull();
  });
});
