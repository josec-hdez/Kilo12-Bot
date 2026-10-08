import { suggestMatches, type AliasIndex } from './mapping.js';
import { TOP_METRIC, type TopMetric } from './reports.js';
import { normalizeName } from './tabs.js';

/** Argumentos de los comandos de reportes. Puro: no lee la hoja. */

const DAY_PATTERN = /^\d{1,2}$/;
const DAY_RANGE_PATTERN = /^(\d{1,2})-(\d{1,2})$/;

const pad = (day: string): string => day.padStart(2, '0');
const tokens = (raw: string): string[] => raw.trim().split(/\s+/).filter(Boolean);

export interface DayRange {
  from: string;
  to: string;
}

export const ARGS_ERROR = 'error' as const;

export interface ArgsError {
  kind: typeof ARGS_ERROR;
  message: string;
}

const error = (message: string): ArgsError => ({ kind: ARGS_ERROR, message });

export function isArgsError(value: unknown): value is ArgsError {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && value.kind === ARGS_ERROR
  );
}

/** `[]` → sin rango; `02 04`, `02-04` o `3` (un solo día). */
function rangeFrom(parts: readonly string[]): DayRange | null | ArgsError {
  if (parts.length === 0) return null;
  const [first = '', second] = parts;
  const dashed = DAY_RANGE_PATTERN.exec(first);
  if (parts.length === 1 && dashed?.[1] !== undefined && dashed[2] !== undefined) {
    return { from: pad(dashed[1]), to: pad(dashed[2]) };
  }
  if (parts.length === 1 && DAY_PATTERN.test(first)) return { from: pad(first), to: pad(first) };
  if (
    parts.length === 2 &&
    second !== undefined &&
    DAY_PATTERN.test(first) &&
    DAY_PATTERN.test(second)
  ) {
    return { from: pad(first), to: pad(second) };
  }
  return error('Rango no válido. Usa dos días: 02 04 (o 02-04).');
}

/** Argumento opcional de rango: `/gastos`, `/gastos 02 04`, `/gastos 02-04`. */
export function parseRange(raw: string): DayRange | null | ArgsError {
  return rangeFrom(tokens(raw));
}

/** Rango obligatorio (`/rango 02 04`). */
export function parseRequiredRange(raw: string): DayRange | ArgsError {
  const range = rangeFrom(tokens(raw));
  return range === null ? error('Uso: /rango 02 04 (desde y hasta, días del cuadre).') : range;
}

/** Día opcional (`/dia`, `/dia 03`). */
export function parseDay(raw: string): string | null | ArgsError {
  const parts = tokens(raw);
  if (parts.length === 0) return null;
  const [day = ''] = parts;
  if (parts.length === 1 && DAY_PATTERN.test(day)) return pad(day);
  return error('Día no válido. Usa el número de la pestaña, por ejemplo: 03.');
}

/** Días de un rango, en el orden de la hoja. `null` = todos. */
export function selectDays(days: readonly string[], range: DayRange | null): string[] | ArgsError {
  if (range === null) return [...days];
  const clean = days.map((day) => day.trim());
  const from = clean.indexOf(range.from);
  const to = clean.indexOf(range.to);
  if (from < 0) return error(`No existe la pestaña ${range.from} en el cuadre.`);
  if (to < 0) return error(`No existe la pestaña ${range.to} en el cuadre.`);
  return from <= to ? days.slice(from, to + 1) : days.slice(to, from + 1);
}

// ---------------------------------------------------------------- /top

export interface TopArgs {
  limit: number;
  metric: TopMetric;
  range: DayRange | null;
}

export const DEFAULT_TOP_LIMIT = 10;
const MAX_TOP_LIMIT = 50;

const METRIC_WORDS: Readonly<Record<string, TopMetric>> = {
  venta: TOP_METRIC.VENTA,
  ventas: TOP_METRIC.VENTA,
  utilidad: TOP_METRIC.UTILIDAD,
  ganancia: TOP_METRIC.UTILIDAD,
  unidades: TOP_METRIC.UNIDADES,
  cantidad: TOP_METRIC.UNIDADES,
};

const TOP_USAGE =
  'Uso: /top [n] [venta|utilidad|unidades] [desde hasta]. Ej.: /top 5 utilidad 01 05';

/**
 * `/top`, `/top 5`, `/top utilidad`, `/top 5 unidades 02 04`. Sin palabra de métrica,
 * los números se leen así: uno = n, dos = rango, tres = n y rango.
 */
export function parseTop(raw: string): TopArgs | ArgsError {
  const parts = tokens(raw.toLowerCase());
  const metricIndex = parts.findIndex((part) => Object.hasOwn(METRIC_WORDS, part));
  let limitPart: string | undefined;
  let rangeParts: string[];
  let metric: TopMetric = TOP_METRIC.VENTA;

  if (metricIndex >= 0) {
    const before = parts.slice(0, metricIndex);
    if (before.length > 1) return error(TOP_USAGE);
    limitPart = before[0];
    metric = METRIC_WORDS[parts[metricIndex] ?? ''] ?? TOP_METRIC.VENTA;
    rangeParts = parts.slice(metricIndex + 1);
  } else if (parts.length === 1 || parts.length === 3) {
    limitPart = parts[0];
    rangeParts = parts.slice(1);
  } else {
    rangeParts = parts;
  }

  let limit = DEFAULT_TOP_LIMIT;
  if (limitPart !== undefined) {
    if (!/^\d+$/.test(limitPart)) return error(TOP_USAGE);
    limit = Math.min(MAX_TOP_LIMIT, Math.max(1, Number(limitPart)));
  }
  const range = rangeFrom(rangeParts);
  if (isArgsError(range)) return error(TOP_USAGE);
  return { limit, metric, range };
}

// ---------------------------------------------------------------- /fila y /producto

export interface RowArgs {
  query: string;
  /** Pestaña pedida; `null` = el último día del cuadre. */
  day: string | null;
}

/** `/fila pollo 03`: el último número es el día; sin número, el último día. */
export function parseRowArgs(raw: string): RowArgs | ArgsError {
  const parts = tokens(raw);
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && last !== undefined && DAY_PATTERN.test(last)) {
    return { query: parts.slice(0, -1).join(' '), day: pad(last) };
  }
  if (parts.length === 0) return error('Uso: /fila <producto> <día>. Ej.: /fila pollo 03');
  return { query: parts.join(' '), day: null };
}

export interface ProductArgs {
  query: string;
  range: DayRange | null;
}

/**
 * `/producto pollo`, `/producto pollo 02 04` o `/producto pollo 02-04`. Un solo
 * número al final se deja en el nombre ("agua 500 ml" no es un rango).
 */
export function parseProductArgs(raw: string): ProductArgs | ArgsError {
  const parts = tokens(raw);
  if (parts.length === 0)
    return error('Uso: /producto <nombre> [desde hasta]. Ej.: /producto pollo');

  const last = parts[parts.length - 1] ?? '';
  if (parts.length >= 2 && DAY_RANGE_PATTERN.test(last)) {
    const range = rangeFrom([last]);
    if (!isArgsError(range) && range !== null) {
      return { query: parts.slice(0, -1).join(' '), range };
    }
  }
  const beforeLast = parts[parts.length - 2] ?? '';
  if (parts.length >= 3 && DAY_PATTERN.test(beforeLast) && DAY_PATTERN.test(last)) {
    return { query: parts.slice(0, -2).join(' '), range: { from: pad(beforeLast), to: pad(last) } };
  }
  return { query: parts.join(' '), range: null };
}

// ---------------------------------------------------------------- nombre de producto

export const RESOLVE_STATUS = {
  FOUND: 'found',
  CHOOSE: 'choose',
  NONE: 'none',
} as const;

export type ProductResolution =
  | { status: typeof RESOLVE_STATUS.FOUND; product: string }
  | { status: typeof RESOLVE_STATUS.CHOOSE; options: string[] }
  | { status: typeof RESOLVE_STATUS.NONE };

export const MAX_PRODUCT_CHOICES = 8;
const FUZZY_MIN_SCORE = 0.6;

/**
 * Busca el producto que el usuario escribió entre los nombres del cuadre: nombre
 * exacto, nombres que contienen todas sus palabras, alias del IPV y, al final,
 * parecido. Si hay más de un candidato, devuelve las opciones para elegir con
 * botones ("mayonesa" → cepera u holland park; nunca se elige por el usuario).
 */
export function resolveProductQuery(
  query: string,
  names: readonly string[],
  aliases: AliasIndex,
): ProductResolution {
  const key = normalizeName(query);
  if (key === '') return { status: RESOLVE_STATUS.NONE };
  const byKey = new Map(names.map((name) => [normalizeName(name), name]));

  const exact = byKey.get(key);
  if (exact !== undefined) return { status: RESOLVE_STATUS.FOUND, product: exact };

  const words = key.split(' ');
  const containing = [...byKey].filter(([candidate]) =>
    words.every((word) => candidate.includes(word)),
  );
  const pick = (options: string[]): ProductResolution => {
    if (options.length === 0) return { status: RESOLVE_STATUS.NONE };
    const [only] = options;
    if (options.length === 1 && only !== undefined) {
      return { status: RESOLVE_STATUS.FOUND, product: only };
    }
    return { status: RESOLVE_STATUS.CHOOSE, options: options.slice(0, MAX_PRODUCT_CHOICES) };
  };
  if (containing.length > 0) return pick(containing.map(([, name]) => name).sort());

  const alias = aliases.get(key);
  const aliased = alias === undefined ? undefined : byKey.get(normalizeName(alias));
  if (aliased !== undefined) return { status: RESOLVE_STATUS.FOUND, product: aliased };

  return pick(
    suggestMatches(query, [...byKey.values()], {
      minScore: FUZZY_MIN_SCORE,
      limit: MAX_PRODUCT_CHOICES,
    }).map((s) => s.product),
  );
}
