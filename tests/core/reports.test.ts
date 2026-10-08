import { describe, expect, it } from 'vitest';
import {
  adjustedProfit,
  aggregateProducts,
  expensesOf,
  marginReport,
  productRow,
  productTotals,
  summarizeDay,
  summarizePeriod,
  TOP_METRIC,
  topProducts,
} from '../../src/core/reports.js';
import type { CuadreRow, CuadreSheet, SheetCellContent } from '../../src/core/types.js';

function row(product: string, overrides: Partial<CuadreRow> = {}): CuadreRow {
  return {
    rowNumber: 2,
    product,
    costo: 50,
    precio: 100,
    inicio: 10,
    entradas: 0,
    merma: 0,
    consumo: 0,
    final: 8,
    salida: null,
    ventaBruta: null,
    invsInicial: null,
    costoFinal: null,
    invsFinal: null,
    utilidad: null,
    formulas: { C: null, I: null, K: null, L: null, M: null, N: null },
    ...overrides,
  };
}

const label = (value: string): SheetCellContent => ({ value, formula: null });
const amount = (value: number): SheetCellContent => ({ value, formula: null });

function sheet(
  tabName: string,
  rows: CuadreRow[],
  summary: CuadreSheet['summary'] = {},
  tc: number | null = 800,
): CuadreSheet {
  return {
    tabName,
    rows,
    summary: { P8: label('Otros Gastos'), P13: label('Total'), ...summary },
    tc,
  };
}

describe('expensesOf', () => {
  it('suma los gastos entre "Otros Gastos" y "Total", con su concepto', () => {
    const s = sheet('01', [], { P9: label('transporte'), Q9: amount(500), Q8: amount(100) });
    expect(expensesOf(s)).toEqual({
      found: true,
      total: 600,
      items: [
        { concept: 'sin concepto', amount: 100, cell: 'Q8' },
        { concept: 'transporte', amount: 500, cell: 'Q9' },
      ],
    });
  });

  it('busca las etiquetas por texto (resumen corrido una fila)', () => {
    const s: CuadreSheet = {
      tabName: '04',
      rows: [],
      summary: {
        P9: label('Otros Gastos'),
        P14: label('Total'),
        Q13: amount(300),
        Q14: amount(999),
      },
      tc: null,
    };
    expect(expensesOf(s).total).toBe(300);
  });

  it('sin la sección de gastos, no se conocen', () => {
    expect(expensesOf({ tabName: '01', rows: [], summary: {}, tc: null })).toEqual({
      found: false,
      total: 0,
      items: [],
    });
  });
});

describe('summarizeDay', () => {
  it('recalcula desde las entradas y separa venta, costo, utilidad bruta y neta', () => {
    // Vende 2 a 100 con costo 50; un producto sin costo vende 1 a 300.
    const day = summarizeDay(
      sheet(
        '03',
        [
          row('arroz', { entradas: 4 }),
          row('pollo', { costo: null, precio: 300, inicio: 5, final: 4 }),
        ],
        { Q9: amount(100) },
      ),
    );
    // arroz: salida 10+4−8 = 6 → venta 600, costo 300.
    expect(day).toMatchObject({
      day: '03',
      venta: 900,
      costo: 300,
      utilidadBruta: 600,
      utilidadNeta: 500,
      compras: 200,
      ventaSinCosto: 300,
      ventaConCosto: 600,
      utilidadConCosto: 300,
      uncosted: [{ product: 'pollo', units: 1, venta: 300 }],
    });
    expect(day.margen).toBeCloseTo(600 / 900);
  });

  it('no usa los valores guardados por la hoja', () => {
    const day = summarizeDay(sheet('01', [row('arroz', { ventaBruta: 999_999, utilidad: 1 })]));
    expect(day.venta).toBe(200);
  });
});

describe('summarizePeriod', () => {
  const d1 = summarizeDay(sheet('01', [row('a', { final: 9 })], {}, 800)); // venta 100, UB 50
  const d2 = summarizeDay(
    sheet('02', [row('a', { costo: 90, final: 0 })], { Q9: amount(100) }, null),
  ); // venta 1000, costo 900, UB 100, UN 0

  it('suma, promedia los márgenes de dos formas y elige el mejor y el peor día', () => {
    const period = summarizePeriod([d1, d2]);
    expect(period).toMatchObject({
      venta: 1100,
      costo: 950,
      utilidadBruta: 150,
      gastos: 100,
      utilidadNeta: 50,
    });
    expect(period.margenSimple).toBeCloseTo((0.5 + 0.1) / 2);
    expect(period.margenPonderado).toBeCloseTo(150 / 1100);
    expect(period.best?.day).toBe('01');
    expect(period.worst?.day).toBe('02');
  });

  it('convierte a USD solo los días con TC', () => {
    const period = summarizePeriod([d1, d2]);
    expect(period.usd).toEqual({
      venta: 0.13,
      utilidadBruta: 0.06,
      utilidadNeta: 0.06,
      daysWithoutTc: ['02'],
    });
  });
});

describe('adjustedProfit', () => {
  it('estima la utilidad de la venta sin costo con el margen de los productos con costo', () => {
    const day = summarizeDay(
      sheet('01', [
        row('a', { final: 0 }), // venta 1000, costo 500 → 50%
        row('b', { costo: null, final: 0 }), // venta 1000 sin costo
      ]),
    );
    const adjusted = adjustedProfit(summarizePeriod([day]));
    expect(adjusted.segunHojas).toBe(1500);
    expect(adjusted.margenReferencia).toBeCloseTo(0.5);
    expect(adjusted.central).toBe(1000);
    expect(adjusted.bajo).toBe(1000);
    expect(adjusted.alto).toBe(1000);
  });
});

describe('productRow', () => {
  it('recalcula toda la fila y marca lo que la hoja guarda distinto', () => {
    const report = productRow(
      sheet('04', [row('mantequilla Soya', { inicio: 11, final: 11, invsInicial: 0 })]),
      'MANTEQUILLA  soya',
    );
    const field = (key: string) => report?.fields.find((f) => f.key === key);
    expect(report?.product).toBe('mantequilla Soya');
    expect(field('invsInicial')).toMatchObject({ value: 550, stored: 0, differs: true });
    expect(field('salida')).toMatchObject({ value: 0, differs: false });
  });

  it('producto que no está en la hoja', () => {
    expect(productRow(sheet('01', []), 'pollo')).toBeNull();
  });
});

describe('productTotals', () => {
  it('suma las filas de todos los días y lista cambios de precio y días sin el producto', () => {
    const totals = productTotals(
      [
        sheet('01', [row('arroz', { inicio: 5, final: 5 })]),
        sheet('02', [row('arroz', { inicio: 5, entradas: 4, final: 7 })]),
        sheet('03', []),
        sheet('04', [row('arroz', { inicio: 7, final: 5, precio: 120 })]),
      ],
      'arroz',
    );
    expect(totals).toMatchObject({
      entradas: 4,
      unidades: 4,
      venta: 440,
      costo: 200,
      utilidad: 240,
      missingDays: ['03'],
      priceChanges: [{ day: '04', from: 100, to: 120 }],
      costChanges: [],
      stock: 5,
      ventaDiaria: 1,
      diasInventario: 5,
    });
  });
});

describe('ranking y márgenes', () => {
  const products = aggregateProducts([
    sheet('01', [
      row('a', { final: 0, costo: 95 }), // 10 u, margen 5%
      row('b', { final: 9 }), // 1 u, margen 50%
      row('c', { costo: null, final: 5 }), // 5 u, sin costo
    ]),
  ]);

  it('top por venta, utilidad y unidades', () => {
    expect(topProducts(products, TOP_METRIC.VENTA, 2).map((p) => p.product)).toEqual(['a', 'c']);
    expect(topProducts(products, TOP_METRIC.UTILIDAD, 1).map((p) => p.product)).toEqual(['c']);
    expect(topProducts(products, TOP_METRIC.UNIDADES, 3).map((p) => p.product)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('alerta alta rotación con margen < 15% y separa los productos sin costo', () => {
    const report = marginReport(products);
    expect(report.ranked.map((p) => p.product)).toEqual(['a', 'b']);
    expect(report.lowMarginHighRotation.map((p) => p.product)).toEqual(['a']);
    expect(report.withoutCost.map((p) => p.product)).toEqual(['c']);
  });
});
