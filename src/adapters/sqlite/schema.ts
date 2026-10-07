import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Estado propio del bot. Las fechas se guardan como texto ISO 8601 (UTC); la zona
 * horaria del negocio se aplica al mostrarlas. SQLite es la fuente de verdad del
 * catálogo; la pestaña `_config` de la hoja es solo un espejo.
 */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Whitelist de Telegram con su rol. Un usuario inactivo cuenta como no autorizado. */
export const users = sqliteTable('users', {
  telegramId: integer('telegram_id').primaryKey(),
  name: text('name'),
  role: text('role').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(now),
});

/** Intentos rechazados: usuarios fuera de la whitelist o sin permiso para el comando. */
export const accessLog = sqliteTable('access_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull(),
  username: text('username'),
  command: text('command'),
  outcome: text('outcome').notNull(),
  at: text('at').notNull().default(now),
});

/** Catálogo de productos con el nombre exacto del cuadre. */
export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  normalizedName: text('normalized_name').notNull().unique(),
  /** Costo vigente. `null` = sin costo conocido (nunca 0). */
  cost: real('cost'),
  category: text('category'),
  perishable: integer('perishable', { mode: 'boolean' }).notNull().default(false),
  minStock: real('min_stock'),
  updatedAt: text('updated_at').notNull().default(now),
});

/** Nombres del IPV que corresponden a un producto del cuadre. */
export const productAliases = sqliteTable('product_aliases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  normalizedAlias: text('normalized_alias').notNull().unique(),
});

/** Historial de costos: cada cambio con su origen y quién lo hizo. */
export const costHistory = sqliteTable(
  'cost_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    previousCost: real('previous_cost'),
    cost: real('cost'),
    source: text('source').notNull(),
    changedBy: integer('changed_by'),
    at: text('at').notNull().default(now),
  },
  (table) => [index('cost_history_product_idx').on(table.productId)],
);

/** Log de cambios: quién cambió qué y cuándo. */
export const changeLog = sqliteTable('change_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id'),
  action: text('action').notNull(),
  target: text('target'),
  /** JSON con el detalle; incluye el motivo cuando una dueña fuerza una confirmación. */
  detail: text('detail'),
  at: text('at').notNull().default(now),
});

/** Estado previo a cada escritura en Sheets, para `/deshacer`. Sin pestañas `_bak_*`. */
export const snapshots = sqliteTable('snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  changeLogId: integer('change_log_id').references(() => changeLog.id),
  telegramId: integer('telegram_id').notNull(),
  kind: text('kind').notNull(),
  /** JSON: pestaña creada, o rangos con sus fórmulas y valores previos. */
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull().default(now),
  revertedAt: text('reverted_at'),
});

/** Escrituras que esperan el botón ✅ Confirmar / ❌ Cancelar. Vencen a los 15 minutos. */
export const pendingActions = sqliteTable(
  'pending_actions',
  {
    id: text('id').primaryKey(),
    telegramId: integer('telegram_id').notNull(),
    kind: text('kind').notNull(),
    payload: text('payload').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('pending_actions_status_idx').on(table.status, table.expiresAt)],
);

/** Configuración clave → valor JSON (horarios, días de inventario objetivo…). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});
