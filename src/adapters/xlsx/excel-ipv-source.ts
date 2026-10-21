import ExcelJS from 'exceljs';
import { cellNumber, cellText } from './cells.js';
import {
  formatDayRef,
  normalizeName,
  parseIpvTabDate,
  parsePosTabDate,
  parsePosTitleDate,
} from '../../core/tabs.js';
import { IPV_FORMAT } from '../../core/types.js';
import type { DayRef, IpvDay, IpvFormat, IpvRow, IpvTabRef } from '../../core/types.js';
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

interface SheetInfo {
  format: IpvFormat;
  /** Día que dice la hoja; null si no lo dice. */
  date: DayRef | null;
}

/**
 * Formato y día de una hoja. El POS pone la fecha completa en A1 y en el nombre
 * (`Turno 18 10-14`); se prefiere A1. El IPV a mano solo la tiene en el nombre (`3 oct`).
 */
function sheetInfo(sheet: ExcelJS.Worksheet): SheetInfo {
  const posDate = parsePosTitleDate(cellText(sheet.getCell('A1'))) ?? parsePosTabDate(sheet.name);
  if (posDate !== null) return { format: IPV_FORMAT.POS, date: posDate };
  return { format: IPV_FORMAT.LEGACY, date: parseIpvTabDate(sheet.name) };
}

/** Total de una fila de pie: en la columna IMPORTE (POS) o junto a la etiqueta (a mano). */
function footerTotal(row: ExcelJS.Row, columns: ColumnMap): number | null {
  return cellNumber(row.getCell(columns.importe)) ?? cellNumber(row.getCell(columns.product + 1));
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

    if (normalized === IMPORTE_TOTAL) {
      importeTotal = footerTotal(row, columns);
      reachedTotal = true;
      continue;
    }
    if (normalized === TOTAL_VENDIDO_REAL) {
      totalVendidoReal = footerTotal(row, columns);
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

  return { ...ref, format: sheetInfo(sheet).format, rows, importeTotal, totalVendidoReal };
}

/**
 * IPV en un .xlsx: el del programa de control (una hoja `Turno 18 10-14`) o el
 * hecho a mano, con una pestaña por día (`1 oct`, `2 oct `…).
 */
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

  listSheets(): string[] {
    return this.workbook.worksheets.map((sheet) => sheet.name);
  }

  listDays(): IpvTabRef[] {
    return this.workbook.worksheets.flatMap((sheet) => {
      const { date } = sheetInfo(sheet);
      return date ? [{ ...date, tabName: sheet.name }] : [];
    });
  }

  sheetDate(tabName: string): DayRef | null {
    const sheet = this.workbook.getWorksheet(tabName);
    return sheet?.name === tabName ? sheetInfo(sheet).date : null;
  }

  readDay(ref: DayRef): IpvDay {
    const found = this.listDays().find((tab) => tab.day === ref.day && tab.month === ref.month);
    const sheet = found === undefined ? undefined : this.workbook.getWorksheet(found.tabName);
    if (found === undefined || sheet === undefined) {
      throw new IpvFormatError(`El IPV no tiene la pestaña del ${formatDayRef(ref)}`);
    }
    return readSheet(sheet, { day: ref.day, month: ref.month, tabName: found.tabName });
  }

  readSheet(tabName: string, ref: DayRef): IpvDay {
    const sheet = this.workbook.getWorksheet(tabName);
    // getWorksheet ignora mayúsculas: se exige el nombre exacto.
    if (sheet?.name !== tabName) {
      throw new IpvFormatError(`El IPV no tiene la hoja «${tabName}»`);
    }
    return readSheet(sheet, { day: ref.day, month: ref.month, tabName });
  }
}
