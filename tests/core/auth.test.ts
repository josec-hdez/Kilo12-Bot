import { describe, expect, it } from 'vitest';
import {
  COMMAND_PERMISSION,
  PERMISSION,
  ROLE,
  can,
  canRunCommand,
  isRole,
  type Permission,
} from '../../src/core/auth.js';

const ALL = Object.values(PERMISSION);

describe('permisos por rol', () => {
  it('dueño puede todo', () => {
    expect(ALL.every((p) => can(ROLE.OWNER, p))).toBe(true);
  });

  it('socio: ver todo, registrar gastos y aceptar sugerencias; no escribe en el cuadre', () => {
    const allowed: Permission[] = [
      PERMISSION.VIEW_FINANCIALS,
      PERMISSION.VIEW_REPORTS,
      PERMISSION.VIEW_STOCK,
      PERMISSION.VALIDATE,
      PERMISSION.RECORD_EXPENSE,
      PERMISSION.ACCEPT_SUGGESTION,
    ];
    expect(ALL.filter((p) => can(ROLE.PARTNER, p)).sort()).toEqual([...allowed].sort());
  });

  it('dependiente: subir el IPV, gastos, entradas y stock; no ve costos ni utilidades', () => {
    const allowed: Permission[] = [
      PERMISSION.LOAD_IPV,
      PERMISSION.RECORD_EXPENSE,
      PERMISSION.RECORD_ENTRY,
      PERMISSION.VIEW_STOCK,
    ];
    expect(ALL.filter((p) => can(ROLE.CLERK, p)).sort()).toEqual([...allowed].sort());
    expect(can(ROLE.CLERK, PERMISSION.VIEW_FINANCIALS)).toBe(false);
  });

  it('solo una dueña puede forzar una confirmación con advertencia', () => {
    expect(can(ROLE.OWNER, PERMISSION.FORCE_CONFIRM)).toBe(true);
    expect(can(ROLE.PARTNER, PERMISSION.FORCE_CONFIRM)).toBe(false);
    expect(can(ROLE.CLERK, PERMISSION.FORCE_CONFIRM)).toBe(false);
  });
});

describe('permisos por comando', () => {
  it('dependiente no puede /tc, /validar ni /deshacer', () => {
    expect(canRunCommand(ROLE.CLERK, 'tc')).toBe(false);
    expect(canRunCommand(ROLE.CLERK, 'validar')).toBe(false);
    expect(canRunCommand(ROLE.CLERK, 'deshacer')).toBe(false);
  });

  it('dependiente puede /ipv y /ayuda', () => {
    expect(canRunCommand(ROLE.CLERK, 'ipv')).toBe(true);
    expect(canRunCommand(ROLE.CLERK, 'ayuda')).toBe(true);
  });

  it('acepta el comando con barra, mayúsculas o mención al bot', () => {
    expect(canRunCommand(ROLE.OWNER, '/TC@kilo12_bot')).toBe(true);
    expect(canRunCommand(ROLE.CLERK, '/IPV@kilo12_bot')).toBe(true);
  });

  it('un comando desconocido solo lo puede intentar una dueña', () => {
    expect(canRunCommand(ROLE.OWNER, 'inventado')).toBe(true);
    expect(canRunCommand(ROLE.PARTNER, 'inventado')).toBe(false);
  });

  it('cada comando mapeado apunta a un permiso existente', () => {
    for (const permission of Object.values(COMMAND_PERMISSION)) {
      if (permission !== null) expect(ALL).toContain(permission);
    }
  });
});

describe('isRole', () => {
  it('reconoce solo los roles definidos', () => {
    expect(isRole('dueno')).toBe(true);
    expect(isRole('socio')).toBe(true);
    expect(isRole('dependiente')).toBe(true);
    expect(isRole('admin')).toBe(false);
  });
});
