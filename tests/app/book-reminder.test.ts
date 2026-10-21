import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import { SqliteSettingsRepository } from '../../src/adapters/sqlite/settings-repo.js';
import { SqliteUserRepository } from '../../src/adapters/sqlite/users-repo.js';
import {
  BOOK_REMINDER_SENT_KEY,
  remindMissingBook,
  type BookReminderDeps,
} from '../../src/app/book-reminder.js';
import { registerBook } from '../../src/app/cuadre-books.js';
import { ROLE } from '../../src/core/auth.js';
import type { User } from '../../src/ports/repositories.js';

let deps: BookReminderDeps;
let sent: { to: number; text: string }[];

const at = (day: number, minutes = 9 * 60) => ({
  today: { year: 2026, month: 10, day },
  minutesNow: minutes,
});

beforeEach(() => {
  const db = openDatabase(':memory:');
  const users = new SqliteUserRepository(db);
  users.upsert({ telegramId: 1, name: 'Claudia', role: ROLE.OWNER, active: true });
  users.upsert({ telegramId: 2, name: 'Ivett', role: ROLE.OWNER, active: true });
  users.upsert({ telegramId: 3, name: null, role: ROLE.CLERK, active: true });
  users.upsert({ telegramId: 4, name: null, role: ROLE.OWNER, active: false });
  const settings = new SqliteSettingsRepository(db);
  registerBook(settings, '2026-10', 'oct');
  sent = [];
  deps = {
    settings,
    users,
    notify: (user: User, text: string) => {
      if (user.telegramId === 2) return Promise.reject(new Error('bloqueó el bot'));
      sent.push({ to: user.telegramId, text });
      return Promise.resolve();
    },
  };
});

describe('recordatorio del libro del mes siguiente', () => {
  it('antes del 25 o antes de la apertura no envía nada', async () => {
    expect(await remindMissingBook(deps, at(24))).toBeNull();
    expect(await remindMissingBook(deps, at(25, 8 * 60))).toBeNull();
    expect(sent).toEqual([]);
  });

  it('el 25 avisa solo a las dueñas activas; un envío fallido no frena a las demás', async () => {
    expect(await remindMissingBook(deps, at(25))).toEqual({ month: '2026-11', ok: 1, failed: 1 });
    expect(sent.map((s) => s.to)).toEqual([1]);
    expect(sent[0]?.text).toContain('/cuadremes 2026-11');
    expect(deps.settings.get(BOOK_REMINDER_SENT_KEY)).toBe('2026-10-25');
  });

  it('una vez por día, hasta que se registra el libro', async () => {
    await remindMissingBook(deps, at(25));
    expect(await remindMissingBook(deps, at(25, 18 * 60))).toBeNull();
    expect(await remindMissingBook(deps, at(26))).not.toBeNull();
    registerBook(deps.settings, '2026-11', 'nov');
    expect(await remindMissingBook(deps, at(27))).toBeNull();
  });

  it('respeta la hora de apertura configurada', async () => {
    deps.settings.set('opening_time', '10:30');
    expect(await remindMissingBook(deps, at(25, 10 * 60))).toBeNull();
    expect(await remindMissingBook(deps, at(25, 10 * 60 + 30))).not.toBeNull();
  });
});
