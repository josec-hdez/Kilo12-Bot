import { describe, expect, it } from 'vitest';
import { MemoryExpenseLog } from '../../src/adapters/sheets/memory-expense-log.js';
import {
  answerExpense,
  chooseCurrency,
  chooseOtherDay,
  chooseToday,
  completeExpense,
  datePrompt,
  EXPENSE_STEP,
  EXPENSE_TEXT,
  expensePreview,
  RECORD_STATUS,
  recordExpense,
  startExpense,
  type ExpenseDraft,
} from '../../src/app/record-expense.js';

const TODAY = { year: 2026, month: 10, day: 20 };

/** Responde varias preguntas seguidas; falla si alguna respuesta no sirve. */
function answerAll(draft: ExpenseDraft, answers: string[]): ExpenseDraft {
  return answers.reduce((current, text) => {
    const result = answerExpense(current, text, TODAY);
    if (result.error !== undefined) throw new Error(`${text}: ${result.error}`);
    return result.draft;
  }, draft);
}

describe('borrador de ➕ Gasto', () => {
  it('empieza con la fecha de hoy y la muestra', () => {
    const draft = startExpense(TODAY);
    expect(draft).toEqual({ step: EXPENSE_STEP.DATE, date: TODAY });
    expect(datePrompt(draft)).toContain('hoy, 20/10/2026');
  });

  it('[Hoy] → cantidad → moneda → descripción → vista previa', () => {
    let draft = chooseToday(startExpense(TODAY), TODAY);
    expect(draft.step).toBe(EXPENSE_STEP.AMOUNT);
    draft = answerAll(draft, ['1,500']);
    expect(draft.step).toBe(EXPENSE_STEP.CURRENCY);
    draft = chooseCurrency(draft, 'CUP');
    expect(draft.step).toBe(EXPENSE_STEP.DESCRIPTION);
    draft = answerAll(draft, ['transporte']);
    expect(draft.step).toBe(EXPENSE_STEP.CONFIRM);
    expect(completeExpense(draft)).toEqual({
      date: TODAY,
      amount: 1500,
      currency: 'CUP',
      description: 'transporte',
    });
  });

  it('[Otro día] espera la fecha escrita; también se puede escribir sin tocarlo', () => {
    const other = chooseOtherDay(startExpense(TODAY));
    expect(other.step).toBe(EXPENSE_STEP.DATE_TEXT);
    expect(answerAll(other, ['18/10']).date).toEqual({ year: 2026, month: 10, day: 18 });
    expect(answerAll(startExpense(TODAY), ['2/10']).date).toEqual({
      year: 2026,
      month: 10,
      day: 2,
    });
  });

  it('una respuesta inválida deja el borrador igual y explica qué escribir', () => {
    const start = startExpense(TODAY);
    expect(answerExpense(start, '25/10', TODAY)).toEqual({
      draft: start,
      error: EXPENSE_TEXT.BAD_DATE,
    });
    const amount = chooseToday(start, TODAY);
    expect(answerExpense(amount, 'mil', TODAY).error).toBe(EXPENSE_TEXT.BAD_AMOUNT);
    const currency = answerAll(amount, ['10']);
    expect(answerExpense(currency, 'EUR', TODAY).error).toBe(EXPENSE_TEXT.BAD_CURRENCY);
    expect(answerAll(currency, ['usd']).currency).toBe('USD');
    const description = chooseCurrency(currency, 'CUP');
    expect(answerExpense(description, '  ', TODAY).error).toBe(EXPENSE_TEXT.BAD_DESCRIPTION);
    const confirm = answerAll(description, ['hielo']);
    expect(answerExpense(confirm, 'sí', TODAY).error).toBe(EXPENSE_TEXT.USE_BUTTONS);
  });

  it('un borrador incompleto no es un gasto', () => {
    expect(completeExpense(startExpense(TODAY))).toBeNull();
  });

  it('la vista previa dice que el cuadre no cambia', () => {
    const preview = expensePreview({
      date: TODAY,
      amount: 20.5,
      currency: 'USD',
      description: 'hielo',
    });
    expect(preview).toContain('Cantidad: 20.5 USD');
    expect(preview).toContain('el cuadre no cambia');
  });
});

describe('recordExpense', () => {
  const expense = { date: TODAY, amount: 1500, currency: 'CUP', description: 'agua' } as const;

  it('agrega el gasto al historial', async () => {
    const log = new MemoryExpenseLog();
    const result = await recordExpense(log, expense);
    expect(result).toEqual({
      status: RECORD_STATUS.DONE,
      message: '✅ Gasto registrado en la hoja Gastos: 20/10/2026 · 1,500 CUP · agua.',
    });
    expect(log.expenses).toEqual([expense]);
  });

  it('si la hoja falla, lo dice y no lanza', async () => {
    const result = await recordExpense(
      { append: () => Promise.reject(new Error('The caller does not have permission')) },
      expense,
    );
    expect(result.status).toBe(RECORD_STATUS.FAILED);
    expect(result.message).toContain('The caller does not have permission');
    expect(result.message).toContain('No se registró nada');
  });
});
