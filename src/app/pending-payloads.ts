import type { SheetValue } from '../core/cuadre-builder.js';

/**
 * Contenido de cada acción pendiente. Se guarda como JSON en SQLite y se vuelve a
 * validar al leerlo: la confirmación ejecuta exactamente lo que se mostró.
 */

export interface LoadIpvPayload {
  /** Pestaña del cuadre que se crea (`03`). */
  tab: string;
  /** Mes del libro donde se crea (`2026-11`). Sin mes: el libro de `CUADRE_SHEET_ID`. */
  month?: string;
  /** Pestaña del IPV de origen (`3 oct`). */
  ipvTab: string;
  /** Filas A:N desde la fila 2. */
  sheetValues: SheetValue[][];
  yellowCells: string[];
  tc: number | null;
  ventaTotal: number;
  utilidadBruta: number;
  /** Motivos que impiden confirmar sin forzar. Vacío = se puede confirmar. */
  blockers: string[];
}

export interface SetTcPayload {
  tab: string;
  tc: number;
  /** Mes del libro (`2026-11`). Sin mes: el libro de `CUADRE_SHEET_ID`. */
  month?: string;
  /** Motivos que impiden confirmar sin forzar (mes cerrado). Sin campo = ninguno. */
  blockers?: string[];
}

export interface UndoPayload {
  snapshotId: number;
  /** Motivos que impiden confirmar sin forzar (mes cerrado). Sin campo = ninguno. */
  blockers?: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const isOptionalStringArray = (value: unknown): value is string[] | undefined =>
  value === undefined || isStringArray(value);

const isSheetRow = (value: unknown): value is SheetValue[] =>
  Array.isArray(value) &&
  value.every((cell) => typeof cell === 'string' || typeof cell === 'number');

export function isLoadIpvPayload(value: unknown): value is LoadIpvPayload {
  return (
    isObject(value) &&
    typeof value.tab === 'string' &&
    isOptionalString(value.month) &&
    typeof value.ipvTab === 'string' &&
    Array.isArray(value.sheetValues) &&
    value.sheetValues.every(isSheetRow) &&
    isStringArray(value.yellowCells) &&
    (value.tc === null || typeof value.tc === 'number') &&
    typeof value.ventaTotal === 'number' &&
    typeof value.utilidadBruta === 'number' &&
    isStringArray(value.blockers)
  );
}

export function isSetTcPayload(value: unknown): value is SetTcPayload {
  return (
    isObject(value) &&
    typeof value.tab === 'string' &&
    typeof value.tc === 'number' &&
    isOptionalString(value.month) &&
    isOptionalStringArray(value.blockers)
  );
}

export function isUndoPayload(value: unknown): value is UndoPayload {
  return (
    isObject(value) && typeof value.snapshotId === 'number' && isOptionalStringArray(value.blockers)
  );
}
