import { describe, expect, it } from 'vitest';
import { commandsFor, helpText } from '../../src/app/help.js';
import { todayDateIn, todayIn } from '../../src/app/today.js';
import { ROLE } from '../../src/core/auth.js';

describe('ayuda por rol', () => {
  const REPORTS = [
    'hoy',
    'dia',
    'mes',
    'semana',
    'rango',
    'ganancia',
    'gastos',
    'inversion',
    'top',
    'margen',
    'fila',
    'producto',
  ];

  it('la dueña ve todos los comandos', () => {
    expect(commandsFor(ROLE.OWNER).map((c) => c.command)).toEqual([
      'ipv',
      'validar',
      'tc',
      'gasto',
      'deshacer',
      'cuadremes',
      'cierremes',
      'equivalencia',
      ...REPORTS,
      'ayuda',
    ]);
  });
  it('el socio valida, registra gastos y ve reportes, pero no carga ni escribe en el cuadre', () => {
    expect(commandsFor(ROLE.PARTNER).map((c) => c.command)).toEqual([
      'validar',
      'gasto',
      ...REPORTS,
      'ayuda',
    ]);
  });
  it('la ayuda explica los botones y /cancelar', () => {
    expect(helpText(ROLE.OWNER)).toContain('Los botones de abajo');
    expect(helpText(ROLE.OWNER)).toContain('/cancelar');
  });
  it('el dependiente solo carga el IPV y registra gastos', () => {
    expect(commandsFor(ROLE.CLERK).map((c) => c.command)).toEqual(['ipv', 'gasto', 'ayuda']);
    expect(helpText(ROLE.CLERK)).not.toContain('/tc');
    expect(helpText(ROLE.CLERK)).not.toContain('/mes');
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

describe('todayDateIn', () => {
  it('incluye el año y usa la zona horaria del negocio', () => {
    // 03:00 UTC del 1 ene = 22:00 del 31 dic en La Habana (UTC−5 en invierno).
    expect(todayDateIn(new Date('2027-01-01T03:00:00Z'), 'America/Havana')).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
  });
});
