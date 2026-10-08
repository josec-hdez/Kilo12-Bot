import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../src/adapters/sqlite/db.js';
import {
  SqliteChangeLogRepository,
  SqliteSnapshotRepository,
} from '../../../src/adapters/sqlite/history-repo.js';
import { SNAPSHOT_KIND } from '../../../src/ports/repositories.js';

let changeLog: SqliteChangeLogRepository;
let snapshots: SqliteSnapshotRepository;

beforeEach(() => {
  const db = openDatabase(':memory:');
  changeLog = new SqliteChangeLogRepository(db);
  snapshots = new SqliteSnapshotRepository(db, () => new Date('2026-10-07T21:00:00Z'));
});

describe('SqliteChangeLogRepository', () => {
  it('guarda quién cambió qué, con el detalle en JSON', () => {
    const id = changeLog.record({
      telegramId: 10,
      action: 'load_ipv',
      target: '03',
      detail: { ventaTotal: 90_356, forced: null },
    });
    expect(changeLog.list()).toEqual([
      expect.objectContaining({
        id,
        telegramId: 10,
        action: 'load_ipv',
        target: '03',
        detail: { ventaTotal: 90_356, forced: null },
      }),
    ]);
  });
});

describe('SqliteSnapshotRepository', () => {
  it('devuelve la última escritura sin deshacer, de un usuario o de cualquiera', () => {
    const tab = snapshots.create({
      changeLogId: null,
      telegramId: 10,
      payload: { kind: SNAPSHOT_KIND.CREATE_TAB, tab: '03' },
    });
    const cells = snapshots.create({
      changeLogId: null,
      telegramId: 20,
      payload: {
        kind: SNAPSHOT_KIND.CELLS,
        tab: '03',
        ranges: [{ a1: 'P18:Q18', values: [['TC.', '']] }],
      },
    });

    expect(snapshots.lastActive()?.id).toBe(cells.id);
    expect(snapshots.lastActive(10)?.id).toBe(tab.id);
    expect(snapshots.get(cells.id)?.payload).toEqual(cells.payload);

    snapshots.markReverted(cells.id);
    expect(snapshots.get(cells.id)?.revertedAt).toBe('2026-10-07T21:00:00.000Z');
    expect(snapshots.lastActive()?.id).toBe(tab.id);
    expect(snapshots.lastActive(20)).toBeUndefined();
  });
});
