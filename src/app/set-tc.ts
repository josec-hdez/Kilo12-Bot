import { parseTc, TC_LABEL_CELL, TC_VALUE_CELL } from '../core/cuadre-layout.js';
import { can, PERMISSION } from '../core/auth.js';
import { PENDING_KIND, SNAPSHOT_KIND, type RangeSnapshot } from '../ports/repositories.js';
import { RENDER, type CellValue, type Grid, type SheetsGateway } from '../ports/sheets-gateway.js';
import { closedMonthBlocker, isMonthClosed } from './closed-months.js';
import { bookOfWrite, noBookMessage } from './cuadre-books.js';
import type { SetTcPayload } from './pending-payloads.js';
import {
  PREPARE_STATUS,
  type Actor,
  type ExecutionResult,
  type PipelineDeps,
  type PrepareResult,
} from './pipeline-types.js';
import { fmt } from './previews.js';

/** P18 (etiqueta) y Q18 (valor), según el layout aprobado. */
const TC_RANGE = `${TC_LABEL_CELL}:${TC_VALUE_CELL}`;
const TC_LABEL = 'TC.';
const TC_LABEL_PATTERN = /^\s*tc\b/i;

/** Completa con `''` hasta `rows × columns`: Sheets omite las celdas vacías del final. */
export function padGrid(grid: Grid, rows: number, columns: number): Grid {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column): CellValue => grid[row]?.[column] ?? ''),
  );
}

interface TcCells {
  label: CellValue;
  value: CellValue;
}

async function readTcCells(sheets: SheetsGateway, tab: string): Promise<TcCells> {
  const [grid = []] = await sheets.readRanges([{ tab, a1: TC_RANGE }], RENDER.FORMULA);
  const [[label = '', value = ''] = []] = padGrid(grid, 1, 2);
  return { label, value };
}

/**
 * P18 tiene que estar vacía o tener la etiqueta de la TC (`TC.` o el formato
 * antiguo `TC. 780`). Si tiene otra cosa (la hoja 04 tiene el resumen corrido), no
 * se escribe: cambiaría el layout de esa hoja.
 */
const knownLayout = (label: CellValue): boolean =>
  label === '' || (typeof label === 'string' && TC_LABEL_PATTERN.test(label));

/** Paso 1 de /tc: valida y deja la escritura pendiente. No escribe. */
export async function prepareSetTc(
  deps: PipelineDeps,
  actor: Actor,
  { tab, tc, month }: SetTcPayload,
): Promise<PrepareResult> {
  if (!Number.isFinite(tc) || tc <= 0) {
    return {
      status: PREPARE_STATUS.REJECTED,
      message: 'La TC tiene que ser un número mayor que 0.',
    };
  }
  const book = bookOfWrite(deps.books, month);
  if (book === null) {
    return {
      status: PREPARE_STATUS.REJECTED,
      message: noBookMessage(month ?? deps.books.defaultMonth),
    };
  }
  const tabs = await book.sheets.listTabs();
  if (!tabs.some((existing) => existing.title === tab)) {
    return {
      status: PREPARE_STATUS.REJECTED,
      message: `No existe la pestaña ${tab} en el cuadre. Carga primero el IPV del día.`,
    };
  }

  const current = await readTcCells(book.sheets, tab);
  if (!knownLayout(current.label)) {
    return {
      status: PREPARE_STATUS.REJECTED,
      message: `En la pestaña ${tab} la celda ${TC_LABEL_CELL} tiene "${String(current.label)}", no la TC. No se escribe para no cambiar el layout de esa hoja.`,
    };
  }

  const previous = parseTc(current.label, current.value);
  const base = `💱 TC de la pestaña ${tab}: ${previous === null ? 'vacía' : fmt(previous)} → ${fmt(tc)} CUP por USD`;
  // Un mes cerrado con /cierremes se escribe solo forzando (dueña + motivo).
  const closed = isMonthClosed(deps.settings, book.month) ? closedMonthBlocker(book.month) : null;
  const preview = closed === null ? base : `${base}\n\n🔒 ${closed}.`;
  if (closed !== null && !can(actor.role, PERMISSION.FORCE_CONFIRM)) {
    return { status: PREPARE_STATUS.BLOCKED, preview };
  }

  const payload: SetTcPayload = {
    tab,
    tc,
    month: book.month,
    ...(closed === null ? {} : { blockers: [closed] }),
  };
  const action = deps.pending.create({
    telegramId: actor.telegramId,
    kind: PENDING_KIND.SET_TC,
    payload,
  });
  return {
    status: PREPARE_STATUS.READY,
    pendingId: action.id,
    preview,
    requiresForce: closed !== null,
  };
}

/** Paso 2, ya confirmado: guarda P18:Q18 tal como estaban, escribe y registra. */
export async function executeSetTc(
  deps: PipelineDeps,
  telegramId: number,
  { tab, tc, month }: SetTcPayload,
): Promise<ExecutionResult> {
  const book = bookOfWrite(deps.books, month);
  if (book === null) return { ok: false, message: noBookMessage(month ?? deps.books.defaultMonth) };
  const current = await readTcCells(book.sheets, tab);
  if (!knownLayout(current.label)) {
    return {
      ok: false,
      message: `La celda ${TC_LABEL_CELL} de ${tab} cambió; no se escribe la TC.`,
    };
  }

  const before: RangeSnapshot = { a1: TC_RANGE, values: [[current.label, current.value]] };
  const changeLogId = deps.changeLog.record({
    telegramId,
    action: 'set_tc',
    target: tab,
    detail: { month: book.month, previous: parseTc(current.label, current.value), tc },
  });
  const snapshot = deps.snapshots.create({
    changeLogId,
    telegramId,
    payload: { kind: SNAPSHOT_KIND.CELLS, tab, ranges: [before], month: book.month },
  });

  try {
    await book.sheets.writeRanges([{ tab, a1: TC_RANGE, values: [[TC_LABEL, tc]] }]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    deps.snapshots.markReverted(snapshot.id);
    deps.changeLog.record({
      telegramId,
      action: 'set_tc_failed',
      target: tab,
      detail: { error: reason, changeLogId },
    });
    return { ok: false, message: `No se pudo escribir la TC en ${tab}: ${reason}` };
  }
  return { ok: true, message: `✅ TC de ${tab}: ${fmt(tc)}.` };
}
