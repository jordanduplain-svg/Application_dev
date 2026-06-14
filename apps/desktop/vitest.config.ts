import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Config vitest pour les tests unitaires du process principal (src/).
 * Le renderer React n'est pas testé ici (tests d'intégration à venir).
 *
 * Alias electron + electron-log : évite que les imports Electron ne crashent
 * les tests — ces modules ne sont disponibles qu'à l'intérieur du runtime Electron.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // MOD-08 : inclut les tests unitaires ET les tests d'intégration IPC.
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Stubs minimalistes — suffisants pour les modules qui importent electron
      // mais n'en ont pas besoin dans le chemin de code testé.
      'electron-log': resolve(__dirname, 'src/test/mocks/electron-log.ts'),
    },
  },
});
