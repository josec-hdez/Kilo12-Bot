import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../../../src/adapters/sqlite/db.js';
import { SqliteCatalogRepository } from '../../../src/adapters/sqlite/catalog-repo.js';
import { SqlitePendingActionRepository } from '../../../src/adapters/sqlite/pending-actions-repo.js';
import { SqliteSettingsRepository } from '../../../src/adapters/sqlite/settings-repo.js';
import {
  SqliteAccessLogRepository,
  SqliteUserRepository,
} from '../../../src/adapters/sqlite/users-repo.js';
import { ROLE } from '../../../src/core/auth.js';
import {
  ACCESS_OUTCOME,
  PENDING_KIND,
  PENDING_STATUS,
  RESOLVE_RESULT,
} from '../../../src/ports/repositories.js';

let db: Database;

beforeEach(() => {
  db = openDatabase(':memory:');
});

describe('openDatabase', () => {
  it('aplica las migraciones y crea todas las tablas', () => {
    const tables = db.$client
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like '\\_%' escape '\\' and name not like 'sqlite%'",
      )
      .pluck()
      .all();
    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'access_log',
        'products',
        'product_aliases',
        'cost_history',
        'change_log',
        'snapshots',
        'pending_actions',
        'settings',
      ]),
    );
  });
});

describe('usuarios y log de accesos', () => {
  it('encuentra solo usuarios activos', () => {
    const users = new SqliteUserRepository(db);
    users.upsert({ telegramId: 1, name: 'Claudia', role: ROLE.OWNER, active: true });
    users.upsert({ telegramId: 2, name: 'Ex', role: ROLE.CLERK, active: false });
    expect(users.findActive(1)?.role).toBe(ROLE.OWNER);
    expect(users.findActive(2)).toBeUndefined();
    expect(users.findActive(3)).toBeUndefined();
  });

  it('upsert actualiza el rol de un usuario existente', () => {
    const users = new SqliteUserRepository(db);
    users.upsert({ telegramId: 1, name: null, role: ROLE.CLERK, active: true });
    users.upsert({ telegramId: 1, name: 'Ivett', role: ROLE.OWNER, active: true });
    expect(users.list()).toEqual([
      { telegramId: 1, name: 'Ivett', role: ROLE.OWNER, active: true },
    ]);
  });

  it('registra los intentos rechazados', () => {
    const log = new SqliteAccessLogRepository(db);
    log.record({
      telegramId: 99,
      username: 'intruso',
      command: '/hoy',
      outcome: ACCESS_OUTCOME.UNAUTHORIZED,
    });
    expect(log.list()).toMatchObject([
      { telegramId: 99, username: 'intruso', command: '/hoy', outcome: 'unauthorized' },
    ]);
  });
});

describe('acciones pendientes de confirmar', () => {
  let now: Date;
  let pending: SqlitePendingActionRepository;
  const clock = () => now;
  const advance = (minutes: number) => {
    now = new Date(now.getTime() + minutes * 60_000);
  };

  beforeEach(() => {
    now = new Date('2026-10-07T21:00:00Z');
    pending = new SqlitePendingActionRepository(db, clock);
  });

  it('crea la acción con vencimiento a los 15 minutos y conserva el payload', () => {
    const action = pending.create({
      telegramId: 1,
      kind: PENDING_KIND.SET_TC,
      payload: { day: '03', tc: 780 },
    });
    expect(action.status).toBe(PENDING_STATUS.PENDING);
    expect(action.expiresAt.getTime() - action.createdAt.getTime()).toBe(15 * 60_000);
    expect(pending.get(action.id)?.payload).toEqual({ day: '03', tc: 780 });
  });

  it('confirmar dentro del plazo devuelve la acción y no se puede confirmar dos veces', () => {
    const { id } = pending.create({ telegramId: 1, kind: PENDING_KIND.SET_TC, payload: {} });
    advance(14);
    expect(pending.confirm(id, 1).status).toBe(RESOLVE_RESULT.OK);
    expect(pending.confirm(id, 1)).toEqual({
      status: RESOLVE_RESULT.ALREADY_RESOLVED,
      resolution: PENDING_STATUS.CONFIRMED,
    });
  });

  it('una acción vencida no se puede confirmar ("acción vencida")', () => {
    const { id } = pending.create({ telegramId: 1, kind: PENDING_KIND.LOAD_IPV, payload: {} });
    advance(16);
    expect(pending.confirm(id, 1).status).toBe(RESOLVE_RESULT.EXPIRED);
    expect(pending.get(id)?.status).toBe(PENDING_STATUS.EXPIRED);
  });

  it('solo quien la creó puede confirmarla o cancelarla', () => {
    const { id } = pending.create({ telegramId: 1, kind: PENDING_KIND.SET_TC, payload: {} });
    expect(pending.confirm(id, 2).status).toBe(RESOLVE_RESULT.NOT_OWNER);
    expect(pending.cancel(id, 2).status).toBe(RESOLVE_RESULT.NOT_OWNER);
    expect(pending.cancel(id, 1).status).toBe(RESOLVE_RESULT.OK);
    expect(pending.confirm(id, 1)).toEqual({
      status: RESOLVE_RESULT.ALREADY_RESOLVED,
      resolution: PENDING_STATUS.CANCELLED,
    });
  });

  it('una acción inexistente se informa como no encontrada', () => {
    expect(pending.confirm('nope', 1).status).toBe(RESOLVE_RESULT.NOT_FOUND);
  });

  it('expireStale marca como vencidas solo las que pasaron el plazo', () => {
    const old = pending.create({ telegramId: 1, kind: PENDING_KIND.SET_TC, payload: {} });
    advance(10);
    const fresh = pending.create({ telegramId: 1, kind: PENDING_KIND.SET_TC, payload: {} });
    advance(6);
    expect(pending.expireStale()).toBe(1);
    expect(pending.get(old.id)?.status).toBe(PENDING_STATUS.EXPIRED);
    expect(pending.get(fresh.id)?.status).toBe(PENDING_STATUS.PENDING);
  });
});

describe('catálogo de productos', () => {
  let catalog: SqliteCatalogRepository;

  beforeEach(() => {
    catalog = new SqliteCatalogRepository(db);
  });

  it('ensureProduct no duplica un producto por espacios, mayúsculas o acentos', () => {
    const a = catalog.ensureProduct('agua  1.5 l');
    const b = catalog.ensureProduct('Agua 1.5 L');
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('agua  1.5 l');
  });

  it('un costo 0 se guarda como "sin costo" y cada cambio queda en el historial', () => {
    catalog.ensureProduct('pollo');
    catalog.setCost({ product: 'pollo', cost: 0, source: 'seed', changedBy: null });
    expect(catalog.findProduct('pollo')?.cost).toBeNull();
    catalog.setCost({ product: 'pollo', cost: 420, source: '/costo', changedBy: 1 });
    expect(catalog.findProduct('pollo')?.cost).toBe(420);
    expect(catalog.costHistory('pollo')).toMatchObject([
      { previousCost: null, cost: null, source: 'seed' },
      { previousCost: null, cost: 420, source: '/costo', changedBy: 1 },
    ]);
  });

  it('setCost sobre un producto inexistente falla con un mensaje claro', () => {
    expect(() => {
      catalog.setCost({ product: 'fantasma', cost: 10, source: 'x', changedBy: null });
    }).toThrow(/fantasma/);
  });

  it('alias: varios por producto, y un alias no puede pertenecer a dos productos', () => {
    catalog.ensureProduct('refresco reenvasado');
    catalog.ensureProduct('agua 500 ml');
    catalog.addAlias('refresco reenvasado', 'refresco cola dispensado');
    catalog.addAlias('refresco reenvasado', 'refresco naranja dispensado');
    catalog.addAlias('refresco reenvasado', 'Refresco Cola Dispensado'); // mismo alias: no duplica
    expect(() => {
      catalog.addAlias('agua 500 ml', 'refresco cola dispensado');
    }).toThrow(/refresco reenvasado/);
    expect(catalog.equivalences()).toEqual([
      {
        cuadre: 'refresco reenvasado',
        ipv: ['refresco cola dispensado', 'refresco naranja dispensado'],
      },
    ]);
  });

  it('costSources devuelve todos los productos con su costo vigente', () => {
    catalog.ensureProduct('arroz');
    catalog.setCost({ product: 'arroz', cost: 300, source: 'seed', changedBy: null });
    catalog.ensureProduct('fanguito');
    expect(catalog.costSources()).toEqual([
      { product: 'arroz', costo: 300 },
      { product: 'fanguito', costo: null },
    ]);
  });
});

describe('configuración', () => {
  it('guarda y lee valores JSON', () => {
    const settings = new SqliteSettingsRepository(db);
    expect(settings.get('closing_time')).toBeUndefined();
    settings.set('closing_time', '21:00');
    settings.set('drive_poll_minutes', 10);
    settings.set('closing_time', '21:30');
    expect(settings.all()).toEqual({ closing_time: '21:30', drive_poll_minutes: 10 });
  });
});
