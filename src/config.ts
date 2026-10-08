import { z } from 'zod';

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
  CUADRE_SEED_PATH: optionalString,
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
  /** Cuadre exportado (.xlsx) para la carga inicial del catálogo si la base está vacía. */
  cuadreSeedPath: string | undefined;
  dbPath: string;
  timezone: string;
  /** Sin service account o sin hoja de cuadre, el bot usa una hoja simulada en memoria. */
  useFakeSheets: boolean;
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
    cuadreSeedPath: parsed.CUADRE_SEED_PATH,
    dbPath: parsed.DB_PATH,
    timezone: parsed.TZ,
    useFakeSheets: parsed.GOOGLE_SA_JSON === undefined || parsed.CUADRE_SHEET_ID === undefined,
  };
}
