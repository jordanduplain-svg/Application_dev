import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import { join } from 'path';
import { app } from 'electron';
import { getDbPath } from './paths';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

// createRequire pour résoudre le CLI Prisma : robuste face au layout pnpm
// (les deps peuvent être hissées dans n'importe quel node_modules parent).
const requireFromHere = createRequire(__filename);

/**
 * Applique les migrations Prisma à la base SQLite locale, au démarrage.
 *
 * Point délicat : Prisma migre via son CLI, qui doit tourner dans un process
 * Node. En production, on relance l'exécutable Electron en « mode Node » grâce
 * à ELECTRON_RUN_AS_NODE=1. Les chemins du CLI et du schéma diffèrent entre
 * dev et app empaquetée (asar).
 */
export async function runMigrations(): Promise<void> {
  const packaged = app.isPackaged;

  // En prod, prisma/ est extrait hors de l'asar (cf. asarUnpack).
  // En dev, on laisse Node résoudre le chemin — supporte tous les layouts npm/pnpm.
  const prismaCli = packaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'prisma', 'build', 'index.js')
    : requireFromHere.resolve('prisma/build/index.js');

  // Le schéma est copié dans les ressources via electron-builder (extraResources).
  const schemaPath = packaged
    ? join(process.resourcesPath, 'prisma', 'schema.prisma')
    : join(app.getAppPath(), 'prisma', 'schema.prisma');

  logger.info('Application des migrations Prisma…');
  await execFileAsync(
    process.execPath, // L'exécutable Electron, relancé en mode Node ci-dessous.
    [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
    {
      env: {
        ...process.env,
        DATABASE_URL: `file:${getDbPath()}`,
        ELECTRON_RUN_AS_NODE: '1',
      },
      // F1 (revue 7) : 60s max — évite un blocage indéfini si le CLI Prisma
      // accroche (binaire absent de l'asar.unpacked, antivirus, I/O lente…).
      timeout: 60_000,
    }
  );
  logger.info('Base de données à jour.');
}
