import { SqliteCatalogRepository } from './adapters/sqlite/catalog-repo.js';
import { openDatabase } from './adapters/sqlite/db.js';
import { SqliteSettingsRepository } from './adapters/sqlite/settings-repo.js';
import { SqliteUserRepository } from './adapters/sqlite/users-repo.js';
import { seedAll } from './app/seed.js';
import { loadConfig } from './config.js';
import { EQUIVALENCES } from './core/equivalences.js';

// Punto de arranque. Los handlers de Telegram se conectan en el lote 7.
const config = loadConfig();
const db = openDatabase(config.dbPath);

// El catálogo se carga desde el cuadre cuando esté conectado (lote 6).
seedAll(
  {
    users: new SqliteUserRepository(db),
    catalog: new SqliteCatalogRepository(db),
    settings: new SqliteSettingsRepository(db),
  },
  { ownerIds: config.ownerIds, equivalences: EQUIVALENCES, cuadre: null },
);

console.log(
  `Kilo 12 bot: configuración cargada (${config.useFakeSheets ? 'hoja simulada' : 'Google Sheets'}), ` +
    `base de datos en ${config.dbPath}.`,
);
