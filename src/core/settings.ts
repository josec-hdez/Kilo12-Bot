/**
 * Configuración operativa con sus valores por defecto (decididos con las dueñas el
 * 2026-10-07). Se cambia con /config; se guarda en SQLite.
 */

export const SETTING = {
  OPENING_TIME: 'opening_time',
  CLOSING_TIME: 'closing_time',
  WEEKLY_REPORT_TIME: 'weekly_report_time',
  DRIVE_POLL_MINUTES: 'drive_poll_minutes',
  INVENTORY_TARGET_DAYS: 'inventory_target_days',
  LOW_STOCK_DAYS: 'low_stock_days',
  HAS_FIXED_EXPENSES: 'has_fixed_expenses',
} as const;

export type SettingKey = (typeof SETTING)[keyof typeof SETTING];

export const DEFAULT_SETTINGS: Readonly<Record<SettingKey, string | number | boolean>> = {
  /** Recordatorio de /tc y perecederos en riesgo. */
  [SETTING.OPENING_TIME]: '09:00',
  /** Recordatorio del IPV o resumen del día. */
  [SETTING.CLOSING_TIME]: '21:00',
  /** Lunes a esta hora: reporte semanal, /reponer, /parado. */
  [SETTING.WEEKLY_REPORT_TIME]: '09:00',
  [SETTING.DRIVE_POLL_MINUTES]: 10,
  /** Reposición diaria: comprar para cubrir la venta del día siguiente. */
  [SETTING.INVENTORY_TARGET_DAYS]: 1,
  /** /bajo: menos de este número de días de inventario. */
  [SETTING.LOW_STOCK_DAYS]: 1,
  /** Sin gastos fijos: el transporte se registra el día que ocurre, no se prorratea. */
  [SETTING.HAS_FIXED_EXPENSES]: false,
};
