import { describe, expect, it } from 'vitest';
import {
  INTAKE_STATUS,
  MAX_DAY_CHOICES,
  parseDayArg,
  resolveIpvDay,
} from '../../src/app/ipv-intake.js';
import type { IpvTabRef } from '../../src/core/types.js';

const tab = (day: number, month: number, tabName = `${String(day)} oct`): IpvTabRef => ({
  day,
  month,
  tabName,
});
const days = [tab(30, 9, '30 sep'), tab(1, 10), tab(2, 10, '2 oct '), tab(3, 10), tab(4, 10)];

describe('parseDayArg', () => {
  it('acepta 3oct, 3 Oct, 03 y 3', () => {
    expect(parseDayArg('3oct')).toEqual({ day: 3, month: 10 });
    expect(parseDayArg('3 Oct')).toEqual({ day: 3, month: 10 });
    expect(parseDayArg('03')).toEqual({ day: 3, month: null });
    expect(parseDayArg('3')).toEqual({ day: 3, month: null });
  });
  it('vacío → null; basura → undefined', () => {
    expect(parseDayArg('  ')).toBeNull();
    expect(parseDayArg('ayer')).toBeUndefined();
    expect(parseDayArg('45')).toBeUndefined();
  });
});

describe('resolveIpvDay', () => {
  it('con día y mes elige esa pestaña', () => {
    expect(resolveIpvDay(days, { day: 2, month: 10 })).toEqual({
      status: INTAKE_STATUS.DAY,
      ref: { day: 2, month: 10 },
    });
  });
  it('solo el número del día basta si es único', () => {
    expect(resolveIpvDay(days, { day: 3, month: null })).toMatchObject({
      status: INTAKE_STATUS.DAY,
      ref: { day: 3, month: 10 },
    });
  });
  it('sin argumento y varias pestañas → ofrece elegir, en orden', () => {
    const result = resolveIpvDay(days, null);
    expect(result.status).toBe(INTAKE_STATUS.CHOOSE);
    if (result.status === INTAKE_STATUS.CHOOSE) {
      expect(result.options.map((d) => d.day)).toEqual([30, 1, 2, 3, 4]);
    }
  });
  it('limita los botones a los días más recientes', () => {
    const many = Array.from({ length: 12 }, (_, i) => tab(i + 1, 10));
    const result = resolveIpvDay(many, null);
    expect(result.status === INTAKE_STATUS.CHOOSE && result.options.length).toBe(MAX_DAY_CHOICES);
  });
  it('sin argumento y una sola pestaña → esa', () => {
    expect(resolveIpvDay([tab(4, 10)], null).status).toBe(INTAKE_STATUS.DAY);
  });
  it('día que no está → error con los días disponibles', () => {
    const result = resolveIpvDay(days, { day: 5, month: 10 });
    expect(result).toMatchObject({ status: INTAKE_STATUS.ERROR });
    if (result.status === INTAKE_STATUS.ERROR) {
      expect(result.message).toContain('5 oct');
      expect(result.message).toContain('30 sep, 1 oct, 2 oct, 3 oct, 4 oct');
    }
  });
  it('archivo sin pestañas de días → error', () => {
    expect(resolveIpvDay([], null).status).toBe(INTAKE_STATUS.ERROR);
  });
});
