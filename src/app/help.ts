import { canRunCommand, type Role } from '../core/auth.js';

/** /ayuda y el menú de botones según el rol. Sin IA: el texto libre recibe este menú. */

export interface CommandHelp {
  command: string;
  usage: string;
  description: string;
}

/** Comandos que existen en este MVP, en el orden en que se muestran. */
export const MVP_COMMANDS: readonly CommandHelp[] = [
  {
    command: 'ipv',
    usage: '/ipv',
    description:
      'Cargar el IPV del día: envía (o reenvía) el .xlsx. En el pie del archivo puedes poner el día, por ejemplo 3oct.',
  },
  {
    command: 'validar',
    usage: '/validar [03|semana]',
    description: 'Revisar errores del cuadre por severidad 🔴🟡⚪.',
  },
  { command: 'tc', usage: '/tc 780 [03]', description: 'Fijar la tasa de cambio del día.' },
  {
    command: 'deshacer',
    usage: '/deshacer',
    description: 'Revertir la última escritura en la hoja.',
  },
  { command: 'ayuda', usage: '/ayuda', description: 'Ver esta lista.' },
];

export function commandsFor(role: Role): CommandHelp[] {
  return MVP_COMMANDS.filter((entry) => canRunCommand(role, entry.command));
}

export function helpText(role: Role): string {
  const lines = ['📖 Comandos disponibles:', ''];
  for (const entry of commandsFor(role)) lines.push(`${entry.usage} — ${entry.description}`);
  lines.push('', 'Toda escritura en la hoja pide confirmación antes (✅ / ❌).');
  return lines.join('\n');
}

/** Respuesta al texto libre: el bot no interpreta lenguaje natural en el MVP. */
export const FREE_TEXT_REPLY = 'No entiendo mensajes libres todavía. Elige una opción:';
