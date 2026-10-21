import { describe, expect, it } from 'vitest';
import {
  EXPENSE_RANGE,
  GoogleExpenseLog,
  type ExpenseAppendClient,
} from '../../../src/adapters/sheets/google-expense-log.js';

describe('GoogleExpenseLog', () => {
  it('agrega una fila Fecha | Cantidad | Moneda | Descripcion en la primera hoja', async () => {
    const calls: { spreadsheetId: string; range: string; rows: (string | number)[][] }[] = [];
    const client: ExpenseAppendClient = {
      append: (spreadsheetId, range, rows) => {
        calls.push({ spreadsheetId, range, rows });
        return Promise.resolve();
      },
    };
    await new GoogleExpenseLog(client, 'GASTOS').append({
      date: { year: 2026, month: 10, day: 5 },
      amount: 1500,
      currency: 'CUP',
      description: 'transporte',
    });
    expect(EXPENSE_RANGE).toBe('A:D');
    expect(calls).toEqual([
      { spreadsheetId: 'GASTOS', range: 'A:D', rows: [['2026-10-05', 1500, 'CUP', 'transporte']] },
    ]);
  });

  it('propaga el error de la API (el caso de uso lo convierte en aviso)', async () => {
    const log = new GoogleExpenseLog({ append: () => Promise.reject(new Error('403')) }, 'GASTOS');
    await expect(
      log.append({
        date: { year: 2026, month: 10, day: 5 },
        amount: 1,
        currency: 'USD',
        description: 'x',
      }),
    ).rejects.toThrow('403');
  });
});
