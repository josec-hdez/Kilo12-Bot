import { describe, expect, it } from 'vitest';
import {
  ALIGN,
  compact,
  cup,
  esc,
  MAX_TABLE_WIDTH,
  packMessages,
  pct,
  preLines,
  qty,
  table,
  usd,
} from '../../src/app/report-format.js';

describe('cifras', () => {
  it('CUP redondeado con miles, USD con dos decimales, % con uno', () => {
    expect(cup(181_228.5)).toBe('181,229');
    expect(cup(-0.4)).toBe('0');
    expect(usd(115.8)).toBe('115.80');
    expect(pct(0.34294)).toBe('34.3%');
    expect(pct(null)).toBe('—');
    expect(qty(12.7600001)).toBe('12.76');
    expect(qty(null)).toBe('vacía');
  });

  it('escapa HTML', () => {
    expect(esc('a < b & c')).toBe('a &lt; b &amp; c');
  });
});

describe('table', () => {
  it('alinea columnas dentro de <pre> y recorta nombres largos', () => {
    expect(
      table(
        ['Día', 'Venta'],
        [
          ['01', '78,140'],
          ['Total', '528,462'],
        ],
      ),
    ).toBe('<pre>Día     Venta\n01     78,140\nTotal 528,462</pre>');
    expect(table(['P', 'Venta'], [['cigarro popular de bodega x', '51.0k']])).toBe(
      '<pre>P                        Venta\ncigarro popular de bode… 51.0k</pre>',
    );
  });

  it(`recorta la columna de texto para no pasar de ${String(MAX_TABLE_WIDTH)} caracteres`, () => {
    const html = table(
      ['#', 'Producto', 'Venta', 'Marg'],
      [['1', 'refresco reenvasado de naranja', '19.0k', '25.0%']],
      [ALIGN.RIGHT, ALIGN.LEFT],
    );
    const lines = preLines(html);
    expect(lines).toEqual(['# Producto         Venta  Marg', '1 refresco reenva… 19.0k 25.0%']);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(MAX_TABLE_WIDTH);
  });

  it('una tabla de solo números que no cabe no se recorta (lo detectan las pruebas)', () => {
    const lines = preLines(
      table(['A', 'B'], [['1'.repeat(20), '2'.repeat(20)]], [ALIGN.RIGHT, ALIGN.RIGHT]),
    );
    expect(lines[1]).toBe(`${'1'.repeat(20)} ${'2'.repeat(20)}`);
  });
});

describe('compact', () => {
  it('cifras cortas para las tablas', () => {
    expect(compact(850)).toBe('850');
    expect(compact(78_140)).toBe('78.1k');
    expect(compact(132_796)).toBe('132.8k');
    expect(compact(-43_902)).toBe('-43.9k');
    expect(compact(1_234_567)).toBe('1.2M');
    expect(compact(999_960)).toBe('1.0M');
    expect(compact(0)).toBe('0');
  });
});

describe('packMessages', () => {
  it('junta bloques sin pasar el máximo', () => {
    expect(packMessages(['aaa', 'bbb', 'ccc'], 8)).toEqual(['aaa\n\nbbb', 'ccc']);
  });

  it('una tabla más larga que el máximo se parte cerrando y reabriendo <pre>', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [String(i).padStart(2, '0'), 'x'.repeat(10)]);
    const messages = packMessages(['título', table(['Día', 'Valor'], rows)], 200);
    expect(messages.length).toBeGreaterThan(2);
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(200);
      const opens = message.split('<pre>').length - 1;
      const closes = message.split('</pre>').length - 1;
      expect(opens).toBe(closes);
    }
  });
});
