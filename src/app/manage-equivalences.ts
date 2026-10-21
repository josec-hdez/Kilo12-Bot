import { equivalenceCandidates } from '../core/mapping.js';
import { normalizeName } from '../core/tabs.js';
import type { CuadreReader } from '../ports/cuadre-source.js';
import type {
  CatalogRepository,
  ChangeLogRepository,
  SettingsRepository,
} from '../ports/repositories.js';

/**
 * Equivalencias IPV ↔ cuadre que gestionan las dueñas desde el bot: con /equivalencia
 * o eligiendo un candidato en la vista previa de /ipv. Cada cambio queda en el log, y
 * la tabla inicial del código (core/equivalences.ts) ya no pisa lo que ellas decidieron.
 */

export interface EquivalenceDeps {
  catalog: CatalogRepository;
  changeLog: ChangeLogRepository;
  settings: SettingsRepository;
}

/** Alias (normalizados) que una dueña agregó, movió o quitó: la tabla del código no los toca. */
export const OWNER_ALIASES_SETTING = 'owner_aliases';

export function readOwnerAliases(settings: SettingsRepository): Set<string> {
  const raw = settings.get(OWNER_ALIASES_SETTING);
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((alias): alias is string => typeof alias === 'string'));
}

function markOwnerAlias(settings: SettingsRepository, alias: string): void {
  const aliases = readOwnerAliases(settings);
  aliases.add(normalizeName(alias));
  settings.set(OWNER_ALIASES_SETTING, [...aliases].sort());
}

export const EQUIVALENCE_REQUEST = {
  LIST: 'list',
  ADD: 'add',
  REMOVE: 'remove',
  INVALID: 'invalid',
} as const;

export type EquivalenceRequest =
  | { kind: typeof EQUIVALENCE_REQUEST.LIST }
  | { kind: typeof EQUIVALENCE_REQUEST.ADD; cuadre: string; ipv: string }
  | { kind: typeof EQUIVALENCE_REQUEST.REMOVE; ipv: string }
  | { kind: typeof EQUIVALENCE_REQUEST.INVALID; message: string };

export const EQUIVALENCE_USAGE =
  'Uso: /equivalencia (la lista) · /equivalencia <nombre en el cuadre> = <nombre en el IPV> · /equivalencia quitar <nombre en el IPV>';

const REMOVE_PATTERN = /^quitar\s+(.+)$/i;
const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function parseEquivalenceArgs(args: string): EquivalenceRequest {
  const text = clean(args);
  if (text === '') return { kind: EQUIVALENCE_REQUEST.LIST };

  const remove = REMOVE_PATTERN.exec(text);
  if (remove?.[1] !== undefined) return { kind: EQUIVALENCE_REQUEST.REMOVE, ipv: clean(remove[1]) };

  const parts = text.split('=');
  const cuadre = clean(parts[0] ?? '');
  const ipv = clean(parts.slice(1).join('='));
  if (parts.length !== 2 || cuadre === '' || ipv === '') {
    return { kind: EQUIVALENCE_REQUEST.INVALID, message: EQUIVALENCE_USAGE };
  }
  return { kind: EQUIVALENCE_REQUEST.ADD, cuadre, ipv };
}

/** Telegram corta en 4096 caracteres: cada página queda por debajo. */
const PAGE_CHARS = 3500;

/** La lista agrupada por producto del cuadre, en páginas para el chat. */
export function equivalenceListPages(catalog: CatalogRepository): string[] {
  const equivalences = catalog
    .equivalences()
    .sort((a, b) => a.cuadre.localeCompare(b.cuadre, 'es'));
  if (equivalences.length === 0) {
    return [`📚 Todavía no hay equivalencias.\n${EQUIVALENCE_USAGE}`];
  }

  const aliases = equivalences.reduce((total, item) => total + item.ipv.length, 0);
  const header = `📚 Equivalencias: ${String(equivalences.length)} productos del cuadre, ${String(aliases)} nombres del IPV.\nCuadre ← IPV`;
  const pages: string[] = [];
  let page = header;
  for (const { cuadre, ipv } of equivalences) {
    const line = `• ${cuadre} ← ${ipv.join(', ')}`;
    if (page.length + line.length + 1 > PAGE_CHARS) {
      pages.push(page);
      page = line;
    } else {
      page += `\n${line}`;
    }
  }
  pages.push(`${page}\n\n${EQUIVALENCE_USAGE}`);
  return pages;
}

/**
 * Nombres del cuadre que se pueden usar: los del catálogo y los de la última pestaña
 * del cuadre (un producto nuevo puede estar en la hoja antes que en el catálogo).
 */
export async function knownCuadreProducts(
  catalog: CatalogRepository,
  cuadre: CuadreReader,
): Promise<string[]> {
  const names = new Map<string, string>();
  for (const product of catalog.listProducts())
    names.set(normalizeName(product.name), product.name);
  try {
    const last = (await cuadre.listDays()).at(-1);
    if (last !== undefined) {
      for (const row of (await cuadre.readDay(last)).rows) {
        const key = normalizeName(row.product);
        if (key !== '' && !names.has(key)) names.set(key, row.product.trim());
      }
    }
  } catch {
    // Sin la hoja quedan los nombres del catálogo: alcanzan para casi todo.
  }
  return [...names.values()];
}

export const ALIAS_CHANGE = {
  ADD: 'add',
  REMOVE: 'remove',
} as const;

export type AliasChange =
  | {
      kind: typeof ALIAS_CHANGE.ADD;
      product: string;
      alias: string;
      /** Producto que tenía el alias: se le quita al confirmar. */
      previousOwner: string | null;
    }
  | { kind: typeof ALIAS_CHANGE.REMOVE; alias: string; owner: string };

export const ALIAS_PREPARE = {
  READY: 'ready',
  REJECTED: 'rejected',
} as const;

export type AliasPrepareResult =
  | { status: typeof ALIAS_PREPARE.READY; change: AliasChange; preview: string }
  | { status: typeof ALIAS_PREPARE.REJECTED; message: string };

const rejected = (message: string): AliasPrepareResult => ({
  status: ALIAS_PREPARE.REJECTED,
  message,
});

/** Vista previa de `/equivalencia <cuadre> = <ipv>`. No guarda nada. */
export function prepareAddAlias(
  catalog: CatalogRepository,
  request: { cuadre: string; ipv: string },
  known: readonly string[],
): AliasPrepareResult {
  const product = known.find((name) => normalizeName(name) === normalizeName(request.cuadre));
  if (product === undefined) {
    const close = equivalenceCandidates(request.cuadre, known).map((s) => s.product);
    const hint = close.length === 0 ? '' : ` ¿Quisiste decir: ${close.join(', ')}?`;
    return rejected(
      `«${request.cuadre}» no está en el cuadre. Escribe el nombre exacto del cuadre a la izquierda del =.${hint}`,
    );
  }
  if (normalizeName(product) === normalizeName(request.ipv)) {
    return rejected(
      `«${request.ipv}» ya se llama igual en el cuadre: se empareja solo, no hace falta equivalencia.`,
    );
  }

  const owner = catalog.aliasOwner(request.ipv);
  if (owner !== null && normalizeName(owner) === normalizeName(product)) {
    return rejected(`«${request.ipv}» ya es equivalencia de ${owner}. No hay nada que cambiar.`);
  }

  const change: AliasChange = {
    kind: ALIAS_CHANGE.ADD,
    product,
    alias: request.ipv,
    previousOwner: owner,
  };
  const lines = [
    '🔗 Nueva equivalencia',
    `Cuadre: ${product}`,
    `IPV: ${request.ipv}`,
    '',
    `Desde la próxima carga del IPV, «${request.ipv}» se escribe en la fila de ${product}, con su costo.`,
  ];
  if (owner !== null) {
    lines.push(
      `⚠️ Hoy «${request.ipv}» es equivalencia de ${owner}: se le quita y pasa a ${product}.`,
    );
  }
  lines.push('Las pestañas ya escritas no cambian.');
  return { status: ALIAS_PREPARE.READY, change, preview: lines.join('\n') };
}

/** Vista previa de `/equivalencia quitar <ipv>`. No guarda nada. */
export function prepareRemoveAlias(catalog: CatalogRepository, ipv: string): AliasPrepareResult {
  const owner = catalog.aliasOwner(ipv);
  if (owner === null) {
    return rejected(
      `«${ipv}» no es equivalencia de ningún producto. Mira la lista con /equivalencia.`,
    );
  }
  return {
    status: ALIAS_PREPARE.READY,
    change: { kind: ALIAS_CHANGE.REMOVE, alias: ipv, owner },
    preview: [
      '✂️ Quitar equivalencia',
      `Cuadre: ${owner}`,
      `IPV: ${ipv}`,
      '',
      `Desde la próxima carga del IPV, «${ipv}» ya no se junta con ${owner}: si aparece, entra como producto nuevo.`,
      'Las pestañas ya escritas no cambian.',
    ].join('\n'),
  };
}

/** Guarda el cambio confirmado, lo registra en el log y devuelve el texto para el chat. */
export function applyAliasChange(
  deps: EquivalenceDeps,
  telegramId: number,
  change: AliasChange,
): string {
  const { catalog, changeLog, settings } = deps;
  if (change.kind === ALIAS_CHANGE.REMOVE) {
    const owner = catalog.removeAlias(change.alias);
    if (owner === null) return `«${change.alias}» ya no era equivalencia de ningún producto.`;
    markOwnerAlias(settings, change.alias);
    changeLog.record({
      telegramId,
      action: 'remove_equivalence',
      target: change.alias,
      detail: { product: owner },
    });
    return `✅ «${change.alias}» ya no es equivalencia de ${owner}.`;
  }

  const product =
    catalog.findProduct(change.product)?.name ?? catalog.ensureProduct(change.product).name;
  const current = catalog.aliasOwner(change.alias);
  if (current !== null && normalizeName(current) !== normalizeName(product)) {
    catalog.removeAlias(change.alias);
  }
  catalog.addAlias(product, change.alias);
  markOwnerAlias(settings, change.alias);
  changeLog.record({
    telegramId,
    action: current === null ? 'add_equivalence' : 'move_equivalence',
    target: change.alias,
    detail: { product, previousOwner: current },
  });
  return current === null || normalizeName(current) === normalizeName(product)
    ? `✅ «${change.alias}» ahora es equivalencia de ${product}.`
    : `✅ «${change.alias}» pasó de ${current} a ${product}.`;
}

/** Elección en la vista previa de /ipv: el producto del IPV es este del cuadre. */
export function saveIpvAlias(
  deps: EquivalenceDeps,
  telegramId: number,
  product: string,
  alias: string,
): string {
  return applyAliasChange(deps, telegramId, {
    kind: ALIAS_CHANGE.ADD,
    product,
    alias,
    previousOwner: deps.catalog.aliasOwner(alias),
  });
}
