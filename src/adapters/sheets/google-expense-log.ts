import { auth, sheets } from '@googleapis/sheets';
import { expenseRow, type Expense } from '../../core/expense.js';
import type { ExpenseLog } from '../../ports/expense-log.js';
import { readServiceAccount } from './google-sheets-gateway.js';

/**
 * Sin nombre de pestaña, Sheets usa la primera hoja visible del libro: así el bot
 * sigue escribiendo aunque la pestaña ("Hoja 1") cambie de nombre.
 */
export const EXPENSE_RANGE = 'A:D';

type Row = (string | number)[];

/** La única llamada que hace el historial; separada para probar sin red. */
export interface ExpenseAppendClient {
  append(spreadsheetId: string, range: string, rows: Row[]): Promise<void>;
}

export class GoogleExpenseLog implements ExpenseLog {
  constructor(
    private readonly client: ExpenseAppendClient,
    private readonly spreadsheetId: string,
  ) {}

  async append(expense: Expense): Promise<void> {
    await this.client.append(this.spreadsheetId, EXPENSE_RANGE, [expenseRow(expense)]);
  }
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * `values.append` con USER_ENTERED (la fecha y el monto quedan con su tipo) e
 * INSERT_ROWS (agrega filas debajo de la última, sin pisar nada).
 */
export function createExpenseAppendClient(serviceAccountJson: string): ExpenseAppendClient {
  const credentials = readServiceAccount(serviceAccountJson);
  const api = sheets({
    version: 'v4',
    auth: new auth.GoogleAuth({ credentials, scopes: SCOPES }),
  });
  return {
    async append(spreadsheetId, range, rows) {
      await api.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { majorDimension: 'ROWS', values: rows },
      });
    },
  };
}
