import { canRunCommand, type Role } from '../core/auth.js';
import type { User } from '../ports/repositories.js';
import { commandsFor } from './help.js';

/**
 * Teclado fijo de botones y menú "/" de Telegram, ambos por rol. Puro: el adaptador
 * de Telegram solo los dibuja. Un rol nunca ve un botón ni un comando que no puede
 * usar, porque los dos salen de la matriz de permisos.
 */

/** Qué pasa al tocar un botón. */
export const BUTTON_FLOW = {
  /** Ejecuta el comando sin argumentos. */
  RUN: 'run',
  /** "¿Qué día?" → botones de días. */
  ASK_DAY: 'ask_day',
  /** "¿Desde?" → días → "¿Hasta?" → días. */
  ASK_RANGE: 'ask_range',
  /** "¿Qué producto?" → texto. */
  ASK_PRODUCT: 'ask_product',
  /** Producto (texto) → día (botones). */
  ASK_ROW: 'ask_row',
  /** [Venta] [Utilidad] [Unidades]. */
  ASK_TOP_METRIC: 'ask_top_metric',
  /** "¿Cuál es la TC de hoy?" → texto. */
  ASK_TC: 'ask_tc',
  /** "Envía el Excel del IPV". */
  ASK_IPV: 'ask_ipv',
} as const;

export type ButtonFlow = (typeof BUTTON_FLOW)[keyof typeof BUTTON_FLOW];

export interface MenuButton {
  label: string;
  command: string;
  flow: ButtonFlow;
}

/** Todos los botones, en el orden en que se muestran (3 por fila). */
export const MENU_BUTTONS: readonly MenuButton[] = [
  { label: '📅 Hoy', command: 'hoy', flow: BUTTON_FLOW.RUN },
  { label: '📆 Mes', command: 'mes', flow: BUTTON_FLOW.RUN },
  { label: '🗓 Semana', command: 'semana', flow: BUTTON_FLOW.RUN },
  { label: '💰 Ganancia', command: 'ganancia', flow: BUTTON_FLOW.RUN },
  { label: '💸 Gastos', command: 'gastos', flow: BUTTON_FLOW.RUN },
  { label: '📦 Inversión', command: 'inversion', flow: BUTTON_FLOW.RUN },
  { label: '🏆 Top', command: 'top', flow: BUTTON_FLOW.ASK_TOP_METRIC },
  { label: '📊 Margen', command: 'margen', flow: BUTTON_FLOW.RUN },
  { label: '🔍 Producto', command: 'producto', flow: BUTTON_FLOW.ASK_PRODUCT },
  { label: '📄 Fila', command: 'fila', flow: BUTTON_FLOW.ASK_ROW },
  { label: '📍 Día', command: 'dia', flow: BUTTON_FLOW.ASK_DAY },
  { label: '↔️ Rango', command: 'rango', flow: BUTTON_FLOW.ASK_RANGE },
  { label: '📥 IPV', command: 'ipv', flow: BUTTON_FLOW.ASK_IPV },
  { label: '🔎 Validar', command: 'validar', flow: BUTTON_FLOW.RUN },
  { label: '💱 TC', command: 'tc', flow: BUTTON_FLOW.ASK_TC },
  { label: '↩️ Deshacer', command: 'deshacer', flow: BUTTON_FLOW.RUN },
  { label: '❓ Ayuda', command: 'ayuda', flow: BUTTON_FLOW.RUN },
];

export const KEYBOARD_COLUMNS = 3;

/** Botones que el rol puede usar, en el orden del catálogo. */
export function buttonsFor(role: Role): MenuButton[] {
  return MENU_BUTTONS.filter((button) => canRunCommand(role, button.command));
}

/** Filas del teclado del rol: los botones permitidos, de 3 en 3. */
export function keyboardRowsFor(role: Role): string[][] {
  const labels = buttonsFor(role).map((button) => button.label);
  const rows: string[][] = [];
  for (let i = 0; i < labels.length; i += KEYBOARD_COLUMNS) {
    rows.push(labels.slice(i, i + KEYBOARD_COLUMNS));
  }
  return rows;
}

/**
 * El texto que manda un botón, sin variaciones de emoji: algunos teclados agregan o
 * quitan el selector U+FE0F ("↩️" vs "↩") y espacios.
 */
export function normalizeLabel(text: string): string {
  return text.replace(/[︎️‍]/g, '').replace(/\s+/g, ' ').trim();
}

const BY_LABEL: ReadonlyMap<string, MenuButton> = new Map(
  MENU_BUTTONS.map((button) => [normalizeLabel(button.label), button]),
);

/** El botón que corresponde a un mensaje de texto, si es uno de los del teclado. */
export function buttonForText(text: string): MenuButton | undefined {
  return BY_LABEL.get(normalizeLabel(text));
}

// ---------------------------------------------------------------- menú "/"

export interface MenuCommand {
  command: string;
  description: string;
}

/** Descripción corta para el menú "/" de Telegram (la larga está en /ayuda). */
const MENU_DESCRIPTION: Readonly<Record<string, string>> = {
  ipv: 'Cargar el IPV del día',
  validar: 'Revisar errores del cuadre',
  tc: 'Fijar la tasa de cambio del día',
  deshacer: 'Revertir la última escritura',
  hoy: 'Resumen de hoy',
  dia: 'Resumen de un día',
  mes: 'Utilidad de cada día del mes',
  semana: 'Resumen de los últimos 7 días',
  rango: 'Resumen entre dos días',
  ganancia: 'Ganancia acumulada',
  gastos: 'Gastos por día',
  inversion: 'Inversión por día',
  top: 'Ranking de productos',
  margen: 'Productos por margen',
  fila: 'Fila de un producto en un día',
  producto: 'Totales de un producto',
  ayuda: 'Ver los comandos y el teclado',
  cancelar: 'Cancelar lo que está en curso',
};

const CANCEL: MenuCommand = { command: 'cancelar', description: 'Cancelar lo que está en curso' };

/** Lo que ve cualquiera que abra el bot sin estar registrado: nada que revele datos. */
export const DEFAULT_MENU: readonly MenuCommand[] = [
  { command: 'ayuda', description: 'Ver los comandos y el teclado' },
  CANCEL,
];

/** Comandos del menú "/" para un rol, en el orden de /ayuda, más /cancelar. */
export function menuCommandsFor(role: Role): MenuCommand[] {
  return [
    ...commandsFor(role).map((entry) => ({
      command: entry.command,
      description: MENU_DESCRIPTION[entry.command] ?? entry.description,
    })),
    CANCEL,
  ];
}

export const MENU_SCOPE = {
  DEFAULT: 'default',
  CHAT: 'chat',
} as const;

export type MenuScope =
  { type: typeof MENU_SCOPE.DEFAULT } | { type: typeof MENU_SCOPE.CHAT; chat_id: number };

/** Un `setMyCommands` (o `deleteMyCommands` si `commands` es `null`). */
export interface MenuAssignment {
  scope: MenuScope;
  commands: MenuCommand[] | null;
}

/**
 * Menús a publicar: el general (mínimo) y uno por usuario activo según su rol. Los
 * usuarios desactivados pierden su menú propio y vuelven al general.
 */
export function menuAssignments(users: readonly User[]): MenuAssignment[] {
  return [
    { scope: { type: MENU_SCOPE.DEFAULT }, commands: [...DEFAULT_MENU] },
    ...users.map((user) => userMenuAssignment(user)),
  ];
}

export function userMenuAssignment(user: User): MenuAssignment {
  return {
    scope: { type: MENU_SCOPE.CHAT, chat_id: user.telegramId },
    commands: user.active ? menuCommandsFor(user.role) : null,
  };
}
