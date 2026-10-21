import { can, PERMISSION } from '../core/auth.js';
import { PENDING_KIND, SNAPSHOT_KIND, type Snapshot } from '../ports/repositories.js';
import { closedMonthBlocker, isMonthClosed } from './closed-months.js';
import { bookOfWrite, noBookMessage } from './cuadre-books.js';
import type { UndoPayload } from './pending-payloads.js';
import {
  PREPARE_STATUS,
  type Actor,
  type ExecutionResult,
  type PipelineDeps,
  type PrepareResult,
} from './pipeline-types.js';

/**
 * /deshacer revierte la última escritura sin deshacer. Una dueña deshace la última
 * de cualquiera (hoy solo las dueñas tienen /deshacer); otro rol, solo la suya.
 * Deshacer no guarda snapshot propio: no hay "rehacer".
 */
function lastUndoable(deps: PipelineDeps, actor: Actor): Snapshot | undefined {
  return can(actor.role, PERMISSION.CONFIGURE)
    ? deps.snapshots.lastActive()
    : deps.snapshots.lastActive(actor.telegramId);
}

function describe(snapshot: Snapshot): string {
  const { payload } = snapshot;
  return payload.kind === SNAPSHOT_KIND.CREATE_TAB
    ? `borrar la pestaña ${payload.tab} (creada el ${snapshot.createdAt}). Si alguien la editó a mano después, esos cambios se pierden.`
    : `restaurar ${payload.ranges.map((range) => range.a1).join(', ')} de la pestaña ${payload.tab} como estaba el ${snapshot.createdAt}.`;
}

export function prepareUndo(deps: PipelineDeps, actor: Actor): PrepareResult {
  const snapshot = lastUndoable(deps, actor);
  if (snapshot === undefined) {
    return { status: PREPARE_STATUS.REJECTED, message: 'No hay escrituras para deshacer.' };
  }
  // Un mes cerrado con /cierremes se cambia solo forzando (dueña + motivo).
  const month = snapshot.payload.month ?? deps.books.defaultMonth;
  const closed = isMonthClosed(deps.settings, month) ? closedMonthBlocker(month) : null;
  const base = `↩️ Deshacer: ${describe(snapshot)}`;
  const preview = closed === null ? base : `${base}\n\n🔒 ${closed}.`;
  if (closed !== null && !can(actor.role, PERMISSION.FORCE_CONFIRM)) {
    return { status: PREPARE_STATUS.BLOCKED, preview };
  }

  const payload: UndoPayload = {
    snapshotId: snapshot.id,
    ...(closed === null ? {} : { blockers: [closed] }),
  };
  const action = deps.pending.create({
    telegramId: actor.telegramId,
    kind: PENDING_KIND.UNDO,
    payload,
  });
  return {
    status: PREPARE_STATUS.READY,
    pendingId: action.id,
    preview,
    requiresForce: closed !== null,
  };
}

export async function executeUndo(
  deps: PipelineDeps,
  telegramId: number,
  { snapshotId }: UndoPayload,
): Promise<ExecutionResult> {
  const snapshot = deps.snapshots.get(snapshotId);
  if (snapshot === undefined || snapshot.revertedAt !== null) {
    return { ok: false, message: 'Esa escritura ya se deshizo o no existe.' };
  }

  const { payload } = snapshot;
  const book = bookOfWrite(deps.books, payload.month);
  if (book === null) {
    return { ok: false, message: noBookMessage(payload.month ?? deps.books.defaultMonth) };
  }
  const { sheets } = book;
  let note = '';
  try {
    if (payload.kind === SNAPSHOT_KIND.CREATE_TAB) {
      const tabs = await sheets.listTabs();
      if (tabs.some((tab) => tab.title === payload.tab)) await sheets.deleteTab(payload.tab);
      else note = ` La pestaña ${payload.tab} ya no existía.`;
    } else {
      await sheets.writeRanges(
        payload.ranges.map(({ a1, values }) => ({ tab: payload.tab, a1, values })),
      );
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `No se pudo deshacer: ${reason}` };
  }

  deps.snapshots.markReverted(snapshot.id);
  deps.changeLog.record({
    telegramId,
    action: 'undo',
    target: payload.tab,
    detail: { snapshotId, kind: payload.kind, changeLogId: snapshot.changeLogId },
  });
  return {
    ok: true,
    message:
      payload.kind === SNAPSHOT_KIND.CREATE_TAB
        ? `↩️ Pestaña ${payload.tab} eliminada.${note}`
        : `↩️ Pestaña ${payload.tab} restaurada.`,
  };
}
