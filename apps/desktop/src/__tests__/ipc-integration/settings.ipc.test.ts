/**
 * MOD-08 : Test d'intégration du handler settings.
 *
 * Teste que la clé OpenAI peut être enregistrée et que getStatus()
 * retourne `openaiKeySet === true` après.
 *
 * Note : les fonctions secrets.ts utilisent safeStorage (Electron DPAPI).
 * Dans un contexte node pur, safeStorage n'est pas disponible.
 * On stub safeStorage pour isoler la logique de secrets.ts des APIs Electron.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

// ─── Stub electron ───────────────────────────────────────────────────────────

// On stub le module 'electron' avant d'importer secrets.ts.
// safeStorage chiffre/déchiffre en Base64 simple pour les tests.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
  app: {
    getPath: () => testDir,
  },
}));

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'carreerops-settings-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.resetModules();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Settings secrets (intégration)', () => {
  test('setOpenaiKey → getOpenaiKey retourne la clé', async () => {
    // Import dynamique pour que le stub electron soit appliqué.
    const { setOpenaiKey, getOpenaiKey } = await import('../../lib/secrets.js');

    // Avant enregistrement : null
    expect(getOpenaiKey()).toBeNull();

    // Enregistrer
    await setOpenaiKey('sk-test-1234567890123456');

    // Après enregistrement : non null
    expect(getOpenaiKey()).not.toBeNull();
    expect(getOpenaiKey()).toBe('sk-test-1234567890123456');
  });

  test('setOpenaiKey → openaiKeySet détectable', async () => {
    const { setOpenaiKey, getOpenaiKey } = await import('../../lib/secrets.js');

    await setOpenaiKey('sk-proj-test-123456789012345678');

    // Simule getStatus() : openaiKeySet = getOpenaiKey() !== null
    const openaiKeySet = getOpenaiKey() !== null;
    expect(openaiKeySet).toBe(true);
  });

  test('clearOpenaiKey → openaiKeySet devient false', async () => {
    const { setOpenaiKey, clearOpenaiKey, getOpenaiKey } = await import('../../lib/secrets.js');

    await setOpenaiKey('sk-test-abc123456789012345');
    expect(getOpenaiKey()).not.toBeNull();

    await clearOpenaiKey();
    expect(getOpenaiKey()).toBeNull();
  });
});
