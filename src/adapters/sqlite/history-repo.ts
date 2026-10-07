import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  SNAPSHOT_KIND,
  type ChangeLogEntry,
  type Clock,
  type ChangeLogInput,
  type ChangeLogRepository,
  type NewSnapshot,
  type Snapshot,
  type SnapshotPayload,
  type SnapshotRepository,
} from '../../ports/repositories.js';
import type { Database } from './db.js';
import { changeLog, snapshots } from './schema.js';

/** Log de cambios: quién cambió qué y cuándo. Solo se agrega, nunca se edita. */
export class SqliteChangeLogRepository implements ChangeLogRepository {
  constructor(private readonly db: Database) {}

  record(entry: ChangeLogInput): number {
    const row = this.db
      .insert(changeLog)
      .values({
        telegramId: entry.telegramId,
        action: entry.action,
        target: entry.target,
        detail: JSON.stringify(entry.detail ?? null),
      })
      .returning({ id: changeLog.id })
      .get();
    return row.id;
  }

  list(): ChangeLogEntry[] {
    return this.db
      .select()
      .from(changeLog)
      .orderBy(asc(changeLog.id))
      .all()
      .map((row) => ({
        id: row.id,
        telegramId: row.telegramId,
        action: row.action,
        target: row.target,
        detail: row.detail === null ? null : (JSON.parse(row.detail) as unknown),
        at: row.at,
      }));
  }
}

type SnapshotRow = typeof snapshots.$inferSelect;

function isSnapshotPayload(value: unknown): value is SnapshotPayload {
  if (typeof value !== 'object' || value === null) return false;
  if (!('kind' in value) || !('tab' in value) || typeof value.tab !== 'string') return false;
  if (value.kind === SNAPSHOT_KIND.CREATE_TAB) return true;
  return value.kind === SNAPSHOT_KIND.CELLS && 'ranges' in value && Array.isArray(value.ranges);
}

function toSnapshot(row: SnapshotRow): Snapshot {
  const payload: unknown = JSON.parse(row.payload);
  if (!isSnapshotPayload(payload) || payload.kind !== row.kind) {
    throw new Error(`Snapshot ${row.id} con contenido desconocido en la base.`);
  }
  return {
    id: row.id,
    changeLogId: row.changeLogId,
    telegramId: row.telegramId,
    payload,
    createdAt: row.createdAt,
    revertedAt: row.revertedAt,
  };
}

/** Estado previo a cada escritura en Sheets, para `/deshacer`. Sin pestañas `_bak_*`. */
export class SqliteSnapshotRepository implements SnapshotRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock = () => new Date(),
  ) {}

  create(snapshot: NewSnapshot): Snapshot {
    const row = this.db
      .insert(snapshots)
      .values({
        changeLogId: snapshot.changeLogId,
        telegramId: snapshot.telegramId,
        kind: snapshot.payload.kind,
        payload: JSON.stringify(snapshot.payload),
        createdAt: this.clock().toISOString(),
      })
      .returning()
      .get();
    return toSnapshot(row);
  }

  get(id: number): Snapshot | undefined {
    const row = this.db.select().from(snapshots).where(eq(snapshots.id, id)).get();
    return row === undefined ? undefined : toSnapshot(row);
  }

  lastActive(telegramId?: number): Snapshot | undefined {
    const active = isNull(snapshots.revertedAt);
    const row = this.db
      .select()
      .from(snapshots)
      .where(telegramId === undefined ? active : and(active, eq(snapshots.telegramId, telegramId)))
      .orderBy(desc(snapshots.id))
      .get();
    return row === undefined ? undefined : toSnapshot(row);
  }

  markReverted(id: number): void {
    this.db
      .update(snapshots)
      .set({ revertedAt: this.clock().toISOString() })
      .where(eq(snapshots.id, id))
      .run();
  }
}
