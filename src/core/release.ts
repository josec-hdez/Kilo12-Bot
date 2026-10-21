/**
 * Aviso de versión nueva. La versión (commit corto) y las notas (títulos de los PR
 * mezclados) se fijan al construir la imagen de Docker; al arrancar, el bot avisa a
 * todos los usuarios autorizados si la versión difiere de la última que anunció.
 */

/** Clave en la tabla de configuración: última versión anunciada. */
export const ANNOUNCED_VERSION_KEY = 'announced_version';

/** Separador de notas en RELEASE_NOTES: `\n` escrito como texto (dos caracteres). */
const ESCAPED_NEWLINE = '\\n';

export interface ReleaseInfo {
  version: string;
  notes: string[];
}

/**
 * Lee la versión de las variables de entorno. Sin versión (desarrollo local o una
 * imagen construida sin el script de despliegue) devuelve null: no se anuncia nada.
 */
export function parseRelease(
  version: string | undefined,
  notes: string | undefined,
): ReleaseInfo | null {
  const trimmed = version?.trim() ?? '';
  if (trimmed === '') return null;
  return { version: trimmed, notes: parseReleaseNotes(notes) };
}

/** Una nota por línea; acepta saltos reales o `\n` escrito como texto. */
export function parseReleaseNotes(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(ESCAPED_NEWLINE)
    .flatMap((part) => part.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Se anuncia solo si hay versión y es distinta de la última anunciada. */
export function shouldAnnounce(release: ReleaseInfo | null, lastAnnounced: unknown): boolean {
  if (release === null) return false;
  return lastAnnounced !== release.version;
}

export function releaseAnnouncementText(release: ReleaseInfo): string {
  const lines = [`🆕 Bot actualizado (v ${release.version})`];
  for (const note of release.notes) lines.push(`• ${note}`);
  lines.push('', 'Tu menú ya está actualizado.');
  return lines.join('\n');
}
