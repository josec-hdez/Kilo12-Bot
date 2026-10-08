import type { sheets_v4 } from '@googleapis/sheets';
import { beforeEach, describe, expect, it } from 'vitest';
import { SheetsCuadreReader } from '../../../src/adapters/sheets/sheets-cuadre-reader.js';
import { CuadreFormatError } from '../../../src/core/cuadre-layout.js';
import {
  a1WithTab,
  backgroundRequests,
  duplicateRequests,
  GoogleSheetsGateway,
  readServiceAccount,
  type SheetsClient,
} from '../../../src/adapters/sheets/google-sheets-gateway.js';
import { RENDER, YELLOW, type Grid, type TabInfo } from '../../../src/ports/sheets-gateway.js';

/** Cliente que no llama a la red: registra lo que el gateway le pide. */
class RecordingClient implements SheetsClient {
  readonly batchUpdates: sheets_v4.Schema$Request[][] = [];
  readonly valueUpdates: sheets_v4.Schema$ValueRange[][] = [];
  readonly gets: { ranges: string[]; render: string }[] = [];
  readonly clears: string[][] = [];

  constructor(private readonly tabs: TabInfo[]) {}

  getTabs(): Promise<TabInfo[]> {
    return Promise.resolve(this.tabs);
  }
  batchUpdate(_id: string, requests: sheets_v4.Schema$Request[]): Promise<void> {
    this.batchUpdates.push(requests);
    return Promise.resolve();
  }
  batchGet(_id: string, ranges: string[], render: string): Promise<Grid[]> {
    this.gets.push({ ranges, render });
    return Promise.resolve(ranges.map(() => []));
  }
  valuesBatchUpdate(_id: string, data: sheets_v4.Schema$ValueRange[]): Promise<void> {
    this.valueUpdates.push(data);
    return Promise.resolve();
  }
  batchClear(_id: string, ranges: string[]): Promise<void> {
    this.clears.push(ranges);
    return Promise.resolve();
  }
}

const TABS: TabInfo[] = [
  { sheetId: 11, title: '_plantilla', hidden: true, index: 0 },
  { sheetId: 22, title: "02 d'oct", hidden: false, index: 1 },
];

let client: RecordingClient;
let gateway: GoogleSheetsGateway;

beforeEach(() => {
  client = new RecordingClient(TABS);
  gateway = new GoogleSheetsGateway(client, 'sheet-id', () => 999);
});

describe('pedidos a la API de Sheets', () => {
  it('cita el nombre de la pestaña y duplica las comillas simples', () => {
    expect(a1WithTab('03', 'A2:N86')).toBe("'03'!A2:N86");
    expect(a1WithTab("02 d'oct")).toBe("'02 d''oct'");
  });

  it('duplica y fija la visibilidad en el mismo batchUpdate', () => {
    expect(duplicateRequests(11, 999, '03', 2, { hidden: false })).toEqual([
      {
        duplicateSheet: {
          sourceSheetId: 11,
          newSheetId: 999,
          newSheetName: '03',
          insertSheetIndex: 2,
        },
      },
      { updateSheetProperties: { properties: { sheetId: 999, hidden: false }, fields: 'hidden' } },
    ]);
  });

  it('pinta cada celda con un repeatCell de 1×1 (índices en base 0, fin exclusivo)', () => {
    expect(backgroundRequests(7, ['B5'], YELLOW)).toEqual([
      {
        repeatCell: {
          range: {
            sheetId: 7,
            startRowIndex: 4,
            endRowIndex: 5,
            startColumnIndex: 1,
            endColumnIndex: 2,
          },
          cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 0 } } },
          fields: 'userEnteredFormat.backgroundColor',
        },
      },
    ]);
  });
});

describe('GoogleSheetsGateway', () => {
  it('duplica _plantilla usando su sheetId y la deja al final', async () => {
    const tab = await gateway.duplicateTab('_plantilla', '03', { hidden: false });
    expect(tab).toEqual({ sheetId: 999, title: '03', hidden: false, index: 2 });
    expect(client.batchUpdates[0]).toEqual(duplicateRequests(11, 999, '03', 2, { hidden: false }));
  });

  it('escribe con rangos citados (USER_ENTERED lo pone el cliente)', async () => {
    await gateway.writeRanges([{ tab: '03', a1: 'Q18', values: [[780]] }]);
    expect(client.valueUpdates[0]).toEqual([
      { range: "'03'!Q18", majorDimension: 'ROWS', values: [[780]] },
    ]);
  });

  it('lee con el render pedido y no llama a la API si no hay nada que escribir o pintar', async () => {
    await gateway.readRanges([{ tab: '03', a1: 'P18:Q18' }], RENDER.FORMULA);
    expect(client.gets).toEqual([{ ranges: ["'03'!P18:Q18"], render: 'FORMULA' }]);

    await gateway.writeRanges([]);
    await gateway.setBackground('03', [], YELLOW);
    expect(client.valueUpdates).toEqual([]);
    expect(client.batchUpdates).toEqual([]);
  });

  it('el lector del cuadre pide todos los días en dos batchGet (fórmulas y valores)', async () => {
    const days = new RecordingClient([
      { sheetId: 3, title: '03', hidden: false, index: 0 },
      { sheetId: 4, title: '04', hidden: false, index: 1 },
    ]);
    const reader = new SheetsCuadreReader(new GoogleSheetsGateway(days, 'sheet-id', () => 999));
    // El cliente de prueba devuelve rangos vacíos: falla al validar los encabezados,
    // pero después de pedir los datos, que es lo que se comprueba aquí.
    await expect(reader.readDays(['03', '04'])).rejects.toThrow(CuadreFormatError);
    const ranges = ["'03'!A1:N300", "'03'!P1:Q30", "'04'!A1:N300", "'04'!P1:Q30"];
    expect(days.gets).toEqual([
      { ranges, render: 'FORMULA' },
      { ranges, render: 'UNFORMATTED_VALUE' },
    ]);
  });

  it('borra, oculta y limpia por nombre de pestaña', async () => {
    await gateway.deleteTab("02 d'oct");
    await gateway.setHidden('_plantilla', false);
    await gateway.clearTab('_config');
    expect(client.batchUpdates).toEqual([
      [{ deleteSheet: { sheetId: 22 } }],
      [{ updateSheetProperties: { properties: { sheetId: 11, hidden: false }, fields: 'hidden' } }],
    ]);
    expect(client.clears).toEqual([["'_config'"]]);
  });

  it('falla con un mensaje claro si la pestaña no existe', async () => {
    await expect(gateway.deleteTab('99')).rejects.toThrow(/No existe la pestaña "99"/);
  });
});

describe('readServiceAccount', () => {
  it('acepta el JSON completo y rechaza algo que no es una service account', () => {
    expect(readServiceAccount('{"client_email":"bot@x.iam.gserviceaccount.com"}')).toMatchObject({
      client_email: 'bot@x.iam.gserviceaccount.com',
    });
    expect(() => readServiceAccount('{"foo":1}')).toThrow(/client_email/);
  });
});
