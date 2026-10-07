import { describe, expect, it } from 'vitest';
import { FakeSheetsGateway } from '../../src/adapters/sheets/fake-sheets-gateway.js';
import {
  CONFIG_TAB,
  configGrid,
  ensureTemplate,
  syncConfigTab,
  TEMPLATE_TAB,
} from '../../src/app/sheet-structure.js';
import type { Product } from '../../src/ports/repositories.js';

const product = (overrides: Partial<Product>): Product => ({
  id: 1,
  name: 'arroz',
  cost: 380,
  category: null,
  perishable: false,
  minStock: null,
  aliases: ['arroz el rey'],
  ...overrides,
});

describe('ensureTemplate', () => {
  it('crea _plantilla oculta con el layout del cuadre, fórmulas hasta la fila 300 y Q14 corregida', async () => {
    const sheets = new FakeSheetsGateway();
    expect(await ensureTemplate(sheets)).toEqual({ created: true });

    const [tab] = await sheets.listTabs();
    expect(tab).toMatchObject({ title: TEMPLATE_TAB, hidden: true });
    expect(sheets.cell(TEMPLATE_TAB, 'A1')).toBe(' Producto');
    expect(sheets.cell(TEMPLATE_TAB, 'N1')).toBe('Utilidad');
    expect(sheets.cell(TEMPLATE_TAB, 'C2')).toBe('=B2*E2');
    expect(sheets.cell(TEMPLATE_TAB, 'I300')).toBe('=E300+F300-G300-H300-J300');
    expect(sheets.cell(TEMPLATE_TAB, 'N300')).toBe('=K300-L300');
    expect(sheets.cell(TEMPLATE_TAB, 'C301')).toBeUndefined();
    expect(sheets.cell(TEMPLATE_TAB, 'Q4')).toBe('=SUM(K2:K300)');
    expect(sheets.cell(TEMPLATE_TAB, 'Q14')).toBe('=Q6-Q13');
    expect(sheets.cell(TEMPLATE_TAB, 'P18')).toBe('TC.');
    expect(sheets.cell(TEMPLATE_TAB, 'Q18')).toBeUndefined();
    // Sin columnas nuevas: nada a la derecha de Q.
    expect(sheets.cell(TEMPLATE_TAB, 'R1')).toBeUndefined();
  });

  it('no toca una _plantilla que ya existe', async () => {
    const sheets = new FakeSheetsGateway([
      { title: TEMPLATE_TAB, hidden: true, cells: { A1: 'x' } },
    ]);
    expect(await ensureTemplate(sheets)).toEqual({ created: false });
    expect(sheets.cell(TEMPLATE_TAB, 'A1')).toBe('x');
  });
});

describe('syncConfigTab', () => {
  const at = new Date('2026-10-07T21:00:00Z');

  it('arma nota, encabezados y una fila por producto (costo vacío = celda vacía)', () => {
    const grid = configGrid(
      [product({}), product({ name: 'pollo', cost: null, perishable: true, aliases: [] })],
      at,
    );
    expect(grid[0]?.[0]).toMatch(/no editar/);
    expect(grid[1]).toEqual([
      'Producto',
      'Alias IPV',
      'Costo vigente',
      'Categoría',
      'Perecedero',
      'Existencia mínima',
    ]);
    expect(grid[2]).toEqual(['arroz', 'arroz el rey', 380, '', 'no', '']);
    expect(grid[3]).toEqual(['pollo', '', '', '', 'sí', '']);
  });

  it('crea _config y en la siguiente sincronización la reescribe completa', async () => {
    const sheets = new FakeSheetsGateway();
    await syncConfigTab(sheets, [product({}), product({ name: 'pollo' })], at);
    expect(sheets.cell(CONFIG_TAB, 'A4')).toBe('pollo');

    await syncConfigTab(sheets, [product({ cost: 400 })], at);
    expect(sheets.cell(CONFIG_TAB, 'C3')).toBe(400);
    expect(sheets.cell(CONFIG_TAB, 'A4')).toBeUndefined();
    expect(await sheets.listTabs()).toHaveLength(1);
  });
});
