/**
 * MOD-08 : Test d'intégration du flux candidature.
 *
 * Crée une campagne + entreprise, crée un brouillon de candidature,
 * vérifie qu'il est bien enregistré en base.
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
  testDir = mkdtempSync(join(tmpdir(), 'carreerops-app-test-'));
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

describe('Application CRUD (intégration DB)', () => {
  test('crée campagne + entreprise → upsertDraft → vérifie en DB', async () => {
    // 1. Créer une campagne
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Campagne Intégration',
        prompt: 'Développeur senior',
        jobTitle: 'Développeur Senior',
        location: 'Remote',
        contractTypes: 'CDI',
        status: 'DRAFT',
      },
    });

    // 2. Créer une entreprise liée à la campagne
    const company = await prisma.company.create({
      data: {
        campaignId: campaign.id,
        name: 'ACME Corp',
        contactEmail: 'rh@acme.com',
      },
    });

    // 3. Créer un brouillon de candidature (simule updateDraft = create + update)
    const application = await prisma.application.create({
      data: {
        campaignId: campaign.id,
        companyId: company.id,
        subject: 'Candidature développeur — ACME Corp',
        body: 'Bonjour, je suis intéressé par votre poste...',
        status: 'DRAFT',
      },
    });

    // Simule updateDraft : mise à jour du brouillon
    await prisma.application.update({
      where: { id: application.id },
      data: {
        subject: 'Candidature développeur — ACME Corp (révisée)',
        body: 'Bonjour, je suis très intéressé par votre poste...',
      },
    });

    // 4. Vérifier en DB
    const found = await prisma.application.findUnique({
      where: { id: application.id },
      include: { company: true },
    });

    expect(found).not.toBeNull();
    expect(found?.subject).toBe('Candidature développeur — ACME Corp (révisée)');
    expect(found?.status).toBe('DRAFT');
    expect(found?.company.name).toBe('ACME Corp');

    // Nettoyage
    await prisma.application.delete({ where: { id: application.id } });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
  });
});
