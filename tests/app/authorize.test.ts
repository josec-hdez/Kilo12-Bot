import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import {
  SqliteAccessLogRepository,
  SqliteUserRepository,
} from '../../src/adapters/sqlite/users-repo.js';
import { AUTH_STATUS, authorize } from '../../src/app/authorize.js';
import { ROLE } from '../../src/core/auth.js';
import { ACCESS_OUTCOME } from '../../src/ports/repositories.js';

let users: SqliteUserRepository;
let accessLog: SqliteAccessLogRepository;

beforeEach(() => {
  const db = openDatabase(':memory:');
  users = new SqliteUserRepository(db);
  accessLog = new SqliteAccessLogRepository(db);
  users.upsert({ telegramId: 1, name: 'Claudia', role: ROLE.OWNER, active: true });
  users.upsert({ telegramId: 2, name: 'Turno A', role: ROLE.CLERK, active: true });
  users.upsert({ telegramId: 3, name: 'Baja', role: ROLE.CLERK, active: false });
});

const deps = () => ({ users, accessLog });

describe('authorize', () => {
  it('fuera de la whitelist: "no autorizado" y queda en el log', () => {
    const result = authorize(deps(), { telegramId: 99, username: 'intruso', command: '/hoy' });
    expect(result).toEqual({ status: AUTH_STATUS.UNAUTHORIZED, message: 'No autorizado.' });
    expect(accessLog.list()).toMatchObject([
      {
        telegramId: 99,
        username: 'intruso',
        command: '/hoy',
        outcome: ACCESS_OUTCOME.UNAUTHORIZED,
      },
    ]);
  });

  it('un usuario inactivo cuenta como no autorizado', () => {
    expect(authorize(deps(), { telegramId: 3, username: null, command: '/ipv' }).status).toBe(
      AUTH_STATUS.UNAUTHORIZED,
    );
  });

  it('un mensaje sin comando de alguien fuera de la whitelist también se registra', () => {
    authorize(deps(), { telegramId: 99, username: null, command: null });
    expect(accessLog.list()).toHaveLength(1);
  });

  it('dependiente no puede /tc: se le niega y queda en el log como prohibido', () => {
    const result = authorize(deps(), { telegramId: 2, username: 'turnoA', command: '/tc' });
    expect(result.status).toBe(AUTH_STATUS.FORBIDDEN);
    expect(accessLog.list()).toMatchObject([{ telegramId: 2, outcome: ACCESS_OUTCOME.FORBIDDEN }]);
  });

  it('dependiente puede /ipv; dueña puede /tc; nada queda en el log', () => {
    expect(authorize(deps(), { telegramId: 2, username: null, command: '/ipv' })).toMatchObject({
      status: AUTH_STATUS.ALLOWED,
      user: { telegramId: 2, role: ROLE.CLERK },
    });
    expect(authorize(deps(), { telegramId: 1, username: null, command: '/tc' }).status).toBe(
      AUTH_STATUS.ALLOWED,
    );
    expect(accessLog.list()).toEqual([]);
  });

  it('un usuario autorizado puede escribir texto libre (recibe el menú según su rol)', () => {
    expect(authorize(deps(), { telegramId: 2, username: null, command: null }).status).toBe(
      AUTH_STATUS.ALLOWED,
    );
  });
});
