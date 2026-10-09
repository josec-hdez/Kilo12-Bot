import { access } from 'node:fs/promises';
import { ConfigError } from '../config.js';

/**
 * Abre el cuadre de CUADRE_SEED_PATH. Si el archivo no está o no se puede leer, es un
 * error de configuración: el bot termina con un mensaje claro en lugar de reiniciarse
 * en bucle (Docker solo reinicia ante fallos, y ConfigError sale con código 0).
 */
export async function openSeedFile<T>(
  path: string,
  open: (path: string) => Promise<T>,
  exists: (path: string) => Promise<boolean> = fileExists,
): Promise<T> {
  if (!(await exists(path))) {
    throw new ConfigError(
      `No encuentro el archivo de CUADRE_SEED_PATH: ${path}. ` +
        'Ponlo en ./data y usa /app/data/<archivo> (dentro de Docker solo se ve la carpeta data).',
    );
  }
  try {
    return await open(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(
      `No pude leer el archivo de CUADRE_SEED_PATH (${path}): ${reason}. ` +
        'Debe ser el cuadre exportado como .xlsx.',
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
