import { can, PERMISSION } from '../core/auth.js';
import { checkIpvSales, computeTotals } from '../core/calc.js';
import { buildCostCatalog } from '../core/costs.js';
import { buildCuadreDraft } from '../core/cuadre-builder.js';
import { TC_VALUE_CELL } from '../core/cuadre-layout.js';
import { formatDayRef } from '../core/tabs.js';
import type { DayRef, IpvDay } from '../core/types.js';
import { ipvLoadBlockers, salesFindings, sortFindings, validateIpv } from '../core/validations.js';
import { PENDING_KIND, SNAPSHOT_KIND } from '../ports/repositories.js';
import { YELLOW } from '../ports/sheets-gateway.js';
import type { LoadIpvPayload } from './pending-payloads.js';
import {
  PREPARE_STATUS,
  type Actor,
  type ExecutionResult,
  type PipelineDeps,
  type PrepareResult,
} from './pipeline-types.js';
import { loadIpvPreview } from './previews.js';
import { ensureTemplate, syncConfigTab, TEMPLATE_TAB } from './sheet-structure.js';

/** Pestaña del cuadre de un día: `03`. */
export function dayTab(ref: DayRef): string {
  return String(ref.day).padStart(2, '0');
}

export interface LoadIpvRequest {
  ipv: IpvDay;
  /** TC del día si ya se conoce; si no, queda vacía y se fija con /tc. */
  tc: number | null;
}

/**
 * Paso 1 de /ipv: arma la hoja del día, corre las validaciones, compara la venta con
 * el IPV y deja la escritura pendiente de confirmación. No escribe en la hoja.
 */
export async function prepareIpvLoad(
  deps: PipelineDeps,
  actor: Actor,
  { ipv, tc }: LoadIpvRequest,
): Promise<PrepareResult> {
  const costSources = deps.catalog.costSources();
  if (costSources.length === 0) {
    return {
      status: PREPARE_STATUS.REJECTED,
      message: 'El catálogo está vacío: hay que cargar los costos del cuadre antes del primer IPV.',
    };
  }

  const tab = dayTab(ipv);
  const tabs = await deps.sheets.listTabs();
  if (tabs.some((existing) => existing.title === tab)) {
    return {
      status: PREPARE_STATUS.REJECTED,
      message: `La pestaña ${tab} ya existe en el cuadre. No se sobrescribe: si hay que rehacerla, usa /deshacer o bórrala a mano.`,
    };
  }

  const draft = buildCuadreDraft(ipv, buildCostCatalog(costSources), deps.catalog.equivalences());
  const totals = computeTotals(draft.rows);
  const sales = checkIpvSales(draft.rows, ipv.importeTotal);
  const ipvFindings = validateIpv(ipv);
  const blockers = ipvLoadBlockers(ipvFindings, sales);
  const alerts = sortFindings([...ipvFindings, ...salesFindings(sales, formatDayRef(ipv))]);
  const canForce = blockers.length > 0 && can(actor.role, PERMISSION.FORCE_CONFIRM);

  const preview = loadIpvPreview({
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
  });

  if (blockers.length > 0 && !canForce) return { status: PREPARE_STATUS.BLOCKED, preview };

  const payload: LoadIpvPayload = {
    tab,
    ipvTab: ipv.tabName.trim(),
    sheetValues: draft.sheetValues,
    yellowCells: draft.yellowCells,
    tc,
    ventaTotal: totals.ventaTotal,
    utilidadBruta: totals.utilidadBruta,
    blockers: blockers.map((f) => (f.product === null ? f.detail : `${f.product}: ${f.detail}`)),
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
    requiresForce: blockers.length > 0,
  };
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Paso 2, ya confirmado: snapshot → log → `_plantilla` → duplicar a `DD` → valores →
 * TC → amarillo → `_config`. Si algo falla, borra la pestaña que alcanzó a crear.
 */
export async function executeIpvLoad(
  deps: PipelineDeps,
  telegramId: number,
  payload: LoadIpvPayload,
  forceReason: string | null,
): Promise<ExecutionResult> {
  const { sheets, changeLog, snapshots } = deps;
  const { tab } = payload;

  const changeLogId = changeLog.record({
    telegramId,
    action: 'load_ipv',
    target: tab,
    detail: {
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
    payload: { kind: SNAPSHOT_KIND.CREATE_TAB, tab },
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

  // `_config` es un espejo: si falla, la carga del día sigue siendo válida.
  let configNote = '';
  try {
    await syncConfigTab(sheets, deps.catalog.listProducts(), deps.clock());
  } catch (error) {
    configNote = `\n⚠️ No se pudo actualizar _config: ${errorText(error)}`;
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
