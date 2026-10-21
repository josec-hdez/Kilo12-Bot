import { auth, sheets } from '@googleapis/sheets';
import { expenseRow, type Expense } from '../../core/expense.js';
import type { ExpenseLog } from '../../ports/expense-log.js';
import { a1WithTab, readServiceAccount } from './google-sheets-gateway.js';

/** Columna que decide cuál es la última fila: la Fecha, que todo gasto tiene. */
export const EXPENSE_KEY_COLUMN = 'A:A';

type Row = (string | number)[];

/** Primera hoja visible del libro: el bot escribe ahí aunque cambie de nombre. */
export interface ExpenseSheet {
  sheetId: number;
  title: string;
  /** Filas de la cuadrícula (no las ocupadas). */
  rowCount: number;
}

/** Las llamadas que hace el historial; separadas para probar sin red. */
export interface ExpenseSheetClient {
  firstVisibleSheet(spreadsheetId: string): Promise<ExpenseSheet>;
  /** Valores de un rango; la API recorta las filas vacías del final. */
  values(spreadsheetId: string, range: string): Promise<unknown[][]>;
  addRows(spreadsheetId: string, sheetId: number, count: number): Promise<void>;
  update(spreadsheetId: string, range: string, rows: Row[]): Promise<void>;
}

/** Número de la última fila con algo escrito (0 si la columna está vacía). */
export function lastFilledRow(column: unknown[][]): number {
  for (let index = column.length - 1; index >= 0; index -= 1) {
    const value = column[index]?.[0];
    if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) {
      return index + 1;
    }
  }
  return 0;
}

/**
 * Escribe el gasto debajo de la última fila con Fecha. No usa `values.append`: Sheets
 * toma como parte de la tabla las columnas extra que agreguen las dueñas (p. ej. una
 * casilla "Confirmado en cuadre" con FALSE hasta la fila 1000) y mandaría el gasto al
 * final de la cuadrícula. Las columnas de la derecha no se tocan.
 */
export class GoogleExpenseLog implements ExpenseLog {
  constructor(
    private readonly client: ExpenseSheetClient,
    private readonly spreadsheetId: string,
  ) {}

  async append(expense: Expense): Promise<void> {
    const sheet = await this.client.firstVisibleSheet(this.spreadsheetId);
    const column = await this.client.values(
      this.spreadsheetId,
      a1WithTab(sheet.title, EXPENSE_KEY_COLUMN),
    );
    const row = lastFilledRow(column) + 1;
    if (row > sheet.rowCount) {
      await this.client.addRows(this.spreadsheetId, sheet.sheetId, row - sheet.rowCount);
    }
    await this.client.update(this.spreadsheetId, a1WithTab(sheet.title, `A${row}:D${row}`), [
      expenseRow(expense),
    ]);
  }
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/** `values.update` con USER_ENTERED: la fecha y el monto quedan con su tipo. */
export function createExpenseSheetClient(serviceAccountJson: string): ExpenseSheetClient {
  const credentials = readServiceAccount(serviceAccountJson);
  const api = sheets({
    version: 'v4',
    auth: new auth.GoogleAuth({ credentials, scopes: SCOPES }),
  });
  return {
    async firstVisibleSheet(spreadsheetId) {
      const response = await api.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title,hidden,gridProperties(rowCount)))',
      });
      const properties = (response.data.sheets ?? [])
        .map((sheet) => sheet.properties)
        .find((props) => props && !props.hidden);
      if (!properties) throw new Error('La hoja de gastos no tiene pestañas visibles.');
      return {
        sheetId: properties.sheetId ?? 0,
        title: properties.title ?? '',
        rowCount: properties.gridProperties?.rowCount ?? 0,
      };
    },
    async values(spreadsheetId, range) {
      const response = await api.spreadsheets.values.get({ spreadsheetId, range });
      return response.data.values ?? [];
    },
    async addRows(spreadsheetId, sheetId, count) {
      await api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ appendDimension: { sheetId, dimension: 'ROWS', length: count } }],
        },
      });
    },
    async update(spreadsheetId, range, rows) {
      await api.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { majorDimension: 'ROWS', values: rows },
      });
    },
  };
}
