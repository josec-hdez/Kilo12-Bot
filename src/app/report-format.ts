/**
 * Formato de los reportes para Telegram (parse_mode HTML): cifras redondeadas con
 * separador de miles, tablas monoespaciadas en <pre> y mensajes partidos sin
 * romper una tabla.
 */

export const TELEGRAM_MAX_TEXT = 4096;

/** CUP sin decimales: 181228.5 → "181,229". */
export function cup(value: number): string {
  const rounded = Math.round(value);
  return (rounded === 0 ? 0 : rounded).toLocaleString('en-US');
}

/** USD con dos decimales: 115.8 → "115.80". */
export function usd(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 0.3432 → "34.3%"; `null` → "—". */
export function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

/** Cantidades: hasta dos decimales (el pollo va por libras). */
export function qty(value: number | null): string {
  if (value === null) return 'vacía';
  return Number(value.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Cifras cortas para las tablas: 850 → "850", 78,140 → "78.1k", 1,234,567 → "1.2M".
 * El monto exacto va siempre en las líneas de resumen, debajo de la tabla.
 */
export function compact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 && Math.round(abs) !== 0 ? '-' : '';
  if (abs < 1_000) return cup(value);
  if (abs < 999_950) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
}

export const ALIGN = { LEFT: 'left', RIGHT: 'right' } as const;
export type Align = (typeof ALIGN)[keyof typeof ALIGN];

/**
 * Ancho máximo de una línea de tabla. Un <pre> en Telegram para teléfono muestra
 * unos 30–35 caracteres; si una línea pasa de ahí, se parte en dos y la tabla
 * deja de leerse.
 */
export const MAX_TABLE_WIDTH = 30;
/** Lo mínimo que se deja a una columna de texto al recortarla. */
const MIN_TEXT_WIDTH = 4;

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(width - 1, 0))}…` : text;
}

/**
 * Anchos de columna que caben en `maxWidth`: si no caben, se recorta la columna de
 * texto más ancha (alineada a la izquierda y que no sea la primera, que es el día o
 * el número), y si hace falta también la primera.
 */
function fitWidths(widths: number[], align: readonly Align[], maxWidth: number): number[] {
  const result = [...widths];
  const total = () => result.reduce((sum, w) => sum + w, 0) + result.length - 1;
  const textColumns = result
    .map((_, column) => column)
    .filter((column) => align[column] === ALIGN.LEFT);
  const shrinkable = [
    ...textColumns.filter((column) => column !== 0),
    ...textColumns.filter((column) => column === 0),
  ];
  for (const column of shrinkable) {
    const excess = total() - maxWidth;
    if (excess <= 0) break;
    const current = result[column] ?? 0;
    result[column] = Math.max(MIN_TEXT_WIDTH, current - excess);
  }
  return result;
}

/**
 * Tabla monoespaciada dentro de <pre>, de `maxWidth` caracteres como máximo por
 * línea. La primera columna se alinea a la izquierda y las demás a la derecha,
 * salvo que `align` diga otra cosa. Los textos largos se recortan con "…".
 */
export function table(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly Align[] = [],
  maxWidth = MAX_TABLE_WIDTH,
): string {
  const sides = header.map(
    (_, column) => align[column] ?? (column === 0 ? ALIGN.LEFT : ALIGN.RIGHT),
  );
  const all = [header, ...rows].map((cells) => cells.map(clean));
  const natural = header.map((_, column) =>
    Math.max(...all.map((cells) => (cells[column] ?? '').length)),
  );
  const widths = fitWidths(natural, sides, maxWidth);
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => {
        const width = widths[column] ?? 0;
        const text = truncate(cell, width);
        return sides[column] === ALIGN.LEFT ? text.padEnd(width) : text.padStart(width);
      })
      .join(' ')
      .trimEnd();
  return `<pre>${all.map((cells) => esc(line(cells))).join('\n')}</pre>`;
}

/** Líneas visibles de cada <pre> de un mensaje HTML (para comprobar el ancho). */
export function preLines(html: string): string[] {
  const unescape = (text: string) =>
    text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return [...html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].flatMap((match) =>
    unescape(match[1] ?? '').split('\n'),
  );
}

const PRE_OPEN = '<pre>';
const PRE_CLOSE = '</pre>';

/** Parte un bloque más largo que el máximo por líneas, cerrando y reabriendo el <pre>. */
function splitBlock(block: string, max: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let inPre = false;
  for (const line of block.split('\n')) {
    const opens = line.includes(PRE_OPEN);
    const closes = line.includes(PRE_CLOSE);
    const candidate = current === '' ? line : `${current}\n${line}`;
    const closing = inPre && !closes ? PRE_CLOSE : '';
    if (candidate.length + closing.length <= max) {
      current = candidate;
    } else {
      if (current !== '') chunks.push(`${current}${inPre ? PRE_CLOSE : ''}`);
      current = `${inPre && !opens ? PRE_OPEN : ''}${line}`.slice(0, max - PRE_CLOSE.length);
    }
    if (opens) inPre = true;
    if (closes) inPre = false;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/** Junta los bloques de un reporte en mensajes de Telegram sin partir una tabla. */
export function packMessages(blocks: readonly string[], max = TELEGRAM_MAX_TEXT): string[] {
  const messages: string[] = [];
  let current = '';
  for (const block of blocks.filter((b) => b !== '')) {
    const candidate = current === '' ? block : `${current}\n\n${block}`;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current !== '') messages.push(current);
    if (block.length <= max) {
      current = block;
      continue;
    }
    const parts = splitBlock(block, max);
    current = parts.pop() ?? '';
    messages.push(...parts);
  }
  if (current !== '') messages.push(current);
  return messages;
}
