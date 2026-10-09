import type { Api } from 'grammy';
import {
  menuAssignments,
  userMenuAssignment,
  type MenuAssignment,
} from '../../app/keyboard-menu.js';
import type { User } from '../../ports/repositories.js';

/**
 * Publica el menú "/" de Telegram: uno general mínimo y uno por usuario según su rol.
 * Un fallo de la API (por ejemplo, un usuario que todavía no abrió el bot) se registra
 * y no detiene el bot: el menú es una ayuda, no algo crítico.
 */

export interface MenuSyncResult {
  ok: number;
  failed: number;
}

async function apply(api: Api, assignment: MenuAssignment): Promise<void> {
  const other = { scope: assignment.scope };
  if (assignment.commands === null) await api.deleteMyCommands(other);
  else await api.setMyCommands(assignment.commands, other);
}

async function applyAll(api: Api, assignments: readonly MenuAssignment[]): Promise<MenuSyncResult> {
  const result: MenuSyncResult = { ok: 0, failed: 0 };
  for (const assignment of assignments) {
    try {
      await apply(api, assignment);
      result.ok++;
    } catch (error) {
      result.failed++;
      const reason = error instanceof Error ? error.message : String(error);
      const target =
        assignment.scope.type === 'chat'
          ? `usuario ${String(assignment.scope.chat_id)}`
          : 'general';
      console.warn(`No pude actualizar el menú de comandos (${target}): ${reason}`);
    }
  }
  return result;
}

/** Menú general, botón "Menú" y el menú de cada usuario. Se llama al arrancar. */
export async function syncCommandMenus(api: Api, users: readonly User[]): Promise<MenuSyncResult> {
  const result = await applyAll(api, menuAssignments(users));
  try {
    await api.setChatMenuButton({ menu_button: { type: 'commands' } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`No pude fijar el botón "Menú": ${reason}`);
  }
  return result;
}

/** Menú de un solo usuario: al hacer /start o cuando cambia su rol. */
export function syncUserCommandMenu(api: Api, user: User): Promise<MenuSyncResult> {
  return applyAll(api, [userMenuAssignment(user)]);
}
