import { describe, expect, it } from 'vitest';
import {
  SUMMARY_DAYS,
  SUMMARY_HEADERS,
  SUMMARY_TOTAL_ROW,
  summaryTabGrid,
  summaryTabRange,
} from '../../src/core/month-summary.js';

describe('pestaña Resumen', () => {
  const grid = summaryTabGrid();

  it('tiene encabezados, 31 días y una fila de totales en A1:J33', () => {
    expect(summaryTabRange()).toBe('A1:J33');
    expect(grid).toHaveLength(1 + SUMMARY_DAYS + 1);
    expect(grid[0]).toEqual([...SUMMARY_HEADERS]);
    expect(grid.every((row) => row.length === SUMMARY_HEADERS.length)).toBe(true);
    expect(grid.slice(1, 1 + SUMMARY_DAYS).map((row) => row[0])).toEqual(
      Array.from({ length: SUMMARY_DAYS }, (_, i) => i + 1),
    );
    expect(SUMMARY_TOTAL_ROW).toBe(33);
  });

  it('cada día lee su pestaña con INDIRECT y queda en blanco si no existe', () => {
    const day3 = grid[3] ?? [];
    expect(day3[1]).toBe(`=IFERROR(INDIRECT("'"&TEXT($A4,"00")&"'!Q4"),"")`);
    expect(day3[2]).toContain(`'!Q5"`);
    expect(day3[3]).toContain(`'!Q6"`);
    expect(day3[5]).toContain(`'!Q13"`);
    expect(day3[6]).toContain(`'!Q14"`);
    expect(day3[7]).toContain(`'!Q18"`);
    expect(day3[9]).toContain(`'!Q3"`);
  });

  it('margen y USD se calculan en la fila, sin dividir entre cero', () => {
    const day3 = grid[3] ?? [];
    expect(day3[4]).toBe('=IF(AND(ISNUMBER(B4),B4<>0),ROUND(D4/B4*100,1),"")');
    expect(day3[8]).toBe('=IF(AND(ISNUMBER(B4),ISNUMBER(H4),H4>0),ROUND(B4/H4,2),"")');
  });

  it('totales: sumas, margen de los totales, USD sumado y la inversión del último día', () => {
    const total = grid[SUMMARY_TOTAL_ROW - 1] ?? [];
    expect(total[0]).toBe('Total');
    expect(total[1]).toBe('=SUM(B2:B32)');
    expect(total[4]).toBe('=IF(B33<>0,ROUND(D33/B33*100,1),"")');
    expect(total[7]).toBe('');
    expect(total[8]).toBe('=SUM(I2:I32)');
    expect(total[9]).toBe('=IFERROR(INDEX(FILTER(J2:J32,J2:J32<>""),COUNT(J2:J32)),"")');
  });
});
