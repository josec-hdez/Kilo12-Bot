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
import { CuadreXlsxReader } from '../../src/adapters/xlsx/cuadre-xlsx-reader.js';
import { ExcelIpvSource } from '../../src/adapters/xlsx/excel-ipv-source.js';
import { cancelPending, confirmPending } from '../../src/app/confirm.js';
import { dayTab, prepareIpvLoad } from '../../src/app/load-ipv.js';
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
import type { IpvDay } from '../../src/core/types.js';
import { RENDER, YELLOW, type CellValue } from '../../src/ports/sheets-gateway.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const OWNER: Actor = { telegramId: 10, role: ROLE.OWNER };
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
  seedAll(
    { users: new SqliteUserRepository(db), catalog, settings: new SqliteSettingsRepository(db) },
    { ownerIds: [10], equivalences: EQUIVALENCES, cuadre: initialCuadreSeed(catalog, cuadre) },
  );
  sheets = new FakeSheetsGateway();
  deps = {
    sheets,
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
    const result = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: 780 }));
    expect(result.requiresForce).toBe(false);
    expect(result.preview).toContain('Venta: 90,356 CUP');
    expect(result.preview).toContain('✅ igual al IMPORTE TOTAL del IPV');
    expect(result.preview).toContain('Utilidad bruta');
    expect(await sheets.listTabs()).toEqual([]);
    expect(deps.changeLog.list()).toEqual([]);
  });

  it('al confirmar crea la pestaña 03 desde _plantilla, con fórmulas, TC y amarillos', async () => {
    const { pendingId } = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: 780 }));
    const result = await confirmPending(deps, OWNER, { pendingId });
    expect(result.status).toBe(CONFIRM_STATUS.DONE);
    expect(result.message).toMatch(/Pestaña 03 creada con 85 productos/);

    const tabs = await sheets.listTabs();
    expect(tabs.map((tab) => [tab.title, tab.hidden])).toEqual([
      [TEMPLATE_TAB, true],
      ['03', false],
      [CONFIG_TAB, false],
    ]);

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
    const result = await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null });
    expect(result).toMatchObject({ status: PREPARE_STATUS.REJECTED });
  });

  it('sin catálogo no prepara nada', async () => {
    const empty = openDatabase(':memory:');
    const result = await prepareIpvLoad(
      { ...deps, catalog: new SqliteCatalogRepository(empty) },
      OWNER,
      { ipv: ipv3, tc: null },
    );
    expect(result).toMatchObject({ status: PREPARE_STATUS.REJECTED });
  });

  it('el dependiente no ve la utilidad ni la lista de costos faltantes', async () => {
    const { preview } = ready(await prepareIpvLoad(deps, CLERK, { ipv: ipv3, tc: null }));
    expect(preview).not.toContain('Utilidad');
    expect(preview).not.toContain('pollo');
    expect(preview).toContain('productos sin costo');
    expect(preview).toContain('falta la TC');
  });

  it('si la escritura falla, borra la pestaña creada y lo registra', async () => {
    const { pendingId } = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: 780 }));
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
    const result = await prepareIpvLoad(deps, CLERK, { ipv: ipv4, tc: null });
    expect(result.status).toBe(PREPARE_STATUS.BLOCKED);
    if (result.status === PREPARE_STATUS.BLOCKED) {
      expect(result.preview).toContain('⛔ No se puede confirmar');
      expect(result.preview).not.toContain('Confirmar igual');
    }
  });

  it('una dueña no puede confirmar sin forzar; la acción sigue pendiente', async () => {
    const result = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv4, tc: null }));
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
    const { pendingId } = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv4, tc: null }));
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
    const { pendingId } = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv4, tc: null }));
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
    const first = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null }));
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
    const late = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null }));
    now = new Date(now.getTime() + 15 * 60_000);
    expect((await confirmPending(deps, OWNER, { pendingId: late.pendingId })).status).toBe(
      CONFIRM_STATUS.EXPIRED,
    );
    expect((await sheets.listTabs()).map((tab) => tab.title)).not.toContain('03');
  });

  it('❌ Cancelar no escribe nada', async () => {
    const { pendingId } = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null }));
    expect(cancelPending(deps, OWNER, pendingId).status).toBe(CONFIRM_STATUS.DONE);
    expect((await confirmPending(deps, OWNER, { pendingId })).status).toBe(
      CONFIRM_STATUS.ALREADY_RESOLVED,
    );
    expect(await sheets.listTabs()).toEqual([]);
  });
});

describe('/tc y /deshacer', () => {
  async function load3(): Promise<void> {
    const { pendingId } = ready(await prepareIpvLoad(deps, OWNER, { ipv: ipv3, tc: null }));
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
      ['set_tc', { previous: null, tc: 780 }],
      ['set_tc', { previous: 780, tc: 790 }],
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

describe('dayTab', () => {
  it('usa dos dígitos', () => {
    expect(dayTab({ day: 3, month: 10 })).toBe('03');
    expect(dayTab({ day: 21, month: 10 })).toBe('21');
  });
});
