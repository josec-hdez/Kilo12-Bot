import { GrammyError, HttpError } from 'grammy';
import { FakeSheetsGateway } from './adapters/sheets/fake-sheets-gateway.js';
import {
  createExpenseSheetClient,
  GoogleExpenseLog,
} from './adapters/sheets/google-expense-log.js';
import {
  createSheetsClient,
  GoogleSheetsGateway,
  readServiceAccount,
  type SheetsClient,
} from './adapters/sheets/google-sheets-gateway.js';
import { MemoryExpenseLog } from './adapters/sheets/memory-expense-log.js';
import { NotifyingSheetsGateway } from './adapters/sheets/notifying-sheets-gateway.js';
import { SheetsCuadreReader } from './adapters/sheets/sheets-cuadre-reader.js';
import { SqliteCatalogRepository } from './adapters/sqlite/catalog-repo.js';
import { openDatabase } from './adapters/sqlite/db.js';
import {
  SqliteChangeLogRepository,
  SqliteSnapshotRepository,
} from './adapters/sqlite/history-repo.js';
import { SqlitePendingActionRepository } from './adapters/sqlite/pending-actions-repo.js';
import { SqliteSettingsRepository } from './adapters/sqlite/settings-repo.js';
import { SqliteAccessLogRepository, SqliteUserRepository } from './adapters/sqlite/users-repo.js';
import { createBot, type BookAdmin } from './adapters/telegram/bot.js';
import { syncCommandMenus } from './adapters/telegram/command-menu.js';
import { telegramReleaseNotifier } from './adapters/telegram/release-notifier.js';
import { asCuadreReader, CuadreXlsxReader } from './adapters/xlsx/cuadre-xlsx-reader.js';
import { ANNOUNCE_STATUS, announceRelease } from './app/announce-release.js';
import { remindMissingBook } from './app/book-reminder.js';
import { CachedCuadreReader } from './app/cached-cuadre-reader.js';
import {
  ensureDefaultBook,
  MonthTimelineReader,
  RegistryCuadreBooks,
  singleBook,
  type BookOpener,
} from './app/cuadre-books.js';
import { syncCatalogAtStartup } from './app/catalog-sync.js';
import { initialCuadreSeed, seedAll } from './app/seed.js';
import { openSeedFile } from './app/seed-file.js';
import { minutesIn, todayDateIn } from './app/today.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { EQUIVALENCES } from './core/equivalences.js';
import { monthName, monthOfDate } from './core/months.js';
import type { CuadreBooks } from './ports/cuadre-books.js';
import type { CuadreReader } from './ports/cuadre-source.js';
import type { ExpenseLog } from './ports/expense-log.js';
import type { SheetsGateway } from './ports/sheets-gateway.js';

/**
 * Errores que no se arreglan reiniciando (configuración, token inválido): el proceso
 * termina con código 0 para que docker-compose (`restart: on-failure`) no entre en
 * un bucle de reinicios. Los demás fallos salen con código 1 y Docker reinicia.
 */
const FATAL_EXIT_CODE = 0;
/** Reintentos de conexión inicial a Telegram (red caída al arrancar). */
const START_RETRY_MS = [5_000, 15_000, 30_000, 60_000];
/** Pausa entre avisos de versión nueva (Telegram admite ~30 mensajes por segundo). */
const ANNOUNCE_PAUSE_MS = 100;
/** Cada cuánto se revisa si toca recordar el libro del mes siguiente. */
const REMINDER_CHECK_MS = 10 * 60 * 1000;

/** Historial de /gasto: la hoja "Gastos" o, sin configurar, uno en memoria. */
function createExpenseLog({ googleServiceAccountJson, expensesSheetId }: Config): ExpenseLog {
  if (googleServiceAccountJson === undefined || expensesSheetId === undefined) {
    return new MemoryExpenseLog();
  }
  return new GoogleExpenseLog(createExpenseSheetClient(googleServiceAccountJson), expensesSheetId);
}

/**
 * /validar lee la hoja real. Con la hoja simulada (sin service account) no hay días
 * cargados al arrancar, así que si existe el .xlsx de CUADRE_SEED_PATH se valida ese.
 */
function chooseCuadreReader(
  config: Config,
  sheets: SheetsGateway,
  seedFile: CuadreXlsxReader | null,
): CuadreReader {
  if (config.useFakeSheets && seedFile !== null) return asCuadreReader(seedFile);
  return new SheetsCuadreReader(sheets);
}

/** Abre un libro: escritura que vacía la memoria de 60 s de su propia lectura. */
function openBook(
  sheets: SheetsGateway,
  reader: (sheets: SheetsGateway) => CuadreReader,
  clock: () => Date,
) {
  const cuadre = new CachedCuadreReader(reader(sheets), clock);
  return {
    sheets: new NotifyingSheetsGateway(sheets, () => {
      cuadre.invalidate();
    }),
    cuadre,
  };
}

interface CuadreWiring {
  books: CuadreBooks;
  /** Lectura de reportes y /validar: el mes en curso y, para cruzar meses, el anterior. */
  cuadre: CuadreReader;
  admin: BookAdmin | undefined;
  /** Hay libros de Google: tiene sentido recordar el del mes siguiente. */
  real: boolean;
}

/**
 * Un libro de cuadre por mes. Sin service account, un solo libro simulado en memoria
 * (o el .xlsx de CUADRE_SEED_PATH para leer). Con Google, el libro de CUADRE_SHEET_ID
 * queda registrado para CUADRE_SHEET_MONTH y los demás se registran con /cuadremes.
 */
function wireCuadre(
  config: Config,
  settings: SqliteSettingsRepository,
  seedFile: CuadreXlsxReader | null,
  clock: () => Date,
): CuadreWiring {
  const { googleServiceAccountJson: json, cuadreSheetId, cuadreSheetMonth } = config;
  if (json === undefined || cuadreSheetId === undefined) {
    const book = openBook(
      new FakeSheetsGateway(),
      (sheets) => chooseCuadreReader(config, sheets, seedFile),
      clock,
    );
    return {
      books: singleBook(book.sheets, book.cuadre, cuadreSheetMonth),
      cuadre: book.cuadre,
      admin: undefined,
      real: false,
    };
  }

  const client: SheetsClient = createSheetsClient(json);
  if (ensureDefaultBook(settings, cuadreSheetMonth, cuadreSheetId)) {
    console.log(`Libro de cuadre de ${monthName(cuadreSheetMonth)}: CUADRE_SHEET_ID.`);
  }
  const open: BookOpener = (spreadsheetId) =>
    openBook(
      new GoogleSheetsGateway(client, spreadsheetId),
      (sheets) => new SheetsCuadreReader(sheets),
      clock,
    );
  const books = new RegistryCuadreBooks(settings, open, cuadreSheetMonth);
  const email = readServiceAccount(json).client_email;
  return {
    books,
    cuadre: new MonthTimelineReader(books, () =>
      monthOfDate(todayDateIn(clock(), config.timezone)),
    ),
    admin: {
      inspect: async (spreadsheetId) =>
        (await new GoogleSheetsGateway(client, spreadsheetId).listTabs()).map((tab) => tab.title),
      serviceAccountEmail: typeof email === 'string' ? email : null,
    },
    real: true,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const clock = () => new Date();
  const users = new SqliteUserRepository(db);
  const catalog = new SqliteCatalogRepository(db);
  const settings = new SqliteSettingsRepository(db);

  const seedFile =
    config.cuadreSeedPath === undefined
      ? null
      : await openSeedFile(config.cuadreSeedPath, (path) => CuadreXlsxReader.fromFile(path));
  const summary = seedAll(
    { users, catalog, settings },
    {
      ownerIds: config.ownerIds,
      equivalences: EQUIVALENCES,
      cuadre: initialCuadreSeed(catalog, seedFile),
    },
  );

  // Memoria de 60 s por libro para los reportes; cualquier escritura en ese libro la vacía.
  const wiring = wireCuadre(config, settings, seedFile, clock);
  // El catálogo sigue al cuadre real: productos nuevos y costos cambiados a mano desde
  // la última vez. En modo simulado no hay cuadre real (la carga inicial ya lo cubre).
  if (wiring.real) {
    try {
      const synced = await syncCatalogAtStartup(catalog, wiring.books, settings);
      if (synced !== null && (synced.added.length > 0 || synced.costsUpdated > 0)) {
        console.log(
          `Catálogo al día con la pestaña ${synced.tab} de ${monthName(synced.month)}: ` +
            `${String(synced.added.length)} productos nuevos, ${String(synced.costsUpdated)} costos actualizados.`,
        );
      }
    } catch (error) {
      console.warn('No pude poner el catálogo al día con el cuadre:', error);
    }
  }
  const products = catalog.listProducts().length;
  console.log(
    `Kilo 12 bot: ${config.useFakeSheets ? 'hoja SIMULADA en memoria (faltan GOOGLE_SA_JSON o CUADRE_SHEET_ID)' : 'Google Sheets'}, ` +
      `base de datos en ${config.dbPath}, ${String(products)} productos en el catálogo` +
      (summary.catalog === null ? '.' : ` (carga inicial desde ${config.cuadreSeedPath ?? ''}).`),
  );
  if (summary.equivalences !== null && summary.equivalences.addedAliases > 0) {
    console.log(
      `Equivalencias: ${String(summary.equivalences.addedAliases)} nuevas en el catálogo.`,
    );
  }
  for (const conflict of summary.equivalences?.conflicts ?? []) {
    console.warn(`⚠️ Equivalencia "${conflict.alias}" → "${conflict.product}": ${conflict.reason}`);
  }
  if (config.useFakeExpenses) {
    console.warn(
      '⚠️ /gasto guarda en memoria (faltan GOOGLE_SA_JSON o GASTOS_SPREADSHEET_ID): los gastos se pierden al reiniciar.',
    );
  }
  if (products === 0) {
    console.warn(
      '⚠️ Catálogo vacío: define CUADRE_SEED_PATH para cargar costos antes del primer /ipv.',
    );
  }

  const bot = createBot(
    {
      pipeline: {
        books: wiring.books,
        settings,
        catalog,
        pending: new SqlitePendingActionRepository(db, clock),
        changeLog: new SqliteChangeLogRepository(db),
        snapshots: new SqliteSnapshotRepository(db, clock),
        clock,
      },
      auth: { users, accessLog: new SqliteAccessLogRepository(db) },
      settings,
      cuadre: wiring.cuadre,
      expenses: createExpenseLog(config),
      ...(wiring.admin === undefined ? {} : { books: wiring.admin }),
      timezone: config.timezone,
    },
    { token: config.telegramToken },
  );

  // Desde el día 25: recordar a las dueñas el libro del mes siguiente (una vez por día).
  const checkReminder = async () => {
    try {
      const sent = await remindMissingBook(
        { settings, users, notify: telegramReleaseNotifier(bot.api) },
        {
          today: todayDateIn(clock(), config.timezone),
          minutesNow: minutesIn(clock(), config.timezone),
        },
      );
      if (sent !== null) {
        console.log(
          `Recordatorio del libro de ${sent.month}: ${String(sent.ok)} enviados` +
            (sent.failed === 0 ? '.' : `, ${String(sent.failed)} con error.`),
        );
      }
    } catch (error) {
      console.warn('No pude revisar el recordatorio del libro del mes:', error);
    }
  };
  const reminder = wiring.real ? setInterval(() => void checkReminder(), REMINDER_CHECK_MS) : null;

  const stop = () => {
    console.log('Deteniendo el bot…');
    if (reminder !== null) clearInterval(reminder);
    void bot.stop().finally(() => db.$client.close());
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  // Menú "/" por rol. Si Telegram no responde, el bot arranca igual (el menú es una ayuda).
  try {
    const menus = await syncCommandMenus(bot.api, users.list());
    console.log(
      `Menú de comandos: ${String(menus.ok)} publicados` +
        (menus.failed === 0 ? '.' : `, ${String(menus.failed)} con error (ver avisos).`),
    );
  } catch (error) {
    console.warn('No pude publicar el menú de comandos:', error);
  }

  // Versión nueva: aviso a todos los autorizados con su teclado. Un fallo no frena el arranque.
  try {
    const announce = await announceRelease(
      {
        users,
        settings,
        notify: telegramReleaseNotifier(bot.api),
        pause: async () => {
          await sleep(ANNOUNCE_PAUSE_MS);
        },
      },
      config.release,
    );
    if (announce.status === ANNOUNCE_STATUS.ANNOUNCED) {
      console.log(
        `Aviso de versión ${config.release?.version ?? ''}: ${String(announce.ok)} enviados` +
          (announce.failed === 0 ? '.' : `, ${String(announce.failed)} con error (ver avisos).`),
      );
    }
  } catch (error) {
    console.warn('No pude avisar la versión nueva:', error);
  }

  if (wiring.real) void checkReminder();

  for (let attempt = 0; ; attempt++) {
    try {
      await bot.start({
        drop_pending_updates: false,
        onStart: (info) => {
          console.log(`Bot @${info.username} escuchando (long polling).`);
        },
      });
      return;
    } catch (error) {
      const wait = START_RETRY_MS[Math.min(attempt, START_RETRY_MS.length - 1)] ?? 60_000;
      if (error instanceof HttpError) {
        console.error(
          `No se pudo contactar a Telegram; reintento en ${String(wait / 1000)} s.`,
          error.message,
        );
        await sleep(wait);
        continue;
      }
      throw error;
    }
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(FATAL_EXIT_CODE);
  }
  if (error instanceof GrammyError && (error.error_code === 401 || error.error_code === 404)) {
    console.error(
      'TELEGRAM_TOKEN inválido: Telegram lo rechazó. Revisa el token de @BotFather en .env y vuelve a levantar el bot.',
    );
    process.exit(FATAL_EXIT_CODE);
  }
  console.error('Error fatal:', error);
  process.exit(1);
});
