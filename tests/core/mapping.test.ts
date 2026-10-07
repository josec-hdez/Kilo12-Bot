import { describe, expect, it } from 'vitest';
import { EQUIVALENCES } from '../../src/core/equivalences.js';
import {
  MATCH_KIND,
  buildAliasIndex,
  resolveIpvProduct,
  suggestMatches,
} from '../../src/core/mapping.js';

const CATALOG = [
  'aceite',
  'agua  1.5 l',
  'agua 500 ml',
  'papel sanitario',
  'refresco reenvasado',
  'jugo gusto pinneaple',
  'sorbetos joy',
  'sorbetos vitarella',
  'marranetas',
  'totox',
];

describe('tabla de equivalencias', () => {
  const index = buildAliasIndex(EQUIVALENCES);

  it.each([
    ['papel higienico', 'papel sanitario'],
    ['agua pequeña', 'agua 500 ml'],
    ['QUESO  LB ', 'queso blanco'],
    ['pollo lb', 'pollo'],
    ['detergente en polvo STB', 'detergente en polvo'],
    ['sorbeto joy', 'sorbetos joy'],
    ['sorbeto vitarella', 'sorbetos vitarella'],
    ['pellis marranetas', 'marranetas'],
    ['pellis totox', 'totox'],
  ])('traduce "%s" del IPV a "%s" del cuadre', (ipv, cuadre) => {
    expect(resolveIpvProduct(ipv, index, CATALOG)).toMatchObject({
      product: cuadre,
      kind: MATCH_KIND.EQUIVALENCE,
    });
  });

  it('suma refresco cola y naranja dispensado en refresco reenvasado', () => {
    for (const alias of ['refresco cola dispensado', 'refresco naranja dispensado']) {
      expect(resolveIpvProduct(alias, index, CATALOG)?.product).toBe('refresco reenvasado');
    }
  });

  it('usa el nombre del catálogo cuando coincide normalizado (dobles espacios)', () => {
    expect(resolveIpvProduct('agua grande', index, CATALOG)?.product).toBe('agua  1.5 l');
  });

  it('empareja por nombre idéntico cuando no hay equivalencia', () => {
    expect(resolveIpvProduct('Aceite', index, CATALOG)).toEqual({
      product: 'aceite',
      kind: MATCH_KIND.IDENTITY,
    });
  });

  it('no inventa emparejamientos: devuelve null si no hay equivalencia ni nombre idéntico', () => {
    expect(resolveIpvProduct('jugo gusto pineapple', index, CATALOG)).toBeNull();
  });

  it('rechaza un alias del IPV asignado a dos productos distintos', () => {
    expect(() =>
      buildAliasIndex([
        { cuadre: 'a', ipv: ['x'] },
        { cuadre: 'b', ipv: ['x'] },
      ]),
    ).toThrow(/x/);
  });
});

describe('sugerencias por parecido', () => {
  it('sugiere el producto mal escrito, sin asignarlo', () => {
    const [first] = suggestMatches('jugo gusto pineapple', CATALOG);
    expect(first?.product).toBe('jugo gusto pinneaple');
    expect(first?.score).toBeGreaterThanOrEqual(0.8);
  });

  it('sugiere cuando un nombre contiene al otro (ketchup → ketchup vima)', () => {
    const [first] = suggestMatches('ketchup vima', ['ketchup', 'pasta tomate']);
    expect(first?.product).toBe('ketchup');
  });

  it('no sugiere nada si ningún producto se parece', () => {
    expect(suggestMatches('wisky', CATALOG)).toEqual([]);
  });

  it('ordena por puntaje y limita la cantidad', () => {
    const suggestions = suggestMatches('agua 500ml', CATALOG, { limit: 1 });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.product).toBe('agua 500 ml');
  });
});
