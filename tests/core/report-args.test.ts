import { describe, expect, it } from 'vitest';
import { buildAliasIndex } from '../../src/core/mapping.js';
import { EQUIVALENCES } from '../../src/core/equivalences.js';
import {
  DEFAULT_TOP_LIMIT,
  isArgsError,
  parseDay,
  parseProductArgs,
  parseRange,
  parseRequiredRange,
  parseRowArgs,
  parseTop,
  resolveProductQuery,
  RESOLVE_STATUS,
  selectDays,
} from '../../src/core/report-args.js';
import { TOP_METRIC } from '../../src/core/reports.js';

describe('rangos y días', () => {
  it('rango opcional: vacío, dos días, guion o un solo día', () => {
    expect(parseRange('')).toBeNull();
    expect(parseRange('2 4')).toEqual({ from: '02', to: '04' });
    expect(parseRange('02-04')).toEqual({ from: '02', to: '04' });
    expect(parseRange('3')).toEqual({ from: '03', to: '03' });
    expect(isArgsError(parseRange('ayer'))).toBe(true);
  });

  it('/rango exige el rango', () => {
    expect(isArgsError(parseRequiredRange(''))).toBe(true);
    expect(parseRequiredRange('01 05')).toEqual({ from: '01', to: '05' });
  });

  it('día opcional', () => {
    expect(parseDay('')).toBeNull();
    expect(parseDay('3')).toBe('03');
    expect(isArgsError(parseDay('3 oct'))).toBe(true);
  });

  it('selecciona los días del rango en el orden de la hoja', () => {
    const days = ['01', '02', '03', '04', '05'];
    expect(selectDays(days, null)).toEqual(days);
    expect(selectDays(days, { from: '02', to: '04' })).toEqual(['02', '03', '04']);
    expect(selectDays(days, { from: '04', to: '02' })).toEqual(['02', '03', '04']);
    expect(selectDays(days, { from: '02', to: '09' })).toMatchObject({
      message: 'No existe la pestaña 09 en el cuadre.',
    });
  });
});

describe('/top', () => {
  it('valores por defecto y combinaciones', () => {
    expect(parseTop('')).toEqual({
      limit: DEFAULT_TOP_LIMIT,
      metric: TOP_METRIC.VENTA,
      range: null,
    });
    expect(parseTop('5')).toEqual({ limit: 5, metric: TOP_METRIC.VENTA, range: null });
    expect(parseTop('ganancia')).toMatchObject({ metric: TOP_METRIC.UTILIDAD });
    expect(parseTop('5 unidades 02 04')).toEqual({
      limit: 5,
      metric: TOP_METRIC.UNIDADES,
      range: { from: '02', to: '04' },
    });
    expect(parseTop('02 04')).toMatchObject({ limit: DEFAULT_TOP_LIMIT, range: { from: '02' } });
    expect(parseTop('3 01 05')).toMatchObject({ limit: 3, range: { from: '01', to: '05' } });
    expect(isArgsError(parseTop('x y venta'))).toBe(true);
  });
});

describe('/fila y /producto', () => {
  it('/fila: el último número es el día', () => {
    expect(parseRowArgs('pollo 3')).toEqual({ query: 'pollo', day: '03' });
    expect(parseRowArgs('agua 500 ml 02')).toEqual({ query: 'agua 500 ml', day: '02' });
    expect(parseRowArgs('pollo')).toEqual({ query: 'pollo', day: null });
    expect(isArgsError(parseRowArgs(''))).toBe(true);
  });

  it('/producto: rango al final solo con dos números o con guion', () => {
    expect(parseProductArgs('pollo')).toEqual({ query: 'pollo', range: null });
    expect(parseProductArgs('pollo 02 04')).toEqual({
      query: 'pollo',
      range: { from: '02', to: '04' },
    });
    expect(parseProductArgs('pollo 02-04')).toMatchObject({ range: { from: '02', to: '04' } });
    expect(parseProductArgs('agua 500 ml')).toEqual({ query: 'agua 500 ml', range: null });
  });
});

describe('resolveProductQuery', () => {
  const names = [
    'agua  1.5 l',
    'agua 500 ml',
    'pollo',
    'cuadrito de pollo',
    'mayonesa cepera',
    'mayonesa holland park',
  ];
  const aliases = buildAliasIndex(EQUIVALENCES);

  it('nombre exacto, sin importar mayúsculas ni espacios', () => {
    expect(resolveProductQuery('POLLO', names, aliases)).toEqual({
      status: RESOLVE_STATUS.FOUND,
      product: 'pollo',
    });
    expect(resolveProductQuery('agua 1.5 l', names, aliases)).toMatchObject({
      product: 'agua  1.5 l',
    });
  });

  it('varios productos contienen el texto: se elige con botones', () => {
    expect(resolveProductQuery('mayonesa', names, aliases)).toEqual({
      status: RESOLVE_STATUS.CHOOSE,
      options: ['mayonesa cepera', 'mayonesa holland park'],
    });
    expect(resolveProductQuery('cuadrito', names, aliases)).toMatchObject({
      product: 'cuadrito de pollo',
    });
  });

  it('alias del IPV y parecido', () => {
    expect(resolveProductQuery('agua pequeña', names, aliases)).toMatchObject({
      product: 'agua 500 ml',
    });
    expect(resolveProductQuery('poyo', names, aliases)).toMatchObject({
      status: RESOLVE_STATUS.FOUND,
      product: 'pollo',
    });
    expect(resolveProductQuery('xyz', names, aliases)).toEqual({ status: RESOLVE_STATUS.NONE });
  });
});
