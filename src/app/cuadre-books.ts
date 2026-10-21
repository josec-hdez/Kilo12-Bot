import {
  addMonths,
  isMonthKey,
  monthName,
  parseQualifiedTab,
  qualifyTab,
  type MonthKey,
} from '../core/months.js';
import type { CuadreSheet } from '../core/types.js';
import type { CuadreBook, CuadreBooks } from '../ports/cuadre-books.js';
import type { CuadreReader } from '../ports/cuadre-source.js';
import type { SettingsRepository } from '../ports/repositories.js';
import type { SheetsGateway } from '../ports/sheets-gateway.js';

/** Clave en la tabla de configuración: `{ "2026-10": "<id>", "2026-11": "<id>" }`. */
export const BOOKS_SETTING = 'cuadre_books';

/** Mes → ID de la hoja. Ignora entradas dañadas en lugar de romper el arranque. */
export function readBookRegistry(settings: SettingsRepository): Record<MonthKey, string> {
  const raw = settings.get(BOOKS_SETTING);
  if (typeof raw !== 'object' || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] =>
        isMonthKey(entry[0]) && typeof entry[1] === 'string' && entry[1] !== '',
    ),
  );
}

export function registerBook(
  settings: SettingsRepository,
  month: MonthKey,
  spreadsheetId: string,
): void {
  settings.set(BOOKS_SETTING, { ...readBookRegistry(settings), [month]: spreadsheetId });
}

/**
 * El libro de `CUADRE_SHEET_ID` (octubre de 2026) queda registrado para su mes la
 * primera vez. Si ya está registrado para algún mes, o ese mes ya tiene otro libro,
 * no se toca: manda lo que registraron las dueñas.
 */
export function ensureDefaultBook(
  settings: SettingsRepository,
  month: MonthKey,
  spreadsheetId: string,
): boolean {
  const registry = readBookRegistry(settings);
  if (Object.values(registry).includes(spreadsheetId) || registry[month] !== undefined) {
    return false;
  }
  registerBook(settings, month, spreadsheetId);
  return true;
}

export type BookOpener = (spreadsheetId: string) => Pick<CuadreBook, 'sheets' | 'cuadre'>;

/**
 * Libros según el registro de SQLite. Cada hoja se abre una sola vez (con su memoria
 * de 60 s); registrar otro libro para un mes se ve en la siguiente consulta.
 */
export class RegistryCuadreBooks implements CuadreBooks {
  private readonly opened = new Map<string, Pick<CuadreBook, 'sheets' | 'cuadre'>>();

  constructor(
    private readonly settings: SettingsRepository,
    private readonly open: BookOpener,
    readonly defaultMonth: MonthKey,
  ) {}

  forMonth(month: MonthKey): CuadreBook | null {
    const spreadsheetId = readBookRegistry(this.settings)[month];
    if (spreadsheetId === undefined) return null;
    let book = this.opened.get(spreadsheetId);
    if (book === undefined) {
      book = this.open(spreadsheetId);
      this.opened.set(spreadsheetId, book);
    }
    return { month, spreadsheetId, ...book };
  }
}

/**
 * Un solo libro para todos los meses: la hoja simulada en memoria (sin service
 * account) y las pruebas. Como todos los meses son el mismo libro, nunca se lee "el
 * mes anterior" por separado.
 */
export const SINGLE_BOOK_ID = 'single';

export function singleBook(
  sheets: SheetsGateway,
  cuadre: CuadreReader,
  defaultMonth: MonthKey = '2026-10',
): CuadreBooks {
  return {
    defaultMonth,
    forMonth: (month) => ({ month, spreadsheetId: SINGLE_BOOK_ID, sheets, cuadre }),
  };
}

/** Texto cuando un mes no tiene libro: nunca se escribe en el de otro mes. */
export function noBookMessage(month: MonthKey): string {
  return (
    `No hay libro de cuadre para ${monthName(month)}. Una dueña tiene que crear la copia ` +
    `(Archivo → Hacer una copia, con solo la pestaña _plantilla), compartirla con la cuenta del bot ` +
    `y registrarla con /cuadremes ${month} <enlace>. No se escribió nada.`
  );
}

/** Libro de una escritura guardada: su mes o, si no lo trae (escrituras viejas), el de siempre. */
export function bookOfWrite(books: CuadreBooks, month: MonthKey | undefined): CuadreBook | null {
  return books.forMonth(month ?? books.defaultMonth);
}

/** Libro del mes anterior, solo si es otro libro (con un solo libro no hay "anterior"). */
export function previousBook(books: CuadreBooks, current: CuadreBook): CuadreBook | null {
  const previous = books.forMonth(addMonths(current.month, -1));
  return previous === null || previous.spreadsheetId === current.spreadsheetId ? null : previous;
}

/**
 * Lectura del cuadre para reportes y /validar: el libro del mes en curso con sus
 * pestañas `DD` y, antes, las del mes anterior como `DD/MM` (`28/10`). Así /semana,
 * un /rango 28 03 y la continuidad del 31 al 01 cruzan de libro. /mes y los reportes
 * "de todo el cuadre" se quedan con el mes en curso (ver `monthDays`).
 */
export class MonthTimelineReader implements CuadreReader {
  constructor(
    private readonly books: CuadreBooks,
    private readonly currentMonth: () => MonthKey,
  ) {}

  private span(): { current: CuadreBook | null; previous: CuadreBook | null } {
    const month = this.currentMonth();
    const current = this.books.forMonth(month);
    const previous = this.books.forMonth(addMonths(month, -1));
    if (current !== null && previous?.spreadsheetId === current.spreadsheetId) {
      return { current, previous: null };
    }
    return { current, previous };
  }

  async listDays(): Promise<string[]> {
    const { current, previous } = this.span();
    const before =
      previous === null
        ? []
        : (await previous.cuadre.listDays()).map((tab) => qualifyTab(tab, previous.month));
    const now = current === null ? [] : await current.cuadre.listDays();
    return [...before, ...now];
  }

  async readDay(tabName: string): Promise<CuadreSheet> {
    const [sheet] = await this.readDays([tabName]);
    if (sheet === undefined) throw new Error(`No pude leer la pestaña "${tabName}"`);
    return sheet;
  }

  async readDays(tabNames: readonly string[]): Promise<CuadreSheet[]> {
    const { current, previous } = this.span();
    const route = (name: string): { book: CuadreBook; tab: string } => {
      const qualified = parseQualifiedTab(name);
      if (qualified === null) {
        if (current === null) throw new Error(`No hay libro de cuadre para la pestaña "${name}"`);
        return { book: current, tab: name.trim() };
      }
      const book = [previous, current].find(
        (candidate) => candidate !== null && Number(candidate.month.slice(5)) === qualified.month,
      );
      if (book === undefined || book === null) {
        throw new Error(`No hay libro de cuadre para la pestaña "${name}"`);
      }
      return { book, tab: qualified.tab };
    };

    const routed = tabNames.map((name) => ({ name, ...route(name) }));
    const results = new Map<string, CuadreSheet>();
    for (const book of new Set(routed.map((entry) => entry.book))) {
      const mine = routed.filter((entry) => entry.book === book);
      const sheets = await book.cuadre.readDays(mine.map((entry) => entry.tab));
      mine.forEach((entry, i) => {
        const sheet = sheets[i];
        // La pestaña conserva el nombre pedido (`28/10`): así se lee en los reportes.
        if (sheet !== undefined) results.set(entry.name, { ...sheet, tabName: entry.name });
      });
    }
    return tabNames.map((name) => {
      const sheet = results.get(name);
      if (sheet === undefined) throw new Error(`No pude leer la pestaña "${name}"`);
      return sheet;
    });
  }
}
