import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ExcelIpvSource } from '../../src/adapters/xlsx/excel-ipv-source.js';
import { rowsWithEmptyFinal } from '../../src/core/ipv.js';

const IPV_FIXTURE = fileURLToPath(new URL('../fixtures/IPV KILO 12.xlsx', import.meta.url));

describe('ExcelIpvSource con el IPV real', () => {
  let source: ExcelIpvSource;

  beforeAll(async () => {
    source = await ExcelIpvSource.fromFile(IPV_FIXTURE);
  });

  it('lista solo las pestañas que son días', () => {
    expect(source.listDays()).toEqual([
      { day: 30, month: 9, tabName: '30 sep' },
      { day: 1, month: 10, tabName: '1 oct' },
      { day: 2, month: 10, tabName: '2 oct ' },
      { day: 3, month: 10, tabName: '3 oct' },
      { day: 4, month: 10, tabName: '4 oct' },
    ]);
  });

  it.each([
    [1, 79_150],
    [2, 95_130],
    [3, 90_356],
  ])('lee el IMPORTE TOTAL del %i oct desde el archivo', (day, total) => {
    expect(source.readDay({ day, month: 10 }).importeTotal).toBe(total);
  });

  it('lee las filas del 3 oct con sus columnas', () => {
    const ipv = source.readDay({ day: 3, month: 10 });

    expect(ipv.tabName).toBe('3 oct');
    expect(ipv.rows).toHaveLength(108);
    expect(ipv.rows[0]).toEqual({
      rowNumber: 3,
      product: 'aceite',
      inicial: 2,
      entrada: 4,
      merma: 0,
      consumo: 0,
      salida: 0,
      precio: 3000,
      importe: 0,
      final: 6,
    });
  });

  it('la suma de importes de las filas coincide con el IMPORTE TOTAL', () => {
    const ipv = source.readDay({ day: 3, month: 10 });
    const sum = ipv.rows.reduce((acc, row) => acc + (row.importe ?? 0), 0);

    expect(sum).toBe(ipv.importeTotal);
  });

  it('detecta las 84 filas del 4 oct con existencia y CANT. FINAL vacía', () => {
    const ipv = source.readDay({ day: 4, month: 10 });

    expect(ipv.importeTotal).toBe(895_763.5);
    expect(rowsWithEmptyFinal(ipv)).toHaveLength(84);
  });

  it('no marca finales vacíos en un día bien llenado', () => {
    expect(rowsWithEmptyFinal(source.readDay({ day: 1, month: 10 }))).toHaveLength(0);
  });

  it('resuelve la pestaña "2 oct " con espacio al final', () => {
    expect(source.readDay({ day: 2, month: 10 }).tabName).toBe('2 oct ');
  });

  it('lanza un error claro si el día no existe en el archivo', () => {
    expect(() => source.readDay({ day: 5, month: 10 })).toThrow(/5 oct/);
  });

  it('lista todas las hojas con su nombre exacto, también las que no son días', () => {
    expect(source.listSheets()).toEqual([
      'Hoja1',
      '30 sep',
      'IPV Alf. 30 sep',
      '1 oct',
      '2 oct ',
      '3 oct',
      '4 oct',
    ]);
  });

  it('lee una hoja por su nombre exacto y la asigna al día pedido', () => {
    const day = source.readSheet('3 oct', { day: 3, month: 10 });
    expect(day).toMatchObject({ tabName: '3 oct', day: 3, month: 10, importeTotal: 90356 });
    const alf = source.readSheet('IPV Alf. 30 sep', { day: 30, month: 9 });
    expect(alf).toMatchObject({ tabName: 'IPV Alf. 30 sep', day: 30, month: 9 });
  });

  it('readSheet exige el nombre exacto', () => {
    expect(() => source.readSheet('2 oct', { day: 2, month: 10 })).toThrow(/«2 oct»/);
    expect(() => source.readSheet('3 OCT', { day: 3, month: 10 })).toThrow(/«3 OCT»/);
  });
});
