import { describe, expect, it } from 'vitest';
import { cup, esc, packMessages, pct, qty, table, usd } from '../../src/app/report-format.js';

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
    expect(table(['P'], [['cigarro popular de bodega x']])).toContain('cigarro popular de …');
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
