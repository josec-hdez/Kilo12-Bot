import ExcelJS from 'exceljs';

/**
 * Devuelve el valor ya calculado de una celda. En las fórmulas usa el último resultado
 * que guardó Excel; no recalcula.
 */
export function rawValue(value: ExcelJS.CellValue): unknown {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return value.result;
    // exceljs omite el resultado cuando Excel guardó un 0 (`<v>0</v>`).
    if ('formula' in value || 'sharedFormula' in value) return 0;
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return value.text;
    if ('error' in value) return null;
  }
  return value;
}

export function cellText(cell: ExcelJS.Cell): string {
  const value = rawValue(cell.value);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function cellNumber(cell: ExcelJS.Cell): number | null {
  const value = rawValue(cell.value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Texto de la fórmula sin el `=` inicial. Las fórmulas compartidas se traducen a su fila. */
export function cellFormula(cell: ExcelJS.Cell): string | null {
  if (cell.type !== ExcelJS.ValueType.Formula) return null;
  const formula = cell.formula;
  return formula === '' ? null : formula;
}
