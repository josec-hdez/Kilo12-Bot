import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSheetsGateway } from '../../src/adapters/sheets/fake-sheets-gateway.js';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import { SqliteSettingsRepository } from '../../src/adapters/sqlite/settings-repo.js';
import { markMonthClosed } from '../../src/app/closed-months.js';
import { singleBook } from '../../src/app/cuadre-books.js';
import {
  askMonthForCommand,
  askTcValueAndDay,
  availableMonths,
  MAX_MONTH_OPTIONS,
  monthHeader,
  monthHeaderPlain,
  monthOptionLabel,
  needsMonth,
  tcDayRequired,
} from '../../src/app/month-pick.js';
import { addMonths, type MonthKey } from '../../src/core/months.js';
import type { CuadreBooks } from '../../src/ports/cuadre-books.js';
import type { CuadreReader } from '../../src/ports/cuadre-source.js';

/** Lector que solo lista pestañas (o falla al listarlas). */
function tabsReader(tabs: readonly string[] | Error): CuadreReader {
  const fail = () => Promise.reject(new Error('no se lee en este test'));
  return {
    listDays: () => (tabs instanceof Error ? Promise.reject(tabs) : Promise.resolve([...tabs])),
    readDay: fail,
    readDays: fail,
  };
}

/** Libros por mes (registrados = las claves), cada uno con sus pestañas. */
function booksOf(byMonth: Record<MonthKey, readonly string[] | Error>): CuadreBooks {
  const sheets = new FakeSheetsGateway();
  return {
    defaultMonth: '2026-10',
    forMonth: (month) => {
      const tabs = byMonth[month];
      return tabs === undefined
        ? null
        : { month, spreadsheetId: `id-${month}`, sheets, cuadre: tabsReader(tabs) };
    },
    months: () => Object.keys(byMonth).sort(),
  };
}

let settings: SqliteSettingsRepository;

beforeEach(() => {
  settings = new SqliteSettingsRepository(openDatabase(':memory:'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('needsMonth', () => {
  it('los reportes, /validar y /tc preguntan el mes', () => {
    for (const command of [
      'validar',
      'dia',
      'rango',
      'fila',
      'semana',
      'mes',
      'ganancia',
      'gastos',
      'inversion',
      'top',
      'margen',
      'producto',
      'tc',
    ])
      expect(needsMonth(command)).toBe(true);
  });

  it('los demás comandos no preguntan el mes (/ipv lo pregunta dentro de su flujo)', () => {
    for (const command of [
      'gasto',
      'equivalencia',
      'ayuda',
      'start',
      'cancelar',
      'cierremes',
      'cuadremes',
      'deshacer',
      'ipv',
      'hoy',
      '',
    ])
      expect(needsMonth(command)).toBe(false);
  });
});

describe('availableMonths', () => {
  it('del más reciente al más antiguo, sin los meses sin pestañas de día', async () => {
    const books = booksOf({
      '2026-10': ['_plantilla', '01', '02'],
      '2026-11': ['3'],
      '2026-12': ['_plantilla'],
    });
    expect(await availableMonths(books, settings)).toEqual([
      { month: '2026-11', closed: false },
      { month: '2026-10', closed: false },
    ]);
  });

  it('una pestaña con espacios sigue contando como día', async () => {
    const books = booksOf({ '2026-10': [' 05 '] });
    expect(await availableMonths(books, settings)).toEqual([{ month: '2026-10', closed: false }]);
  });

  it('si no puede listar las pestañas, muestra el mes igual y lo avisa en el log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const books = booksOf({ '2026-10': new Error('Sheets no responde'), '2026-11': [] });
    expect(await availableMonths(books, settings)).toEqual([{ month: '2026-10', closed: false }]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('include agrega un mes registrado vacío, pero no uno sin libro', async () => {
    const books = booksOf({ '2026-10': ['01'], '2026-11': [] });
    expect(await availableMonths(books, settings, { include: '2026-11' })).toEqual([
      { month: '2026-11', closed: false },
      { month: '2026-10', closed: false },
    ]);
    expect(await availableMonths(books, settings, { include: '2026-12' })).toEqual([
      { month: '2026-10', closed: false },
    ]);
  });

  it('como mucho los 12 más recientes', async () => {
    const byMonth: Record<MonthKey, readonly string[]> = {};
    for (let i = 0; i < 15; i++) byMonth[addMonths('2025-01', i)] = ['01'];
    const options = await availableMonths(booksOf(byMonth), settings);
    expect(options).toHaveLength(MAX_MONTH_OPTIONS);
    expect(options[0]?.month).toBe('2026-03');
    expect(options.at(-1)?.month).toBe('2025-04');
  });

  it('marca los meses cerrados con /cierremes', async () => {
    markMonthClosed(settings, '2026-10');
    const books = booksOf({ '2026-10': ['01'], '2026-11': ['01'] });
    expect(await availableMonths(books, settings)).toEqual([
      { month: '2026-11', closed: false },
      { month: '2026-10', closed: true },
    ]);
  });

  it('con un solo libro (simulado) ofrece su único mes', async () => {
    const books = singleBook(new FakeSheetsGateway(), tabsReader(['01']), '2026-10');
    expect(await availableMonths(books, settings)).toEqual([{ month: '2026-10', closed: false }]);
  });

  it('sin meses registrados no ofrece nada', async () => {
    expect(await availableMonths(booksOf({}), settings)).toEqual([]);
  });
});

describe('textos', () => {
  it('etiquetas, encabezados y pregunta', () => {
    expect(monthOptionLabel({ month: '2026-10', closed: false })).toBe('octubre 2026');
    expect(monthOptionLabel({ month: '2026-10', closed: true })).toBe('🔒 octubre 2026');
    expect(monthHeader('2026-10')).toBe('📒 <b>octubre 2026</b>');
    expect(monthHeaderPlain('2026-11')).toBe('📒 noviembre 2026');
    expect(askMonthForCommand('mes')).toBe('📒 /mes: ¿de qué mes?');
    expect(tcDayRequired('2026-10')).toBe(
      'Para octubre 2026 escribe también el día, por ejemplo: /tc 780 05.',
    );
    expect(askTcValueAndDay('2026-10')).toBe(
      '💱 TC de octubre 2026: escribe el número y el día, por ejemplo: 780 05. /cancelar para salir.',
    );
  });
});
