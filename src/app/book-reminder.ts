import { ROLE } from '../core/auth.js';
import type { CalendarDate } from '../core/expense.js';
import {
  bookReminderDue,
  isoDate,
  monthName,
  parseClockTime,
  type MonthKey,
} from '../core/months.js';
import { DEFAULT_SETTINGS, SETTING } from '../core/settings.js';
import type { SettingsRepository, User, UserRepository } from '../ports/repositories.js';
import { readBookRegistry } from './cuadre-books.js';

/** Clave en la tabla de configuración: último día (`AAAA-MM-DD`) en que se recordó. */
export const BOOK_REMINDER_SENT_KEY = 'book_reminder_sent';

export type ReminderNotifier = (user: User, text: string) => Promise<void>;

export interface BookReminderDeps {
  settings: SettingsRepository;
  users: UserRepository;
  notify: ReminderNotifier;
}

export interface ReminderNow {
  today: CalendarDate;
  /** Minutos desde la medianoche en la zona del negocio. */
  minutesNow: number;
}

export interface ReminderResult {
  month: MonthKey;
  ok: number;
  failed: number;
}

export function bookReminderText(month: MonthKey): string {
  return [
    `⚠️ Falta el libro de cuadre de ${monthName(month)}.`,
    '',
    '1. Abre el cuadre de este mes → Archivo → Hacer una copia.',
    `2. Ponle de nombre «Cuadre K12 ${month}» y borra las pestañas de los días (deja _plantilla).`,
    '3. Compártelo con la cuenta del bot como Editor.',
    `4. Envíame /cuadremes ${month} <enlace de la copia>.`,
    '',
    `Sin ese libro no se puede cargar ningún IPV de ${monthName(month)}.`,
  ].join('\n');
}

/**
 * Desde el día 25, a la hora de apertura, recuerda a las dueñas que falta el libro del
 * mes siguiente; una vez por día hasta que lo registren. Devuelve null si no tocaba.
 */
export async function remindMissingBook(
  deps: BookReminderDeps,
  { today, minutesNow }: ReminderNow,
): Promise<ReminderResult | null> {
  const opening =
    parseClockTime(deps.settings.get(SETTING.OPENING_TIME)) ??
    parseClockTime(DEFAULT_SETTINGS[SETTING.OPENING_TIME]) ??
    0;
  const lastSent = deps.settings.get(BOOK_REMINDER_SENT_KEY);
  const month = bookReminderDue({
    today,
    minutesNow,
    atMinutes: opening,
    registered: new Set(Object.keys(readBookRegistry(deps.settings))),
    lastSent: typeof lastSent === 'string' ? lastSent : null,
  });
  if (month === null) return null;

  // Se marca antes de enviar: un reinicio a mitad no repite el aviso el mismo día.
  deps.settings.set(BOOK_REMINDER_SENT_KEY, isoDate(today));

  const text = bookReminderText(month);
  const result: ReminderResult = { month, ok: 0, failed: 0 };
  const owners = deps.users.list().filter((user) => user.active && user.role === ROLE.OWNER);
  for (const owner of owners) {
    try {
      await deps.notify(owner, text);
      result.ok++;
    } catch (error) {
      result.failed++;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `No pude recordar el libro de ${month} a ${String(owner.telegramId)}: ${reason}`,
      );
    }
  }
  return result;
}
