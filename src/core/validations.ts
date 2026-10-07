import { SALES_CHECK, salida, type SalesCheck } from './calc.js';
import { FIRST_DATA_ROW, rowFormulas, type FormulaColumn } from './cuadre-layout.js';
import { formatDayRef, normalizeName } from './tabs.js';
import type { CuadreRow, CuadreSheet, IpvDay } from './types.js';

/**
 * Validaciones T3 de CLAUDE.md. Todo es puro: recibe hojas ya leídas y devuelve
 * hallazgos. Nada se corrige aquí; `autoFixable` solo indica que el bot puede
 * proponer el arreglo con confirmación.
 */

export const SEVERITY = {
  /** Afecta la ganancia. */
  RED: 'red',
  /** Afecta el inventario o la inversión. */
  YELLOW: 'yellow',
  /** Cosmético o informativo. */
  WHITE: 'white',
} as const;

export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];

export const SEVERITY_ICON: Readonly<Record<Severity, string>> = {
  [SEVERITY.RED]: '🔴',
  [SEVERITY.YELLOW]: '🟡',
  [SEVERITY.WHITE]: '⚪',
};

export const FINDING_CODE = {
  EMPTY_FINAL: 'empty_final',
  FINAL_ZERO_SOLD_ALL: 'final_zero_sold_all',
  NEGATIVE_SALIDA: 'negative_salida',
  SOLD_WITHOUT_COST: 'sold_without_cost',
  COST_GE_PRICE: 'cost_ge_price',
  HIGH_MARGIN: 'high_margin',
  ENTRADAS_EQ_SALIDA: 'entradas_eq_salida',
  HANDWRITTEN_VALUE: 'handwritten_value',
  SUMMARY_FORMULA: 'summary_formula',
  NET_PROFIT_FORMULA: 'net_profit_formula',
  MISSING_TC: 'missing_tc',
  NO_EXPENSES: 'no_expenses',
  CONTINUITY: 'continuity',
  EXISTENCE_AS_ENTRADAS: 'existence_as_entradas',
  PRICE_CHANGE: 'price_change',
  COST_CHANGE: 'cost_change',
  DISAPPEARED: 'disappeared',
  SALES_MISMATCH: 'sales_mismatch',
  SALES_MERMA_EXPLAINED: 'sales_merma_explained',
} as const;

export type FindingCode = (typeof FINDING_CODE)[keyof typeof FINDING_CODE];

export interface Finding {
  severity: Severity;
  code: FindingCode;
  /** Pestaña del cuadre (`02`) o día del IPV (`4 oct`). */
  day: string;
  product: string | null;
  /** Celda afectada (`J5`, `Q14`), si se sabe. */
  cell: string | null;
  detail: string;
  autoFixable: boolean;
}

/** Margen sobre el precio a partir del cual se pide confirmar el costo. */
export const HIGH_MARGIN_THRESHOLD = 0.7;

/** Hallazgos que impiden cargar un IPV, aunque la venta cuadre. */
const BLOCKING_CODES: ReadonlySet<FindingCode> = new Set([
  FINDING_CODE.EMPTY_FINAL,
  FINDING_CODE.NEGATIVE_SALIDA,
  FINDING_CODE.SALES_MISMATCH,
]);

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  [SEVERITY.RED]: 0,
  [SEVERITY.YELLOW]: 1,
  [SEVERITY.WHITE]: 2,
};

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt = (value: number | null): string =>
  value === null ? 'vacía' : numberFormat.format(value);
const n = (value: number | null): number => value ?? 0;

/** Existencia disponible para vender: inicio + entradas − merma − consumo. */
function available(row: Pick<CuadreRow, 'inicio' | 'entradas' | 'merma' | 'consumo'>): number {
  return n(row.inicio) + n(row.entradas) - n(row.merma) - n(row.consumo);
}

function hasStockOrMovement(row: CuadreRow): boolean {
  return available(row) !== 0 || n(row.final) !== 0 || salida(row) !== 0;
}

function finding(
  severity: Severity,
  code: FindingCode,
  day: string,
  detail: string,
  extra: Partial<Pick<Finding, 'product' | 'cell' | 'autoFixable'>> = {},
): Finding {
  return { severity, code, day, detail, product: null, cell: null, autoFixable: false, ...extra };
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ---------------------------------------------------------------- filas del día

/** Columnas con fórmula: las de la venta y el costo afectan la ganancia; C y M, la inversión. */
const FORMULA_SEVERITY: Readonly<Record<FormulaColumn, Severity>> = {
  C: SEVERITY.YELLOW,
  I: SEVERITY.RED,
  K: SEVERITY.RED,
  L: SEVERITY.RED,
  M: SEVERITY.YELLOW,
  N: SEVERITY.RED,
};

const canonicalFormula = (formula: string): string =>
  formula.replace(/^=/, '').replace(/\s+/g, '').toUpperCase();

function rowFindings(day: string, row: CuadreRow): Finding[] {
  const out: Finding[] = [];
  const { product, rowNumber: r } = row;
  const sold = salida(row);
  const stock = available(row);

  if (row.final === null && stock > 0) {
    out.push(
      finding(
        SEVERITY.RED,
        FINDING_CODE.EMPTY_FINAL,
        day,
        `Cant. Final vacía con existencia ${fmt(stock)}: la fórmula cuenta todo como vendido` +
          ` (${fmt(stock * n(row.precio))} CUP).`,
        { product, cell: `J${r}` },
      ),
    );
  }

  if (sold < 0) {
    out.push(
      finding(
        SEVERITY.RED,
        FINDING_CODE.NEGATIVE_SALIDA,
        day,
        `Salida negativa (${fmt(sold)}): la final (${fmt(row.final)}) es mayor que la existencia (${fmt(stock)}).`,
        { product, cell: `I${r}` },
      ),
    );
  }

  if (sold > 0 && n(row.costo) === 0) {
    out.push(
      finding(
        SEVERITY.RED,
        FINDING_CODE.SOLD_WITHOUT_COST,
        day,
        `Vendió ${fmt(sold)} (${fmt(sold * n(row.precio))} CUP) sin costo: toda esa venta cuenta como utilidad.`,
        { product, cell: `B${r}` },
      ),
    );
  }

  const costo = n(row.costo);
  const precio = n(row.precio);
  if (costo > 0 && precio > 0 && hasStockOrMovement(row)) {
    if (costo >= precio) {
      out.push(
        finding(
          SEVERITY.RED,
          FINDING_CODE.COST_GE_PRICE,
          day,
          `Costo ${fmt(costo)} ≥ precio ${fmt(precio)}: cada venta pierde dinero o el costo está mal.`,
          { product, cell: `B${r}` },
        ),
      );
    } else if ((precio - costo) / precio > HIGH_MARGIN_THRESHOLD) {
      const margin = Math.round(((precio - costo) / precio) * 100);
      out.push(
        finding(
          SEVERITY.YELLOW,
          FINDING_CODE.HIGH_MARGIN,
          day,
          `Margen de ${String(margin)}% (costo ${fmt(costo)}, precio ${fmt(precio)}): confirma el costo.`,
          { product, cell: `B${r}` },
        ),
      );
    }
  }

  const entradas = n(row.entradas);
  if (entradas > 0 && sold === entradas && row.inicio !== null && row.final === row.inicio) {
    out.push(
      finding(
        SEVERITY.YELLOW,
        FINDING_CODE.ENTRADAS_EQ_SALIDA,
        day,
        `Entradas y salida iguales (${fmt(entradas)}) y la final igual a la inicial: posible error de digitación.`,
        { product, cell: `F${r}` },
      ),
    );
  }

  const expected = rowFormulas(r);
  for (const column of Object.keys(expected) as FormulaColumn[]) {
    const actual = row.formulas[column];
    if (actual !== null && canonicalFormula(actual) === canonicalFormula(expected[column]))
      continue;
    const what = actual === null ? 'tiene un valor escrito a mano' : `tiene la fórmula =${actual}`;
    out.push(
      finding(
        FORMULA_SEVERITY[column],
        FINDING_CODE.HANDWRITTEN_VALUE,
        day,
        `${column}${String(r)} ${what}; debe ser ${expected[column]}.`,
        { product, cell: `${column}${String(r)}`, autoFixable: true },
      ),
    );
  }

  return out;
}

// ---------------------------------------------------------------- resumen P:Q

const SUMMARY_LABEL = {
  INVERSION_INICIAL: 'inversion inicial',
  INVERSION_FINAL: 'inversion final',
  VENTA: 'venta total',
  COSTO: 'costo total',
  UTILIDAD_BRUTA: 'utilidad bruta',
  TOTAL_GASTOS: 'total',
  UTILIDAD: 'utilidad',
} as const;

type SummaryLabel = (typeof SUMMARY_LABEL)[keyof typeof SUMMARY_LABEL];

/** Fila de cada etiqueta de la columna P. El resumen se busca por texto, no por posición. */
function summaryRows(sheet: CuadreSheet): Map<string, number> {
  const rows = new Map<string, number>();
  for (const [address, content] of Object.entries(sheet.summary)) {
    const match = /^P(\d+)$/.exec(address);
    if (!match?.[1] || typeof content?.value !== 'string') continue;
    const key = normalizeName(content.value);
    if (!rows.has(key)) rows.set(key, Number(match[1]));
  }
  return rows;
}

const SUM_PATTERN = /^SUM\(([A-Z])(\d+):([A-Z])(\d+)\)$/;

function checkSum(
  sheet: CuadreSheet,
  labels: Map<string, number>,
  label: SummaryLabel,
  column: FormulaColumn,
  severity: Severity,
  lastProductRow: number,
): Finding[] {
  const row = labels.get(label);
  if (row === undefined) {
    return [
      finding(
        severity,
        FINDING_CODE.SUMMARY_FORMULA,
        sheet.tabName,
        `No encontré la celda "${label}" en el resumen.`,
      ),
    ];
  }
  const cell = `Q${String(row)}`;
  const formula = sheet.summary[cell]?.formula ?? null;
  const match = formula === null ? null : SUM_PATTERN.exec(canonicalFormula(formula));
  const [, from, start, to, end] = match ?? [];
  const ok =
    from === column &&
    to === column &&
    Number(start) <= FIRST_DATA_ROW &&
    Number(end) >= lastProductRow;
  if (ok) return [];

  const expected = `=SUM(${column}${String(FIRST_DATA_ROW)}:${column}${String(lastProductRow)})`;
  const actual = formula === null ? 'un valor escrito a mano' : `=${formula}`;
  return [
    finding(
      severity,
      FINDING_CODE.SUMMARY_FORMULA,
      sheet.tabName,
      `${cell} tiene ${actual}; debe sumar la columna ${column} hasta la última fila de productos (${expected} o más).`,
      { cell, autoFixable: true },
    ),
  ];
}

function summaryFindings(sheet: CuadreSheet): Finding[] {
  const out: Finding[] = [];
  const day = sheet.tabName;
  const labels = summaryRows(sheet);
  const lastProductRow = Math.max(FIRST_DATA_ROW, ...sheet.rows.map((r) => r.rowNumber));

  out.push(
    ...checkSum(
      sheet,
      labels,
      SUMMARY_LABEL.INVERSION_INICIAL,
      'C',
      SEVERITY.YELLOW,
      lastProductRow,
    ),
    ...checkSum(sheet, labels, SUMMARY_LABEL.INVERSION_FINAL, 'M', SEVERITY.YELLOW, lastProductRow),
    ...checkSum(sheet, labels, SUMMARY_LABEL.VENTA, 'K', SEVERITY.RED, lastProductRow),
    ...checkSum(sheet, labels, SUMMARY_LABEL.COSTO, 'L', SEVERITY.RED, lastProductRow),
  );

  const venta = labels.get(SUMMARY_LABEL.VENTA);
  const costo = labels.get(SUMMARY_LABEL.COSTO);
  const bruta = labels.get(SUMMARY_LABEL.UTILIDAD_BRUTA);
  const gastos = labels.get(SUMMARY_LABEL.TOTAL_GASTOS);
  const neta = labels.get(SUMMARY_LABEL.UTILIDAD);
  const q = (row: number) => `Q${String(row)}`;
  const formulaAt = (row: number) => {
    const formula = sheet.summary[q(row)]?.formula;
    return formula ? canonicalFormula(formula) : null;
  };

  if (venta !== undefined && costo !== undefined && bruta !== undefined) {
    const expected = `${q(venta)}-${q(costo)}`;
    if (formulaAt(bruta) !== expected) {
      out.push(
        finding(
          SEVERITY.RED,
          FINDING_CODE.SUMMARY_FORMULA,
          day,
          `Utilidad Bruta debe ser =${expected}.`,
          {
            cell: q(bruta),
            autoFixable: true,
          },
        ),
      );
    }
  }

  if (venta !== undefined && bruta !== undefined && gastos !== undefined && neta !== undefined) {
    const expected = `${q(bruta)}-${q(gastos)}`;
    const actual = formulaAt(neta);
    if (actual !== expected) {
      const reason =
        actual === `${q(venta)}-${q(gastos)}`
          ? 'Utilidad = Venta − Gastos'
          : `Utilidad tiene ${actual === null ? 'un valor escrito a mano' : `=${actual}`}`;
      out.push(
        finding(
          SEVERITY.RED,
          FINDING_CODE.NET_PROFIT_FORMULA,
          day,
          `${reason}; debe ser Utilidad Bruta − Gastos (=${expected}).`,
          { cell: q(neta), autoFixable: true },
        ),
      );
    }
  }

  if (sheet.tc === null) {
    out.push(
      finding(
        SEVERITY.WHITE,
        FINDING_CODE.MISSING_TC,
        day,
        'No hay TC: no se puede convertir el día a USD.',
      ),
    );
  }

  const totalGastos = gastos === undefined ? null : sheet.summary[q(gastos)]?.value;
  if (typeof totalGastos !== 'number' || totalGastos === 0) {
    out.push(
      finding(
        SEVERITY.WHITE,
        FINDING_CODE.NO_EXPENSES,
        day,
        'No hay gastos registrados en "Otros Gastos": confirma que no hubo (p. ej., transporte).',
      ),
    );
  }

  return out;
}

/** Validaciones de una sola hoja del cuadre. */
export function validateDay(sheet: CuadreSheet): Finding[] {
  const rows = sheet.rows.flatMap((row) => rowFindings(sheet.tabName, row));
  return [...rows, ...summaryFindings(sheet)];
}

// ---------------------------------------------------------------- entre días

function byProduct(sheet: CuadreSheet): Map<string, CuadreRow> {
  const map = new Map<string, CuadreRow>();
  for (const row of sheet.rows) {
    const key = normalizeName(row.product);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

const firstToken = (name: string): string => normalizeName(name).split(' ')[0] ?? '';

/** Producto nuevo del día siguiente que parece el mismo con otro nombre. */
function likelyRename(gone: CuadreRow, newRows: readonly CuadreRow[]): CuadreRow | undefined {
  const stock = n(gone.final);
  return newRows.find(
    (row) =>
      firstToken(row.product) === firstToken(gone.product) &&
      (n(row.inicio) === stock || (n(row.inicio) === 0 && n(row.entradas) === stock)),
  );
}

/** Validaciones que comparan un día con el siguiente. */
export function validateTransition(prev: CuadreSheet, next: CuadreSheet): Finding[] {
  const out: Finding[] = [];
  const day = next.tabName;
  const prevRows = byProduct(prev);
  const nextRows = byProduct(next);
  const newRows = [...nextRows.entries()]
    .filter(([key]) => !prevRows.has(key))
    .map(([, row]) => row);

  for (const [key, before] of prevRows) {
    const after = nextRows.get(key);
    const pf = before.final;

    if (after === undefined) {
      if (n(pf) > 0) {
        const rename = likelyRename(before, newRows);
        const hint = rename
          ? ` Posible renombre a "${rename.product}": un producto siempre conserva el mismo nombre.`
          : '';
        out.push(
          finding(
            SEVERITY.YELLOW,
            FINDING_CODE.DISAPPEARED,
            day,
            `Cerró el ${prev.tabName} con ${fmt(pf)} y no aparece el ${day}.${hint}`,
            { product: before.product },
          ),
        );
      }
      continue;
    }

    const product = after.product;
    const ni = n(after.inicio);

    if (pf === null) {
      // La final vacía ya se reporta en el día anterior; aquí no hay contra qué comparar.
    } else if (pf === 0 && available(before) > 0 && ni > 0) {
      const stock = available(before);
      out.push(
        finding(
          SEVERITY.RED,
          FINDING_CODE.FINAL_ZERO_SOLD_ALL,
          prev.tabName,
          `Cant. Final en 0: cuenta ${fmt(stock)} como vendidas (${fmt(stock * n(before.precio))} CUP)` +
            ` y el ${day} vuelve a abrir con ${fmt(ni)}. Probablemente la final quedó sin llenar.`,
          { product: before.product, cell: `J${String(before.rowNumber)}` },
        ),
      );
    } else if (ni === 0 && pf > 0 && n(after.entradas) >= pf) {
      out.push(
        finding(
          SEVERITY.YELLOW,
          FINDING_CODE.EXISTENCE_AS_ENTRADAS,
          day,
          `Inicio en 0 y entradas ${fmt(after.entradas)}, pero el ${prev.tabName} cerró con ${fmt(pf)}:` +
            ` la existencia se registró como entrada. Arreglo: inicio ${fmt(pf)}, entradas ${fmt(n(after.entradas) - pf)}.`,
          { product, cell: `E${String(after.rowNumber)}`, autoFixable: true },
        ),
      );
    } else if (pf !== ni) {
      out.push(
        finding(
          SEVERITY.YELLOW,
          FINDING_CODE.CONTINUITY,
          day,
          `Cant. Final del ${prev.tabName}: ${fmt(pf)} ≠ Cant. Inicio del ${day}: ${fmt(ni)}` +
            ` (diferencia ${fmt(ni - pf)}).`,
          { product, cell: `E${String(after.rowNumber)}` },
        ),
      );
    }

    if (before.precio !== null && after.precio !== null && before.precio !== after.precio) {
      out.push(
        finding(
          SEVERITY.WHITE,
          FINDING_CODE.PRICE_CHANGE,
          day,
          `Precio cambió de ${fmt(before.precio)} a ${fmt(after.precio)}.`,
          { product, cell: `D${String(after.rowNumber)}` },
        ),
      );
    }
    if (n(before.costo) > 0 && n(after.costo) > 0 && before.costo !== after.costo) {
      out.push(
        finding(
          SEVERITY.WHITE,
          FINDING_CODE.COST_CHANGE,
          day,
          `Costo cambió de ${fmt(before.costo)} a ${fmt(after.costo)}.`,
          { product, cell: `B${String(after.rowNumber)}` },
        ),
      );
    }
  }

  return out;
}

/** Corre todas las validaciones sobre días consecutivos, ordenadas por severidad. */
export function validateDays(sheets: readonly CuadreSheet[]): Finding[] {
  const out: Finding[] = [];
  sheets.forEach((sheet, index) => {
    out.push(...validateDay(sheet));
    const next = sheets[index + 1];
    if (next !== undefined) out.push(...validateTransition(sheet, next));
  });
  return sortFindings(out);
}

// ---------------------------------------------------------------- IPV

/** Validaciones del IPV antes de cargarlo: finales vacías y salidas negativas. */
export function validateIpv(ipv: IpvDay): Finding[] {
  const day = formatDayRef(ipv);
  const out: Finding[] = [];
  for (const row of ipv.rows) {
    const stock = n(row.inicial) + n(row.entrada);
    if (row.final === null && stock > 0) {
      out.push(
        finding(
          SEVERITY.RED,
          FINDING_CODE.EMPTY_FINAL,
          day,
          `Fila ${String(row.rowNumber)}: CANT. FINAL vacía con existencia ${fmt(stock)};` +
            ` el IPV la cuenta como vendida (${fmt(n(row.importe))} CUP).`,
          { product: row.product },
        ),
      );
    }
    if (n(row.salida) < 0 || n(row.final) < 0) {
      out.push(
        finding(
          SEVERITY.RED,
          FINDING_CODE.NEGATIVE_SALIDA,
          day,
          `Fila ${String(row.rowNumber)}: salida ${fmt(row.salida)} o final ${fmt(row.final)} negativa.`,
          { product: row.product },
        ),
      );
    }
  }
  return out;
}

/** Convierte la comparación de ventas en hallazgos para mostrar junto a las validaciones. */
export function salesFindings(check: SalesCheck, day: string): Finding[] {
  switch (check.status) {
    case SALES_CHECK.MATCH:
      return [];
    case SALES_CHECK.MERMA_EXPLAINED:
      return [
        finding(
          SEVERITY.YELLOW,
          FINDING_CODE.SALES_MERMA_EXPLAINED,
          day,
          `El IPV cuenta como venta ${fmt(check.amount)} CUP de merma/consumo.`,
        ),
      ];
    case SALES_CHECK.MISMATCH:
      return [
        finding(
          SEVERITY.RED,
          FINDING_CODE.SALES_MISMATCH,
          day,
          `La venta del cuadre (${fmt(check.ventaTotal)}) no es igual al IMPORTE TOTAL del IPV` +
            ` (diferencia ${fmt(check.diff)} CUP).`,
        ),
      ];
    case SALES_CHECK.NO_IPV_TOTAL:
      return [
        finding(
          SEVERITY.RED,
          FINDING_CODE.SALES_MISMATCH,
          day,
          'El IPV no tiene IMPORTE TOTAL: no se puede verificar la venta.',
        ),
      ];
  }
}

/**
 * Motivos que impiden cargar un IPV: finales vacías, salidas negativas o una venta
 * que no cuadra con el IPV. Lista vacía = se puede confirmar.
 */
export function ipvLoadBlockers(ipvFindings: readonly Finding[], sales: SalesCheck): Finding[] {
  const day = ipvFindings[0]?.day ?? '';
  return [...ipvFindings, ...salesFindings(sales, day)].filter((f) => BLOCKING_CODES.has(f.code));
}
