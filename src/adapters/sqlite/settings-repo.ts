import { eq, sql } from 'drizzle-orm';
import type { SettingsRepository } from '../../ports/repositories.js';
import type { Database } from './db.js';
import { settings } from './schema.js';

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Database) {}

  get(key: string): unknown {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
  }

  set(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.db
      .insert(settings)
      .values({ key, value: json })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: json, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` },
      })
      .run();
  }

  all(): Record<string, unknown> {
    return Object.fromEntries(
      this.db
        .select()
        .from(settings)
        .all()
        .map((row) => [row.key, JSON.parse(row.value) as unknown]),
    );
  }
}
