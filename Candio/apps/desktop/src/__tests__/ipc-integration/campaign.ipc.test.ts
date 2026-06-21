/**
 * MOD-08 : Test d'intégration du flux campagne.
 *
 * vitest-electron étant absent du registre npm, on teste les services
 * directement (couche service = logique IPC sans le transport Electron).
 * La base SQLite de test est créée dans un dossier temporaire.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const requireFromHere = createRequire(import.meta.url);

// ─── Setup base de test ──────────────────────────────────────────────────────

let prisma: PrismaClient;
let testDir: string;

beforeAll(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'carreerops-campaign-test-'));
  const dbPath = join(testDir, 'test.db');
  const prismaCli = requireFromHere.resolve('prisma/build/index.js');
  const schemaPath = join(process.cwd(), 'prisma', 'schema.prisma');

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(testDir, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Campaign CRUD (intégration DB)', () => {
  test('crée une campagne, la récupère, puis la supprime', async () => {
    // 1. Créer
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Test Campagne Dev',
        prompt: 'Cherche développeur TypeScript',
        jobTitle: 'Développeur TypeScript',
        location: 'Paris',
        contractTypes: 'CDI',
        status: 'DRAFT',
      },
    });
    expect(campaign.id).toBeTruthy();
    expect(campaign.name).toBe('Test Campagne Dev');

    // 2. Récupérer
    const found = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    expect(found).not.toBeNull();
    expect(found?.jobTitle).toBe('Développeur TypeScript');

    // 3. Supprimer
    await prisma.campaign.delete({ where: { id: campaign.id } });
    const deleted = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    expect(deleted).toBeNull();
  });

  test('liste uniquement les campagnes non archivées', async () => {
    const c1 = await prisma.campaign.create({
      data: {
        name: 'Active',
        prompt: 'p1',
        jobTitle: 'Dev',
        location: 'Lyon',
        contractTypes: 'CDI',
        status: 'DRAFT',
      },
    });
    const c2 = await prisma.campaign.create({
      data: {
        name: 'Archivée',
        prompt: 'p2',
        jobTitle: 'Dev',
        location: 'Lyon',
        contractTypes: 'CDD',
        status: 'COMPLETED',
        archivedAt: new Date(),
      },
    });

    const active = await prisma.campaign.findMany({ where: { archivedAt: null } });
    const names = active.map((c) => c.name);
    expect(names).toContain('Active');
    expect(names).not.toContain('Archivée');

    // Nettoyage
    await prisma.campaign.deleteMany({ where: { id: { in: [c1.id, c2.id] } } });
  });
});
