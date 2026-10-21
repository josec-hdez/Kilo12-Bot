import { describe, expect, it } from 'vitest';
import {
  buildCostCatalog,
  buildLastKnownCosts,
  cuadreTabsBefore,
  lookupCost,
} from '../../src/core/costs.js';

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

describe('cuadreTabsBefore', () => {
  it('deja solo las pestañas de días anteriores, de la más vieja a la más nueva', () => {
    expect(cuadreTabsBefore(['13', '01', '_plantilla', '14', ' 02 ', '12', '15'], 14)).toEqual([
      '01',
      '02',
      '12',
      '13',
    ]);
  });

  it('el primer día del mes no tiene pestañas anteriores', () => {
    expect(cuadreTabsBefore(['01', '02'], 1)).toEqual([]);
  });
});

describe('buildLastKnownCosts', () => {
  it('el cuadre pisa al catálogo y gana el día más reciente con costo', () => {
    const costs = buildLastKnownCosts(
      [{ product: 'pollo', costo: 700 }],
      [[{ product: 'pollo', costo: 780 }], [{ product: 'Pollo', costo: 809 }]],
    );
    expect(lookupCost(costs, 'pollo')).toEqual({ product: 'Pollo', costo: 809 });
  });

  it('un día sin el producto o con costo vacío o 0 no borra el último costo conocido', () => {
    const costs = buildLastKnownCosts(
      [],
      [
        [{ product: 'fanguito', costo: 865 }],
        [],
        [{ product: 'fanguito', costo: null }],
        [{ product: 'fanguito', costo: 0 }],
      ],
    );
    expect(lookupCost(costs, 'fanguito')?.costo).toBe(865);
  });

  it('si el cuadre nunca tuvo costo, usa el del catálogo', () => {
    const costs = buildLastKnownCosts(
      [{ product: 'ron havana club', costo: 2000 }],
      [[{ product: 'ron havana club', costo: null }]],
    );
    expect(lookupCost(costs, 'ron havana club')?.costo).toBe(2000);
  });

  it('suma los productos que solo están en el cuadre', () => {
    const costs = buildLastKnownCosts([], [[{ product: 'azucar campofino', costo: 1080 }]]);
    expect(lookupCost(costs, 'azucar campofino')?.costo).toBe(1080);
  });
});
