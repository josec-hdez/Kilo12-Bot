/** Día y mes de una pestaña del IPV. Las pestañas no traen año. */
export interface DayRef {
  day: number;
  month: number;
}

export interface IpvTabRef extends DayRef {
  /** Nombre original de la pestaña, tal como aparece en el archivo (puede tener espacios). */
  tabName: string;
}

/**
 * Fila del IPV. Las celdas vacías se conservan como `null`: una CANT. FINAL vacía
 * no es lo mismo que un 0, porque la fórmula SALIDA la cuenta como vendida.
 */
export interface IpvRow {
  rowNumber: number;
  product: string;
  inicial: number | null;
  entrada: number | null;
  merma: number | null;
  consumo: number | null;
  salida: number | null;
  precio: number | null;
  importe: number | null;
  final: number | null;
}

export interface IpvDay extends IpvTabRef {
  rows: IpvRow[];
  /** Valor de la celda `IMPORTE TOTAL`: la venta del día según el IPV. */
  importeTotal: number | null;
  /** Valor de la fila `Total vendido real`, si alguien la llenó. */
  totalVendidoReal: number | null;
}
