import type { CalendarDate } from './expense.js';
import { missingDays, type MonthKey } from './months.js';
import {
  adjustedProfit,
  summarizeDay,
  summarizePeriod,
  type AdjustedProfit,
  type PeriodSummary,
} from './reports.js';
import type { CuadreSheet } from './types.js';
import { FINDING_CODE, SEVERITY, validateDays, type Finding } from './validations.js';

/**
 * /cierremes: revisión completa de un mes antes de cerrarlo. Puro: recibe las hojas
 * del mes (y el último día del mes anterior, para la continuidad del 01) y devuelve
 * lo que hay que mirar.
 */

export interface UncostedProduct {
  product: string;
  venta: number;
}

export interface MonthCloseInput {
  month: MonthKey;
  /** Pestañas `DD` del libro del mes, en orden. */
  sheets: readonly CuadreSheet[];
  /** Último día del mes anterior (en otro libro), con su pestaña ya nombrada `31/10`. */
  previousLast: CuadreSheet | null;
  today: CalendarDate;
  hasFixedExpenses: boolean;
  nextBookRegistered: boolean;
}

export interface MonthClose {
  month: MonthKey;
  period: PeriodSummary;
  adjusted: AdjustedProfit;
  /** Días del calendario sin pestaña (ver `missingDays`). */
  missing: number[];
  findings: Finding[];
  /** Cortes de continuidad: final del día N ≠ inicial del N+1 (incluye 31 → 01). */
  continuity: Finding[];
  uncosted: UncostedProduct[];
  /** Último día cargado y su inventario final al costo: la apertura del mes siguiente. */
  lastDay: string | null;
  openingInventory: number | null;
  nextBookRegistered: boolean;
}

export const count = (findings: readonly Finding[], severity: Finding['severity']): number =>
  findings.filter((finding) => finding.severity === severity).length;

export function analyzeMonthClose(input: MonthCloseInput): MonthClose {
  const days = input.sheets.map(summarizeDay);
  const period = summarizePeriod(days);
  const own = new Set(input.sheets.map((sheet) => sheet.tabName.trim()));
  const chain = input.previousLast === null ? input.sheets : [input.previousLast, ...input.sheets];
  const findings = validateDays(chain, { hasFixedExpenses: input.hasFixedExpenses }).filter(
    (finding) => own.has(finding.day.trim()),
  );

  const uncosted = new Map<string, number>();
  for (const day of days) {
    for (const sale of day.uncosted) {
      const name = sale.product.replace(/\s+/g, ' ').trim();
      uncosted.set(name, (uncosted.get(name) ?? 0) + sale.venta);
    }
  }

  const last = days[days.length - 1];
  return {
    month: input.month,
    period,
    adjusted: adjustedProfit(period),
    missing: missingDays(
      input.month,
      input.sheets.map((sheet) => sheet.tabName),
      input.today,
    ),
    findings,
    continuity: findings.filter((finding) => finding.code === FINDING_CODE.CONTINUITY),
    uncosted: [...uncosted.entries()]
      .map(([product, venta]) => ({ product, venta }))
      .sort((a, b) => b.venta - a.venta),
    lastDay: last?.day ?? null,
    openingInventory: last?.inversionFinal ?? null,
    nextBookRegistered: input.nextBookRegistered,
  };
}

/** Lo que conviene resolver antes de cerrar: si está vacío, el mes queda limpio. */
export function closeIssues(close: MonthClose): string[] {
  const issues: string[] = [];
  if (close.missing.length > 0) issues.push('missing');
  if (count(close.findings, SEVERITY.RED) > 0) issues.push('red');
  if (close.continuity.length > 0) issues.push('continuity');
  if (close.uncosted.length > 0) issues.push('uncosted');
  if (!close.nextBookRegistered) issues.push('next_book');
  return issues;
}
