import { describe, expect, it } from 'vitest';
import {
  CUADRE_HEADERS,
  FIRST_DATA_ROW,
  LAST_DATA_ROW,
  parseTc,
  rowFormulas,
  summaryCells,
} from '../../src/core/cuadre-layout.js';

describe('layout del cuadre', () => {
  it('conserva los encabezados originales A:N, incluido el espacio de " Producto"', () => {
    expect(CUADRE_HEADERS).toEqual([
      ' Producto',
      'Costo',
      'Invs inicial',
      'P. Venta',
      'Cant. Inicio',
      'Entradas',
      'Merma',
      'Consumo',
      'Salida',
      'Cant. Final',
      'Venta Bruta',
      'Costo Final',
      'Invs. Final',
      'Utilidad',
    ]);
  });

  it.each([2, 57, 300])('escribe las fórmulas de la fila %i según CLAUDE.md', (n) => {
    expect(rowFormulas(n)).toEqual({
      C: `=B${n}*E${n}`,
      I: `=E${n}+F${n}-G${n}-H${n}-J${n}`,
      K: `=I${n}*D${n}`,
      L: `=I${n}*B${n}`,
      M: `=J${n}*B${n}`,
      N: `=K${n}-L${n}`,
    });
  });

  it('usa el rango amplio 2:300 de la plantilla', () => {
    expect(FIRST_DATA_ROW).toBe(2);
    expect(LAST_DATA_ROW).toBe(300);
  });

  it('arma el resumen P:Q con la utilidad neta corregida y la TC numérica en Q18', () => {
    const cells = Object.fromEntries(summaryCells(780).map((cell) => [cell.address, cell.value]));

    expect(cells).toEqual({
      P2: 'Inversion Inicial',
      Q2: '=SUM(C2:C300)',
      P3: 'Inversion Final',
      Q3: '=SUM(M2:M300)',
      P4: 'Venta Total',
      Q4: '=SUM(K2:K300)',
      P5: 'Costo Total',
      Q5: '=SUM(L2:L300)',
      P6: 'Utilidad Bruta',
      Q6: '=Q4-Q5',
      P8: 'Otros Gastos',
      P13: 'Total',
      Q13: '=SUM(Q8:Q12)',
      P14: 'Utilidad',
      Q14: '=Q6-Q13',
      P18: 'TC.',
      Q18: 780,
    });
  });

  it('deja Q18 vacía si todavía no hay TC', () => {
    const q18 = summaryCells(null).find((cell) => cell.address === 'Q18');
    expect(q18?.value).toBeNull();
  });
});

describe('parseTc', () => {
  it('lee la TC numérica de Q18', () => {
    expect(parseTc('TC.', 780)).toBe(780);
  });

  it.each([
    ['TC. 780', 780],
    ['TC. 765', 765],
    ['tc 1,050', 1050],
    ['TC.780.5', 780.5],
  ])('acepta el formato antiguo "%s" en P18', (text, expected) => {
    expect(parseTc(text, null)).toBe(expected);
  });

  it('devuelve null si no hay TC', () => {
    expect(parseTc('TC.', null)).toBeNull();
    expect(parseTc(null, null)).toBeNull();
  });
});
