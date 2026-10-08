import { Bot, GrammyError, HttpError, InlineKeyboard, type NextFunction } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { AUTH_STATUS, authorize, type AuthDeps } from '../../app/authorize.js';
import { cancelPending, confirmPending } from '../../app/confirm.js';
import { FREE_TEXT_REPLY, helpText, menuCommandsFor } from '../../app/help.js';
import { INTAKE_STATUS, parseDayArg, resolveIpvDay } from '../../app/ipv-intake.js';
import { dayTab, prepareIpvLoad } from '../../app/load-ipv.js';
import {
  CONFIRM_STATUS,
  PREPARE_STATUS,
  type Actor,
  type PipelineDeps,
  type PrepareResult,
} from '../../app/pipeline-types.js';
import {
  completeProductRequest,
  dayReport,
  expensesReport,
  inventoryReport,
  marginsReport,
  monthReport,
  productReport,
  profitReport,
  rangeReport,
  REPORT_KIND,
  rowReport,
  todayReport,
  topReport,
  weekReport,
  type ProductRequest,
  type ReportDeps,
  type ReportResult,
} from '../../app/reports.js';
import { prepareSetTc } from '../../app/set-tc.js';
import { todayIn } from '../../app/today.js';
import { prepareUndo } from '../../app/undo.js';
import { parseValidateArgs, runValidation } from '../../app/validate-report.js';
import { can, PERMISSION } from '../../core/auth.js';
import { buildAliasIndex } from '../../core/mapping.js';
import { SETTING } from '../../core/settings.js';
import type { DayRef } from '../../core/types.js';
import type { IpvSource } from '../../ports/ipv-source.js';
import type { CuadreReader } from '../../ports/cuadre-source.js';
import type { SettingsRepository } from '../../ports/repositories.js';
import { ExcelIpvSource } from '../xlsx/excel-ipv-source.js';
import type { BotContext } from './context.js';
import { telegramFileDownloader, type FileDownloader } from './file-downloader.js';
import {
  CALLBACK,
  confirmKeyboard,
  dayChoiceKeyboard,
  menuKeyboard,
  productChoiceKeyboard,
} from './keyboards.js';
import { TtlStore } from './ttl-store.js';

/**
 * Adaptador de Telegram. Los handlers son delgados: traducen el mensaje, llaman al
 * caso de uso (app/) y muestran su texto. Ninguna escritura ocurre sin ✅.
 */

export interface BotDeps {
  pipeline: PipelineDeps;
  auth: AuthDeps;
  settings: SettingsRepository;
  /** De dónde leen /validar y los reportes: la hoja (real o simulada) o el .xlsx del cuadre. */
  cuadre: CuadreReader;
  timezone: string;
  /** Descarga de archivos; por defecto, la API de Telegram. */
  downloadFile?: FileDownloader;
}

export interface CreateBotOptions {
  token: string;
  /** Datos de getMe ya conocidos: las pruebas lo pasan para no llamar a Telegram. */
  botInfo?: UserFromGetMe;
}

/** Lo que dura el estado de la conversación (igual que las acciones pendientes). */
const CONVERSATION_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_MAX_TEXT = 4096;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const BOT_TEXT = {
  ASK_IPV_FILE:
    '📥 Envíame (o reenvíame) el archivo .xlsx del IPV. Si tiene varios días, escribe el día en el pie del archivo (por ejemplo 3oct) o elígelo después.',
  NO_DRIVE:
    'Todavía no leo el IPV desde Drive (faltan los IDs de la carpeta). Envíame el .xlsx y escribe el día en el pie del archivo, por ejemplo 3oct.',
  NOT_XLSX: 'Solo leo archivos .xlsx del IPV.',
  FILE_TOO_BIG: 'El archivo pasa de 20 MB; Telegram no deja descargarlo.',
  UPLOAD_EXPIRED:
    'Ese archivo ya no está en memoria (pasaron 15 minutos o se reinició el bot). Envíalo de nuevo.',
  ASK_REASON:
    '✍️ Escribe el motivo para confirmar igual; queda en el registro de cambios. /cancelar para no confirmar.',
  REASON_CANCELLED: 'Listo, no se confirmó nada. La acción sigue pendiente 15 minutos.',
  ONLY_OWNER_FORCE: 'Solo una dueña puede confirmar con bloqueos.',
  TC_USAGE: 'Uso: /tc 780 (día de hoy) o /tc 780 03 (pestaña 03).',
  UNKNOWN_COMMAND: 'Ese comando todavía no está disponible. Usa /ayuda.',
  CHOICE_EXPIRED: 'Esa elección ya venció (15 minutos). Repite el comando.',
  GENERIC_ERROR: '⚠️ Algo falló procesando el mensaje. No se escribió nada. Inténtalo de nuevo.',
} as const;

/** Parte un texto largo en mensajes de Telegram, cortando por líneas. */
export function splitMessage(text: string, max = TELEGRAM_MAX_TEXT): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current === '' ? line : `${current}\n${line}`;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current !== '') chunks.push(current);
    current = line.length > max ? line.slice(0, max) : line;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/** Mensajes HTML ya partidos (reportes): las tablas van en <pre>. */
async function replyHtml(ctx: BotContext, messages: readonly string[]): Promise<void> {
  for (const message of messages) await ctx.reply(message, { parse_mode: 'HTML' });
}

async function replyLong(ctx: BotContext, text: string, keyboard?: InlineKeyboard): Promise<void> {
  const chunks = splitMessage(text);
  for (const [index, chunk] of chunks.entries()) {
    const last = index === chunks.length - 1;
    await ctx.reply(chunk, last && keyboard !== undefined ? { reply_markup: keyboard } : {});
  }
}

/** Comando que el middleware de permisos debe revisar para este update. */
function commandOf(ctx: BotContext): string | null {
  if (ctx.message?.document !== undefined) return '/ipv';
  const text = ctx.message?.text;
  if (text?.startsWith('/') === true) return text.split(/\s+/)[0] ?? null;
  const data = ctx.callbackQuery?.data;
  if (data?.startsWith(`${CALLBACK.MENU}:`) === true)
    return `/${data.slice(CALLBACK.MENU.length + 1)}`;
  // Elegir producto completa /fila o /producto: exige el mismo permiso.
  if (data?.startsWith(`${CALLBACK.PRODUCT}:`) === true) return '/producto';
  return null;
}

function actorOf(ctx: BotContext): Actor {
  const user = ctx.kiloUser;
  if (user === undefined) throw new Error('Update sin usuario autorizado (falta el middleware).');
  return { telegramId: user.telegramId, role: user.role };
}

/** Texto del argumento de un comando o de un pie de archivo: `/ipv 3oct` → `3oct`. */
function argumentOf(text: string | undefined): string {
  return (text ?? '').replace(/^\/\S+\s*/, '').trim();
}

/** `780`, `780.5`, `1,050` (miles) o `780,5` (decimal). */
export function parseTcValue(raw: string): number | null {
  const value = raw.trim();
  if (value === '') return null;
  const normalized = /^\d{1,3}(,\d{3})+$/.test(value)
    ? value.replace(/,/g, '')
    : value.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

interface UploadedIpv {
  telegramId: number;
  source: IpvSource;
}

interface AwaitingReason {
  pendingId: string;
}

interface ProductChoice {
  telegramId: number;
  request: ProductRequest;
  options: string[];
}

export function createBot(deps: BotDeps, options: CreateBotOptions): Bot<BotContext> {
  const bot = new Bot<BotContext>(
    options.token,
    options.botInfo === undefined ? {} : { botInfo: options.botInfo },
  );
  const clock = deps.pipeline.clock;
  const uploads = new TtlStore<UploadedIpv>(CONVERSATION_TTL_MS, clock);
  const awaitingReason = new TtlStore<AwaitingReason>(CONVERSATION_TTL_MS, clock);
  const productChoices = new TtlStore<ProductChoice>(CONVERSATION_TTL_MS, clock);
  const download = deps.downloadFile ?? telegramFileDownloader(bot.api, options.token);

  // ------------------------------------------------------------ permisos
  bot.use(async (ctx: BotContext, next: NextFunction) => {
    const from = ctx.from;
    if (from === undefined || from.is_bot) return;
    const result = authorize(deps.auth, {
      telegramId: from.id,
      username: from.username ?? null,
      command: commandOf(ctx),
    });
    if (result.status === AUTH_STATUS.ALLOWED) {
      ctx.kiloUser = result.user;
      await next();
      return;
    }
    if (ctx.callbackQuery !== undefined) {
      await ctx.answerCallbackQuery({ text: result.message, show_alert: true });
      return;
    }
    await ctx.reply(result.message);
  });

  // ------------------------------------------------------------ helpers
  async function showPrepared(ctx: BotContext, result: PrepareResult): Promise<void> {
    switch (result.status) {
      case PREPARE_STATUS.READY:
        await replyLong(
          ctx,
          result.preview,
          confirmKeyboard(result.pendingId, result.requiresForce),
        );
        return;
      case PREPARE_STATUS.BLOCKED:
        await replyLong(ctx, result.preview);
        return;
      case PREPARE_STATUS.REJECTED:
        await ctx.reply(result.message);
        return;
    }
  }

  async function loadDay(ctx: BotContext, source: IpvSource, ref: DayRef): Promise<void> {
    const ipv = source.readDay(ref);
    await showPrepared(ctx, await prepareIpvLoad(deps.pipeline, actorOf(ctx), { ipv, tc: null }));
  }

  async function removeKeyboard(ctx: BotContext): Promise<void> {
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    } catch {
      // El mensaje pudo borrarse o ya no tener botones: no es un error del usuario.
    }
  }

  async function validate(ctx: BotContext, args: string): Promise<void> {
    const request = parseValidateArgs(args);
    const text = await runValidation(deps.cuadre, request, {
      hasFixedExpenses: deps.settings.get(SETTING.HAS_FIXED_EXPENSES) === true,
      showFinancials: can(actorOf(ctx).role, PERMISSION.VIEW_FINANCIALS),
    });
    await replyLong(ctx, text);
  }

  async function help(ctx: BotContext): Promise<void> {
    const role = actorOf(ctx).role;
    await ctx.reply(helpText(role), { reply_markup: menuKeyboard(menuCommandsFor(role)) });
  }

  // Las equivalencias se leen en cada reporte: cambian con /equivalencia.
  function reportDeps(): ReportDeps {
    return {
      cuadre: deps.cuadre,
      aliases: buildAliasIndex(deps.pipeline.catalog.equivalences()),
      hasFixedExpenses: deps.settings.get(SETTING.HAS_FIXED_EXPENSES) === true,
    };
  }

  async function showReport(ctx: BotContext, result: ReportResult): Promise<void> {
    if (result.kind === REPORT_KIND.TEXT) {
      await replyHtml(ctx, result.messages);
      return;
    }
    const choiceId = productChoices.add({
      telegramId: actorOf(ctx).telegramId,
      request: result.request,
      options: result.options,
    });
    await ctx.reply(result.prompt, {
      reply_markup: productChoiceKeyboard(choiceId, result.options),
    });
  }

  const todayTab = () => dayTab(todayIn(clock(), deps.timezone));

  // ------------------------------------------------------------ IPV (documento)
  // Va antes que los comandos: un documento siempre es un IPV, tenga o no "/ipv" en el pie.
  bot.on('message:document', async (ctx) => {
    const document = ctx.message.document;
    const name = document.file_name ?? '';
    if (!name.toLowerCase().endsWith('.xlsx')) {
      await ctx.reply(BOT_TEXT.NOT_XLSX);
      return;
    }
    if ((document.file_size ?? 0) > MAX_FILE_BYTES) {
      await ctx.reply(BOT_TEXT.FILE_TOO_BIG);
      return;
    }

    const arg = parseDayArg(argumentOf(ctx.message.caption));
    if (arg === undefined) {
      await ctx.reply('No entiendo el día del pie del archivo. Usa, por ejemplo, 3oct o 03.');
      return;
    }
    let source: IpvSource;
    try {
      source = await ExcelIpvSource.fromBuffer(await download(document.file_id));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.reply(`No pude leer el archivo como IPV: ${reason}`);
      return;
    }

    const intake = resolveIpvDay(source.listDays(), arg);
    switch (intake.status) {
      case INTAKE_STATUS.ERROR:
        await ctx.reply(intake.message);
        return;
      case INTAKE_STATUS.DAY:
        await loadDay(ctx, source, intake.ref);
        return;
      case INTAKE_STATUS.CHOOSE: {
        const uploadId = uploads.add({ telegramId: actorOf(ctx).telegramId, source });
        await ctx.reply('¿Qué día del IPV cargo?', {
          reply_markup: dayChoiceKeyboard(uploadId, intake.options),
        });
        return;
      }
    }
  });

  // ------------------------------------------------------------ comandos
  bot.command(['start', 'ayuda'], help);

  bot.command('ipv', async (ctx) => {
    await ctx.reply(ctx.match.trim() === '' ? BOT_TEXT.ASK_IPV_FILE : BOT_TEXT.NO_DRIVE);
  });

  bot.command('validar', async (ctx) => {
    await validate(ctx, ctx.match);
  });

  bot.command('tc', async (ctx) => {
    const [rawValue = '', rawTab = ''] = ctx.match.trim().split(/\s+/);
    const tc = parseTcValue(rawValue);
    const tab =
      rawTab === ''
        ? dayTab(todayIn(clock(), deps.timezone))
        : /^\d{1,2}$/.test(rawTab)
          ? rawTab.padStart(2, '0')
          : null;
    if (tc === null || tab === null) {
      await ctx.reply(BOT_TEXT.TC_USAGE);
      return;
    }
    await showPrepared(ctx, await prepareSetTc(deps.pipeline, actorOf(ctx), { tab, tc }));
  });

  bot.command('deshacer', async (ctx) => {
    await showPrepared(ctx, prepareUndo(deps.pipeline, actorOf(ctx)));
  });

  bot.command('cancelar', async (ctx) => {
    awaitingReason.delete(String(actorOf(ctx).telegramId));
    await ctx.reply(BOT_TEXT.REASON_CANCELLED);
  });

  // ------------------------------------------------------------ reportes
  const reports: Readonly<Record<string, (args: string) => Promise<ReportResult>>> = {
    hoy: () => todayReport(reportDeps(), todayTab()),
    dia: (args) => dayReport(reportDeps(), args),
    semana: () => weekReport(reportDeps()),
    mes: () => monthReport(reportDeps()),
    rango: (args) => rangeReport(reportDeps(), args),
    gastos: (args) => expensesReport(reportDeps(), args),
    inversion: (args) => inventoryReport(reportDeps(), args),
    ganancia: () => profitReport(reportDeps()),
    top: (args) => topReport(reportDeps(), args),
    margen: (args) => marginsReport(reportDeps(), args),
    fila: (args) => rowReport(reportDeps(), args),
    producto: (args) => productReport(reportDeps(), args),
  };
  for (const [command, run] of Object.entries(reports)) {
    bot.command(command, async (ctx) => {
      await showReport(ctx, await run(ctx.match));
    });
  }

  // ------------------------------------------------------------ botones
  bot.callbackQuery(new RegExp(`^${CALLBACK.CONFIRM}:(.+)$`), async (ctx) => {
    const pendingId = ctx.match[1] ?? '';
    const result = await confirmPending(deps.pipeline, actorOf(ctx), { pendingId });
    await ctx.answerCallbackQuery();
    // Con bloqueos la acción sigue pendiente: se dejan los botones.
    if (result.status !== CONFIRM_STATUS.BLOCKED) await removeKeyboard(ctx);
    await ctx.reply(result.message);
  });

  bot.callbackQuery(new RegExp(`^${CALLBACK.CANCEL}:(.+)$`), async (ctx) => {
    const actor = actorOf(ctx);
    awaitingReason.delete(String(actor.telegramId));
    const result = cancelPending(deps.pipeline, actor, ctx.match[1] ?? '');
    await ctx.answerCallbackQuery();
    if (result.status === CONFIRM_STATUS.DONE) await removeKeyboard(ctx);
    await ctx.reply(result.message);
  });

  bot.callbackQuery(new RegExp(`^${CALLBACK.FORCE}:(.+)$`), async (ctx) => {
    const actor = actorOf(ctx);
    if (!can(actor.role, PERMISSION.FORCE_CONFIRM)) {
      await ctx.answerCallbackQuery({ text: BOT_TEXT.ONLY_OWNER_FORCE, show_alert: true });
      return;
    }
    awaitingReason.set(String(actor.telegramId), { pendingId: ctx.match[1] ?? '' });
    await ctx.answerCallbackQuery();
    await ctx.reply(BOT_TEXT.ASK_REASON);
  });

  bot.callbackQuery(
    new RegExp(`^${CALLBACK.IPV_DAY}:([^:]+):(\\d{1,2})-(\\d{1,2})$`),
    async (ctx) => {
      const actor = actorOf(ctx);
      const upload = uploads.get(ctx.match[1] ?? '');
      await ctx.answerCallbackQuery();
      if (upload?.telegramId !== actor.telegramId) {
        await ctx.reply(BOT_TEXT.UPLOAD_EXPIRED);
        return;
      }
      await removeKeyboard(ctx);
      await loadDay(ctx, upload.source, { day: Number(ctx.match[2]), month: Number(ctx.match[3]) });
    },
  );

  bot.callbackQuery(new RegExp(`^${CALLBACK.PRODUCT}:([^:]+):(\\d+)$`), async (ctx) => {
    const actor = actorOf(ctx);
    const choice = productChoices.get(ctx.match[1] ?? '');
    const product = choice?.options[Number(ctx.match[2])];
    await ctx.answerCallbackQuery();
    if (choice?.telegramId !== actor.telegramId || product === undefined) {
      await ctx.reply(BOT_TEXT.CHOICE_EXPIRED);
      return;
    }
    await removeKeyboard(ctx);
    await showReport(ctx, await completeProductRequest(reportDeps(), choice.request, product));
  });

  bot.callbackQuery(new RegExp(`^${CALLBACK.MENU}:(\\w+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const command = ctx.match[1] ?? '';
    const report = Object.hasOwn(reports, command) ? reports[command] : undefined;
    if (report !== undefined) {
      await showReport(ctx, await report(''));
      return;
    }
    switch (command) {
      case 'ipv':
        await ctx.reply(BOT_TEXT.ASK_IPV_FILE);
        return;
      case 'validar':
        await validate(ctx, '');
        return;
      case 'tc':
        await ctx.reply(BOT_TEXT.TC_USAGE);
        return;
      case 'deshacer':
        await showPrepared(ctx, prepareUndo(deps.pipeline, actorOf(ctx)));
        return;
      default:
        await help(ctx);
    }
  });

  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Ese botón ya no es válido.' });
  });

  // ------------------------------------------------------------ texto libre
  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply(BOT_TEXT.UNKNOWN_COMMAND);
      return;
    }
    const actor = actorOf(ctx);
    const key = String(actor.telegramId);
    const waiting = awaitingReason.get(key);
    if (waiting !== undefined) {
      const result = await confirmPending(deps.pipeline, actor, {
        pendingId: waiting.pendingId,
        forceReason: ctx.message.text,
      });
      if (result.status !== CONFIRM_STATUS.REASON_REQUIRED) awaitingReason.delete(key);
      await ctx.reply(result.message);
      return;
    }
    await ctx.reply(FREE_TEXT_REPLY, { reply_markup: menuKeyboard(menuCommandsFor(actor.role)) });
  });

  // ------------------------------------------------------------ errores
  bot.catch(async (err) => {
    const error = err.error;
    if (error instanceof GrammyError)
      console.error('Error de la API de Telegram:', error.description);
    else if (error instanceof HttpError) console.error('No se pudo contactar a Telegram:', error);
    else console.error('Error procesando un mensaje:', error);
    try {
      await err.ctx.reply(BOT_TEXT.GENERIC_ERROR);
    } catch {
      // Si tampoco se puede responder, queda solo el log.
    }
  });

  return bot;
}
