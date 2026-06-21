/**
 * Test d'intégration du FLUX D'ENVOI complet (enqueueSend → task-runner → DB).
 *
 * Harnais : SMTP mocké (mailer), quota mocké (secrets), base SQLite réelle migrée
 * dans un dossier temporaire (le singleton `prisma` y pointe via le mock de `paths`).
 * On pilote la vraie tâche `send-email` et on vérifie les transitions d'état + les
 * effets de bord (quota, refund) — y compris les bugs corrigés : refund sur échec
 * SMTP et blocage opt-out / quota.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { rmSync } from 'fs';
import type { TaskProgress } from '@candio/shared';

// Base de test temporaire — chemin calculé avant le hoisting des vi.mock.
const dbInfo = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'carreerops-send-flow-'));
  return { dir, dbPath: join(dir, 'test.db') };
});

// Le singleton prisma lit getDbPath() à la construction (lazy-connect) → on le
// redirige vers la base de test, sans dépendre d'Electron (app.getPath).
vi.mock('../../lib/paths', () => ({ getDbPath: () => dbInfo.dbPath }));

// Harnais SMTP : aucun envoi réel. On contrôle succès/échec par test.
const { sendApplicationEmail } = vi.hoisted(() => ({ sendApplicationEmail: vi.fn(async () => '<mid@test>') }));
vi.mock('../../lib/mailer', () => ({ sendApplicationEmail }));

// Quota mocké : on pilote l'autorisation d'envoi et on observe le remboursement.
const { tryIncrementDailySend, refundDailySend, getDailySendLimit } = vi.hoisted(() => ({
  tryIncrementDailySend: vi.fn(async () => true),
  refundDailySend: vi.fn(async () => {}),
  getDailySendLimit: vi.fn(() => 49),
}));
vi.mock('../../lib/secrets', () => ({ tryIncrementDailySend, refundDailySend, getDailySendLimit }));

import { prisma } from '../../lib/prisma';
import { taskRunner } from '../../lib/task-runner';
import { enqueueSend } from '../../tasks/send-email.task';
import { addOptOut } from '../../modules/optout/optout.service';

const requireFromHere = createRequire(import.meta.url);
let campaignId: string;
let seq = 0;

beforeAll(async () => {
  // Migration de la base de test.
  const prismaCli = requireFromHere.resolve('prisma/build/index.js');
  const schemaPath = require('node:path').join(process.cwd(), 'prisma', 'schema.prisma');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
    env: { ...process.env, DATABASE_URL: `file:${dbInfo.dbPath}` },
    stdio: 'pipe',
  });
  // Neutralise le throttle anti-spam (setTimeout 8 s) pour ne pas ralentir les tests.
  vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; });
  // Profil expéditeur + campagne partagés.
  await prisma.profile.create({ data: { firstName: 'Jean', lastName: 'Dupont', emailSender: 'jean@test.io' } });
  // CV attaché à la campagne (le mailer est mocké → le filePath n'est jamais lu).
  const cv = await prisma.cv.create({ data: { name: 'CV test', filePath: '/tmp/cv-test.pdf' } });
  const campaign = await prisma.campaign.create({
    data: { name: 'Flux', prompt: 'Dev', jobTitle: 'Dev', location: 'Remote', contractTypes: 'CDI', cvId: cv.id },
  });
  campaignId = campaign.id;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
  rmSync(dbInfo.dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  sendApplicationEmail.mockResolvedValue('<mid@test>');
  tryIncrementDailySend.mockResolvedValue(true);
});

// Crée une candidature DRAFT prête à envoyer (email unique par test).
async function makeDraft(email: string): Promise<string> {
  const company = await prisma.company.create({ data: { campaignId, name: `C${seq++}`, contactEmail: email } });
  const app = await prisma.application.create({
    data: { campaignId, companyId: company.id, subject: 'Objet', body: 'Corps', status: 'DRAFT' },
  });
  return app.id;
}

// Lance la tâche enfilée et attend sa fin (done|failed).
async function runSend(appId: string): Promise<void> {
  const done = new Promise<TaskProgress>((resolve) => {
    const off = taskRunner.onProgress((p) => {
      if (p.type === 'send-email' && (p.status === 'done' || p.status === 'failed')) { off(); resolve(p); }
    });
  });
  await enqueueSend(appId);
  await done;
}

describe('Flux d\'envoi (intégration, SMTP mocké)', () => {
  test('succès : DRAFT → SENT avec messageId, quota consommé', async () => {
    const id = await makeDraft('ok@acme.com');
    await runSend(id);

    const app = await prisma.application.findUnique({ where: { id } });
    expect(app?.status).toBe('SENT');
    expect(app?.messageId).toBe('<mid@test>');
    expect(sendApplicationEmail).toHaveBeenCalledTimes(1);
    expect(sendApplicationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ok@acme.com' }));
    expect(tryIncrementDailySend).toHaveBeenCalledTimes(1);
    expect(refundDailySend).not.toHaveBeenCalled();
  });

  test('échec SMTP : DRAFT → FAILED ET quota remboursé (bug refund)', async () => {
    sendApplicationEmail.mockRejectedValueOnce(new Error('SMTP down'));
    const id = await makeDraft('fail@acme.com');
    await runSend(id);

    const app = await prisma.application.findUnique({ where: { id } });
    expect(app?.status).toBe('FAILED');
    expect(refundDailySend).toHaveBeenCalledTimes(1); // crédit rendu, pas de sur-comptage
  });

  test('quota atteint : pas d\'envoi, FAILED', async () => {
    tryIncrementDailySend.mockResolvedValueOnce(false);
    const id = await makeDraft('quota@acme.com');
    await runSend(id);

    const app = await prisma.application.findUnique({ where: { id } });
    expect(app?.status).toBe('FAILED');
    expect(sendApplicationEmail).not.toHaveBeenCalled();
  });

  test('aucun CV attaché → bloqué, aucun envoi (candidature sans CV interdite)', async () => {
    // Campagne SANS cvId (cas : CV supprimé → onDelete:SetNull).
    const noCv = await prisma.campaign.create({
      data: { name: 'SansCV', prompt: 'Dev', jobTitle: 'Dev', location: 'Remote', contractTypes: 'CDI' },
    });
    const company = await prisma.company.create({ data: { campaignId: noCv.id, name: 'NoCv', contactEmail: 'nocv@acme.com' } });
    const app = await prisma.application.create({
      data: { campaignId: noCv.id, companyId: company.id, subject: 'O', body: 'B', status: 'DRAFT' },
    });
    await runSend(app.id);

    const found = await prisma.application.findUnique({ where: { id: app.id } });
    expect(found?.status).toBe('FAILED');
    expect(found?.errorMessage).toMatch(/CV/i);
    expect(sendApplicationEmail).not.toHaveBeenCalled();
  });

  test('RGPD : contact opt-out → bloqué, aucun envoi', async () => {
    await addOptOut('block@acme.com', 'test');
    const id = await makeDraft('block@acme.com');
    await runSend(id);

    const app = await prisma.application.findUnique({ where: { id } });
    expect(app?.status).toBe('FAILED');
    expect(sendApplicationEmail).not.toHaveBeenCalled();
  });
});
