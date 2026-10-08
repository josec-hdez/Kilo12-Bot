import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { asCuadreReader, CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import {
  completeProductRequest,
  dayReport,
  expensesReport,
  inventoryReport,
  marginsDiffer,
  marginsReport,
  monthDays,
  monthReport,
  productReport,
  profitReport,
  rangeReport,
  REPORT_KIND,
  rowReport,
  todayReport,
  topReport,
  weekReport,
  type ReportDeps,
  type ReportResult,
} from '../../src/app/reports.js';
import { MAX_TABLE_WIDTH, preLines } from '../../src/app/report-format.js';
import { EQUIVALENCES } from '../../src/core/equivalences.js';
import { buildAliasIndex } from '../../src/core/mapping.js';
import { productTotals, summarizeDay, summarizePeriod } from '../../src/core/reports.js';
import type { CuadreSheet } from '../../src/core/types.js';

const fixture = fileURLToPath(new URL('../fixtures/Cuadre K12 Remoto.xlsx', import.meta.url));

let source: CuadreXlsxReader;
let deps: ReportDeps;
let sheets: CuadreSheet[];

beforeAll(async () => {
  source = await CuadreXlsxReader.fromFile(fixture);
  deps = {
    cuadre: asCuadreReader(source),
    aliases: buildAliasIndex(EQUIVALENCES),
    hasFixedExpenses: false,
  };
  sheets = source.listDays().map((day) => source.readDay(day));
});

/** Texto plano del reporte (sin etiquetas HTML), para buscar cifras. */
function body(result: ReportResult): string {
  if (result.kind !== REPORT_KIND.TEXT)
    throw new Error(`se esperaba texto: ${JSON.stringify(result)}`);
  return result.messages
    .join('\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

describe('período (cuadre real 01–05)', () => {
  it('Σ utilidad bruta recalculada = 181,228.5, igual a lo que guardan las hojas', () => {
    const period = summarizePeriod(sheets.map(summarizeDay));
    expect(period.utilidadBruta).toBe(181_228.5);
    expect(period.venta).toBe(528_462);
    // Las hojas guardan la misma utilidad bruta en Q6 (la fórmula de Q14 es la errónea).
    const stored = sheets.reduce((sum, s) => {
      const q6 = s.summary.Q6?.value;
      return sum + (typeof q6 === 'number' ? q6 : 0);
    }, 0);
    expect(stored).toBe(181_228.5);
    expect(period.utilidadNeta).toBe(181_228.5); // no hay gastos registrados
    expect(period.margenPonderado).toBeCloseTo(181_228.5 / 528_462);
  });

  it('/mes lista cada día, suma y da los dos márgenes', async () => {
    const text = body(await monthReport(deps));
    expect(text).toContain('Mes (pestañas 01–05 · 5 días)');
    for (const day of ['01', '02', '03', '04', '05'])
      expect(text).toMatch(new RegExp(`^${day} `, 'm'));
    // Tabla corta (Día · Venta · Neta · Marg); los montos exactos, en el resumen.
    expect(text).toMatch(/^Total\s+528\.5k\s+181\.2k\s+34\.3%$/m);
    expect(text).toContain('Venta: 528,462 CUP');
    expect(text).toContain('Costo de lo vendido: 347,234 CUP');
    expect(text).toContain('Utilidad bruta: 181,229 CUP');
    expect(text).toContain('Utilidad neta: 181,229 CUP');
    expect(text).toContain('Margen promedio simple: 34.3% · ponderado: 34.3%');
    // Los márgenes difieren menos de un punto: no hace falta la explicación.
    expect(text).not.toContain('Simple: promedio');
    expect(text).toContain('Mejor día: 05');
    expect(text).toContain('Utilidad inflada');
  });

  it('el mes es todo el libro (un libro por mes)', () => {
    expect(monthDays(['01', '02'])).toEqual(['01', '02']);
  });

  it('/semana y /rango', async () => {
    expect(body(await weekReport(deps))).toContain('Últimos 7 días (pestañas 01–05 · 5 días)');
    const range = body(await rangeReport(deps, '02 03'));
    expect(range).toMatch(/^Total\s+191\.1k/m);
    expect(range).toContain('Venta: 191,076 CUP');
    expect(body(await rangeReport(deps, ''))).toContain('Uso: /rango');
    expect(body(await rangeReport(deps, '02 09'))).toContain('No existe la pestaña 09');
  });
});

describe('/dia y /hoy', () => {
  it('/dia 02: resumen, top 5, alertas y producto sin costo', async () => {
    const text = body(await dayReport(deps, '2'));
    expect(text).toContain('pestaña 02 · TC 775');
    expect(text).toContain('Venta: 100,620 CUP (USD 129.83)');
    expect(text).toContain('Utilidad bruta: 30,882 CUP');
    expect(text).toContain('Top 5 por venta');
    expect(text).toMatch(/Alertas: 🔴 \d+ · 🟡 \d+ · ⚪ \d+/);
    expect(text).toContain('cigarro popular verde');
  });

  it('/hoy sin pestaña de hoy muestra el último día cargado', async () => {
    const text = body(await todayReport(deps, '07'));
    expect(text).toContain('Todavía no hay pestaña de hoy (07)');
    expect(text).toContain('pestaña 05');
  });
});

describe('gastos, inversión y ganancia', () => {
  it('/gastos: sin gastos registrados, la utilidad neta es la bruta', async () => {
    const text = body(await expensesReport(deps, ''));
    expect(text).toContain('No hay gastos registrados');
    expect(text).toContain('= utilidad neta 181,229 CUP');
  });

  it('/inversion recalcula desde las filas (la 04 guarda 9,625 menos en Q2)', async () => {
    const text = body(await inventoryReport(deps, '03 04'));
    // Recalculado: inicial del 04 = final del 03 = 597,262; la hoja guarda 587,636.5.
    expect(text).toMatch(/^04\s+597\.3k/m);
    expect(text).not.toContain('no continúa');
  });

  it('/ganancia: según hojas y ajustada como rango estimado', async () => {
    const text = body(await profitReport(deps));
    expect(text).toContain('Utilidad bruta: 181,229 CUP');
    expect(text).toContain('Ajustada (estimado, no dato)');
    expect(text).toMatch(/entre [\d,]+ y [\d,]+ CUP/);
  });
});

describe('/top y /margen', () => {
  it('/top 3 utilidad', async () => {
    const text = body(await topReport(deps, '3 utilidad'));
    expect(text).toContain('Top 3 por utilidad');
    expect(text.match(/^\s*[123] /gm)).toHaveLength(3);
  });

  it('/margen separa los productos sin costo', async () => {
    const text = body(await marginsReport(deps, ''));
    expect(text).toContain('Menor margen');
    expect(text).toContain('Sin costo, margen desconocido');
    expect(text).toContain('pollo');
  });
});

describe('/fila', () => {
  it('arroz 02: toda la fila recalculada', async () => {
    const text = body(await rowReport(deps, 'arroz 02'));
    expect(text).toContain('arroz · pestaña 02 · fila 6');
    // inicio 5 + entradas 4 − final 7 = 2 vendidos a 950 con costo 659.
    expect(text).toMatch(/^I · Salida: 2$/m);
    expect(text).toMatch(/^K · Venta Bruta: 1,900$/m);
    expect(text).toMatch(/^L · Costo Final: 1,318$/m);
    expect(text).toMatch(/^N · Utilidad: 582$/m);
    expect(text).toContain('coincide con lo guardado');
  });

  it('mantequilla Soya 04: marca el 0 escrito a mano en C60', async () => {
    const text = body(await rowReport(deps, 'mantequilla soya 4'));
    expect(text).toMatch(/^C · Invs inicial: 9,625 ⚠️ hoja: 0$/m);
    expect(text).toContain('La hoja guarda otro valor en C60');
  });

  it('sin día: el último; producto inexistente', async () => {
    expect(body(await rowReport(deps, 'pollo'))).toContain('pestaña 05');
    expect(body(await rowReport(deps, 'xyzw 02'))).toContain('No encontré "xyzw"');
  });
});

describe('/producto', () => {
  it('arroz: suma de todas sus filas = Σ del detalle por día', async () => {
    const totals = productTotals(sheets, 'arroz');
    expect(totals).not.toBeNull();
    if (totals === null) return;
    const lines = totals.lines;
    const sum = (pick: (l: (typeof lines)[number]) => number) =>
      lines.reduce((acc, l) => acc + pick(l), 0);
    expect(totals.unidades).toBe(sum((l) => l.unidades));
    expect(totals.venta).toBe(sum((l) => l.venta));
    expect(totals.utilidad).toBe(sum((l) => l.utilidad));
    expect(totals).toMatchObject({
      entradas: 10,
      unidades: 6,
      venta: 5760,
      costo: 3954,
      utilidad: 1806,
      stock: 9,
      priceChanges: [{ day: '05', from: 950, to: 980 }],
    });

    const text = body(await productReport(deps, 'arroz'));
    expect(text).toContain('Vendió: 6 unidades · venta 5,760 CUP');
    expect(text).toContain('Cambios de precio: 05 950→980');
    expect(text).toContain('alcanza para 7.5 días');
  });

  it('refresco reenvasado: avisa el día que tiene otro nombre', async () => {
    expect(body(await productReport(deps, 'refresco reenvasado'))).toContain('No aparece en: 03');
  });

  it('nombre ambiguo: ofrece elegir y completa el pedido', async () => {
    const result = await productReport(deps, 'mayonesa 01 03');
    expect(result).toMatchObject({
      kind: REPORT_KIND.CHOOSE,
      options: ['mayonesa cepera', 'mayonesa holland park'],
      request: { command: 'producto', range: { from: '01', to: '03' } },
    });
    if (result.kind !== REPORT_KIND.CHOOSE) return;
    const text = body(await completeProductRequest(deps, result.request, 'mayonesa cepera'));
    expect(text).toContain('mayonesa cepera (pestañas 01–03 · 3 días)');
  });
});

describe('ancho de las tablas (teléfono)', () => {
  it(`ninguna línea de una tabla pasa de ${String(MAX_TABLE_WIDTH)} caracteres`, async () => {
    const reports: [string, Promise<ReportResult>][] = [
      ['/mes', monthReport(deps)],
      ['/semana', weekReport(deps)],
      ['/rango 01 05', rangeReport(deps, '01 05')],
      ['/gastos', expensesReport(deps, '')],
      ['/inversion', inventoryReport(deps, '')],
      ['/ganancia', profitReport(deps)],
      ['/top 20 venta', topReport(deps, '20 venta')],
      ['/top 20 unidades', topReport(deps, '20 unidades')],
      ['/margen', marginsReport(deps, '')],
      ['/dia 03', dayReport(deps, '03')],
      ['/hoy', todayReport(deps, '03')],
      ['/fila mantequilla soya 04', rowReport(deps, 'mantequilla soya 04')],
      ['/producto pollo', productReport(deps, 'pollo')],
      ['/producto arroz', productReport(deps, 'arroz')],
    ];
    for (const [name, pending] of reports) {
      const result = await pending;
      if (result.kind !== REPORT_KIND.TEXT) throw new Error(`${name}: se esperaba texto`);
      for (const line of result.messages.flatMap(preLines)) {
        expect(line.length, `${name}: "${line}"`).toBeLessThanOrEqual(MAX_TABLE_WIDTH);
      }
    }
  });
});

describe('explicación de los márgenes', () => {
  it('solo cuando el simple y el ponderado difieren en más de un punto', () => {
    const period = summarizePeriod(sheets.map(summarizeDay));
    expect(marginsDiffer(period)).toBe(false);
    expect(marginsDiffer({ ...period, margenSimple: 0.4, margenPonderado: 0.3 })).toBe(true);
    expect(marginsDiffer({ ...period, margenSimple: 0.305, margenPonderado: 0.3 })).toBe(false);
    expect(marginsDiffer({ ...period, margenSimple: null })).toBe(false);
  });
});
