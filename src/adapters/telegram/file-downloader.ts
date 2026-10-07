import type { Api } from 'grammy';

/** Descarga un archivo de Telegram por su `file_id`. Inyectable para las pruebas. */
export type FileDownloader = (fileId: string) => Promise<ArrayBuffer>;

/** Telegram entrega una ruta temporal (60 min) que se descarga con el token del bot. */
export function telegramFileDownloader(api: Api, token: string): FileDownloader {
  return async (fileId) => {
    const file = await api.getFile(fileId);
    if (file.file_path === undefined) throw new Error('Telegram no devolvió la ruta del archivo.');
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo (HTTP ${String(response.status)}).`);
    }
    return response.arrayBuffer();
  };
}
