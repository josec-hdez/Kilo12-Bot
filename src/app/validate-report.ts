import {
  FINDING_CODE,
  SEVERITY,
  SEVERITY_ICON,
  validateDays,
  type Finding,
  type FindingCode,
  type Severity,
} from '../core/validations.js';
import type { CuadreSheet } from '../core/types.js';
import type { CuadreReader } from '../ports/cuadre-source.js';

/** /validar [día|semana]: corre las validaciones T3 sobre el cuadre y arma el texto. */

export const VALIDATE_SCOPE = {
  LAST_DAY: 'last_day',
  DAY: 'day',
  WEEK: 'week',
  INVALID: 'invalid',
} as const;

export type ValidateRequest =
  | { kind: typeof VALIDATE_SCOPE.LAST_DAY }
  | { kind: typeof VALIDATE_SCOPE.DAY; tab: string }
  | { kind: typeof VALIDATE_SCOPE.WEEK }
  | { kind: typeof VALIDATE_SCOPE.INVALID; message: string };

const WEEK_DAYS = 7;
const MAX_LINES_PER_SEVERITY = 8;
const USAGE = 'Uso: /validar (último día), /validar 03 (un día) o /validar semana.';

/** Hallazgos que muestran costos o utilidades: quien no ve finanzas solo los cuenta. */
const FINANCIAL_CODES: ReadonlySet<FindingCode> = new Set([
  FINDING_CODE.SOLD_WITHOUT_COST,
  FINDING_CODE.COST_GE_PRICE,
  FINDING_CODE.HIGH_MARGIN,
  FINDING_CODE.COST_CHANGE,
  FINDING_CODE.SUMMARY_FORMULA,
  FINDING_CODE.NET_PROFIT_FORMULA,
]);

const SECTION_TITLE: Readonly<Record<Severity, string>> = {
  [SEVERITY.RED]: '🔴 Afecta la ganancia',
  [SEVERITY.YELLOW]: '🟡 Afecta inventario o inversión',
  [SEVERITY.WHITE]: '⚪ Informativo',
};

export function parseValidateArgs(raw: string): ValidateRequest {
  const arg = raw.trim().toLowerCase();
  if (arg === '') return { kind: VALIDATE_SCOPE.LAST_DAY };
  if (arg === 'semana' || arg === 'sem') return { kind: VALIDATE_SCOPE.WEEK };
  if (/^\d{1,2}$/.test(arg)) return { kind: VALIDATE_SCOPE.DAY, tab: arg.padStart(2, '0') };
  return { kind: VALIDATE_SCOPE.INVALID, message: USAGE };
}

export interface ValidateOptions {
  hasFixedExpenses: boolean;
  /** Ver costos y utilidades (dueña, socio). */
  showFinancials: boolean;
}

interface Window {
  /** Días que se reportan. */
  target: string[];
  /** Días que se leen: el objetivo más el anterior y el siguiente, para la continuidad. */
  read: string[];
}

function windowFor(days: readonly string[], request: ValidateRequest): Window | string {
  if (days.length === 0) return 'El cuadre todavía no tiene pestañas de días.';
  const last = days.length - 1;
  let from: number;
  let to: number;
  switch (request.kind) {
    case VALIDATE_SCOPE.LAST_DAY:
      from = last;
      to = last;
      break;
    case VALIDATE_SCOPE.WEEK:
      from = Math.max(0, days.length - WEEK_DAYS);
      to = last;
      break;
    case VALIDATE_SCOPE.DAY: {
      const index = days.findIndex((day) => day.trim() === request.tab);
      if (index < 0) return `No existe la pestaña ${request.tab} en el cuadre.`;
      from = index;
      to = index;
      break;
    }
    case VALIDATE_SCOPE.INVALID:
      return request.message;
  }
  return {
    target: days.slice(from, to + 1),
    read: days.slice(Math.max(0, from - 1), Math.min(days.length, to + 2)),
  };
}

function label(target: readonly string[]): string {
  const first = target[0] ?? '';
  const last = target[target.length - 1] ?? '';
  return first === last ? first : `${first}–${last}`;
}

function findingLine(finding: Finding, multiDay: boolean): string {
  const day = multiDay ? `[${finding.day}] ` : '';
  const product = finding.product === null ? '' : `${finding.product}: `;
  const cell = finding.cell === null ? '' : ` (${finding.cell})`;
  return `• ${day}${product}${finding.detail}${cell}`;
}

function section(severity: Severity, findings: readonly Finding[], multiDay: boolean): string[] {
  if (findings.length === 0) return [];
  const lines = [
    '',
    `${SECTION_TITLE[severity]} (${String(findings.length)})`,
    ...findings.slice(0, MAX_LINES_PER_SEVERITY).map((f) => findingLine(f, multiDay)),
  ];
  if (findings.length > MAX_LINES_PER_SEVERITY) {
    lines.push(`… y ${String(findings.length - MAX_LINES_PER_SEVERITY)} más.`);
  }
  return lines;
}

export async function runValidation(
  reader: CuadreReader,
  request: ValidateRequest,
  options: ValidateOptions,
): Promise<string> {
  const window = windowFor(await reader.listDays(), request);
  if (typeof window === 'string') return window;

  const sheets: CuadreSheet[] = [];
  for (const day of window.read) sheets.push(await reader.readDay(day));

  const targets = new Set(window.target.map((day) => day.trim()));
  const all = validateDays(sheets, { hasFixedExpenses: options.hasFixedExpenses }).filter(
    (finding) => targets.has(finding.day.trim()),
  );
  const hidden = options.showFinancials ? [] : all.filter((f) => FINANCIAL_CODES.has(f.code));
  const shown = options.showFinancials ? all : all.filter((f) => !FINANCIAL_CODES.has(f.code));

  const count = (severity: Severity) => all.filter((f) => f.severity === severity).length;
  const lines = [
    `🔎 Validación del cuadre: ${label(window.target)}`,
    `${SEVERITY_ICON[SEVERITY.RED]} ${String(count(SEVERITY.RED))} · ${SEVERITY_ICON[SEVERITY.YELLOW]} ${String(count(SEVERITY.YELLOW))} · ${SEVERITY_ICON[SEVERITY.WHITE]} ${String(count(SEVERITY.WHITE))}`,
  ];
  if (all.length === 0) {
    lines.push('', 'Sin hallazgos ✅');
    return lines.join('\n');
  }

  const multiDay = window.target.length > 1;
  for (const severity of [SEVERITY.RED, SEVERITY.YELLOW, SEVERITY.WHITE] as const) {
    lines.push(
      ...section(
        severity,
        shown.filter((f) => f.severity === severity),
        multiDay,
      ),
    );
  }
  if (hidden.length > 0) {
    lines.push(
      '',
      `🔒 ${String(hidden.length)} ${hidden.length === 1 ? 'hallazgo' : 'hallazgos'} de costos o utilidad (los revisa una dueña).`,
    );
  }
  const fixable = shown.filter((f) => f.autoFixable).length;
  if (fixable > 0) {
    lines.push(
      '',
      `🔧 ${String(fixable)} con arreglo propuesto en el detalle (corrección automática: próximamente).`,
    );
  }
  return lines.join('\n');
}
