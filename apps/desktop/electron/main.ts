import { app, BrowserWindow, dialog, Tray, Menu, nativeImage } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import log from 'electron-log';
import { runMigrations } from '../src/lib/migrate';
import { resumePendingWork, startReplyPolling, stopReplyPolling } from '../src/tasks';
import { taskRunner } from '../src/lib/task-runner';
import { registerIpcHandlers } from './ipc/registry';
import { logger } from '../src/lib/logger';
import { ensureDirs, getDbPath, getBackupDir } from '../src/lib/paths';
import { preloadSecrets, secretsWereCorrupted } from '../src/lib/secrets';
import { prisma } from '../src/lib/prisma';
import { performRotatedBackup } from './ipc/database.ipc';
// ADM-1 : auto-update via electron-updater (écrit dans electron-builder).
interface AutoUpdater {
  checkForUpdatesAndNotify(): Promise<unknown>;
  on(event: string, cb: (info?: { version?: string; releaseNotes?: string | null }) => void): void;
}
let autoUpdater: AutoUpdater | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('electron-updater') as { autoUpdater: AutoUpdater };
  autoUpdater = mod.autoUpdater;
} catch { /* electron-updater non installé — mise à jour désactivée */ }

/**
 * Process principal Electron — point d'entrée de l'application.
 *
 * Ordre de démarrage :
 *  1. Migrations Prisma (création / mise à jour du schéma SQLite).
 *  2. Reprise des envois interrompus.
 *  3. Enregistrement des handlers IPC.
 *  4. Création de la fenêtre.
 *  5. Démarrage du relevé IMAP périodique.
 */

let mainWindow: BrowserWindow | null = null;
// UX-11v3 : icône dans la barre système.
let tray: Tray | null = null;

// UX-10v3 : persistance de l'état de la fenêtre (sans lib externe).
const WIN_STATE_FILE = 'window-state.json';
interface WindowState { x?: number; y?: number; width: number; height: number; maximized?: boolean }

function loadWindowState(): WindowState {
  try {
    const p = join(app.getPath('userData'), WIN_STATE_FILE);
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8');
      return JSON.parse(raw) as WindowState;
    }
  } catch { /* non bloquant */ }
  return { width: 1100, height: 760 };
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: win.isMaximized(),
    };
    const p = join(app.getPath('userData'), WIN_STATE_FILE);
    writeFileSync(p, JSON.stringify(state), 'utf8');
  } catch { /* non bloquant */ }
}

/**
 * ADM-1v3 : sauvegarde automatique au démarrage si dernière sauvegarde > 24h.
 * Silencieuse — aucun dialog, juste un log. Rotation automatique (7 max).
 */
async function performAutoBackup(): Promise<void> {
  const userData = app.getPath('userData');
  const lastBackupFile = join(userData, 'last-backup.json');
  // B6 : utiliser getBackupDir() pour éviter un chemin codé en dur différent de ensureDirs().
  const backupDir = getBackupDir();

  // Vérifier si un backup existe déjà dans les dernières 24h.
  // ADM-1v3 : on vérifie si un fichier backup-*.db existe < 24h (pas juste last-backup.json).
  let lastBackupAt: number = 0;
  if (existsSync(lastBackupFile)) {
    try {
      const raw = readFileSync(lastBackupFile, 'utf8');
      const parsed = JSON.parse(raw) as { ts?: number };
      lastBackupAt = parsed.ts ?? 0;
    } catch {
      lastBackupAt = 0;
    }
  }

  const MS_24H = 24 * 60 * 60 * 1000;
  if (Date.now() - lastBackupAt < MS_24H) return;

  try {
    // B6 : le dossier backups est créé par ensureDirs() au démarrage — pas besoin de re-créer ici.

    // ADM-1v3 : rotation automatique — crée un fichier horodaté, conserve 7 max.
    const backupPath = await performRotatedBackup(backupDir, getDbPath());

    // Enregistrer la date du backup.
    writeFileSync(lastBackupFile, JSON.stringify({ ts: Date.now() }), 'utf8');
    logger.info(`[auto-backup] Sauvegarde automatique créée : ${backupPath}`);
  } catch (err) {
    logger.warn('[auto-backup] Échec de la sauvegarde automatique', err);
  }
}

// SEC-5 : capture les exceptions non gérées du process principal avant qu'elles
// n'éteignent l'app sans avertissement. On log + dialog + quit proprement.
process.on('uncaughtException', (err) => {
  logger.error('Exception non gérée dans le process principal', err);
  try {
    dialog.showErrorBox(
      'Erreur inattendue',
      `Une erreur interne s'est produite et l'application va se fermer.\n\n${err.message}`
    );
  } catch {
    // dialog peut échouer si app n'est pas prête
  }
  log.transports.file.level = false;
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promesse rejetée non gérée', reason);
  // BUG-H3 fix : type générique — ne pas attribuer toutes les erreurs à 'send-email'.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task:progress', {
      type: 'system',
      status: 'failed',
      message: `Erreur interne : ${reason instanceof Error ? reason.message : String(reason)}`,
    });
  }
});


function createWindow(): void {
  // UX-10v3 : restaurer la taille et position depuis la sauvegarde.
  const winState = loadWindowState();

  mainWindow = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    title: 'Candidatures',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // UX-10v3 : restaurer l'état maximisé.
  if (winState.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // UX-10v3 : sauvegarder l'état quand la fenêtre est déplacée / redimensionnée.
  const persistState = () => { if (mainWindow) saveWindowState(mainWindow); };
  mainWindow.on('resize', persistState);
  mainWindow.on('move', persistState);
  mainWindow.on('close', persistState);

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// UX-11v3 : icône dans la barre système.
function createTray(): void {
  try {
    // Utiliser une image vide (1×1 px transparent) si pas d'icône fournie.
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('Candidatures');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Afficher / Masquer',
        click: () => {
          if (mainWindow) {
            if (mainWindow.isVisible()) mainWindow.hide();
            else { mainWindow.show(); mainWindow.focus(); }
          }
        },
      },
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() },
    ]);

    tray.setContextMenu(contextMenu);

    // Double-clic sur le tray : afficher la fenêtre.
    tray.on('double-click', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  } catch (err) {
    // Non bloquant : tray est optionnel.
    logger.warn('[tray] Impossible de créer l\'icône système', err);
  }
}

let unwireTaskProgress: (() => void) | null = null;

// Relaie la progression des tâches de fond et les événements vers le renderer.
function wireTaskProgress(): void {
  unwireTaskProgress?.();
  const unProgress = taskRunner.onProgress((progress) => {
    mainWindow?.webContents.send('task:progress', progress);
  });
  const unReply = taskRunner.on('reply:received', (data) => {
    mainWindow?.webContents.send('reply:received', data);
  });
  // BOUNCE-01 : relayer l'événement de bounce vers le renderer.
  const unBounce = taskRunner.on('bounce:detected', (data) => {
    mainWindow?.webContents.send('bounce:detected', data);
  });
  unwireTaskProgress = () => { unProgress(); unReply(); unBounce(); };
}

app.whenReady().then(async () => {
  ensureDirs();

  preloadSecrets();
  if (secretsWereCorrupted()) {
    dialog.showErrorBox(
      'Configuration corrompue',
      'Votre fichier de configuration était illisible et a été réinitialisé.\n\n' +
      'L\'ancien fichier a été renommé en secrets.json.corrupted dans votre dossier de données.\n\n' +
      'Reconfigurer votre clé OpenAI, SMTP et IMAP dans les Réglages.'
    );
  }

  try {
    await runMigrations();
  } catch (err) {
    logger.error('Échec des migrations Prisma', err);
    dialog.showErrorBox(
      'Erreur de base de données',
      `Impossible d'initialiser la base.\n\n${err instanceof Error ? err.message : String(err)}`
    );
    app.quit();
    process.exit(1);
  }
  await resumePendingWork();
  registerIpcHandlers();
  wireTaskProgress();
  createWindow();
  // UX-11v3 : créer l'icône système après la fenêtre.
  createTray();
  startReplyPolling();

  // ADM-1v3 : sauvegarde automatique silencieuse avec rotation si dernière > 24h.
  void performAutoBackup();

  // ADM-1 : vérifier les mises à jour après l'ouverture de la fenêtre.
  if (autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      logger.warn('Auto-update check failed', err);
    });
    // ADM-3v3 : inclure la version et les notes de release dans le toast.
    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update:ready', {
        version: info?.version,
        releaseNotes: info?.releaseNotes,
      });
    });
  }
});

// App mono-utilisateur Windows : on quitte dès que la fenêtre est fermée.
app.on('window-all-closed', () => {
  stopReplyPolling();
  const DISCONNECT_TIMEOUT_MS = 3_000;
  void Promise.race([
    prisma.$disconnect().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, DISCONNECT_TIMEOUT_MS)),
  ]).finally(() => app.quit());
});
