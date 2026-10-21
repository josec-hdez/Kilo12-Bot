import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import { SqliteSettingsRepository } from '../../src/adapters/sqlite/settings-repo.js';
import { SqliteUserRepository } from '../../src/adapters/sqlite/users-repo.js';
import {
  ANNOUNCE_STATUS,
  announceRelease,
  type AnnounceDeps,
} from '../../src/app/announce-release.js';
import { ROLE } from '../../src/core/auth.js';
import { ANNOUNCED_VERSION_KEY } from '../../src/core/release.js';
import type { User } from '../../src/ports/repositories.js';

const RELEASE = { version: 'b2', notes: ['feat: algo nuevo'] };

let settings: SqliteSettingsRepository;
let users: SqliteUserRepository;
let sent: { id: number; text: string }[];
let failIds: Set<number>;
let pauses: number;

function deps(): AnnounceDeps {
  return {
    users,
    settings,
    notify: (user: User, text: string) => {
      if (failIds.has(user.telegramId)) {
        return Promise.reject(new Error('Forbidden: bot was blocked by the user'));
      }
      sent.push({ id: user.telegramId, text });
      return Promise.resolve();
    },
    pause: () => {
      pauses++;
      return Promise.resolve();
    },
  };
}

beforeEach(() => {
  const db = openDatabase(':memory:');
  settings = new SqliteSettingsRepository(db);
  users = new SqliteUserRepository(db);
  users.upsert({ telegramId: 1, name: 'Claudia', role: ROLE.OWNER, active: true });
  users.upsert({ telegramId: 2, name: 'Socio', role: ROLE.PARTNER, active: true });
  users.upsert({ telegramId: 3, name: 'Dependiente', role: ROLE.CLERK, active: true });
  users.upsert({ telegramId: 4, name: 'Antiguo', role: ROLE.CLERK, active: false });
  sent = [];
  failIds = new Set();
  pauses = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('announceRelease', () => {
  it('sin versión no envía ni guarda nada', async () => {
    const result = await announceRelease(deps(), null);
    expect(result.status).toBe(ANNOUNCE_STATUS.NO_VERSION);
    expect(sent).toEqual([]);
    expect(settings.get(ANNOUNCED_VERSION_KEY)).toBeUndefined();
  });

  it('versión nueva: avisa a todos los activos y guarda la versión', async () => {
    settings.set(ANNOUNCED_VERSION_KEY, 'a1');
    const result = await announceRelease(deps(), RELEASE);
    expect(result).toEqual({ status: ANNOUNCE_STATUS.ANNOUNCED, ok: 3, failed: 0 });
    expect(sent.map((message) => message.id)).toEqual([1, 2, 3]);
    expect(sent[0]?.text).toContain('🆕 Bot actualizado (v b2)');
    expect(sent[0]?.text).toContain('• feat: algo nuevo');
    expect(pauses).toBe(2);
    expect(settings.get(ANNOUNCED_VERSION_KEY)).toBe('b2');
  });

  it('la primera versión con versión fijada también se anuncia', async () => {
    const result = await announceRelease(deps(), RELEASE);
    expect(result.status).toBe(ANNOUNCE_STATUS.ANNOUNCED);
  });

  it('misma versión (reinicio): no repite el aviso', async () => {
    settings.set(ANNOUNCED_VERSION_KEY, 'b2');
    const result = await announceRelease(deps(), RELEASE);
    expect(result.status).toBe(ANNOUNCE_STATUS.ALREADY_ANNOUNCED);
    expect(sent).toEqual([]);
  });

  it('un usuario que bloqueó el bot no frena a los demás y la versión se guarda', async () => {
    failIds.add(2);
    const result = await announceRelease(deps(), RELEASE);
    expect(result).toEqual({ status: ANNOUNCE_STATUS.ANNOUNCED, ok: 2, failed: 1 });
    expect(sent.map((message) => message.id)).toEqual([1, 3]);
    expect(settings.get(ANNOUNCED_VERSION_KEY)).toBe('b2');

    const again = await announceRelease(deps(), RELEASE);
    expect(again.status).toBe(ANNOUNCE_STATUS.ALREADY_ANNOUNCED);
  });
});
