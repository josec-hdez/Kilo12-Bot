import { Bot, GrammyError, HttpError, InlineKeyboard, type NextFunction } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { AUTH_STATUS, authorize, type AuthDeps } from '../../app/authorize.js';
import { cancelPending, confirmPending } from '../../app/confirm.js';
import { FREE_TEXT_REPLY, helpText } from '../../app/help.js';
import { INTAKE_STATUS, parseDayArg, resolveIpvDay } from '../../app/ipv-intake.js';
import { BUTTON_FLOW, buttonForText, type MenuButton } from '../../app/keyboard-menu.js';
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
  monthDays,
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
import { esc } from '../../app/report-format.js';
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
import { syncUserCommandMenu } from './command-menu.js';
import {
  CALLBACK,
  confirmKeyboard,
  dayButtons,
  dayChoiceKeyboard,
  productChoiceKeyboard,
  replyKeyboard,
  topMetricButtons,
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
/** Telegram muestra "escribiendo…" unos 5 s: se repite antes de que se apague. */
const TYPING_EVERY_MS = 4_000;

/** Lo que se muestra al instante mientras se calcula cada reporte. */
const REPORT_PLACEHOLDER: Readonly<Record<string, string>> = {
  hoy: '⏳ Calculando el día de hoy…',
  dia: '⏳ Calculando el día…',
  semana: '⏳ Calculando los últimos 7 días…',
  mes: '⏳ Calculando el mes…',
  rango: '⏳ Calculando el rango…',
  gastos: '⏳ Sumando los gastos…',
  inversion: '⏳ Calculando la inversión…',
  ganancia: '⏳ Calculando la ganancia acumulada…',
  top: '⏳ Armando el ranking…',
  margen: '⏳ Calculando los márgenes…',
  fila: '⏳ Buscando la fila…',
  producto: '⏳ Sumando el producto en todas las hojas…',
};
const DEFAULT_PLACEHOLDER = '⏳ Calculando…';

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
  REPORT_ERROR: '⚠️ No pude generar el reporte',
  ASK_DAY: '📍 ¿Qué día?',
  ASK_FROM: '↔️ ¿Desde qué día?',
  ASK_TO: '↔️ ¿Hasta qué día?',
  ASK_PRODUCT: '🔍 ¿Qué producto? Escribe el nombre, por ejemplo: pollo. /cancelar para salir.',
  ASK_ROW_PRODUCT: '📄 ¿Qué producto? Escribe el nombre, por ejemplo: pollo. /cancelar para salir.',
  ASK_TOP: '🏆 ¿Ordenar por?',
  ASK_TC_VALUE:
    '💱 ¿Cuál es la TC de hoy? Escribe solo el número, por ejemplo: 780. /cancelar para salir.',
  TC_NOT_NUMBER: 'Escribe solo el número de la TC, por ejemplo: 780. /cancelar para salir.',
  CHOOSE_DAY_ABOVE: 'Elige el día con los botones de arriba, o /cancelar.',
  NO_DAYS: 'Todavía no hay días en el cuadre.',
  FLOW_CANCELLED: 'Listo, cancelado.',
  NOTHING_TO_CANCEL: 'No había nada en curso.',
  FLOW_EXPIRED: 'Esa pregunta ya venció (15 minutos). Toca el botón otra vez.',
} as const;

/** "📄 pollo: ¿qué día?" */
export function rowDayPrompt(product: string): string {
  return `📄 ${product}: ¿qué día?`;
}

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

/**
 * Muestra "escribiendo…" en el chat hasta que termina `work`: los reportes y las
 * lecturas de la hoja tardan unos segundos y sin esto parece que el bot no hace nada.
 */
export async function withTyping<T>(ctx: BotContext, work: () => Promise<T>): Promise<T> {
  const send = () => {
    // Si falla el aviso, el trabajo sigue: es solo una señal visual.
    ctx.replyWithChatAction('typing').catch(() => undefined);
  };
  send();
  const handle = setInterval(send, TYPING_EVERY_MS);
  try {
    return await work();
  } finally {
    clearInterval(handle);
  }
}

/** Reemplaza el texto del mensaje "⏳ Calculando…" por el primer mensaje del resultado. */
type EditPlaceholder = (text: string, keyboard?: InlineKeyboard) => Promise<void>;

async function replyLong(ctx: BotContext, text: string, keyboard?: InlineKeyboard): Promise<void> {
  const chunks = splitMessage(text);
  for (const [index, chunk] of chunks.entries()) {
    const last = index === chunks.length - 1;
    await ctx.reply(chunk, last && keyboard !== undefined ? { reply_markup: keyboard } : {});
  }
}

/** Botones de los flujos guiados → comando cuyo permiso exigen. */
const FLOW_CALLBACK_COMMAND: Readonly<Record<string, string>> = {
  [CALLBACK.FLOW_DAY]: '/dia',
  [CALLBACK.FLOW_FROM]: '/rango',
  [CALLBACK.FLOW_TO]: '/rango',
  [CALLBACK.FLOW_ROW_DAY]: '/fila',
  [CALLBACK.FLOW_TOP]: '/top',
  // Elegir producto completa /fila o /producto: exige el mismo permiso.
  [CALLBACK.PRODUCT]: '/producto',
};

/**
 * Comando que el middleware de permisos debe revisar para este update. Un botón del
 * teclado fijo y la respuesta a una pregunta de un flujo guiado cuentan como su comando.
 */
function commandOf(
  ctx: BotContext,
  flowCommand: (telegramId: number) => string | undefined,
): string | null {
  if (ctx.message?.document !== undefined) return '/ipv';
  const text = ctx.message?.text;
  if (text?.startsWith('/') === true) return text.split(/\s+/)[0] ?? null;
  if (text !== undefined) {
    const button = buttonForText(text);
    if (button !== undefined) return `/${button.command}`;
    const pending = ctx.from === undefined ? undefined : flowCommand(ctx.from.id);
    return pending === undefined ? null : `/${pending}`;
  }
  const data = ctx.callbackQuery?.data;
  if (data === undefined) return null;
  const prefix = data.split(':')[0] ?? '';
  if (prefix === CALLBACK.MENU) return `/${data.slice(CALLBACK.MENU.length + 1)}`;
  return Object.hasOwn(FLOW_CALLBACK_COMMAND, prefix)
    ? (FLOW_CALLBACK_COMMAND[prefix] ?? null)
    : null;
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

/** Paso de un flujo guiado del teclado que espera algo del usuario. */
const FLOW_STEP = {
  /** 🔍 Producto: espera el nombre. */
  PRODUCT: 'product',
  /** 📄 Fila: espera el nombre del producto. */
  ROW_PRODUCT: 'row_product',
  /** 📄 Fila: ya tiene el producto, espera el día (botones). */
  ROW_DAY: 'row_day',
  /** 💱 TC: espera el número. */
  TC: 'tc',
} as const;

type FlowStep = (typeof FLOW_STEP)[keyof typeof FLOW_STEP];

interface GuidedFlow {
  step: FlowStep;
  /** Comando cuyo permiso se exige al responder. */
  command: string;
  /** Producto elegido en 📄 Fila. */
  product?: string;
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
  /** Flujo guiado en curso, por usuario: cada uno responde solo a sus preguntas. */
  const flows = new TtlStore<GuidedFlow>(CONVERSATION_TTL_MS, clock);
  const flowCommand = (telegramId: number) => flows.get(String(telegramId))?.command;
  const download = deps.downloadFile ?? telegramFileDownloader(bot.api, options.token);

  // ------------------------------------------------------------ permisos
  bot.use(async (ctx: BotContext, next: NextFunction) => {
    const from = ctx.from;
    if (from === undefined || from.is_bot) return;
    const result = authorize(deps.auth, {
      telegramId: from.id,
      username: from.username ?? null,
      command: commandOf(ctx, flowCommand),
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
    const prepared = await withTyping(ctx, () =>
      prepareIpvLoad(deps.pipeline, actorOf(ctx), { ipv, tc: null }),
    );
    await showPrepared(ctx, prepared);
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
    const text = await withTyping(ctx, () =>
      runValidation(deps.cuadre, request, {
        hasFixedExpenses: deps.settings.get(SETTING.HAS_FIXED_EXPENSES) === true,
        showFinancials: can(actorOf(ctx).role, PERMISSION.VIEW_FINANCIALS),
      }),
    );
    await replyLong(ctx, text);
  }

  /** /ayuda (y /start): la lista del rol y el teclado fijo de botones. */
  async function help(ctx: BotContext): Promise<void> {
    const role = actorOf(ctx).role;
    await ctx.reply(helpText(role), { reply_markup: replyKeyboard(role) });
  }

  /** Días del cuadre para los botones de los flujos guiados. */
  async function dayTabs(): Promise<string[]> {
    return monthDays((await deps.cuadre.listDays()).map((day) => day.trim()));
  }

  // Las equivalencias se leen en cada reporte: cambian con /equivalencia.
  function reportDeps(): ReportDeps {
    return {
      cuadre: deps.cuadre,
      aliases: buildAliasIndex(deps.pipeline.catalog.equivalences()),
      hasFixedExpenses: deps.settings.get(SETTING.HAS_FIXED_EXPENSES) === true,
    };
  }

  /**
   * Muestra el resultado de un reporte. Si hay un mensaje "⏳ Calculando…", el primer
   * mensaje lo reemplaza y los demás llegan como mensajes nuevos.
   */
  async function showReport(
    ctx: BotContext,
    result: ReportResult,
    editPlaceholder?: EditPlaceholder,
  ): Promise<void> {
    if (result.kind === REPORT_KIND.TEXT) {
      const [first, ...rest] = result.messages;
      if (first !== undefined) {
        if (editPlaceholder === undefined) await ctx.reply(first, { parse_mode: 'HTML' });
        else await editPlaceholder(first);
      }
      for (const message of rest) await ctx.reply(message, { parse_mode: 'HTML' });
      return;
    }
    const choiceId = productChoices.add({
      telegramId: actorOf(ctx).telegramId,
      request: result.request,
      options: result.options,
    });
    const keyboard = productChoiceKeyboard(choiceId, result.options);
    if (editPlaceholder === undefined) await ctx.reply(result.prompt, { reply_markup: keyboard });
    else await editPlaceholder(esc(result.prompt), keyboard);
  }

  /**
   * Envía "⏳ Calculando…" al instante, muestra "escribiendo…" mientras se calcula y
   * después reemplaza ese mensaje por el reporte (o por el error).
   */
  async function runReport(
    ctx: BotContext,
    command: string,
    run: () => Promise<ReportResult>,
  ): Promise<void> {
    const placeholder = await ctx.reply(REPORT_PLACEHOLDER[command] ?? DEFAULT_PLACEHOLDER);
    const edit: EditPlaceholder = async (text, keyboard) => {
      await ctx.api.editMessageText(placeholder.chat.id, placeholder.message_id, text, {
        parse_mode: 'HTML',
        ...(keyboard === undefined ? {} : { reply_markup: keyboard }),
      });
    };
    let result: ReportResult;
    try {
      result = await withTyping(ctx, run);
    } catch (error) {
      console.error(`Error generando /${command}:`, error);
      const reason = error instanceof Error ? error.message : String(error);
      await edit(esc(`${BOT_TEXT.REPORT_ERROR}: ${reason}`));
      return;
    }
    await showReport(ctx, result, edit);
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
      source = await withTyping(ctx, async () =>
        ExcelIpvSource.fromBuffer(await download(document.file_id)),
      );
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

  // ------------------------------------------------------------ comandos
  async function setTc(ctx: BotContext, args: string): Promise<void> {
    const [rawValue = '', rawTab = ''] = args.trim().split(/\s+/);
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
  }

  async function cancel(ctx: BotContext): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    const hadReason = awaitingReason.get(key) !== undefined;
    const hadFlow = flows.get(key) !== undefined;
    awaitingReason.delete(key);
    flows.delete(key);
    if (hadReason) await ctx.reply(BOT_TEXT.REASON_CANCELLED);
    else if (hadFlow) await ctx.reply(BOT_TEXT.FLOW_CANCELLED);
    else await ctx.reply(BOT_TEXT.NOTHING_TO_CANCEL);
  }

  /**
   * Un solo punto de entrada por comando: lo usan los comandos escritos, los botones
   * del teclado y los del menú en línea de versiones anteriores.
   */
  async function runCommand(ctx: BotContext, command: string, args: string): Promise<void> {
    const report = Object.hasOwn(reports, command) ? reports[command] : undefined;
    if (report !== undefined) {
      await runReport(ctx, command, () => report(args));
      return;
    }
    switch (command) {
      case 'ipv':
        await ctx.reply(args.trim() === '' ? BOT_TEXT.ASK_IPV_FILE : BOT_TEXT.NO_DRIVE);
        return;
      case 'validar':
        await validate(ctx, args);
        return;
      case 'tc':
        await setTc(ctx, args);
        return;
      case 'deshacer':
        await showPrepared(ctx, prepareUndo(deps.pipeline, actorOf(ctx)));
        return;
      case 'cancelar':
        await cancel(ctx);
        return;
      default:
        await help(ctx);
    }
  }

  bot.command('start', async (ctx) => {
    // Al abrir el bot (o después de que lo agreguen) se le publica su menú "/".
    const user = ctx.kiloUser;
    if (user !== undefined) void syncUserCommandMenu(ctx.api, user).catch(() => undefined);
    await help(ctx);
  });
  for (const command of [
    'ayuda',
    'ipv',
    'validar',
    'tc',
    'deshacer',
    'cancelar',
    ...Object.keys(reports),
  ]) {
    bot.command(command, async (ctx) => {
      await runCommand(ctx, command, ctx.match);
    });
  }

  // ------------------------------------------------------------ teclado fijo
  /** Un botón del teclado: lo ejecuta o abre su pregunta. Reemplaza cualquier flujo previo. */
  async function pressButton(ctx: BotContext, button: MenuButton): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    flows.delete(key);
    switch (button.flow) {
      case BUTTON_FLOW.RUN:
        await runCommand(ctx, button.command, '');
        return;
      case BUTTON_FLOW.ASK_IPV:
        await ctx.reply(BOT_TEXT.ASK_IPV_FILE);
        return;
      case BUTTON_FLOW.ASK_TC:
        flows.set(key, { step: FLOW_STEP.TC, command: button.command });
        await ctx.reply(BOT_TEXT.ASK_TC_VALUE);
        return;
      case BUTTON_FLOW.ASK_PRODUCT:
        flows.set(key, { step: FLOW_STEP.PRODUCT, command: button.command });
        await ctx.reply(BOT_TEXT.ASK_PRODUCT);
        return;
      case BUTTON_FLOW.ASK_ROW:
        flows.set(key, { step: FLOW_STEP.ROW_PRODUCT, command: button.command });
        await ctx.reply(BOT_TEXT.ASK_ROW_PRODUCT);
        return;
      case BUTTON_FLOW.ASK_TOP_METRIC:
        await ctx.reply(BOT_TEXT.ASK_TOP, { reply_markup: topMetricButtons() });
        return;
      case BUTTON_FLOW.ASK_DAY:
      case BUTTON_FLOW.ASK_RANGE: {
        const days = await withTyping(ctx, dayTabs);
        if (days.length === 0) {
          await ctx.reply(BOT_TEXT.NO_DAYS);
          return;
        }
        const ask = button.flow === BUTTON_FLOW.ASK_DAY;
        await ctx.reply(ask ? BOT_TEXT.ASK_DAY : BOT_TEXT.ASK_FROM, {
          reply_markup: dayButtons(ask ? CALLBACK.FLOW_DAY : CALLBACK.FLOW_FROM, days),
        });
        return;
      }
    }
  }

  /** Respuesta escrita a la pregunta de un flujo guiado. */
  async function answerFlow(ctx: BotContext, flow: GuidedFlow, answer: string): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    switch (flow.step) {
      case FLOW_STEP.PRODUCT:
        flows.delete(key);
        await runCommand(ctx, 'producto', answer);
        return;
      case FLOW_STEP.ROW_PRODUCT: {
        const days = await withTyping(ctx, dayTabs);
        if (days.length === 0) {
          flows.delete(key);
          await ctx.reply(BOT_TEXT.NO_DAYS);
          return;
        }
        flows.set(key, { step: FLOW_STEP.ROW_DAY, command: flow.command, product: answer });
        await ctx.reply(rowDayPrompt(answer), {
          reply_markup: dayButtons(CALLBACK.FLOW_ROW_DAY, days),
        });
        return;
      }
      case FLOW_STEP.ROW_DAY:
        await ctx.reply(BOT_TEXT.CHOOSE_DAY_ABOVE);
        return;
      case FLOW_STEP.TC: {
        const tc = parseTcValue(answer);
        if (tc === null) {
          await ctx.reply(BOT_TEXT.TC_NOT_NUMBER);
          return;
        }
        flows.delete(key);
        await setTc(ctx, String(tc));
        return;
      }
    }
  }

  // ------------------------------------------------------------ botones en línea
  bot.callbackQuery(new RegExp(`^${CALLBACK.CONFIRM}:(.+)$`), async (ctx) => {
    const pendingId = ctx.match[1] ?? '';
    // Confirmar escribe en la hoja: puede tardar unos segundos.
    const result = await withTyping(ctx, () =>
      confirmPending(deps.pipeline, actorOf(ctx), { pendingId }),
    );
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
    await runReport(ctx, choice.request.command, () =>
      completeProductRequest(reportDeps(), choice.request, product),
    );
  });

  // 📍 Día → /dia DD
  bot.callbackQuery(new RegExp(`^${CALLBACK.FLOW_DAY}:(\\S+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeKeyboard(ctx);
    await runCommand(ctx, 'dia', ctx.match[1] ?? '');
  });

  // ↔️ Rango, primer paso: "¿Hasta?" con los días desde el elegido.
  bot.callbackQuery(new RegExp(`^${CALLBACK.FLOW_FROM}:(\\S+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeKeyboard(ctx);
    const from = ctx.match[1] ?? '';
    const days = await dayTabs();
    const start = days.indexOf(from);
    if (start < 0) {
      await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
      return;
    }
    await ctx.reply(BOT_TEXT.ASK_TO, {
      reply_markup: dayButtons(`${CALLBACK.FLOW_TO}:${from}`, days.slice(start)),
    });
  });

  // ↔️ Rango, segundo paso → /rango DD DD
  bot.callbackQuery(new RegExp(`^${CALLBACK.FLOW_TO}:([^:]+):(\\S+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeKeyboard(ctx);
    await runCommand(ctx, 'rango', `${ctx.match[1] ?? ''} ${ctx.match[2] ?? ''}`);
  });

  // 📄 Fila, día elegido → /fila <producto> DD
  bot.callbackQuery(new RegExp(`^${CALLBACK.FLOW_ROW_DAY}:(\\S+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = String(actorOf(ctx).telegramId);
    const flow = flows.get(key);
    if (flow?.step !== FLOW_STEP.ROW_DAY || flow.product === undefined) {
      await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
      return;
    }
    flows.delete(key);
    await removeKeyboard(ctx);
    await runCommand(ctx, 'fila', `${flow.product} ${ctx.match[1] ?? ''}`);
  });

  // 🏆 Top → /top <métrica>
  bot.callbackQuery(new RegExp(`^${CALLBACK.FLOW_TOP}:(\\w+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeKeyboard(ctx);
    await runCommand(ctx, 'top', ctx.match[1] ?? '');
  });

  // Menú en línea de versiones anteriores: sigue funcionando desde el historial del chat.
  bot.callbackQuery(new RegExp(`^${CALLBACK.MENU}:(\\w+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const command = ctx.match[1] ?? '';
    await runCommand(ctx, command, '');
  });

  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Ese botón ya no es válido.' });
  });

  // ------------------------------------------------------------ texto
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) {
      await ctx.reply(BOT_TEXT.UNKNOWN_COMMAND);
      return;
    }
    // Los botones del teclado ganan siempre: tocar uno nunca se toma como respuesta.
    const button = buttonForText(text);
    if (button !== undefined) {
      await pressButton(ctx, button);
      return;
    }
    const actor = actorOf(ctx);
    const key = String(actor.telegramId);
    const waiting = awaitingReason.get(key);
    if (waiting !== undefined) {
      const result = await withTyping(ctx, () =>
        confirmPending(deps.pipeline, actor, {
          pendingId: waiting.pendingId,
          forceReason: text,
        }),
      );
      if (result.status !== CONFIRM_STATUS.REASON_REQUIRED) awaitingReason.delete(key);
      await ctx.reply(result.message);
      return;
    }
    const flow = flows.get(key);
    if (flow !== undefined) {
      await answerFlow(ctx, flow, text.trim());
      return;
    }
    await ctx.reply(FREE_TEXT_REPLY, { reply_markup: replyKeyboard(actor.role) });
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
