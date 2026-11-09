import { Bot, GrammyError, HttpError, InlineKeyboard, type NextFunction } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { AUTH_STATUS, authorize, type AuthDeps } from '../../app/authorize.js';
import {
  CLOSE_REQUEST,
  confirmMonthClose,
  parseCloseArgs,
  reopenMonthClose,
  reviewMonthClose,
  type CloseMonthDeps,
  type CloseReview,
} from '../../app/close-month.js';
import { cancelPending, confirmPending } from '../../app/confirm.js';
import { monthReader } from '../../app/cuadre-books.js';
import {
  ALIAS_PREPARE,
  applyAliasChange,
  EQUIVALENCE_REQUEST,
  equivalenceListPages,
  knownCuadreProducts,
  parseEquivalenceArgs,
  prepareAddAlias,
  prepareRemoveAlias,
  saveIpvAlias,
  saveNewProduct,
  type AliasChange,
  type EquivalenceDeps,
} from '../../app/manage-equivalences.js';
import { FREE_TEXT_REPLY, helpText } from '../../app/help.js';
import {
  askSheetDay,
  dayOfOtherMonth,
  isDayOfOtherMonth,
  notFoundText,
  parseDayAnswer,
  resolveCaptionSheet,
  resolveSheetAnswer,
  SHEET_ANSWER,
  sheetQuestion,
  suggestionQuestion,
} from '../../app/ipv-intake.js';
import {
  BUTTON_FLOW,
  buttonForText,
  MENU_BUTTONS,
  normalizeLabel,
  type MenuButton,
} from '../../app/keyboard-menu.js';
import {
  askMonthForCommand,
  askTcValueAndDay,
  availableMonths,
  MONTH_PICK_TEXT,
  monthHeader,
  monthHeaderPlain,
  needsMonth,
  tcDayRequired,
  type AvailableMonthsOptions,
} from '../../app/month-pick.js';
import { dayTab, prepareIpvLoad } from '../../app/load-ipv.js';
import {
  CONFIRM_STATUS,
  PREPARE_STATUS,
  type Actor,
  type AliasQuestion,
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
  topReport,
  weekReport,
  type ProductRequest,
  type ReportDeps,
  type ReportResult,
} from '../../app/reports.js';
import { esc } from '../../app/report-format.js';
import {
  answerExpense,
  chooseCurrency,
  chooseOtherDay,
  chooseToday,
  completeExpense,
  datePrompt,
  EXPENSE_STEP,
  EXPENSE_TEXT,
  expensePreview,
  RECORD_STATUS,
  recordExpense,
  startExpense,
  type ExpenseDraft,
} from '../../app/record-expense.js';
import {
  BOOK_PREPARE,
  bookListText,
  confirmBookRegistration,
  prepareBookRegistration,
  type BookInspector,
  type BookRegistration,
} from '../../app/register-book.js';
import { prepareSetTc } from '../../app/set-tc.js';
import { todayDateIn, todayIn } from '../../app/today.js';
import { prepareUndo } from '../../app/undo.js';
import { parseValidateArgs, runValidation } from '../../app/validate-report.js';
import { can, canRunCommand, commandName, PERMISSION } from '../../core/auth.js';
import { parseExpenseCurrency } from '../../core/expense.js';
import { buildAliasIndex } from '../../core/mapping.js';
import type { MonthClose } from '../../core/month-close.js';
import { monthName, monthOfDate, monthOfRef, type MonthKey } from '../../core/months.js';
import { SETTING } from '../../core/settings.js';
import type { DayRef, IpvDay } from '../../core/types.js';
import type { IpvSource } from '../../ports/ipv-source.js';
import type { CuadreReader } from '../../ports/cuadre-source.js';
import type { ExpenseLog } from '../../ports/expense-log.js';
import type { SettingsRepository } from '../../ports/repositories.js';
import { ExcelIpvSource, IpvFormatError } from '../xlsx/excel-ipv-source.js';
import type { BotContext } from './context.js';
import { telegramFileDownloader, type FileDownloader } from './file-downloader.js';
import { syncUserCommandMenu } from './command-menu.js';
import {
  bookConfirmKeyboard,
  CALLBACK,
  closeMonthKeyboard,
  confirmKeyboard,
  dayButtons,
  equivalenceConfirmKeyboard,
  EXPENSE_ACTION,
  expenseConfirmKeyboard,
  expenseCurrencyKeyboard,
  expenseDateKeyboard,
  flowPrefix,
  IPV_ALIAS_ACTION,
  ipvAliasKeyboard,
  monthButtons,
  productChoiceKeyboard,
  replyKeyboard,
  sheetSuggestionKeyboard,
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
  /** Historial de /gasto (hoja "Gastos"); nunca escribe en el cuadre. */
  expenses: ExpenseLog;
  /** /cuadremes: abre un libro para revisarlo. Sin esto (hoja simulada) no se registran libros. */
  books?: BookAdmin;
  timezone: string;
  /** Descarga de archivos; por defecto, la API de Telegram. */
  downloadFile?: FileDownloader;
}

export interface BookAdmin {
  inspect: BookInspector | null;
  /** Correo de la service account: con quién compartir cada libro nuevo. */
  serviceAccountEmail: string | null;
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
    '📥 Envíame (o reenvíame) el archivo .xlsx del IPV. Si tiene varias hojas, te pregunto cuál analizar (o escribe el nombre de la hoja en el pie del archivo, por ejemplo 3 oct).',
  NO_DRIVE:
    'Todavía no leo el IPV desde Drive (faltan los IDs de la carpeta). Envíame el .xlsx; si tiene varias hojas, te pregunto cuál analizar.',
  NO_SHEETS: 'El archivo no tiene hojas.',
  SHEET_DAY_INVALID:
    'No entiendo ese día. Escribe solo el día del mes elegido (ej. 05), o /cancelar.',
  SUGGESTION_ABOVE: 'Responde Sí o No con los botones de arriba, o /cancelar.',
  NOT_XLSX: 'Solo leo archivos .xlsx del IPV.',
  FILE_TOO_BIG: 'El archivo pasa de 20 MB; Telegram no deja descargarlo.',
  UPLOAD_EXPIRED:
    'Ese archivo ya no está en memoria (pasaron 15 minutos o se reinició el bot). Envíalo de nuevo.',
  ASK_REASON:
    '✍️ Escribe el motivo para confirmar igual; queda en el registro de cambios. /cancelar para no confirmar.',
  REASON_CANCELLED: 'Listo, no se confirmó nada. La acción sigue pendiente 15 minutos.',
  ONLY_OWNER_FORCE: 'Solo una dueña puede confirmar con bloqueos.',
  TC_USAGE:
    'Uso: /tc 780 (día de hoy, en el mes en curso) o /tc 780 03 (pestaña 03 del mes que elijas).',
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
  TC_VALUE_AND_DAY:
    'Escribe el número de la TC y el día, por ejemplo: 780 05. /cancelar para salir.',
  CHOOSE_MONTH_ABOVE: 'Elige el mes con los botones de arriba, o /cancelar.',
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
  // "¿Quisiste decir…?" de la hoja del IPV: sigue siendo cargar el IPV.
  [CALLBACK.IPV_SHEET]: '/ipv',
  // Elegir producto completa /fila o /producto: exige el mismo permiso.
  [CALLBACK.PRODUCT]: '/producto',
  [CALLBACK.EXPENSE]: '/gasto',
  [CALLBACK.BOOK]: '/cuadremes',
  [CALLBACK.CLOSE_MONTH]: '/cierremes',
  [CALLBACK.EQUIVALENCE]: '/equivalencia',
  [CALLBACK.IPV_ALIAS]: '/equivalencia',
};

/**
 * Comandos que ya no existen → comando que los reemplaza. El chat conserva botones
 * `menu:hoy` y teclados viejos: en vez de "Tu rol no permite", se tratan como /ayuda.
 */
const RETIRED_COMMANDS: Readonly<Record<string, string>> = { hoy: 'ayuda' };

/**
 * Botones quitados del teclado fijo que un teclado viejo del cliente todavía puede
 * mandar: se responden con /ayuda, que trae el teclado nuevo.
 */
const RETIRED_LABELS: ReadonlySet<string> = new Set(['📅 Hoy'].map(normalizeLabel));
const RETIRED_LABEL_COMMAND = '/ayuda';

function isRetiredLabel(text: string): boolean {
  return RETIRED_LABELS.has(normalizeLabel(text));
}

/** El comando vigente: el reemplazo si fue retirado, o el mismo. */
function currentCommand(command: string): string {
  const name = commandName(command);
  return Object.hasOwn(RETIRED_COMMANDS, name) ? (RETIRED_COMMANDS[name] ?? name) : name;
}

/**
 * Comando que el middleware de permisos debe revisar para este update. Un botón del
 * teclado fijo y la respuesta a una pregunta de un flujo guiado cuentan como su comando.
 */
function commandOf(
  ctx: BotContext,
  flowCommand: (telegramId: number) => string | undefined,
  pickCommand: (pickId: string) => string | undefined,
): string | null {
  if (ctx.message?.document !== undefined) return '/ipv';
  const text = ctx.message?.text;
  if (text?.startsWith('/') === true) {
    const typed = text.split(/\s+/)[0] ?? '';
    return Object.hasOwn(RETIRED_COMMANDS, commandName(typed))
      ? `/${currentCommand(typed)}`
      : typed;
  }
  if (text !== undefined) {
    if (isRetiredLabel(text)) return RETIRED_LABEL_COMMAND;
    const button = buttonForText(text);
    if (button !== undefined) return `/${button.command}`;
    const pending = ctx.from === undefined ? undefined : flowCommand(ctx.from.id);
    return pending === undefined ? null : `/${pending}`;
  }
  const data = ctx.callbackQuery?.data;
  if (data === undefined) return null;
  const prefix = data.split(':')[0] ?? '';
  if (prefix === CALLBACK.MENU) return `/${currentCommand(data.slice(CALLBACK.MENU.length + 1))}`;
  // El mes elegido exige el permiso del comando que lo pidió (guardado con la pregunta),
  // nunca uno genérico. Sin pregunta guardada: solo la whitelist, y el handler lo rechaza.
  if (prefix === CALLBACK.MONTH_PICK) {
    const command = pickCommand(data.split(':')[1] ?? '');
    return command === undefined ? null : `/${command}`;
  }
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

/** `/tc 780` → valor sin día; `/tc 780 05` → valor y pestaña `05`. */
export interface TcArgs {
  tc: number;
  /** Pestaña escrita (`05`), o null si no se dio día. */
  tab: string | null;
}

/** Sintaxis de /tc: número mayor que 0 y, opcional, el día (1 o 2 cifras). Si no, null. */
export function parseTcArgs(args: string): TcArgs | null {
  const [rawValue = '', rawTab] = args.trim().split(/\s+/);
  const tc = parseTcValue(rawValue);
  if (tc === null || tc <= 0) return null;
  if (rawTab === undefined) return { tc, tab: null };
  return /^\d{1,2}$/.test(rawTab) ? { tc, tab: rawTab.padStart(2, '0') } : null;
}

/** Paso de la elección de la hoja del IPV. */
const IPV_STEP = {
  /** Espera el nombre o el número de la hoja. */
  SHEET: 'sheet',
  /** Propuso una hoja parecida: espera Sí / No. */
  SUGGESTION: 'suggestion',
  /** La hoja no tiene fecha en el nombre: espera que toque el mes (selector). */
  MONTH: 'month',
  /** Hoja sin fecha y mes ya elegido: espera el día del cuadre. */
  DAY: 'day',
} as const;

type IpvStep = (typeof IPV_STEP)[keyof typeof IPV_STEP];

/** IPV subido que espera que su dueño elija la hoja (y el día, si hace falta). */
interface IpvChoice {
  step: IpvStep;
  source: IpvSource;
  sheets: string[];
  /** Hoja propuesta (SUGGESTION) o elegida (MONTH, DAY). */
  sheet?: string;
  /** Mes elegido para una hoja sin fecha (DAY). */
  month?: MonthKey;
}

interface AwaitingReason {
  pendingId: string;
}

/**
 * Productos del IPV sin equivalencia que se le preguntan a la dueña, uno por uno,
 * después de la vista previa. Si elige alguno, la vista previa se rehace.
 */
interface AliasReview {
  source: IpvSource;
  sheet: string;
  ref: DayRef;
  /** Mes elegido con el selector (hoja sin fecha): la vista previa rehecha va al mismo libro. */
  month?: MonthKey;
  /** Carga pendiente que se reemplaza al rehacer la vista previa (null si quedó bloqueada). */
  pendingId: string | null;
  questions: AliasQuestion[];
  index: number;
  /** Equivalencias guardadas en esta ronda. */
  added: number;
  /** Productos marcados como nuevos (o sin responder): no se vuelven a preguntar. */
  skipped: string[];
}

interface ProductChoice {
  telegramId: number;
  request: ProductRequest;
  options: string[];
  /** Mes del reporte que preguntó: el producto elegido se lee en ese mismo mes. */
  month: MonthKey;
}

/** Qué se reanuda al tocar un mes del selector. */
const PICK_KIND = {
  /** Comando escrito (o botón `menu:` viejo): se corre con sus argumentos. */
  COMMAND: 'command',
  /** Botón del teclado fijo: se vuelve a tocar con el mes ya elegido. */
  BUTTON: 'button',
  /** Hoja del IPV sin fecha: con el mes elegido se pregunta el día. */
  IPV_DAY: 'ipv_day',
} as const;

type PickKind = (typeof PICK_KIND)[keyof typeof PICK_KIND];

/** Pregunta "📒 ¿De qué mes?" abierta. Cada una sirve una sola vez. */
interface MonthPick {
  /** Solo quien la pidió puede usarla. */
  telegramId: number;
  kind: PickKind;
  /** Comando que la pidió: de aquí sale el permiso que exige el toque. */
  command: string;
  /** Argumentos escritos ('' para botones). */
  args: string;
  /** Meses ofrecidos: el tocado tiene que ser uno de estos. */
  months: MonthKey[];
}

type MonthPickRequest = Pick<MonthPick, 'kind' | 'command' | 'args'>;

/** Paso de un flujo guiado del teclado que espera algo del usuario. */
const FLOW_STEP = {
  /** 🔍 Producto: espera el nombre. */
  PRODUCT: 'product',
  /** 📄 Fila: espera el nombre del producto. */
  ROW_PRODUCT: 'row_product',
  /** 📄 Fila: ya tiene el producto, espera el día (botones). */
  ROW_DAY: 'row_day',
  /** 💱 TC: espera el número (mes en curso) o el número y el día (otro mes). */
  TC: 'tc',
  /** ➕ Gasto: el paso concreto va en `expense.step`. */
  EXPENSE: 'expense',
} as const;

type FlowStep = (typeof FLOW_STEP)[keyof typeof FLOW_STEP];

interface GuidedFlow {
  step: FlowStep;
  /** Comando cuyo permiso se exige al responder. */
  command: string;
  /** Producto elegido en 📄 Fila. */
  product?: string;
  /** Mes elegido antes de 🔍 Producto, 📄 Fila y 💱 TC: sus pasos usan solo ese libro. */
  month?: MonthKey;
  /** Borrador de ➕ Gasto. */
  expense?: ExpenseDraft;
}

export function createBot(deps: BotDeps, options: CreateBotOptions): Bot<BotContext> {
  const bot = new Bot<BotContext>(
    options.token,
    options.botInfo === undefined ? {} : { botInfo: options.botInfo },
  );
  const clock = deps.pipeline.clock;
  /** Elección de hoja en curso, por usuario: solo quien subió el archivo responde. */
  const ipvChoices = new TtlStore<IpvChoice>(CONVERSATION_TTL_MS, clock);
  const awaitingReason = new TtlStore<AwaitingReason>(CONVERSATION_TTL_MS, clock);
  const productChoices = new TtlStore<ProductChoice>(CONVERSATION_TTL_MS, clock);
  /** Flujo guiado en curso, por usuario: cada uno responde solo a sus preguntas. */
  const flows = new TtlStore<GuidedFlow>(CONVERSATION_TTL_MS, clock);
  /** Libro de /cuadremes esperando ✅ Registrar, por usuario. */
  const bookRegistrations = new TtlStore<BookRegistration>(CONVERSATION_TTL_MS, clock);
  /** Mes revisado con /cierremes esperando 🔒 Cerrar mes, por usuario. */
  const monthCloses = new TtlStore<MonthClose>(CONVERSATION_TTL_MS, clock);
  /** Cambio de /equivalencia esperando ✅ Guardar, por usuario. */
  const aliasChanges = new TtlStore<AliasChange>(CONVERSATION_TTL_MS, clock);
  /** Preguntas de equivalencia de la última vista previa de /ipv, por usuario. */
  const aliasReviews = new TtlStore<AliasReview>(CONVERSATION_TTL_MS, clock);
  /** Selectores de mes abiertos, por id (va en el callback_data). */
  const monthPicks = new TtlStore<MonthPick>(CONVERSATION_TTL_MS, clock);
  const pickCommand = (pickId: string) => monthPicks.get(pickId)?.command;
  const equivalenceDeps = (): EquivalenceDeps => ({
    catalog: deps.pipeline.catalog,
    changeLog: deps.pipeline.changeLog,
    settings: deps.settings,
  });
  /** Fecha de hoy (con año) en la zona del negocio. */
  const today = () => todayDateIn(clock(), deps.timezone);
  /** Mes en curso en la zona del negocio. */
  const currentMonth = (): MonthKey => monthOfDate(today());
  /**
   * Lectura de reportes y /validar para un mes: sale de `pipeline.books`, los mismos
   * libros que usan las escrituras.
   */
  const cuadreFor = (month: MonthKey): CuadreReader => monthReader(deps.pipeline.books, month);
  const flowCommand = (telegramId: number) =>
    ipvChoices.get(String(telegramId)) === undefined
      ? flows.get(String(telegramId))?.command
      : 'ipv';
  const download = deps.downloadFile ?? telegramFileDownloader(bot.api, options.token);

  // ------------------------------------------------------------ permisos
  bot.use(async (ctx: BotContext, next: NextFunction) => {
    const from = ctx.from;
    if (from === undefined || from.is_bot) return;
    const result = authorize(deps.auth, {
      telegramId: from.id,
      username: from.username ?? null,
      command: commandOf(ctx, flowCommand, pickCommand),
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
  /** Vista previa con ✅/❌. Con `month` (escritura en un mes elegido) lleva el encabezado 📒. */
  async function showPrepared(
    ctx: BotContext,
    result: PrepareResult,
    month?: MonthKey,
  ): Promise<void> {
    const withHeader = (preview: string) =>
      month === undefined ? preview : `${monthHeaderPlain(month)}\n${preview}`;
    switch (result.status) {
      case PREPARE_STATUS.READY:
        await replyLong(
          ctx,
          withHeader(result.preview),
          confirmKeyboard(result.pendingId, result.requiresForce),
        );
        return;
      case PREPARE_STATUS.BLOCKED:
        await replyLong(ctx, withHeader(result.preview));
        return;
      case PREPARE_STATUS.REJECTED:
        await ctx.reply(result.message);
        return;
    }
  }

  /** Lee la hoja elegida y muestra la vista previa de la carga. */
  async function loadSheet(
    ctx: BotContext,
    source: IpvSource,
    sheet: string,
    ref: DayRef,
    skipAliasQuestions: readonly string[] = [],
    chosenMonth?: MonthKey,
  ): Promise<void> {
    let ipv: IpvDay;
    try {
      ipv = source.readSheet(sheet, ref);
    } catch (error) {
      if (!(error instanceof IpvFormatError)) throw error;
      await ctx.reply(`No pude leer la hoja «${sheet}»: ${error.message}`);
      return;
    }
    // Hoja sin fecha: el mes elegido con el selector, tal cual. Hoja fechada: el libro de
    // su mes (un IPV de diciembre cargado en enero es del año pasado).
    const month = chosenMonth ?? monthOfRef(ipv, today());
    const prepared = await withTyping(ctx, () =>
      prepareIpvLoad(deps.pipeline, actorOf(ctx), {
        ipv,
        tc: null,
        month,
        skipAliasQuestions,
      }),
    );
    await showPrepared(ctx, prepared);

    const key = String(actorOf(ctx).telegramId);
    aliasReviews.delete(key);
    if (prepared.status === PREPARE_STATUS.REJECTED) return;
    const questions = prepared.aliasQuestions ?? [];
    if (questions.length === 0) return;
    const review: AliasReview = {
      source,
      sheet,
      ref,
      ...(chosenMonth === undefined ? {} : { month: chosenMonth }),
      pendingId: prepared.status === PREPARE_STATUS.READY ? prepared.pendingId : null,
      questions,
      index: 0,
      added: 0,
      skipped: [...skipAliasQuestions],
    };
    aliasReviews.set(key, review);
    await askAlias(ctx, review);
  }

  /** «¿Es alguno de estos?» para el producto del IPV que toca. */
  async function askAlias(ctx: BotContext, review: AliasReview): Promise<void> {
    const question = review.questions[review.index];
    if (question === undefined) return;
    const position = `${String(review.index + 1)} de ${String(review.questions.length)}`;
    await ctx.reply(
      `🔗 (${position}) «${question.ipvProduct}» no está en el cuadre. ¿Es alguno de estos? Si eliges uno, la equivalencia queda guardada para siempre.`,
      { reply_markup: ipvAliasKeyboard(question.candidates) },
    );
  }

  /** Terminadas las preguntas: si se guardó alguna equivalencia, se rehace la vista previa. */
  async function finishAliasReview(ctx: BotContext, review: AliasReview): Promise<void> {
    const actor = actorOf(ctx);
    aliasReviews.delete(String(actor.telegramId));
    if (review.added === 0) {
      await ctx.reply(
        'Listo: no se guardó ninguna equivalencia. La vista previa de arriba sigue igual.',
      );
      return;
    }
    if (review.pendingId !== null) {
      const cancelled = cancelPending(deps.pipeline, actor, review.pendingId);
      if (cancelled.status !== CONFIRM_STATUS.DONE) {
        await ctx.reply(
          `Las equivalencias quedaron guardadas, pero la carga de arriba ya no está pendiente (${cancelled.message}). Valen desde la próxima carga del IPV.`,
        );
        return;
      }
    }
    await ctx.reply('🔄 Rehago la vista previa con las equivalencias nuevas…');
    await loadSheet(ctx, review.source, review.sheet, review.ref, review.skipped, review.month);
  }

  /**
   * Hoja ya elegida: si dice su día (título del POS o nombre), se carga en el libro de
   * ese mes; si no, se pregunta el mes (selector) y después el día.
   */
  async function useSheet(ctx: BotContext, source: IpvSource, sheets: string[], sheet: string) {
    const key = String(actorOf(ctx).telegramId);
    const ref = source.sheetDate(sheet);
    if (ref === null) {
      ipvChoices.set(key, { step: IPV_STEP.MONTH, source, sheets, sheet });
      // Solo aquí se ofrece también el mes en curso aunque esté vacío: su día 01 se
      // carga justamente así.
      const asked = await askMonth(
        ctx,
        { kind: PICK_KIND.IPV_DAY, command: 'ipv', args: '' },
        { include: currentMonth() },
        `Hoja «${sheet}». ${MONTH_PICK_TEXT.ASK}`,
      );
      if (!asked) ipvChoices.delete(key);
      return;
    }
    ipvChoices.delete(key);
    await loadSheet(ctx, source, sheet, ref);
  }

  async function askSheet(ctx: BotContext, source: IpvSource, sheets: string[], intro?: string) {
    ipvChoices.set(String(actorOf(ctx).telegramId), { step: IPV_STEP.SHEET, source, sheets });
    await replyLong(ctx, sheetQuestion(sheets, intro));
  }

  /** Respuesta escrita mientras se elige la hoja del IPV. */
  async function answerIpvChoice(ctx: BotContext, choice: IpvChoice, answer: string) {
    const key = String(actorOf(ctx).telegramId);
    switch (choice.step) {
      case IPV_STEP.SUGGESTION:
        await ctx.reply(BOT_TEXT.SUGGESTION_ABOVE);
        return;
      case IPV_STEP.MONTH:
        await ctx.reply(BOT_TEXT.CHOOSE_MONTH_ABOVE);
        return;
      case IPV_STEP.DAY: {
        const month = choice.month;
        if (month === undefined || choice.sheet === undefined) {
          ipvChoices.delete(key);
          await ctx.reply(BOT_TEXT.UPLOAD_EXPIRED);
          return;
        }
        const ref = parseDayAnswer(answer, month);
        if (ref === null) {
          await ctx.reply(
            isDayOfOtherMonth(answer, month) ? dayOfOtherMonth(month) : BOT_TEXT.SHEET_DAY_INVALID,
          );
          return;
        }
        ipvChoices.delete(key);
        await loadSheet(ctx, choice.source, choice.sheet, ref, [], month);
        return;
      }
      case IPV_STEP.SHEET: {
        const result = resolveSheetAnswer(choice.sheets, answer);
        switch (result.status) {
          case SHEET_ANSWER.FOUND:
            await useSheet(ctx, choice.source, choice.sheets, result.sheet);
            return;
          case SHEET_ANSWER.SUGGEST:
            ipvChoices.set(key, { ...choice, step: IPV_STEP.SUGGESTION, sheet: result.suggestion });
            await ctx.reply(suggestionQuestion(answer, result.suggestion), {
              reply_markup: sheetSuggestionKeyboard(),
            });
            return;
          case SHEET_ANSWER.NOT_FOUND:
            await ctx.reply(notFoundText(answer, choice.sheets.length));
            return;
        }
      }
    }
  }

  async function removeKeyboard(ctx: BotContext): Promise<void> {
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    } catch {
      // El mensaje pudo borrarse o ya no tener botones: no es un error del usuario.
    }
  }

  async function validate(ctx: BotContext, args: string, month: MonthKey): Promise<void> {
    const request = parseValidateArgs(args);
    const text = await withTyping(ctx, () =>
      runValidation(cuadreFor(month), request, {
        hasFixedExpenses: deps.settings.get(SETTING.HAS_FIXED_EXPENSES) === true,
        showFinancials: can(actorOf(ctx).role, PERMISSION.VIEW_FINANCIALS),
      }),
    );
    await replyLong(ctx, `${monthHeaderPlain(month)}\n${text}`);
  }

  /** /ayuda (y /start): la lista del rol y el teclado fijo de botones. */
  async function help(ctx: BotContext): Promise<void> {
    const role = actorOf(ctx).role;
    await ctx.reply(helpText(role), { reply_markup: replyKeyboard(role) });
  }

  /** Días del cuadre para los botones de los flujos guiados. */
  async function dayTabs(month: MonthKey): Promise<string[]> {
    return monthDays((await cuadreFor(month).listDays()).map((day) => day.trim()));
  }

  // Las equivalencias se leen en cada reporte: cambian con /equivalencia.
  function reportDeps(month: MonthKey): ReportDeps {
    return {
      cuadre: cuadreFor(month),
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
    month: MonthKey,
    editPlaceholder: EditPlaceholder,
  ): Promise<void> {
    const header = monthHeader(month);
    if (result.kind === REPORT_KIND.TEXT) {
      const [first, ...rest] = result.messages;
      // El encabezado del mes va arriba del primer mensaje; si no cabe, va solo.
      const joined = first === undefined ? header : `${header}\n${first}`;
      const fits = joined.length <= TELEGRAM_MAX_TEXT;
      await editPlaceholder(fits ? joined : header);
      const tail = fits || first === undefined ? rest : [first, ...rest];
      for (const message of tail) await ctx.reply(message, { parse_mode: 'HTML' });
      return;
    }
    const choiceId = productChoices.add({
      telegramId: actorOf(ctx).telegramId,
      request: result.request,
      options: result.options,
      month,
    });
    const keyboard = productChoiceKeyboard(choiceId, result.options);
    await editPlaceholder(`${header}\n${esc(result.prompt)}`, keyboard);
  }

  /**
   * Envía "⏳ Calculando…" al instante, muestra "escribiendo…" mientras se calcula y
   * después reemplaza ese mensaje por el reporte (o por el error).
   */
  async function runReport(
    ctx: BotContext,
    command: string,
    month: MonthKey,
    run: () => Promise<ReportResult>,
  ): Promise<void> {
    const placeholder = await ctx.reply(
      `${REPORT_PLACEHOLDER[command] ?? DEFAULT_PLACEHOLDER} (${monthName(month)})`,
    );
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
      await edit(`${monthHeader(month)}\n${esc(`${BOT_TEXT.REPORT_ERROR}: ${reason}`)}`);
      return;
    }
    await showReport(ctx, result, month, edit);
  }

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

    // Subir un archivo reemplaza cualquier pregunta en curso.
    const key = String(actorOf(ctx).telegramId);
    flows.delete(key);
    ipvChoices.delete(key);

    const sheets = source.listSheets();
    const [single] = sheets;
    if (single === undefined) {
      await ctx.reply(BOT_TEXT.NO_SHEETS);
      return;
    }
    if (sheets.length === 1) {
      await useSheet(ctx, source, sheets, single);
      return;
    }
    const caption = argumentOf(ctx.message.caption);
    const named = resolveCaptionSheet(sheets, caption);
    if (named !== null) {
      await useSheet(ctx, source, sheets, named);
      return;
    }
    await askSheet(
      ctx,
      source,
      sheets,
      caption === '' ? undefined : `No encontré la hoja «${caption}» en el archivo.`,
    );
  });

  // ------------------------------------------------------------ reportes
  type MonthReport = (month: MonthKey, args: string) => Promise<ReportResult>;
  const reports: Readonly<Record<string, MonthReport>> = {
    dia: (month, args) => dayReport(reportDeps(month), args),
    semana: (month) => weekReport(reportDeps(month)),
    mes: (month) => monthReport(reportDeps(month)),
    rango: (month, args) => rangeReport(reportDeps(month), args),
    gastos: (month, args) => expensesReport(reportDeps(month), args),
    inversion: (month, args) => inventoryReport(reportDeps(month), args),
    ganancia: (month) => profitReport(reportDeps(month)),
    top: (month, args) => topReport(reportDeps(month), args),
    margen: (month, args) => marginsReport(reportDeps(month), args),
    fila: (month, args) => rowReport(reportDeps(month), args),
    producto: (month, args) => productReport(reportDeps(month), args),
  };

  // ------------------------------------------------------------ comandos
  /**
   * /tc en el mes elegido. Con día (`/tc 780 05`): esa pestaña del mes. Sin día: la
   * pestaña de hoy si el mes es el en curso; en otro mes se pide el día escrito y no
   * queda nada pendiente.
   */
  async function setTc(ctx: BotContext, args: string, month: MonthKey): Promise<void> {
    const parsed = parseTcArgs(args);
    if (parsed === null) {
      await ctx.reply(BOT_TEXT.TC_USAGE);
      return;
    }
    let tab = parsed.tab;
    if (tab === null) {
      if (month !== currentMonth()) {
        await ctx.reply(tcDayRequired(month));
        return;
      }
      tab = dayTab(todayIn(clock(), deps.timezone));
    }
    const prepared = await prepareSetTc(deps.pipeline, actorOf(ctx), { tab, tc: parsed.tc, month });
    await showPrepared(ctx, prepared, month);
  }

  // ------------------------------------------------------------ ➕ Gasto

  /** Guarda el borrador y hace la pregunta de su paso. */
  async function askExpense(ctx: BotContext, draft: ExpenseDraft): Promise<void> {
    flows.set(String(actorOf(ctx).telegramId), {
      step: FLOW_STEP.EXPENSE,
      command: 'gasto',
      expense: draft,
    });
    switch (draft.step) {
      case EXPENSE_STEP.DATE:
        await ctx.reply(datePrompt(draft), { reply_markup: expenseDateKeyboard() });
        return;
      case EXPENSE_STEP.DATE_TEXT:
        await ctx.reply(EXPENSE_TEXT.ASK_DATE_TEXT);
        return;
      case EXPENSE_STEP.AMOUNT:
        await ctx.reply(EXPENSE_TEXT.ASK_AMOUNT);
        return;
      case EXPENSE_STEP.CURRENCY:
        await ctx.reply(EXPENSE_TEXT.ASK_CURRENCY, { reply_markup: expenseCurrencyKeyboard() });
        return;
      case EXPENSE_STEP.DESCRIPTION:
        await ctx.reply(EXPENSE_TEXT.ASK_DESCRIPTION);
        return;
      case EXPENSE_STEP.CONFIRM: {
        const expense = completeExpense(draft);
        if (expense === null) throw new Error('Borrador de gasto incompleto en la vista previa.');
        await ctx.reply(expensePreview(expense), { reply_markup: expenseConfirmKeyboard() });
        return;
      }
    }
  }

  /** Borrador de ➕ Gasto del usuario, si está en el paso esperado. */
  function expenseDraft(ctx: BotContext, step?: ExpenseDraft['step']): ExpenseDraft | undefined {
    const draft = flows.get(String(actorOf(ctx).telegramId))?.expense;
    if (draft === undefined || (step !== undefined && draft.step !== step)) return undefined;
    return draft;
  }

  async function confirmExpense(ctx: BotContext): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    const draft = expenseDraft(ctx, EXPENSE_STEP.CONFIRM);
    const expense = draft === undefined ? null : completeExpense(draft);
    if (draft === undefined || expense === null) {
      await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
      return;
    }
    // Se suelta antes de escribir: un segundo ✅ no agrega la fila dos veces.
    flows.delete(key);
    const result = await withTyping(ctx, () => recordExpense(deps.expenses, expense));
    if (result.status === RECORD_STATUS.FAILED) {
      flows.set(key, { step: FLOW_STEP.EXPENSE, command: 'gasto', expense: draft });
    } else {
      await removeKeyboard(ctx);
    }
    await ctx.reply(result.message);
  }

  // ------------------------------------------------------------ 📒 /cuadremes
  /** Sin datos: la lista de libros. Con mes y enlace: revisa la hoja y pide ✅. */
  async function bookCommand(ctx: BotContext, args: string): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    bookRegistrations.delete(key);
    if (args.trim() === '') {
      await ctx.reply(bookListText({ settings: deps.settings, today: today() }), {
        link_preview_options: { is_disabled: true },
      });
      return;
    }
    const result = await withTyping(ctx, () =>
      prepareBookRegistration(
        {
          settings: deps.settings,
          inspect: deps.books?.inspect ?? null,
          serviceAccountEmail: deps.books?.serviceAccountEmail ?? null,
          today: today(),
        },
        args,
      ),
    );
    if (result.status === BOOK_PREPARE.REJECTED) {
      await ctx.reply(result.message);
      return;
    }
    bookRegistrations.set(key, result.registration);
    await ctx.reply(result.preview, {
      reply_markup: bookConfirmKeyboard(),
      link_preview_options: { is_disabled: true },
    });
  }

  // ------------------------------------------------------------ 🔒 /cierremes
  function closeDeps(): CloseMonthDeps {
    return {
      books: deps.pipeline.books,
      settings: deps.settings,
      changeLog: deps.pipeline.changeLog,
      hasFixedExpenses: deps.settings.get(SETTING.HAS_FIXED_EXPENSES) === true,
      today: today(),
    };
  }

  /** Revisa el mes y ofrece 🔒 Cerrar mes; `reabrir` lo abre otra vez. */
  async function closeMonthCommand(ctx: BotContext, args: string): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    monthCloses.delete(key);
    const request = parseCloseArgs(args, today());
    if (request.kind === CLOSE_REQUEST.INVALID) {
      await ctx.reply(request.message);
      return;
    }
    if (request.kind === CLOSE_REQUEST.REOPEN) {
      await ctx.reply(reopenMonthClose(closeDeps(), actorOf(ctx).telegramId, request.month));
      return;
    }
    let review: CloseReview;
    try {
      review = await withTyping(ctx, () => reviewMonthClose(closeDeps(), request.month));
    } catch (error) {
      console.error('Error revisando /cierremes:', error);
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.reply(`${BOT_TEXT.REPORT_ERROR}: ${reason}`);
      return;
    }
    const closing = review.closable !== null && review.close !== null ? review.close : null;
    if (closing !== null) monthCloses.set(key, closing);
    for (const [index, message] of review.messages.entries()) {
      const last = index === review.messages.length - 1;
      await ctx.reply(message, {
        parse_mode: 'HTML',
        ...(last && closing !== null ? { reply_markup: closeMonthKeyboard() } : {}),
      });
    }
  }

  // ------------------------------------------------------------ 🔗 /equivalencia
  /** Sin datos: la lista. `cuadre = ipv` agrega; `quitar ipv` quita. Ambos piden ✅. */
  async function equivalenceCommand(ctx: BotContext, args: string): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    aliasChanges.delete(key);
    const request = parseEquivalenceArgs(args);
    switch (request.kind) {
      case EQUIVALENCE_REQUEST.INVALID:
        await ctx.reply(request.message);
        return;
      case EQUIVALENCE_REQUEST.LIST:
        for (const page of equivalenceListPages(deps.pipeline.catalog)) await ctx.reply(page);
        return;
      case EQUIVALENCE_REQUEST.ADD:
      case EQUIVALENCE_REQUEST.REMOVE: {
        const result =
          request.kind === EQUIVALENCE_REQUEST.ADD
            ? prepareAddAlias(
                deps.pipeline.catalog,
                request,
                await withTyping(ctx, () =>
                  knownCuadreProducts(deps.pipeline.catalog, cuadreFor(currentMonth())),
                ),
              )
            : prepareRemoveAlias(deps.pipeline.catalog, request.ipv);
        if (result.status === ALIAS_PREPARE.REJECTED) {
          await ctx.reply(result.message);
          return;
        }
        aliasChanges.set(key, result.change);
        await ctx.reply(result.preview, { reply_markup: equivalenceConfirmKeyboard() });
        return;
      }
    }
  }

  async function cancel(ctx: BotContext): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    const hadReason = awaitingReason.get(key) !== undefined;
    const hadFlow =
      flows.get(key) !== undefined ||
      ipvChoices.get(key) !== undefined ||
      aliasReviews.get(key) !== undefined ||
      aliasChanges.get(key) !== undefined;
    awaitingReason.delete(key);
    aliasReviews.delete(key);
    aliasChanges.delete(key);
    flows.delete(key);
    ipvChoices.delete(key);
    if (hadReason) await ctx.reply(BOT_TEXT.REASON_CANCELLED);
    else if (hadFlow) await ctx.reply(BOT_TEXT.FLOW_CANCELLED);
    else await ctx.reply(BOT_TEXT.NOTHING_TO_CANCEL);
  }

  /**
   * Un solo punto de entrada por comando: lo usan los comandos escritos, los botones
   * del teclado y los del menú en línea de versiones anteriores.
   */
  async function runCommand(
    ctx: BotContext,
    command: string,
    args: string,
    month?: MonthKey,
  ): Promise<void> {
    if (needsMonth(command)) {
      // /tc mal escrito se explica antes de preguntar el mes: nunca se elige un mes en vano.
      if (command === 'tc' && parseTcArgs(args) === null) {
        await ctx.reply(BOT_TEXT.TC_USAGE);
        return;
      }
      if (month === undefined) await askMonth(ctx, { kind: PICK_KIND.COMMAND, command, args });
      else await runMonthCommand(ctx, command, args, month);
      return;
    }
    switch (command) {
      case 'ipv':
        await ctx.reply(args.trim() === '' ? BOT_TEXT.ASK_IPV_FILE : BOT_TEXT.NO_DRIVE);
        return;
      case 'gasto':
        await askExpense(ctx, startExpense(today()));
        return;
      case 'deshacer':
        await showPrepared(ctx, prepareUndo(deps.pipeline, actorOf(ctx)));
        return;
      case 'cuadremes':
        await bookCommand(ctx, args);
        return;
      case 'cierremes':
        await closeMonthCommand(ctx, args);
        return;
      case 'equivalencia':
        await equivalenceCommand(ctx, args);
        return;
      case 'cancelar':
        await cancel(ctx);
        return;
      default:
        await help(ctx);
    }
  }

  /** Comando que ya tiene su mes elegido: reportes, /validar y /tc. */
  async function runMonthCommand(
    ctx: BotContext,
    command: string,
    args: string,
    month: MonthKey,
  ): Promise<void> {
    const report = Object.hasOwn(reports, command) ? reports[command] : undefined;
    if (report !== undefined) {
      await runReport(ctx, command, month, () => report(month, args));
      return;
    }
    if (command === 'validar') {
      await validate(ctx, args, month);
      return;
    }
    if (command === 'tc') {
      await setTc(ctx, args, month);
      return;
    }
    // Un comando con mes sin implementación propia nunca corre "en otro mes" por omisión.
    await help(ctx);
  }

  /**
   * "📒 ¿De qué mes?" con un botón por mes ofrecido. Se pregunta siempre, aunque haya
   * un solo mes: la elección es explícita en cada operación.
   */
  async function askMonth(
    ctx: BotContext,
    request: MonthPickRequest,
    offer: AvailableMonthsOptions = {},
    prompt?: string,
  ): Promise<boolean> {
    const options = await withTyping(ctx, () =>
      availableMonths(deps.pipeline.books, deps.settings, offer),
    );
    if (options.length === 0) {
      await ctx.reply(MONTH_PICK_TEXT.NO_MONTHS);
      return false;
    }
    const pickId = monthPicks.add({
      ...request,
      telegramId: actorOf(ctx).telegramId,
      months: options.map((option) => option.month),
    });
    const question =
      prompt ??
      (request.kind === PICK_KIND.COMMAND
        ? askMonthForCommand(request.command)
        : MONTH_PICK_TEXT.ASK);
    await ctx.reply(question, { reply_markup: monthButtons(pickId, options) });
    return true;
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
    'gasto',
    'deshacer',
    'cuadremes',
    'cierremes',
    'equivalencia',
    'cancelar',
    ...Object.keys(reports),
  ]) {
    bot.command(command, async (ctx) => {
      await runCommand(ctx, command, ctx.match);
    });
  }

  // ------------------------------------------------------------ teclado fijo
  /** Un botón del teclado: lo ejecuta o abre su pregunta. Reemplaza cualquier flujo previo. */
  async function pressButton(ctx: BotContext, button: MenuButton, month?: MonthKey): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    flows.delete(key);
    ipvChoices.delete(key);
    // Todo botón de un comando con mes (también los flujos guiados) pregunta primero el
    // mes; el toque vuelve aquí con el mes elegido.
    if (needsMonth(button.command) && month === undefined) {
      await askMonth(ctx, { kind: PICK_KIND.BUTTON, command: button.command, args: '' });
      return;
    }
    switch (button.flow) {
      case BUTTON_FLOW.RUN:
        await runCommand(ctx, button.command, '', month);
        return;
      case BUTTON_FLOW.ASK_IPV:
        await ctx.reply(BOT_TEXT.ASK_IPV_FILE);
        return;
      case BUTTON_FLOW.ASK_TC:
        if (month === undefined) throw new Error(`Botón ${button.command} sin mes elegido.`);
        flows.set(key, { step: FLOW_STEP.TC, command: button.command, month });
        // Mes en curso: solo el número (va a la pestaña de hoy). Otro mes: número y día.
        await ctx.reply(month === currentMonth() ? BOT_TEXT.ASK_TC_VALUE : askTcValueAndDay(month));
        return;
      case BUTTON_FLOW.ASK_EXPENSE:
        await askExpense(ctx, startExpense(today()));
        return;
      case BUTTON_FLOW.ASK_PRODUCT:
      case BUTTON_FLOW.ASK_ROW:
      case BUTTON_FLOW.ASK_TOP_METRIC:
      case BUTTON_FLOW.ASK_DAY:
      case BUTTON_FLOW.ASK_RANGE:
        // `needsMonth` ya garantizó el mes; si un botón nuevo lo olvida, nunca se
        // cae en silencio al mes en curso.
        if (month === undefined) throw new Error(`Botón ${button.command} sin mes elegido.`);
        await askGuidedFlow(ctx, button, month);
        return;
    }
  }

  /** Primer paso de un flujo guiado, ya con su mes. */
  async function askGuidedFlow(
    ctx: BotContext,
    button: MenuButton,
    month: MonthKey,
  ): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    switch (button.flow) {
      case BUTTON_FLOW.ASK_PRODUCT:
        flows.set(key, { step: FLOW_STEP.PRODUCT, command: button.command, month });
        await ctx.reply(BOT_TEXT.ASK_PRODUCT);
        return;
      case BUTTON_FLOW.ASK_ROW:
        flows.set(key, { step: FLOW_STEP.ROW_PRODUCT, command: button.command, month });
        await ctx.reply(BOT_TEXT.ASK_ROW_PRODUCT);
        return;
      case BUTTON_FLOW.ASK_TOP_METRIC:
        await ctx.reply(BOT_TEXT.ASK_TOP, { reply_markup: topMetricButtons(month) });
        return;
      case BUTTON_FLOW.ASK_DAY:
      case BUTTON_FLOW.ASK_RANGE: {
        const days = await withTyping(ctx, () => dayTabs(month));
        if (days.length === 0) {
          await ctx.reply(BOT_TEXT.NO_DAYS);
          return;
        }
        const ask = button.flow === BUTTON_FLOW.ASK_DAY;
        const flow = ask ? CALLBACK.FLOW_DAY : CALLBACK.FLOW_FROM;
        await ctx.reply(ask ? BOT_TEXT.ASK_DAY : BOT_TEXT.ASK_FROM, {
          reply_markup: dayButtons(flowPrefix(flow, month), days),
        });
        return;
      }
      default:
        throw new Error(`El botón ${button.command} no es un flujo guiado con mes.`);
    }
  }

  /** Respuesta escrita a la pregunta de un flujo guiado. */
  async function answerFlow(ctx: BotContext, flow: GuidedFlow, answer: string): Promise<void> {
    const key = String(actorOf(ctx).telegramId);
    switch (flow.step) {
      case FLOW_STEP.PRODUCT:
        flows.delete(key);
        if (flow.month === undefined) {
          await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
          return;
        }
        await runCommand(ctx, 'producto', answer, flow.month);
        return;
      case FLOW_STEP.ROW_PRODUCT: {
        const month = flow.month;
        if (month === undefined) {
          flows.delete(key);
          await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
          return;
        }
        const days = await withTyping(ctx, () => dayTabs(month));
        if (days.length === 0) {
          flows.delete(key);
          await ctx.reply(BOT_TEXT.NO_DAYS);
          return;
        }
        flows.set(key, { step: FLOW_STEP.ROW_DAY, command: flow.command, product: answer, month });
        await ctx.reply(rowDayPrompt(answer), {
          reply_markup: dayButtons(flowPrefix(CALLBACK.FLOW_ROW_DAY, month), days),
        });
        return;
      }
      case FLOW_STEP.ROW_DAY:
        await ctx.reply(BOT_TEXT.CHOOSE_DAY_ABOVE);
        return;
      case FLOW_STEP.TC: {
        const month = flow.month;
        if (month === undefined) {
          flows.delete(key);
          await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
          return;
        }
        if (month === currentMonth()) {
          const tc = parseTcValue(answer);
          if (tc === null) {
            await ctx.reply(BOT_TEXT.TC_NOT_NUMBER);
            return;
          }
          flows.delete(key);
          await setTc(ctx, String(tc), month);
          return;
        }
        // Otro mes: el día es obligatorio, se insiste hasta tener los dos.
        const parsed = parseTcArgs(answer);
        if (parsed === null || parsed.tab === null) {
          await ctx.reply(BOT_TEXT.TC_VALUE_AND_DAY);
          return;
        }
        flows.delete(key);
        await setTc(ctx, `${String(parsed.tc)} ${parsed.tab}`, month);
        return;
      }
      case FLOW_STEP.EXPENSE: {
        if (flow.expense === undefined) {
          flows.delete(key);
          await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
          return;
        }
        const result = answerExpense(flow.expense, answer, today());
        if (result.error !== undefined) {
          await ctx.reply(result.error);
          return;
        }
        await askExpense(ctx, result.draft);
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

  // "¿Quisiste decir «…»?" → Sí carga esa hoja; No vuelve a preguntar.
  bot.callbackQuery(new RegExp(`^${CALLBACK.IPV_SHEET}:(y|n)$`), async (ctx) => {
    const key = String(actorOf(ctx).telegramId);
    const choice = ipvChoices.get(key);
    await ctx.answerCallbackQuery();
    if (choice?.step !== IPV_STEP.SUGGESTION || choice.sheet === undefined) {
      await ctx.reply(BOT_TEXT.UPLOAD_EXPIRED);
      return;
    }
    await removeKeyboard(ctx);
    if (ctx.match[1] === 'y') {
      await useSheet(ctx, choice.source, choice.sheets, choice.sheet);
      return;
    }
    await askSheet(ctx, choice.source, choice.sheets);
  });

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
    await runReport(ctx, choice.request.command, choice.month, () =>
      completeProductRequest(reportDeps(choice.month), choice.request, product),
    );
  });

  /**
   * Mes de un botón de flujo guiado. Sin mes (botón de una versión anterior) o con un
   * mes que no está registrado (callback inventado): responde vencido y da null.
   */
  async function flowMonth(ctx: BotContext, raw: string | undefined): Promise<MonthKey | null> {
    if (raw !== undefined && deps.pipeline.books.months().includes(raw)) return raw;
    await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
    return null;
  }

  /** `<prefijo>:` + mes opcional (`AAAA-MM:`) + el resto; el mes queda en el grupo 1. */
  const flowCallback = (prefix: string, rest: string) =>
    new RegExp(`^${prefix}:(?:(\\d{4}-\\d{2}):)?${rest}$`);

  // 📍 Día → /dia DD del mes elegido
  bot.callbackQuery(flowCallback(CALLBACK.FLOW_DAY, '([^:\\s]+)'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeKeyboard(ctx);
    const month = await flowMonth(ctx, ctx.match[1]);
    if (month === null) return;
    await runCommand(ctx, 'dia', ctx.match[2] ?? '', month);
  });

  // ↔️ Rango, primer paso: "¿Hasta?" con los días del mismo mes desde el elegido.
  bot.callbackQuery(flowCallback(CALLBACK.FLOW_FROM, '([^:\\s]+)'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeKeyboard(ctx);
    const month = await flowMonth(ctx, ctx.match[1]);
    if (month === null) return;
    const from = ctx.match[2] ?? '';
    const days = await withTyping(ctx, () => dayTabs(month));
    const start = days.indexOf(from);
    if (start < 0) {
      await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
      return;
    }
    await ctx.reply(BOT_TEXT.ASK_TO, {
      reply_markup: dayButtons(`${flowPrefix(CALLBACK.FLOW_TO, month)}:${from}`, days.slice(start)),
    });
  });

  // ↔️ Rango, segundo paso → /rango DD DD del mes elegido
  bot.callbackQuery(flowCallback(CALLBACK.FLOW_TO, '([^:\\s]+):([^:\\s]+)'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeKeyboard(ctx);
    const month = await flowMonth(ctx, ctx.match[1]);
    if (month === null) return;
    await runCommand(ctx, 'rango', `${ctx.match[2] ?? ''} ${ctx.match[3] ?? ''}`, month);
  });

  // 📄 Fila, día elegido → /fila <producto> DD del mes de la pregunta
  bot.callbackQuery(flowCallback(CALLBACK.FLOW_ROW_DAY, '([^:\\s]+)'), async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = String(actorOf(ctx).telegramId);
    const flow = flows.get(key);
    const month = ctx.match[1];
    if (
      flow?.step !== FLOW_STEP.ROW_DAY ||
      flow.product === undefined ||
      flow.month === undefined ||
      month !== flow.month
    ) {
      await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
      return;
    }
    flows.delete(key);
    await removeKeyboard(ctx);
    await runCommand(ctx, 'fila', `${flow.product} ${ctx.match[2] ?? ''}`, flow.month);
  });

  // 🏆 Top → /top <métrica> del mes elegido
  bot.callbackQuery(flowCallback(CALLBACK.FLOW_TOP, '(\\w+)'), async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeKeyboard(ctx);
    const month = await flowMonth(ctx, ctx.match[1]);
    if (month === null) return;
    await runCommand(ctx, 'top', ctx.match[2] ?? '', month);
  });

  // ➕ Gasto: [Hoy] / [Otro día], moneda, ✅ / ❌.
  bot.callbackQuery(new RegExp(`^${CALLBACK.EXPENSE}:(\\w+)(?::(\\w+))?$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const action = ctx.match[1] ?? '';
    switch (action) {
      case EXPENSE_ACTION.TODAY:
      case EXPENSE_ACTION.OTHER_DAY: {
        const draft = expenseDraft(ctx, EXPENSE_STEP.DATE);
        if (draft === undefined) break;
        await removeKeyboard(ctx);
        await askExpense(
          ctx,
          action === EXPENSE_ACTION.TODAY ? chooseToday(draft, today()) : chooseOtherDay(draft),
        );
        return;
      }
      case EXPENSE_ACTION.CURRENCY: {
        const draft = expenseDraft(ctx, EXPENSE_STEP.CURRENCY);
        const currency = parseExpenseCurrency(ctx.match[2] ?? '');
        if (draft === undefined || currency === null) break;
        await removeKeyboard(ctx);
        await askExpense(ctx, chooseCurrency(draft, currency));
        return;
      }
      case EXPENSE_ACTION.CONFIRM:
        await confirmExpense(ctx);
        return;
      case EXPENSE_ACTION.CANCEL:
        if (expenseDraft(ctx) !== undefined) flows.delete(String(actorOf(ctx).telegramId));
        await removeKeyboard(ctx);
        await ctx.reply(EXPENSE_TEXT.CANCELLED);
        return;
    }
    await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
  });

  // 📒 /cuadremes: ✅ Registrar / ❌ Cancelar.
  bot.callbackQuery(new RegExp(`^${CALLBACK.BOOK}:(ok|no)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const key = String(actorOf(ctx).telegramId);
    const registration = bookRegistrations.get(key);
    bookRegistrations.delete(key);
    await removeKeyboard(ctx);
    if (registration === undefined) {
      await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
      return;
    }
    if (ctx.match[1] === 'no') {
      await ctx.reply(BOT_TEXT.FLOW_CANCELLED);
      return;
    }
    const done = await withTyping(ctx, () =>
      confirmBookRegistration(deps.settings, registration, deps.pipeline.books),
    );
    await ctx.reply(done, {
      link_preview_options: { is_disabled: true },
    });
  });

  // 🔒 /cierremes: 🔒 Cerrar mes / ❌ No cerrar.
  bot.callbackQuery(new RegExp(`^${CALLBACK.CLOSE_MONTH}:(ok|no)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const actor = actorOf(ctx);
    const key = String(actor.telegramId);
    const close = monthCloses.get(key);
    monthCloses.delete(key);
    await removeKeyboard(ctx);
    if (close === undefined) {
      await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
      return;
    }
    if (ctx.match[1] === 'no') {
      await ctx.reply(`${monthName(close.month)} sigue abierto.`);
      return;
    }
    await ctx.reply(confirmMonthClose(closeDeps(), actor.telegramId, close));
  });

  // 🔗 /equivalencia: ✅ Guardar / ❌ Cancelar.
  bot.callbackQuery(new RegExp(`^${CALLBACK.EQUIVALENCE}:(ok|no)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const actor = actorOf(ctx);
    const key = String(actor.telegramId);
    const change = aliasChanges.get(key);
    aliasChanges.delete(key);
    await removeKeyboard(ctx);
    if (change === undefined) {
      await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
      return;
    }
    if (ctx.match[1] === 'no') {
      await ctx.reply(BOT_TEXT.FLOW_CANCELLED);
      return;
    }
    await ctx.reply(applyAliasChange(equivalenceDeps(), actor.telegramId, change));
  });

  // 🔗 Producto del IPV sin equivalencia: un candidato, 🆕 Es nuevo o ⏭ Dejar de preguntar.
  bot.callbackQuery(new RegExp(`^${CALLBACK.IPV_ALIAS}:(\\w+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    const actor = actorOf(ctx);
    const review = aliasReviews.get(String(actor.telegramId));
    await removeKeyboard(ctx);
    const question = review?.questions[review.index];
    if (review === undefined || question === undefined) {
      await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
      return;
    }
    const answer = ctx.match[1] ?? '';
    if (answer === IPV_ALIAS_ACTION.END) {
      review.skipped.push(...review.questions.slice(review.index).map((q) => q.ipvProduct));
      await finishAliasReview(ctx, review);
      return;
    }
    if (answer === IPV_ALIAS_ACTION.NEW) {
      review.skipped.push(question.ipvProduct);
      await ctx.reply(saveNewProduct(equivalenceDeps(), actor.telegramId, question.ipvProduct));
    } else {
      const product = question.candidates[Number(answer)];
      if (product === undefined) {
        await ctx.reply(BOT_TEXT.FLOW_EXPIRED);
        return;
      }
      await ctx.reply(
        saveIpvAlias(equivalenceDeps(), actor.telegramId, product, question.ipvProduct),
      );
      review.added++;
    }
    review.index++;
    aliasReviews.set(String(actor.telegramId), review);
    if (review.index < review.questions.length) await askAlias(ctx, review);
    else await finishAliasReview(ctx, review);
  });

  // 📒 Mes elegido: reanuda el comando o el botón que lo pidió, sobre ese mes.
  bot.callbackQuery(
    new RegExp(`^${CALLBACK.MONTH_PICK}:([A-Za-z0-9_-]+):(\\d{4}-\\d{2})$`),
    async (ctx) => {
      await ctx.answerCallbackQuery();
      const actor = actorOf(ctx);
      const pickId = ctx.match[1] ?? '';
      const month = ctx.match[2] ?? '';
      const pick = monthPicks.get(pickId);
      // El middleware ya exigió el permiso del comando guardado; aquí se exige además
      // que sea de quien toca, que el mes se haya ofrecido y (por si acaso) el permiso.
      if (
        pick === undefined ||
        pick.telegramId !== actor.telegramId ||
        !pick.months.includes(month) ||
        !canRunCommand(actor.role, pick.command)
      ) {
        await ctx.reply(BOT_TEXT.CHOICE_EXPIRED);
        return;
      }
      // Se suelta antes de correr: un segundo toque ya no hace nada.
      monthPicks.delete(pickId);
      await removeKeyboard(ctx);
      switch (pick.kind) {
        case PICK_KIND.COMMAND:
          await runCommand(ctx, pick.command, pick.args, month);
          return;
        case PICK_KIND.BUTTON: {
          const pressed = MENU_BUTTONS.find((candidate) => candidate.command === pick.command);
          if (pressed === undefined) {
            await ctx.reply(BOT_TEXT.CHOICE_EXPIRED);
            return;
          }
          await pressButton(ctx, pressed, month);
          return;
        }
        case PICK_KIND.IPV_DAY: {
          const key = String(actor.telegramId);
          const choice = ipvChoices.get(key);
          // /cancelar, otro archivo o un botón del teclado ya soltaron la hoja.
          if (choice?.step !== IPV_STEP.MONTH || choice.sheet === undefined) {
            await ctx.reply(BOT_TEXT.UPLOAD_EXPIRED);
            return;
          }
          ipvChoices.set(key, { ...choice, step: IPV_STEP.DAY, month });
          await ctx.reply(`Hoja «${choice.sheet}». ${askSheetDay(month)}`);
          return;
        }
      }
    },
  );

  // Menú en línea de versiones anteriores: sigue funcionando desde el historial del chat.
  bot.callbackQuery(new RegExp(`^${CALLBACK.MENU}:(\\w+)$`), async (ctx) => {
    await ctx.answerCallbackQuery();
    await runCommand(ctx, currentCommand(ctx.match[1] ?? ''), '');
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
    // Un botón retirado (teclado viejo del cliente) muestra /ayuda con el teclado nuevo,
    // aunque haya una pregunta abierta: nunca se toma como respuesta.
    if (isRetiredLabel(text)) {
      await help(ctx);
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
    const ipvChoice = ipvChoices.get(key);
    if (ipvChoice !== undefined) {
      await answerIpvChoice(ctx, ipvChoice, text);
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
