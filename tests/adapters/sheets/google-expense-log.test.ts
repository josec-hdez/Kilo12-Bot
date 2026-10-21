import { describe, expect, it } from 'vitest';
import {
  EXPENSE_KEY_COLUMN,
  GoogleExpenseLog,
  lastFilledRow,
  type ExpenseSheetClient,
} from '../../../src/adapters/sheets/google-expense-log.js';
import type { Expense } from '../../../src/core/expense.js';

const EXPENSE: Expense = {
  date: { year: 2026, month: 10, day: 5 },
  amount: 1500,
  currency: 'CUP',
  description: 'transporte',
};

interface Calls {
  values: string[];
  addRows: { sheetId: number; count: number }[];
  update: { spreadsheetId: string; range: string; rows: (string | number)[][] }[];
}

/** Columna A tal como la devuelve la API (sin las filas vacías del final). */
function fakeClient(
  columnA: unknown[][],
  rowCount = 1000,
): { client: ExpenseSheetClient; calls: Calls } {
  const calls: Calls = { values: [], addRows: [], update: [] };
  const client: ExpenseSheetClient = {
    firstVisibleSheet: () => Promise.resolve({ sheetId: 7, title: 'Hoja 1', rowCount }),
    values: (_id, range) => {
      calls.values.push(range);
      return Promise.resolve(columnA);
    },
    addRows: (_id, sheetId, count) => {
      calls.addRows.push({ sheetId, count });
      return Promise.resolve();
    },
    update: (spreadsheetId, range, rows) => {
      calls.update.push({ spreadsheetId, range, rows });
      return Promise.resolve();
    },
  };
  return { client, calls };
}

describe('lastFilledRow', () => {
  it('devuelve la última fila con valor e ignora vacíos intermedios y del final', () => {
    expect(lastFilledRow([])).toBe(0);
    expect(lastFilledRow([['Fecha']])).toBe(1);
    expect(lastFilledRow([['Fecha'], [], ['2026-10-15'], [''], ['  ']])).toBe(3);
  });
});

describe('GoogleExpenseLog', () => {
  it('con solo el encabezado escribe en la fila 2, columnas A:D de la primera hoja visible', async () => {
    const { client, calls } = fakeClient([['Fecha']]);
    await new GoogleExpenseLog(client, 'GASTOS').append(EXPENSE);
    expect(calls.values).toEqual([`'Hoja 1'!${EXPENSE_KEY_COLUMN}`]);
    expect(calls.update).toEqual([
      {
        spreadsheetId: 'GASTOS',
        range: "'Hoja 1'!A2:D2",
        rows: [['2026-10-05', 1500, 'CUP', 'transporte']],
      },
    ]);
    expect(calls.addRows).toEqual([]);
  });

  it('escribe debajo del último gasto', async () => {
    const { client, calls } = fakeClient([['Fecha'], ['2026-10-15'], ['2026-10-16']]);
    await new GoogleExpenseLog(client, 'GASTOS').append(EXPENSE);
    expect(calls.update[0]?.range).toBe("'Hoja 1'!A4:D4");
  });

  it('no se va al final de la cuadrícula cuando otra columna tiene casillas hasta abajo', async () => {
    // Columna E "Confirmado en cuadre" con FALSE hasta la fila 1001: la columna A
    // solo tiene el encabezado y un gasto, así que el siguiente va en la fila 3.
    const { client, calls } = fakeClient([['Fecha'], ['2026-10-15']], 1002);
    await new GoogleExpenseLog(client, 'GASTOS').append(EXPENSE);
    expect(calls.update[0]?.range).toBe("'Hoja 1'!A3:D3");
    expect(calls.addRows).toEqual([]);
  });

  it('agrega filas a la cuadrícula si la hoja está llena', async () => {
    const { client, calls } = fakeClient([['Fecha'], ['2026-10-15']], 2);
    await new GoogleExpenseLog(client, 'GASTOS').append(EXPENSE);
    expect(calls.addRows).toEqual([{ sheetId: 7, count: 1 }]);
    expect(calls.update[0]?.range).toBe("'Hoja 1'!A3:D3");
  });

  it('una descripción que parece fórmula se guarda como texto', async () => {
    const { client, calls } = fakeClient([['Fecha']]);
    await new GoogleExpenseLog(client, 'GASTOS').append({ ...EXPENSE, description: '=1+1' });
    expect(calls.update[0]?.rows[0]?.[3]).toBe("'=1+1");
  });

  it('propaga el error de la API (el caso de uso lo convierte en aviso)', async () => {
    const { client } = fakeClient([['Fecha']]);
    const log = new GoogleExpenseLog(
      { ...client, update: () => Promise.reject(new Error('403')) },
      'GASTOS',
    );
    await expect(log.append(EXPENSE)).rejects.toThrow('403');
  });
});
