import { describe, expect, it } from 'vitest';
import { commandsFor, helpText } from '../../src/app/help.js';
import { todayIn } from '../../src/app/today.js';
import { ROLE } from '../../src/core/auth.js';

describe('ayuda por rol', () => {
  it('la dueña ve todos los comandos del MVP', () => {
    expect(commandsFor(ROLE.OWNER).map((c) => c.command)).toEqual([
      'ipv',
      'validar',
      'tc',
      'deshacer',
      'ayuda',
    ]);
  });
  it('el socio valida pero no carga ni escribe', () => {
    expect(commandsFor(ROLE.PARTNER).map((c) => c.command)).toEqual(['validar', 'ayuda']);
  });
  it('el dependiente solo carga el IPV', () => {
    expect(commandsFor(ROLE.CLERK).map((c) => c.command)).toEqual(['ipv', 'ayuda']);
    expect(helpText(ROLE.CLERK)).not.toContain('/tc');
  });
});

describe('todayIn', () => {
  it('usa la zona horaria del negocio', () => {
    // 02:00 UTC del 8 oct = 22:00 del 7 oct en La Habana (UTC−4).
    expect(todayIn(new Date('2026-10-08T02:00:00Z'), 'America/Havana')).toEqual({
      day: 7,
      month: 10,
    });
  });
});
