import { z } from 'zod';
import { parseRelease, type ReleaseInfo } from './core/release.js';

/** Error de configuración con un mensaje legible para quien despliega el bot. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Convierte cadenas vacías en `undefined` para que cuenten como variable ausente. */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
);

const ownerIds = z
  .string({ error: 'OWNER_IDS es obligatorio (IDs de Telegram separados por coma)' })
  .transform((raw, ctx) => {
    const ids = raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    const parsed = ids.map(Number);
    if (ids.length === 0 || parsed.some((id) => !Number.isSafeInteger(id))) {
      ctx.addIssue({
        code: 'custom',
        message: 'OWNER_IDS debe contener IDs numéricos de Telegram separados por coma',
      });
      return z.NEVER;
    }
    return parsed;
  });

const envSchema = z.object({
  TELEGRAM_TOKEN: z
    .string({ error: 'TELEGRAM_TOKEN es obligatorio (lo entrega @BotFather)' })
    .min(1, 'TELEGRAM_TOKEN es obligatorio (lo entrega @BotFather)'),
  OWNER_IDS: ownerIds,
  ANTHROPIC_API_KEY: optionalString,
  GOOGLE_SA_JSON: optionalString,
  DRIVE_IPV_FOLDER_ID: optionalString,
  CUADRE_SHEET_ID: optionalString,
  // Vacía cuenta como ausente (la plantilla .env.example la trae sin valor).
  CUADRE_SHEET_MONTH: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .regex(
        /^\d{4}-(0[1-9]|1[0-2])$/,
        'CUADRE_SHEET_MONTH debe ser un mes AAAA-MM, por ejemplo 2026-10',
      )
      .default('2026-10'),
  ),
  CUADRE_SEED_PATH: optionalString,
  GASTOS_SPREADSHEET_ID: optionalString,
  APP_VERSION: optionalString,
  RELEASE_NOTES: optionalString,
  DB_PATH: z.string().default('./data/kilo12.db'),
  TZ: z.string().default('America/Havana'),
});

export interface Config {
  telegramToken: string;
  ownerIds: number[];
  anthropicApiKey: string | undefined;
  googleServiceAccountJson: string | undefined;
  driveIpvFolderId: string | undefined;
  cuadreSheetId: string | undefined;
  /**
   * Mes del libro de CUADRE_SHEET_ID (`2026-10`). Al arrancar queda registrado para ese
   * mes; los demás meses se registran con /cuadremes.
   */
  cuadreSheetMonth: string;
  /** Cuadre exportado (.xlsx) para la carga inicial del catálogo si la base está vacía. */
  cuadreSeedPath: string | undefined;
  /** Hoja "Gastos": historial de gastos que llena /gasto. */
  expensesSheetId: string | undefined;
  dbPath: string;
  timezone: string;
  /** Versión fijada al construir la imagen (scripts/deploy.sh); null en desarrollo. */
  release: ReleaseInfo | null;
  /** Sin service account o sin hoja de cuadre, el bot usa una hoja simulada en memoria. */
  useFakeSheets: boolean;
  /** Sin service account o sin hoja de gastos, /gasto guarda en memoria y lo avisa. */
  useFakeExpenses: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Configuración inválida:\n${detail}`);
  }

  const parsed = result.data;
  return {
    telegramToken: parsed.TELEGRAM_TOKEN,
    ownerIds: parsed.OWNER_IDS,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    googleServiceAccountJson: parsed.GOOGLE_SA_JSON,
    driveIpvFolderId: parsed.DRIVE_IPV_FOLDER_ID,
    cuadreSheetId: parsed.CUADRE_SHEET_ID,
    cuadreSheetMonth: parsed.CUADRE_SHEET_MONTH,
    cuadreSeedPath: parsed.CUADRE_SEED_PATH,
    expensesSheetId: parsed.GASTOS_SPREADSHEET_ID,
    dbPath: parsed.DB_PATH,
    timezone: parsed.TZ,
    release: parseRelease(parsed.APP_VERSION, parsed.RELEASE_NOTES),
    useFakeSheets: parsed.GOOGLE_SA_JSON === undefined || parsed.CUADRE_SHEET_ID === undefined,
    useFakeExpenses:
      parsed.GOOGLE_SA_JSON === undefined || parsed.GASTOS_SPREADSHEET_ID === undefined,
  };
}
