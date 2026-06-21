import log from 'electron-log';
import { join } from 'path';

/**
 * Logger utilisant electron-log : logs horodatés persistés dans
 * %APPDATA%/carreer-ops/logs/main.log avec rotation automatique.
 *
 * H1 : on évite l'import statique de { app } depuis 'electron' au niveau du
 * module. Un import statique crashe si ce fichier est chargé hors du contexte
 * Electron (tests unitaires, scripts de build). On utilise require() à
 * l'intérieur d'un try/catch pour une initialisation conditionnelle.
 *
 * M8 : on utilise app.isPackaged plutôt que NODE_ENV pour détecter la prod —
 * plus fiable en Electron (NODE_ENV peut rester 'development' en prod packagée).
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  const logDir = join(app.getPath('userData'), 'logs');
  log.transports.file.resolvePathFn = () => join(logDir, 'main.log');
  // Rotation : max 5 MB par fichier, 3 fichiers archivés.
  log.transports.file.maxSize = 5 * 1024 * 1024;
  // M8 : app.isPackaged est plus fiable que NODE_ENV en Electron.
  log.transports.console.level = app.isPackaged ? 'warn' : 'debug';
} catch {
  // Hors Electron (tests, scripts) — pas de transport fichier, console en debug.
  log.transports.console.level = 'debug';
}

log.transports.file.level = 'info';

export const logger = {
  info: (...args: unknown[]) => log.info(...args),
  warn: (...args: unknown[]) => log.warn(...args),
  error: (...args: unknown[]) => log.error(...args),
  debug: (...args: unknown[]) => log.debug(...args),
};

/**
 * ADM-2 : retourne le chemin du fichier de log electron-log principal.
 * On passe par une fonction intermédiaire castée en any pour éviter les
 * incompatibilités de types entre les versions de l'API electron-log.
 */
export function getLogFilePath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const file = (log.transports.file as any);
    // electron-log v5 expose getFile().path
    if (typeof file.getFile === 'function') {
      return (file.getFile() as { path: string }).path ?? '';
    }
    return '';
  } catch {
    return '';
  }
}
