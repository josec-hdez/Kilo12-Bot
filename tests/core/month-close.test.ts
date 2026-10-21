import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import { analyzeMonthClose, closeIssues } from '../../src/core/month-close.js';
import { summarizeDay } from '../../src/core/reports.js';
import type { CuadreSheet } from '../../src/core/types.js';
import { FINDING_CODE } from '../../src/core/validations.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const NOV_3 = { year: 2026, month: 11, day: 3 };

let sheets: CuadreSheet[];

beforeAll(async () => {
  const cuadre = await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx'));
  sheets = cuadre.listDays().map((tab) => cuadre.readDay(tab));
});

const analyze = (overrides: Partial<Parameters<typeof analyzeMonthClose>[0]> = {}) =>
  analyzeMonthClose({
    month: '2026-10',
    sheets,
    previousLast: null,
    today: NOV_3,
    hasFixedExpenses: false,
    nextBookRegistered: true,
    ...overrides,
  });

describe('/cierremes: revisión del mes', () => {
  it('suma los días cargados y lista los que faltan del calendario', () => {
    const close = analyze();
    expect(close.period.days.map((d) => d.day)).toEqual(['01', '02', '03', '04', '05']);
    expect(close.missing).toEqual(Array.from({ length: 26 }, (_, i) => i + 6));
  });

  it('el inventario final del último día es la apertura del mes siguiente', () => {
    const close = analyze();
    const last = sheets[sheets.length - 1];
    if (last === undefined) throw new Error('fixture vacía');
    expect(close.lastDay).toBe('05');
    expect(close.openingInventory).toBe(summarizeDay(last).inversionFinal);
  });

  it('junta los productos vendidos sin costo, de mayor a menor venta', () => {
    const close = analyze();
    const expected = new Set(
      sheets.flatMap((sheet) =>
        summarizeDay(sheet).uncosted.map((u) => u.product.replace(/\s+/g, ' ').trim()),
      ),
    );
    expect(new Set(close.uncosted.map((u) => u.product))).toEqual(expected);
    const ventas = close.uncosted.map((u) => u.venta);
    expect(ventas).toEqual([...ventas].sort((a, b) => b - a));
  });

  it('la continuidad del 01 se compara con el último día del mes anterior', () => {
    const last = sheets[sheets.length - 1];
    if (last === undefined) throw new Error('fixture vacía');
    const close = analyze({ previousLast: { ...last, tabName: '30/09' } });
    expect(close.continuity.some((f) => f.day === '01')).toBe(true);
    expect(close.continuity.every((f) => f.code === FINDING_CODE.CONTINUITY)).toBe(true);
    // Los hallazgos del mes anterior no entran en este cierre.
    expect(close.findings.some((f) => f.day === '30/09')).toBe(false);
  });

  it('un mes limpio no tiene pendientes', () => {
    const close = analyze({ nextBookRegistered: false });
    expect(closeIssues(close)).toContain('next_book');
    expect(closeIssues(close)).toContain('missing');
    const clean = {
      ...close,
      missing: [],
      findings: [],
      continuity: [],
      uncosted: [],
      nextBookRegistered: true,
    };
    expect(closeIssues(clean)).toEqual([]);
  });
});
