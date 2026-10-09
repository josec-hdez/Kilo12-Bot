import { SALES_CHECK, type CuadreTotals, type SalesCheck } from '../core/calc.js';
import type { CuadreDraft } from '../core/cuadre-builder.js';
import { SEVERITY, SEVERITY_ICON, type Finding, type Severity } from '../core/validations.js';

/**
 * Textos de vista previa que se muestran antes de ✅ Confirmar. Las cifras salen
 * de core/calc; aquí solo se formatean. Quien no ve finanzas (dependiente) no ve
 * utilidad ni la lista de costos faltantes.
 */

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const fmt = (value: number): string => numberFormat.format(value);

/** Máximo de alertas listadas una por una; el resto se cuenta. */
const MAX_ALERT_LINES = 10;
const MAX_NAMES = 20;

function salesLine(check: SalesCheck, importeTotal: number | null): string {
  switch (check.status) {
    case SALES_CHECK.MATCH:
      return '✅ igual al IMPORTE TOTAL del IPV';
    case SALES_CHECK.MERMA_EXPLAINED:
      return `🟡 el IPV cuenta ${fmt(check.amount)} CUP de merma/consumo como venta`;
    case SALES_CHECK.MISMATCH:
      return `🔴 no cuadra con el IPV (${fmt(importeTotal ?? 0)}; diferencia ${fmt(check.diff)})`;
    case SALES_CHECK.NO_IPV_TOTAL:
      return '🔴 el IPV no tiene IMPORTE TOTAL';
  }
}

function names(list: readonly string[]): string {
  const shown = list.slice(0, MAX_NAMES).join(', ');
  return list.length > MAX_NAMES ? `${shown} y ${String(list.length - MAX_NAMES)} más` : shown;
}

export function alertLines(findings: readonly Finding[]): string[] {
  if (findings.length === 0) return ['Alertas: ninguna ✅'];
  const count = (severity: Severity) => findings.filter((f) => f.severity === severity).length;
  const lines = [
    `Alertas: 🔴 ${String(count(SEVERITY.RED))} · 🟡 ${String(count(SEVERITY.YELLOW))} · ⚪ ${String(count(SEVERITY.WHITE))}`,
    ...findings.slice(0, MAX_ALERT_LINES).map((f) => {
      const product = f.product === null ? '' : `${f.product}: `;
      return `${SEVERITY_ICON[f.severity]} ${product}${f.detail}`;
    }),
  ];
  if (findings.length > MAX_ALERT_LINES) {
    lines.push(`… y ${String(findings.length - MAX_ALERT_LINES)} alertas más (/validar).`);
  }
  return lines;
}

export interface LoadPreviewInput {
  tab: string;
  ipvTab: string;
  draft: CuadreDraft;
  totals: CuadreTotals;
  sales: SalesCheck;
  tc: number | null;
  alerts: readonly Finding[];
  blockers: readonly Finding[];
  showFinancials: boolean;
  canForce: boolean;
}

export function loadIpvPreview(input: LoadPreviewInput): string {
  const { draft, totals, tc } = input;
  const usd = tc === null ? ' · USD: falta la TC (/tc)' : ` · ${fmt(totals.ventaTotal / tc)} USD`;
  const lines = [
    `📥 Hoja «${input.ipvTab}» → pestaña ${input.tab} del cuadre`,
    `Venta: ${fmt(totals.ventaTotal)} CUP${usd}`,
    `   ${salesLine(input.sales, draft.ipvImporteTotal)}`,
  ];

  if (input.showFinancials) {
    const usdProfit = tc === null ? '' : ` · ${fmt(totals.utilidadBruta / tc)} USD`;
    lines.push(`Utilidad bruta: ${fmt(totals.utilidadBruta)} CUP${usdProfit}`);
    if (draft.missingCost.length > 0) {
      lines.push(
        '   (inflada: los productos sin costo cuentan como costo 0)',
        `⚠️ Sin costo (${String(draft.missingCost.length)}), quedan en amarillo: ${names(draft.missingCost)}`,
      );
    }
  } else if (draft.missingCost.length > 0) {
    lines.push(
      `⚠️ ${String(draft.missingCost.length)} productos sin costo (los revisa una dueña).`,
    );
  }

  lines.push(
    `Productos: ${String(draft.rows.length)} filas · ${String(draft.omitted.length)} sin movimiento omitidos`,
  );
  if (draft.unmatched.length > 0) {
    const list = draft.unmatched.map(({ ipvProduct, suggestions }) => {
      const hint = suggestions[0] === undefined ? '' : ` (¿${suggestions[0].product}?)`;
      return `${ipvProduct}${hint}`;
    });
    lines.push(`🆕 Sin equivalencia (${String(list.length)}), se agregan al final: ${names(list)}`);
  }
  for (const warning of draft.warnings) lines.push(`⚠️ ${warning}`);

  lines.push('', ...alertLines(input.alerts));

  if (input.blockers.length > 0) {
    lines.push(
      '',
      `⛔ No se puede confirmar: ${String(input.blockers.length)} bloqueo(s) 🔴. Corrige el IPV y vuelve a cargarlo.`,
    );
    if (input.canForce) {
      lines.push(
        'Una dueña puede usar "⚠️ Confirmar igual" escribiendo el motivo (queda en el log).',
      );
    }
  }
  return lines.join('\n');
}
