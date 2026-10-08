import ExcelJS from 'exceljs';
import { cellFormula, cellNumber, cellText, rawValue } from './cells.js';
import {
  CUADRE_HEADERS,
  CuadreFormatError,
  FIRST_DATA_ROW,
  tcFromSummary,
} from '../../core/cuadre-layout.js';
import { normalizeName } from '../../core/tabs.js';
import type { CuadreRow, CuadreSheet, SheetCellContent } from '../../core/types.js';
import type { CuadreReader, CuadreSource } from '../../ports/cuadre-source.js';

export { CuadreFormatError };

const DAY_TAB_PATTERN = /^\d{1,2}$/;
const SUMMARY_COLUMNS = ['P', 'Q'] as const;
/** Filas del resumen P:Q que se leen; el original llega hasta la TC en la fila 18. */
const SUMMARY_LAST_ROW = 30;

function assertHeaders(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  CUADRE_HEADERS.forEach((expected, index) => {
    const actual = cellText(header.getCell(index + 1));
    if (normalizeName(actual) !== normalizeName(expected)) {
      throw new CuadreFormatError(
        `La pestaña "${sheet.name}" no tiene el encabezado "${expected.trim()}" en la columna ${String(index + 1)}`,
      );
    }
  });
}

function readRow(row: ExcelJS.Row): CuadreRow {
  const at = (column: string) => row.getCell(column);
  return {
    rowNumber: row.number,
    product: cellText(at('A')).trim(),
    costo: cellNumber(at('B')),
    precio: cellNumber(at('D')),
    inicio: cellNumber(at('E')),
    entradas: cellNumber(at('F')),
    merma: cellNumber(at('G')),
    consumo: cellNumber(at('H')),
    final: cellNumber(at('J')),
    salida: cellNumber(at('I')),
    ventaBruta: cellNumber(at('K')),
    invsInicial: cellNumber(at('C')),
    costoFinal: cellNumber(at('L')),
    invsFinal: cellNumber(at('M')),
    utilidad: cellNumber(at('N')),
    formulas: {
      C: cellFormula(at('C')),
      I: cellFormula(at('I')),
      K: cellFormula(at('K')),
      L: cellFormula(at('L')),
      M: cellFormula(at('M')),
      N: cellFormula(at('N')),
    },
  };
}

function summaryValue(cell: ExcelJS.Cell): SheetCellContent['value'] {
  const value = rawValue(cell.value);
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function readSummary(sheet: ExcelJS.Worksheet): CuadreSheet['summary'] {
  const summary: CuadreSheet['summary'] = {};
  for (let rowNumber = 1; rowNumber <= SUMMARY_LAST_ROW; rowNumber++) {
    for (const column of SUMMARY_COLUMNS) {
      const cell = sheet.getCell(`${column}${String(rowNumber)}`);
      const formula = cellFormula(cell);
      const value = summaryValue(cell);
      if (formula === null && value === null) continue;
      summary[cell.address] = { value, formula };
    }
  }
  return summary;
}

function readSheet(sheet: ExcelJS.Worksheet): CuadreSheet {
  assertHeaders(sheet);
  const rows: CuadreRow[] = [];
  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = readRow(sheet.getRow(rowNumber));
    if (row.product !== '') rows.push(row);
  }

  const summary = readSummary(sheet);
  return { tabName: sheet.name, rows, summary, tc: tcFromSummary(summary) };
}

/** Cuadre exportado como .xlsx, con una pestaña por día (`01`, `02`…). */
export class CuadreXlsxReader implements CuadreSource {
  private constructor(private readonly workbook: ExcelJS.Workbook) {}

  static async fromFile(path: string): Promise<CuadreXlsxReader> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    return new CuadreXlsxReader(workbook);
  }

  listDays(): string[] {
    return this.workbook.worksheets
      .map((sheet) => sheet.name)
      .filter((name) => DAY_TAB_PATTERN.test(name.trim()));
  }

  readDay(tabName: string): CuadreSheet {
    const sheet = this.workbook.worksheets.find((ws) => ws.name.trim() === tabName.trim());
    if (sheet === undefined) {
      throw new CuadreFormatError(`El cuadre no tiene la pestaña "${tabName}"`);
    }
    return readSheet(sheet);
  }
}

/** Expone un cuadre .xlsx ya cargado como lector asíncrono (para /validar sin hoja real). */
export function asCuadreReader(source: CuadreSource): CuadreReader {
  return {
    listDays: () => Promise.resolve(source.listDays()),
    readDay: (tabName) => Promise.resolve(source.readDay(tabName)),
  };
}
