import { canRunCommand, type Role } from '../core/auth.js';

/** /ayuda y el menú de botones según el rol. Sin IA: el texto libre recibe este menú. */

export interface CommandHelp {
  command: string;
  usage: string;
  description: string;
  /** Aparece como botón en el menú (solo los que no necesitan argumentos). */
  inMenu: boolean;
}

/** Comandos que existen, en el orden en que se muestran. */
export const MVP_COMMANDS: readonly CommandHelp[] = [
  {
    command: 'ipv',
    usage: '/ipv',
    description:
      'Cargar el IPV del día: envía (o reenvía) el .xlsx. En el pie del archivo puedes poner el día, por ejemplo 3oct.',
    inMenu: true,
  },
  {
    command: 'validar',
    usage: '/validar [03|semana]',
    description: 'Revisar errores del cuadre por severidad 🔴🟡⚪.',
    inMenu: true,
  },
  {
    command: 'tc',
    usage: '/tc 780 [03]',
    description: 'Fijar la tasa de cambio del día.',
    inMenu: true,
  },
  {
    command: 'deshacer',
    usage: '/deshacer',
    description: 'Revertir la última escritura en la hoja.',
    inMenu: true,
  },
  {
    command: 'hoy',
    usage: '/hoy',
    description: 'Resumen de hoy (o del último día cargado).',
    inMenu: true,
  },
  {
    command: 'dia',
    usage: '/dia [03]',
    description: 'Resumen de un día: venta, costo, utilidad, gastos, top 5 y alertas.',
    inMenu: false,
  },
  {
    command: 'mes',
    usage: '/mes',
    description: 'Cada día del mes con su utilidad, la suma y el margen promedio.',
    inMenu: true,
  },
  {
    command: 'semana',
    usage: '/semana',
    description: 'Lo mismo que /mes para los últimos 7 días.',
    inMenu: true,
  },
  {
    command: 'rango',
    usage: '/rango 02 04',
    description: 'Lo mismo que /mes entre dos días.',
    inMenu: false,
  },
  {
    command: 'ganancia',
    usage: '/ganancia',
    description: 'Ganancia acumulada: según las hojas y ajustada (estimado).',
    inMenu: true,
  },
  {
    command: 'gastos',
    usage: '/gastos [02 04]',
    description: 'Gastos por día y por concepto.',
    inMenu: false,
  },
  {
    command: 'inversion',
    usage: '/inversion [02 04]',
    description: 'Inversión inicial, compras, vendido e inversión final por día.',
    inMenu: false,
  },
  {
    command: 'top',
    usage: '/top [5] [venta|utilidad|unidades] [02 04]',
    description: 'Ranking de productos.',
    inMenu: false,
  },
  {
    command: 'margen',
    usage: '/margen [02 04]',
    description: 'Productos por margen; alerta los de alta rotación con margen < 15%.',
    inMenu: false,
  },
  {
    command: 'fila',
    usage: '/fila pollo 03',
    description: 'Toda la fila de un producto en un día.',
    inMenu: false,
  },
  {
    command: 'producto',
    usage: '/producto pollo [02 04]',
    description: 'Suma de todas las filas de un producto y su detalle por día.',
    inMenu: false,
  },
  { command: 'ayuda', usage: '/ayuda', description: 'Ver esta lista.', inMenu: true },
];

export function commandsFor(role: Role): CommandHelp[] {
  return MVP_COMMANDS.filter((entry) => canRunCommand(role, entry.command));
}

/** Botones del menú del rol: solo comandos que funcionan sin argumentos. */
export function menuCommandsFor(role: Role): CommandHelp[] {
  return commandsFor(role).filter((entry) => entry.inMenu);
}

export function helpText(role: Role): string {
  const lines = ['📖 Comandos disponibles:', ''];
  for (const entry of commandsFor(role)) lines.push(`${entry.usage} — ${entry.description}`);
  lines.push('', 'Toda escritura en la hoja pide confirmación antes (✅ / ❌).');
  return lines.join('\n');
}

/** Respuesta al texto libre: el bot no interpreta lenguaje natural en el MVP. */
export const FREE_TEXT_REPLY = 'No entiendo mensajes libres todavía. Elige una opción:';
