import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSheetsGateway } from '../../../src/adapters/sheets/fake-sheets-gateway.js';
import { SqliteCatalogRepository } from '../../../src/adapters/sqlite/catalog-repo.js';
import { openDatabase } from '../../../src/adapters/sqlite/db.js';
import {
  SqliteChangeLogRepository,
  SqliteSnapshotRepository,
} from '../../../src/adapters/sqlite/history-repo.js';
import { SqlitePendingActionRepository } from '../../../src/adapters/sqlite/pending-actions-repo.js';
import { SqliteSettingsRepository } from '../../../src/adapters/sqlite/settings-repo.js';
import {
  SqliteAccessLogRepository,
  SqliteUserRepository,
} from '../../../src/adapters/sqlite/users-repo.js';
import {
  BOT_TEXT,
  createBot,
  parseTcValue,
  rowDayPrompt,
  splitMessage,
} from '../../../src/adapters/telegram/bot.js';
import { asCuadreReader, CuadreXlsxReader } from '../../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import { FREE_TEXT_REPLY } from '../../../src/app/help.js';
import { keyboardRowsFor, menuCommandsFor } from '../../../src/app/keyboard-menu.js';
import { MAX_TABLE_WIDTH, preLines } from '../../../src/app/report-format.js';
import { initialCuadreSeed, seedAll } from '../../../src/app/seed.js';
import { ROLE } from '../../../src/core/auth.js';
import { EQUIVALENCES } from '../../../src/core/equivalences.js';
import { RENDER } from '../../../src/ports/sheets-gateway.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));

const OWNER = 10;
const PARTNER = 20;
const CLERK = 30;
const STRANGER = 99;

let ipvBuffer: ArrayBuffer;
let cuadre: CuadreXlsxReader;

beforeAll(async () => {
  const bytes = await readFile(fixture('IPV KILO 12.xlsx'));
  ipvBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  cuadre = await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx'));
});

interface SentMessage {
  chatId: number;
  text: string;
  parseMode: string | undefined;
  /** callback_data de los botones, si el mensaje los trae. */
  buttons: string[];
  /** Teclado fijo (reply keyboard), si el mensaje lo trae. */
  keys: string[][];
  persistent: boolean;
}

interface MenuCall {
  commands: { command: string }[];
  scope: { type: string; chat_id?: number };
}

interface CallbackAnswer {
  text: string | undefined;
}

let now: Date;
let sheets: FakeSheetsGateway;
let sent: SentMessage[];
let answers: CallbackAnswer[];
let edits: number;
let edited: number[];
/** Si no es null, el cuadre falla con este error (para probar el mensaje de error). */
let cuadreError: Error | null;
let chatActions: string[];
let menuCalls: MenuCall[];
let changeLog: SqliteChangeLogRepository;
let accessLog: SqliteAccessLogRepository;
let bot: ReturnType<typeof createBot>;
let updateId: number;

function keysOf(payload: Record<string, unknown>): { keys: string[][]; persistent: boolean } {
  const markup = payload.reply_markup as
    { keyboard?: (string | { text: string })[][]; is_persistent?: boolean } | undefined;
  const keys = (markup?.keyboard ?? []).map((row) =>
    row.map((key) => (typeof key === 'string' ? key : key.text)),
  );
  return { keys, persistent: markup?.is_persistent === true };
}

function buttonsOf(payload: Record<string, unknown>): string[] {
  const markup = payload.reply_markup as
    { inline_keyboard?: { callback_data?: string }[][] } | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .flatMap((b) => (b.callback_data ? [b.callback_data] : []));
}

beforeEach(async () => {
  now = new Date('2026-10-03T23:00:00Z'); // 19:00 del 3 oct en La Habana
  const clock = () => now;
  const db = openDatabase(':memory:');
  const catalog = new SqliteCatalogRepository(db);
  const users = new SqliteUserRepository(db);
  const settings = new SqliteSettingsRepository(db);
  seedAll(
    { users, catalog, settings },
    { ownerIds: [OWNER], equivalences: EQUIVALENCES, cuadre: initialCuadreSeed(catalog, cuadre) },
  );
  users.upsert({ telegramId: PARTNER, name: 'Socio', role: ROLE.PARTNER, active: true });
  users.upsert({ telegramId: CLERK, name: 'Turno 1', role: ROLE.CLERK, active: true });

  sheets = new FakeSheetsGateway();
  changeLog = new SqliteChangeLogRepository(db);
  accessLog = new SqliteAccessLogRepository(db);
  sent = [];
  answers = [];
  edits = 0;
  edited = [];
  chatActions = [];
  menuCalls = [];
  cuadreError = null;
  const reader = asCuadreReader(cuadre);
  const guard = <T>(read: () => Promise<T>) =>
    cuadreError === null ? read() : Promise.reject(cuadreError);
  updateId = 1;

  bot = createBot(
    {
      pipeline: {
        sheets,
        catalog,
        pending: new SqlitePendingActionRepository(db, clock),
        changeLog,
        snapshots: new SqliteSnapshotRepository(db, clock),
        clock,
      },
      auth: { users, accessLog },
      settings,
      cuadre: {
        listDays: () => guard(() => reader.listDays()),
        readDay: (tab) => guard(() => reader.readDay(tab)),
        readDays: (tabs) => guard(() => reader.readDays(tabs)),
      },
      timezone: 'America/Havana',
      downloadFile: () => Promise.resolve(ipvBuffer),
    },
    {
      token: '123:TEST',
      botInfo: {
        id: 1,
        is_bot: true,
        first_name: 'Kilo 12',
        username: 'kilo12_bot',
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      },
    },
  );

  // Ninguna llamada sale a Telegram: se registran y se responde algo plausible.
  bot.api.config.use((_prev, method, payload) => {
    const body = payload as Record<string, unknown>;
    if (method === 'sendMessage') {
      sent.push({
        chatId: body.chat_id as number,
        text: body.text as string,
        parseMode: body.parse_mode as string | undefined,
        buttons: buttonsOf(body),
        ...keysOf(body),
      });
      return Promise.resolve({
        ok: true,
        result: {
          message_id: sent.length,
          date: 0,
          chat: { id: body.chat_id, type: 'private' },
          text: body.text,
        },
      } as never);
    }
    // El reporte reemplaza el mensaje "⏳ Calculando…": se refleja en `sent`.
    if (method === 'editMessageText') {
      const target = sent[(body.message_id as number) - 1];
      if (target !== undefined) {
        target.text = body.text as string;
        target.parseMode = body.parse_mode as string | undefined;
        target.buttons = buttonsOf(body);
      }
      edited.push(body.message_id as number);
    }
    if (method === 'sendChatAction') chatActions.push(body.action as string);
    if (method === 'setMyCommands')
      menuCalls.push({
        commands: body.commands as { command: string }[],
        scope: body.scope as MenuCall['scope'],
      });
    if (method === 'answerCallbackQuery') answers.push({ text: body.text as string | undefined });
    if (method === 'editMessageReplyMarkup') edits++;
    return Promise.resolve({ ok: true, result: true } as never);
  });
  await bot.init();
});

const from = (id: number) => ({ id, is_bot: false, first_name: `u${String(id)}` });

async function text(userId: number, value: string): Promise<void> {
  const command = /^\/\S+/.exec(value)?.[0];
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: userId, type: 'private', first_name: 'x' },
      from: from(userId),
      text: value,
      ...(command === undefined
        ? {}
        : { entities: [{ type: 'bot_command', offset: 0, length: command.length }] }),
    },
  });
}

async function document(
  userId: number,
  caption?: string,
  fileName = 'IPV KILO 12.xlsx',
): Promise<void> {
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: userId, type: 'private', first_name: 'x' },
      from: from(userId),
      document: { file_id: 'FILE', file_unique_id: 'U', file_name: fileName, file_size: 1000 },
      ...(caption === undefined ? {} : { caption }),
    },
  });
}

async function click(userId: number, data: string): Promise<void> {
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: from(userId),
      chat_instance: 'c',
      data,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: userId, type: 'private', first_name: 'x' },
        text: 'x',
      },
    },
  });
}

const last = (): SentMessage => {
  const message = sent[sent.length - 1];
  if (message === undefined) throw new Error('el bot no respondió');
  return message;
};
const button = (prefix: string): string => {
  const data = last().buttons.find((b) => b.startsWith(`${prefix}:`));
  if (data === undefined) throw new Error(`no hay botón ${prefix} en: ${JSON.stringify(last())}`);
  return data;
};
const tabs = async () => (await sheets.listTabs()).map((t) => t.title);

describe('permisos', () => {
  it('un usuario fuera de la whitelist recibe "No autorizado." y queda en el log', async () => {
    await text(STRANGER, '/validar');
    expect(last().text).toBe('No autorizado.');
    expect(accessLog.list()).toMatchObject([{ telegramId: STRANGER, outcome: 'unauthorized' }]);
    await document(STRANGER, '3oct');
    expect(last().text).toBe('No autorizado.');
    expect(await tabs()).toEqual([]);
  });

  it('un rol sin permiso recibe el aviso y queda en el log', async () => {
    await text(CLERK, '/tc 780');
    expect(last().text).toContain('Tu rol no permite');
    expect(accessLog.list()).toMatchObject([
      { telegramId: CLERK, command: '/tc', outcome: 'forbidden' },
    ]);
  });

  it('el socio no puede subir un IPV', async () => {
    await document(PARTNER, '3oct');
    expect(last().text).toContain('Tu rol no permite');
  });
});

describe('/ipv', () => {
  it('3 oct: vista previa con ✅/❌ y, al confirmar, crea la pestaña 03', async () => {
    await document(OWNER, '3oct');
    expect(last().text).toContain('IPV 3 oct → pestaña 03');
    expect(last().text).toContain('Venta: 90,356 CUP');
    expect(last().buttons.some((b) => b.startsWith('force:'))).toBe(false);

    await click(OWNER, button('ok'));
    expect(last().text).toContain('✅ Pestaña 03 creada');
    expect(await tabs()).toContain('03');
    expect(edits).toBe(1);
  });

  it('acepta "/ipv 3oct" en el pie del archivo', async () => {
    await document(OWNER, '/ipv 3oct');
    expect(last().text).toContain('pestaña 03');
  });

  it('sin día y con varias pestañas: ofrece elegir el día con botones', async () => {
    await document(OWNER);
    expect(last().text).toBe('¿Qué día del IPV cargo?');
    expect(last().buttons).toHaveLength(5);
    const day3 = last().buttons.find((b) => b.endsWith(':3-10'));
    await click(OWNER, day3 ?? '');
    expect(last().text).toContain('Venta: 90,356 CUP');
  });

  it('otro usuario no puede usar el archivo que subió una dueña', async () => {
    await document(OWNER);
    const day3 = last().buttons.find((b) => b.endsWith(':3-10')) ?? '';
    await click(CLERK, day3);
    expect(last().text).toBe(BOT_TEXT.UPLOAD_EXPIRED);
  });

  it('4 oct bloqueado: la dueña solo ve "⚠️ Confirmar igual", que exige motivo', async () => {
    await document(OWNER, '4oct');
    expect(last().text).toContain('⛔ No se puede confirmar');
    expect(last().buttons.some((b) => b.startsWith('ok:'))).toBe(false);
    const force = button('force');

    await click(OWNER, force);
    expect(last().text).toBe(BOT_TEXT.ASK_REASON);
    await text(OWNER, 'El IPV se llenó así; lo corrijo mañana');
    expect(last().text).toContain('✅ Pestaña 04 creada');
    const load = changeLog.list().find((entry) => entry.action === 'load_ipv');
    expect(JSON.stringify(load?.detail)).toContain('lo corrijo mañana');
  });

  it('4 oct bloqueado: /cancelar abandona el motivo sin escribir', async () => {
    await document(OWNER, '4oct');
    await click(OWNER, button('force'));
    await text(OWNER, '/cancelar');
    expect(last().text).toBe(BOT_TEXT.REASON_CANCELLED);
    await text(OWNER, 'hola');
    expect(last().text).toBe(FREE_TEXT_REPLY);
    expect(await tabs()).toEqual([]);
  });

  it('4 oct para el dependiente: vista previa bloqueada, sin botones', async () => {
    await document(CLERK, '4oct');
    expect(last().text).toContain('⛔ No se puede confirmar');
    expect(last().buttons).toEqual([]);
  });

  it('solo quien pidió la acción puede confirmarla', async () => {
    await document(CLERK, '3oct');
    const ok = button('ok');
    await click(OWNER, ok);
    expect(last().text).toContain('Solo quien pidió la acción');
    expect(await tabs()).toEqual([]);
  });

  it('la confirmación vence a los 15 minutos', async () => {
    await document(OWNER, '3oct');
    const ok = button('ok');
    now = new Date(now.getTime() + 16 * 60 * 1000);
    await click(OWNER, ok);
    expect(last().text).toContain('venció');
    expect(await tabs()).toEqual([]);
  });

  it('❌ Cancelar no escribe nada', async () => {
    await document(OWNER, '3oct');
    await click(OWNER, button('no'));
    expect(last().text).toBe('Cancelado. No se escribió nada.');
    expect(await tabs()).toEqual([]);
  });

  it('archivo que no es .xlsx o día que no está', async () => {
    await document(OWNER, undefined, 'foto.pdf');
    expect(last().text).toBe(BOT_TEXT.NOT_XLSX);
    await document(OWNER, '5oct');
    expect(last().text).toContain('El archivo no tiene 5 oct');
  });

  it('/ipv sin archivo pide el archivo; /ipv 5oct explica que Drive aún no está', async () => {
    await text(OWNER, '/ipv');
    expect(last().text).toBe(BOT_TEXT.ASK_IPV_FILE);
    await text(OWNER, '/ipv 5oct');
    expect(last().text).toBe(BOT_TEXT.NO_DRIVE);
  });

  it('la pestaña ya existe: rechazo claro, sin sobrescribir', async () => {
    await document(OWNER, '3oct');
    await click(OWNER, button('ok'));
    await document(OWNER, '3oct');
    expect(last().text).toContain('La pestaña 03 ya existe');
  });
});

describe('/tc y /deshacer', () => {
  it('/tc del día de hoy (zona de La Habana), confirmar, y /deshacer lo revierte', async () => {
    await document(OWNER, '3oct');
    await click(OWNER, button('ok'));

    await text(OWNER, '/tc 780');
    expect(last().text).toContain('TC de la pestaña 03: vacía → 780');
    await click(OWNER, button('ok'));
    expect(last().text).toBe('✅ TC de 03: 780.');
    const [[tcCells = []] = []] = await sheets.readRanges(
      [{ tab: '03', a1: 'Q18' }],
      RENDER.FORMULA,
    );
    expect(tcCells[0]).toBe(780);

    await text(OWNER, '/deshacer');
    expect(last().text).toContain('↩️ Deshacer: restaurar P18:Q18');
    await click(OWNER, button('ok'));
    expect(last().text).toBe('↩️ Pestaña 03 restaurada.');

    await text(OWNER, '/deshacer');
    await click(OWNER, button('ok'));
    expect(last().text).toBe('↩️ Pestaña 03 eliminada.');
    expect(await tabs()).not.toContain('03');
  });

  it('/tc con pestaña explícita y valores mal escritos', async () => {
    await text(OWNER, '/tc abc');
    expect(last().text).toBe(BOT_TEXT.TC_USAGE);
    await text(OWNER, '/tc 780 09');
    expect(last().text).toContain('No existe la pestaña 09');
  });

  it('/deshacer sin escrituras', async () => {
    await text(OWNER, '/deshacer');
    expect(last().text).toBe('No hay escrituras para deshacer.');
  });
});

describe('/validar, /ayuda y texto libre', () => {
  it('/validar 02 muestra los hallazgos por severidad', async () => {
    await text(OWNER, '/validar 02');
    const all = sent.map((m) => m.text).join('\n');
    expect(all).toContain('🔎 Validación del cuadre: 02');
    expect(all).toContain('🔴 Afecta la ganancia');
    expect(all).toMatch(/agua\s+500 ml/);
  });

  it('/ayuda según el rol, con el teclado fijo del rol', async () => {
    await text(CLERK, '/ayuda');
    expect(last().text).toContain('/ipv');
    expect(last().text).not.toContain('/validar');
    expect(last().keys).toEqual([['📥 IPV', '❓ Ayuda']]);
    expect(last().persistent).toBe(true);
  });

  it('texto libre → teclado fijo del rol (sin IA)', async () => {
    await text(PARTNER, '¿cuánto vendimos ayer?');
    expect(last().text).toBe(FREE_TEXT_REPLY);
    expect(last().keys).toEqual(keyboardRowsFor(ROLE.PARTNER));
    await text(PARTNER, '🔎 Validar');
    expect(last().text).toContain('🔎 Validación del cuadre: 05');
  });

  it('los botones en línea del menú anterior siguen funcionando', async () => {
    await click(PARTNER, 'menu:validar');
    expect(last().text).toContain('🔎 Validación del cuadre: 05');
  });

  it('un botón de menú sin permiso queda rechazado y registrado', async () => {
    await click(CLERK, 'menu:validar');
    expect(answers[answers.length - 1]?.text).toContain('Tu rol no permite');
    expect(accessLog.list()).toMatchObject([{ telegramId: CLERK, command: '/validar' }]);
  });

  it('comando que todavía no existe', async () => {
    await text(CLERK, '/comparar 04');
    expect(last().text).toContain('Tu rol no permite');
    await text(OWNER, '/comparar 04');
    expect(last().text).toBe(BOT_TEXT.UNKNOWN_COMMAND);
  });
});

describe('reportes', () => {
  it('/mes: tabla en HTML con <pre> y la suma de la utilidad', async () => {
    await text(OWNER, '/mes');
    const message = last();
    expect(message.parseMode).toBe('HTML');
    expect(message.text).toContain('<pre>');
    expect(message.text).toMatch(/Total\s+528\.5k\s+181\.2k\s+34\.3%/);
    expect(message.text).toContain('Utilidad neta: <b>181,229 CUP</b>');
    expect(message.text).toContain('Margen promedio simple');
    expect(Math.max(...preLines(message.text).map((l) => l.length))).toBeLessThanOrEqual(
      MAX_TABLE_WIDTH,
    );
  });

  it('feedback: "⏳ Calculando…" al instante, "escribiendo…" y el reporte reemplaza ese mensaje', async () => {
    await text(OWNER, '/mes');
    expect(sent).toHaveLength(1);
    expect(edited).toEqual([1]);
    expect(chatActions).toContain('typing');
    expect(last().text).toContain('<b>Mes</b>');
    expect(last().text).not.toContain('Calculando');
  });

  it('si el reporte falla, el mensaje "⏳ Calculando…" muestra el error', async () => {
    cuadreError = new Error('Google Sheets no responde');
    await text(OWNER, '/mes');
    expect(sent).toHaveLength(1);
    expect(edited).toEqual([1]);
    expect(last().text).toContain('No pude generar el reporte: Google Sheets no responde');
  });

  it('el socio ve reportes; el dependiente recibe "No autorizado para reportes"', async () => {
    await text(PARTNER, '/ganancia');
    expect(last().text).toContain('Ganancia acumulada');
    await text(CLERK, '/mes');
    expect(last().text).toContain('No autorizado para reportes');
    await text(CLERK, '/producto pollo');
    expect(last().text).toContain('No autorizado para reportes');
    expect(accessLog.list()).toMatchObject([
      { telegramId: CLERK, command: '/mes', outcome: 'forbidden' },
      { telegramId: CLERK, command: '/producto', outcome: 'forbidden' },
    ]);
  });

  it('/fila y /dia con argumentos', async () => {
    await text(OWNER, '/fila mantequilla soya 04');
    expect(last().text).toContain('La hoja guarda otro valor en C60');
    await text(OWNER, '/dia 02');
    expect(last().text).toContain('pestaña 02 · TC 775');
    await text(OWNER, '/rango');
    expect(last().text).toContain('Uso: /rango');
  });

  it('/hoy usa la pestaña del día en La Habana (o el último día cargado)', async () => {
    await text(OWNER, '/hoy');
    const all = sent.map((m) => m.text).join('\n');
    // El reloj de la prueba es el 3 oct en La Habana y existe la pestaña 03.
    expect(all).toContain('<b>Hoy</b> · pestaña 03');
  });

  it('nombre ambiguo: botones para elegir; solo quien preguntó puede elegir', async () => {
    await text(OWNER, '/producto mayonesa');
    expect(last().text).toContain('coincide con varios productos');
    const choice = button('prod');
    await click(PARTNER, choice);
    expect(last().text).toBe(BOT_TEXT.CHOICE_EXPIRED);
    await click(OWNER, choice);
    expect(last().text).toContain('<b>mayonesa cepera</b>');
    expect(edits).toBeGreaterThan(0);
  });

  it('el dependiente no puede usar un botón de producto', async () => {
    await text(OWNER, '/producto mayonesa');
    await click(CLERK, button('prod'));
    expect(answers[answers.length - 1]?.text).toContain('No autorizado para reportes');
  });

  it('botón del menú: 📅 Mes', async () => {
    await click(OWNER, 'menu:mes');
    expect(last().text).toContain('<b>Mes</b>');
  });
});

describe('teclado fijo y flujos guiados', () => {
  it('/start: ayuda con el teclado de la dueña y publica su menú "/"', async () => {
    await text(OWNER, '/start');
    expect(last().keys).toEqual(keyboardRowsFor(ROLE.OWNER));
    expect(last().persistent).toBe(true);
    await vi.waitFor(() => {
      expect(menuCalls).toEqual([
        {
          commands: menuCommandsFor(ROLE.OWNER),
          scope: { type: 'chat', chat_id: OWNER },
        },
      ]);
    });
  });

  it('un botón sin argumentos ejecuta su comando (📆 Mes)', async () => {
    await text(OWNER, '📆 Mes');
    expect(last().text).toContain('<b>Mes</b>');
  });

  it('el texto del botón se reconoce aunque falte el selector de emoji', async () => {
    await text(OWNER, '↩ Deshacer');
    expect(last().text).toBe('No hay escrituras para deshacer.');
  });

  it('un botón que el rol no puede usar queda rechazado y registrado', async () => {
    await text(CLERK, '📆 Mes');
    expect(last().text).toContain('No autorizado para reportes');
    expect(accessLog.list()).toMatchObject([
      { telegramId: CLERK, command: '/mes', outcome: 'forbidden' },
    ]);
  });

  it('📍 Día: pregunta el día con botones y muestra /dia', async () => {
    await text(OWNER, '📍 Día');
    expect(last().text).toBe(BOT_TEXT.ASK_DAY);
    expect(last().buttons).toEqual(['gd:01', 'gd:02', 'gd:03', 'gd:04', 'gd:05']);
    await click(OWNER, 'gd:02');
    expect(last().text).toContain('pestaña 02 · TC 775');
  });

  it('↔️ Rango: desde → hasta (solo días posteriores) → /rango', async () => {
    await text(OWNER, '↔️ Rango');
    expect(last().text).toBe(BOT_TEXT.ASK_FROM);
    await click(OWNER, 'gr1:02');
    expect(last().text).toBe(BOT_TEXT.ASK_TO);
    expect(last().buttons).toEqual(['gr2:02:02', 'gr2:02:03', 'gr2:02:04', 'gr2:02:05']);
    await click(OWNER, 'gr2:02:03');
    expect(last().text).toContain('Venta: <b>191,076 CUP</b>');
  });

  it('🔍 Producto: pregunta el nombre y responde con /producto', async () => {
    await text(OWNER, '🔍 Producto');
    expect(last().text).toBe(BOT_TEXT.ASK_PRODUCT);
    await text(OWNER, 'arroz');
    expect(last().text).toContain('Vendió: <b>6</b> unidades · venta <b>5,760 CUP</b>');
    // La pregunta ya se respondió: el siguiente texto vuelve a ser texto libre.
    await text(OWNER, 'arroz');
    expect(last().text).toBe(FREE_TEXT_REPLY);
  });

  it('📄 Fila: producto → día → /fila', async () => {
    await text(OWNER, '📄 Fila');
    expect(last().text).toBe(BOT_TEXT.ASK_ROW_PRODUCT);
    await text(OWNER, 'arroz');
    expect(last().text).toBe(rowDayPrompt('arroz'));
    expect(last().buttons).toEqual(['gf:01', 'gf:02', 'gf:03', 'gf:04', 'gf:05']);
    await text(OWNER, 'hola');
    expect(last().text).toBe(BOT_TEXT.CHOOSE_DAY_ABOVE);
    await click(OWNER, 'gf:02');
    expect(last().text).toContain('pestaña 02');
    expect(last().text).toContain('K · Venta Bruta: <b>1,900</b>');
  });

  it('📄 Fila: otro usuario no puede usar el día de una pregunta ajena', async () => {
    await text(OWNER, '📄 Fila');
    await text(OWNER, 'arroz');
    await click(PARTNER, 'gf:02');
    expect(last().text).toBe(BOT_TEXT.FLOW_EXPIRED);
  });

  it('🏆 Top: elige la métrica con botones', async () => {
    await text(OWNER, '🏆 Top');
    expect(last().text).toBe(BOT_TEXT.ASK_TOP);
    expect(last().buttons).toEqual(['gt:venta', 'gt:utilidad', 'gt:unidades']);
    await click(OWNER, 'gt:utilidad');
    expect(last().text).toContain('por utilidad');
  });

  it('💱 TC: pide el número, insiste si no lo es y prepara /tc con confirmación', async () => {
    await document(OWNER, '3oct');
    await click(OWNER, button('ok'));
    await text(OWNER, '💱 TC');
    expect(last().text).toBe(BOT_TEXT.ASK_TC_VALUE);
    await text(OWNER, 'setecientos');
    expect(last().text).toBe(BOT_TEXT.TC_NOT_NUMBER);
    await text(OWNER, '780');
    expect(last().text).toContain('TC de la pestaña 03: vacía → 780');
    expect(last().buttons.some((b) => b.startsWith('ok:'))).toBe(true);
  });

  it('📥 IPV: pide el archivo', async () => {
    await text(CLERK, '📥 IPV');
    expect(last().text).toBe(BOT_TEXT.ASK_IPV_FILE);
  });

  it('/cancelar abandona la pregunta en curso', async () => {
    await text(OWNER, '🔍 Producto');
    await text(OWNER, '/cancelar');
    expect(last().text).toBe(BOT_TEXT.FLOW_CANCELLED);
    await text(OWNER, 'arroz');
    expect(last().text).toBe(FREE_TEXT_REPLY);
    await text(OWNER, '/cancelar');
    expect(last().text).toBe(BOT_TEXT.NOTHING_TO_CANCEL);
  });

  it('tocar otro botón reemplaza la pregunta en curso', async () => {
    await text(OWNER, '💱 TC');
    await text(OWNER, '📆 Mes');
    expect(last().text).toContain('<b>Mes</b>');
    await text(OWNER, '780');
    expect(last().text).toBe(FREE_TEXT_REPLY);
  });

  it('la pregunta vence a los 15 minutos', async () => {
    await text(OWNER, '🔍 Producto');
    now = new Date(now.getTime() + 16 * 60 * 1000);
    await text(OWNER, 'arroz');
    expect(last().text).toBe(FREE_TEXT_REPLY);
  });
});

describe('utilidades', () => {
  it('splitMessage corta por líneas sin pasar el máximo', () => {
    const parts = splitMessage(['a'.repeat(6), 'b'.repeat(6), 'c'.repeat(6)].join('\n'), 13);
    expect(parts).toEqual(['aaaaaa\nbbbbbb', 'cccccc']);
  });

  it('parseTcValue', () => {
    expect(parseTcValue('780')).toBe(780);
    expect(parseTcValue('780,5')).toBe(780.5);
    expect(parseTcValue('1,050')).toBe(1050);
    expect(parseTcValue('x')).toBeNull();
  });
});
