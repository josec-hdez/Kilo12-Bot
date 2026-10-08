import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import { ExcelIpvSource } from '../../src/adapters/xlsx/excel-ipv-source.js';
import { SALES_CHECK, checkIpvSales, computeTotals } from '../../src/core/calc.js';
import { buildCostCatalog } from '../../src/core/costs.js';
import { buildCuadreDraft } from '../../src/core/cuadre-builder.js';
import { EQUIVALENCES } from '../../src/core/equivalences.js';
import type { CuadreSheet } from '../../src/core/types.js';
import {
  FINDING_CODE,
  SEVERITY,
  ipvLoadBlockers,
  validateDays,
  validateIpv,
  type Finding,
} from '../../src/core/validations.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/**
 * Criterio 3: /validar sobre los días 01–05 del cuadre original (copia sin corregir,
 * tal como llegó en Downloads).
 */
describe('validaciones sobre el cuadre real 01–05', () => {
  let sheets: CuadreSheet[];
  let findings: Finding[];

  const find = (code: string, day: string, product?: string) =>
    findings.find(
      (f) => f.code === code && f.day === day && (product === undefined || f.product === product),
    );

  beforeAll(async () => {
    const cuadre = await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx'));
    sheets = cuadre.listDays().map((day) => cuadre.readDay(day));
    findings = validateDays(sheets);
  });

  it('lee las cinco hojas, incluida la TC de la 04 que está corrida a P19', () => {
    expect(sheets.map((s) => [s.tabName, s.tc])).toEqual([
      ['01', 765],
      ['02', 775],
      ['03', 780],
      ['04', 785],
      ['05', 780],
    ]);
  });

  it('🔴 detecta la Utilidad mal formulada (Venta − Gastos) en todas las hojas', () => {
    const wrong = findings.filter((f) => f.code === FINDING_CODE.NET_PROFIT_FORMULA);
    expect(wrong.map((f) => [f.day, f.cell, f.severity])).toEqual([
      ['01', 'Q14', SEVERITY.RED],
      ['02', 'Q14', SEVERITY.RED],
      ['03', 'Q14', SEVERITY.RED],
      ['04', 'Q15', SEVERITY.RED],
      ['05', 'Q14', SEVERITY.RED],
    ]);
  });

  it('🔴 detecta el agua de 500 ml del 02: final en 0 que cuenta las 18 como vendidas', () => {
    // En el archivo, J5 del 02 tiene un 0 (no está vacía) y el 03 vuelve a abrir con 18.
    expect(find(FINDING_CODE.FINAL_ZERO_SOLD_ALL, '02', 'agua 500 ml')).toMatchObject({
      severity: SEVERITY.RED,
      cell: 'J5',
    });
  });

  it('🟡 detecta existencias del 03 registradas como entradas', () => {
    const asEntradas = findings
      .filter((f) => f.code === FINDING_CODE.EXISTENCE_AS_ENTRADAS && f.day === '03')
      .map((f) => f.product);
    expect(asEntradas).toEqual(
      expect.arrayContaining(['refresco cola lata', 'refresco instantaneo', 'refresco limon lata']),
    );
  });

  it('🔴 detecta el pollo vendido sin costo', () => {
    expect(find(FINDING_CODE.SOLD_WITHOUT_COST, '03', 'pollo')?.severity).toBe(SEVERITY.RED);
    expect(find(FINDING_CODE.SOLD_WITHOUT_COST, '05', 'pollo')?.severity).toBe(SEVERITY.RED);
  });

  it('🟡 detecta la diferencia de continuidad 01→02 del refresco reenvasado (13 → 12)', () => {
    const finding = find(FINDING_CODE.CONTINUITY, '02', 'refresco reenvasado');
    expect(finding?.severity).toBe(SEVERITY.YELLOW);
    expect(finding?.detail).toContain('13');
    expect(finding?.detail).toContain('12');
  });

  it('🟡 detecta que el 03 renombró "refresco reenvasado" como "refresco dispensado"', () => {
    expect(find(FINDING_CODE.DISAPPEARED, '03', 'refresco reenvasado')?.detail).toContain(
      'refresco dispensado',
    );
  });

  it('🟡 detecta el valor escrito a mano en la inversión de mantequilla Soya (04)', () => {
    expect(find(FINDING_CODE.HANDWRITTEN_VALUE, '04', 'mantequilla Soya')).toMatchObject({
      cell: 'C60',
      severity: SEVERITY.YELLOW,
    });
  });

  it('🟡 margen mayor al 70%: solo la primera vez que aparece cada producto', () => {
    const highMargin = findings.filter((f) => f.code === FINDING_CODE.HIGH_MARGIN);
    expect(highMargin.map((f) => [f.day, f.product])).toEqual([
      ['01', 'cigarro popular de bodega'],
      ['03', 'cigarro popular rojo'],
    ]);
  });

  it('sin gastos fijos configurados no reporta los días sin gastos', () => {
    expect(findings.some((f) => f.code === FINDING_CODE.NO_EXPENSES)).toBe(false);
    const withFixed = validateDays(sheets, { hasFixedExpenses: true });
    expect(withFixed.filter((f) => f.code === FINDING_CODE.NO_EXPENSES)).toHaveLength(5);
  });

  it('criterio 4: la utilidad bruta sumada 01–05 es 181,228.5 (≈ 181,229)', () => {
    const total = sheets.reduce((sum, s) => sum + computeTotals(s.rows).utilidadBruta, 0);
    expect(total).toBe(181_228.5);
  });
});

describe('IPV del 4 oct (finales vacías)', () => {
  it('🔴 reporta las 84 finales vacías y bloquea la carga', async () => {
    const source = await ExcelIpvSource.fromFile(fixture('IPV KILO 12.xlsx'));
    const cuadre = await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx'));
    const ipv = source.readDay({ day: 4, month: 10 });

    const ipvFindings = validateIpv(ipv);
    const emptyFinals = ipvFindings.filter((f) => f.code === FINDING_CODE.EMPTY_FINAL);
    expect(emptyFinals).toHaveLength(84);
    expect(emptyFinals.every((f) => f.severity === SEVERITY.RED)).toBe(true);

    const draft = buildCuadreDraft(ipv, buildCostCatalog(cuadre.readDay('05').rows), EQUIVALENCES);
    const sales = checkIpvSales(draft.rows, ipv.importeTotal);
    const blockers = ipvLoadBlockers(ipvFindings, sales);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.some((b) => b.code === FINDING_CODE.EMPTY_FINAL)).toBe(true);
    // La venta cuadra con el IPV porque ambos cuentan las finales vacías como vendidas:
    // por eso el bloqueo viene de la validación, no de la comparación de ventas.
    expect(sales.status).toBe(SALES_CHECK.MATCH);
  });

  it('el IPV del 3 oct no tiene bloqueos', async () => {
    const source = await ExcelIpvSource.fromFile(fixture('IPV KILO 12.xlsx'));
    const cuadre = await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx'));
    const ipv = source.readDay({ day: 3, month: 10 });
    const draft = buildCuadreDraft(ipv, buildCostCatalog(cuadre.readDay('05').rows), EQUIVALENCES);
    expect(ipvLoadBlockers(validateIpv(ipv), checkIpvSales(draft.rows, ipv.importeTotal))).toEqual(
      [],
    );
  });
});
