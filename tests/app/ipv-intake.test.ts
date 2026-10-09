import { describe, expect, it } from 'vitest';
import {
  parseDayAnswer,
  parseDayArg,
  resolveCaptionSheet,
  resolveSheetAnswer,
  SHEET_ANSWER,
  sheetQuestion,
} from '../../src/app/ipv-intake.js';

/** Las 7 hojas del IPV real, en su orden. */
const SHEETS = ['Hoja1', '30 sep', 'IPV Alf. 30 sep', '1 oct', '2 oct ', '3 oct', '4 oct'];

describe('parseDayArg', () => {
  it('acepta 3oct, 3 Oct, 03 y 3', () => {
    expect(parseDayArg('3oct')).toEqual({ day: 3, month: 10 });
    expect(parseDayArg('3 Oct')).toEqual({ day: 3, month: 10 });
    expect(parseDayArg('03')).toEqual({ day: 3, month: null });
    expect(parseDayArg('3')).toEqual({ day: 3, month: null });
  });
  it('vacío → null; texto que no es día → undefined', () => {
    expect(parseDayArg('  ')).toBeNull();
    expect(parseDayArg('ayer')).toBeUndefined();
    expect(parseDayArg('45')).toBeUndefined();
  });
});

describe('sheetQuestion', () => {
  it('lista todas las hojas numeradas y avisa del espacio al final', () => {
    const text = sheetQuestion(SHEETS);
    expect(text).toContain(
      '📥 El archivo tiene 7 hojas. ¿Cuál analizo? Escribe el nombre exacto o su número:',
    );
    expect(text).toContain('1. Hoja1');
    expect(text).toContain('3. IPV Alf. 30 sep');
    expect(text).toContain('5. "2 oct " (con espacio al final)');
    expect(text).toContain('7. 4 oct');
  });
  it('sin tope: un IPV de 31 días lista las 31 hojas', () => {
    const many = Array.from({ length: 31 }, (_, i) => `${String(i + 1)} oct`);
    expect(sheetQuestion(many)).toContain('31. 31 oct');
  });
  it('avisa espacios al inicio y en los dos bordes', () => {
    expect(sheetQuestion([' a', ' b '])).toContain('1. " a" (con espacio al inicio)');
    expect(sheetQuestion([' a', ' b '])).toContain('2. " b " (con espacios al inicio y al final)');
  });
});

describe('resolveSheetAnswer', () => {
  it('por número de la lista', () => {
    expect(resolveSheetAnswer(SHEETS, '6')).toEqual({ status: SHEET_ANSWER.FOUND, sheet: '3 oct' });
    expect(resolveSheetAnswer(SHEETS, '8').status).toBe(SHEET_ANSWER.NOT_FOUND);
    expect(resolveSheetAnswer(SHEETS, '0').status).toBe(SHEET_ANSWER.NOT_FOUND);
  });
  it('por nombre exacto', () => {
    expect(resolveSheetAnswer(SHEETS, 'IPV Alf. 30 sep')).toEqual({
      status: SHEET_ANSWER.FOUND,
      sheet: 'IPV Alf. 30 sep',
    });
  });
  it('por nombre normalizado: "2 oct" encuentra "2 oct "; mayúsculas y espacios no importan', () => {
    expect(resolveSheetAnswer(SHEETS, '2 oct')).toEqual({
      status: SHEET_ANSWER.FOUND,
      sheet: '2 oct ',
    });
    expect(resolveSheetAnswer(SHEETS, '  HOJA1 ')).toEqual({
      status: SHEET_ANSWER.FOUND,
      sheet: 'Hoja1',
    });
  });
  it('nunca adivina: un error de tipeo devuelve una sugerencia, no la hoja', () => {
    expect(resolveSheetAnswer(SHEETS, '3 ocr')).toEqual({
      status: SHEET_ANSWER.SUGGEST,
      suggestion: '3 oct',
    });
    expect(resolveSheetAnswer(SHEETS, '3 octubre')).toEqual({
      status: SHEET_ANSWER.SUGGEST,
      suggestion: '3 oct',
    });
    expect(resolveSheetAnswer(SHEETS, 'Hoja 1')).toEqual({
      status: SHEET_ANSWER.SUGGEST,
      suggestion: 'Hoja1',
    });
  });
  it('sin nada parecido: no encontrado', () => {
    expect(resolveSheetAnswer(SHEETS, 'inventario de diciembre').status).toBe(
      SHEET_ANSWER.NOT_FOUND,
    );
  });
  it('dos hojas iguales al normalizar: no elige ninguna sola', () => {
    expect(resolveSheetAnswer(['3 oct', '3 Oct '], '3 OCT').status).not.toBe(SHEET_ANSWER.FOUND);
  });
});

describe('resolveCaptionSheet', () => {
  it('nombre o fecha que identifica una sola hoja', () => {
    expect(resolveCaptionSheet(SHEETS, '3 oct')).toBe('3 oct');
    expect(resolveCaptionSheet(SHEETS, '3oct')).toBe('3 oct');
    expect(resolveCaptionSheet(SHEETS, '03')).toBe('3 oct');
    expect(resolveCaptionSheet(SHEETS, '2 oct')).toBe('2 oct ');
    expect(resolveCaptionSheet(SHEETS, 'Hoja1')).toBe('Hoja1');
  });
  it('vacío, desconocido o ambiguo → null (se pregunta)', () => {
    expect(resolveCaptionSheet(SHEETS, '')).toBeNull();
    expect(resolveCaptionSheet(SHEETS, '5oct')).toBeNull();
    expect(resolveCaptionSheet(SHEETS, 'hola')).toBeNull();
    expect(resolveCaptionSheet(['3 oct', '3 nov'], '03')).toBeNull();
  });
});

describe('parseDayAnswer', () => {
  const today = { day: 3, month: 10 };
  it('día solo → mes de hoy; fecha completa → esa fecha', () => {
    expect(parseDayAnswer('05', today)).toEqual({ day: 5, month: 10 });
    expect(parseDayAnswer('30 sep', today)).toEqual({ day: 30, month: 9 });
  });
  it('lo que no es un día → null', () => {
    expect(parseDayAnswer('mañana', today)).toBeNull();
    expect(parseDayAnswer('', today)).toBeNull();
  });
});
