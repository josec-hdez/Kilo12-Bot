import { randomBytes } from 'node:crypto';
import type { Clock } from '../../ports/repositories.js';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Estado en memoria con vencimiento (archivo de IPV recibido, motivo pendiente).
 * Se pierde al reiniciar el bot: es solo la conversación en curso; las acciones
 * pendientes de verdad viven en SQLite.
 */
export class TtlStore<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: Clock,
  ) {}

  /** Guarda con una clave nueva y corta (cabe en el callback_data de Telegram). */
  add(value: T): string {
    const key = randomBytes(6).toString('base64url');
    this.set(key, value);
    return key;
  }

  set(key: string, value: T): void {
    this.prune();
    this.entries.set(key, { value, expiresAt: this.clock().getTime() + this.ttlMs });
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.clock().getTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  private prune(): void {
    const now = this.clock().getTime();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }
}
