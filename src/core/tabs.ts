import type { DayRef } from './types.js';

const MONTHS = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
} as const;

type MonthKey = keyof typeof MONTHS;

const IPV_TAB_PATTERN = /^(\d{1,2})\s*([a-z]{3})[a-z]*\.?$/;
/** Hoja del programa de control (POS): `Turno 18 10-14`, con el día como MM-DD. */
const POS_TAB_PATTERN = /^turno \d+ (\d{1,2})-(\d{1,2})$/;
/** Título en A1 del POS: `IPV · turno 18 · 2026-10-14 09:03:50 → …`. Vale la primera fecha. */
const POS_TITLE_PATTERN = /^ipv\b.*\bturno\b.*?\d{4}-(\d{2})-(\d{2})/;

/** Normaliza nombres de pestañas y productos: minúsculas, sin acentos ni espacios sobrantes. */
export function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isMonthKey(value: string): value is MonthKey {
  return Object.hasOwn(MONTHS, value);
}

/** Interpreta nombres como `5 oct`, `2 oct `, `5 Oct` o `5oct`. Devuelve null si no es un día. */
export function parseIpvTabDate(tabName: string): DayRef | null {
  const match = IPV_TAB_PATTERN.exec(normalizeName(tabName));
  if (!match?.[1] || !match[2]) return null;

  const day = Number(match[1]);
  const monthKey = match[2];
  if (!isMonthKey(monthKey) || day < 1 || day > 31) return null;

  return { day, month: MONTHS[monthKey] };
}

function dayRef(day: number, month: number): DayRef | null {
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return { day, month };
}

/** Interpreta el nombre de hoja del POS (`Turno 18 10-14` → 14 oct). Null si no lo es. */
export function parsePosTabDate(tabName: string): DayRef | null {
  const match = POS_TAB_PATTERN.exec(normalizeName(tabName));
  if (!match?.[1] || !match[2]) return null;
  return dayRef(Number(match[2]), Number(match[1]));
}

/** Fecha de inicio del turno en el título A1 del POS. Null si el título no es del POS. */
export function parsePosTitleDate(title: string): DayRef | null {
  const match = POS_TITLE_PATTERN.exec(normalizeName(title));
  if (!match?.[1] || !match[2]) return null;
  return dayRef(Number(match[2]), Number(match[1]));
}

/** Busca la pestaña del IPV que corresponde a un día, tolerando nombres irregulares. */
export function findIpvTab(tabNames: readonly string[], ref: DayRef): string | null {
  return (
    tabNames.find((name) => {
      const parsed = parseIpvTabDate(name);
      return parsed?.day === ref.day && parsed.month === ref.month;
    }) ?? null
  );
}

const MONTH_LABELS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** Etiqueta legible de un día, como `5 oct`. */
export function formatDayRef(ref: DayRef): string {
  return `${ref.day} ${MONTH_LABELS[ref.month - 1] ?? '?'}`;
}
