import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { asCuadreReader, CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import { parseValidateArgs, runValidation, VALIDATE_SCOPE } from '../../src/app/validate-report.js';
import type { CuadreReader } from '../../src/ports/cuadre-source.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

let reader: CuadreReader;

beforeAll(async () => {
  reader = asCuadreReader(await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx')));
});

const base = { hasFixedExpenses: false, showFinancials: true };

describe('parseValidateArgs', () => {
  it('sin argumento → último día', () => {
    expect(parseValidateArgs('')).toEqual({ kind: VALIDATE_SCOPE.LAST_DAY });
  });
  it('un día → su pestaña con dos dígitos', () => {
    expect(parseValidateArgs('3')).toEqual({ kind: VALIDATE_SCOPE.DAY, tab: '03' });
    expect(parseValidateArgs(' 02 ')).toEqual({ kind: VALIDATE_SCOPE.DAY, tab: '02' });
  });
  it('semana', () => {
    expect(parseValidateArgs('semana')).toEqual({ kind: VALIDATE_SCOPE.WEEK });
    expect(parseValidateArgs('Semana')).toEqual({ kind: VALIDATE_SCOPE.WEEK });
  });
  it('otra cosa → inválido con ayuda', () => {
    const parsed = parseValidateArgs('ayer');
    expect(parsed.kind).toBe(VALIDATE_SCOPE.INVALID);
  });
});

describe('runValidation sobre el cuadre real', () => {
  it('último día (05): agrupa por severidad y detecta la utilidad mal formulada', async () => {
    const text = await runValidation(reader, { kind: VALIDATE_SCOPE.LAST_DAY }, base);
    expect(text).toContain('🔎 Validación del cuadre: 05');
    expect(text).toMatch(/🔴 \d+ · 🟡 \d+ · ⚪ \d+/);
    expect(text).toContain('Utilidad');
    expect(text.indexOf('🔴 Afecta la ganancia')).toBeLessThan(text.indexOf('⚪ Informativo'));
  });

  it('día 02: ve la final en 0 del agua de 500 ml gracias al día siguiente', async () => {
    const text = await runValidation(reader, { kind: VALIDATE_SCOPE.DAY, tab: '02' }, base);
    expect(text).toContain('🔎 Validación del cuadre: 02');
    expect(text).toMatch(/agua\s+500 ml: Cant\. Final en 0/);
  });

  it('día 03: existencias registradas como entradas', async () => {
    const text = await runValidation(reader, { kind: VALIDATE_SCOPE.DAY, tab: '03' }, base);
    expect(text).toContain('la existencia se registró como entrada');
  });

  it('semana: cubre 01–05', async () => {
    const text = await runValidation(reader, { kind: VALIDATE_SCOPE.WEEK }, base);
    expect(text).toContain('🔎 Validación del cuadre: 01–05');
  });

  it('día inexistente: mensaje claro', async () => {
    const text = await runValidation(reader, { kind: VALIDATE_SCOPE.DAY, tab: '09' }, base);
    expect(text).toContain('No existe la pestaña 09');
  });

  it('sin ver finanzas: los hallazgos de costos y utilidad solo se cuentan', async () => {
    const text = await runValidation(
      reader,
      { kind: VALIDATE_SCOPE.DAY, tab: '03' },
      {
        ...base,
        showFinancials: false,
      },
    );
    expect(text).not.toContain('pollo');
    expect(text).toMatch(/\d+ hallazgos? de costos o utilidad/);
  });
});
