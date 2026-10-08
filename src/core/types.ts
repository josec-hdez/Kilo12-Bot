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

/** Fila de producto de una hoja del cuadre (A:N). Vacío = `null`. */
export interface CuadreRow {
  rowNumber: number;
  product: string;
  costo: number | null;
  precio: number | null;
  inicio: number | null;
  entradas: number | null;
  merma: number | null;
  consumo: number | null;
  final: number | null;
  /** Valores calculados que guardó la hoja, para comparar contra las fórmulas. */
  salida: number | null;
  ventaBruta: number | null;
  invsInicial: number | null;
  costoFinal: number | null;
  invsFinal: number | null;
  utilidad: number | null;
  /** Fórmulas escritas en C, I, K, L, M y N (sin `=`); `null` si hay un valor a mano. */
  formulas: CuadreRowFormulas;
}

export interface CuadreRowFormulas {
  C: string | null;
  I: string | null;
  K: string | null;
  L: string | null;
  M: string | null;
  N: string | null;
}

/** Contenido de una celda del resumen P:Q. */
export interface SheetCellContent {
  value: number | string | null;
  /** Fórmula sin `=`, o `null` si la celda tiene un valor. */
  formula: string | null;
}

export interface CuadreSheet {
  /** Nombre de la pestaña: `01`, `02`… */
  tabName: string;
  rows: CuadreRow[];
  /** Celdas no vacías del resumen P:Q, por dirección (`Q4`, `P18`…). */
  summary: Partial<Record<string, SheetCellContent>>;
  tc: number | null;
}
