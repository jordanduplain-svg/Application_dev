import { defineConfig } from '@playwright/test';

/**
 * Config Playwright pour les tests e2e du process Electron.
 *
 * Les tests lancent l'app BUILDÉE (out/main/index.js) — exécute `pnpm build`
 * avant `pnpm test:e2e`. Pas de projets navigateur : Electron est démarré
 * directement dans chaque test via `_electron.launch`.
 *
 * Volontairement séquentiel (workers: 1) : on lance un vrai process Electron
 * avec une fenêtre — pas de parallélisme pour éviter les conflits de ressources.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  forbidOnly: !!process.env.CI,
});
