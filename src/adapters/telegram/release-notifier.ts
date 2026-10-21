import type { Api } from 'grammy';
import type { ReleaseNotifier } from '../../app/announce-release.js';
import { replyKeyboard } from './keyboards.js';

/**
 * Aviso de versión nueva por Telegram. Va con el teclado fijo del rol: al recibirlo,
 * la persona ve los botones nuevos sin enviar /start. El menú "/" de cada usuario ya
 * se publica al arrancar (syncCommandMenus).
 */
export function telegramReleaseNotifier(api: Api): ReleaseNotifier {
  return async (user, text) => {
    await api.sendMessage(user.telegramId, text, { reply_markup: replyKeyboard(user.role) });
  };
}
