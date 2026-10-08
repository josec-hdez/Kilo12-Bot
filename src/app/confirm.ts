import { can, PERMISSION } from '../core/auth.js';
import {
  PENDING_KIND,
  PENDING_STATUS,
  RESOLVE_RESULT,
  type PendingAction,
  type ResolveResult,
} from '../ports/repositories.js';
import { executeIpvLoad } from './load-ipv.js';
import { isLoadIpvPayload, isSetTcPayload, isUndoPayload } from './pending-payloads.js';
import {
  CONFIRM_STATUS,
  type Actor,
  type ConfirmResult,
  type ExecutionResult,
  type PipelineDeps,
} from './pipeline-types.js';
import { executeSetTc } from './set-tc.js';
import { executeUndo } from './undo.js';

export interface ConfirmRequest {
  pendingId: string;
  /** "⚠️ Confirmar igual": motivo obligatorio. `undefined` = confirmación normal. */
  forceReason?: string;
}

function unresolved(result: Exclude<ResolveResult, { status: 'ok' }>): ConfirmResult {
  switch (result.status) {
    case RESOLVE_RESULT.NOT_FOUND:
      return { status: CONFIRM_STATUS.NOT_FOUND, message: 'Esa acción no existe.' };
    case RESOLVE_RESULT.EXPIRED:
      return {
        status: CONFIRM_STATUS.EXPIRED,
        message: 'La acción venció (15 minutos). Vuelve a pedirla.',
      };
    case RESOLVE_RESULT.ALREADY_RESOLVED:
      return {
        status: CONFIRM_STATUS.ALREADY_RESOLVED,
        message: `Esa acción ya está ${result.resolution === 'confirmed' ? 'confirmada' : 'cerrada'}.`,
      };
    case RESOLVE_RESULT.NOT_OWNER:
      return {
        status: CONFIRM_STATUS.NOT_OWNER,
        message: 'Solo quien pidió la acción puede confirmarla o cancelarla.',
      };
  }
}

/** Bloqueos de una carga de IPV: vacío si no es carga o si se puede confirmar. */
function blockersOf(action: PendingAction): string[] {
  return action.kind === PENDING_KIND.LOAD_IPV && isLoadIpvPayload(action.payload)
    ? action.payload.blockers
    : [];
}

/**
 * ✅ Confirmar. Revisa los bloqueos ANTES de consumir la acción: una confirmación
 * rechazada deja la acción pendiente para que una dueña pueda forzarla.
 */
export async function confirmPending(
  deps: PipelineDeps,
  actor: Actor,
  { pendingId, forceReason }: ConfirmRequest,
): Promise<ConfirmResult> {
  const action = deps.pending.get(pendingId);
  if (action === undefined) return unresolved({ status: RESOLVE_RESULT.NOT_FOUND });
  if (action.telegramId !== actor.telegramId) {
    return unresolved({ status: RESOLVE_RESULT.NOT_OWNER });
  }
  const stale =
    action.status !== PENDING_STATUS.PENDING ||
    action.expiresAt.getTime() <= deps.clock().getTime();
  if (stale) {
    // El repositorio decide si venció o ya estaba resuelta (y la marca como vencida).
    const resolved = deps.pending.confirm(pendingId, actor.telegramId);
    if (resolved.status !== RESOLVE_RESULT.OK) return unresolved(resolved);
  }

  const blockers = blockersOf(action);
  let reason: string | null = null;
  if (blockers.length > 0) {
    if (forceReason === undefined) {
      return {
        status: CONFIRM_STATUS.BLOCKED,
        message: `No se puede confirmar: ${blockers.join(' · ')}`,
      };
    }
    if (!can(actor.role, PERMISSION.FORCE_CONFIRM)) {
      return {
        status: CONFIRM_STATUS.FORBIDDEN,
        message: 'Solo una dueña puede confirmar con bloqueos.',
      };
    }
    reason = forceReason.trim();
    if (reason === '') {
      return {
        status: CONFIRM_STATUS.REASON_REQUIRED,
        message: 'Para confirmar igual hay que escribir el motivo; queda en el log.',
      };
    }
  }

  const resolved = deps.pending.confirm(pendingId, actor.telegramId);
  if (resolved.status !== RESOLVE_RESULT.OK) return unresolved(resolved);

  const result = await execute(deps, resolved.action, reason);
  return {
    status: result.ok ? CONFIRM_STATUS.DONE : CONFIRM_STATUS.FAILED,
    message: result.message,
  };
}

function execute(
  deps: PipelineDeps,
  action: PendingAction,
  forceReason: string | null,
): Promise<ExecutionResult> {
  const { payload, telegramId } = action;
  switch (action.kind) {
    case PENDING_KIND.LOAD_IPV:
      if (isLoadIpvPayload(payload)) return executeIpvLoad(deps, telegramId, payload, forceReason);
      break;
    case PENDING_KIND.SET_TC:
      if (isSetTcPayload(payload)) return executeSetTc(deps, telegramId, payload);
      break;
    case PENDING_KIND.UNDO:
      if (isUndoPayload(payload)) return executeUndo(deps, telegramId, payload);
      break;
  }
  return Promise.resolve({ ok: false, message: 'La acción guardada está dañada; no se ejecutó.' });
}

/** ❌ Cancelar: no escribe nada. */
export function cancelPending(deps: PipelineDeps, actor: Actor, pendingId: string): ConfirmResult {
  const resolved = deps.pending.cancel(pendingId, actor.telegramId);
  if (resolved.status !== RESOLVE_RESULT.OK) return unresolved(resolved);
  return { status: CONFIRM_STATUS.DONE, message: 'Cancelado. No se escribió nada.' };
}
