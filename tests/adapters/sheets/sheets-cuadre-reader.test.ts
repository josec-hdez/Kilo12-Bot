import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetsGateway } from '../../../src/adapters/sheets/fake-sheets-gateway.js';
import { SheetsCuadreReader } from '../../../src/adapters/sheets/sheets-cuadre-reader.js';
import { CuadreFormatError, CUADRE_HEADERS, rowFormulas } from '../../../src/core/cuadre-layout.js';
import type { CellValue } from '../../../src/ports/sheets-gateway.js';

const formulaRow = (n: number): CellValue[] => {
  const f = rowFormulas(n);
  return [f.C, f.I, f.K, f.L, f.M, f.N];
};

/** Fila A:N con valores en A,B,D,E,F,G,H,J y fórmulas en C,I,K,L,M,N. */
function row(
  n: number,
  product: string,
  costo: CellValue,
  precio: number,
  inicio: number,
  final: CellValue,
): CellValue[] {
  const [c, i, k, l, m, nn] = formulaRow(n) as [
    CellValue,
    CellValue,
    CellValue,
    CellValue,
    CellValue,
    CellValue,
  ];
  return [product, costo, c, precio, inicio, 0, 0, 0, i, final, k, l, m, nn];
}

let sheets: FakeSheetsGateway;

beforeEach(async () => {
  sheets = new FakeSheetsGateway();
  await sheets.addTab('_plantilla', { hidden: true });
  await sheets.addTab('03', { hidden: false });
  await sheets.addTab('resumen', { hidden: false });
  await sheets.addTab('04', { hidden: false });
  await sheets.writeRanges([
    { tab: '03', a1: 'A1:N1', values: [[...CUADRE_HEADERS]] },
    {
      tab: '03',
      a1: 'A2:N3',
      values: [row(2, 'arroz', 400, 500, 10, 4), row(3, 'pollo', '', 600, 5, '')],
    },
    {
      tab: '03',
      a1: 'P4:Q18',
      values: [
        ['Venta Total', '=SUM(K2:K300)'],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        ['Utilidad', '=Q4-Q13'],
        [],
        [],
        [],
        ['TC.', 780],
      ],
    },
    { tab: '04', a1: 'A1', values: [['otra cosa']] },
  ]);
});

describe('SheetsCuadreReader', () => {
  it('lista solo las pestañas de días, en orden', async () => {
    expect(await new SheetsCuadreReader(sheets).listDays()).toEqual(['03', '04']);
  });

  it('lee filas, fórmulas sin "=", vacíos como null, resumen y TC', async () => {
    const day = await new SheetsCuadreReader(sheets).readDay('03');
    expect(day.tabName).toBe('03');
    expect(day.rows).toHaveLength(2);
    const [arroz, pollo] = day.rows;
    expect(arroz).toMatchObject({
      rowNumber: 2,
      product: 'arroz',
      costo: 400,
      precio: 500,
      inicio: 10,
      entradas: 0,
      final: 4,
    });
    expect(arroz?.formulas.I).toBe('E2+F2-G2-H2-J2');
    expect(pollo).toMatchObject({ product: 'pollo', costo: null, final: null });
    expect(day.summary.Q4?.formula).toBe('SUM(K2:K300)');
    expect(day.summary.P13).toMatchObject({ value: 'Utilidad', formula: null });
    expect(day.tc).toBe(780);
  });

  it('rechaza una pestaña sin los encabezados del cuadre', async () => {
    await expect(new SheetsCuadreReader(sheets).readDay('04')).rejects.toThrow(CuadreFormatError);
  });

  it('rechaza una pestaña que no existe', async () => {
    await expect(new SheetsCuadreReader(sheets).readDay('09')).rejects.toThrow(CuadreFormatError);
  });
});
