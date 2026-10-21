import {
  formatExpenseDate,
  parseExpenseAmount,
  parseExpenseCurrency,
  parseExpenseDate,
  parseExpenseDescription,
  type CalendarDate,
  type Expense,
  type ExpenseCurrency,
} from '../core/expense.js';
import type { ExpenseLog } from '../ports/expense-log.js';
import { qty } from './report-format.js';

/**
 * ➕ Gasto: flujo guiado que arma una fila del historial "Gastos" (fecha, cantidad,
 * moneda, descripción) y la agrega al confirmar. Puro salvo `recordExpense`: el
 * adaptador de Telegram guarda el borrador y dibuja los botones.
 */

export const EXPENSE_STEP = {
  /** Muestra la fecha de hoy: [Hoy] / [Otro día], o se escribe la fecha. */
  DATE: 'date',
  /** Tocó [Otro día]: espera la fecha escrita. */
  DATE_TEXT: 'date_text',
  AMOUNT: 'amount',
  /** [CUP] / [USD], o se escribe. */
  CURRENCY: 'currency',
  DESCRIPTION: 'description',
  /** Vista previa: [✅ Confirmar] / [❌ Cancelar]. */
  CONFIRM: 'confirm',
} as const;

export type ExpenseStep = (typeof EXPENSE_STEP)[keyof typeof EXPENSE_STEP];

export interface ExpenseDraft {
  step: ExpenseStep;
  /** Hoy por defecto, hasta que el usuario elija otro día. */
  date: CalendarDate;
  amount?: number;
  currency?: ExpenseCurrency;
  description?: string;
}

export const EXPENSE_TEXT = {
  ASK_DATE_TEXT:
    '🗓 Escribe la fecha del gasto, por ejemplo: 18/10 o 18/10/2026. /cancelar para salir.',
  ASK_AMOUNT: '💵 ¿Cuánto fue? Escribe solo el número, por ejemplo: 1500. /cancelar para salir.',
  ASK_CURRENCY: '💱 ¿En qué moneda?',
  ASK_DESCRIPTION:
    '📝 ¿En qué se gastó? Por ejemplo: transporte de mercancía. /cancelar para salir.',
  BAD_DATE:
    'No entiendo esa fecha o es posterior a hoy. Escribe, por ejemplo, 18/10 o 18/10/2026, o /cancelar.',
  BAD_AMOUNT: 'Escribe solo un número mayor que 0, por ejemplo: 1500. /cancelar para salir.',
  BAD_CURRENCY: 'Elige CUP o USD con los botones de arriba (o escríbelo), o /cancelar.',
  BAD_DESCRIPTION: 'Escribe una descripción de hasta 200 caracteres, o /cancelar.',
  USE_BUTTONS: 'Confirma o cancela con los botones de arriba, o /cancelar.',
  CANCELLED: 'Listo, no se registró el gasto.',
} as const;

export function startExpense(today: CalendarDate): ExpenseDraft {
  return { step: EXPENSE_STEP.DATE, date: today };
}

/** Primera pregunta: la fecha de hoy ya puesta. */
export function datePrompt(draft: ExpenseDraft): string {
  return `➕ Nuevo gasto.\n🗓 Fecha: hoy, ${formatExpenseDate(draft.date)}. ¿Es de hoy o de otro día? También puedes escribir la fecha.`;
}

/** [Hoy] deja la fecha de hoy y pasa a la cantidad. */
export function chooseToday(draft: ExpenseDraft, today: CalendarDate): ExpenseDraft {
  return { ...draft, date: today, step: EXPENSE_STEP.AMOUNT };
}

export function chooseOtherDay(draft: ExpenseDraft): ExpenseDraft {
  return { ...draft, step: EXPENSE_STEP.DATE_TEXT };
}

export function chooseCurrency(draft: ExpenseDraft, currency: ExpenseCurrency): ExpenseDraft {
  return { ...draft, currency, step: EXPENSE_STEP.DESCRIPTION };
}

export interface ExpenseAnswer {
  draft: ExpenseDraft;
  /** Si la respuesta no sirve: el aviso, y el borrador queda igual. */
  error?: string;
}

/** Respuesta escrita al paso actual. */
export function answerExpense(
  draft: ExpenseDraft,
  text: string,
  today: CalendarDate,
): ExpenseAnswer {
  switch (draft.step) {
    case EXPENSE_STEP.DATE:
    case EXPENSE_STEP.DATE_TEXT: {
      const date = parseExpenseDate(text, today);
      if (date === null) return { draft, error: EXPENSE_TEXT.BAD_DATE };
      return { draft: { ...draft, date, step: EXPENSE_STEP.AMOUNT } };
    }
    case EXPENSE_STEP.AMOUNT: {
      const amount = parseExpenseAmount(text);
      if (amount === null) return { draft, error: EXPENSE_TEXT.BAD_AMOUNT };
      return { draft: { ...draft, amount, step: EXPENSE_STEP.CURRENCY } };
    }
    case EXPENSE_STEP.CURRENCY: {
      const currency = parseExpenseCurrency(text);
      if (currency === null) return { draft, error: EXPENSE_TEXT.BAD_CURRENCY };
      return { draft: chooseCurrency(draft, currency) };
    }
    case EXPENSE_STEP.DESCRIPTION: {
      const description = parseExpenseDescription(text);
      if (description === null) return { draft, error: EXPENSE_TEXT.BAD_DESCRIPTION };
      return { draft: { ...draft, description, step: EXPENSE_STEP.CONFIRM } };
    }
    case EXPENSE_STEP.CONFIRM:
      return { draft, error: EXPENSE_TEXT.USE_BUTTONS };
  }
}

/** El gasto completo, o null si al borrador le falta algún dato. */
export function completeExpense(draft: ExpenseDraft): Expense | null {
  const { date, amount, currency, description } = draft;
  if (amount === undefined || currency === undefined || description === undefined) return null;
  return { date, amount, currency, description };
}

/** `20/10/2026 · 1,500 CUP · transporte` */
function summary(expense: Expense): string {
  return `${formatExpenseDate(expense.date)} · ${qty(expense.amount)} ${expense.currency} · ${expense.description}`;
}

export function expensePreview(expense: Expense): string {
  return [
    '➕ Gasto a registrar en la hoja Gastos:',
    `Fecha: ${formatExpenseDate(expense.date)}`,
    `Cantidad: ${qty(expense.amount)} ${expense.currency}`,
    `Descripción: ${expense.description}`,
    '',
    'Queda solo en el historial: el cuadre no cambia.',
  ].join('\n');
}

export const RECORD_STATUS = {
  DONE: 'done',
  /** La hoja no respondió: el borrador sigue para reintentar. */
  FAILED: 'failed',
} as const;

export type RecordStatus = (typeof RECORD_STATUS)[keyof typeof RECORD_STATUS];

export interface RecordResult {
  status: RecordStatus;
  message: string;
}

export async function recordExpense(log: ExpenseLog, expense: Expense): Promise<RecordResult> {
  try {
    await log.append(expense);
  } catch (error) {
    const detail = error instanceof Error ? ` (${error.message})` : '';
    return {
      status: RECORD_STATUS.FAILED,
      message: `⚠️ No pude escribir en la hoja Gastos${detail}. No se registró nada: toca ✅ Confirmar otra vez o /cancelar.`,
    };
  }
  return {
    status: RECORD_STATUS.DONE,
    message: `✅ Gasto registrado en la hoja Gastos: ${summary(expense)}.`,
  };
}
