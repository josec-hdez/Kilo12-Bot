import { describe, expect, it } from 'vitest';
import {
  addMonths,
  bookReminderDue,
  daysInMonth,
  defaultCloseMonth,
  isQualifiedTab,
  monthKey,
  monthName,
  monthOfDayNumber,
  missingDays,
  monthOfRef,
  parseClockTime,
  parseMonthKey,
  parseQualifiedTab,
  parseSpreadsheetId,
  qualifyTab,
  resolveDayTab,
} from '../../src/core/months.js';

const NOV_3 = { year: 2026, month: 11, day: 3 };

describe('meses AAAA-MM', () => {
  it('arma, lee y suma meses cruzando el año', () => {
    expect(monthKey(2026, 1)).toBe('2026-01');
    expect(parseMonthKey('2026-11')).toEqual({ year: 2026, month: 11 });
    expect(parseMonthKey('2026-13')).toBeNull();
    expect(parseMonthKey('nov')).toBeNull();
    expect(addMonths('2026-11', -1)).toBe('2026-10');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });

  it('nombra el mes en español', () => {
    expect(monthName('2026-11')).toBe('noviembre 2026');
  });
});

describe('mes de un día sin año', () => {
  it('un IPV del mes en curso o anterior es de este año', () => {
    expect(monthOfRef({ day: 31, month: 10 }, NOV_3)).toBe('2026-10');
    expect(monthOfRef({ day: 3, month: 11 }, NOV_3)).toBe('2026-11');
  });

  it('un IPV de diciembre cargado en enero es del año anterior', () => {
    expect(monthOfRef({ day: 31, month: 12 }, { year: 2027, month: 1, day: 2 })).toBe('2026-12');
  });

  it('un número de día mayor que hoy es del mes anterior', () => {
    expect(monthOfDayNumber(31, NOV_3)).toBe('2026-10');
    expect(monthOfDayNumber(3, NOV_3)).toBe('2026-11');
    expect(monthOfDayNumber(1, NOV_3)).toBe('2026-11');
  });
});

describe('pestañas de otro mes', () => {
  it('se nombran DD/MM y se reconocen', () => {
    expect(qualifyTab('28', '2026-10')).toBe('28/10');
    expect(parseQualifiedTab('28/10')).toEqual({ tab: '28', month: 10 });
    expect(parseQualifiedTab('5/10')).toEqual({ tab: '05', month: 10 });
    expect(isQualifiedTab('28')).toBe(false);
  });

  it('un día se busca primero en el mes en curso y después en el anterior', () => {
    const days = ['30/10', '31/10', '01', '02', '03'];
    expect(resolveDayTab(days, '02')).toBe('02');
    expect(resolveDayTab(days, '31')).toBe('31/10');
    expect(resolveDayTab(days, '31/10')).toBe('31/10');
    expect(resolveDayTab(days, '15')).toBeNull();
    expect(resolveDayTab(days, '15/10')).toBeNull();
  });
});

describe('enlace de una hoja', () => {
  it('saca el ID del enlace o acepta el ID solo', () => {
    const id = '1Keo2gKOa1fdqP0rKmb3sSDgBwKD4CQyriDUn4SjWMSA';
    expect(
      parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=0#gid=0`),
    ).toBe(id);
    expect(parseSpreadsheetId(id)).toBe(id);
    expect(parseSpreadsheetId('https://example.com/otra-cosa')).toBeNull();
    expect(parseSpreadsheetId('abc')).toBeNull();
  });
});

describe('recordatorio del libro del mes siguiente', () => {
  const base = {
    today: { year: 2026, month: 10, day: 25 },
    minutesNow: 9 * 60,
    atMinutes: 9 * 60,
    registered: new Set(['2026-10']),
    lastSent: null,
  };

  it('desde el día 25 a la hora de apertura, si falta el libro', () => {
    expect(bookReminderDue(base)).toBe('2026-11');
  });

  it('antes del 25 o antes de la apertura no recuerda', () => {
    expect(bookReminderDue({ ...base, today: { ...base.today, day: 24 } })).toBeNull();
    expect(bookReminderDue({ ...base, minutesNow: 8 * 60 + 59 })).toBeNull();
  });

  it('una vez por día y hasta que se registra', () => {
    expect(bookReminderDue({ ...base, lastSent: '2026-10-25' })).toBeNull();
    expect(
      bookReminderDue({ ...base, today: { ...base.today, day: 26 }, lastSent: '2026-10-25' }),
    ).toBe('2026-11');
    expect(bookReminderDue({ ...base, registered: new Set(['2026-10', '2026-11']) })).toBeNull();
  });

  it('en diciembre recuerda el libro de enero del año siguiente', () => {
    expect(bookReminderDue({ ...base, today: { year: 2026, month: 12, day: 28 } })).toBe('2027-01');
  });
});

describe('hora del día', () => {
  it('lee HH:MM', () => {
    expect(parseClockTime('09:00')).toBe(540);
    expect(parseClockTime('9:30')).toBe(570);
    expect(parseClockTime('25:00')).toBeNull();
    expect(parseClockTime(900)).toBeNull();
  });
});

describe('cierre de mes', () => {
  it('días del mes, con febrero bisiesto', () => {
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2026-11')).toBe(30);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
  });

  it('sin mes: del 1 al 10 el anterior, desde el 11 el actual', () => {
    expect(defaultCloseMonth(NOV_3)).toBe('2026-10');
    expect(defaultCloseMonth({ year: 2026, month: 11, day: 10 })).toBe('2026-10');
    expect(defaultCloseMonth({ year: 2026, month: 11, day: 11 })).toBe('2026-11');
    expect(defaultCloseMonth({ year: 2027, month: 1, day: 2 })).toBe('2026-12');
  });

  it('días faltantes: el mes pasado completo, el actual hasta ayer, el futuro nada', () => {
    const tabs = ['01', '02', '04', ' 05 ', '_plantilla', 'Resumen'];
    expect(missingDays('2026-10', tabs, NOV_3)).toEqual([
      3,
      ...Array.from({ length: 26 }, (_, i) => i + 6),
    ]);
    expect(missingDays('2026-11', tabs, NOV_3)).toEqual([]);
    expect(missingDays('2026-11', ['01'], NOV_3)).toEqual([2]);
    expect(missingDays('2026-12', [], NOV_3)).toEqual([]);
  });
});
