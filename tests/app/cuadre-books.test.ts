import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetsGateway } from '../../src/adapters/sheets/fake-sheets-gateway.js';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import { SqliteSettingsRepository } from '../../src/adapters/sqlite/settings-repo.js';
import { CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import {
  BOOKS_SETTING,
  ensureDefaultBook,
  MonthTimelineReader,
  previousBook,
  readBookRegistry,
  registerBook,
  RegistryCuadreBooks,
  singleBook,
} from '../../src/app/cuadre-books.js';
import {
  monthReport,
  rangeReport,
  REPORT_KIND,
  weekReport,
  type ReportDeps,
  type ReportResult,
} from '../../src/app/reports.js';
import { parseValidateArgs, runValidation } from '../../src/app/validate-report.js';
import { EQUIVALENCES } from '../../src/core/equivalences.js';
import { buildAliasIndex } from '../../src/core/mapping.js';
import type { CuadreSheet } from '../../src/core/types.js';
import type { CuadreReader } from '../../src/ports/cuadre-source.js';

const fixture = fileURLToPath(new URL('../fixtures/Cuadre K12 Remoto.xlsx', import.meta.url));

/** Lector en memoria a partir de hojas ya leídas; cuenta las lecturas. */
class MemoryReader implements CuadreReader {
  reads = 0;
  constructor(private readonly sheets: readonly CuadreSheet[]) {}
  listDays(): Promise<string[]> {
    return Promise.resolve(this.sheets.map((sheet) => sheet.tabName));
  }
  readDay(tab: string): Promise<CuadreSheet> {
    return this.readDays([tab]).then(([sheet]) => {
      if (sheet === undefined) throw new Error(`sin ${tab}`);
      return sheet;
    });
  }
  readDays(tabs: readonly string[]): Promise<CuadreSheet[]> {
    this.reads++;
    return Promise.resolve(
      tabs.map((tab) => {
        const sheet = this.sheets.find((candidate) => candidate.tabName === tab.trim());
        if (sheet === undefined) throw new Error(`El cuadre no tiene la pestaña "${tab}"`);
        return sheet;
      }),
    );
  }
}

let october: CuadreSheet[];
let november: CuadreSheet[];

beforeAll(async () => {
  const source = await CuadreXlsxReader.fromFile(fixture);
  october = source.listDays().map((day) => source.readDay(day));
  // Noviembre: dos días con el contenido de 04 y 05 de octubre.
  november = ['04', '05'].map((day, i) => ({
    ...source.readDay(day),
    tabName: `0${String(i + 1)}`,
  }));
});

const OCT_ID = 'libro-octubre';
const NOV_ID = 'libro-noviembre';

let settings: SqliteSettingsRepository;

beforeEach(() => {
  settings = new SqliteSettingsRepository(openDatabase(':memory:'));
});

function booksFor(readers: Record<string, CuadreReader>): RegistryCuadreBooks {
  return new RegistryCuadreBooks(
    settings,
    (id) => {
      const cuadre = readers[id];
      if (cuadre === undefined) throw new Error(`sin libro ${id}`);
      return { sheets: new FakeSheetsGateway(), cuadre };
    },
    '2026-10',
  );
}

function body(result: ReportResult): string {
  if (result.kind !== REPORT_KIND.TEXT) throw new Error('se esperaba texto');
  return result.messages.join('\n').replace(/<[^>]+>/g, '');
}

describe('registro de libros', () => {
  it('guarda un libro por mes y descarta entradas dañadas', () => {
    registerBook(settings, '2026-10', OCT_ID);
    registerBook(settings, '2026-11', NOV_ID);
    expect(readBookRegistry(settings)).toEqual({ '2026-10': OCT_ID, '2026-11': NOV_ID });

    settings.set(BOOKS_SETTING, { '2026-10': OCT_ID, nov: 'x', '2026-12': 5 });
    expect(readBookRegistry(settings)).toEqual({ '2026-10': OCT_ID });
  });

  it('CUADRE_SHEET_ID se registra para su mes una sola vez y no pisa a las dueñas', () => {
    expect(ensureDefaultBook(settings, '2026-10', OCT_ID)).toBe(true);
    expect(ensureDefaultBook(settings, '2026-10', OCT_ID)).toBe(false);
    registerBook(settings, '2026-10', 'otro');
    expect(ensureDefaultBook(settings, '2026-10', OCT_ID)).toBe(false);
    expect(readBookRegistry(settings)['2026-10']).toBe('otro');
  });

  it('un mes sin libro no tiene libro; cada hoja se abre una sola vez', () => {
    registerBook(settings, '2026-10', OCT_ID);
    let opened = 0;
    const books = new RegistryCuadreBooks(
      settings,
      () => {
        opened++;
        return { sheets: new FakeSheetsGateway(), cuadre: new MemoryReader([]) };
      },
      '2026-10',
    );
    expect(books.forMonth('2026-11')).toBeNull();
    expect(books.forMonth('2026-10')?.spreadsheetId).toBe(OCT_ID);
    expect(books.forMonth('2026-10')?.month).toBe('2026-10');
    expect(opened).toBe(1);
  });

  it('con un solo libro no hay "mes anterior"', () => {
    const books = singleBook(new FakeSheetsGateway(), new MemoryReader([]));
    const current = books.forMonth('2026-11');
    if (current === null) throw new Error('debería haber libro');
    expect(previousBook(books, current)).toBeNull();
  });
});

describe('lectura que cruza meses', () => {
  let timeline: MonthTimelineReader;
  let deps: ReportDeps;

  beforeEach(() => {
    registerBook(settings, '2026-10', OCT_ID);
    registerBook(settings, '2026-11', NOV_ID);
    const books = booksFor({
      [OCT_ID]: new MemoryReader(october),
      [NOV_ID]: new MemoryReader(november),
    });
    timeline = new MonthTimelineReader(books, () => '2026-11');
    deps = { cuadre: timeline, aliases: buildAliasIndex(EQUIVALENCES), hasFixedExpenses: false };
  });

  it('lista el mes anterior como DD/MM y después los días del mes', async () => {
    expect(await timeline.listDays()).toEqual([
      '01/10',
      '02/10',
      '03/10',
      '04/10',
      '05/10',
      '01',
      '02',
    ]);
  });

  it('lee de cada libro y conserva el nombre pedido', async () => {
    const sheets = await timeline.readDays(['05/10', '01']);
    expect(sheets.map((sheet) => sheet.tabName)).toEqual(['05/10', '01']);
    expect(sheets[0]?.rows).toEqual(october[4]?.rows);
    expect(sheets[1]?.rows).toEqual(november[0]?.rows);
  });

  it('/mes es solo el mes en curso; /semana cruza al mes anterior', async () => {
    expect(body(await monthReport(deps))).toContain('pestañas 01–02 · 2 días');
    expect(body(await weekReport(deps))).toContain('pestañas 01/10–02 · 7 días');
  });

  it('/rango 04 02 empieza en octubre si el 04 no existe en noviembre', async () => {
    expect(body(await rangeReport(deps, '04 02'))).toContain('pestañas 04/10–02 · 4 días');
  });

  it('la continuidad del 01 se compara con el cierre del 05/10', async () => {
    const text = await runValidation(timeline, parseValidateArgs('01'), {
      hasFixedExpenses: false,
      showFinancials: true,
    });
    expect(text).toContain('05/10');
  });

  it('sin libro del mes en curso, solo queda el anterior (y /mes no tiene días)', async () => {
    const onlyOctober = new MonthTimelineReader(
      booksFor({ [OCT_ID]: new MemoryReader(october) }),
      () => '2026-11',
    );
    settings.set(BOOKS_SETTING, { '2026-10': OCT_ID });
    expect(await onlyOctober.listDays()).toEqual(['01/10', '02/10', '03/10', '04/10', '05/10']);
    expect(body(await monthReport({ ...deps, cuadre: onlyOctober }))).toContain(
      'todavía no tiene pestañas',
    );
  });

  it('con un solo libro para los dos meses no duplica días', async () => {
    const same = new MonthTimelineReader(
      singleBook(new FakeSheetsGateway(), new MemoryReader(october)),
      () => '2026-11',
    );
    expect(await same.listDays()).toEqual(['01', '02', '03', '04', '05']);
  });
});
