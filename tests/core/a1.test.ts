import { describe, expect, it } from 'vitest';
import {
  cellAddress,
  columnIndex,
  columnLetter,
  parseCell,
  parseRange,
} from '../../src/core/a1.js';

describe('notación A1', () => {
  it('convierte columnas entre letras e índices (base 0)', () => {
    expect(columnIndex('A')).toBe(0);
    expect(columnIndex('N')).toBe(13);
    expect(columnIndex('AA')).toBe(26);
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(16)).toBe('Q');
    expect(columnLetter(27)).toBe('AB');
  });

  it('lee una celda y la vuelve a escribir', () => {
    expect(parseCell('B12')).toEqual({ column: 1, row: 12 });
    expect(parseCell('q18')).toEqual({ column: 16, row: 18 });
    expect(cellAddress({ column: 1, row: 12 })).toBe('B12');
  });

  it('lee un rango y una celda suelta como rango de 1×1', () => {
    expect(parseRange('A2:N86')).toEqual({
      start: { column: 0, row: 2 },
      end: { column: 13, row: 86 },
    });
    expect(parseRange('Q18')).toEqual({
      start: { column: 16, row: 18 },
      end: { column: 16, row: 18 },
    });
  });

  it('rechaza direcciones inválidas', () => {
    expect(() => parseCell('18Q')).toThrow(/inválida/);
    expect(() => parseRange('A:C')).toThrow(/Rango inválido/);
  });
});
