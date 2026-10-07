import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import { ExcelIpvSource } from '../../src/adapters/xlsx/excel-ipv-source.js';
import { computeTotals, salesMatchIpv } from '../../src/core/calc.js';
import { buildCostCatalog } from '../../src/core/costs.js';
import { buildCuadreDraft, type CuadreDraft } from '../../src/core/cuadre-builder.js';
import { EQUIVALENCES } from '../../src/core/equivalences.js';
import type { IpvDay } from '../../src/core/types.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/**
 * Criterio 1 adaptado: el IPV no tiene la pestaña del 5 oct y el del 4 oct tiene finales
 * vacías, así que se usa el 3 oct. Los costos salen de la hoja 05 del cuadre (aprobado).
 */
describe('hoja del 3 oct armada desde el IPV real', () => {
  let ipv: IpvDay;
  let draft: CuadreDraft;

  beforeAll(async () => {
    const source = await ExcelIpvSource.fromFile(fixture('IPV KILO 12.xlsx'));
    const cuadre = await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx'));
    ipv = source.readDay({ day: 3, month: 10 });
    draft = buildCuadreDraft(ipv, buildCostCatalog(cuadre.readDay('05').rows), EQUIVALENCES);
  });

  it('la Venta Total es igual al IMPORTE TOTAL del IPV (90,356)', () => {
    const { ventaTotal } = computeTotals(draft.rows);
    expect(ipv.importeTotal).toBe(90_356);
    expect(ventaTotal).toBe(90_356);
    expect(salesMatchIpv(ventaTotal, ipv.importeTotal)).toBe(true);
  });

  it('cada fila lleva sus fórmulas C, I, K, L, M y N', () => {
    for (const row of draft.rows) {
      const n = row.rowNumber;
      expect(row.formulas).toEqual({
        C: `=B${n}*E${n}`,
        I: `=E${n}+F${n}-G${n}-H${n}-J${n}`,
        K: `=I${n}*D${n}`,
        L: `=I${n}*B${n}`,
        M: `=J${n}*B${n}`,
        N: `=K${n}-L${n}`,
      });
    }
  });

  it('suma cola y naranja dispensado en refresco reenvasado', () => {
    const refresco = draft.rows.find((r) => r.product === 'refresco reenvasado');
    expect(refresco).toMatchObject({ inicio: 16, final: 6, precio: 1000, costo: 750 });
  });

  it('marca el pollo como producto sin costo', () => {
    expect(draft.missingCost).toContain('pollo');
    const pollo = draft.rows.find((r) => r.product === 'pollo');
    expect(draft.yellowCells).toContain(`B${String(pollo?.rowNumber)}`);
  });

  it('empareja los 11 productos confirmados por las dueñas y no deja ninguno sin pareja', () => {
    expect(draft.unmatched).toEqual([]);
    expect(draft.rows.filter((r) => r.isNew)).toEqual([]);
    const confirmed: [string, string][] = [
      ['chicharos verdes', 'chicharos'],
      ['cigarro popular rojo caja', 'cigarro popular rojo'],
      ['energizante 5shots', 'energizante 5 shot'],
      ['harina de trigo 1kg', 'harina de trigo'],
      ['jugo gusto pineapple', 'jugo gusto pinneaple'],
      ['ketchup vima', 'ketchup'],
      ['mayonesa hollandpark', 'mayonesa holland park'],
      ['pasta de tomate', 'pasta tomate'],
      ['refresco instantaneo YEYA', 'refresco instantaneo'],
      ['shaka piña colada 250ml', 'shaka piña colada'],
      ['zumo de limon', 'zumo limon'],
    ];
    for (const [ipvName, cuadreName] of confirmed) {
      const row = draft.rows.find((r) => r.sourceIpvProducts.includes(ipvName));
      expect(row?.product).toBe(cuadreName);
    }
  });

  it('solo quedan sin costo los productos sin dato de las dueñas', () => {
    expect(draft.missingCost).toEqual(['chupachupa', 'fanguito', 'peter biskiato', 'pollo']);
  });
});
