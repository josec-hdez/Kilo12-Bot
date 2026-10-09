import { canRunCommand, type Role } from '../core/auth.js';

/** /ayuda según el rol. Sin IA: el texto libre recibe la ayuda y el teclado de botones. */

export interface CommandHelp {
  command: string;
  usage: string;
  description: string;
}

/** Comandos que existen, en el orden en que se muestran. */
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
  {
    command: 'tc',
    usage: '/tc 780 [03]',
    description: 'Fijar la tasa de cambio del día.',
  },
  {
    command: 'deshacer',
    usage: '/deshacer',
    description: 'Revertir la última escritura en la hoja.',
  },
  {
    command: 'hoy',
    usage: '/hoy',
    description: 'Resumen de hoy (o del último día cargado).',
  },
  {
    command: 'dia',
    usage: '/dia [03]',
    description: 'Resumen de un día: venta, costo, utilidad, gastos, top 5 y alertas.',
  },
  {
    command: 'mes',
    usage: '/mes',
    description: 'Cada día del mes con su utilidad, la suma y el margen promedio.',
  },
  {
    command: 'semana',
    usage: '/semana',
    description: 'Lo mismo que /mes para los últimos 7 días.',
  },
  {
    command: 'rango',
    usage: '/rango 02 04',
    description: 'Lo mismo que /mes entre dos días.',
  },
  {
    command: 'ganancia',
    usage: '/ganancia',
    description: 'Ganancia acumulada: según las hojas y ajustada (estimado).',
  },
  {
    command: 'gastos',
    usage: '/gastos [02 04]',
    description: 'Gastos por día y por concepto.',
  },
  {
    command: 'inversion',
    usage: '/inversion [02 04]',
    description: 'Inversión inicial, compras, vendido e inversión final por día.',
  },
  {
    command: 'top',
    usage: '/top [5] [venta|utilidad|unidades] [02 04]',
    description: 'Ranking de productos.',
  },
  {
    command: 'margen',
    usage: '/margen [02 04]',
    description: 'Productos por margen; alerta los de alta rotación con margen < 15%.',
  },
  {
    command: 'fila',
    usage: '/fila pollo 03',
    description: 'Toda la fila de un producto en un día.',
  },
  {
    command: 'producto',
    usage: '/producto pollo [02 04]',
    description: 'Suma de todas las filas de un producto y su detalle por día.',
  },
  { command: 'ayuda', usage: '/ayuda', description: 'Ver esta lista.' },
];

export function commandsFor(role: Role): CommandHelp[] {
  return MVP_COMMANDS.filter((entry) => canRunCommand(role, entry.command));
}

export function helpText(role: Role): string {
  const lines = ['📖 Comandos disponibles:', ''];
  for (const entry of commandsFor(role)) lines.push(`${entry.usage} — ${entry.description}`);
  lines.push(
    '',
    'Los botones de abajo hacen lo mismo sin escribir: los que necesitan un dato (día, producto, TC) te lo preguntan. /cancelar abandona la pregunta.',
    'Toda escritura en la hoja pide confirmación antes (✅ / ❌).',
  );
  return lines.join('\n');
}

/** Respuesta al texto libre: el bot no interpreta lenguaje natural en el MVP. */
export const FREE_TEXT_REPLY =
  'No entiendo mensajes libres todavía. Usa los botones de abajo o /ayuda.';
