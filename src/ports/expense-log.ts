import type { Expense } from '../core/expense.js';

/** Historial de gastos (hoja "Gastos" de Google Sheets): solo se agregan filas. */
export interface ExpenseLog {
  append(expense: Expense): Promise<void>;
}
