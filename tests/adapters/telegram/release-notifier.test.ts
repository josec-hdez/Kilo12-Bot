import type { Api } from 'grammy';
import { describe, expect, it } from 'vitest';
import { replyKeyboard } from '../../../src/adapters/telegram/keyboards.js';
import { telegramReleaseNotifier } from '../../../src/adapters/telegram/release-notifier.js';
import { ROLE } from '../../../src/core/auth.js';

describe('telegramReleaseNotifier', () => {
  it('envía el aviso con el teclado fijo del rol', async () => {
    const calls: unknown[][] = [];
    const api = {
      sendMessage: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({});
      },
    } as unknown as Api;

    await telegramReleaseNotifier(api)(
      { telegramId: 7, name: null, role: ROLE.CLERK, active: true },
      'hola',
    );

    expect(calls).toEqual([[7, 'hola', { reply_markup: replyKeyboard(ROLE.CLERK) }]]);
  });
});
