import { open, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { handle } from './registry';
import { getLogFilePath } from '../../src/lib/logger';

const DEFAULT_LINES = 200;
const MAX_READ_BYTES = 256 * 1024;

/**
 * ADM-2 : lecture des dernières lignes du fichier de log electron-log.
 */
export function registerLogsHandlers(): void {
  handle('logs:tail', async ({ lines } = {}) => {
    const n = lines ?? DEFAULT_LINES;
    const logPath = getLogFilePath();

    if (!logPath || !existsSync(logPath)) {
      return ['(fichier de log introuvable)'];
    }

    try {
      const { size } = await stat(logPath);
      const readSize = Math.min(size, MAX_READ_BYTES);
      const fh = await open(logPath, 'r');
      try {
        const buf = Buffer.alloc(readSize);
        await fh.read(buf, 0, readSize, Math.max(0, size - readSize));
        const content = buf.toString('utf8');
        const allLines = content.split(/\r?\n/).filter(Boolean);
        return allLines.slice(-n);
      } finally {
        await fh.close();
      }
    } catch (err) {
      return [`Impossible de lire les logs : ${err instanceof Error ? err.message : String(err)}`];
    }
  });
}
