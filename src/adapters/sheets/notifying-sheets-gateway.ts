import type {
  DuplicateOptions,
  Grid,
  RangeWrite,
  Render,
  RgbColor,
  SheetsGateway,
  TabInfo,
  TabRange,
} from '../../ports/sheets-gateway.js';

/**
 * Envuelve la hoja y avisa después de cada escritura (crear, duplicar o borrar
 * pestañas, escribir celdas, colores…). Se usa para vaciar la memoria del cuadre:
 * así /ipv, /tc y /deshacer nunca dejan reportes con datos viejos.
 */
export class NotifyingSheetsGateway implements SheetsGateway {
  constructor(
    private readonly inner: SheetsGateway,
    private readonly onWrite: () => void,
  ) {}

  private async write<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } finally {
      // También si falló a medias: lo escrito antes del error ya cambió la hoja.
      this.onWrite();
    }
  }

  listTabs(): Promise<TabInfo[]> {
    return this.inner.listTabs();
  }

  readRanges(ranges: readonly TabRange[], render: Render): Promise<Grid[]> {
    return this.inner.readRanges(ranges, render);
  }

  addTab(title: string, options: DuplicateOptions): Promise<TabInfo> {
    return this.write(this.inner.addTab(title, options));
  }

  duplicateTab(source: string, title: string, options: DuplicateOptions): Promise<TabInfo> {
    return this.write(this.inner.duplicateTab(source, title, options));
  }

  deleteTab(title: string): Promise<void> {
    return this.write(this.inner.deleteTab(title));
  }

  setHidden(title: string, hidden: boolean): Promise<void> {
    return this.write(this.inner.setHidden(title, hidden));
  }

  writeRanges(writes: readonly RangeWrite[]): Promise<void> {
    return this.write(this.inner.writeRanges(writes));
  }

  clearTab(title: string): Promise<void> {
    return this.write(this.inner.clearTab(title));
  }

  setBackground(tab: string, cells: readonly string[], color: RgbColor): Promise<void> {
    return this.write(this.inner.setBackground(tab, cells, color));
  }
}
