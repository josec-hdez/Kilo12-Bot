import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetsGateway } from '../../src/adapters/sheets/fake-sheets-gateway.js';
import { SqliteCatalogRepository } from '../../src/adapters/sqlite/catalog-repo.js';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import {
  SqliteChangeLogRepository,
  SqliteSnapshotRepository,
} from '../../src/adapters/sqlite/history-repo.js';
import { SqlitePendingActionRepository } from '../../src/adapters/sqlite/pending-actions-repo.js';
import { SqliteSettingsRepository } from '../../src/adapters/sqlite/settings-repo.js';
import { SqliteUserRepository } from '../../src/adapters/sqlite/users-repo.js';
import { asCuadreReader, CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import { ExcelIpvSource } from '../../src/adapters/xlsx/excel-ipv-source.js';
import {
  confirmMonthClose,
  parseCloseArgs,
  CLOSE_REQUEST,
  reopenMonthClose,
  reviewMonthClose,
} from '../../src/app/close-month.js';
import { isMonthClosed, markMonthClosed } from '../../src/app/closed-months.js';
import { sheetCostRows, syncCatalog } from '../../src/app/catalog-sync.js';
import { cancelPending, confirmPending } from '../../src/app/confirm.js';
import { registerBook, RegistryCuadreBooks, singleBook } from '../../src/app/cuadre-books.js';
import { dayTab, prepareIpvLoad } from '../../src/app/load-ipv.js';
import type { LoadIpvPayload } from '../../src/app/pending-payloads.js';
import {
  CONFIRM_STATUS,
  PREPARE_STATUS,
  type Actor,
  type PipelineDeps,
  type PrepareResult,
} from '../../src/app/pipeline-types.js';
import { initialCuadreSeed, seedAll } from '../../src/app/seed.js';
import { prepareSetTc } from '../../src/app/set-tc.js';
import { CONFIG_TAB, TEMPLATE_TAB } from '../../src/app/sheet-structure.js';
import { prepareUndo } from '../../src/app/undo.js';
import { ROLE } from '../../src/core/auth.js';
import { computeTotals, type TotalsRow } from '../../src/core/calc.js';
import { EQUIVALENCES } from '../../src/core/equivalences.js';
import { SUMMARY_TAB } from '../../src/core/month-summary.js';
import type { IpvDay } from '../../src/core/types.js';
import { SheetsCuadreReader } from '../../src/adapters/sheets/sheets-cuadre-reader.js';
import type { CuadreReader } from '../../src/ports/cuadre-source.js';
import { SNAPSHOT_KIND } from '../../src/ports/repositories.js';
import { RENDER, YELLOW, type CellValue } from '../../src/ports/sheets-gateway.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const OWNER: Actor = { telegramId: 10, role: ROLE.OWNER };
const OCT = '2026-10';
const CLERK: Actor = { telegramId: 30, role: ROLE.CLERK };

let ipv3: IpvDay;
let ipv4: IpvDay;
let cuadre: CuadreXlsxReader;

beforeAll(async () => {
  const ipv = await ExcelIpvSource.fromFile(fixture('IPV KILO 12.xlsx'));
  ipv3 = ipv.readDay({ day: 3, month: 10 });
  ipv4 = ipv.readDay({ day: 4, month: 10 });
  cuadre = await CuadreXlsxReader.fromFile(fixture('Cuadre K12 Remoto.xlsx'));
});

let now: Date;
let sheets: FakeSheetsGateway;
let deps: PipelineDeps;

beforeEach(() => {
  now = new Date('2026-10-07T21:00:00Z');
  const clock = () => now;
  const db = openDatabase(':memory:');
  const catalog = new SqliteCatalogRepository(db);
  const settings = new SqliteSettingsRepository(db);
  seedAll(
    { users: new SqliteUserRepository(db), catalog, settings },
    { ownerIds: [10], equivalences: EQUIVALENCES, cuadre: initialCuadreSeed(catalog, cuadre) },
  );
  sheets = new FakeSheetsGateway();
  deps = {
    books: singleBook(sheets, asCuadreReader(cuadre)),
    settings,
    catalog,
    pending: new SqlitePendingActionRepository(db, clock),
    changeLog: new SqliteChangeLogRepository(db),
    snapshots: new SqliteSnapshotRepository(db, clock),
    clock,
  };
});

function ready(result: PrepareResult) {
  if (result.status !== PREPARE_STATUS.READY)
    throw new Error(`esperaba READY: ${JSON.stringify(result)}`);
  return result;
}

const num = (value: CellValue | undefined): number | null =>
  typeof value === 'number' ? value : null;

/** Lee A:N de la pestaña escrita y recalcula los totales con core/calc. */
async function totalsOfTab(tab: string, rows: number): Promise<ReturnType<typeof computeTotals>> {
  const [grid = []] = await sheets.readRanges(
    [{ tab, a1: `A2:N${String(rows + 1)}` }],
    RENDER.FORMULA,
  );
  const totalsRows: TotalsRow[] = grid.map((line) => ({
    costo: num(line[1]),
    precio: num(line[3]),
    inicio: num(line[4]),
    entradas: num(line[5]),
    merma: num(line[6]),
    consumo: num(line[7]),
    final: num(line[9]),
  }));
  return computeTotals(totalsRows);
}

describe('/ipv del 3 oct, de punta a punta contra la hoja simulada', () => {
  it('la vista previa no escribe nada', async () => {
    const result = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: 780, month: OCT }));
    expect(result.requiresForce).toBe(false);
    expect(result.preview).toContain('Venta: 90,356 CUP');
    expect(result.preview).toContain('✅ igual al IMPORTE TOTAL del IPV');
    expect(result.preview).toContain('Utilidad bruta');
    expect(await sheets.listTabs()).toEqual([]);
    expect(deps.changeLog.list()).toEqual([]);
  });

  it('al confirmar crea la pestaña 03 desde _plantilla, con fórmulas, TC y amarillos', async () => {
    const { pendingId } = ready(
      await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: 780, month: OCT }),
    );
    const result = await confirmPending(deps, OWNER, { pendingId });
    expect(result.status).toBe(CONFIRM_STATUS.DONE);
    expect(result.message).toMatch(/Pestaña 03 creada con 85 productos/);

    const tabs = await sheets.listTabs();
    expect(tabs.map((tab) => [tab.title, tab.hidden])).toEqual([
      [TEMPLATE_TAB, true],
      ['03', false],
      [CONFIG_TAB, false],
      [SUMMARY_TAB, false],
    ]);
    // Resumen: una fila por día que lee la pestaña con INDIRECT (sin #REF! si no existe).
    expect(sheets.cell(SUMMARY_TAB, 'A1')).toBe('Día');
    expect(sheets.cell(SUMMARY_TAB, 'B4')).toBe(`=IFERROR(INDIRECT("'"&TEXT($A4,"00")&"'!Q4"),"")`);

    // Venta Total recalculada desde lo escrito = IMPORTE TOTAL del IPV.
    expect((await totalsOfTab('03', 85)).ventaTotal).toBe(90_356);

    // Fórmulas en cada fila escrita y en las de la plantilla que quedan libres.
    for (const n of [2, 50, 86, 87, 300]) {
      expect(sheets.cell('03', `C${String(n)}`)).toBe(`=B${String(n)}*E${String(n)}`);
      expect(sheets.cell('03', `I${String(n)}`)).toBe(
        `=E${String(n)}+F${String(n)}-G${String(n)}-H${String(n)}-J${String(n)}`,
      );
      expect(sheets.cell('03', `N${String(n)}`)).toBe(`=K${String(n)}-L${String(n)}`);
    }
    expect(sheets.cell('03', 'Q14')).toBe('=Q6-Q13');
    expect(sheets.cell('03', 'Q18')).toBe(780);

    // Productos sin costo: celda B vacía y en amarillo (pollo incluido).
    const [names = []] = await sheets.readRanges([{ tab: '03', a1: 'A2:B86' }], RENDER.FORMULA);
    const pollo = names.findIndex((line) => line[0] === 'pollo') + 2;
    expect(pollo).toBeGreaterThan(1);
    expect(sheets.cell('03', `B${String(pollo)}`)).toBeUndefined();
    expect(sheets.background('03', `B${String(pollo)}`)).toEqual(YELLOW);
    const arroz = names.findIndex((line) => line[0] === 'arroz') + 2;
    expect(sheets.background('03', `B${String(arroz)}`)).toBeUndefined();

    // _config refleja el catálogo de SQLite.
    expect(sheets.cell(CONFIG_TAB, 'A2')).toBe('Producto');

    expect(deps.changeLog.list()).toEqual([
      expect.objectContaining({
        telegramId: 10,
        action: 'load_ipv',
        target: '03',
        detail: expect.objectContaining({ ventaTotal: 90_356, forced: null }) as unknown,
      }),
    ]);
  });

  it('una pestaña que ya existe no se sobrescribe', async () => {
    await sheets.addTab('03', { hidden: false });
    const result = await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null, month: OCT });
    expect(result).toMatchObject({ status: PREPARE_STATUS.REJECTED });
  });

  it('sin catálogo ni días anteriores en el cuadre no prepara nada', async () => {
    const empty = openDatabase(':memory:');
    const noDays: CuadreReader = {
      listDays: () => Promise.resolve([]),
      readDay: () => Promise.reject(new Error('sin pestañas')),
      readDays: () => Promise.resolve([]),
    };
    const result = await prepareIpvLoad(
      { ...deps, catalog: new SqliteCatalogRepository(empty), books: singleBook(sheets, noDays) },
      OWNER,
      { ipv: ipv3, tc: null, month: OCT },
    );
    expect(result).toMatchObject({ status: PREPARE_STATUS.REJECTED });
  });

  it('sin catálogo, toma los costos de los días anteriores del cuadre', async () => {
    const empty = openDatabase(':memory:');
    const result = await prepareIpvLoad(
      { ...deps, catalog: new SqliteCatalogRepository(empty) },
      OWNER,
      { ipv: ipv3, tc: null, month: OCT },
    );
    expect(result.status).toBe(PREPARE_STATUS.READY);
  });

  it('el costo sale del cuadre aunque el catálogo no lo tenga', async () => {
    const [day2] = await asCuadreReader(cuadre).readDays(['02']);
    const known = day2?.rows.find((row) => row.costo !== null && row.costo > 0);
    if (known === undefined) throw new Error('la pestaña 02 debería tener costos');
    deps.catalog.setCost({ product: known.product, cost: null, source: 'test', changedBy: null });

    const { pendingId } = ready(
      await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null, month: OCT }),
    );
    const payload = deps.pending.get(pendingId)?.payload as LoadIpvPayload;
    const row = payload.sheetValues.find((line) => line[0] === known.product);
    expect(row?.[1]).toBe(known.costo);
  });

  it('si no puede leer el cuadre, no prepara la carga', async () => {
    const failing: CuadreReader = {
      listDays: () => Promise.reject(new Error('cuota agotada')),
      readDay: () => Promise.reject(new Error('cuota agotada')),
      readDays: () => Promise.reject(new Error('cuota agotada')),
    };
    const result = await prepareIpvLoad({ ...deps, books: singleBook(sheets, failing) }, OWNER, {
      ipv: ipv3,
      tc: null,
      month: OCT,
    });
    expect(result).toMatchObject({
      status: PREPARE_STATUS.REJECTED,
      message: expect.stringContaining('No pude leer los costos del cuadre') as unknown,
    });
  });

  it('el dependiente no ve la utilidad ni la lista de costos faltantes', async () => {
    const { preview } = ready(
      await prepareIpvLoad(deps, CLERK, { ipv: ipv3, tc: null, month: OCT }),
    );
    expect(preview).not.toContain('Utilidad');
    expect(preview).not.toContain('pollo');
    expect(preview).toContain('productos sin costo');
    expect(preview).toContain('falta la TC');
  });

  it('si la escritura falla, borra la pestaña creada y lo registra', async () => {
    const { pendingId } = ready(
      await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: 780, month: OCT }),
    );
    sheets.failNext('setBackground');
    const result = await confirmPending(deps, OWNER, { pendingId });

    expect(result.status).toBe(CONFIRM_STATUS.FAILED);
    expect((await sheets.listTabs()).map((tab) => tab.title)).toEqual([TEMPLATE_TAB]);
    expect(deps.changeLog.list().map((entry) => entry.action)).toEqual([
      'load_ipv',
      'load_ipv_failed',
    ]);
    expect(deps.snapshots.lastActive()).toBeUndefined();
  });
});

describe('/ipv del 4 oct (84 finales vacías): bloqueado', () => {
  it('un dependiente ve la vista previa pero no puede confirmar ni forzar', async () => {
    const result = await prepareIpvLoad(deps, CLERK, { ipv: ipv4, tc: null, month: OCT });
    expect(result.status).toBe(PREPARE_STATUS.BLOCKED);
    if (result.status === PREPARE_STATUS.BLOCKED) {
      expect(result.preview).toContain('⛔ No se puede confirmar');
      expect(result.preview).not.toContain('Confirmar igual');
    }
  });

  it('una dueña no puede confirmar sin forzar; la acción sigue pendiente', async () => {
    const result = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv4, tc: null, month: OCT }));
    expect(result.requiresForce).toBe(true);
    expect(result.preview).toContain('Confirmar igual');

    const plain = await confirmPending(deps, OWNER, { pendingId: result.pendingId });
    expect(plain.status).toBe(CONFIRM_STATUS.BLOCKED);
    const noReason = await confirmPending(deps, OWNER, {
      pendingId: result.pendingId,
      forceReason: '  ',
    });
    expect(noReason.status).toBe(CONFIRM_STATUS.REASON_REQUIRED);
    expect(await sheets.listTabs()).toEqual([]);
    expect(deps.pending.get(result.pendingId)?.status).toBe('pending');
  });

  it('forzar exige ser dueña y deja el motivo en el log', async () => {
    const { pendingId } = ready(
      await prepareIpvLoad(deps, OWNER, { ipv: ipv4, tc: null, month: OCT }),
    );
    const forced = await confirmPending(deps, OWNER, {
      pendingId,
      forceReason: 'Las finales se llenan mañana; el IPV en papel está completo',
    });
    expect(forced.status).toBe(CONFIRM_STATUS.DONE);
    expect((await sheets.listTabs()).map((tab) => tab.title)).toContain('04');

    const [entry] = deps.changeLog.list();
    expect(entry?.detail).toMatchObject({
      forced: { reason: 'Las finales se llenan mañana; el IPV en papel está completo' },
    });
  });

  it('un rol sin permiso de forzar recibe FORBIDDEN aunque tenga la acción', async () => {
    const { pendingId } = ready(
      await prepareIpvLoad(deps, OWNER, { ipv: ipv4, tc: null, month: OCT }),
    );
    // Mismo usuario con rol degradado (p. ej. la dueña pasó a socia entre medias).
    const result = await confirmPending(
      deps,
      { telegramId: OWNER.telegramId, role: ROLE.PARTNER },
      { pendingId, forceReason: 'motivo' },
    );
    expect(result.status).toBe(CONFIRM_STATUS.FORBIDDEN);
  });
});

describe('confirmaciones', () => {
  it('solo quien pidió la acción la confirma, una sola vez, y vence a los 15 minutos', async () => {
    const first = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null, month: OCT }));
    expect((await confirmPending(deps, CLERK, { pendingId: first.pendingId })).status).toBe(
      CONFIRM_STATUS.NOT_OWNER,
    );
    expect((await confirmPending(deps, OWNER, { pendingId: first.pendingId })).status).toBe(
      CONFIRM_STATUS.DONE,
    );
    expect((await confirmPending(deps, OWNER, { pendingId: first.pendingId })).status).toBe(
      CONFIRM_STATUS.ALREADY_RESOLVED,
    );

    await sheets.deleteTab('03');
    const late = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null, month: OCT }));
    now = new Date(now.getTime() + 15 * 60_000);
    expect((await confirmPending(deps, OWNER, { pendingId: late.pendingId })).status).toBe(
      CONFIRM_STATUS.EXPIRED,
    );
    expect((await sheets.listTabs()).map((tab) => tab.title)).not.toContain('03');
  });

  it('❌ Cancelar no escribe nada', async () => {
    const { pendingId } = ready(
      await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null, month: OCT }),
    );
    expect(cancelPending(deps, OWNER, pendingId).status).toBe(CONFIRM_STATUS.DONE);
    expect((await confirmPending(deps, OWNER, { pendingId })).status).toBe(
      CONFIRM_STATUS.ALREADY_RESOLVED,
    );
    expect(await sheets.listTabs()).toEqual([]);
  });
});

describe('/tc y /deshacer', () => {
  async function load3(): Promise<void> {
    const { pendingId } = ready(
      await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null, month: OCT }),
    );
    await confirmPending(deps, OWNER, { pendingId });
  }

  it('/deshacer borra la pestaña creada por /ipv', async () => {
    await load3();
    const undo = ready(prepareUndo(deps, OWNER));
    expect(undo.preview).toContain('borrar la pestaña 03');

    const result = await confirmPending(deps, OWNER, { pendingId: undo.pendingId });
    expect(result.status).toBe(CONFIRM_STATUS.DONE);
    expect((await sheets.listTabs()).map((tab) => tab.title)).not.toContain('03');
    expect(deps.changeLog.list().map((entry) => entry.action)).toEqual(['load_ipv', 'undo']);
    expect(prepareUndo(deps, OWNER)).toMatchObject({ status: PREPARE_STATUS.REJECTED });
  });

  it('/tc escribe Q18 y /deshacer devuelve el valor anterior', async () => {
    await load3();
    const first = ready(await prepareSetTc(deps, OWNER, { tab: '03', tc: 780 }));
    expect(first.preview).toContain('vacía → 780');
    await confirmPending(deps, OWNER, { pendingId: first.pendingId });
    expect(sheets.cell('03', 'Q18')).toBe(780);

    const second = ready(await prepareSetTc(deps, OWNER, { tab: '03', tc: 790 }));
    expect(second.preview).toContain('780 → 790');
    await confirmPending(deps, OWNER, { pendingId: second.pendingId });
    expect(sheets.cell('03', 'Q18')).toBe(790);

    const undo = ready(prepareUndo(deps, OWNER));
    expect(undo.preview).toContain('restaurar P18:Q18 de la pestaña 03');
    await confirmPending(deps, OWNER, { pendingId: undo.pendingId });
    expect(sheets.cell('03', 'Q18')).toBe(780);
    expect(sheets.cell('03', 'P18')).toBe('TC.');

    expect(deps.changeLog.list().map((entry) => [entry.action, entry.detail])).toEqual([
      ['load_ipv', expect.anything()],
      ['set_tc', { month: OCT, previous: null, tc: 780 }],
      ['set_tc', { month: OCT, previous: 780, tc: 790 }],
      ['undo', expect.objectContaining({ kind: 'cells' })],
    ]);
  });

  it('/tc respeta el formato antiguo (TC. 780 en P18) y lo guarda para deshacer', async () => {
    await sheets.addTab('02', { hidden: false });
    await sheets.writeRanges([{ tab: '02', a1: 'P18', values: [['TC. 780']] }]);

    const tc = ready(await prepareSetTc(deps, OWNER, { tab: '02', tc: 785 }));
    expect(tc.preview).toContain('780 → 785');
    await confirmPending(deps, OWNER, { pendingId: tc.pendingId });
    expect([sheets.cell('02', 'P18'), sheets.cell('02', 'Q18')]).toEqual(['TC.', 785]);

    await confirmPending(deps, OWNER, { pendingId: ready(prepareUndo(deps, OWNER)).pendingId });
    expect([sheets.cell('02', 'P18'), sheets.cell('02', 'Q18')]).toEqual(['TC. 780', undefined]);
  });

  it('/tc no escribe si P18 no es la TC (resumen corrido, como la hoja 04)', async () => {
    await sheets.addTab('04', { hidden: false });
    await sheets.writeRanges([{ tab: '04', a1: 'P18', values: [['Utilidad']] }]);
    expect(await prepareSetTc(deps, OWNER, { tab: '04', tc: 780 })).toMatchObject({
      status: PREPARE_STATUS.REJECTED,
    });
  });

  it('/tc rechaza valores no positivos y pestañas que no existen', async () => {
    expect(await prepareSetTc(deps, OWNER, { tab: '03', tc: 0 })).toMatchObject({
      status: PREPARE_STATUS.REJECTED,
    });
    expect(await prepareSetTc(deps, OWNER, { tab: '09', tc: 780 })).toMatchObject({
      status: PREPARE_STATUS.REJECTED,
    });
  });
});

describe('el catálogo sigue al cuadre', () => {
  async function confirmDay3(): Promise<LoadIpvPayload> {
    const { pendingId } = ready(
      await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: 780, month: OCT }),
    );
    const payload = deps.pending.get(pendingId)?.payload as LoadIpvPayload;
    await confirmPending(deps, OWNER, { pendingId });
    return payload;
  }

  const rowsOf = (payload: LoadIpvPayload) =>
    payload.sheetValues.map(([product, cost]) => ({
      product: String(product),
      cost: typeof cost === 'number' ? cost : null,
    }));

  it('al confirmar guarda los productos escritos y los costos que cambiaron', async () => {
    const payload = await confirmDay3();
    const rows = rowsOf(payload);

    for (const { product } of rows) expect(deps.catalog.findProduct(product)).toBeDefined();
    for (const { product, cost } of rows) {
      if (cost !== null) expect(deps.catalog.findProduct(product)?.cost).toBe(cost);
    }
  });

  it('un costo igual no repite el historial', async () => {
    const payload = await confirmDay3();
    const sample = rowsOf(payload).find((row) => row.cost !== null);
    if (sample === undefined) throw new Error('sin costos en la fixture');
    const history = deps.catalog.costHistory(sample.product).length;
    const again = syncCatalog(deps.catalog, sheetCostRows(payload.sheetValues), 'cuadre:test');
    expect(again).toEqual({ added: [], costsUpdated: 0 });
    expect(deps.catalog.costHistory(sample.product)).toHaveLength(history);
  });

  it('/deshacer borra la pestaña pero deja los productos en el catálogo', async () => {
    const payload = await confirmDay3();
    await confirmPending(deps, OWNER, { pendingId: ready(prepareUndo(deps, OWNER)).pendingId });
    for (const { product } of rowsOf(payload)) {
      expect(deps.catalog.findProduct(product)).toBeDefined();
    }
  });

  it('rehacer un día viejo agrega productos pero no devuelve costos viejos', async () => {
    await sheets.addTab('05', { hidden: false });
    const costs = new Map(deps.catalog.costSources().map((row) => [row.product, row.costo]));
    await confirmDay3();
    for (const [product, cost] of costs) expect(deps.catalog.findProduct(product)?.cost).toBe(cost);
  });
});

describe('dayTab', () => {
  it('usa dos dígitos', () => {
    expect(dayTab({ day: 3, month: 10 })).toBe('03');
    expect(dayTab({ day: 21, month: 10 })).toBe('21');
  });
});

describe('un libro de cuadre por mes', () => {
  let october: FakeSheetsGateway;
  let november: FakeSheetsGateway;
  let monthly: PipelineDeps;

  beforeEach(() => {
    const settings = new SqliteSettingsRepository(openDatabase(':memory:'));
    registerBook(settings, '2026-10', 'oct');
    registerBook(settings, '2026-11', 'nov');
    october = sheets;
    november = new FakeSheetsGateway();
    const opened: Record<string, { sheets: FakeSheetsGateway; cuadre: CuadreReader }> = {
      // Octubre: la hoja simulada para escribir y el cuadre real 01–05 para leer costos.
      oct: { sheets: october, cuadre: asCuadreReader(cuadre) },
      nov: { sheets: november, cuadre: new SheetsCuadreReader(november) },
    };
    const books = new RegistryCuadreBooks(
      settings,
      (id) => {
        const book = opened[id];
        if (book === undefined) throw new Error(`sin libro ${id}`);
        return book;
      },
      '2026-10',
    );
    // Catálogo vacío: los costos solo pueden salir del libro de octubre.
    monthly = { ...deps, books, catalog: new SqliteCatalogRepository(openDatabase(':memory:')) };
  });

  it('el primer día del mes toma los costos del libro del mes anterior', async () => {
    const { pendingId, preview } = ready(
      await prepareIpvLoad(monthly, OWNER, { ipv: ipv3, tc: null, month: '2026-11' }),
    );
    expect(preview).toContain('Venta: 90,356 CUP');
    const payload = monthly.pending.get(pendingId)?.payload as LoadIpvPayload;
    expect(payload.month).toBe('2026-11');
    // Noviembre no tiene días y el catálogo está vacío: los costos salen de octubre.
    expect(payload.yellowCells.length).toBeLessThan(payload.sheetValues.length);
  });

  it('sin libro del mes anterior ni catálogo, no hay de dónde sacar costos', async () => {
    const settings = new SqliteSettingsRepository(openDatabase(':memory:'));
    registerBook(settings, '2026-11', 'nov');
    const books = new RegistryCuadreBooks(
      settings,
      () => ({ sheets: november, cuadre: new SheetsCuadreReader(november) }),
      '2026-10',
    );
    const result = await prepareIpvLoad({ ...monthly, books }, OWNER, {
      ipv: ipv3,
      tc: null,
      month: '2026-11',
    });
    expect(result).toMatchObject({
      status: PREPARE_STATUS.REJECTED,
      message: expect.stringContaining('No hay costos') as unknown,
    });
  });

  it('la pestaña se crea en el libro de su mes, nunca en el de otro', async () => {
    const { pendingId } = ready(
      await prepareIpvLoad(monthly, OWNER, { ipv: ipv3, tc: 780, month: '2026-11' }),
    );
    expect((await confirmPending(monthly, OWNER, { pendingId })).status).toBe(CONFIRM_STATUS.DONE);
    expect((await november.listTabs()).map((tab) => tab.title)).toContain('03');
    expect((await october.listTabs()).map((tab) => tab.title)).not.toContain('03');

    // /tc y /deshacer van al mismo libro.
    const tc = ready(await prepareSetTc(monthly, OWNER, { tab: '03', tc: 790, month: '2026-11' }));
    await confirmPending(monthly, OWNER, { pendingId: tc.pendingId });
    expect(november.cell('03', 'Q18')).toBe(790);
    await confirmPending(monthly, OWNER, {
      pendingId: ready(prepareUndo(monthly, OWNER)).pendingId,
    });
    expect(november.cell('03', 'Q18')).toBe(780);
    await confirmPending(monthly, OWNER, {
      pendingId: ready(prepareUndo(monthly, OWNER)).pendingId,
    });
    expect((await november.listTabs()).map((tab) => tab.title)).not.toContain('03');
  });

  it('un mes sin libro no se carga y explica cómo registrarlo', async () => {
    const result = await prepareIpvLoad(monthly, OWNER, { ipv: ipv3, tc: null, month: '2026-12' });
    expect(result).toMatchObject({
      status: PREPARE_STATUS.REJECTED,
      message: expect.stringContaining('/cuadremes 2026-12') as unknown,
    });
    expect(
      await prepareSetTc(monthly, OWNER, { tab: '03', tc: 780, month: '2026-12' }),
    ).toMatchObject({ status: PREPARE_STATUS.REJECTED });
  });

  it('una escritura guardada sin mes (antes de los libros por mes) se deshace en el libro de siempre', async () => {
    await october.addTab('09', { hidden: false });
    monthly.snapshots.create({
      changeLogId: null,
      telegramId: OWNER.telegramId,
      payload: { kind: SNAPSHOT_KIND.CREATE_TAB, tab: '09' },
    });
    await confirmPending(monthly, OWNER, {
      pendingId: ready(prepareUndo(monthly, OWNER)).pendingId,
    });
    expect((await october.listTabs()).map((tab) => tab.title)).not.toContain('09');
  });
});

describe('/cierremes y meses cerrados', () => {
  const NOV_3 = { year: 2026, month: 11, day: 3 };
  const closeDeps = () => ({
    books: deps.books,
    settings: deps.settings,
    changeLog: deps.changeLog,
    hasFixedExpenses: false,
    today: NOV_3,
  });

  it('sin mes, del 1 al 10 revisa el mes anterior; acepta AAAA-MM y reabrir', () => {
    expect(parseCloseArgs('', NOV_3)).toEqual({ kind: CLOSE_REQUEST.REVIEW, month: '2026-10' });
    expect(parseCloseArgs('2026-11', NOV_3)).toEqual({
      kind: CLOSE_REQUEST.REVIEW,
      month: '2026-11',
    });
    expect(parseCloseArgs('2026-10 reabrir', NOV_3)).toEqual({
      kind: CLOSE_REQUEST.REOPEN,
      month: '2026-10',
    });
    expect(parseCloseArgs('octubre', NOV_3).kind).toBe(CLOSE_REQUEST.INVALID);
  });

  it('la revisión resume el mes, lista lo pendiente y no escribe nada', async () => {
    const review = await reviewMonthClose(closeDeps(), '2026-10');
    const text = review.messages.join('\n');
    expect(review.closable).toBe('2026-10');
    expect(text).toMatch(/Cierre de octubre 2026<\/b> \(5 días cargados\)/);
    expect(text).toContain('Inventario final (05)');
    expect(text).toContain('Faltan 26 días: 06, 07');
    expect(text).toContain('<b>Sugerencias</b>');
    // Primero el resumen, después las tablas y al final las sugerencias.
    expect(text.indexOf('Utilidad neta')).toBeLessThan(text.indexOf('<pre>'));
    expect(text.indexOf('<pre>')).toBeLessThan(text.indexOf('<b>Sugerencias</b>'));
    expect(deps.changeLog.list()).toEqual([]);
    expect(isMonthClosed(deps.settings, '2026-10')).toBe(false);
  });

  it('🔒 Cerrar mes lo marca cerrado, deja la apertura en el log y se puede reabrir', async () => {
    const review = await reviewMonthClose(closeDeps(), '2026-10');
    if (review.close === null) throw new Error('sin revisión');
    expect(confirmMonthClose(deps, 10, review.close)).toContain('octubre 2026 cerrado');
    expect(isMonthClosed(deps.settings, '2026-10')).toBe(true);
    const [entry] = deps.changeLog.list();
    expect(entry).toMatchObject({ action: 'close_month', target: '2026-10' });
    expect(entry?.detail).toMatchObject({
      lastDay: '05',
      openingInventory: review.close.openingInventory,
    });

    // Ya cerrado: la revisión no ofrece cerrar otra vez y dice cómo reabrir.
    const again = await reviewMonthClose(closeDeps(), '2026-10');
    expect(again.closable).toBeNull();
    expect(again.messages.join('\n')).toContain('/cierremes 2026-10 reabrir');

    expect(reopenMonthClose(deps, 10, '2026-10')).toContain('reabierto');
    expect(isMonthClosed(deps.settings, '2026-10')).toBe(false);
    expect(reopenMonthClose(deps, 10, '2026-10')).toContain('no estaba cerrado');
  });

  it('en un mes cerrado, /ipv solo se confirma forzando y el dependiente no puede', async () => {
    markMonthClosed(deps.settings, OCT);
    // El 03 no tiene bloqueos propios: solo lo frena el mes cerrado.
    const clerk = await prepareIpvLoad(deps, CLERK, { ipv: ipv3, tc: 780, month: OCT });
    expect(clerk).toMatchObject({ status: PREPARE_STATUS.BLOCKED });

    const owner = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: 780, month: OCT }));
    expect(owner.requiresForce).toBe(true);
    expect(owner.preview).toContain('octubre 2026 está cerrado');
    const plain = await confirmPending(deps, OWNER, { pendingId: owner.pendingId });
    expect(plain.status).toBe(CONFIRM_STATUS.BLOCKED);
    const forced = await confirmPending(deps, OWNER, {
      pendingId: owner.pendingId,
      forceReason: 'faltaba el 03',
    });
    expect(forced.status).toBe(CONFIRM_STATUS.DONE);
  });

  it('en un mes cerrado, /tc y /deshacer piden "Confirmar igual"', async () => {
    const { pendingId } = ready(
      await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null, month: OCT }),
    );
    await confirmPending(deps, OWNER, { pendingId });
    markMonthClosed(deps.settings, OCT);

    const tc = ready(await prepareSetTc(deps, OWNER, { tab: '03', tc: 780, month: OCT }));
    expect(tc.requiresForce).toBe(true);
    expect((await confirmPending(deps, OWNER, { pendingId: tc.pendingId })).status).toBe(
      CONFIRM_STATUS.BLOCKED,
    );

    const undo = ready(prepareUndo(deps, OWNER));
    expect(undo.requiresForce).toBe(true);
    expect(undo.preview).toContain('está cerrado');
    const done = await confirmPending(deps, OWNER, {
      pendingId: undo.pendingId,
      forceReason: 'carga repetida',
    });
    expect(done.status).toBe(CONFIRM_STATUS.DONE);
  });
});
