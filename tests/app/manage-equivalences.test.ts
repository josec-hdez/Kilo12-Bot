import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteCatalogRepository } from '../../src/adapters/sqlite/catalog-repo.js';
import { openDatabase } from '../../src/adapters/sqlite/db.js';
import { SqliteChangeLogRepository } from '../../src/adapters/sqlite/history-repo.js';
import { SqliteSettingsRepository } from '../../src/adapters/sqlite/settings-repo.js';
import {
  ALIAS_PREPARE,
  applyAliasChange,
  EQUIVALENCE_REQUEST,
  equivalenceListPages,
  knownCuadreProducts,
  OWNER_ALIASES_SETTING,
  parseEquivalenceArgs,
  prepareAddAlias,
  prepareRemoveAlias,
  saveIpvAlias,
  type AliasPrepareResult,
  type EquivalenceDeps,
} from '../../src/app/manage-equivalences.js';
import { seedEquivalences } from '../../src/app/seed.js';
import type { CuadreReader } from '../../src/ports/cuadre-source.js';

let deps: EquivalenceDeps & {
  catalog: SqliteCatalogRepository;
  changeLog: SqliteChangeLogRepository;
};

const OWNER = 10;

beforeEach(() => {
  const db = openDatabase(':memory:');
  deps = {
    catalog: new SqliteCatalogRepository(db),
    changeLog: new SqliteChangeLogRepository(db),
    settings: new SqliteSettingsRepository(db),
  };
  for (const name of ['ketchup', 'chupachupa', 'pollo']) deps.catalog.ensureProduct(name);
  deps.catalog.addAlias('pollo', 'pollo lb');
});

function ready(result: AliasPrepareResult) {
  if (result.status !== ALIAS_PREPARE.READY) throw new Error(result.message);
  return result;
}

describe('parseEquivalenceArgs', () => {
  it('sin datos pide la lista', () => {
    expect(parseEquivalenceArgs('  ')).toEqual({ kind: EQUIVALENCE_REQUEST.LIST });
  });

  it('«cuadre = ipv» agrega, limpiando espacios', () => {
    expect(parseEquivalenceArgs(' chupachupa  =  chupa-chupa ')).toEqual({
      kind: EQUIVALENCE_REQUEST.ADD,
      cuadre: 'chupachupa',
      ipv: 'chupa-chupa',
    });
  });

  it('«quitar ipv» quita', () => {
    expect(parseEquivalenceArgs('Quitar pollo lb')).toEqual({
      kind: EQUIVALENCE_REQUEST.REMOVE,
      ipv: 'pollo lb',
    });
  });

  it('sin = o con un lado vacío explica el uso', () => {
    expect(parseEquivalenceArgs('chupachupa chupa-chupa').kind).toBe(EQUIVALENCE_REQUEST.INVALID);
    expect(parseEquivalenceArgs('= chupa').kind).toBe(EQUIVALENCE_REQUEST.INVALID);
  });
});

describe('agregar', () => {
  const known = ['ketchup', 'chupachupa', 'pollo', 'azucar campofino'];

  it('vista previa y, al aplicar, el alias queda en el catálogo y en el log', () => {
    const result = ready(
      prepareAddAlias(deps.catalog, { cuadre: 'Chupachupa', ipv: 'chupa-chupa' }, known),
    );
    expect(result.preview).toContain('Cuadre: chupachupa');
    expect(result.preview).toContain('IPV: chupa-chupa');

    expect(applyAliasChange(deps, OWNER, result.change)).toContain('ahora es equivalencia');
    expect(deps.catalog.aliasOwner('chupa-chupa')).toBe('chupachupa');
    expect(deps.changeLog.list()).toMatchObject([
      {
        telegramId: OWNER,
        action: 'add_equivalence',
        target: 'chupa-chupa',
        detail: { product: 'chupachupa' },
      },
    ]);
  });

  it('un producto que solo está en la hoja del cuadre se crea en el catálogo al guardar', () => {
    const result = ready(
      prepareAddAlias(deps.catalog, { cuadre: 'azucar campofino', ipv: 'azucar' }, known),
    );
    applyAliasChange(deps, OWNER, result.change);
    expect(deps.catalog.findProduct('azucar campofino')?.aliases).toEqual(['azucar']);
  });

  it('un nombre que no está en el cuadre se rechaza y sugiere los parecidos', () => {
    const result = prepareAddAlias(deps.catalog, { cuadre: 'ketchap', ipv: 'ketcup vima' }, known);
    expect(result).toMatchObject({ status: ALIAS_PREPARE.REJECTED });
    if (result.status === ALIAS_PREPARE.REJECTED) expect(result.message).toContain('ketchup');
  });

  it('si el alias ya es de ese producto, no hay nada que hacer', () => {
    const result = prepareAddAlias(deps.catalog, { cuadre: 'pollo', ipv: 'Pollo LB' }, known);
    expect(result.status).toBe(ALIAS_PREPARE.REJECTED);
  });

  it('si el alias es de otro producto, avisa y lo mueve', () => {
    const result = ready(
      prepareAddAlias(deps.catalog, { cuadre: 'chupachupa', ipv: 'pollo lb' }, known),
    );
    expect(result.preview).toContain('Hoy «pollo lb» es equivalencia de pollo');

    expect(applyAliasChange(deps, OWNER, result.change)).toBe(
      '✅ «pollo lb» pasó de pollo a chupachupa.',
    );
    expect(deps.catalog.aliasOwner('pollo lb')).toBe('chupachupa');
    expect(deps.catalog.findProduct('pollo')?.aliases).toEqual([]);
    expect(deps.changeLog.list()[0]).toMatchObject({
      action: 'move_equivalence',
      detail: { product: 'chupachupa', previousOwner: 'pollo' },
    });
  });

  it('saveIpvAlias (botón de /ipv) guarda y registra igual', () => {
    expect(saveIpvAlias(deps, OWNER, 'ketchup', 'ketcup vima')).toContain('ketchup');
    expect(deps.catalog.aliasOwner('ketcup vima')).toBe('ketchup');
    expect(deps.changeLog.list()[0]?.action).toBe('add_equivalence');
  });
});

describe('quitar', () => {
  it('vista previa, quita el alias y lo registra', () => {
    const result = ready(prepareRemoveAlias(deps.catalog, 'pollo lb'));
    expect(result.preview).toContain('ya no se junta con pollo');
    expect(applyAliasChange(deps, OWNER, result.change)).toBe(
      '✅ «pollo lb» ya no es equivalencia de pollo.',
    );
    expect(deps.catalog.aliasOwner('pollo lb')).toBeNull();
    expect(deps.changeLog.list()[0]).toMatchObject({
      action: 'remove_equivalence',
      target: 'pollo lb',
      detail: { product: 'pollo' },
    });
  });

  it('un alias que no existe se rechaza', () => {
    expect(prepareRemoveAlias(deps.catalog, 'wisky').status).toBe(ALIAS_PREPARE.REJECTED);
  });

  it('la tabla del código no resucita un alias quitado ni deshace uno movido', () => {
    applyAliasChange(deps, OWNER, ready(prepareRemoveAlias(deps.catalog, 'pollo lb')).change);
    saveIpvAlias(deps, OWNER, 'chupachupa', 'ketchup vima');
    expect(deps.settings.get(OWNER_ALIASES_SETTING)).toEqual(['ketchup vima', 'pollo lb']);

    const result = seedEquivalences(
      deps.catalog,
      [
        { cuadre: 'pollo', ipv: ['pollo lb'] },
        { cuadre: 'ketchup', ipv: ['ketchup vima', 'ketcup vima'] },
      ],
      new Set(deps.settings.get(OWNER_ALIASES_SETTING) as string[]),
    );
    expect(result.conflicts).toEqual([]);
    expect(deps.catalog.aliasOwner('pollo lb')).toBeNull();
    expect(deps.catalog.aliasOwner('ketchup vima')).toBe('chupachupa');
    // Lo que las dueñas no tocaron sí se sigue sumando.
    expect(deps.catalog.aliasOwner('ketcup vima')).toBe('ketchup');
  });
});

describe('lista y nombres del cuadre', () => {
  it('agrupa por producto del cuadre y explica el uso', () => {
    deps.catalog.addAlias('ketchup', 'ketchup vima');
    deps.catalog.addAlias('ketchup', 'ketcup vima');
    const [page, ...rest] = equivalenceListPages(deps.catalog);
    expect(rest).toEqual([]);
    expect(page).toContain('2 productos del cuadre, 3 nombres del IPV');
    expect(page).toContain('• ketchup ← ketchup vima, ketcup vima');
    expect(page).toContain('• pollo ← pollo lb');
    expect(page).toContain('/equivalencia quitar');
  });

  it('parte la lista larga en páginas que Telegram acepta', () => {
    for (let i = 0; i < 200; i++) {
      deps.catalog.ensureProduct(`producto de prueba número ${String(i)}`);
      deps.catalog.addAlias(`producto de prueba número ${String(i)}`, `alias largo ${String(i)}`);
    }
    const pages = equivalenceListPages(deps.catalog);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.length).toBeLessThan(4096);
  });

  it('sin equivalencias lo dice', () => {
    deps.catalog.removeAlias('pollo lb');
    expect(equivalenceListPages(deps.catalog)[0]).toContain('Todavía no hay equivalencias');
  });

  it('suma los nombres de la última pestaña del cuadre a los del catálogo', async () => {
    const cuadre = {
      listDays: () => Promise.resolve(['13', '14']),
      readDay: (tab: string) =>
        Promise.resolve({ tab, rows: [{ product: 'azucar campofino ' }, { product: 'Pollo' }] }),
      readDays: () => Promise.resolve([]),
    } as unknown as CuadreReader;
    expect(await knownCuadreProducts(deps.catalog, cuadre)).toEqual([
      'ketchup',
      'chupachupa',
      'pollo',
      'azucar campofino',
    ]);
  });
});
