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

export const ALIGN = { LEFT: 'left', RIGHT: 'right' } as const;
export type Align = (typeof ALIGN)[keyof typeof ALIGN];

const MAX_CELL = 20;

function fit(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_CELL ? `${clean.slice(0, MAX_CELL - 1)}…` : clean;
}

/**
 * Tabla monoespaciada dentro de <pre>. La primera columna se alinea a la izquierda
 * y las demás a la derecha, salvo que `align` diga otra cosa.
 */
export function table(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly Align[] = [],
): string {
  const all = [header, ...rows].map((cells) => cells.map(fit));
  const widths = header.map((_, column) =>
    Math.max(...all.map((cells) => (cells[column] ?? '').length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => {
        const width = widths[column] ?? 0;
        const side = align[column] ?? (column === 0 ? ALIGN.LEFT : ALIGN.RIGHT);
        return side === ALIGN.LEFT ? cell.padEnd(width) : cell.padStart(width);
      })
      .join(' ')
      .trimEnd();
  return `<pre>${all.map((cells) => esc(line(cells))).join('\n')}</pre>`;
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
