import { app, dialog } from 'electron';
import { copyFile, unlink, writeFile, readFile } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { encryptBuffer, decryptBuffer } from '../../src/lib/db-crypto';
// MOD-06 : import better-sqlite3 pour des WAL checkpoints fiables.
import Database from 'better-sqlite3';
import { handle } from './registry';
import { getDbPath } from '../../src/lib/paths';
import { logger } from '../../src/lib/logger';
import { prisma } from '../../src/lib/prisma';
import { runMigrations } from '../../src/lib/migrate';
import { assertValidSqliteFile } from '../../src/lib/sqlite-verify';

/**
 * N2 : sauvegarde COHÉRENTE via l'API backup en ligne de better-sqlite3.
 * Produit un fichier `.db` autonome quel que soit l'état du WAL (un simple
 * `copyFile` du `.db` pouvait omettre les transactions encore dans le `-wal`,
 * surtout si le checkpoint échouait silencieusement à cause de la connexion
 * Prisma ouverte). `db.backup()` gère le WAL et la cohérence transactionnelle.
 */
async function consistentBackup(dst: string): Promise<void> {
  // Connexion read-write (pas readonly) : en mode WAL, un open readonly peut échouer
  // à verrouiller le -shm. L'API backup ne modifie pas la source.
  const db = new Database(getDbPath());
  try {
    await db.backup(dst);
  } finally {
    db.close();
  }
}

/** N1 : supprime les journaux WAL/SHM résiduels d'une base (avant de l'écraser/restaurer). */
async function removeWalShm(dbPath: string): Promise<void> {
  for (const suffix of ['-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) await unlink(p).catch(() => {});
  }
}

// ADM-1v3 : nombre de sauvegardes automatiques à conserver.
const MAX_AUTO_BACKUPS = 7;

/**
 * F9 : sauvegarde de la base SQLite.
 *
 * Avant la copie on force un checkpoint WAL pour s'assurer que toutes les
 * transactions committées sont bien dans le fichier .db principal (et pas
 * seulement dans le -wal journal). Cela garantit que la sauvegarde est
 * cohérente et restaurable sans le fichier WAL.
 */
export function registerDatabaseHandlers(): void {
  handle('db:backup', async () => {
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: 'Sauvegarder la base de données',
      defaultPath: `carreerops-backup-${date}.db`,
      filters: [{ name: 'Base SQLite', extensions: ['db'] }],
    });

    if (result.canceled || !result.filePath) return null;

    // H7 : s'assurer que la destination est différente de la source.
    const srcPath = resolve(getDbPath());
    const dstPath = resolve(result.filePath);
    if (srcPath === dstPath) {
      throw new Error('La destination doit être différente du fichier source de la base.');
    }

    // N2 : snapshot cohérent (gère le WAL) au lieu d'un copyFile du seul `.db`.
    await consistentBackup(dstPath);
    logger.info(`[backup] Base de données sauvegardée : ${result.filePath}`);
    return { path: result.filePath };
  });

  // RGPD/SEC : sauvegarde CHIFFRÉE par mot de passe (AES-256-GCM, portable).
  // Contrairement à db:backup (copie en clair), le fichier produit est inutilisable
  // sans le mot de passe — adapté à une sauvegarde stockée sur cloud/clé USB.
  handle('db:backupEncrypted', async ({ passphrase }) => {
    if (!passphrase || passphrase.length < 8) {
      throw new Error('Mot de passe trop court (8 caractères minimum).');
    }
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: 'Sauvegarde chiffrée de la base',
      defaultPath: `carreerops-backup-${date}.cjenc`,
      filters: [{ name: 'Sauvegarde chiffrée Carreer-ops', extensions: ['cjenc'] }],
    });
    if (result.canceled || !result.filePath) return null;

    // N2 : snapshot cohérent dans un temp → chiffrement en mémoire → écriture .cjenc.
    const tmpSnap = resolve(getDbPath()) + '.enc.tmp';
    await consistentBackup(tmpSnap);
    try {
      const plain = await readFile(tmpSnap);
      const encrypted = encryptBuffer(plain, passphrase);
      await writeFile(resolve(result.filePath), encrypted);
    } finally {
      await unlink(tmpSnap).catch(() => {});
    }
    logger.info(`[backup] Sauvegarde chiffrée créée : ${result.filePath}`);
    return { path: result.filePath };
  });

  // RGPD/SEC : restauration d'une sauvegarde chiffrée (.cjenc).
  handle('db:restoreEncrypted', async ({ passphrase }) => {
    if (!passphrase) return { success: false, error: 'Mot de passe requis.' };
    const picked = await dialog.showOpenDialog({
      title: 'Restaurer une sauvegarde chiffrée',
      filters: [{ name: 'Sauvegarde chiffrée Carreer-ops', extensions: ['cjenc'] }],
      properties: ['openFile'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { success: false, error: 'Annulé' };
    }

    const dbPath = resolve(getDbPath());
    const tmpPath = dbPath + '.restore.tmp';
    logger.warn('[AUDIT] db:restoreEncrypted déclenché depuis', picked.filePaths[0]);

    try {
      const container = await readFile(resolve(picked.filePaths[0]));
      const plain = decryptBuffer(container, passphrase); // lève si mauvais mot de passe
      // Écrit le clair déchiffré dans un fichier temporaire, qu'on valide avant d'écraser la base.
      await writeFile(tmpPath, plain);
      await assertValidSqliteFile(tmpPath);

      await Promise.race([
        prisma.$disconnect(),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]);
      // N1 : purger les journaux WAL/SHM de l'ANCIENNE base avant de la remplacer —
      // sinon SQLite réapplique l'ancien WAL par-dessus la base restaurée (corruption).
      await removeWalShm(dbPath);
      await copyFile(tmpPath, dbPath);
      await unlink(tmpPath).catch(() => {});
      await prisma.$connect();

      logger.info('[restore] Base restaurée depuis une sauvegarde chiffrée.');
      await dialog.showMessageBox({
        type: 'info',
        title: 'Redémarrage requis',
        message: 'Redémarrage requis',
        detail: 'La base a été restaurée. L\'application va redémarrer.',
        buttons: ['Redémarrer maintenant'],
      });
      app.relaunch();
      app.exit(0);
      return { success: true };
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      await prisma.$connect().catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[restore] Échec de la restauration chiffrée', err);
      return { success: false, error: message };
    }
  });

  // SEC-1 : restauration d'une sauvegarde SQLite.
  handle('db:restore', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Restaurer une sauvegarde',
      filters: [{ name: 'Base SQLite', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Annulé' };
    }

    const srcBackup = resolve(result.filePaths[0]);
    const dbPath = resolve(getDbPath());

    // SEC-S2 : audit log de la restauration.
    logger.warn('[AUDIT] db:restore déclenché depuis', srcBackup);

    if (srcBackup === dbPath) {
      return { success: false, error: 'Le fichier sélectionné est déjà la base active.' };
    }

    try {
      await assertValidSqliteFile(srcBackup);

      await Promise.race([
        prisma.$disconnect(),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]);

      // N1 : purger les journaux WAL/SHM de l'ANCIENNE base avant de la remplacer.
      await removeWalShm(dbPath);
      await copyFile(srcBackup, dbPath);
      await prisma.$connect();

      logger.info(`[restore] Base restaurée depuis : ${srcBackup}`);

      await dialog.showMessageBox({
        type: 'info',
        title: 'Redémarrage requis',
        message: 'Redémarrage requis',
        detail: 'La base a été restaurée. L\'application va redémarrer.',
        buttons: ['Redémarrer maintenant'],
      });
      app.relaunch();
      app.exit(0);

      return { success: true };
    } catch (err) {
      // BUG-01 : après prisma.$disconnect(), si copyFile échoue Prisma reste
      // déconnecté. On force une reconnexion pour que l'app reste utilisable.
      await prisma.$connect().catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[restore] Échec de la restauration', err);
      return { success: false, error: message };
    }
  });

  // ADM-3 : réinitialisation complète des données.
  handle('db:reset', async () => {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Réinitialiser toutes les données',
      message: 'Cette action supprimera DÉFINITIVEMENT toutes vos campagnes, entreprises et candidatures.',
      detail: 'Êtes-vous absolument certain de vouloir continuer ? Cette action est irréversible.',
      buttons: ['Annuler', 'Oui, tout supprimer'],
      defaultId: 0,
      cancelId: 0,
    });
    if (response !== 1) return;

    // SEC-S2 : audit log de la réinitialisation.
    logger.warn('[AUDIT] db:reset déclenché');

    await Promise.race([
      prisma.$disconnect(),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);

    const dbPath = getDbPath();

    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbPath + suffix;
      if (existsSync(p)) await unlink(p).catch(() => {});
    }

    await prisma.$connect();
    await runMigrations();

    logger.info('[reset] Base de données réinitialisée.');

    // B3 : redémarrer l'app pour que le renderer vide son état React.
    await dialog.showMessageBox({
      type: 'info',
      title: 'Réinitialisation effectuée',
      message: 'L\'application va redémarrer.',
      detail: 'Toutes les données ont été supprimées. L\'application redémarre maintenant.',
      buttons: ['Redémarrer'],
    });
    app.relaunch();
    app.exit(0);
  });

  // ADM-4v3 : dump complet de toutes les tables en JSON.
  handle('db:exportAll', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Exporter toutes les données',
      defaultPath: `carreerops-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;

    // N5 : export RÉELLEMENT complet — inclut Profil, CV et liste opt-out (RGPD),
    // pas seulement campagnes/entreprises/candidatures.
    const [campaigns, companies, applications, profile, cvs, optOuts] = await Promise.all([
      prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.company.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.application.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.profile.findMany(),
      prisma.cv.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.optOut.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      campaigns,
      companies,
      applications,
      profile,
      cvs,
      optOuts,
    };

    await writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf8');
    logger.info(`[exportAll] Export JSON créé : ${result.filePath}`);
    return { path: result.filePath };
  });
}

/**
 * ADM-1v3 : rotation automatique des sauvegardes — conserve les 7 dernières.
 * Crée un fichier horodaté backup-YYYY-MM-DD_HH-mm-ss.db puis purge les plus anciens.
 */
export async function performRotatedBackup(backupDir: string, dbPath: string): Promise<string> {
  const now = new Date();
  const stamp = now.toISOString().replace(/:/g, '-').replace('T', '_').slice(0, 19);
  const backupPath = join(backupDir, `backup-${stamp}.db`);

  // N2 : snapshot cohérent (gère le WAL) au lieu d'un copyFile du seul `.db`.
  void dbPath; // (le chemin source est résolu par consistentBackup via getDbPath())
  await consistentBackup(backupPath);

  // Lister toutes les sauvegardes backup-*.db et supprimer les plus anciennes.
  try {
    const files = readdirSync(backupDir)
      .filter((f) => /^backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/.test(f))
      .sort(); // tri lexicographique = tri chronologique grâce au format ISO
    if (files.length > MAX_AUTO_BACKUPS) {
      const toDelete = files.slice(0, files.length - MAX_AUTO_BACKUPS);
      for (const f of toDelete) {
        await unlink(join(backupDir, f)).catch(() => {});
      }
    }
  } catch { /* non bloquant — rotation optionnelle */ }

  return backupPath;
}
