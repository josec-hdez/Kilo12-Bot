import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';

const CUADRE_FIXTURE = fileURLToPath(
  new URL('../fixtures/Cuadre K12 Remoto.xlsx', import.meta.url),
);

describe('CuadreXlsxReader con el cuadre real', () => {
  let reader: CuadreXlsxReader;

  beforeAll(async () => {
    reader = await CuadreXlsxReader.fromFile(CUADRE_FIXTURE);
  });

  it('lista solo las pestañas de días', () => {
    expect(reader.listDays()).toEqual(['01', '02', '03', '04', '05']);
  });

  it('lee las filas de producto de la hoja 05', () => {
    const sheet = reader.readDay('05');

    expect(sheet.rows).toHaveLength(103);
    expect(sheet.rows[0]).toMatchObject({
      rowNumber: 2,
      product: 'aceite',
      costo: 2600,
      precio: 3000,
      inicio: 8,
      entradas: 0,
      final: 7,
    });
    expect(sheet.rows.at(-1)?.product).toBe('peter max');
  });

  it('expande las fórmulas compartidas por fila', () => {
    const sheet = reader.readDay('05');
    expect(sheet.rows[0]?.formulas.C).toBe('B2*E2');
    expect(sheet.rows[1]?.formulas.I).toBe('E3+F3-G3-H3-J3');
    expect(sheet.rows[1]?.formulas.N).toBe('K3-L3');
  });

  it('distingue costo vacío de costo 0', () => {
    const rows = reader.readDay('05').rows;
    expect(rows.find((r) => r.product === 'fanguito')?.costo).toBeNull();
    expect(rows.find((r) => r.product === 'pollo')?.costo).toBe(0);
  });

  it('lee el resumen P:Q con sus fórmulas y la TC en formato antiguo', () => {
    const sheet = reader.readDay('05');
    expect(sheet.summary.Q4).toEqual({ value: 132_796, formula: 'SUM(K2:K104)' });
    expect(sheet.summary.Q14?.formula).toBe('Q4-Q13');
    expect(sheet.tc).toBe(780);
  });

  it('lee la TC de cada día', () => {
    expect(reader.readDay('01').tc).toBe(765);
  });
});
