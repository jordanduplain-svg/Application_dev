/**
 * MOD-07 : Configuration non-sensible via electron-store.
 *
 * Les préférences non-sensibles (intervalles, flags, horodatages de santé)
 * sont stockées ici plutôt que dans secrets.json. Les secrets réels (clés
 * chiffrées) restent dans secrets.json géré par src/lib/secrets.ts.
 */
import ElectronStore from 'electron-store';

// Schéma des préférences non-sensibles.
interface AppConfig {
  imapPollIntervalMinutes: number;
  aiModel: string;
  lockEnabled: boolean;
  lockTimeoutMinutes: number;
  scrapingEnabled: boolean;
  lastSmtpCheckAt: string | null;
  lastSmtpCheckOk: boolean | null;
  lastImapCheckAt: string | null;
  lastImapCheckOk: boolean | null;
}

// Valeurs par défaut.
const defaults: AppConfig = {
  imapPollIntervalMinutes: 10,
  aiModel: 'gpt-4o',
  lockEnabled: false,
  lockTimeoutMinutes: 15,
  scrapingEnabled: false,
  lastSmtpCheckAt: null,
  lastSmtpCheckOk: null,
  lastImapCheckAt: null,
  lastImapCheckOk: null,
};

// NOTE : electron-store ne peut être instancié que dans le process principal.
// Le renderer accède à la config via IPC.
export const appConfig = new ElectronStore<AppConfig>({
  name: 'app-config',
  defaults,
});
