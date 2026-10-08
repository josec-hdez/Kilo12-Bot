import {
  CUADRE_HEADERS,
  FIRST_DATA_ROW,
  LAST_DATA_ROW,
  rowFormulas,
  summaryCells,
} from '../core/cuadre-layout.js';
import type { Product } from '../ports/repositories.js';
import type { CellValue, RangeWrite, SheetsGateway } from '../ports/sheets-gateway.js';

/**
 * Pestañas de servicio aprobadas por las dueñas: `_plantilla` (oculta, base de cada
 * día) y `_config` (espejo de solo lectura del catálogo). No se crean `_bak_*`.
 */
export const TEMPLATE_TAB = '_plantilla';
export const CONFIG_TAB = '_config';

const dataRows = (): number[] =>
  Array.from({ length: LAST_DATA_ROW - FIRST_DATA_ROW + 1 }, (_, i) => FIRST_DATA_ROW + i);

/**
 * Contenido de `_plantilla`: encabezados A1:N1, fórmulas de C, I y K:N hasta la
 * fila 300 y el resumen P:Q (Q14 = Utilidad Bruta − Gastos; TC en Q18).
 */
export function templateWrites(): RangeWrite[] {
  const rows = dataRows().map(rowFormulas);
  const last = String(LAST_DATA_ROW);
  const first = String(FIRST_DATA_ROW);
  const tab = TEMPLATE_TAB;

  return [
    { tab, a1: 'A1:N1', values: [[...CUADRE_HEADERS]] },
    { tab, a1: `C${first}:C${last}`, values: rows.map((f) => [f.C]) },
    { tab, a1: `I${first}:I${last}`, values: rows.map((f) => [f.I]) },
    { tab, a1: `K${first}:N${last}`, values: rows.map((f) => [f.K, f.L, f.M, f.N]) },
    ...summaryCells(null).map(({ address, value }) => ({
      tab,
      a1: address,
      values: [[value ?? '']],
    })),
  ];
}

export interface EnsureResult {
  created: boolean;
}

/**
 * Crea `_plantilla` oculta si no existe. Si ya existe no la toca: las dueñas pueden
 * haberle dado formato, y el layout se valida al leer cada día.
 */
export async function ensureTemplate(sheets: SheetsGateway): Promise<EnsureResult> {
  const tabs = await sheets.listTabs();
  if (tabs.some((tab) => tab.title === TEMPLATE_TAB)) return { created: false };

  await sheets.addTab(TEMPLATE_TAB, { hidden: true });
  await sheets.writeRanges(templateWrites());
  return { created: true };
}

export const CONFIG_HEADERS = [
  'Producto',
  'Alias IPV',
  'Costo vigente',
  'Categoría',
  'Perecedero',
  'Existencia mínima',
] as const;

const optional = (value: string | number | null): CellValue => value ?? '';

/**
 * Filas de `_config`: una nota en A1, encabezados en la fila 2 y un producto por
 * fila desde la 3. Los alias del IPV van separados por `;`.
 */
export function configGrid(products: readonly Product[], generatedAt: Date): CellValue[][] {
  return [
    [`Generado por el bot el ${generatedAt.toISOString()} — no editar: los cambios se pierden.`],
    [...CONFIG_HEADERS],
    ...products.map((product) => [
      product.name,
      product.aliases.join('; '),
      optional(product.cost),
      optional(product.category),
      product.perishable ? 'sí' : 'no',
      optional(product.minStock),
    ]),
  ];
}

/**
 * Reescribe `_config` completa desde SQLite (la fuente de verdad). Es un espejo:
 * no se guarda snapshot, porque se regenera igual en la próxima sincronización.
 */
export async function syncConfigTab(
  sheets: SheetsGateway,
  products: readonly Product[],
  generatedAt: Date,
): Promise<void> {
  const tabs = await sheets.listTabs();
  if (tabs.some((tab) => tab.title === CONFIG_TAB)) await sheets.clearTab(CONFIG_TAB);
  else await sheets.addTab(CONFIG_TAB, { hidden: false });

  const grid = configGrid(products, generatedAt);
  const lastRow = String(grid.length);
  await sheets.writeRanges([
    { tab: CONFIG_TAB, a1: 'A1:A1', values: grid.slice(0, 1) },
    { tab: CONFIG_TAB, a1: `A2:F${lastRow}`, values: grid.slice(1) },
  ]);
}
