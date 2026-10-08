import type { AliasIndex } from '../core/mapping.js';
import {
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
  type DayRange,
} from '../core/report-args.js';
import {
  adjustedProfit,
  aggregateProducts,
  marginReport,
  productRow,
  productTotals,
  ROW_FIELD,
  summarizeDay,
  summarizePeriod,
  TOP_METRIC,
  topProducts,
  type DaySummary,
  type PeriodSummary,
  type ProductAggregate,
  type RowFieldKey,
  type TopMetric,
} from '../core/reports.js';
import { normalizeName } from '../core/tabs.js';
import type { CuadreSheet } from '../core/types.js';
import { SEVERITY, validateDays, type Severity } from '../core/validations.js';
import type { CuadreReader } from '../ports/cuadre-source.js';
import { ALIGN, compact, cup, esc, packMessages, pct, qty, table, usd } from './report-format.js';

/**
 * Reportes del cuadre para Telegram (/mes, /semana, /rango, /dia, /hoy, /gastos,
 * /inversion, /ganancia, /top, /margen, /fila, /producto). Leen la hoja con el
 * CuadreReader y recalculan todo con core/reports. El texto es HTML.
 */

export interface ReportDeps {
  cuadre: CuadreReader;
  aliases: AliasIndex;
  hasFixedExpenses: boolean;
}

export const REPORT_KIND = {
  TEXT: 'text',
  CHOOSE: 'choose',
} as const;

export const PRODUCT_COMMAND = {
  ROW: 'fila',
  PRODUCT: 'producto',
} as const;

export type ProductRequest =
  | { command: typeof PRODUCT_COMMAND.ROW; day: string }
  | { command: typeof PRODUCT_COMMAND.PRODUCT; range: DayRange | null };

export interface TextReport {
  kind: typeof REPORT_KIND.TEXT;
  /** Mensajes HTML listos para enviar, en orden. */
  messages: string[];
}

/** El nombre coincide con varios productos: se elige con botones y se completa el pedido. */
export interface ChooseProduct {
  kind: typeof REPORT_KIND.CHOOSE;
  prompt: string;
  options: string[];
  request: ProductRequest;
}

export type ReportResult = TextReport | ChooseProduct;

const WEEK_DAYS = 7;
/** Productos del top con su detalle exacto debajo de la tabla. */
const TOP_DETAIL = 3;
const TOP_HEADER: Readonly<Record<TopMetric, string>> = {
  [TOP_METRIC.VENTA]: 'Venta',
  [TOP_METRIC.UTILIDAD]: 'Util',
  [TOP_METRIC.UNIDADES]: 'Unid',
};
const DAY_TOP = 5;
const MARGIN_LIST = 10;

const text = (...blocks: string[]): TextReport => ({
  kind: REPORT_KIND.TEXT,
  messages: packMessages(blocks),
});
const plain = (message: string): TextReport => text(esc(message));

/**
 * Días que forman "el mes". Hoy cada libro del cuadre es un mes (pestañas `DD`), así
 * que son todas las pestañas de días. Si las dueñas eligen pestañas `DD-MM`, solo
 * cambia esta función.
 */
export function monthDays(days: readonly string[]): string[] {
  return [...days];
}

/** Todos los días de una vez: en Google Sheets son dos llamadas, no dos por día. */
function readSheets(reader: CuadreReader, days: readonly string[]): Promise<CuadreSheet[]> {
  return reader.readDays(days);
}

function spanLabel(days: readonly string[]): string {
  const first = days[0]?.trim() ?? '';
  const last = days[days.length - 1]?.trim() ?? '';
  const count = `${String(days.length)} ${days.length === 1 ? 'día' : 'días'}`;
  return first === last ? `pestaña ${first}` : `pestañas ${first}–${last} · ${count}`;
}

function inUsd(value: number, tc: number | null): string {
  return tc === null || tc <= 0 ? 'sin TC' : `USD ${usd(value / tc)}`;
}

// ---------------------------------------------------------------- notas de calidad

function uncostedNote(ventaSinCosto: number, products: readonly string[]): string {
  if (ventaSinCosto === 0) return '';
  const names = [...new Set(products.map((p) => p.replace(/\s+/g, ' ').trim()))];
  return (
    `⚠️ Utilidad <b>inflada</b>: ${cup(ventaSinCosto)} CUP se vendieron sin costo ` +
    `(${String(names.length)} ${names.length === 1 ? 'producto' : 'productos'}: ${esc(names.slice(0, 6).join(', '))}${names.length > 6 ? '…' : ''}). ` +
    'Cuentan la venta completa como ganancia. Ver /ganancia.'
  );
}

function periodNotes(period: PeriodSummary): string {
  const lines: string[] = [];
  const uncosted = uncostedNote(
    period.ventaSinCosto,
    period.days.flatMap((d) => d.uncosted.map((u) => u.product)),
  );
  if (uncosted !== '') lines.push(uncosted);
  if (period.usd.daysWithoutTc.length > 0) {
    lines.push(`Sin TC (no entran en USD): ${period.usd.daysWithoutTc.join(', ')}.`);
  }
  if (period.daysWithoutExpenses.length > 0) {
    lines.push(
      `Sin sección "Otros Gastos" (gastos desconocidos): ${period.daysWithoutExpenses.join(', ')}.`,
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- período

const MARGIN_EXPLANATION =
  '<i>Simple: promedio de los % diarios (cada día pesa igual). Ponderado: Σ utilidad bruta ÷ Σ venta (pesan más los días que más venden).</i>';
/** La explicación solo aporta cuando los dos márgenes cuentan historias distintas. */
const MARGIN_GAP_TO_EXPLAIN = 0.01;

export function marginsDiffer(period: PeriodSummary): boolean {
  const { margenSimple, margenPonderado } = period;
  return (
    margenSimple !== null &&
    margenPonderado !== null &&
    Math.abs(margenSimple - margenPonderado) > MARGIN_GAP_TO_EXPLAIN
  );
}

function periodReport(title: string, days: readonly string[], period: PeriodSummary): TextReport {
  // Cuatro columnas cortas para que quepa en el teléfono; los montos exactos van abajo.
  const rows = period.days.map((d) => [
    d.day,
    compact(d.venta),
    compact(d.utilidadNeta),
    pct(d.margen),
  ]);
  rows.push([
    'Total',
    compact(period.venta),
    compact(period.utilidadNeta),
    pct(period.margenPonderado),
  ]);

  const count = period.days.length;
  const average = (value: number) => cup(count === 0 ? 0 : value / count);
  const summary = [
    `Venta: <b>${cup(period.venta)} CUP</b> (USD ${usd(period.usd.venta)})`,
    `Costo de lo vendido: ${cup(period.costo)} CUP (dinero para reponer)`,
    `Utilidad bruta: <b>${cup(period.utilidadBruta)} CUP</b> (USD ${usd(period.usd.utilidadBruta)})`,
    `Gastos: ${cup(period.gastos)} CUP`,
    `Utilidad neta: <b>${cup(period.utilidadNeta)} CUP</b> (USD ${usd(period.usd.utilidadNeta)})`,
    `Promedio diario: venta ${average(period.venta)} · utilidad neta ${average(period.utilidadNeta)} CUP`,
    `Margen promedio simple: <b>${pct(period.margenSimple)}</b> · ponderado: <b>${pct(period.margenPonderado)}</b>`,
  ];
  if (marginsDiffer(period)) summary.push(MARGIN_EXPLANATION);
  if (period.best !== null && period.worst !== null && count > 1) {
    summary.push(
      `Mejor día: ${period.best.day} (${cup(period.best.utilidadNeta)} neto) · peor: ${period.worst.day} (${cup(period.worst.utilidadNeta)})`,
    );
  }

  return text(
    `📅 <b>${esc(title)}</b> (${spanLabel(days)})`,
    table(['Día', 'Venta', 'Neta', 'Marg'], rows),
    '<i>Neta = utilidad bruta − gastos. Marg = margen bruto.</i>',
    summary.join('\n'),
    periodNotes(period),
  );
}

async function periodFor(deps: ReportDeps, days: readonly string[]): Promise<PeriodSummary> {
  return summarizePeriod((await readSheets(deps.cuadre, days)).map(summarizeDay));
}

const NO_DAYS = 'El cuadre todavía no tiene pestañas de días.';

export async function monthReport(deps: ReportDeps): Promise<ReportResult> {
  const days = monthDays(await deps.cuadre.listDays());
  if (days.length === 0) return plain(NO_DAYS);
  return periodReport('Mes', days, await periodFor(deps, days));
}

export async function weekReport(deps: ReportDeps): Promise<ReportResult> {
  const days = (await deps.cuadre.listDays()).slice(-WEEK_DAYS);
  if (days.length === 0) return plain(NO_DAYS);
  return periodReport('Últimos 7 días', days, await periodFor(deps, days));
}

export async function rangeReport(deps: ReportDeps, raw: string): Promise<ReportResult> {
  const range = parseRequiredRange(raw);
  if (isArgsError(range)) return plain(range.message);
  const days = selectDays(await deps.cuadre.listDays(), range);
  if (isArgsError(days)) return plain(days.message);
  return periodReport('Rango', days, await periodFor(deps, days));
}

// ---------------------------------------------------------------- un día

const SEVERITIES: readonly Severity[] = [SEVERITY.RED, SEVERITY.YELLOW, SEVERITY.WHITE];
const SEVERITY_ICON: Readonly<Record<Severity, string>> = {
  [SEVERITY.RED]: '🔴',
  [SEVERITY.YELLOW]: '🟡',
  [SEVERITY.WHITE]: '⚪',
};

function topTable(products: readonly ProductAggregate[], metric: TopMetric): string {
  return table(
    ['Producto', metric === TOP_METRIC.VENTA ? 'Venta' : 'Utilidad'],
    products.map((p) => [`${p.missingCost ? '*' : ''}${p.product}`, cup(p[metric])]),
    [ALIGN.LEFT, ALIGN.RIGHT],
  );
}

async function dayReportFor(
  deps: ReportDeps,
  days: readonly string[],
  tab: string,
  title: string,
): Promise<ReportResult> {
  const index = days.findIndex((day) => day.trim() === tab);
  if (index < 0) return plain(`No existe la pestaña ${tab} en el cuadre.`);

  // Se leen el día anterior y el siguiente para las validaciones de continuidad.
  const window = days.slice(Math.max(0, index - 1), index + 2);
  const sheets = await readSheets(deps.cuadre, window);
  const sheet = sheets.find((s) => s.tabName.trim() === tab);
  if (sheet === undefined) return plain(`No pude leer la pestaña ${tab}.`);
  const day: DaySummary = summarizeDay(sheet);

  const findings = validateDays(sheets, { hasFixedExpenses: deps.hasFixedExpenses }).filter(
    (f) => f.day.trim() === tab,
  );
  const counts = SEVERITIES.map(
    (s) => `${SEVERITY_ICON[s]} ${String(findings.filter((f) => f.severity === s).length)}`,
  ).join(' · ');

  const products = aggregateProducts([sheet]);
  const gastos = day.gastos.found
    ? day.gastos.items.length === 0
      ? '0 CUP (no hay gastos registrados)'
      : `${cup(day.gastos.total)} CUP (${esc(day.gastos.items.map((i) => `${i.concept} ${cup(i.amount)}`).join(', '))})`
    : 'sin sección "Otros Gastos"';

  return text(
    `📊 <b>${esc(title)}</b> · pestaña ${tab} · TC ${day.tc === null ? 'sin TC' : String(day.tc)}`,
    [
      `Venta: <b>${cup(day.venta)} CUP</b> (${inUsd(day.venta, day.tc)})`,
      `Costo de lo vendido: ${cup(day.costo)} CUP (dinero para reponer)`,
      `Utilidad bruta: <b>${cup(day.utilidadBruta)} CUP</b> · margen ${pct(day.margen)}`,
      `Gastos: ${gastos}`,
      `Utilidad neta: <b>${cup(day.utilidadNeta)} CUP</b> (${inUsd(day.utilidadNeta, day.tc)})`,
    ].join('\n'),
    `<b>Top ${String(DAY_TOP)} por venta</b>\n${topTable(topProducts(products, TOP_METRIC.VENTA, DAY_TOP), TOP_METRIC.VENTA)}`,
    `<b>Top ${String(DAY_TOP)} por utilidad</b>\n${topTable(topProducts(products, TOP_METRIC.UTILIDAD, DAY_TOP), TOP_METRIC.UTILIDAD)}`,
    products.some((p) => p.missingCost)
      ? '<i>* sin costo: su utilidad es la venta completa.</i>'
      : '',
    `Alertas: ${counts} (detalle con /validar ${tab})`,
    uncostedNote(
      day.ventaSinCosto,
      day.uncosted.map((u) => u.product),
    ),
  );
}

export async function dayReport(deps: ReportDeps, raw: string): Promise<ReportResult> {
  const arg = parseDay(raw);
  if (isArgsError(arg)) return plain(arg.message);
  const days = await deps.cuadre.listDays();
  if (days.length === 0) return plain(NO_DAYS);
  const tab = arg ?? days[days.length - 1]?.trim() ?? '';
  return dayReportFor(deps, days, tab, arg === null ? 'Último día' : 'Día');
}

/** /hoy: la pestaña de hoy; si todavía no existe, el último día cargado. */
export async function todayReport(deps: ReportDeps, todayTab: string): Promise<ReportResult> {
  const days = await deps.cuadre.listDays();
  if (days.length === 0) return plain(NO_DAYS);
  if (days.some((day) => day.trim() === todayTab)) {
    return dayReportFor(deps, days, todayTab, 'Hoy');
  }
  const last = days[days.length - 1]?.trim() ?? '';
  const report = await dayReportFor(deps, days, last, 'Último día cargado');
  if (report.kind !== REPORT_KIND.TEXT) return report;
  return {
    kind: REPORT_KIND.TEXT,
    messages: [
      esc(`Todavía no hay pestaña de hoy (${todayTab}); muestro el último día cargado.`),
      ...report.messages,
    ],
  };
}

// ---------------------------------------------------------------- gastos e inversión

async function rangeDays(deps: ReportDeps, raw: string): Promise<{ days: string[] } | TextReport> {
  const range = parseRange(raw);
  if (isArgsError(range)) return plain(range.message);
  const all = monthDays(await deps.cuadre.listDays());
  if (all.length === 0) return plain(NO_DAYS);
  const days = selectDays(all, range);
  return isArgsError(days) ? plain(days.message) : { days };
}

export async function expensesReport(deps: ReportDeps, raw: string): Promise<ReportResult> {
  const selected = await rangeDays(deps, raw);
  if ('kind' in selected) return selected;
  const period = await periodFor(deps, selected.days);

  const rows = period.days.map((d) => [
    d.day,
    d.gastos.found ? compact(d.gastos.total) : '¿?',
    d.gastos.items.map((i) => i.concept).join(', ') || (d.gastos.found ? '—' : 'sin sección'),
  ]);
  rows.push(['Total', compact(period.gastos), '']);

  const concepts = new Map<string, number>();
  for (const item of period.days.flatMap((d) => d.gastos.items)) {
    const key = item.concept.toLowerCase();
    concepts.set(key, (concepts.get(key) ?? 0) + item.amount);
  }
  const byConcept = [...concepts]
    .sort((a, b) => b[1] - a[1])
    .map(([concept, amount]) => `• ${esc(concept)}: ${cup(amount)} CUP`)
    .join('\n');

  return text(
    `💸 <b>Gastos</b> (${spanLabel(selected.days)}) · total <b>${cup(period.gastos)} CUP</b>`,
    table(['Día', 'Gastos', 'Concepto'], rows, [ALIGN.LEFT, ALIGN.RIGHT, ALIGN.LEFT]),
    period.gastos === 0
      ? 'No hay gastos registrados en "Otros Gastos" en este período.'
      : `<b>Por concepto</b>\n${byConcept}`,
    `Utilidad bruta ${cup(period.utilidadBruta)} − gastos ${cup(period.gastos)} = utilidad neta <b>${cup(period.utilidadNeta)} CUP</b>`,
    period.daysWithoutExpenses.length > 0
      ? `Sin sección "Otros Gastos": ${period.daysWithoutExpenses.join(', ')}.`
      : '',
  );
}

export async function inventoryReport(deps: ReportDeps, raw: string): Promise<ReportResult> {
  const selected = await rangeDays(deps, raw);
  if ('kind' in selected) return selected;
  const sheets = await readSheets(deps.cuadre, selected.days);
  const days = sheets.map(summarizeDay);

  const rows = days.map((d) => [
    d.day,
    compact(d.inversionInicial),
    compact(d.compras),
    compact(d.inversionFinal),
  ]);
  const first = days[0];
  const last = days[days.length - 1];
  const compras = days.reduce((total, d) => total + d.compras, 0);
  const vendido = days.reduce((total, d) => total + d.costo, 0);
  const uncosted = new Set(
    sheets
      .flatMap((s) =>
        s.rows.filter((r) => (r.costo ?? 0) <= 0 && ((r.final ?? 0) > 0 || (r.inicio ?? 0) > 0)),
      )
      .map((r) => normalizeName(r.product)),
  );

  const breaks = days.flatMap((d, i) => {
    const next = days[i + 1];
    if (next === undefined) return [];
    const diff = next.inversionInicial - d.inversionFinal;
    return Math.abs(diff) >= 1
      ? [
          `• ${d.day}→${next.day}: inversión final ${cup(d.inversionFinal)} ≠ inicial ${cup(next.inversionInicial)} (${cup(diff)})`,
        ]
      : [];
  });

  return text(
    `📦 <b>Inversión</b> (${spanLabel(selected.days)}) · valorada al costo`,
    table(['Día', 'Inicial', 'Compras', 'Final'], rows),
    first === undefined || last === undefined
      ? ''
      : [
          `Inversión al inicio: ${cup(first.inversionInicial)} CUP → al final: <b>${cup(last.inversionFinal)} CUP</b> (${cup(last.inversionFinal - first.inversionInicial)})`,
          `Compras del período: ${cup(compras)} CUP · costo de lo vendido: ${cup(vendido)} CUP`,
          `Al final: ${inUsd(last.inversionFinal, last.tc)}`,
        ].join('\n'),
    breaks.length > 0
      ? `⚠️ La inversión no continúa de un día al siguiente (revisa /validar):\n${breaks.join('\n')}`
      : '',
    uncosted.size > 0
      ? `⚠️ ${String(uncosted.size)} productos con existencia y sin costo valen 0: la inversión real es mayor.`
      : '',
    '<i>Recalculado desde las cantidades y los costos de cada fila, no desde el resumen de la hoja.</i>',
  );
}

// ---------------------------------------------------------------- ganancia acumulada

export async function profitReport(deps: ReportDeps): Promise<ReportResult> {
  const days = monthDays(await deps.cuadre.listDays());
  if (days.length === 0) return plain(NO_DAYS);
  const period = await periodFor(deps, days);
  const adjusted = adjustedProfit(period);
  const net = (gross: number) => cup(gross - adjusted.gastos);

  const blocks = [
    `💰 <b>Ganancia acumulada</b> desde la apertura (${spanLabel(days)})`,
    [
      '<b>Según las hojas</b> (dato):',
      `Venta: ${cup(period.venta)} CUP (USD ${usd(period.usd.venta)})`,
      `Utilidad bruta: <b>${cup(period.utilidadBruta)} CUP</b> (USD ${usd(period.usd.utilidadBruta)})`,
      `Gastos: ${cup(period.gastos)} CUP`,
      `Utilidad neta: <b>${cup(period.utilidadNeta)} CUP</b> (USD ${usd(period.usd.utilidadNeta)})`,
    ].join('\n'),
  ];

  if (adjusted.ventaSinCosto > 0 && adjusted.margenReferencia !== null) {
    blocks.push(
      [
        '<b>Ajustada</b> (<u>estimado</u>, no dato):',
        `Utilidad neta: entre <b>${net(adjusted.bajo)}</b> y <b>${net(adjusted.alto)} CUP</b> (central ${net(adjusted.central)})`,
        `Cómo: ${cup(adjusted.ventaSinCosto)} CUP se vendieron sin costo. Se les asigna el margen de los productos que sí tienen costo: ${pct(adjusted.margenReferencia)} ponderado; el rango usa el menor y el mayor margen diario.`,
        'No descuenta errores de registro (finales vacías, existencias como entradas): revísalos con /validar.',
      ].join('\n'),
    );
  } else {
    blocks.push('Todas las ventas tienen costo: no hace falta ajuste.');
  }
  blocks.push(periodNotes({ ...period, ventaSinCosto: 0 }));
  return text(...blocks);
}

// ---------------------------------------------------------------- productos

export async function topReport(deps: ReportDeps, raw: string): Promise<ReportResult> {
  const args = parseTop(raw);
  if (isArgsError(args)) return plain(args.message);
  const all = monthDays(await deps.cuadre.listDays());
  if (all.length === 0) return plain(NO_DAYS);
  const days = selectDays(all, args.range);
  if (isArgsError(days)) return plain(days.message);

  const products = aggregateProducts(await readSheets(deps.cuadre, days));
  const top = topProducts(products, args.metric, args.limit);
  if (top.length === 0) return plain('No hay ventas en ese período.');

  return text(
    `🏆 <b>Top ${String(top.length)} por ${args.metric}</b> (${spanLabel(days)})`,
    table(
      ['#', 'Producto', TOP_HEADER[args.metric], 'Marg'],
      top.map((p, i) => [
        String(i + 1),
        `${p.missingCost ? '*' : ''}${p.product}`,
        args.metric === TOP_METRIC.UNIDADES ? qty(p.unidades) : compact(p[args.metric]),
        pct(p.margen),
      ]),
      [ALIGN.RIGHT, ALIGN.LEFT],
    ),
    top
      .slice(0, TOP_DETAIL)
      .map(
        (p, i) =>
          `${String(i + 1)}. ${esc(p.product.replace(/\s+/g, ' '))}: ${qty(p.unidades)} unid · venta ${cup(p.venta)} · utilidad ${cup(p.utilidad)} CUP`,
      )
      .join('\n'),
    top.some((p) => p.missingCost) ? '<i>* sin costo: su utilidad es la venta completa.</i>' : '',
  );
}

export async function marginsReport(deps: ReportDeps, raw: string): Promise<ReportResult> {
  const selected = await rangeDays(deps, raw);
  if ('kind' in selected) return selected;
  const report = marginReport(aggregateProducts(await readSheets(deps.cuadre, selected.days)));
  const rows = (products: readonly ProductAggregate[]) =>
    products.map((p) => [p.product, compact(p.venta), pct(p.margen)]);
  const header = ['Producto', 'Venta', 'Marg'];

  return text(
    `📐 <b>Márgenes por producto</b> (${spanLabel(selected.days)})`,
    report.lowMarginHighRotation.length === 0
      ? '✅ Ningún producto de alta rotación tiene margen menor al 15%.'
      : `⚠️ <b>Alta rotación con margen &lt; 15%</b> (vende ≥ ${qty(report.highRotationMinUnits)} unidades):\n${table(header, rows(report.lowMarginHighRotation))}`,
    `<b>Menor margen</b>\n${table(header, rows(report.ranked.slice(0, MARGIN_LIST)))}`,
    `<b>Mayor margen</b>\n${table(header, rows(report.ranked.slice(-MARGIN_LIST).reverse()))}`,
    report.withoutCost.length === 0
      ? ''
      : `Sin costo, margen desconocido (${String(report.withoutCost.length)}): ${esc(report.withoutCost.map((p) => p.product.replace(/\s+/g, ' ')).join(', '))}. Carga su costo con /costo.`,
  );
}

const ROW_LABEL: Readonly<Record<RowFieldKey, string>> = {
  [ROW_FIELD.COSTO]: 'Costo',
  [ROW_FIELD.INVS_INICIAL]: 'Invs inicial',
  [ROW_FIELD.PRECIO]: 'P. Venta',
  [ROW_FIELD.INICIO]: 'Cant. Inicio',
  [ROW_FIELD.ENTRADAS]: 'Entradas',
  [ROW_FIELD.MERMA]: 'Merma',
  [ROW_FIELD.CONSUMO]: 'Consumo',
  [ROW_FIELD.SALIDA]: 'Salida',
  [ROW_FIELD.FINAL]: 'Cant. Final',
  [ROW_FIELD.VENTA_BRUTA]: 'Venta Bruta',
  [ROW_FIELD.COSTO_FINAL]: 'Costo Final',
  [ROW_FIELD.INVS_FINAL]: 'Invs. Final',
  [ROW_FIELD.UTILIDAD]: 'Utilidad',
};

const QUANTITY_FIELDS: ReadonlySet<RowFieldKey> = new Set([
  ROW_FIELD.INICIO,
  ROW_FIELD.ENTRADAS,
  ROW_FIELD.MERMA,
  ROW_FIELD.CONSUMO,
  ROW_FIELD.SALIDA,
  ROW_FIELD.FINAL,
]);

function rowReportFor(sheet: CuadreSheet, product: string): ReportResult {
  const report = productRow(sheet, product);
  if (report === null) {
    return plain(`${product} no aparece en la pestaña ${sheet.tabName.trim()}.`);
  }
  const show = (key: RowFieldKey, value: number | null) =>
    value === null ? 'vacía' : QUANTITY_FIELDS.has(key) ? qty(value) : cup(value);
  const differs = report.fields.filter((f) => f.differs);
  const tc = sheet.tc;

  return text(
    `🧾 <b>${esc(report.product)}</b> · pestaña ${report.day} · fila ${String(report.rowNumber)}`,
    // Una línea por columna (no tabla): en el teléfono no se parte.
    report.fields
      .map(
        (f) =>
          `${f.column} · ${ROW_LABEL[f.key]}: <b>${show(f.key, f.value)}</b>` +
          (f.differs ? ` ⚠️ hoja: ${show(f.key, f.stored)}` : ''),
      )
      .join('\n'),
    [
      `Margen: ${pct(report.margen)}`,
      `Venta: ${inUsd(report.fields.find((f) => f.key === ROW_FIELD.VENTA_BRUTA)?.value ?? 0, tc)}`,
    ].join(' · '),
    report.hasCost
      ? ''
      : '⚠️ Sin costo: la utilidad de esta fila es la venta completa (inflada). Cárgalo con /costo.',
    differs.length === 0
      ? '<i>Recalculado con las fórmulas de la hoja; coincide con lo guardado.</i>'
      : `⚠️ La hoja guarda otro valor en ${differs.map((f) => `${f.column}${String(report.rowNumber)}`).join(', ')} (fórmula rota o valor escrito a mano). La columna "Valor" es el recalculado.`,
  );
}

function productNames(sheets: readonly CuadreSheet[]): string[] {
  const names = new Map<string, string>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const key = normalizeName(row.product);
      if (key !== '') names.set(key, row.product);
    }
  }
  return [...names.values()];
}

function notFound(query: string): TextReport {
  return plain(
    `No encontré "${query}" en el cuadre. Revisa el nombre (por ejemplo: /producto pollo).`,
  );
}

function chooseFrom(
  query: string,
  sheets: readonly CuadreSheet[],
  deps: ReportDeps,
  request: ProductRequest,
): ReportResult | string {
  const resolution = resolveProductQuery(query, productNames(sheets), deps.aliases);
  switch (resolution.status) {
    case RESOLVE_STATUS.FOUND:
      return resolution.product;
    case RESOLVE_STATUS.CHOOSE:
      return {
        kind: REPORT_KIND.CHOOSE,
        prompt: `"${query}" coincide con varios productos. ¿Cuál?`,
        options: resolution.options,
        request,
      };
    case RESOLVE_STATUS.NONE:
      return notFound(query);
  }
}

/** /fila <producto> [día]: toda la fila del producto ese día. */
export async function rowReport(deps: ReportDeps, raw: string): Promise<ReportResult> {
  const args = parseRowArgs(raw);
  if (isArgsError(args)) return plain(args.message);
  const days = await deps.cuadre.listDays();
  if (days.length === 0) return plain(NO_DAYS);
  const tab = args.day ?? days[days.length - 1]?.trim() ?? '';
  if (!days.some((day) => day.trim() === tab))
    return plain(`No existe la pestaña ${tab} en el cuadre.`);

  const sheet = await deps.cuadre.readDay(tab);
  const product = chooseFrom(args.query, [sheet], deps, { command: PRODUCT_COMMAND.ROW, day: tab });
  return typeof product === 'string' ? rowReportFor(sheet, product) : product;
}

function productReportFor(
  sheets: readonly CuadreSheet[],
  days: readonly string[],
  product: string,
): ReportResult {
  const totals = productTotals(sheets, product);
  if (totals === null) return notFound(product);

  const changes = (label: string, list: typeof totals.priceChanges) =>
    list.length === 0
      ? ''
      : `${label}: ${list.map((c) => `${c.day} ${c.from === null ? 'vacío' : cup(c.from)}→${c.to === null ? 'vacío' : cup(c.to)}`).join(', ')}`;
  const first = totals.lines[0];
  const last = totals.lines[totals.lines.length - 1];

  return text(
    `🔎 <b>${esc(totals.product)}</b> (${spanLabel(days)})`,
    [
      `Vendió: <b>${qty(totals.unidades)}</b> unidades · venta <b>${cup(totals.venta)} CUP</b>`,
      `Costo de lo vendido: ${cup(totals.costo)} CUP · utilidad <b>${cup(totals.utilidad)} CUP</b> · margen ${pct(totals.margen)}`,
      `Entradas: ${qty(totals.entradas)} · merma: ${qty(totals.merma)} · consumo: ${qty(totals.consumo)}`,
      `Existencia actual (${last?.day ?? '—'}): ${qty(totals.stock)} · venta diaria ${qty(totals.ventaDiaria)} · ${totals.diasInventario === null ? 'sin ventas: días de inventario sin calcular' : `alcanza para ${qty(totals.diasInventario)} días`}`,
      `Precio: ${first?.precio === null || first === undefined ? 'vacío' : cup(first.precio)} → ${last?.precio === null || last === undefined ? 'vacío' : cup(last.precio)} · costo: ${first?.costo === null || first === undefined ? 'vacío' : cup(first.costo)} → ${last?.costo === null || last === undefined ? 'vacío' : cup(last.costo)}`,
    ].join('\n'),
    table(
      ['Día', 'Vend', 'Fin', 'Venta', 'Util'],
      [
        ...totals.lines.map((l) => [
          l.day,
          qty(l.unidades),
          qty(l.final),
          compact(l.venta),
          compact(l.utilidad),
        ]),
        ['Σ', qty(totals.unidades), '', compact(totals.venta), compact(totals.utilidad)],
      ],
    ),
    '<i>Vend = unidades vendidas · Fin = existencia al cierre. Entradas, merma y consumo: arriba.</i>',
    [
      changes('Cambios de precio', totals.priceChanges),
      changes('Cambios de costo', totals.costChanges),
    ]
      .filter(Boolean)
      .join('\n'),
    totals.missingDays.length === 0
      ? ''
      : `⚠️ No aparece en: ${totals.missingDays.join(', ')} (¿otro nombre ese día? Revisa /validar).`,
    totals.daysWithoutCost.length === 0
      ? ''
      : `⚠️ Sin costo en: ${totals.daysWithoutCost.join(', ')}. Su utilidad es la venta completa (inflada).`,
  );
}

/** /producto <nombre> [desde hasta]: suma de todas sus filas y detalle por día. */
export async function productReport(deps: ReportDeps, raw: string): Promise<ReportResult> {
  const args = parseProductArgs(raw);
  if (isArgsError(args)) return plain(args.message);
  const all = monthDays(await deps.cuadre.listDays());
  if (all.length === 0) return plain(NO_DAYS);
  const days = selectDays(all, args.range);
  if (isArgsError(days)) return plain(days.message);

  const sheets = await readSheets(deps.cuadre, days);
  const product = chooseFrom(args.query, sheets, deps, {
    command: PRODUCT_COMMAND.PRODUCT,
    range: args.range,
  });
  return typeof product === 'string' ? productReportFor(sheets, days, product) : product;
}

/** Completa /fila o /producto después de elegir el producto con un botón. */
export async function completeProductRequest(
  deps: ReportDeps,
  request: ProductRequest,
  product: string,
): Promise<ReportResult> {
  if (request.command === PRODUCT_COMMAND.ROW) {
    const days = await deps.cuadre.listDays();
    if (!days.some((day) => day.trim() === request.day)) {
      return plain(`No existe la pestaña ${request.day} en el cuadre.`);
    }
    return rowReportFor(await deps.cuadre.readDay(request.day), product);
  }
  const days = selectDays(monthDays(await deps.cuadre.listDays()), request.range);
  if (isArgsError(days)) return plain(days.message);
  return productReportFor(await readSheets(deps.cuadre, days), days, product);
}
