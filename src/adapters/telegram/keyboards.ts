import { InlineKeyboard } from 'grammy';
import { formatDayRef } from '../../core/tabs.js';
import type { IpvTabRef } from '../../core/types.js';
import type { CommandHelp } from '../../app/help.js';

/** Prefijos del callback_data (máximo 64 bytes en Telegram). */
export const CALLBACK = {
  CONFIRM: 'ok',
  CANCEL: 'no',
  FORCE: 'force',
  IPV_DAY: 'ipvday',
  MENU: 'menu',
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

const MENU_LABEL: Readonly<Record<string, string>> = {
  ipv: '📥 Cargar IPV',
  validar: '🔎 Validar',
  tc: '💱 TC',
  deshacer: '↩️ Deshacer',
  ayuda: '📖 Ayuda',
};

export function menuKeyboard(commands: readonly CommandHelp[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  commands.forEach((entry, index) => {
    keyboard.text(
      MENU_LABEL[entry.command] ?? `/${entry.command}`,
      `${CALLBACK.MENU}:${entry.command}`,
    );
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
}
