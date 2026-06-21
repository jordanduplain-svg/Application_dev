import { ipcMain } from 'electron';
import type { IpcChannel, IpcRequests } from '@candio/shared';
import { registerProfileHandlers } from './profile.ipc';
import { registerCvHandlers } from './cv.ipc';
import { registerCampaignHandlers } from './campaign.ipc';
import { registerCompanyHandlers } from './company.ipc';
import { registerApplicationHandlers } from './application.ipc';
import { registerSettingsHandlers } from './settings.ipc';
import { registerDatabaseHandlers } from './database.ipc';
import { registerDialogHandlers } from './dialog.ipc';
import { registerStatsHandlers } from './stats.ipc';
import { registerLogsHandlers } from './logs.ipc';
import { registerSearchHandlers } from './search.ipc';
import { registerMaintenanceHandlers } from './maintenance.ipc';
import { registerScrapingHandlers } from './scraping.ipc';
import { registerOptOutHandlers } from './optout.ipc';
import { registerReportHandlers } from './report.ipc';

/**
 * Helper de déclaration d'un handler IPC typé. Le type du payload et du
 * retour est dérivé du contrat partagé (IpcRequests) → typage de bout en bout.
 */
export function handle<C extends IpcChannel>(
  channel: C,
  handler: (
    payload: IpcRequests[C]['req']
  ) => Promise<IpcRequests[C]['res']> | IpcRequests[C]['res']
): void {
  ipcMain.handle(channel, (_event, payload) => handler(payload));
}

/** Enregistre tous les handlers, regroupés par domaine. */
export function registerIpcHandlers(): void {
  registerProfileHandlers();
  registerCvHandlers();
  registerCampaignHandlers();
  registerCompanyHandlers();
  registerApplicationHandlers();
  registerSettingsHandlers();
  registerDatabaseHandlers();
  registerDialogHandlers();
  // ANA-1 : tableau de bord global.
  registerStatsHandlers();
  // ADM-2 : visionneuse de logs.
  registerLogsHandlers();
  // UX-S10 : recherche globale.
  registerSearchHandlers();
  // ADM-S13 : maintenance des données.
  registerMaintenanceHandlers();
  // SCRAPE-01 : scraper Python + schedule mensuel.
  registerScrapingHandlers();
  // RGPD : liste « ne pas contacter » (opt-out / droit à l'effacement).
  registerOptOutHandlers();
  // Justificatif France Travail (PDF).
  registerReportHandlers();
}
