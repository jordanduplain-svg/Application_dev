import { dialog, shell, BrowserWindow } from 'electron';
import { pathToFileURL } from 'url';
import { copyFile, open as openFile, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { handle } from './registry';
import { fitToWorkArea } from '../lib/window-bounds';
import { getCvDir } from '../../src/lib/paths';
import * as cvService from '../../src/modules/cv/cv.service';
import { enqueueCvParse } from '../../src/tasks/cv-parse.task';

// SEC-4 : signature binaire PDF (%PDF). B7 : limite 10 Mo (évite timeout OpenAI).
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);
const MAX_CV_SIZE = 10 * 1024 * 1024;

async function isPdf(filePath: string): Promise<boolean> {
  try {
    const fh = await openFile(filePath, 'r');
    try {
      const buf = Buffer.alloc(4);
      await fh.read(buf, 0, 4, 0);
      return buf.equals(PDF_MAGIC);
    } finally { await fh.close(); }
  } catch { return false; }
}

/** CV-MULTI : handlers IPC de gestion des CV nommés. */
export function registerCvHandlers(): void {
  handle('cv:list', () => cvService.listCvs());

  handle('cv:create', async ({ name }) => {
    const n = (name ?? '').trim();
    if (!n) throw new Error('Donne un nom à ce CV (ex: "CV Data Analyst").');
    return cvService.createCv(n);
  });

  handle('cv:rename', async ({ id, name }) => {
    const n = (name ?? '').trim();
    if (!n) throw new Error('Le nom du CV ne peut pas être vide.');
    return cvService.renameCv(id, n);
  });

  handle('cv:delete', async ({ id }) => {
    const removedPath = await cvService.deleteCv(id);
    if (removedPath) unlink(removedPath).catch(() => {}); // best-effort
  });

  // Relance l'analyse IA du PDF déjà importé (utile si l'IA était indisponible).
  handle('cv:reanalyze', async ({ id }) => {
    const cv = await cvService.getCv(id);
    if (!cv) throw new Error('CV introuvable.');
    if (!cv.filePath) throw new Error('Aucun PDF importé pour ce CV — importe-le d\'abord.');
    enqueueCvParse(id, cv.filePath);
  });

  // Ouvre le PDF du CV dans une fenêtre Electron (viewer PDF intégré de Chromium).
  handle('cv:openFile', async ({ id }) => {
    const cv = await cvService.getCv(id);
    if (!cv?.filePath) throw new Error('Aucun PDF importé pour ce CV.');
    // Ajuste à l'écran (sur le moniteur de la fenêtre active) : 800×1000 dépasserait
    // sinon la hauteur d'écran sur beaucoup de portables → fenêtre hors champ.
    const win = new BrowserWindow({
      ...fitToWorkArea(800, 1000, BrowserWindow.getFocusedWindow()?.getBounds()),
      title: cv.name,
      webPreferences: { sandbox: true },
    });
    await win.loadURL(pathToFileURL(cv.filePath).href);
  });

  // Ouvre une URL dans le navigateur par défaut (liens externes).
  handle('shell:openExternal', async ({ url }) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('URL invalide.');
    await shell.openExternal(url);
  });

  // Import du PDF pour un CV existant : sélecteur → copie locale → analyse IA.
  handle('cv:importFile', async ({ id }) => {
    const existing = await cvService.getCv(id);
    if (!existing) throw new Error('CV introuvable.');

    const result = await dialog.showOpenDialog({
      title: 'Choisir le PDF de ce CV',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      // Annulé : on signale imported=false (le renderer peut alors annuler la création).
      const cvs = await cvService.listCvs();
      const cur = cvs.find((c) => c.id === id);
      if (!cur) throw new Error('CV introuvable.');
      return { cv: cur, imported: false };
    }

    const filePath = result.filePaths[0];
    if (!(await isPdf(filePath))) throw new Error("Le fichier sélectionné n'est pas un PDF valide.");
    const { size } = await stat(filePath);
    if (size > MAX_CV_SIZE) {
      throw new Error(`CV trop volumineux (${Math.round(size / (1024 * 1024))} Mo) — 10 Mo maximum.`);
    }

    // Copie dans userData/cv/ (l'app reste fonctionnelle si l'original est déplacé).
    const dest = join(getCvDir(), `${randomUUID()}.pdf`);
    await copyFile(filePath, dest);
    const oldPath = await cvService.setCvFile(id, dest);
    if (oldPath) unlink(oldPath).catch(() => {}); // nettoie l'ancien PDF
    // Analyse IA en tâche de fond (UI notifiée via task:progress, type 'cv-parse').
    enqueueCvParse(id, dest);

    const cvs = await cvService.listCvs();
    const updated = cvs.find((c) => c.id === id);
    if (!updated) throw new Error('CV introuvable après import.');
    return { cv: updated, imported: true };
  });
}
