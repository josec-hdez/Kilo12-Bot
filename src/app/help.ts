import { canRunCommand, type Role } from '../core/auth.js';
import { needsMonth } from './month-pick.js';

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
      'Cargar el IPV del día: envía (o reenvía) el .xlsx. Si tiene varias hojas, te pregunto cuál analizar; o escribe el nombre de la hoja en el pie del archivo, por ejemplo 3 oct. Si la hoja no tiene fecha, pregunto la hoja, después el mes y después el día; un archivo con fecha no pregunta el mes.',
  },
  {
    command: 'validar',
    usage: '/validar [03|semana]',
    description: 'Revisar errores del cuadre por severidad 🔴🟡⚪.',
  },
  {
    command: 'tc',
    usage: '/tc 780 [03]',
    description:
      'Fijar la tasa de cambio en el mes que elijas: sin día, la pestaña de hoy (solo en el mes en curso); en un mes pasado escribe también el día, por ejemplo /tc 780 05 (con el botón 💱 TC: 780 05).',
  },
  {
    command: 'gasto',
    usage: '/gasto',
    description:
      'Registrar un gasto en la hoja Gastos (historial): fecha (hoy u otro día), cantidad, moneda y descripción. No cambia el cuadre.',
  },
  {
    command: 'deshacer',
    usage: '/deshacer',
    description: 'Revertir la última escritura en la hoja.',
  },
  {
    command: 'cuadremes',
    usage: '/cuadremes [2026-11 enlace]',
    description:
      'Libro de cuadre de cada mes: sin datos, la lista; con mes y enlace, registra la copia nueva (Archivo → Hacer una copia, compartida con el bot).',
  },
  {
    command: 'cierremes',
    usage: '/cierremes [2026-10] [reabrir]',
    description:
      'Revisar y cerrar un mes: días que faltan, errores, continuidad, productos sin costo e inventario final. Sin mes: del 1 al 10, el anterior; después, el actual.',
  },
  {
    command: 'equivalencia',
    usage: '/equivalencia [cuadre = IPV | quitar IPV]',
    description:
      'Nombres del IPV que son el mismo producto del cuadre: sin datos, la lista; «pollo = pollo lb» agrega; «quitar pollo lb» quita. También se eligen en la vista previa de /ipv.',
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

/** Nota del selector de mes: solo para quien puede correr algún comando que lo usa. */
export function monthPickerNote(role: Role): string | null {
  const scoped = commandsFor(role).filter((entry) => needsMonth(entry.command));
  if (scoped.length === 0) return null;
  const list = scoped.map((entry) => `/${entry.command}`).join(', ');
  const unscoped = commandsFor(role)
    .filter((entry) => entry.command !== 'ayuda' && !needsMonth(entry.command))
    .map((entry) =>
      entry.command === 'ipv' ? '/ipv con un archivo con fecha' : `/${entry.command}`,
    );
  const skip = unscoped.length > 0 ? ` No preguntan el mes: ${unscoped.join(', ')}.` : '';
  return `📒 Antes de ${list} te pregunto el mes con botones (🔒 = mes cerrado; solo aparecen los meses con días cargados).${skip}`;
}

export function helpText(role: Role): string {
  const lines = ['📖 Comandos disponibles:', ''];
  for (const entry of commandsFor(role)) lines.push(`${entry.usage} — ${entry.description}`);
  const note = monthPickerNote(role);
  if (note !== null) lines.push('', note);
  lines.push(
    '',
    'Los botones de abajo hacen lo mismo sin escribir: los que necesitan un dato (día, producto, TC, gasto) te lo preguntan. /cancelar abandona la pregunta.',
    'Toda escritura en una hoja pide confirmación antes (✅ / ❌).',
  );
  return lines.join('\n');
}

/** Respuesta al texto libre: el bot no interpreta lenguaje natural en el MVP. */
export const FREE_TEXT_REPLY =
  'No entiendo mensajes libres todavía. Usa los botones de abajo o /ayuda.';
