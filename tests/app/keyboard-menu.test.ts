import { describe, expect, it } from 'vitest';
import {
  buttonForText,
  buttonsFor,
  DEFAULT_MENU,
  keyboardRowsFor,
  MENU_BUTTONS,
  menuAssignments,
  menuCommandsFor,
  normalizeLabel,
} from '../../src/app/keyboard-menu.js';
import { canRunCommand, ROLE, type Role } from '../../src/core/auth.js';

const ROLES: Role[] = [ROLE.OWNER, ROLE.PARTNER, ROLE.CLERK];

describe('teclado fijo por rol', () => {
  it('la dueña ve los 17 botones en el orden aprobado, de 3 en 3', () => {
    expect(keyboardRowsFor(ROLE.OWNER)).toEqual([
      ['📅 Hoy', '📆 Mes', '🗓 Semana'],
      ['💰 Ganancia', '💸 Gastos', '📦 Inversión'],
      ['🏆 Top', '📊 Margen', '🔍 Producto'],
      ['📄 Fila', '📍 Día', '↔️ Rango'],
      ['📥 IPV', '🔎 Validar', '💱 TC'],
      ['↩️ Deshacer', '❓ Ayuda'],
    ]);
  });

  it('el socio ve reportes y validar, sin IPV, TC ni deshacer (no tiene esos permisos)', () => {
    expect(keyboardRowsFor(ROLE.PARTNER)).toEqual([
      ['📅 Hoy', '📆 Mes', '🗓 Semana'],
      ['💰 Ganancia', '💸 Gastos', '📦 Inversión'],
      ['🏆 Top', '📊 Margen', '🔍 Producto'],
      ['📄 Fila', '📍 Día', '↔️ Rango'],
      ['🔎 Validar', '❓ Ayuda'],
    ]);
  });

  it('el dependiente solo ve lo que puede usar', () => {
    expect(keyboardRowsFor(ROLE.CLERK)).toEqual([['📥 IPV', '❓ Ayuda']]);
  });

  it('ningún rol ve un botón cuyo comando no puede ejecutar', () => {
    for (const role of ROLES) {
      for (const button of buttonsFor(role)) expect(canRunCommand(role, button.command)).toBe(true);
      const hidden = MENU_BUTTONS.filter((b) => !buttonsFor(role).includes(b));
      for (const button of hidden) expect(canRunCommand(role, button.command)).toBe(false);
    }
  });

  it('ninguna fila pasa de 3 botones', () => {
    for (const role of ROLES)
      for (const row of keyboardRowsFor(role)) expect(row.length).toBeLessThanOrEqual(3);
  });
});

describe('texto del botón → comando', () => {
  it('cada botón se reconoce por su texto exacto', () => {
    for (const button of MENU_BUTTONS)
      expect(buttonForText(button.label)?.command).toBe(button.command);
  });

  it('tolera el selector de emoji y espacios de más', () => {
    expect(buttonForText('↩ Deshacer')?.command).toBe('deshacer');
    expect(buttonForText('↔ Rango')?.command).toBe('rango');
    expect(buttonForText('  📆   Mes ')?.command).toBe('mes');
    expect(normalizeLabel('↩️ Deshacer')).toBe(normalizeLabel('↩ Deshacer'));
  });

  it('un texto cualquiera no es un botón', () => {
    expect(buttonForText('Mes')).toBeUndefined();
    expect(buttonForText('pollo')).toBeUndefined();
  });
});

describe('menú "/" por rol', () => {
  const VALID_COMMAND = /^[a-z0-9_]{1,32}$/;

  it('la dueña tiene todos los comandos más /cancelar', () => {
    const commands = menuCommandsFor(ROLE.OWNER).map((c) => c.command);
    expect(commands[0]).toBe('ipv');
    expect(commands).toContain('fila');
    expect(commands.at(-1)).toBe('cancelar');
  });

  it('el dependiente no ve reportes', () => {
    expect(menuCommandsFor(ROLE.CLERK).map((c) => c.command)).toEqual(['ipv', 'ayuda', 'cancelar']);
  });

  it('nombres y descripciones válidos para Telegram', () => {
    for (const role of ROLES) {
      for (const entry of menuCommandsFor(role)) {
        expect(entry.command).toMatch(VALID_COMMAND);
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeLessThanOrEqual(256);
      }
    }
  });

  it('un menú general mínimo y uno por usuario; el desactivado pierde el suyo', () => {
    const assignments = menuAssignments([
      { telegramId: 10, name: 'Dueña', role: ROLE.OWNER, active: true },
      { telegramId: 30, name: 'Turno', role: ROLE.CLERK, active: true },
      { telegramId: 40, name: 'Baja', role: ROLE.CLERK, active: false },
    ]);
    expect(assignments).toEqual([
      { scope: { type: 'default' }, commands: [...DEFAULT_MENU] },
      { scope: { type: 'chat', chat_id: 10 }, commands: menuCommandsFor(ROLE.OWNER) },
      { scope: { type: 'chat', chat_id: 30 }, commands: menuCommandsFor(ROLE.CLERK) },
      { scope: { type: 'chat', chat_id: 40 }, commands: null },
    ]);
    expect(DEFAULT_MENU.map((c) => c.command)).toEqual(['ayuda', 'cancelar']);
  });
});
