import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

/**
 * Tests e2e du process Electron.
 *
 * On lance l'app par son DOSSIER racine (et non le fichier main.js) pour que
 * `app.getAppPath()` pointe sur apps/desktop — sinon le chemin du schéma Prisma
 * (résolu via getAppPath) est faux et les migrations échouent au démarrage.
 *
 * Isolation : `--user-data-dir` pointe vers un dossier temporaire → le test ne
 * touche JAMAIS la vraie base / les secrets de l'utilisateur. Migrations + secrets
 * repartent de zéro à chaque exécution.
 *
 * Pré-requis : `pnpm build` (electron-vite build) doit avoir produit out/main/main.js
 * (package.json → "main": "./out/main/main.js").
 */
let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'carreerops-e2e-'));
  const appRoot = join(__dirname, '..'); // apps/desktop (contient package.json → main)
  app = await electron.launch({
    args: [appRoot, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  if (app) await app.close().catch(() => {});
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

test('démarre, migre une base vierge et affiche la fenêtre principale', async () => {
  // La fenêtre s'affiche et le renderer monte du contenu.
  await expect(window.locator('body')).toBeVisible();
  // La sidebar de navigation est présente (repère stable : le bouton « Réglages »).
  await expect(window.getByTitle('Réglages', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('navigue entre toutes les pages principales sans crash', async () => {
  // Chaque page charge ses données via IPC au montage : ce parcours vérifie que
  // ni le routing renderer ni les handlers IPC associés ne plantent.
  const pages = ['Tableau de bord', 'Campagnes', 'Réponses', 'À traiter', 'Scraping', 'Leads', 'CV', 'Profil', 'Réglages'];
  // Attend que la nav soit prête.
  await expect(window.getByTitle('Réglages', { exact: true })).toBeVisible({ timeout: 30_000 });
  for (const title of pages) {
    await window.getByTitle(title, { exact: true }).click();
    // Le bouton cliqué devient actif (le routing a bien changé de page).
    await expect(window.getByTitle(title, { exact: true })).toHaveClass(/active/);
    // La zone de contenu reste rendue (pas d'écran blanc / crash React).
    await expect(window.locator('.content')).toBeVisible();
  }
});
