import { describe, expect, it } from 'vitest';
import { TtlStore } from '../../../src/adapters/telegram/ttl-store.js';
import {
  CALLBACK,
  dayButtons,
  flowPrefix,
  monthButtons,
  topMetricButtons,
} from '../../../src/adapters/telegram/keyboards.js';
import type { InlineKeyboard } from 'grammy';
import { MAX_MONTH_OPTIONS, type MonthOption } from '../../../src/app/month-pick.js';
import { addMonths } from '../../../src/core/months.js';

/** Límite de Telegram para callback_data. */
const MAX_CALLBACK_BYTES = 64;

function rowsOf(options: readonly MonthOption[], pickId = 'AbCd_-12') {
  return monthButtons(pickId, options).inline_keyboard.map((row) =>
    row.map((button) => ({
      text: button.text,
      data: 'callback_data' in button ? button.callback_data : undefined,
    })),
  );
}

describe('monthButtons', () => {
  it('un botón por mes, 3 por fila, con 🔒 en los cerrados', () => {
    const options: MonthOption[] = [
      { month: '2026-12', closed: false },
      { month: '2026-11', closed: false },
      { month: '2026-10', closed: true },
      { month: '2026-09', closed: false },
    ];
    expect(rowsOf(options, 'ID')).toEqual([
      [
        { text: 'diciembre 2026', data: 'mp:ID:2026-12' },
        { text: 'noviembre 2026', data: 'mp:ID:2026-11' },
        { text: '🔒 octubre 2026', data: 'mp:ID:2026-10' },
      ],
      [{ text: 'septiembre 2026', data: 'mp:ID:2026-09' }],
    ]);
  });

  it('sin fila vacía al final cuando las filas quedan llenas', () => {
    const options: MonthOption[] = ['2026-12', '2026-11', '2026-10'].map((month) => ({
      month,
      closed: false,
    }));
    expect(rowsOf(options)).toHaveLength(1);
  });

  it('todo callback_data cabe en 64 bytes, con un id real de TtlStore y 12 meses', () => {
    const store = new TtlStore<string>(60_000, () => new Date());
    const id = store.add('x');
    const options: MonthOption[] = Array.from({ length: MAX_MONTH_OPTIONS }, (_, i) => ({
      month: addMonths('2026-12', -i),
      closed: i % 2 === 0,
    }));
    const data = rowsOf(options, id).flatMap((row) => row.map((button) => button.data ?? ''));
    expect(data).toHaveLength(MAX_MONTH_OPTIONS);
    for (const value of data) {
      expect(value).toMatch(new RegExp(`^${CALLBACK.MONTH_PICK}:[A-Za-z0-9_-]+:\\d{4}-\\d{2}$`));
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(MAX_CALLBACK_BYTES);
    }
    expect(Buffer.byteLength(data[0] ?? '', 'utf8')).toBe(19);
  });

  it('las etiquetas nunca están vacías (Telegram rechaza botones sin texto)', () => {
    const rows = rowsOf([{ month: '2026-01', closed: false }]);
    expect(rows.flat().every((button) => button.text.length > 0)).toBe(true);
  });
});

function dataOf(keyboard: InlineKeyboard): string[] {
  return keyboard.inline_keyboard
    .flat()
    .map((button) => ('callback_data' in button ? button.callback_data : ''));
}

describe('botones de flujos guiados con mes', () => {
  const ALL_DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

  it('días con el mes dentro: gd, gr1, gf y gr2 (con el "desde")', () => {
    expect(dataOf(dayButtons(flowPrefix(CALLBACK.FLOW_DAY, '2026-10'), ['01', '02']))).toEqual([
      'gd:2026-10:01',
      'gd:2026-10:02',
    ]);
    expect(dataOf(dayButtons(flowPrefix(CALLBACK.FLOW_FROM, '2026-10'), ['05']))).toEqual([
      'gr1:2026-10:05',
    ]);
    expect(dataOf(dayButtons(flowPrefix(CALLBACK.FLOW_ROW_DAY, '2026-10'), ['05']))).toEqual([
      'gf:2026-10:05',
    ]);
    expect(dataOf(dayButtons(`${flowPrefix(CALLBACK.FLOW_TO, '2026-10')}:05`, ['07']))).toEqual([
      'gr2:2026-10:05:07',
    ]);
  });

  it('🏆 Top: una métrica por botón con el mes dentro', () => {
    expect(dataOf(topMetricButtons('2026-10'))).toEqual([
      'gt:2026-10:venta',
      'gt:2026-10:utilidad',
      'gt:2026-10:unidades',
    ]);
  });

  it('todo callback_data de los flujos cabe en 64 bytes (peor caso gr2:<mes>:31:31)', () => {
    const month = '2026-12';
    const data = [
      ...dataOf(dayButtons(flowPrefix(CALLBACK.FLOW_DAY, month), ALL_DAYS)),
      ...dataOf(dayButtons(flowPrefix(CALLBACK.FLOW_FROM, month), ALL_DAYS)),
      ...dataOf(dayButtons(flowPrefix(CALLBACK.FLOW_ROW_DAY, month), ALL_DAYS)),
      ...dataOf(dayButtons(`${flowPrefix(CALLBACK.FLOW_TO, month)}:31`, ALL_DAYS)),
      ...dataOf(topMetricButtons(month)),
    ];
    for (const value of data)
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(MAX_CALLBACK_BYTES);
    expect(data).toContain('gr2:2026-12:31:31');
    expect(Buffer.byteLength('gr2:2026-12:31:31', 'utf8')).toBe(17);
  });
});
