import { describe, expect, it } from 'vitest';
import { rowFormulas } from '../../src/core/cuadre-layout.js';
import type { CuadreRow, CuadreSheet, SheetCellContent } from '../../src/core/types.js';
import {
  FINDING_CODE,
  SEVERITY,
  validateDay,
  validateDays,
  validateTransition,
  type Finding,
} from '../../src/core/validations.js';

const stripEq = (formula: string): string => formula.slice(1);

function row(rowNumber: number, overrides: Partial<CuadreRow>): CuadreRow {
  const f = rowFormulas(rowNumber);
  return {
    rowNumber,
    product: 'producto',
    costo: 50,
    precio: 100,
    inicio: 10,
    entradas: 0,
    merma: 0,
    consumo: 0,
    final: 10,
    salida: null,
    ventaBruta: null,
    formulas: {
      C: stripEq(f.C),
      I: stripEq(f.I),
      K: stripEq(f.K),
      L: stripEq(f.L),
      M: stripEq(f.M),
      N: stripEq(f.N),
    },
    ...overrides,
  };
}

const label = (value: string): SheetCellContent => ({ value, formula: null });
const formula = (text: string, value: number | null = null): SheetCellContent => ({
  value,
  formula: text,
});

/** Resumen correcto, con la Utilidad neta bien formulada y un gasto registrado. */
function goodSummary(): CuadreSheet['summary'] {
  return {
    P2: label('Inversion Inicial'),
    Q2: formula('SUM(C2:C300)'),
    P3: label('Inversion Final'),
    Q3: formula('SUM(M2:M300)'),
    P4: label('Venta Total'),
    Q4: formula('SUM(K2:K300)'),
    P5: label('Costo Total'),
    Q5: formula('SUM(L2:L300)'),
    P6: label('Utilidad Bruta'),
    Q6: formula('Q4-Q5'),
    P8: label('Otros Gastos'),
    P9: label('transporte'),
    Q9: { value: 500, formula: null },
    P13: label('Total'),
    Q13: formula('SUM(Q8:Q12)', 500),
    P14: label('Utilidad'),
    Q14: formula('Q6-Q13'),
  };
}

/** Resumen sin ningún gasto registrado. */
function noExpenses(): CuadreSheet['summary'] {
  return Object.fromEntries(
    Object.entries({ ...goodSummary(), Q13: formula('SUM(Q8:Q12)', 0) }).filter(
      ([address]) => address !== 'P9' && address !== 'Q9',
    ),
  );
}

function sheet(tabName: string, rows: CuadreRow[], extra: Partial<CuadreSheet> = {}): CuadreSheet {
  return { tabName, rows, summary: goodSummary(), tc: 780, ...extra };
}

const codes = (findings: readonly Finding[]) => findings.map((f) => f.code);

describe('validateDay', () => {
  it('no reporta nada en una hoja correcta', () => {
    expect(validateDay(sheet('01', [row(2, {})]))).toEqual([]);
  });

  it('🔴 final vacía con existencia: la fórmula cuenta todo como vendido', () => {
    const [finding] = validateDay(sheet('02', [row(2, { product: 'agua', final: null })]));
    expect(finding).toMatchObject({
      severity: SEVERITY.RED,
      code: FINDING_CODE.EMPTY_FINAL,
      day: '02',
      product: 'agua',
      cell: 'J2',
    });
  });

  it('🔴 producto vendido sin costo o con costo 0', () => {
    const findings = validateDay(
      sheet('03', [
        row(2, { product: 'pollo', costo: 0, final: 4 }),
        row(3, { product: 'fanguito', costo: null, final: 9 }),
      ]),
    );
    expect(findings.map((f) => [f.code, f.product, f.severity])).toEqual([
      [FINDING_CODE.SOLD_WITHOUT_COST, 'pollo', SEVERITY.RED],
      [FINDING_CODE.SOLD_WITHOUT_COST, 'fanguito', SEVERITY.RED],
    ]);
  });

  it('🔴 salida negativa (final mayor que la existencia)', () => {
    expect(codes(validateDay(sheet('01', [row(2, { final: 12 })])))).toEqual([
      FINDING_CODE.NEGATIVE_SALIDA,
    ]);
  });

  it('🔴 costo mayor o igual al precio y 🟡 margen mayor al 70%', () => {
    const findings = validateDay(
      sheet('01', [
        row(2, { product: 'caro', costo: 120, final: 8 }),
        row(3, { product: 'barato', costo: 20, final: 8 }),
      ]),
    );
    expect(findings.map((f) => [f.code, f.product, f.severity])).toEqual([
      [FINDING_CODE.COST_GE_PRICE, 'caro', SEVERITY.RED],
      [FINDING_CODE.HIGH_MARGIN, 'barato', SEVERITY.YELLOW],
    ]);
  });

  it('🟡 entradas y salidas iguales que se compensan', () => {
    const [finding] = validateDay(sheet('01', [row(2, { entradas: 5, final: 10 })]));
    expect(finding).toMatchObject({
      code: FINDING_CODE.ENTRADAS_EQ_SALIDA,
      severity: SEVERITY.YELLOW,
    });
  });

  it('valor escrito a mano donde va fórmula: 🔴 si afecta la venta, 🟡 si afecta la inversión', () => {
    const base = row(2, {});
    const findings = validateDay(
      sheet('04', [row(2, { formulas: { ...base.formulas, C: null, K: null } })]),
    );
    expect(findings.map((f) => [f.code, f.cell, f.severity, f.autoFixable])).toEqual([
      [FINDING_CODE.HANDWRITTEN_VALUE, 'C2', SEVERITY.YELLOW, true],
      [FINDING_CODE.HANDWRITTEN_VALUE, 'K2', SEVERITY.RED, true],
    ]);
  });

  it('🔴 Utilidad = Venta − Gastos en el resumen, con arreglo automático', () => {
    const summary = { ...goodSummary(), Q14: formula('Q4-Q13') };
    const [finding] = validateDay(sheet('01', [row(2, {})], { summary }));
    expect(finding).toMatchObject({
      code: FINDING_CODE.NET_PROFIT_FORMULA,
      severity: SEVERITY.RED,
      cell: 'Q14',
      autoFixable: true,
    });
  });

  it('encuentra el resumen por sus etiquetas aunque esté corrido una fila', () => {
    const shifted: CuadreSheet['summary'] = {
      ...goodSummary(),
      P13: label('transporte 2'),
      Q13: { value: 0, formula: null },
      P14: label('Total'),
      Q14: formula('SUM(Q8:Q13)', 500),
      P15: label('Utilidad'),
      Q15: formula('Q4-Q14'),
    };
    const [finding] = validateDay(sheet('04', [row(2, {})], { summary: shifted }));
    expect(finding).toMatchObject({ code: FINDING_CODE.NET_PROFIT_FORMULA, cell: 'Q15' });
  });

  it('🔴 la suma de la venta no cubre todas las filas de productos', () => {
    const summary = { ...goodSummary(), Q4: formula('SUM(K2:K98)') };
    const findings = validateDay(sheet('05', [row(2, {}), row(104, {})], { summary }));
    expect(findings.map((f) => [f.code, f.cell, f.severity])).toContainEqual([
      FINDING_CODE.SUMMARY_FORMULA,
      'Q4',
      SEVERITY.RED,
    ]);
  });

  it('⚪ día sin gastos registrados y sin TC, cuando hay gastos fijos configurados', () => {
    const findings = validateDay(sheet('01', [row(2, {})], { summary: noExpenses(), tc: null }), {
      hasFixedExpenses: true,
    });
    expect(findings.map((f) => [f.code, f.severity])).toEqual([
      [FINDING_CODE.MISSING_TC, SEVERITY.WHITE],
      [FINDING_CODE.NO_EXPENSES, SEVERITY.WHITE],
    ]);
  });

  it('no reporta el día sin gastos mientras no haya gastos fijos configurados', () => {
    expect(codes(validateDay(sheet('01', [row(2, {})], { summary: noExpenses() })))).toEqual([]);
  });
});

describe('margen mayor al 70%: solo la primera vez o cuando cambia el costo o el precio', () => {
  const barato = (costo: number, precio = 100) =>
    row(2, { product: 'barato', costo, precio, final: 8 });

  it('🟡 lo reporta si el día anterior no tenía el producto', () => {
    const previous = sheet('01', [row(2, { product: 'otro' })]);
    expect(codes(validateDay(sheet('02', [barato(20)]), { previous }))).toEqual([
      FINDING_CODE.HIGH_MARGIN,
    ]);
  });

  it('no lo repite si el costo y el precio no cambiaron', () => {
    const previous = sheet('01', [barato(20)]);
    expect(codes(validateDay(sheet('02', [barato(20)]), { previous }))).toEqual([]);
  });

  it('🟡 lo vuelve a reportar si cambió el costo', () => {
    const previous = sheet('01', [barato(25)]);
    expect(codes(validateDay(sheet('02', [barato(20)]), { previous }))).toEqual([
      FINDING_CODE.HIGH_MARGIN,
    ]);
  });

  it('🟡 lo vuelve a reportar si cambió el precio', () => {
    const previous = sheet('01', [barato(20, 90)]);
    expect(codes(validateDay(sheet('02', [barato(20)]), { previous }))).toEqual([
      FINDING_CODE.HIGH_MARGIN,
    ]);
  });

  it('🟡 lo reporta si el día anterior el producto no tenía existencia ni movimiento', () => {
    const previous = sheet('01', [row(2, { product: 'barato', costo: 20, inicio: 0, final: 0 })]);
    expect(codes(validateDay(sheet('02', [barato(20)]), { previous }))).toEqual([
      FINDING_CODE.HIGH_MARGIN,
    ]);
  });

  it('en un rango solo lo reporta el primer día si nada cambia', () => {
    const findings = validateDays([
      sheet('01', [barato(20)]),
      sheet('02', [barato(20)]),
      sheet('03', [barato(20)]),
    ]);
    expect(findings.filter((f) => f.code === FINDING_CODE.HIGH_MARGIN).map((f) => f.day)).toEqual([
      '01',
    ]);
  });
});

describe('validateTransition', () => {
  it('🟡 continuidad: la final de un día no es la inicial del siguiente', () => {
    const [finding] = validateTransition(
      sheet('01', [row(2, { product: 'refresco reenvasado', inicio: 15, final: 13 })]),
      sheet('02', [row(2, { product: 'refresco reenvasado', inicio: 12, final: 12 })]),
    );
    expect(finding).toMatchObject({
      code: FINDING_CODE.CONTINUITY,
      severity: SEVERITY.YELLOW,
      day: '02',
      product: 'refresco reenvasado',
      cell: 'E2',
    });
  });

  it('🟡 existencia registrada como entrada (inicial 0, entradas = final de ayer)', () => {
    const [finding] = validateTransition(
      sheet('02', [row(2, { product: 'refresco instantaneo', inicio: 94, final: 82 })]),
      sheet('03', [
        row(2, { product: 'refresco instantaneo', inicio: 0, entradas: 82, final: 78 }),
      ]),
    );
    expect(finding).toMatchObject({
      code: FINDING_CODE.EXISTENCE_AS_ENTRADAS,
      severity: SEVERITY.YELLOW,
      day: '03',
      autoFixable: true,
    });
  });

  it('🔴 final en 0 que vendió todo y al día siguiente vuelve a abrir con existencia', () => {
    const [finding] = validateTransition(
      sheet('02', [row(5, { product: 'agua 500 ml', inicio: 18, final: 0 })]),
      sheet('03', [row(5, { product: 'agua 500 ml', inicio: 18, final: 17 })]),
    );
    expect(finding).toMatchObject({
      code: FINDING_CODE.FINAL_ZERO_SOLD_ALL,
      severity: SEVERITY.RED,
      day: '02',
      product: 'agua 500 ml',
      cell: 'J5',
    });
  });

  it('⚪ cambios de precio y de costo', () => {
    const findings = validateTransition(
      sheet('01', [row(2, { product: 'arroz' })]),
      sheet('02', [row(2, { product: 'arroz', precio: 120, costo: 60 })]),
    );
    expect(findings.map((f) => [f.code, f.severity])).toEqual([
      [FINDING_CODE.PRICE_CHANGE, SEVERITY.WHITE],
      [FINDING_CODE.COST_CHANGE, SEVERITY.WHITE],
    ]);
  });

  it('🟡 producto que desaparece con existencia y sugiere el posible renombre', () => {
    const [finding] = validateTransition(
      sheet('02', [row(2, { product: 'refresco reenvasado', final: 16, inicio: 16 })]),
      sheet('03', [row(2, { product: 'refresco dispensado', inicio: 16, final: 6 })]),
    );
    expect(finding).toMatchObject({
      code: FINDING_CODE.DISAPPEARED,
      severity: SEVERITY.YELLOW,
      day: '03',
      product: 'refresco reenvasado',
    });
    expect(finding?.detail).toContain('refresco dispensado');
  });
});
