import { canRunCommand, commandPermission, PERMISSION } from '../core/auth.js';
import {
  ACCESS_OUTCOME,
  type AccessLogRepository,
  type User,
  type UserRepository,
} from '../ports/repositories.js';

export const AUTH_STATUS = {
  ALLOWED: 'allowed',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
} as const;

export interface AuthDeps {
  users: UserRepository;
  accessLog: AccessLogRepository;
}

export interface AuthRequest {
  telegramId: number;
  username: string | null;
  /** Comando tal como llegó (`/tc@kilo12_bot`), o `null` si es texto libre o un botón. */
  command: string | null;
}

export type AuthResult =
  | { status: typeof AUTH_STATUS.ALLOWED; user: User }
  | { status: typeof AUTH_STATUS.UNAUTHORIZED; message: string }
  | { status: typeof AUTH_STATUS.FORBIDDEN; user: User; message: string };

const UNAUTHORIZED_MESSAGE = 'No autorizado.';
const FORBIDDEN_MESSAGE = 'Tu rol no permite este comando. Usa /ayuda para ver los tuyos.';
const FORBIDDEN_REPORT_MESSAGE =
  'No autorizado para reportes: tu rol no ve costos ni utilidades. Usa /ayuda para ver tus comandos.';

function forbiddenMessage(command: string): string {
  return commandPermission(command) === PERMISSION.VIEW_FINANCIALS
    ? FORBIDDEN_REPORT_MESSAGE
    : FORBIDDEN_MESSAGE;
}

/**
 * Whitelist + permisos por rol. Todo rechazo queda en el log de accesos. El texto
 * libre de un usuario autorizado se permite: el bot responde con su menú (sin IA).
 */
export function authorize({ users, accessLog }: AuthDeps, request: AuthRequest): AuthResult {
  const user = users.findActive(request.telegramId);
  if (user === undefined) {
    accessLog.record({ ...request, outcome: ACCESS_OUTCOME.UNAUTHORIZED });
    return { status: AUTH_STATUS.UNAUTHORIZED, message: UNAUTHORIZED_MESSAGE };
  }

  if (request.command !== null && !canRunCommand(user.role, request.command)) {
    accessLog.record({ ...request, outcome: ACCESS_OUTCOME.FORBIDDEN });
    return { status: AUTH_STATUS.FORBIDDEN, user, message: forbiddenMessage(request.command) };
  }

  return { status: AUTH_STATUS.ALLOWED, user };
}
