import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const BASE_ENV = {
  TELEGRAM_TOKEN: '123:abc',
  OWNER_IDS: '111, 222',
};

describe('loadConfig', () => {
  it('carga una configuración mínima con valores por defecto', () => {
    const config = loadConfig(BASE_ENV);

    expect(config.telegramToken).toBe('123:abc');
    expect(config.ownerIds).toEqual([111, 222]);
    expect(config.dbPath).toBe('./data/kilo12.db');
    expect(config.timezone).toBe('America/Havana');
    expect(config.googleServiceAccountJson).toBeUndefined();
    expect(config.useFakeSheets).toBe(true);
  });

  it('trata las variables vacías como ausentes', () => {
    const config = loadConfig({ ...BASE_ENV, GOOGLE_SA_JSON: '', CUADRE_SHEET_ID: '' });

    expect(config.cuadreSheetId).toBeUndefined();
    expect(config.useFakeSheets).toBe(true);
  });

  it('usa Sheets real solo si hay service account y hoja de cuadre', () => {
    const config = loadConfig({ ...BASE_ENV, GOOGLE_SA_JSON: '{}', CUADRE_SHEET_ID: 'abc' });

    expect(config.useFakeSheets).toBe(false);
  });

  it('lanza un error claro si falta el token', () => {
    expect(() => loadConfig({ OWNER_IDS: '1' })).toThrow(ConfigError);
    expect(() => loadConfig({ OWNER_IDS: '1' })).toThrow(/TELEGRAM_TOKEN/);
  });

  it('lanza un error claro si OWNER_IDS no son números', () => {
    expect(() => loadConfig({ ...BASE_ENV, OWNER_IDS: 'claudia' })).toThrow(/OWNER_IDS/);
  });
});
