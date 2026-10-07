import { randomBytes } from 'node:crypto';
import { and, eq, lte } from 'drizzle-orm';
import {
  PENDING_KIND,
  PENDING_STATUS,
  RESOLVE_RESULT,
  type Clock,
  type NewPendingAction,
  type PendingAction,
  type PendingActionRepository,
  type PendingKind,
  type PendingStatus,
  type ResolveResult,
} from '../../ports/repositories.js';
import type { Database } from './db.js';
import { pendingActions } from './schema.js';

/** Plazo para tocar ✅ Confirmar; después, "acción vencida". */
export const PENDING_TTL_MS = 15 * 60_000;

type PendingRow = typeof pendingActions.$inferSelect;

function oneOf<T extends string>(values: readonly T[], value: string, what: string): T {
  const found = values.find((known) => known === value);
  if (found === undefined) throw new Error(`${what} desconocido en la base: "${value}"`);
  return found;
}

function toAction(row: PendingRow): PendingAction {
  return {
    id: row.id,
    telegramId: row.telegramId,
    kind: oneOf<PendingKind>(Object.values(PENDING_KIND), row.kind, 'Tipo de acción'),
    payload: JSON.parse(row.payload) as unknown,
    status: oneOf<PendingStatus>(Object.values(PENDING_STATUS), row.status, 'Estado'),
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
  };
}

export class SqlitePendingActionRepository implements PendingActionRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock = () => new Date(),
  ) {}

  create(action: NewPendingAction): PendingAction {
    const createdAt = this.clock();
    const row: PendingRow = {
      // 12 caracteres: cabe holgado en los 64 bytes del callback_data de Telegram.
      id: randomBytes(9).toString('base64url'),
      telegramId: action.telegramId,
      kind: action.kind,
      payload: JSON.stringify(action.payload),
      status: PENDING_STATUS.PENDING,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PENDING_TTL_MS).toISOString(),
    };
    this.db.insert(pendingActions).values(row).run();
    return toAction(row);
  }

  get(id: string): PendingAction | undefined {
    const row = this.db.select().from(pendingActions).where(eq(pendingActions.id, id)).get();
    return row === undefined ? undefined : toAction(row);
  }

  confirm(id: string, telegramId: number): ResolveResult {
    return this.resolve(id, telegramId, PENDING_STATUS.CONFIRMED);
  }

  cancel(id: string, telegramId: number): ResolveResult {
    return this.resolve(id, telegramId, PENDING_STATUS.CANCELLED);
  }

  expireStale(): number {
    return this.db
      .update(pendingActions)
      .set({ status: PENDING_STATUS.EXPIRED })
      .where(
        and(
          eq(pendingActions.status, PENDING_STATUS.PENDING),
          lte(pendingActions.expiresAt, this.clock().toISOString()),
        ),
      )
      .run().changes;
  }

  /** Lee y actualiza en una transacción: dos toques al mismo botón no confirman dos veces. */
  private resolve(id: string, telegramId: number, to: PendingStatus): ResolveResult {
    return this.db.transaction((tx): ResolveResult => {
      const row = tx.select().from(pendingActions).where(eq(pendingActions.id, id)).get();
      if (row === undefined) return { status: RESOLVE_RESULT.NOT_FOUND };

      const action = toAction(row);
      if (action.telegramId !== telegramId) return { status: RESOLVE_RESULT.NOT_OWNER };
      if (action.status !== PENDING_STATUS.PENDING) {
        return { status: RESOLVE_RESULT.ALREADY_RESOLVED, resolution: action.status };
      }
      if (action.expiresAt.getTime() <= this.clock().getTime()) {
        tx.update(pendingActions)
          .set({ status: PENDING_STATUS.EXPIRED })
          .where(eq(pendingActions.id, id))
          .run();
        return { status: RESOLVE_RESULT.EXPIRED };
      }

      tx.update(pendingActions).set({ status: to }).where(eq(pendingActions.id, id)).run();
      return { status: RESOLVE_RESULT.OK, action: { ...action, status: to } };
    });
  }
}
