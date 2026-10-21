import { describe, expect, it } from 'vitest';
import {
  asPlainText,
  expenseRow,
  formatExpenseDate,
  isValidDate,
  MAX_DESCRIPTION_LENGTH,
  parseExpenseAmount,
  parseExpenseCurrency,
  parseExpenseDate,
  parseExpenseDescription,
} from '../../src/core/expense.js';

const TODAY = { year: 2026, month: 10, day: 20 };

describe('parseExpenseDate', () => {
  it('acepta día/mes con o sin año, con / - o .', () => {
    expect(parseExpenseDate('18/10', TODAY)).toEqual({ year: 2026, month: 10, day: 18 });
    expect(parseExpenseDate('18/10/2026', TODAY)).toEqual({ year: 2026, month: 10, day: 18 });
    expect(parseExpenseDate('5-9-26', TODAY)).toEqual({ year: 2026, month: 9, day: 5 });
    expect(parseExpenseDate(' 1.10 ', TODAY)).toEqual({ year: 2026, month: 10, day: 1 });
  });

  it('acepta ISO (año-mes-día)', () => {
    expect(parseExpenseDate('2026-10-02', TODAY)).toEqual({ year: 2026, month: 10, day: 2 });
  });

  it('el día va antes que el mes', () => {
    expect(parseExpenseDate('02/10', TODAY)).toEqual({ year: 2026, month: 10, day: 2 });
    expect(parseExpenseDate('10/13', TODAY)).toBeNull();
  });

  it('rechaza fechas que no existen, futuras o texto', () => {
    expect(parseExpenseDate('31/02', TODAY)).toBeNull();
    expect(parseExpenseDate('21/10', TODAY)).toBeNull();
    expect(parseExpenseDate('1/1/2027', TODAY)).toBeNull();
    expect(parseExpenseDate('ayer', TODAY)).toBeNull();
    expect(parseExpenseDate('', TODAY)).toBeNull();
  });

  it('hoy es válido', () => {
    expect(parseExpenseDate('20/10', TODAY)).toEqual(TODAY);
  });
});

describe('isValidDate', () => {
  it('conoce los años bisiestos', () => {
    expect(isValidDate({ year: 2028, month: 2, day: 29 })).toBe(true);
    expect(isValidDate({ year: 2026, month: 2, day: 29 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 13, day: 1 })).toBe(false);
  });
});

describe('parseExpenseAmount', () => {
  it('acepta enteros, decimales y separador de miles', () => {
    expect(parseExpenseAmount('1500')).toBe(1500);
    expect(parseExpenseAmount('1,500')).toBe(1500);
    expect(parseExpenseAmount('1,500.50')).toBe(1500.5);
    expect(parseExpenseAmount('12.5')).toBe(12.5);
    expect(parseExpenseAmount('12,5')).toBe(12.5);
    expect(parseExpenseAmount(' 1 500 ')).toBe(1500);
  });

  it('rechaza cero, negativos y texto', () => {
    expect(parseExpenseAmount('0')).toBeNull();
    expect(parseExpenseAmount('-20')).toBeNull();
    expect(parseExpenseAmount('mil')).toBeNull();
    expect(parseExpenseAmount('20 cup')).toBeNull();
    expect(parseExpenseAmount('')).toBeNull();
  });
});

describe('parseExpenseCurrency', () => {
  it('CUP o USD sin importar mayúsculas', () => {
    expect(parseExpenseCurrency('cup')).toBe('CUP');
    expect(parseExpenseCurrency(' USD ')).toBe('USD');
    expect(parseExpenseCurrency('$usd')).toBe('USD');
    expect(parseExpenseCurrency('EUR')).toBeNull();
  });
});

describe('parseExpenseDescription', () => {
  it('colapsa espacios y rechaza vacía o demasiado larga', () => {
    expect(parseExpenseDescription('  transporte   de  mercancía ')).toBe(
      'transporte de mercancía',
    );
    expect(parseExpenseDescription('   ')).toBeNull();
    expect(parseExpenseDescription('x'.repeat(MAX_DESCRIPTION_LENGTH))).not.toBeNull();
    expect(parseExpenseDescription('x'.repeat(MAX_DESCRIPTION_LENGTH + 1))).toBeNull();
  });
});

describe('fila de la hoja Gastos', () => {
  it('Fecha (ISO) | Cantidad (número) | Moneda | Descripcion', () => {
    expect(
      expenseRow({ date: TODAY, amount: 1500.5, currency: 'CUP', description: 'transporte' }),
    ).toEqual(['2026-10-20', 1500.5, 'CUP', 'transporte']);
  });

  it('una descripción que parece fórmula queda como texto', () => {
    expect(asPlainText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(asPlainText('-5 de descuento')).toBe("'-5 de descuento");
    expect(asPlainText('agua')).toBe('agua');
    expect(expenseRow({ date: TODAY, amount: 1, currency: 'USD', description: '+bolsas' })[3]).toBe(
      "'+bolsas",
    );
  });

  it('la fecha se muestra día/mes/año', () => {
    expect(formatExpenseDate({ year: 2026, month: 3, day: 7 })).toBe('07/03/2026');
  });
});
