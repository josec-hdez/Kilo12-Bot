import {
  CUADRE_HEADERS,
  CuadreFormatError,
  FIRST_DATA_ROW,
  LAST_DATA_ROW,
  tcFromSummary,
} from '../../core/cuadre-layout.js';
import { normalizeName } from '../../core/tabs.js';
import type { CuadreRow, CuadreSheet, SheetCellContent } from '../../core/types.js';
import type { CuadreReader } from '../../ports/cuadre-source.js';
import {
  RENDER,
  type CellValue,
  type Grid,
  type SheetsGateway,
} from '../../ports/sheets-gateway.js';

const DAY_TAB_PATTERN = /^\d{1,2}$/;
const ROWS_A1 = `A1:N${String(LAST_DATA_ROW)}`;
/** Filas del resumen P:Q que se leen; la TC está en la 18 (o la 19 en hojas corridas). */
const SUMMARY_LAST_ROW = 30;
const SUMMARY_A1 = `P1:Q${String(SUMMARY_LAST_ROW)}`;

const at = (grid: Grid, row: number, column: number): CellValue => grid[row]?.[column] ?? '';

/** `=B2*E2` → `B2*E2`; un valor escrito a mano → `null`. */
function formulaOf(value: CellValue): string | null {
  return typeof value === 'string' && value.startsWith('=') ? value.slice(1) : null;
}

function numberOf(value: CellValue): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !value.startsWith('=')) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function textOf(value: CellValue): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** Índices de columna (A = 0) del layout A:N. */
const COL = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
  G: 6,
  H: 7,
  I: 8,
  J: 9,
  K: 10,
  L: 11,
  M: 12,
  N: 13,
};

function readRow(formulas: Grid, values: Grid, index: number): CuadreRow {
  const value = (column: number) => numberOf(at(values, index, column));
  const formula = (column: number) => formulaOf(at(formulas, index, column));
  return {
    rowNumber: index + 1,
    product: textOf(at(formulas, index, COL.A)).trim(),
    costo: value(COL.B),
    precio: value(COL.D),
    inicio: value(COL.E),
    entradas: value(COL.F),
    merma: value(COL.G),
    consumo: value(COL.H),
    final: value(COL.J),
    salida: value(COL.I),
    ventaBruta: value(COL.K),
    formulas: {
      C: formula(COL.C),
      I: formula(COL.I),
      K: formula(COL.K),
      L: formula(COL.L),
      M: formula(COL.M),
      N: formula(COL.N),
    },
  };
}

function readSummary(formulas: Grid, values: Grid): CuadreSheet['summary'] {
  const summary: CuadreSheet['summary'] = {};
  for (let row = 0; row < SUMMARY_LAST_ROW; row++) {
    (['P', 'Q'] as const).forEach((column, offset) => {
      const formula = formulaOf(at(formulas, row, offset));
      const raw = formula === null ? at(formulas, row, offset) : at(values, row, offset);
      const value: SheetCellContent['value'] =
        typeof raw === 'number' || (typeof raw === 'string' && raw !== '') ? raw : null;
      if (formula === null && value === null) return;
      summary[`${column}${String(row + 1)}`] = { value, formula };
    });
  }
  return summary;
}

function assertHeaders(tab: string, formulas: Grid): void {
  CUADRE_HEADERS.forEach((expected, column) => {
    const actual = textOf(at(formulas, 0, column));
    if (normalizeName(actual) !== normalizeName(expected)) {
      throw new CuadreFormatError(
        `La pestaña "${tab}" no tiene el encabezado "${expected.trim()}" en la columna ${String(column + 1)}`,
      );
    }
  });
}

/**
 * Lee el cuadre desde la hoja (Google Sheets o la simulada). Dos lecturas por día:
 * con fórmulas (para validarlas) y con valores (para las cantidades y el resumen).
 */
export class SheetsCuadreReader implements CuadreReader {
  constructor(private readonly sheets: SheetsGateway) {}

  async listDays(): Promise<string[]> {
    const tabs = await this.sheets.listTabs();
    return tabs
      .filter((tab) => DAY_TAB_PATTERN.test(tab.title.trim()))
      .sort((a, b) => a.index - b.index)
      .map((tab) => tab.title);
  }

  async readDay(tabName: string): Promise<CuadreSheet> {
    const tabs = await this.sheets.listTabs();
    const tab = tabs.find((existing) => existing.title.trim() === tabName.trim())?.title;
    if (tab === undefined)
      throw new CuadreFormatError(`El cuadre no tiene la pestaña "${tabName}"`);

    const ranges = [
      { tab, a1: ROWS_A1 },
      { tab, a1: SUMMARY_A1 },
    ];
    const [rowFormulas = [], summaryFormulas = []] = await this.sheets.readRanges(
      ranges,
      RENDER.FORMULA,
    );
    const [rowValues = [], summaryValues = []] = await this.sheets.readRanges(ranges, RENDER.VALUE);
    assertHeaders(tab, rowFormulas);

    const rows: CuadreRow[] = [];
    for (let index = FIRST_DATA_ROW - 1; index < rowFormulas.length; index++) {
      const row = readRow(rowFormulas, rowValues, index);
      if (row.product !== '') rows.push(row);
    }
    const summary = readSummary(summaryFormulas, summaryValues);
    return { tabName: tab, rows, summary, tc: tcFromSummary(summary) };
  }
}
