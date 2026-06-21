import { app } from 'electron';
import { join } from 'path';
import { mkdirSync } from 'fs';

/**
 * Chemins des fichiers de l'app — tous dans userData.
 *
 * C3 : on utilise des getters lazys au lieu d'appeler app.getPath() à
 * l'import du module. Avant app.whenReady(), certains chemins peuvent être
 * incorrects ou l'appel peut lever une exception (ex: test unitaire hors Electron).
 */

let _userData: string | null = null;

function userData(): string {
  if (!_userData) _userData = app.getPath('userData');
  return _userData;
}

// Base SQLite — un fichier unique contenant toutes les données.
export function getDbPath(): string {
  return join(userData(), 'carreerops.db');
}

// Dossier où sont copiés les CV PDF importés.
export function getCvDir(): string {
  return join(userData(), 'cv');
}

// Fichier des secrets chiffrés (clé OpenAI, identifiants SMTP/IMAP).
export function getSecretsPath(): string {
  return join(userData(), 'secrets.json');
}

// B6 : dossier des sauvegardes automatiques.
export function getBackupDir(): string {
  return join(userData(), 'backups');
}

// Garantit l'existence des dossiers nécessaires — à appeler dans app.whenReady().
export function ensureDirs(): void {
  mkdirSync(getCvDir(), { recursive: true });
  mkdirSync(getBackupDir(), { recursive: true }); // B6 : crée le dossier backups au démarrage.
}
