/** Cantidades y precios de una fila, como se escriben en el cuadre. Vacío = `null`. */
export interface TotalsRow {
  costo: number | null;
  precio: number | null;
  inicio: number | null;
  entradas: number | null;
  merma: number | null;
  consumo: number | null;
  final: number | null;
}

export interface CuadreTotals {
  inversionInicial: number;
  inversionFinal: number;
  ventaTotal: number;
  costoTotal: number;
  utilidadBruta: number;
}

/** Diferencia máxima, en CUP, que se acepta entre la venta del cuadre y el IPV. */
export const SALES_TOLERANCE = 0.5;

const n = (value: number | null): number => value ?? 0;
const money = (value: number): number => Math.round(value * 100) / 100;

/** Salida = Inicio + Entradas − Merma − Consumo − Final (fórmula I de la hoja). */
export function salida(row: TotalsRow): number {
  return n(row.inicio) + n(row.entradas) - n(row.merma) - n(row.consumo) - n(row.final);
}

/**
 * Totales del resumen calculados con las mismas fórmulas que la hoja. Una celda
 * vacía vale 0, igual que en Sheets: una final vacía cuenta todo como vendido.
 */
export function computeTotals(rows: readonly TotalsRow[]): CuadreTotals {
  let inversionInicial = 0;
  let inversionFinal = 0;
  let ventaTotal = 0;
  let costoTotal = 0;

  for (const row of rows) {
    const vendido = salida(row);
    inversionInicial += n(row.costo) * n(row.inicio);
    inversionFinal += n(row.final) * n(row.costo);
    ventaTotal += vendido * n(row.precio);
    costoTotal += vendido * n(row.costo);
  }

  return {
    inversionInicial: money(inversionInicial),
    inversionFinal: money(inversionFinal),
    ventaTotal: money(ventaTotal),
    costoTotal: money(costoTotal),
    utilidadBruta: money(ventaTotal - costoTotal),
  };
}

/** Utilidad neta = Utilidad Bruta − Gastos. Nunca Venta − Gastos. */
export function utilidadNeta(totals: Pick<CuadreTotals, 'utilidadBruta'>, gastos: number): number {
  return money(totals.utilidadBruta - gastos);
}

/** Regla dura: la Venta Total del cuadre debe ser igual al IMPORTE TOTAL del IPV. */
export function salesMatchIpv(ventaTotal: number, importeTotal: number | null): boolean {
  return importeTotal !== null && Math.abs(ventaTotal - importeTotal) <= SALES_TOLERANCE;
}
