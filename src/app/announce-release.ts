import {
  ANNOUNCED_VERSION_KEY,
  releaseAnnouncementText,
  shouldAnnounce,
  type ReleaseInfo,
} from '../core/release.js';
import type { SettingsRepository, User, UserRepository } from '../ports/repositories.js';

/**
 * Envía el aviso a un usuario. El adaptador de Telegram adjunta el teclado de su rol,
 * así el aviso también le refresca los botones sin que tenga que enviar /start.
 */
export type ReleaseNotifier = (user: User, text: string) => Promise<void>;

export const ANNOUNCE_STATUS = {
  NO_VERSION: 'no_version',
  ALREADY_ANNOUNCED: 'already_announced',
  ANNOUNCED: 'announced',
} as const;

export type AnnounceStatus = (typeof ANNOUNCE_STATUS)[keyof typeof ANNOUNCE_STATUS];

export interface AnnounceResult {
  status: AnnounceStatus;
  ok: number;
  failed: number;
}

export interface AnnounceDeps {
  users: UserRepository;
  settings: SettingsRepository;
  notify: ReleaseNotifier;
  /** Pausa entre envíos para respetar los límites de Telegram. */
  pause: () => Promise<void>;
}

/**
 * Avisa a todos los usuarios activos si la versión es nueva. Un envío fallido (alguien
 * que bloqueó el bot o nunca lo abrió) se registra y no detiene a los demás.
 */
export async function announceRelease(
  deps: AnnounceDeps,
  release: ReleaseInfo | null,
): Promise<AnnounceResult> {
  if (release === null) return { status: ANNOUNCE_STATUS.NO_VERSION, ok: 0, failed: 0 };
  if (!shouldAnnounce(release, deps.settings.get(ANNOUNCED_VERSION_KEY))) {
    return { status: ANNOUNCE_STATUS.ALREADY_ANNOUNCED, ok: 0, failed: 0 };
  }

  // Se guarda antes de enviar: si el proceso cae a mitad, un reinicio no repite el aviso.
  deps.settings.set(ANNOUNCED_VERSION_KEY, release.version);

  const text = releaseAnnouncementText(release);
  const result: AnnounceResult = { status: ANNOUNCE_STATUS.ANNOUNCED, ok: 0, failed: 0 };
  const recipients = deps.users.list().filter((user) => user.active);
  for (const [index, user] of recipients.entries()) {
    if (index > 0) await deps.pause();
    try {
      await deps.notify(user, text);
      result.ok++;
    } catch (error) {
      result.failed++;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `No pude avisar la versión nueva al usuario ${String(user.telegramId)}: ${reason}`,
      );
    }
  }
  return result;
}
