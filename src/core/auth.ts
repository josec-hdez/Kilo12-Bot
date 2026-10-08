/**
 * Roles y permisos del bot. Puro: la whitelist vive en SQLite y el middleware de
 * Telegram solo consulta esta matriz.
 */

export const ROLE = {
  OWNER: 'dueno',
  PARTNER: 'socio',
  CLERK: 'dependiente',
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

export const PERMISSION = {
  /** Ver costos, utilidades y márgenes. */
  VIEW_FINANCIALS: 'view_financials',
  VIEW_REPORTS: 'view_reports',
  VIEW_STOCK: 'view_stock',
  VALIDATE: 'validate',
  LOAD_IPV: 'load_ipv',
  SET_TC: 'set_tc',
  UNDO: 'undo',
  RECORD_EXPENSE: 'record_expense',
  RECORD_ENTRY: 'record_entry',
  SET_COST: 'set_cost',
  SET_PRICE: 'set_price',
  MANAGE_EQUIVALENCES: 'manage_equivalences',
  ACCEPT_SUGGESTION: 'accept_suggestion',
  CONFIGURE: 'configure',
  /** "⚠️ Confirmar igual" cuando la venta no cuadra con el IPV. */
  FORCE_CONFIRM: 'force_confirm',
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  [ROLE.OWNER]: new Set(Object.values(PERMISSION)),
  [ROLE.PARTNER]: new Set([
    PERMISSION.VIEW_FINANCIALS,
    PERMISSION.VIEW_REPORTS,
    PERMISSION.VIEW_STOCK,
    PERMISSION.VALIDATE,
    PERMISSION.RECORD_EXPENSE,
    PERMISSION.ACCEPT_SUGGESTION,
  ]),
  [ROLE.CLERK]: new Set([
    PERMISSION.LOAD_IPV,
    PERMISSION.RECORD_EXPENSE,
    PERMISSION.RECORD_ENTRY,
    PERMISSION.VIEW_STOCK,
  ]),
};

export function isRole(value: string): value is Role {
  return Object.values<string>(ROLE).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Permiso que exige cada comando. `null` = cualquier usuario autorizado. */
export const COMMAND_PERMISSION: Readonly<Record<string, Permission | null>> = {
  start: null,
  ayuda: null,
  /** Abandona el motivo pendiente de "⚠️ Confirmar igual". */
  cancelar: null,
  ipv: PERMISSION.LOAD_IPV,
  validar: PERMISSION.VALIDATE,
  comparar: PERMISSION.VALIDATE,
  tc: PERMISSION.SET_TC,
  deshacer: PERMISSION.UNDO,
  cerrar: PERMISSION.SET_TC,
  hoy: PERMISSION.VIEW_REPORTS,
  dia: PERMISSION.VIEW_REPORTS,
  semana: PERMISSION.VIEW_REPORTS,
  mes: PERMISSION.VIEW_REPORTS,
  rango: PERMISSION.VIEW_REPORTS,
  ganancia: PERMISSION.VIEW_FINANCIALS,
  margen: PERMISSION.VIEW_FINANCIALS,
  stock: PERMISSION.VIEW_STOCK,
  gasto: PERMISSION.RECORD_EXPENSE,
  entrada: PERMISSION.RECORD_ENTRY,
  costo: PERMISSION.SET_COST,
  sincosto: PERMISSION.VIEW_FINANCIALS,
  precio: PERMISSION.SET_PRICE,
  equivalencia: PERMISSION.MANAGE_EQUIVALENCES,
  sugerencias: PERMISSION.VIEW_FINANCIALS,
  config: PERMISSION.CONFIGURE,
};

/** `/TC@kilo12_bot` → `tc`. */
export function commandName(raw: string): string {
  return raw.replace(/^\//, '').split('@')[0]?.toLowerCase() ?? '';
}

/**
 * ¿Puede este rol ejecutar el comando? Un comando sin mapear exige `CONFIGURE`,
 * de modo que solo una dueña lo intenta y nadie más se cuela por un olvido.
 */
export function canRunCommand(role: Role, command: string): boolean {
  const name = commandName(command);
  const permission = Object.hasOwn(COMMAND_PERMISSION, name)
    ? COMMAND_PERMISSION[name]
    : PERMISSION.CONFIGURE;
  return permission === null || permission === undefined || can(role, permission);
}
