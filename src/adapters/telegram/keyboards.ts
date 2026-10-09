import { InlineKeyboard, Keyboard } from 'grammy';
import { keyboardRowsFor } from '../../app/keyboard-menu.js';
import type { Role } from '../../core/auth.js';
import { formatDayRef } from '../../core/tabs.js';
import type { IpvTabRef } from '../../core/types.js';

/** Prefijos del callback_data (máximo 64 bytes en Telegram). */
export const CALLBACK = {
  CONFIRM: 'ok',
  CANCEL: 'no',
  FORCE: 'force',
  IPV_DAY: 'ipvday',
  /** Botones del menú en línea de versiones anteriores (siguen en el historial del chat). */
  MENU: 'menu',
  /** Flujos guiados del teclado: `gd:<DD>` (/dia), `gr1:<DD>` y `gr2:<DD>:<DD>` (/rango), `gf:<DD>` (/fila), `gt:<métrica>` (/top). */
  FLOW_DAY: 'gd',
  FLOW_FROM: 'gr1',
  FLOW_TO: 'gr2',
  FLOW_ROW_DAY: 'gf',
  FLOW_TOP: 'gt',
  /** Elegir producto en /fila o /producto: `prod:<id>:<índice>`. */
  PRODUCT: 'prod',
} as const;

export function confirmKeyboard(pendingId: string, requiresForce: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (requiresForce) keyboard.text('⚠️ Confirmar igual', `${CALLBACK.FORCE}:${pendingId}`);
  else keyboard.text('✅ Confirmar', `${CALLBACK.CONFIRM}:${pendingId}`);
  return keyboard.text('❌ Cancelar', `${CALLBACK.CANCEL}:${pendingId}`);
}

export function dayChoiceKeyboard(uploadId: string, days: readonly IpvTabRef[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  days.forEach((day, index) => {
    keyboard.text(
      formatDayRef(day),
      `${CALLBACK.IPV_DAY}:${uploadId}:${String(day.day)}-${String(day.month)}`,
    );
    if (index % 4 === 3) keyboard.row();
  });
  return keyboard;
}

/** Opciones cuando el nombre coincide con varios productos. */
export function productChoiceKeyboard(
  choiceId: string,
  options: readonly string[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  options.forEach((option, index) => {
    keyboard
      .text(option.replace(/\s+/g, ' ').trim(), `${CALLBACK.PRODUCT}:${choiceId}:${String(index)}`)
      .row();
  });
  return keyboard;
}

/** Teclado fijo del rol (reemplaza al teclado de letras; ⊞ alterna entre los dos). */
export function replyKeyboard(role: Role): Keyboard {
  return Keyboard.from(keyboardRowsFor(role)).persistent().resized();
}

const DAY_COLUMNS = 5;

/** Días del cuadre como botones: `<prefijo>:<DD>`. */
export function dayButtons(prefix: string, days: readonly string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  days.forEach((day, index) => {
    keyboard.text(day, `${prefix}:${day}`);
    if (index % DAY_COLUMNS === DAY_COLUMNS - 1) keyboard.row();
  });
  return keyboard;
}

export const TOP_METRICS = [
  { label: 'Venta', value: 'venta' },
  { label: 'Utilidad', value: 'utilidad' },
  { label: 'Unidades', value: 'unidades' },
] as const;

export function topMetricButtons(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const metric of TOP_METRICS)
    keyboard.text(metric.label, `${CALLBACK.FLOW_TOP}:${metric.value}`);
  return keyboard;
}
