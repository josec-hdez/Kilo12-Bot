import { SqliteCatalogRepository } from './adapters/sqlite/catalog-repo.js';
import { openDatabase } from './adapters/sqlite/db.js';
import { SqliteSettingsRepository } from './adapters/sqlite/settings-repo.js';
import { SqliteUserRepository } from './adapters/sqlite/users-repo.js';
import { FakeSheetsGateway } from './adapters/sheets/fake-sheets-gateway.js';
import {
  createSheetsClient,
  GoogleSheetsGateway,
} from './adapters/sheets/google-sheets-gateway.js';
import { CuadreXlsxReader } from './adapters/xlsx/cuadre-xlsx-reader.js';
import { initialCuadreSeed, seedAll } from './app/seed.js';
import { loadConfig, type Config } from './config.js';
import { EQUIVALENCES } from './core/equivalences.js';
import type { SheetsGateway } from './ports/sheets-gateway.js';

// Punto de arranque. Los handlers de Telegram se conectan en el lote 7.
const config = loadConfig();
const db = openDatabase(config.dbPath);
const catalog = new SqliteCatalogRepository(db);

const cuadre =
  config.cuadreSeedPath === undefined
    ? null
    : await CuadreXlsxReader.fromFile(config.cuadreSeedPath);

const summary = seedAll(
  {
    users: new SqliteUserRepository(db),
    catalog,
    settings: new SqliteSettingsRepository(db),
  },
  {
    ownerIds: config.ownerIds,
    equivalences: EQUIVALENCES,
    cuadre: initialCuadreSeed(catalog, cuadre),
  },
);

function createSheetsGateway({ googleServiceAccountJson, cuadreSheetId }: Config): SheetsGateway {
  if (googleServiceAccountJson === undefined || cuadreSheetId === undefined) {
    return new FakeSheetsGateway();
  }
  return new GoogleSheetsGateway(createSheetsClient(googleServiceAccountJson), cuadreSheetId);
}

// Se usa en el lote 7 (handlers de Telegram); crearlo aquí valida la service account al arrancar.
createSheetsGateway(config);

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
