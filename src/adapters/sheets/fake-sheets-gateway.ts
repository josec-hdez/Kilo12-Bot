import { cellAddress, parseCell, parseRange } from '../../core/a1.js';
import {
  RENDER,
  type CellValue,
  type DuplicateOptions,
  type Grid,
  type RangeWrite,
  type Render,
  type RgbColor,
  type SheetsGateway,
  type TabInfo,
  type TabRange,
} from '../../ports/sheets-gateway.js';

interface FakeTab {
  info: TabInfo;
  cells: Map<string, CellValue>;
  backgrounds: Map<string, RgbColor>;
}

export interface FakeTabSeed {
  title: string;
  hidden?: boolean;
  /** Celdas por dirección (`B2`); las fórmulas se guardan como texto (`=B2*E2`). */
  cells?: Readonly<Record<string, CellValue>>;
}

type Operation = keyof SheetsGateway;

/**
 * Hoja simulada en memoria. Guarda las fórmulas como texto y NO las calcula: con
 * `RENDER.VALUE` una fórmula se lee vacía. Los totales se verifican con core/calc.
 * Igual que Sheets, al leer omite las celdas vacías del final de cada fila.
 */
export class FakeSheetsGateway implements SheetsGateway {
  private readonly tabs: FakeTab[] = [];
  private nextSheetId = 1;
  private readonly failures = new Set<Operation>();

  constructor(seed: readonly FakeTabSeed[] = []) {
    for (const tab of seed) {
      const created = this.createTab(tab.title, tab.hidden ?? false);
      for (const [address, value] of Object.entries(tab.cells ?? {})) {
        created.cells.set(normalizeAddress(address), value);
      }
    }
  }

  /** Para pruebas: la próxima llamada a `operation` lanza un error. */
  failNext(operation: Operation): void {
    this.failures.add(operation);
  }

  /** Para pruebas: contenido de una celda (fórmula como texto), `undefined` si está vacía. */
  cell(tab: string, address: string): CellValue | undefined {
    return this.require(tab).cells.get(normalizeAddress(address));
  }

  background(tab: string, address: string): RgbColor | undefined {
    return this.require(tab).backgrounds.get(normalizeAddress(address));
  }

  listTabs(): Promise<TabInfo[]> {
    return this.run('listTabs', () => this.tabs.map((tab) => ({ ...tab.info })));
  }

  addTab(title: string, options: DuplicateOptions): Promise<TabInfo> {
    return this.run('addTab', () => ({ ...this.createTab(title, options.hidden).info }));
  }

  duplicateTab(source: string, title: string, options: DuplicateOptions): Promise<TabInfo> {
    return this.run('duplicateTab', () => {
      const from = this.require(source);
      const copy = this.createTab(title, options.hidden);
      for (const [address, value] of from.cells) copy.cells.set(address, value);
      for (const [address, color] of from.backgrounds) copy.backgrounds.set(address, color);
      return { ...copy.info };
    });
  }

  deleteTab(title: string): Promise<void> {
    return this.run('deleteTab', () => {
      const index = this.tabs.indexOf(this.require(title));
      this.tabs.splice(index, 1);
      this.tabs.forEach((tab, position) => (tab.info.index = position));
    });
  }

  setHidden(title: string, hidden: boolean): Promise<void> {
    return this.run('setHidden', () => {
      this.require(title).info.hidden = hidden;
    });
  }

  readRanges(ranges: readonly TabRange[], render: Render): Promise<Grid[]> {
    return this.run('readRanges', () =>
      ranges.map(({ tab, a1 }) => {
        const { cells } = this.require(tab);
        const { start, end } = parseRange(a1);
        const grid: Grid = [];
        for (let row = start.row; row <= end.row; row++) {
          const line: CellValue[] = [];
          for (let column = start.column; column <= end.column; column++) {
            const value = cells.get(cellAddress({ column, row })) ?? '';
            line.push(render === RENDER.VALUE && isFormula(value) ? '' : value);
          }
          grid.push(trimEnd(line));
        }
        while (grid.length > 0 && grid[grid.length - 1]?.length === 0) grid.pop();
        return grid;
      }),
    );
  }

  writeRanges(writes: readonly RangeWrite[]): Promise<void> {
    return this.run('writeRanges', () => {
      for (const { tab, a1, values } of writes) {
        const { cells } = this.require(tab);
        const { start, end } = parseRange(a1);
        values.forEach((line, rowOffset) => {
          line.forEach((value, columnOffset) => {
            const column = start.column + columnOffset;
            const row = start.row + rowOffset;
            if (column > end.column || row > end.row) {
              throw new Error(`Los valores no caben en el rango ${tab}!${a1}`);
            }
            const address = cellAddress({ column, row });
            if (value === '') cells.delete(address);
            else cells.set(address, value);
          });
        });
      }
    });
  }

  clearTab(title: string): Promise<void> {
    return this.run('clearTab', () => {
      this.require(title).cells.clear();
    });
  }

  setBackground(tab: string, cells: readonly string[], color: RgbColor): Promise<void> {
    return this.run('setBackground', () => {
      const { backgrounds } = this.require(tab);
      for (const address of cells) backgrounds.set(normalizeAddress(address), { ...color });
    });
  }

  private createTab(title: string, hidden: boolean): FakeTab {
    if (this.tabs.some((tab) => tab.info.title === title)) {
      throw new Error(`Ya existe una pestaña llamada "${title}"`);
    }
    const tab: FakeTab = {
      info: { sheetId: this.nextSheetId++, title, hidden, index: this.tabs.length },
      cells: new Map(),
      backgrounds: new Map(),
    };
    this.tabs.push(tab);
    return tab;
  }

  private require(title: string): FakeTab {
    const tab = this.tabs.find((candidate) => candidate.info.title === title);
    if (tab === undefined) throw new Error(`No existe la pestaña "${title}"`);
    return tab;
  }

  /** Igual que la API real: todo es asíncrono y los errores llegan como promesa rechazada. */
  private run<T>(operation: Operation, action: () => T): Promise<T> {
    if (this.failures.delete(operation)) {
      return Promise.reject(new Error(`Fallo simulado en ${operation}`));
    }
    try {
      return Promise.resolve(action());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

const normalizeAddress = (address: string): string => cellAddress(parseCell(address));

const isFormula = (value: CellValue): boolean => typeof value === 'string' && value.startsWith('=');

function trimEnd(line: CellValue[]): CellValue[] {
  let length = line.length;
  while (length > 0 && line[length - 1] === '') length--;
  return line.slice(0, length);
}
