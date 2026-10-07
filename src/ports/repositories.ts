import type { Role } from '../core/auth.js';
import type { CostSource } from '../core/costs.js';
import type { Equivalence } from '../core/equivalences.js';
import type { Grid } from './sheets-gateway.js';

/** Reloj inyectable: las pruebas controlan el vencimiento de las confirmaciones. */
export type Clock = () => Date;

export interface User {
  telegramId: number;
  name: string | null;
  role: Role;
  active: boolean;
}

export interface UserRepository {
  findActive(telegramId: number): User | undefined;
  /** Crea o actualiza el usuario (rol, nombre, activo). */
  upsert(user: User): void;
  list(): User[];
}

export const ACCESS_OUTCOME = {
  /** Fuera de la whitelist o inactivo. */
  UNAUTHORIZED: 'unauthorized',
  /** Autorizado, pero su rol no permite el comando. */
  FORBIDDEN: 'forbidden',
} as const;

export type AccessOutcome = (typeof ACCESS_OUTCOME)[keyof typeof ACCESS_OUTCOME];

export interface AccessAttempt {
  telegramId: number;
  username: string | null;
  command: string | null;
  outcome: AccessOutcome;
}

export interface AccessLogEntry extends AccessAttempt {
  at: string;
}

export interface AccessLogRepository {
  record(attempt: AccessAttempt): void;
  list(): AccessLogEntry[];
}

export const PENDING_KIND = {
  LOAD_IPV: 'load_ipv',
  SET_TC: 'set_tc',
  UNDO: 'undo',
} as const;

export type PendingKind = (typeof PENDING_KIND)[keyof typeof PENDING_KIND];

export const PENDING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
} as const;

export type PendingStatus = (typeof PENDING_STATUS)[keyof typeof PENDING_STATUS];

export interface PendingAction {
  id: string;
  telegramId: number;
  kind: PendingKind;
  /** Lo que se escribirá al confirmar (ya validado y con la vista previa mostrada). */
  payload: unknown;
  status: PendingStatus;
  createdAt: Date;
  expiresAt: Date;
}

export interface NewPendingAction {
  telegramId: number;
  kind: PendingKind;
  payload: unknown;
}

export const RESOLVE_RESULT = {
  OK: 'ok',
  NOT_FOUND: 'not_found',
  EXPIRED: 'expired',
  ALREADY_RESOLVED: 'already_resolved',
  NOT_OWNER: 'not_owner',
} as const;

export type ResolveResult =
  | { status: typeof RESOLVE_RESULT.OK; action: PendingAction }
  | { status: typeof RESOLVE_RESULT.NOT_FOUND }
  | { status: typeof RESOLVE_RESULT.EXPIRED }
  | { status: typeof RESOLVE_RESULT.ALREADY_RESOLVED; resolution: PendingStatus }
  | { status: typeof RESOLVE_RESULT.NOT_OWNER };

export interface PendingActionRepository {
  create(action: NewPendingAction): PendingAction;
  get(id: string): PendingAction | undefined;
  /** Marca la acción como confirmada si sigue vigente y es de ese usuario. Atómico. */
  confirm(id: string, telegramId: number): ResolveResult;
  cancel(id: string, telegramId: number): ResolveResult;
  /** Marca como vencidas las acciones pendientes cuyo plazo pasó. Devuelve cuántas. */
  expireStale(): number;
}

export interface Product {
  id: number;
  name: string;
  cost: number | null;
  category: string | null;
  perishable: boolean;
  minStock: number | null;
  aliases: string[];
}

export interface CostChange {
  product: string;
  /** `null` o 0 deja el producto sin costo. */
  cost: number | null;
  source: string;
  changedBy: number | null;
}

export interface CatalogRepository {
  listProducts(): Product[];
  findProduct(name: string): Product | undefined;
  /** Crea el producto si no existe (por nombre normalizado). Devuelve el existente o el nuevo. */
  ensureProduct(name: string): Product;
  /** Asocia un alias del IPV a un producto. Falla si el alias ya pertenece a otro. */
  addAlias(product: string, alias: string): void;
  /** Cambia el costo vigente y lo registra en el historial. */
  setCost(change: CostChange): void;
  costHistory(product: string): CostHistoryEntry[];
  /** Equivalencias en el formato del core, para emparejar el IPV. */
  equivalences(): Equivalence[];
  /** Productos con su costo vigente, para armar el catálogo de costos del core. */
  costSources(): CostSource[];
}

export interface CostHistoryEntry {
  previousCost: number | null;
  cost: number | null;
  source: string;
  changedBy: number | null;
  at: string;
}

export interface SettingsRepository {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  all(): Record<string, unknown>;
}

export interface ChangeLogInput {
  telegramId: number | null;
  /** Qué se hizo: `load_ipv`, `set_tc`, `undo`… */
  action: string;
  /** Sobre qué: la pestaña (`03`) o el producto. */
  target: string | null;
  /** Detalle serializable; incluye el motivo cuando una dueña fuerza una confirmación. */
  detail: unknown;
}

export interface ChangeLogEntry extends ChangeLogInput {
  id: number;
  at: string;
}

export interface ChangeLogRepository {
  /** Devuelve el id de la entrada. */
  record(entry: ChangeLogInput): number;
  list(): ChangeLogEntry[];
}

export const SNAPSHOT_KIND = {
  /** Se creó una pestaña: deshacer = borrarla. */
  CREATE_TAB: 'create_tab',
  /** Se editaron celdas: deshacer = volver a escribir lo que había. */
  CELLS: 'cells',
} as const;

/** Contenido previo de un rango, leído con fórmulas y ya completado hasta su tamaño. */
export interface RangeSnapshot {
  a1: string;
  values: Grid;
}

export interface CreateTabSnapshot {
  kind: typeof SNAPSHOT_KIND.CREATE_TAB;
  tab: string;
}

export interface CellsSnapshot {
  kind: typeof SNAPSHOT_KIND.CELLS;
  tab: string;
  ranges: RangeSnapshot[];
}

export type SnapshotPayload = CreateTabSnapshot | CellsSnapshot;

export interface Snapshot {
  id: number;
  changeLogId: number | null;
  telegramId: number;
  payload: SnapshotPayload;
  createdAt: string;
  revertedAt: string | null;
}

export interface NewSnapshot {
  changeLogId: number | null;
  telegramId: number;
  payload: SnapshotPayload;
}

export interface SnapshotRepository {
  create(snapshot: NewSnapshot): Snapshot;
  get(id: number): Snapshot | undefined;
  /** La última escritura sin deshacer; de ese usuario, o de cualquiera si no se indica. */
  lastActive(telegramId?: number): Snapshot | undefined;
  markReverted(id: number): void;
}
