import { distance } from 'fastest-levenshtein';
import type { Equivalence } from './equivalences.js';
import { normalizeName } from './tabs.js';

export const MATCH_KIND = {
  /** Emparejado por la tabla de equivalencias. */
  EQUIVALENCE: 'equivalence',
  /** Mismo nombre normalizado en el IPV y en el cuadre. */
  IDENTITY: 'identity',
} as const;

export type MatchKind = (typeof MATCH_KIND)[keyof typeof MATCH_KIND];

export interface ProductMatch {
  /** Nombre del producto en el cuadre, tal como está escrito en el catálogo. */
  product: string;
  kind: MatchKind;
}

export interface MatchSuggestion {
  product: string;
  /** Parecido entre 0 y 1. */
  score: number;
}

export interface SuggestOptions {
  minScore?: number;
  limit?: number;
}

/** Alias del IPV normalizado → nombre del producto en el cuadre. */
export type AliasIndex = ReadonlyMap<string, string>;

const DEFAULT_MIN_SCORE = 0.8;
const DEFAULT_LIMIT = 3;
/** Puntaje que recibe un nombre contenido en otro ("ketchup" en "ketchup vima"). */
const CONTAINMENT_SCORE = 0.85;
/** Un nombre corto no cuenta como contenido si es menos de la mitad del largo. */
const CONTAINMENT_MIN_RATIO = 0.5;

export function buildAliasIndex(equivalences: readonly Equivalence[]): AliasIndex {
  const index = new Map<string, string>();
  for (const { cuadre, ipv } of equivalences) {
    for (const alias of ipv) {
      const key = normalizeName(alias);
      const existing = index.get(key);
      if (existing !== undefined && existing !== cuadre) {
        throw new Error(`El alias "${alias}" está asignado a "${existing}" y a "${cuadre}"`);
      }
      index.set(key, cuadre);
    }
  }
  return index;
}

/** Devuelve el nombre del catálogo que coincide normalizado, o el nombre dado si no está. */
function catalogName(name: string, catalog: readonly string[]): string {
  const key = normalizeName(name);
  return catalog.find((candidate) => normalizeName(candidate) === key) ?? name;
}

/**
 * Empareja un producto del IPV con el cuadre: primero la tabla de equivalencias,
 * después el nombre idéntico. Nunca adivina: si no hay ninguna de las dos, devuelve null.
 */
export function resolveIpvProduct(
  ipvName: string,
  aliases: AliasIndex,
  catalog: readonly string[],
): ProductMatch | null {
  const key = normalizeName(ipvName);

  const equivalent = aliases.get(key);
  if (equivalent !== undefined) {
    return { product: catalogName(equivalent, catalog), kind: MATCH_KIND.EQUIVALENCE };
  }

  const identical = catalog.find((candidate) => normalizeName(candidate) === key);
  return identical === undefined ? null : { product: identical, kind: MATCH_KIND.IDENTITY };
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  const levenshtein = 1 - distance(a, b) / longest;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const longTokens = new Set(long.split(' '));
  const contained =
    short.length / long.length >= CONTAINMENT_MIN_RATIO &&
    short.split(' ').every((token) => longTokens.has(token));

  return Math.max(levenshtein, contained ? CONTAINMENT_SCORE : 0);
}

/**
 * Productos del catálogo que se parecen al nombre dado (búsqueda de /producto y /fila).
 * Solo sugiere: nunca empareja por su cuenta.
 */
export function suggestMatches(
  name: string,
  catalog: readonly string[],
  { minScore = DEFAULT_MIN_SCORE, limit = DEFAULT_LIMIT }: SuggestOptions = {},
): MatchSuggestion[] {
  const key = normalizeName(name);
  return catalog
    .map((product) => ({ product, score: similarity(key, normalizeName(product)) }))
    .filter((suggestion) => suggestion.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Mismo nombre sin espacios ni signos: `chupa-chupa`, `chupa chupa` y `chupachupa`. */
const COMPACT_SCORE = 0.95;
/** Todas las palabras del nombre corto están, con alguna letra de diferencia, en el largo. */
const FUZZY_TOKEN_MIN = 0.8;
/** Puntaje cuando el nombre corto es menos de la mitad del largo (`azucar` → `azucar campofino`). */
const LOOSE_CONTAINMENT_SCORE = 0.8;

const compact = (value: string): string => value.replace(/[^\p{L}\p{N}]/gu, '');

const tokenRatio = (a: string, b: string): number =>
  1 - distance(a, b) / Math.max(a.length, b.length, 1);

/** Parecido para proponer equivalencias: tolera guiones, erratas y nombres con marca. */
function equivalenceSimilarity(a: string, b: string): number {
  const base = similarity(a, b);
  const ca = compact(a);
  const cb = compact(b);
  if (ca !== '' && ca === cb) return Math.max(base, COMPACT_SCORE);

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const longTokens = long.split(' ').filter((token) => token !== '');
  const shortTokens = short.split(' ').filter((token) => token !== '');
  const fuzzyContained =
    shortTokens.length > 0 &&
    shortTokens.every((token) =>
      longTokens.some((candidate) => tokenRatio(token, candidate) >= FUZZY_TOKEN_MIN),
    );
  if (!fuzzyContained) return base;
  const score =
    short.length / long.length >= CONTAINMENT_MIN_RATIO
      ? CONTAINMENT_SCORE
      : LOOSE_CONTAINMENT_SCORE;
  return Math.max(base, score);
}

/**
 * Productos del cuadre que podrían ser el mismo que un producto del IPV sin
 * equivalencia. Es más tolerante que `suggestMatches` porque solo propone: una dueña
 * elige con un botón antes de guardar la equivalencia.
 */
export function equivalenceCandidates(
  name: string,
  catalog: readonly string[],
  { minScore = DEFAULT_MIN_SCORE, limit = DEFAULT_LIMIT }: SuggestOptions = {},
): MatchSuggestion[] {
  const key = normalizeName(name);
  return catalog
    .map((product) => ({ product, score: equivalenceSimilarity(key, normalizeName(product)) }))
    .filter((suggestion) => suggestion.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
