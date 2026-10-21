import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import { SqliteSettingsRepository } from '../../src/adapters/sqlite/settings-repo.js';
import { FakeSheetsGateway } from '../../src/adapters/sheets/fake-sheets-gateway.js';
import { SheetsCuadreReader } from '../../src/adapters/sheets/sheets-cuadre-reader.js';
import { readBookRegistry, registerBook, RegistryCuadreBooks } from '../../src/app/cuadre-books.js';
import {
  BOOK_PREPARE,
  bookListText,
  confirmBookRegistration,
  prepareBookRegistration,
  type BookAdminDeps,
  type BookPrepareResult,
} from '../../src/app/register-book.js';
import { SUMMARY_TAB } from '../../src/core/month-summary.js';

const NOV_ID = '1NovNovNovNovNovNovNovNovNovNovNovNov';
const OCT_ID = '1OctOctOctOctOctOctOctOctOctOctOctOct';
const URL = `https://docs.google.com/spreadsheets/d/${NOV_ID}/edit#gid=0`;

let settings: SqliteSettingsRepository;
let tabs: Record<string, string[]>;
let deps: BookAdminDeps;

beforeEach(() => {
  settings = new SqliteSettingsRepository(openDatabase(':memory:'));
  registerBook(settings, '2026-10', OCT_ID);
  tabs = { [NOV_ID]: ['_plantilla', '_config'], [OCT_ID]: ['01', '02', '_plantilla'] };
  deps = {
    settings,
    inspect: (id) => {
      const found = tabs[id];
      return found === undefined
        ? Promise.reject(new Error('The caller does not have permission'))
        : Promise.resolve(found);
    },
    serviceAccountEmail: 'kilo12bot@kilo12.iam.gserviceaccount.com',
    today: { year: 2026, month: 10, day: 26 },
  };
});

function preview(result: BookPrepareResult): string {
  if (result.status !== BOOK_PREPARE.READY) throw new Error(`esperaba READY: ${result.message}`);
  return result.preview;
}

describe('/cuadremes', () => {
  it('sin datos lista los libros y avisa el que falta', () => {
    const text = bookListText(deps);
    expect(text).toContain(`octubre 2026: https://docs.google.com/spreadsheets/d/${OCT_ID}`);
    expect(text).toContain('Falta el de noviembre 2026');
  });

  it('rechaza un pedido mal escrito o un enlace que no es una hoja', async () => {
    for (const raw of ['nov 2026', '2026-11', `${URL} 2026-11`, '2026-11 a b']) {
      expect((await prepareBookRegistration(deps, raw)).status).toBe(BOOK_PREPARE.REJECTED);
    }
    const bad = await prepareBookRegistration(deps, '2026-11 https://example.com/x');
    expect(bad).toMatchObject({ message: expect.stringContaining('No reconozco') as unknown });
  });

  it('sin acceso a la hoja dice con quién compartirla', async () => {
    tabs = {};
    const result = await prepareBookRegistration(deps, `2026-11 ${URL}`);
    expect(result).toMatchObject({
      status: BOOK_PREPARE.REJECTED,
      message: expect.stringContaining('kilo12bot@kilo12.iam.gserviceaccount.com') as unknown,
    });
  });

  it('con la hoja simulada no registra libros', async () => {
    const result = await prepareBookRegistration({ ...deps, inspect: null }, `2026-11 ${URL}`);
    expect(result).toMatchObject({ message: expect.stringContaining('simulada') as unknown });
  });

  it('un libro nuevo con plantilla: vista previa sin avisos y no guarda hasta ✅', async () => {
    const result = await prepareBookRegistration(deps, `2026-11 ${URL}`);
    const text = preview(result);
    expect(text).toContain('Libro de cuadre de noviembre 2026');
    expect(text).toContain('✅ Tiene la pestaña _plantilla');
    expect(text).not.toContain('⚠️');
    expect(readBookRegistry(settings)['2026-11']).toBeUndefined();

    if (result.status !== BOOK_PREPARE.READY) throw new Error('READY');
    expect(await confirmBookRegistration(settings, result.registration)).toContain('registrado');
    expect(readBookRegistry(settings)['2026-11']).toBe(NOV_ID);
  });

  it('avisa si falta la plantilla, si ya trae días, si es el libro de otro mes o si reemplaza', async () => {
    tabs[NOV_ID] = ['01', '02', '03'];
    expect(preview(await prepareBookRegistration(deps, `2026-11 ${URL}`))).toMatch(
      /No tiene la pestaña _plantilla[\s\S]*Ya tiene 3 pestañas de días \(01, 02, 03\)/,
    );

    const reused = preview(await prepareBookRegistration(deps, `2026-11 ${OCT_ID}`));
    expect(reused).toContain('ya es el libro de octubre 2026');

    registerBook(settings, '2026-11', OCT_ID);
    const replaced = preview(await prepareBookRegistration(deps, `2026-11 ${URL}`));
    expect(replaced).toContain('se reemplaza');
  });
});

describe('registrar crea la pestaña Resumen', () => {
  it('si el libro nuevo no la trae, la agrega; si ya la trae, no la toca', async () => {
    const november = new FakeSheetsGateway();
    const books = new RegistryCuadreBooks(
      settings,
      () => ({ sheets: november, cuadre: new SheetsCuadreReader(november) }),
      '2026-10',
    );
    const registration = { month: '2026-11', spreadsheetId: NOV_ID };

    const first = await confirmBookRegistration(settings, registration, books);
    expect(first).toContain('Agregué la pestaña Resumen');
    expect((await november.listTabs()).map((tab) => tab.title)).toEqual([SUMMARY_TAB]);

    const second = await confirmBookRegistration(settings, registration, books);
    expect(second).not.toContain('Resumen');
  });
});
