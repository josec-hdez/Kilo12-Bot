import { and, asc, eq } from 'drizzle-orm';
import { isRole } from '../../core/auth.js';
import {
  ACCESS_OUTCOME,
  type AccessAttempt,
  type AccessLogEntry,
  type AccessLogRepository,
  type AccessOutcome,
  type User,
  type UserRepository,
} from '../../ports/repositories.js';
import type { Database } from './db.js';
import { accessLog, users } from './schema.js';

type UserRow = typeof users.$inferSelect;

function toUser(row: UserRow): User {
  if (!isRole(row.role)) throw new Error(`Rol desconocido en la base: "${row.role}"`);
  return { telegramId: row.telegramId, name: row.name, role: row.role, active: row.active };
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  findActive(telegramId: number): User | undefined {
    const row = this.db
      .select()
      .from(users)
      .where(and(eq(users.telegramId, telegramId), eq(users.active, true)))
      .get();
    return row === undefined ? undefined : toUser(row);
  }

  upsert(user: User): void {
    this.db
      .insert(users)
      .values(user)
      .onConflictDoUpdate({
        target: users.telegramId,
        set: { name: user.name, role: user.role, active: user.active },
      })
      .run();
  }

  list(): User[] {
    return this.db.select().from(users).orderBy(asc(users.telegramId)).all().map(toUser);
  }
}

function toOutcome(value: string): AccessOutcome {
  const outcome = Object.values(ACCESS_OUTCOME).find((known) => known === value);
  if (outcome === undefined) throw new Error(`Resultado de acceso desconocido: "${value}"`);
  return outcome;
}

export class SqliteAccessLogRepository implements AccessLogRepository {
  constructor(private readonly db: Database) {}

  record(attempt: AccessAttempt): void {
    this.db.insert(accessLog).values(attempt).run();
  }

  list(): AccessLogEntry[] {
    return this.db
      .select()
      .from(accessLog)
      .orderBy(asc(accessLog.id))
      .all()
      .map((row) => ({
        telegramId: row.telegramId,
        username: row.username,
        command: row.command,
        outcome: toOutcome(row.outcome),
        at: row.at,
      }));
  }
}
