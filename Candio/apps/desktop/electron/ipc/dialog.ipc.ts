import { BrowserWindow, dialog } from 'electron';
import { handle } from './registry';

/**
 * M2 (revue 6) : remplace window.confirm() synchrone du renderer.
 *
 * window.confirm() bloque l'event loop du renderer et peut être silencieusement
 * ignoré dans certaines configurations Electron/Chromium (DevTools ouvert,
 * focus perdu, certaines versions headless…).
 * Cette implémentation utilise dialog.showMessageBox (asynchrone, natif OS).
 */
export function registerDialogHandlers(): void {
  handle('dialog:confirm', async ({ message, title }) => {
    // Attacher la dialog à la fenêtre focalisée pour qu'elle soit modale.
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    // M2 (revue 7) : getAllWindows()[0] peut être undefined si toutes les fenêtres
    // sont fermées (shutdown en cours). On refuse par défaut pour ne pas crasher.
    if (!win) return false;
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Annuler', 'Confirmer'],
      defaultId: 1,   // "Confirmer" sélectionné par défaut (touche Entrée)
      cancelId: 0,    // "Annuler" déclenché par Échap
      title: title ?? 'Confirmation',
      message,
    });
    return result.response === 1;
  });

  // Ouvre un dialog natif de sélection de fichier CSV (utilisé pour l'import LinkedIn).
  // Retourne le chemin absolu choisi, ou null si l'utilisateur annule.
  handle('dialog:openCsv', async ({ title }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: title ?? 'Sélectionner un CSV',
      properties: ['openFile'],
      filters: [
        { name: 'CSV / TSV', extensions: ['csv', 'tsv', 'txt'] },
        { name: 'Tous les fichiers', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
