import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { auth, sheets, type sheets_v4 } from '@googleapis/sheets';
import { parseCell } from '../../core/a1.js';
import type {
  DuplicateOptions,
  Grid,
  RangeWrite,
  Render,
  RgbColor,
  SheetsGateway,
  TabInfo,
  TabRange,
} from '../../ports/sheets-gateway.js';

type Request = sheets_v4.Schema$Request;

/**
 * Las llamadas de la API de Sheets que usa el bot. Separarlas permite probar los
 * pedidos que se arman sin red: las pruebas pasan un cliente que solo los registra.
 */
export interface SheetsClient {
  getTabs(spreadsheetId: string): Promise<TabInfo[]>;
  batchUpdate(spreadsheetId: string, requests: Request[]): Promise<void>;
  batchGet(spreadsheetId: string, ranges: string[], render: Render): Promise<Grid[]>;
  valuesBatchUpdate(spreadsheetId: string, data: sheets_v4.Schema$ValueRange[]): Promise<void>;
  batchClear(spreadsheetId: string, ranges: string[]): Promise<void>;
}

/** `'03'!A2:N86`. Las comillas simples del nombre se duplican, como pide Sheets. */
export function a1WithTab(tab: string, a1?: string): string {
  const quoted = `'${tab.replace(/'/g, "''")}'`;
  return a1 === undefined ? quoted : `${quoted}!${a1}`;
}

/** Duplica y deja la copia visible u oculta en un solo batchUpdate (atómico). */
export function duplicateRequests(
  sourceSheetId: number,
  newSheetId: number,
  title: string,
  insertSheetIndex: number,
  options: DuplicateOptions,
): Request[] {
  return [
    {
      duplicateSheet: {
        sourceSheetId,
        newSheetId,
        newSheetName: title,
        insertSheetIndex,
      },
    },
    hiddenRequest(newSheetId, options.hidden),
  ];
}

export function hiddenRequest(sheetId: number, hidden: boolean): Request {
  return { updateSheetProperties: { properties: { sheetId, hidden }, fields: 'hidden' } };
}

/** Un repeatCell por celda: los costos faltantes no son contiguos. */
export function backgroundRequests(
  sheetId: number,
  cells: readonly string[],
  color: RgbColor,
): Request[] {
  return cells.map((address) => {
    const { column, row } = parseCell(address);
    return {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: row - 1,
          endRowIndex: row,
          startColumnIndex: column,
          endColumnIndex: column + 1,
        },
        cell: { userEnteredFormat: { backgroundColor: { ...color } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    };
  });
}

/** IDs de pestaña nuevos: enteros positivos de 31 bits, como los genera Sheets. */
const newSheetId = (): number => randomInt(1, 2 ** 31 - 1);

export class GoogleSheetsGateway implements SheetsGateway {
  constructor(
    private readonly client: SheetsClient,
    private readonly spreadsheetId: string,
    private readonly generateSheetId: () => number = newSheetId,
  ) {}

  listTabs(): Promise<TabInfo[]> {
    return this.client.getTabs(this.spreadsheetId);
  }

  async addTab(title: string, options: DuplicateOptions): Promise<TabInfo> {
    const sheetId = this.generateSheetId();
    const index = (await this.listTabs()).length;
    await this.client.batchUpdate(this.spreadsheetId, [
      { addSheet: { properties: { sheetId, title, hidden: options.hidden, index } } },
    ]);
    return { sheetId, title, hidden: options.hidden, index };
  }

  async duplicateTab(source: string, title: string, options: DuplicateOptions): Promise<TabInfo> {
    const tabs = await this.listTabs();
    const from = requireTab(tabs, source);
    const sheetId = this.generateSheetId();
    const index = tabs.length;
    await this.client.batchUpdate(
      this.spreadsheetId,
      duplicateRequests(from.sheetId, sheetId, title, index, options),
    );
    return { sheetId, title, hidden: options.hidden, index };
  }

  async deleteTab(title: string): Promise<void> {
    const { sheetId } = requireTab(await this.listTabs(), title);
    await this.client.batchUpdate(this.spreadsheetId, [{ deleteSheet: { sheetId } }]);
  }

  async setHidden(title: string, hidden: boolean): Promise<void> {
    const { sheetId } = requireTab(await this.listTabs(), title);
    await this.client.batchUpdate(this.spreadsheetId, [hiddenRequest(sheetId, hidden)]);
  }

  readRanges(ranges: readonly TabRange[], render: Render): Promise<Grid[]> {
    return this.client.batchGet(
      this.spreadsheetId,
      ranges.map(({ tab, a1 }) => a1WithTab(tab, a1)),
      render,
    );
  }

  async writeRanges(writes: readonly RangeWrite[]): Promise<void> {
    if (writes.length === 0) return;
    await this.client.valuesBatchUpdate(
      this.spreadsheetId,
      writes.map(({ tab, a1, values }) => ({
        range: a1WithTab(tab, a1),
        majorDimension: 'ROWS',
        values,
      })),
    );
  }

  async clearTab(title: string): Promise<void> {
    await this.client.batchClear(this.spreadsheetId, [a1WithTab(title)]);
  }

  async setBackground(tab: string, cells: readonly string[], color: RgbColor): Promise<void> {
    if (cells.length === 0) return;
    const { sheetId } = requireTab(await this.listTabs(), tab);
    await this.client.batchUpdate(this.spreadsheetId, backgroundRequests(sheetId, cells, color));
  }
}

function requireTab(tabs: readonly TabInfo[], title: string): TabInfo {
  const tab = tabs.find((candidate) => candidate.title === title);
  if (tab === undefined) throw new Error(`No existe la pestaña "${title}" en la hoja de cuadre`);
  return tab;
}

// ------------------------------------------------------------------ cliente real

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * `GOOGLE_SA_JSON` puede traer el JSON completo de la service account o la ruta a
 * un archivo .json.
 */
export function readServiceAccount(value: string): Record<string, unknown> {
  const text = value.trim().startsWith('{') ? value : readFileSync(value.trim(), 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || !('client_email' in parsed)) {
    throw new Error('GOOGLE_SA_JSON no parece una service account (falta client_email).');
  }
  return parsed;
}

/** Envuelve el cliente oficial (`@googleapis/sheets`) en la interfaz que usa el bot. */
export function createSheetsClient(serviceAccountJson: string): SheetsClient {
  const credentials = readServiceAccount(serviceAccountJson);
  const api = sheets({
    version: 'v4',
    auth: new auth.GoogleAuth({ credentials, scopes: SCOPES }),
  });

  return {
    async getTabs(spreadsheetId) {
      const response = await api.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title,hidden,index)',
      });
      return (response.data.sheets ?? []).map(({ properties }) => ({
        sheetId: properties?.sheetId ?? 0,
        title: properties?.title ?? '',
        hidden: properties?.hidden ?? false,
        index: properties?.index ?? 0,
      }));
    },
    async batchUpdate(spreadsheetId, requests) {
      await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    },
    async batchGet(spreadsheetId, ranges, render) {
      const response = await api.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption: render,
        majorDimension: 'ROWS',
      });
      return (response.data.valueRanges ?? []).map((range) => toGrid(range.values));
    },
    async valuesBatchUpdate(spreadsheetId, data) {
      await api.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
    },
    async batchClear(spreadsheetId, ranges) {
      await api.spreadsheets.values.batchClear({ spreadsheetId, requestBody: { ranges } });
    },
  };
}

/** La API devuelve `any[][]`; aquí se reduce a los tipos que puede tener una celda. */
function toGrid(values: unknown[][] | null | undefined): Grid {
  return (values ?? []).map((line) =>
    line.map((value) =>
      typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
        ? value
        : '',
    ),
  );
}
