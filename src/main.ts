import { loadConfig } from './config.js';

// Punto de arranque. Los handlers de Telegram se conectan en el lote 7.
const config = loadConfig();
console.log(
  `Kilo 12 bot: configuración cargada (${config.useFakeSheets ? 'hoja simulada' : 'Google Sheets'}).`,
);
