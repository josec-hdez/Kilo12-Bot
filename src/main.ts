import { GrammyError, HttpError } from 'grammy';
import { FakeSheetsGateway } from './adapters/sheets/fake-sheets-gateway.js';
import {
  createSheetsClient,
  GoogleSheetsGateway,
} from './adapters/sheets/google-sheets-gateway.js';
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
import { createBot } from './adapters/telegram/bot.js';
import { asCuadreReader, CuadreXlsxReader } from './adapters/xlsx/cuadre-xlsx-reader.js';
import { CachedCuadreReader } from './app/cached-cuadre-reader.js';
import { initialCuadreSeed, seedAll } from './app/seed.js';
import { ConfigError, loadConfig, type Config } from './config.js';
import { EQUIVALENCES } from './core/equivalences.js';
import type { CuadreReader } from './ports/cuadre-source.js';
import type { SheetsGateway } from './ports/sheets-gateway.js';

/**
 * Errores que no se arreglan reiniciando (configuración, token inválido): el proceso
 * termina con código 0 para que docker-compose (`restart: on-failure`) no entre en
 * un bucle de reinicios. Los demás fallos salen con código 1 y Docker reinicia.
 */
const FATAL_EXIT_CODE = 0;
/** Reintentos de conexión inicial a Telegram (red caída al arrancar). */
const START_RETRY_MS = [5_000, 15_000, 30_000, 60_000];

function createSheetsGateway({ googleServiceAccountJson, cuadreSheetId }: Config): SheetsGateway {
  if (googleServiceAccountJson === undefined || cuadreSheetId === undefined) {
    return new FakeSheetsGateway();
  }
  return new GoogleSheetsGateway(createSheetsClient(googleServiceAccountJson), cuadreSheetId);
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
      : await CuadreXlsxReader.fromFile(config.cuadreSeedPath);
  const summary = seedAll(
    { users, catalog, settings },
    {
      ownerIds: config.ownerIds,
      equivalences: EQUIVALENCES,
      cuadre: initialCuadreSeed(catalog, seedFile),
    },
  );

  const rawSheets = createSheetsGateway(config);
  // Memoria de 60 s del cuadre para los reportes; cualquier escritura la vacía.
  const cuadre = new CachedCuadreReader(chooseCuadreReader(config, rawSheets, seedFile), clock);
  const sheets = new NotifyingSheetsGateway(rawSheets, () => {
    cuadre.invalidate();
  });
  const products = catalog.listProducts().length;
  console.log(
    `Kilo 12 bot: ${config.useFakeSheets ? 'hoja SIMULADA en memoria (faltan GOOGLE_SA_JSON o CUADRE_SHEET_ID)' : 'Google Sheets'}, ` +
      `base de datos en ${config.dbPath}, ${String(products)} productos en el catálogo` +
      (summary.catalog === null ? '.' : ` (carga inicial desde ${config.cuadreSeedPath ?? ''}).`),
  );
  if (products === 0) {
    console.warn(
      '⚠️ Catálogo vacío: define CUADRE_SEED_PATH para cargar costos antes del primer /ipv.',
    );
  }

  const bot = createBot(
    {
      pipeline: {
        sheets,
        catalog,
        pending: new SqlitePendingActionRepository(db, clock),
        changeLog: new SqliteChangeLogRepository(db),
        snapshots: new SqliteSnapshotRepository(db, clock),
        clock,
      },
      auth: { users, accessLog: new SqliteAccessLogRepository(db) },
      settings,
      cuadre,
      timezone: config.timezone,
    },
    { token: config.telegramToken },
  );

  const stop = () => {
    console.log('Deteniendo el bot…');
    void bot.stop().finally(() => db.$client.close());
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

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
