import { describe, expect, it } from 'vitest';
import { buildCostCatalog, lookupCost } from '../../src/core/costs.js';

describe('buildCostCatalog', () => {
  const catalog = buildCostCatalog([
    { product: 'agua  1.5 l', costo: 348 },
    { product: 'pollo', costo: 0 },
    { product: 'fanguito', costo: null },
  ]);

  it('busca por nombre normalizado y conserva el nombre original del cuadre', () => {
    expect(lookupCost(catalog, 'Agua 1.5 L')).toEqual({ product: 'agua  1.5 l', costo: 348 });
  });

  it('trata el costo 0 como costo faltante', () => {
    expect(lookupCost(catalog, 'pollo')).toEqual({ product: 'pollo', costo: null });
  });

  it('conserva los productos sin costo', () => {
    expect(lookupCost(catalog, 'fanguito')).toEqual({ product: 'fanguito', costo: null });
  });

  it('devuelve undefined para productos desconocidos', () => {
    expect(lookupCost(catalog, 'wisky')).toBeUndefined();
  });

  it('si un producto se repite, el último costo conocido gana', () => {
    const repeated = buildCostCatalog([
      { product: 'arroz', costo: 600 },
      { product: 'arroz', costo: 659 },
      { product: 'arroz', costo: null },
    ]);
    expect(lookupCost(repeated, 'arroz')?.costo).toBe(659);
  });
});
