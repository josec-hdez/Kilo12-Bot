import { describe, expect, it } from 'vitest';
import { computeTotals, salesMatchIpv, utilidadNeta, type TotalsRow } from '../../src/core/calc.js';

const row = (overrides: Partial<TotalsRow>): TotalsRow => ({
  costo: null,
  precio: null,
  inicio: null,
  entradas: null,
  merma: null,
  consumo: null,
  final: null,
  ...overrides,
});

describe('computeTotals', () => {
  it('aplica las fórmulas del cuadre fila por fila', () => {
    const totals = computeTotals([
      row({ costo: 600, precio: 1000, inicio: 10, entradas: 2, merma: 1, final: 6 }),
      row({ costo: 50, precio: 100, inicio: 4, final: 4 }),
    ]);

    // Salida fila 1 = 10 + 2 - 1 - 0 - 6 = 5
    expect(totals).toEqual({
      inversionInicial: 6_200,
      inversionFinal: 3_800,
      ventaTotal: 5_000,
      costoTotal: 3_000,
      utilidadBruta: 2_000,
    });
  });

  it('trata las celdas vacías como 0, igual que la hoja (final vacía = todo vendido)', () => {
    const totals = computeTotals([row({ costo: 10, precio: 20, inicio: 3 })]);
    expect(totals.ventaTotal).toBe(60);
    expect(totals.costoTotal).toBe(30);
  });

  it('redondea a 2 decimales los productos por peso', () => {
    const totals = computeTotals([row({ precio: 950, entradas: 29.61, final: 23.73 })]);
    expect(totals.ventaTotal).toBe(5_586);
  });
});

describe('utilidadNeta', () => {
  it('es Utilidad Bruta − Gastos, nunca Venta − Gastos', () => {
    expect(utilidadNeta({ utilidadBruta: 2_000 }, 500)).toBe(1_500);
  });
});

describe('salesMatchIpv', () => {
  it('acepta diferencias de redondeo de hasta 0.5 CUP', () => {
    expect(salesMatchIpv(90_356.4, 90_356)).toBe(true);
  });

  it('rechaza diferencias reales o un IPV sin total', () => {
    expect(salesMatchIpv(90_456, 90_356)).toBe(false);
    expect(salesMatchIpv(90_356, null)).toBe(false);
  });
});
