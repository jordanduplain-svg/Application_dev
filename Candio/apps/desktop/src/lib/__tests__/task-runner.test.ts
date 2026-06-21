import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskRunner, isPermanentError } from '../task-runner';

// electron-log est stubé via vitest.config.ts → logger fonctionne sans Electron.

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Attend que le runner émette un statut donné via onProgress. */
function waitForStatus(runner: TaskRunner, status: string): Promise<void> {
  return new Promise((resolve) => {
    const unwire = runner.onProgress((p) => {
      if (p.status === status) { unwire(); resolve(); }
    });
  });
}

// ─── Tests TaskRunner ────────────────────────────────────────────────────────

describe('TaskRunner', () => {
  let runner: TaskRunner;

  beforeEach(() => { runner = new TaskRunner(); });

  // Test 1 : cas nominal
  test('exécute une tâche et émet running puis done', async () => {
    const events: string[] = [];
    runner.onProgress((p) => events.push(p.status));

    const run = vi.fn().mockResolvedValue(undefined);
    runner.enqueue({ type: 'send-email', label: 'basic', run });

    await waitForStatus(runner, 'done');
    expect(run).toHaveBeenCalledOnce();
    expect(events).toEqual(['running', 'done']);
  });

  // Test 2 : déduplication
  test('dedup — la 2e tâche du même type est ignorée pendant que la 1re tourne', async () => {
    let resolveT1!: () => void;
    const blockerT1 = new Promise<void>((r) => (resolveT1 = r));
    const run1 = vi.fn().mockImplementation(() => blockerT1);
    const run2 = vi.fn().mockResolvedValue(undefined);

    // T1 bloque la concurrence ; T2 doit être ignorée car même type + dedup.
    runner.enqueue({ type: 'poll-replies', label: 'T1', run: run1, dedup: true });
    runner.enqueue({ type: 'poll-replies', label: 'T2', run: run2, dedup: true });

    // Laisser un tick pour que T1 démarre.
    await new Promise((r) => setTimeout(r, 0));
    expect(run2).not.toHaveBeenCalled(); // T2 ignorée

    resolveT1(); // débloquer T1
    await waitForStatus(runner, 'done');
    expect(run1).toHaveBeenCalledOnce();
    expect(run2).not.toHaveBeenCalled(); // toujours pas appelée
  });

  // Test 3 : réessai après erreur transitoire
  test('réessaie une tâche qui échoue une fois (erreur transitoire)', async () => {
    vi.useFakeTimers();
    let attempts = 0;

    const run = vi.fn().mockImplementation(() => {
      attempts++;
      // Échoue au 1er essai, réussit au 2e.
      return attempts === 1
        ? Promise.reject(new Error('timeout réseau'))
        : Promise.resolve();
    });

    // Important : enregistrer le listener AVANT enqueue pour ne pas manquer
    // l'événement 'done' qui sera émis pendant advanceTimersByTimeAsync.
    const donePromise = waitForStatus(runner, 'done');
    runner.enqueue({ type: 'send-email', label: 'retry', run });

    // Flush les microtasks pour que le rejet de l'attempt 1 se propage
    // jusqu'au setTimeout de backoff (2000ms × 1).
    await Promise.resolve();
    await Promise.resolve();
    // Avancer le backoff + laisser de la marge.
    await vi.advanceTimersByTimeAsync(2500);
    vi.useRealTimers();

    await donePromise;
    expect(run).toHaveBeenCalledTimes(2);
  });

  // Test 4 : erreur permanente — pas de retry
  test('erreur EAUTH permanente → 1 seul essai, status failed', async () => {
    const eauth = Object.assign(new Error('Authentification SMTP refusée'), { code: 'EAUTH' });
    const run = vi.fn().mockRejectedValue(eauth);

    runner.enqueue({ type: 'send-email', label: 'perm', run });
    await waitForStatus(runner, 'failed');

    // MAX_ATTEMPTS = 3, mais isPermanentError coupe court après 1.
    expect(run).toHaveBeenCalledOnce();
  });

  // Test 5 : concurrence limitée à 2
  test('ne fait tourner que 2 tâches simultanément (CONCURRENCY = 2)', async () => {
    let currentActive = 0;
    let peakActive = 0;

    // Chaque tâche incrémente un compteur, attend 30ms, puis décrémente.
    const makeTask = () => vi.fn().mockImplementation(async () => {
      currentActive++;
      peakActive = Math.max(peakActive, currentActive);
      await new Promise((r) => setTimeout(r, 30));
      currentActive--;
    });

    // 3 tâches → 2 au max en même temps, la 3e attend.
    const allDone = new Promise<void>((resolve) => {
      let done = 0;
      runner.onProgress((p) => {
        if (p.status === 'done' && ++done === 3) resolve();
      });
    });

    runner.enqueue({ type: 'generate-email', label: 'C1', run: makeTask() });
    runner.enqueue({ type: 'send-email',     label: 'C2', run: makeTask() });
    runner.enqueue({ type: 'cv-parse',       label: 'C3', run: makeTask() });

    await allDone;
    expect(peakActive).toBeLessThanOrEqual(2);
  });
});

// ─── Tests isPermanentError ──────────────────────────────────────────────────

describe('isPermanentError', () => {
  afterEach(() => { vi.useRealTimers(); }); // sécurité après le test fake timers

  // Test 5b : classification des erreurs permanentes vs transitoires
  test('identifie correctement les erreurs permanentes vs transitoires', () => {
    // Permanentes — pas de retry utile.
    expect(isPermanentError({ code: 'EAUTH' })).toBe(true);
    expect(isPermanentError({ status: 401 })).toBe(true);
    expect(isPermanentError({ status: 400 })).toBe(true);
    expect(isPermanentError({ code: 'P2025' })).toBe(true);

    // Transitoires — un retry peut réussir.
    expect(isPermanentError({ status: 500 })).toBe(false);
    expect(isPermanentError({ status: 429 })).toBe(false);
    expect(isPermanentError(new Error('ECONNRESET'))).toBe(false);
    expect(isPermanentError(null)).toBe(false);
  });
});
