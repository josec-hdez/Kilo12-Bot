import type { Expense } from '../../core/expense.js';
import type { ExpenseLog } from '../../ports/expense-log.js';

/**
 * Historial simulado (sin service account o sin GASTOS_SPREADSHEET_ID): guarda los
 * gastos en memoria y se pierden al reiniciar. El bot lo avisa al arrancar.
 */
export class MemoryExpenseLog implements ExpenseLog {
  readonly expenses: Expense[] = [];

  append(expense: Expense): Promise<void> {
    this.expenses.push(expense);
    return Promise.resolve();
  }
}
