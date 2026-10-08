import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetsGateway } from '../../src/adapters/sheets/fake-sheets-gateway.js';
import { NotifyingSheetsGateway } from '../../src/adapters/sheets/notifying-sheets-gateway.js';
import { CachedCuadreReader, CUADRE_CACHE_TTL_MS } from '../../src/app/cached-cuadre-reader.js';
import type { CuadreSheet } from '../../src/core/types.js';
import type { CuadreReader } from '../../src/ports/cuadre-source.js';

const sheet = (tabName: string, product: string): CuadreSheet => ({
  tabName,
  rows: [
    {
      rowNumber: 2,
      product,
      costo: 1,
      precio: 2,
      inicio: 1,
      entradas: 0,
      merma: 0,
      consumo: 0,
      final: 0,
      salida: 1,
      ventaBruta: 2,
      invsInicial: 1,
      costoFinal: 1,
      invsFinal: 0,
      utilidad: 1,
      formulas: { C: null, I: null, K: null, L: null, M: null, N: null },
    },
  ],
  summary: {},
  tc: null,
});

/** Lector en memoria que cuenta cuántas veces se le pidió algo. */
class CountingReader implements CuadreReader {
  listCalls = 0;
  readCalls: string[][] = [];
  product = 'arroz';
  days = ['01', '02'];

  listDays(): Promise<string[]> {
    this.listCalls++;
    return Promise.resolve([...this.days]);
  }
  readDay(tabName: string): Promise<CuadreSheet> {
    return this.readDays([tabName]).then(([s]) => s ?? sheet(tabName, this.product));
  }
  readDays(tabNames: readonly string[]): Promise<CuadreSheet[]> {
    this.readCalls.push([...tabNames]);
    return Promise.resolve(tabNames.map((name) => sheet(name, this.product)));
  }
}

let now: number;
let inner: CountingReader;
let cache: CachedCuadreReader;

beforeEach(() => {
  now = Date.parse('2026-10-08T12:00:00Z');
  inner = new CountingReader();
  cache = new CachedCuadreReader(inner, () => new Date(now));
});

describe('CachedCuadreReader', () => {
  it('un segundo reporte dentro de 60 s no vuelve a leer la hoja', async () => {
    await cache.listDays();
    await cache.readDays(['01', '02']);
    now += 30_000;
    expect(await cache.listDays()).toEqual(['01', '02']);
    expect((await cache.readDays(['01', '02'])).map((s) => s.tabName)).toEqual(['01', '02']);
    expect(inner.listCalls).toBe(1);
    expect(inner.readCalls).toEqual([['01', '02']]);
  });

  it('solo pide los días que faltan, todos juntos', async () => {
    await cache.readDays(['01']);
    await cache.readDays(['01', '02', '03']);
    expect(inner.readCalls).toEqual([['01'], ['02', '03']]);
  });

  it('pasados 60 s vuelve a leer', async () => {
    await cache.readDay('01');
    await cache.listDays();
    now += CUADRE_CACHE_TTL_MS;
    inner.product = 'pollo';
    expect((await cache.readDay('01')).rows[0]?.product).toBe('pollo');
    await cache.listDays();
    expect(inner.readCalls).toHaveLength(2);
    expect(inner.listCalls).toBe(2);
  });

  it('invalidate() descarta todo', async () => {
    await cache.readDay('01');
    inner.days = ['01', '02', '03'];
    await cache.listDays();
    cache.invalidate();
    expect(await cache.listDays()).toEqual(['01', '02', '03']);
    await cache.readDay('01');
    expect(inner.readCalls).toHaveLength(2);
  });

  it('no deja modificar la lista guardada desde afuera', async () => {
    const days = await cache.listDays();
    days.push('99');
    expect(await cache.listDays()).toEqual(['01', '02']);
  });
});

describe('NotifyingSheetsGateway + memoria: una escritura vacía la memoria', () => {
  it('después de /ipv (crear pestaña y escribir) el reporte ve el día nuevo', async () => {
    const fake = new FakeSheetsGateway();
    await fake.addTab('01', { hidden: false });
    let notified = 0;
    const gateway = new NotifyingSheetsGateway(fake, () => {
      notified++;
      cache.invalidate();
    });
    const tabs = async () => (await gateway.listTabs()).map((t) => t.title);
    const reader: CuadreReader = {
      listDays: tabs,
      readDay: (tab) => Promise.resolve(sheet(tab, 'x')),
      readDays: (list) => Promise.resolve(list.map((tab) => sheet(tab, 'x'))),
    };
    cache = new CachedCuadreReader(reader, () => new Date(now));

    expect(await cache.listDays()).toEqual(['01']);
    await gateway.duplicateTab('01', '02', { hidden: false });
    await gateway.writeRanges([{ tab: '02', a1: 'A1', values: [['x']] }]);
    expect(notified).toBe(2);
    expect(await cache.listDays()).toEqual(['01', '02']);
  });

  it('leer no vacía la memoria; una escritura que falla sí (pudo cambiar algo)', async () => {
    let notified = 0;
    const gateway = new NotifyingSheetsGateway(new FakeSheetsGateway(), () => {
      notified++;
    });
    await gateway.listTabs();
    await gateway.readRanges([], 'FORMULA');
    expect(notified).toBe(0);
    await expect(gateway.deleteTab('no-existe')).rejects.toThrow();
    expect(notified).toBe(1);
  });
});
