import type { IpvDay, IpvRow } from './types.js';

/**
 * Filas con existencia (inicial + entrada > 0) y CANT. FINAL vacía.
 * La fórmula SALIDA del IPV las cuenta completas como vendidas e infla el IMPORTE TOTAL.
 */
export function rowsWithEmptyFinal(ipv: IpvDay): IpvRow[] {
  return ipv.rows.filter(
    (row) => row.final === null && (row.inicial ?? 0) + (row.entrada ?? 0) > 0,
  );
}
