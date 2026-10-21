import { can, PERMISSION } from '../core/auth.js';
import { checkIpvSales, computeTotals } from '../core/calc.js';
import { buildLastKnownCosts, cuadreTabsBefore, type CostSource } from '../core/costs.js';
import { buildCuadreDraft } from '../core/cuadre-builder.js';
import { TC_VALUE_CELL } from '../core/cuadre-layout.js';
import type { MonthKey } from '../core/months.js';
import { formatDayRef } from '../core/tabs.js';
import type { DayRef, IpvDay } from '../core/types.js';
import { ipvLoadBlockers, salesFindings, sortFindings, validateIpv } from '../core/validations.js';
import { PENDING_KIND, SNAPSHOT_KIND } from '../ports/repositories.js';
import { YELLOW } from '../ports/sheets-gateway.js';
import { closedMonthBlocker, isMonthClosed } from './closed-months.js';
import { bookOfWrite, noBookMessage, previousBook } from './cuadre-books.js';
import type { LoadIpvPayload } from './pending-payloads.js';
import {
  PREPARE_STATUS,
  type Actor,
  type AliasQuestion,
  type ExecutionResult,
  type PipelineDeps,
  type PrepareResult,
} from './pipeline-types.js';
import { loadIpvPreview } from './previews.js';
import {
  ensureSummaryTab,
  ensureTemplate,
  syncConfigTab,
  TEMPLATE_TAB,
} from './sheet-structure.js';

/** Pestaña del cuadre de un día: `03`. */
export function dayTab(ref: DayRef): string {
  return String(ref.day).padStart(2, '0');
}

export interface LoadIpvRequest {
  ipv: IpvDay;
  /** Mes del día (`2026-11`): la pestaña se crea en el libro de ese mes. */
  month: MonthKey;
  /** TC del día si ya se conoce; si no, queda vacía y se fija con /tc. */
  tc: number | null;
  /** Productos del IPV que la dueña ya marcó como nuevos: no se vuelven a preguntar. */
  skipAliasQuestions?: readonly string[];
}

/**
 * Paso 1 de /ipv: arma la hoja del día, corre las validaciones, compara la venta con
 * el IPV y deja la escritura pendiente de confirmación. No escribe en la hoja.
 */
export async function prepareIpvLoad(
  deps: PipelineDeps,
  actor: Actor,
  { ipv, tc, month, skipAliasQuestions = [] }: LoadIpvRequest,
): Promise<PrepareResult> {
  const book = deps.books.forMonth(month);
  if (book === null) return { status: PREPARE_STATUS.REJECTED, message: noBookMessage(month) };

  const tab = dayTab(ipv);
  const tabs = await book.sheets.listTabs();
  if (tabs.some((existing) => existing.title === tab)) {
    return {
      status: PREPARE_STATUS.REJECTED,
      message: `La pestaña ${tab} ya existe en el cuadre. No se sobrescribe: si hay que rehacerla, usa /deshacer o bórrala a mano.`,
    };
  }

  let cuadreCosts: CostSource[][];
  try {
    // Último costo conocido: todo el mes anterior (otro libro) y los días previos de este.
    const before = previousBook(deps.books, book);
    const earlier =
      before === null ? [] : await before.cuadre.readDays(await before.cuadre.listDays());
    const previous = cuadreTabsBefore(await book.cuadre.listDays(), ipv.day);
    cuadreCosts = [...earlier, ...(await book.cuadre.readDays(previous))].map(
      (sheet) => sheet.rows,
    );
  } catch (error) {
    return {
      status: PREPARE_STATUS.REJECTED,
      message: `No pude leer los costos del cuadre: ${errorText(error)}. Prueba de nuevo en un momento.`,
    };
  }
  const costs = buildLastKnownCosts(deps.catalog.costSources(), cuadreCosts);
  if (costs.size === 0) {
    return {
      status: PREPARE_STATUS.REJECTED,
      message:
        'No hay costos: el cuadre no tiene días anteriores y el catálogo está vacío. Carga los costos antes del primer IPV.',
    };
  }

  const draft = buildCuadreDraft(ipv, costs, deps.catalog.equivalences());
  const totals = computeTotals(draft.rows);
  const sales = checkIpvSales(draft.rows, ipv.importeTotal, ipv.format);
  const ipvFindings = validateIpv(ipv);
  const blockers = ipvLoadBlockers(ipvFindings, sales);
  const alerts = sortFindings([...ipvFindings, ...salesFindings(sales, formatDayRef(ipv))]);
  // Un mes cerrado con /cierremes se escribe solo forzando (dueña + motivo).
  const closed = isMonthClosed(deps.settings, month) ? closedMonthBlocker(month) : null;
  const blocked = blockers.length > 0 || closed !== null;
  const canForce = blocked && can(actor.role, PERMISSION.FORCE_CONFIRM);
  const skip = new Set(skipAliasQuestions);
  const aliasQuestions: AliasQuestion[] = can(actor.role, PERMISSION.MANAGE_EQUIVALENCES)
    ? draft.unmatched
        .filter((item) => item.suggestions.length > 0 && !skip.has(item.ipvProduct))
        .map((item) => ({
          ipvProduct: item.ipvProduct,
          candidates: item.suggestions.map((suggestion) => suggestion.product),
        }))
    : [];

  const draftPreview = loadIpvPreview({
    tab,
    ipvTab: ipv.tabName.trim(),
    draft,
    totals,
    sales,
    tc,
    alerts,
    blockers,
    showFinancials: can(actor.role, PERMISSION.VIEW_FINANCIALS),
    canForce,
    askAliases: aliasQuestions.length > 0,
  });
  const preview = closed === null ? draftPreview : `${draftPreview}\n\n🔒 ${closed}.`;

  if (blocked && !canForce) return { status: PREPARE_STATUS.BLOCKED, preview, aliasQuestions };

  const payload: LoadIpvPayload = {
    tab,
    month,
    ipvTab: ipv.tabName.trim(),
    sheetValues: draft.sheetValues,
    yellowCells: draft.yellowCells,
    tc,
    ventaTotal: totals.ventaTotal,
    utilidadBruta: totals.utilidadBruta,
    blockers: [
      ...blockers.map((f) => (f.product === null ? f.detail : `${f.product}: ${f.detail}`)),
      ...(closed === null ? [] : [closed]),
    ],
  };
  const action = deps.pending.create({
    telegramId: actor.telegramId,
    kind: PENDING_KIND.LOAD_IPV,
    payload,
  });
  return {
    status: PREPARE_STATUS.READY,
    pendingId: action.id,
    preview,
    requiresForce: blocked,
    aliasQuestions,
  };
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Paso 2, ya confirmado: snapshot → log → `_plantilla` → duplicar a `DD` → valores →
 * TC → amarillo → `_config` y `Resumen`. Si algo falla, borra la pestaña que alcanzó a crear.
 */
export async function executeIpvLoad(
  deps: PipelineDeps,
  telegramId: number,
  payload: LoadIpvPayload,
  forceReason: string | null,
): Promise<ExecutionResult> {
  const { changeLog, snapshots } = deps;
  const { tab, month } = payload;
  const book = bookOfWrite(deps.books, month);
  if (book === null) {
    return { ok: false, message: noBookMessage(month ?? deps.books.defaultMonth) };
  }
  const { sheets } = book;

  const changeLogId = changeLog.record({
    telegramId,
    action: 'load_ipv',
    target: tab,
    detail: {
      month: book.month,
      ipvTab: payload.ipvTab,
      ventaTotal: payload.ventaTotal,
      utilidadBruta: payload.utilidadBruta,
      rows: payload.sheetValues.length,
      missingCost: payload.yellowCells.length,
      forced: forceReason === null ? null : { reason: forceReason, blockers: payload.blockers },
    },
  });
  const snapshot = snapshots.create({
    changeLogId,
    telegramId,
    payload: { kind: SNAPSHOT_KIND.CREATE_TAB, tab, month: book.month },
  });

  let created = false;
  try {
    await ensureTemplate(sheets);
    if ((await sheets.listTabs()).some((existing) => existing.title === tab)) {
      throw new Error(`La pestaña ${tab} apareció mientras se confirmaba; no se sobrescribe.`);
    }
    await sheets.duplicateTab(TEMPLATE_TAB, tab, { hidden: false });
    created = true;

    const lastRow = String(payload.sheetValues.length + 1);
    await sheets.writeRanges([
      { tab, a1: `A2:N${lastRow}`, values: payload.sheetValues },
      ...(payload.tc === null ? [] : [{ tab, a1: TC_VALUE_CELL, values: [[payload.tc]] }]),
    ]);
    await sheets.setBackground(tab, payload.yellowCells, YELLOW);
  } catch (error) {
    if (created) await sheets.deleteTab(tab).catch(() => undefined);
    snapshots.markReverted(snapshot.id);
    changeLog.record({
      telegramId,
      action: 'load_ipv_failed',
      target: tab,
      detail: { error: errorText(error), changeLogId },
    });
    return { ok: false, message: `No se pudo crear la pestaña ${tab}: ${errorText(error)}` };
  }

  // `_config` y `Resumen` son espejos: si fallan, la carga del día sigue siendo válida.
  let configNote = '';
  try {
    await syncConfigTab(sheets, deps.catalog.listProducts(), deps.clock());
  } catch (error) {
    configNote = `\n⚠️ No se pudo actualizar _config: ${errorText(error)}`;
  }
  try {
    await ensureSummaryTab(sheets);
  } catch (error) {
    configNote += `\n⚠️ No se pudo crear la pestaña Resumen: ${errorText(error)}`;
  }

  const yellow =
    payload.yellowCells.length === 0
      ? ''
      : ` ${String(payload.yellowCells.length)} costos faltantes en amarillo.`;
  return {
    ok: true,
    message: `✅ Pestaña ${tab} creada con ${String(payload.sheetValues.length)} productos.${yellow}${configNote}`,
  };
}
