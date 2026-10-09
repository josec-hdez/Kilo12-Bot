import type { Api } from 'grammy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  syncCommandMenus,
  syncUserCommandMenu,
} from '../../../src/adapters/telegram/command-menu.js';
import { menuCommandsFor } from '../../../src/app/keyboard-menu.js';
import { ROLE } from '../../../src/core/auth.js';
import type { User } from '../../../src/ports/repositories.js';

interface Call {
  method: string;
  commands?: unknown;
  other?: unknown;
}

let calls: Call[];
let failChat: number | null;

function fakeApi(): Api {
  const fake = {
    setMyCommands: (commands: unknown, other: { scope: { chat_id?: number } }) => {
      calls.push({ method: 'setMyCommands', commands, other });
      if (other.scope.chat_id !== undefined && other.scope.chat_id === failChat) {
        return Promise.reject(new Error('Bad Request: chat not found'));
      }
      return Promise.resolve(true);
    },
    deleteMyCommands: (other: unknown) => {
      calls.push({ method: 'deleteMyCommands', other });
      return Promise.resolve(true);
    },
    setChatMenuButton: (other: unknown) => {
      calls.push({ method: 'setChatMenuButton', other });
      return Promise.resolve(true);
    },
  };
  return fake as unknown as Api;
}

const USERS: User[] = [
  { telegramId: 10, name: 'Dueña', role: ROLE.OWNER, active: true },
  { telegramId: 20, name: 'Socio', role: ROLE.PARTNER, active: true },
  { telegramId: 30, name: 'Turno', role: ROLE.CLERK, active: true },
  { telegramId: 40, name: 'Baja', role: ROLE.CLERK, active: false },
];

beforeEach(() => {
  calls = [];
  failChat = null;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('menú "/" de Telegram', () => {
  it('publica el general, uno por usuario según su rol y el botón Menú', async () => {
    const result = await syncCommandMenus(fakeApi(), USERS);
    expect(result).toEqual({ ok: 5, failed: 0 });
    expect(calls).toEqual([
      {
        method: 'setMyCommands',
        commands: [
          { command: 'ayuda', description: 'Ver los comandos y el teclado' },
          { command: 'cancelar', description: 'Cancelar lo que está en curso' },
        ],
        other: { scope: { type: 'default' } },
      },
      {
        method: 'setMyCommands',
        commands: menuCommandsFor(ROLE.OWNER),
        other: { scope: { type: 'chat', chat_id: 10 } },
      },
      {
        method: 'setMyCommands',
        commands: menuCommandsFor(ROLE.PARTNER),
        other: { scope: { type: 'chat', chat_id: 20 } },
      },
      {
        method: 'setMyCommands',
        commands: menuCommandsFor(ROLE.CLERK),
        other: { scope: { type: 'chat', chat_id: 30 } },
      },
      { method: 'deleteMyCommands', other: { scope: { type: 'chat', chat_id: 40 } } },
      { method: 'setChatMenuButton', other: { menu_button: { type: 'commands' } } },
    ]);
  });

  it('un error de Telegram con un usuario no detiene el resto ni lanza', async () => {
    failChat = 20;
    const result = await syncCommandMenus(fakeApi(), USERS);
    expect(result).toEqual({ ok: 4, failed: 1 });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('(usuario 20): Bad Request: chat not found'),
    );
    expect(calls.at(-1)?.method).toBe('setChatMenuButton');
  });

  it('un solo usuario (al hacer /start)', async () => {
    const result = await syncUserCommandMenu(fakeApi(), USERS[2] as User);
    expect(result).toEqual({ ok: 1, failed: 0 });
    expect(calls).toEqual([
      {
        method: 'setMyCommands',
        commands: menuCommandsFor(ROLE.CLERK),
        other: { scope: { type: 'chat', chat_id: 30 } },
      },
    ]);
  });
});
