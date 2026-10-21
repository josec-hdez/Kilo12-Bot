import type { MonthKey } from '../core/months.js';
import type { CuadreReader } from './cuadre-source.js';
import type { SheetsGateway } from './sheets-gateway.js';

/**
 * Libros del cuadre: uno por mes (`Cuadre K12 2026-11`). Cada escritura y cada lectura
 * de un día va al libro de su mes; un mes sin libro registrado no se escribe nunca en
 * el libro de otro mes.
 */
export interface CuadreBook {
  month: MonthKey;
  spreadsheetId: string;
  /** Escritura: cualquier cambio vacía la memoria de `cuadre`. */
  sheets: SheetsGateway;
  /** Lectura con memoria de 60 s. */
  cuadre: CuadreReader;
}

export interface CuadreBooks {
  /** Libro del mes, o null si las dueñas todavía no lo registraron con /cuadremes. */
  forMonth(month: MonthKey): CuadreBook | null;
  /** Mes del libro de `CUADRE_SHEET_ID`: las escrituras guardadas sin mes son de ahí. */
  readonly defaultMonth: MonthKey;
}
