import { describe, expect, it } from 'vitest';
import {
  findIpvTab,
  normalizeName,
  parseIpvTabDate,
  parsePosTabDate,
  parsePosTitleDate,
} from '../../src/core/tabs.js';

describe('normalizeName', () => {
  it('quita espacios sobrantes, acentos y mayúsculas', () => {
    expect(normalizeName('  Agua  1.5 L ')).toBe('agua 1.5 l');
    expect(normalizeName('Papel Higiénico')).toBe('papel higienico');
    expect(normalizeName('MERCANCIA ')).toBe('mercancia');
  });
});

describe('parseIpvTabDate', () => {
  it.each([
    ['1 oct', { day: 1, month: 10 }],
    ['2 oct ', { day: 2, month: 10 }],
    ['5 Oct', { day: 5, month: 10 }],
    ['5oct', { day: 5, month: 10 }],
    ['30 sep', { day: 30, month: 9 }],
    ['12 octubre', { day: 12, month: 10 }],
  ])('reconoce %j', (tab, expected) => {
    expect(parseIpvTabDate(tab)).toEqual(expected);
  });

  it.each(['Hoja1', 'IPV Alf. 30 sep', '45 oct', '3 xyz', ''])('ignora %j', (tab) => {
    expect(parseIpvTabDate(tab)).toBeNull();
  });
});

describe('parsePosTabDate', () => {
  it.each([
    ['Turno 18 10-14', { day: 14, month: 10 }],
    ['turno 3 11-02', { day: 2, month: 11 }],
    [' Turno  7  9-30 ', { day: 30, month: 9 }],
  ])('reconoce %j como MM-DD', (tab, expected) => {
    expect(parsePosTabDate(tab)).toEqual(expected);
  });

  it.each(['14 oct', 'Turno 18', 'Turno 18 14-10', 'Turno 18 10-32', 'Hoja1'])(
    'ignora %j',
    (tab) => {
      expect(parsePosTabDate(tab)).toBeNull();
    },
  );
});

describe('parsePosTitleDate', () => {
  it('toma la fecha de inicio del turno', () => {
    expect(parsePosTitleDate('IPV · turno 18 · 2026-10-14 09:03:50 → 2026-10-15 01:10:00')).toEqual(
      { day: 14, month: 10 },
    );
  });

  it.each(['MERCANCIA', 'Venta 2026-10-14', 'IPV del 14 oct', ''])('ignora %j', (title) => {
    expect(parsePosTitleDate(title)).toBeNull();
  });
});

describe('findIpvTab', () => {
  const tabs = ['Hoja1', '30 sep', 'IPV Alf. 30 sep', '1 oct', '2 oct ', '3 oct', '4 oct'];

  it('encuentra la pestaña aunque tenga espacios o mayúsculas distintas', () => {
    expect(findIpvTab(tabs, { day: 2, month: 10 })).toBe('2 oct ');
    expect(findIpvTab(['5 Oct'], { day: 5, month: 10 })).toBe('5 Oct');
  });

  it('no confunde la pestaña "IPV Alf. 30 sep" con la del 30 sep', () => {
    expect(findIpvTab(tabs, { day: 30, month: 9 })).toBe('30 sep');
  });

  it('devuelve null si el día no existe', () => {
    expect(findIpvTab(tabs, { day: 5, month: 10 })).toBeNull();
  });
});
