import { distance } from 'fastest-levenshtein';
import { normalizeName, parseIpvTabDate } from '../core/tabs.js';
import type { DayRef } from '../core/types.js';

/**
 * Elección explícita de la hoja del IPV. El archivo suele traer muchas hojas: el bot
 * pregunta cuál analizar y nunca adivina. Solo propone la más parecida y espera un Sí.
 */

/** Día pedido; `month: null` si solo se dio el número (`03`). */
export interface DayArg {
  day: number;
  month: number | null;
}

/** `''` → `null` (sin argumento); texto que no es un día → `undefined`. */
export function parseDayArg(raw: string): DayArg | null | undefined {
  const arg = raw.trim();
  if (arg === '') return null;
  if (/^\d{1,2}$/.test(arg)) {
    const day = Number(arg);
    return day >= 1 && day <= 31 ? { day, month: null } : undefined;
  }
  const parsed = parseIpvTabDate(arg);
  return parsed === null ? undefined : { day: parsed.day, month: parsed.month };
}

export const SHEET_ANSWER = {
  /** La respuesta identifica una sola hoja. */
  FOUND: 'found',
  /** No coincide, pero hay una parecida: se pregunta "¿Quisiste decir…?". */
  SUGGEST: 'suggest',
  NOT_FOUND: 'not_found',
} as const;

export interface SheetFound {
  status: typeof SHEET_ANSWER.FOUND;
  sheet: string;
}

export interface SheetSuggestion {
  status: typeof SHEET_ANSWER.SUGGEST;
  suggestion: string;
}

export interface SheetNotFound {
  status: typeof SHEET_ANSWER.NOT_FOUND;
}

export type SheetAnswer = SheetFound | SheetSuggestion | SheetNotFound;

/** Por debajo de este parecido no se propone nada: se vuelve a preguntar. */
const MIN_SIMILARITY = 0.5;

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  const levenshtein = 1 - distance(a, b) / longest;
  const contained = a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
  return Math.max(levenshtein, contained ? MIN_SIMILARITY : 0);
}

/** Hojas cuyo nombre normalizado es igual al texto (sin espacios sobrantes, mayúsculas ni acentos). */
function normalizedMatches(sheets: readonly string[], text: string): string[] {
  const key = normalizeName(text);
  return sheets.filter((sheet) => normalizeName(sheet) === key);
}

/** Nombre exacto o, si no, el único nombre igual una vez normalizado. */
function byName(sheets: readonly string[], text: string): string | null {
  if (sheets.includes(text)) return text;
  const matches = normalizedMatches(sheets, text);
  const [only] = matches;
  return matches.length === 1 && only !== undefined ? only : null;
}

/** La hoja más parecida: primero una con la misma fecha, después por similitud. */
function closest(sheets: readonly string[], text: string): string | null {
  const date = parseIpvTabDate(text);
  if (date !== null) {
    const sameDate = sheets.filter((sheet) => {
      const parsed = parseIpvTabDate(sheet);
      return parsed?.day === date.day && parsed.month === date.month;
    });
    const [only] = sameDate;
    if (sameDate.length === 1 && only !== undefined) return only;
  }
  const key = normalizeName(text);
  let best: { sheet: string; score: number } | null = null;
  for (const sheet of sheets) {
    const score = similarity(key, normalizeName(sheet));
    if (score >= MIN_SIMILARITY && (best === null || score > best.score)) best = { sheet, score };
  }
  return best?.sheet ?? null;
}

/**
 * Respuesta escrita a "¿Cuál analizo?": un número de la lista o el nombre de la hoja.
 * Nunca elige por parecido: en ese caso devuelve una sugerencia para confirmar.
 */
export function resolveSheetAnswer(sheets: readonly string[], answer: string): SheetAnswer {
  const text = answer.trim();
  if (/^\d+$/.test(text)) {
    const sheet = sheets[Number(text) - 1];
    return sheet === undefined
      ? { status: SHEET_ANSWER.NOT_FOUND }
      : { status: SHEET_ANSWER.FOUND, sheet };
  }
  const named = byName(sheets, answer) ?? byName(sheets, text);
  if (named !== null) return { status: SHEET_ANSWER.FOUND, sheet: named };
  const suggestion = text === '' ? null : closest(sheets, text);
  return suggestion === null
    ? { status: SHEET_ANSWER.NOT_FOUND }
    : { status: SHEET_ANSWER.SUGGEST, suggestion };
}

/**
 * Pie del archivo: si nombra una sola hoja (por nombre o por fecha, como `3oct` o
 * `03`), se salta la pregunta. Si no la identifica, `null`: se pregunta.
 */
export function resolveCaptionSheet(sheets: readonly string[], caption: string): string | null {
  const text = caption.trim();
  if (text === '') return null;
  const named = byName(sheets, text);
  if (named !== null) return named;

  const arg = parseDayArg(text);
  if (arg === null || arg === undefined) return null;
  const sameDay = sheets.filter((sheet) => {
    const parsed = parseIpvTabDate(sheet);
    return parsed?.day === arg.day && (arg.month === null || parsed.month === arg.month);
  });
  const [only] = sameDay;
  return sameDay.length === 1 && only !== undefined ? only : null;
}

/**
 * Día del cuadre al que va una hoja sin fecha en el nombre (`Hoja1`). Acepta `05`
 * (mes de hoy) o una fecha como `5 oct`.
 */
export function parseDayAnswer(answer: string, today: DayRef): DayRef | null {
  const arg = parseDayArg(answer);
  if (arg === null || arg === undefined) return null;
  return { day: arg.day, month: arg.month ?? today.month };
}

function spacingNote(sheet: string): string {
  const leading = sheet !== sheet.trimStart();
  const trailing = sheet !== sheet.trimEnd();
  if (leading && trailing) return ' (con espacios al inicio y al final)';
  if (leading) return ' (con espacio al inicio)';
  if (trailing) return ' (con espacio al final)';
  return '';
}

/** Línea de la lista: los nombres con espacios en los bordes van entre comillas y con aviso. */
function sheetLine(sheet: string, index: number): string {
  const note = spacingNote(sheet);
  const name = note === '' ? sheet : `"${sheet}"`;
  return `${String(index + 1)}. ${name}${note}`;
}

/** "📥 El archivo tiene N hojas. ¿Cuál analizo?…" con la lista numerada de todas. */
export function sheetQuestion(sheets: readonly string[], intro?: string): string {
  const header = `📥 El archivo tiene ${String(sheets.length)} hojas. ¿Cuál analizo? Escribe el nombre exacto o su número:`;
  return [
    ...(intro === undefined ? [] : [intro, '']),
    header,
    '',
    ...sheets.map(sheetLine),
    '',
    '/cancelar para salir.',
  ].join('\n');
}

export function suggestionQuestion(answer: string, suggestion: string): string {
  return `No hay una hoja «${answer.trim()}». ¿Quisiste decir «${suggestion}»?`;
}

export function notFoundText(answer: string, count: number): string {
  return `No hay una hoja «${answer.trim()}». Escribe el nombre exacto o su número (1–${String(count)}), o /cancelar.`;
}

export const ASK_SHEET_DAY =
  '¿A qué día del cuadre corresponde? Escribe el día (ej. 05) o fecha (5 oct).';
