import type { CuadreSheet } from '../core/types.js';
import type { CuadreReader } from '../ports/cuadre-source.js';

/** Lo que dura en memoria el cuadre leído: evita leer la hoja en cada comando. */
export const CUADRE_CACHE_TTL_MS = 60 * 1000;

interface Cached<T> {
  value: T;
  at: number;
}

/**
 * Decorador del CuadreReader con memoria de 60 s. Los reportes seguidos no vuelven
 * a leer la hoja; cualquier escritura del bot llama a `invalidate()` para que nadie
 * vea datos viejos (ver `notifyingWrites`).
 */
export class CachedCuadreReader implements CuadreReader {
  private days: Cached<string[]> | null = null;
  private readonly sheets = new Map<string, Cached<CuadreSheet>>();

  constructor(
    private readonly inner: CuadreReader,
    private readonly clock: () => Date,
    private readonly ttlMs = CUADRE_CACHE_TTL_MS,
  ) {}

  invalidate(): void {
    this.days = null;
    this.sheets.clear();
  }

  private fresh<T>(entry: Cached<T> | null | undefined): entry is Cached<T> {
    return entry != null && this.clock().getTime() - entry.at < this.ttlMs;
  }

  async listDays(): Promise<string[]> {
    if (this.fresh(this.days)) return [...this.days.value];
    const value = await this.inner.listDays();
    this.days = { value, at: this.clock().getTime() };
    return [...value];
  }

  async readDay(tabName: string): Promise<CuadreSheet> {
    const [sheet] = await this.readDays([tabName]);
    if (sheet === undefined) throw new Error(`No pude leer la pestaña "${tabName}"`);
    return sheet;
  }

  async readDays(tabNames: readonly string[]): Promise<CuadreSheet[]> {
    const key = (name: string) => name.trim();
    const missing = [...new Set(tabNames.map(key))].filter(
      (name) => !this.fresh(this.sheets.get(name)),
    );
    if (missing.length > 0) {
      const read = await this.inner.readDays(missing);
      const at = this.clock().getTime();
      missing.forEach((name, i) => {
        const value = read[i];
        if (value !== undefined) this.sheets.set(name, { value, at });
      });
    }
    return tabNames.map((name) => {
      const entry = this.sheets.get(key(name));
      if (entry === undefined) throw new Error(`No pude leer la pestaña "${name}"`);
      return entry.value;
    });
  }
}
