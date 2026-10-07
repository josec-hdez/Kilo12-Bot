import { describe, expect, it } from 'vitest';
import { buildCuadreDraft } from '../../src/core/cuadre-builder.js';
import { buildCostCatalog } from '../../src/core/costs.js';
import { EQUIVALENCES } from '../../src/core/equivalences.js';
import type { IpvDay, IpvRow } from '../../src/core/types.js';

let nextRow = 3;
const ipvRow = (product: string, overrides: Partial<IpvRow> = {}): IpvRow => ({
  rowNumber: nextRow++,
  product,
  inicial: 0,
  entrada: 0,
  merma: 0,
  consumo: 0,
  salida: 0,
  precio: 100,
  importe: 0,
  final: 0,
  ...overrides,
});

const ipvDay = (rows: IpvRow[]): IpvDay => ({
  day: 3,
  month: 10,
  tabName: '3 oct',
  rows,
  importeTotal: null,
  totalVendidoReal: null,
});

const catalog = buildCostCatalog([
  { product: 'aceite', costo: 2600 },
  { product: 'refresco reenvasado', costo: 750 },
  { product: 'pollo', costo: 0 },
  { product: 'jugo gusto pinneaple', costo: 370 },
]);

describe('buildCuadreDraft', () => {
  it('usa costo del catálogo, precio y cantidades del IPV, y numera desde la fila 2', () => {
    const draft = buildCuadreDraft(
      ipvDay([ipvRow('aceite', { inicial: 2, entrada: 4, precio: 3000, final: 6 })]),
      catalog,
      EQUIVALENCES,
    );

    expect(draft.rows).toHaveLength(1);
    expect(draft.rows[0]).toMatchObject({
      rowNumber: 2,
      product: 'aceite',
      costo: 2600,
      precio: 3000,
      inicio: 2,
      entradas: 4,
      merma: 0,
      consumo: 0,
      final: 6,
      isNew: false,
      missingCost: false,
    });
    expect(draft.rows[0]?.formulas.I).toBe('=E2+F2-G2-H2-J2');
  });

  it('suma refresco cola y naranja dispensado en una sola fila de refresco reenvasado', () => {
    const draft = buildCuadreDraft(
      ipvDay([
        ipvRow('refresco cola dispensado', { inicial: 9, salida: 5, precio: 1000, final: 4 }),
        ipvRow('refresco naranja dispensado', { inicial: 7, salida: 5, precio: 1000, final: 2 }),
      ]),
      catalog,
      EQUIVALENCES,
    );

    expect(draft.rows).toHaveLength(1);
    expect(draft.rows[0]).toMatchObject({
      product: 'refresco reenvasado',
      inicio: 16,
      final: 6,
      precio: 1000,
      sourceIpvProducts: ['refresco cola dispensado', 'refresco naranja dispensado'],
    });
    expect(draft.warnings).toEqual([]);
  });

  it('avisa si los productos sumados tienen precios distintos', () => {
    const draft = buildCuadreDraft(
      ipvDay([
        ipvRow('refresco cola dispensado', { inicial: 9, precio: 1000, final: 4 }),
        ipvRow('refresco naranja dispensado', { inicial: 7, precio: 900, final: 2 }),
      ]),
      catalog,
      EQUIVALENCES,
    );

    expect(draft.warnings).toHaveLength(1);
    expect(draft.warnings[0]).toMatch(/refresco reenvasado/);
  });

  it('omite productos sin existencia ni movimiento', () => {
    const draft = buildCuadreDraft(
      ipvDay([
        ipvRow('azucar energy', { inicial: null, final: null }),
        ipvRow('aceite', { inicial: 1, final: 1 }),
      ]),
      catalog,
      EQUIVALENCES,
    );

    expect(draft.rows.map((r) => r.product)).toEqual(['aceite']);
    expect(draft.omitted).toEqual(['azucar energy']);
  });

  it('conserva la cantidad final vacía (no la convierte en 0)', () => {
    const draft = buildCuadreDraft(
      ipvDay([ipvRow('aceite', { inicial: 3, final: null })]),
      catalog,
      EQUIVALENCES,
    );
    expect(draft.rows[0]?.final).toBeNull();
  });

  it('agrega al final los productos sin emparejar, con costo vacío, amarillo y sugerencias', () => {
    const draft = buildCuadreDraft(
      ipvDay([
        ipvRow('jugo gusto pineapple', { inicial: 12, salida: 1, precio: 550, final: 11 }),
        ipvRow('aceite', { inicial: 1, final: 1 }),
      ]),
      catalog,
      EQUIVALENCES,
    );

    expect(draft.rows.map((r) => r.product)).toEqual(['aceite', 'jugo gusto pineapple']);
    expect(draft.rows[1]).toMatchObject({ rowNumber: 3, isNew: true, costo: null });
    expect(draft.unmatched).toEqual([
      {
        ipvProduct: 'jugo gusto pineapple',
        suggestions: [expect.objectContaining({ product: 'jugo gusto pinneaple' })],
      },
    ]);
    expect(draft.yellowCells).toEqual(['B3']);
  });

  it('marca sin costo los productos con costo 0 en el catálogo y deja la celda vacía', () => {
    const draft = buildCuadreDraft(
      ipvDay([ipvRow('pollo lb', { inicial: null, entrada: 29.61, precio: 950, final: 23.73 })]),
      catalog,
      EQUIVALENCES,
    );

    expect(draft.rows[0]).toMatchObject({ product: 'pollo', costo: null, missingCost: true });
    expect(draft.missingCost).toEqual(['pollo']);
    expect(draft.yellowCells).toEqual(['B2']);
  });

  it('convierte el borrador en filas A:N listas para escribir con USER_ENTERED', () => {
    const draft = buildCuadreDraft(
      ipvDay([ipvRow('aceite', { inicial: 2, entrada: 4, precio: 3000, final: null })]),
      catalog,
      EQUIVALENCES,
    );

    expect(draft.sheetValues).toEqual([
      [
        'aceite',
        2600,
        '=B2*E2',
        3000,
        2,
        4,
        0,
        0,
        '=E2+F2-G2-H2-J2',
        '',
        '=I2*D2',
        '=I2*B2',
        '=J2*B2',
        '=K2-L2',
      ],
    ]);
  });
});
