import type { Role } from '../core/auth.js';
import type {
  CatalogRepository,
  ChangeLogRepository,
  Clock,
  PendingActionRepository,
  SettingsRepository,
  SnapshotRepository,
} from '../ports/repositories.js';
import type { CuadreBooks } from '../ports/cuadre-books.js';

/**
 * Único camino de escritura en la hoja: vista previa → confirmación → snapshot →
 * escritura → log. Estos son los tipos que comparten sus pasos.
 */

export interface PipelineDeps {
  /**
   * Un libro de cuadre por mes. Cada escritura va al libro del mes de su día; de sus
   * pestañas (y de las del mes anterior) sale el último costo conocido al cargar el IPV.
   */
  books: CuadreBooks;
  /** Configuración: de aquí salen los meses cerrados con /cierremes. */
  settings: SettingsRepository;
  pending: PendingActionRepository;
  catalog: CatalogRepository;
  changeLog: ChangeLogRepository;
  snapshots: SnapshotRepository;
  clock: Clock;
}

/** Quién pide la escritura. */
export interface Actor {
  telegramId: number;
  role: Role;
}

export const PREPARE_STATUS = {
  /** Hay acción pendiente: mostrar la vista previa con ✅ Confirmar / ❌ Cancelar. */
  READY: 'ready',
  /** No se puede confirmar y quien la pidió no puede forzarla. */
  BLOCKED: 'blocked',
  /** No hay nada que preparar (pestaña existente, TC inválida, nada que deshacer…). */
  REJECTED: 'rejected',
} as const;

/** Producto del IPV sin equivalencia y los del cuadre que podrían ser el mismo. */
export interface AliasQuestion {
  ipvProduct: string;
  candidates: string[];
}

export interface PrepareReady {
  status: typeof PREPARE_STATUS.READY;
  pendingId: string;
  preview: string;
  /** Hay bloqueos: solo se ofrece "⚠️ Confirmar igual" (dueña + motivo). */
  requiresForce: boolean;
  /** Solo /ipv y solo para quien gestiona equivalencias: se preguntan tras la vista previa. */
  aliasQuestions?: AliasQuestion[];
}

export interface PrepareBlocked {
  status: typeof PREPARE_STATUS.BLOCKED;
  preview: string;
  aliasQuestions?: AliasQuestion[];
}

export interface PrepareRejected {
  status: typeof PREPARE_STATUS.REJECTED;
  message: string;
}

export type PrepareResult = PrepareReady | PrepareBlocked | PrepareRejected;

export const CONFIRM_STATUS = {
  DONE: 'done',
  NOT_FOUND: 'not_found',
  EXPIRED: 'expired',
  ALREADY_RESOLVED: 'already_resolved',
  NOT_OWNER: 'not_owner',
  /** Tiene bloqueos y se confirmó sin forzar. La acción sigue pendiente. */
  BLOCKED: 'blocked',
  /** Quiso forzar sin ser dueña. */
  FORBIDDEN: 'forbidden',
  /** Forzar exige un motivo, que queda en el log. */
  REASON_REQUIRED: 'reason_required',
  /** La escritura falló; lo que alcanzó a escribirse se revirtió. */
  FAILED: 'failed',
} as const;

export type ConfirmStatus = (typeof CONFIRM_STATUS)[keyof typeof CONFIRM_STATUS];

export interface ConfirmResult {
  status: ConfirmStatus;
  message: string;
}

/** Lo que devuelve cada escritura al ejecutarse. */
export interface ExecutionResult {
  ok: boolean;
  message: string;
}
