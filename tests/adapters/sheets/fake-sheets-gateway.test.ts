import { describe, expect, it } from 'vitest';
import { FakeSheetsGateway } from '../../../src/adapters/sheets/fake-sheets-gateway.js';
import { RENDER, YELLOW } from '../../../src/ports/sheets-gateway.js';

describe('FakeSheetsGateway', () => {
  it('duplica una pestaña oculta con sus celdas y la deja visible', async () => {
    const sheets = new FakeSheetsGateway([
      { title: '_plantilla', hidden: true, cells: { C2: '=B2*E2', P4: 'Venta Total' } },
    ]);
    const copy = await sheets.duplicateTab('_plantilla', '03', { hidden: false });

    expect(copy).toMatchObject({ title: '03', hidden: false, index: 1 });
    expect(sheets.cell('03', 'C2')).toBe('=B2*E2');
    expect(await sheets.listTabs()).toHaveLength(2);
  });

  it('lee fórmulas como texto y, con VALUE, deja las fórmulas vacías (no las calcula)', async () => {
    const sheets = new FakeSheetsGateway([{ title: '03', cells: { A2: 'arroz', C2: '=B2*E2' } }]);
    expect(await sheets.readRanges([{ tab: '03', a1: 'A2:C2' }], RENDER.FORMULA)).toEqual([
      [['arroz', '', '=B2*E2']],
    ]);
    expect(await sheets.readRanges([{ tab: '03', a1: 'A2:C2' }], RENDER.VALUE)).toEqual([
      [['arroz']],
    ]);
  });

  it('omite las celdas y filas vacías del final, como Sheets', async () => {
    const sheets = new FakeSheetsGateway([{ title: '03', cells: { A1: 'x' } }]);
    expect(await sheets.readRanges([{ tab: '03', a1: 'A1:C3' }], RENDER.FORMULA)).toEqual([
      [['x']],
    ]);
  });

  it('escribe, borra con "" y rechaza valores que no caben en el rango', async () => {
    const sheets = new FakeSheetsGateway([{ title: '03', cells: { B2: 5 } }]);
    await sheets.writeRanges([{ tab: '03', a1: 'A2:B2', values: [['arroz', '']] }]);
    expect(sheets.cell('03', 'A2')).toBe('arroz');
    expect(sheets.cell('03', 'B2')).toBeUndefined();
    await expect(
      sheets.writeRanges([{ tab: '03', a1: 'A2:A2', values: [['a', 'b']] }]),
    ).rejects.toThrow(/no caben/);
  });

  it('pinta fondos, borra pestañas y simula fallos', async () => {
    const sheets = new FakeSheetsGateway([{ title: '03' }]);
    await sheets.setBackground('03', ['B5'], YELLOW);
    expect(sheets.background('03', 'B5')).toEqual(YELLOW);

    sheets.failNext('deleteTab');
    await expect(sheets.deleteTab('03')).rejects.toThrow(/simulado/);
    await sheets.deleteTab('03');
    expect(await sheets.listTabs()).toEqual([]);
  });

  it('no permite dos pestañas con el mismo nombre', async () => {
    const sheets = new FakeSheetsGateway([{ title: '03' }]);
    await expect(sheets.addTab('03', { hidden: false })).rejects.toThrow(/Ya existe/);
  });
});
