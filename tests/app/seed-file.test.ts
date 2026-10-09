import { describe, expect, it } from 'vitest';
import { openSeedFile } from '../../src/app/seed-file.js';
import { ConfigError } from '../../src/config.js';

describe('CUADRE_SEED_PATH', () => {
  it('si el archivo no está: ConfigError con la ruta y cómo arreglarlo (sin bucle de reinicios)', async () => {
    const attempt = openSeedFile('./Cuadre K12 Remoto 8-10.xlsx', () => Promise.resolve('nunca'));
    await expect(attempt).rejects.toBeInstanceOf(ConfigError);
    await expect(attempt).rejects.toThrow(
      'No encuentro el archivo de CUADRE_SEED_PATH: ./Cuadre K12 Remoto 8-10.xlsx. Ponlo en ./data y usa /app/data/<archivo>',
    );
  });

  it('si el archivo existe pero no se puede leer: ConfigError con el motivo', async () => {
    const attempt = openSeedFile(
      '/app/data/cuadre.xlsx',
      () => Promise.reject(new Error('Zip corrupto')),
      () => Promise.resolve(true),
    );
    await expect(attempt).rejects.toBeInstanceOf(ConfigError);
    await expect(attempt).rejects.toThrow(
      'No pude leer el archivo de CUADRE_SEED_PATH (/app/data/cuadre.xlsx): Zip corrupto',
    );
  });

  it('si el archivo está, devuelve lo que abre', async () => {
    const opened = await openSeedFile(
      '/app/data/cuadre.xlsx',
      (path) => Promise.resolve(`leído ${path}`),
      () => Promise.resolve(true),
    );
    expect(opened).toBe('leído /app/data/cuadre.xlsx');
  });
});
