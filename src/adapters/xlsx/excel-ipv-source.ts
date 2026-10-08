import ExcelJS from 'exceljs';
import { cellNumber, cellText } from './cells.js';
import { findIpvTab, formatDayRef, normalizeName, parseIpvTabDate } from '../../core/tabs.js';
import type { DayRef, IpvDay, IpvRow, IpvTabRef } from '../../core/types.js';
import type { IpvSource } from '../../ports/ipv-source.js';

const HEADER_FIELDS = {
  mercancia: 'product',
  'cant. inicial': 'inicial',
  entrada: 'entrada',
  merma: 'merma',
  consumo: 'consumo',
  salida: 'salida',
  precio: 'precio',
  importe: 'importe',
  'cant. final': 'final',
} as const;

type HeaderKey = keyof typeof HEADER_FIELDS;
type IpvField = (typeof HEADER_FIELDS)[HeaderKey];
type ColumnMap = Record<IpvField, number>;

const IMPORTE_TOTAL = 'importe total';
const TOTAL_VENDIDO_REAL = 'total vendido real';
/** Filas donde se busca el encabezado `MERCANCIA`. En el archivo real está en la fila 2. */
const HEADER_SEARCH_ROWS = 10;

export class IpvFormatError extends Error {
  override name = 'IpvFormatError';
}

function isHeaderKey(value: string): value is HeaderKey {
  return Object.hasOwn(HEADER_FIELDS, value);
}

function findColumns(sheet: ExcelJS.Worksheet): { headerRow: number; columns: ColumnMap } {
  for (let rowNumber = 1; rowNumber <= HEADER_SEARCH_ROWS; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const found: Partial<ColumnMap> = {};
    row.eachCell((cell, colNumber) => {
      const key = normalizeName(cellText(cell));
      if (isHeaderKey(key)) found[HEADER_FIELDS[key]] = colNumber;
    });
    if (found.product === undefined) continue;

    const missing = Object.values(HEADER_FIELDS).filter((field) => found[field] === undefined);
    if (missing.length > 0) {
      throw new IpvFormatError(
        `La pestaña "${sheet.name}" no tiene las columnas: ${missing.join(', ')}`,
      );
    }
    return { headerRow: rowNumber, columns: found as ColumnMap };
  }
  throw new IpvFormatError(`La pestaña "${sheet.name}" no tiene el encabezado MERCANCIA`);
}

function readSheet(sheet: ExcelJS.Worksheet, ref: IpvTabRef): IpvDay {
  const { headerRow, columns } = findColumns(sheet);
  const rows: IpvRow[] = [];
  let importeTotal: number | null = null;
  let totalVendidoReal: number | null = null;
  let reachedTotal = false;

  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const label = cellText(row.getCell(columns.product)).trim();
    const normalized = normalizeName(label);
    if (label === '') continue;

    // El total se escribe en la columna siguiente a la etiqueta.
    if (normalized === IMPORTE_TOTAL) {
      importeTotal = cellNumber(row.getCell(columns.product + 1));
      reachedTotal = true;
      continue;
    }
    if (normalized === TOTAL_VENDIDO_REAL) {
      totalVendidoReal = cellNumber(row.getCell(columns.product + 1));
      continue;
    }
    if (reachedTotal) continue;

    rows.push({
      rowNumber,
      product: label.replace(/\s+/g, ' '),
      inicial: cellNumber(row.getCell(columns.inicial)),
      entrada: cellNumber(row.getCell(columns.entrada)),
      merma: cellNumber(row.getCell(columns.merma)),
      consumo: cellNumber(row.getCell(columns.consumo)),
      salida: cellNumber(row.getCell(columns.salida)),
      precio: cellNumber(row.getCell(columns.precio)),
      importe: cellNumber(row.getCell(columns.importe)),
      final: cellNumber(row.getCell(columns.final)),
    });
  }

  return { ...ref, rows, importeTotal, totalVendidoReal };
}

/** IPV en un .xlsx con una pestaña por día (`1 oct`, `2 oct `…). */
export class ExcelIpvSource implements IpvSource {
  private constructor(private readonly workbook: ExcelJS.Workbook) {}

  static async fromFile(path: string): Promise<ExcelIpvSource> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    return new ExcelIpvSource(workbook);
  }

  static async fromBuffer(buffer: ArrayBuffer): Promise<ExcelIpvSource> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return new ExcelIpvSource(workbook);
  }

  listDays(): IpvTabRef[] {
    return this.workbook.worksheets.flatMap((sheet) => {
      const parsed = parseIpvTabDate(sheet.name);
      return parsed ? [{ ...parsed, tabName: sheet.name }] : [];
    });
  }

  readDay(ref: DayRef): IpvDay {
    const tabName = findIpvTab(
      this.workbook.worksheets.map((sheet) => sheet.name),
      ref,
    );
    const sheet = tabName === null ? undefined : this.workbook.getWorksheet(tabName);
    if (tabName === null || sheet === undefined) {
      throw new IpvFormatError(`El IPV no tiene la pestaña del ${formatDayRef(ref)}`);
    }
    return readSheet(sheet, { day: ref.day, month: ref.month, tabName });
  }
}
