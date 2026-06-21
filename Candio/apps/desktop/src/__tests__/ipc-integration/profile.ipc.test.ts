/**
 * FM-10 : tests d'intégration du domaine Profil.
 * Couvre : créer profil avec phone/linkedin → getProfile() → vérifier les champs.
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
  testDir = mkdtempSync(join(tmpdir(), 'carreerops-profile-test-'));
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

describe('Profile FM-05 : champs phone / linkedin / portfolio (intégration DB)', () => {
  test('Test 1 : créer profil avec phone/linkedin → findFirst → vérifier les champs', async () => {
    // 1. Créer le profil avec les nouveaux champs.
    const created = await prisma.profile.create({
      data: {
        firstName: 'Jean',
        lastName: 'Dupont',
        emailSender: 'jean.dupont@example.com',
        phone: '+33 6 12 34 56 78',
        linkedin: 'https://linkedin.com/in/jeandupont',
        portfolio: 'https://jeandupont.dev',
      } as Parameters<typeof prisma.profile.create>[0]['data'],
    });
    expect(created.id).toBeTruthy();

    // 2. Relire le profil.
    const found = await prisma.profile.findFirst({ where: { id: created.id } });
    expect(found).not.toBeNull();
    expect(found?.firstName).toBe('Jean');
    expect(found?.lastName).toBe('Dupont');

    // 3. Vérifier les nouveaux champs FM-05.
    const p = found as typeof found & { phone?: string | null; linkedin?: string | null; portfolio?: string | null };
    expect(p.phone).toBe('+33 6 12 34 56 78');
    expect(p.linkedin).toBe('https://linkedin.com/in/jeandupont');
    expect(p.portfolio).toBe('https://jeandupont.dev');

    // 4. Mettre à jour les champs.
    await prisma.profile.update({
      where: { id: created.id },
      data: {
        phone: '+33 7 99 88 77 66',
        linkedin: null,
      } as Parameters<typeof prisma.profile.update>[0]['data'],
    });

    const updated = await prisma.profile.findFirst({ where: { id: created.id } });
    const u = updated as typeof updated & { phone?: string | null; linkedin?: string | null };
    expect(u?.phone).toBe('+33 7 99 88 77 66');
    expect(u?.linkedin).toBeNull();

    // 5. Nettoyage.
    await prisma.profile.delete({ where: { id: created.id } });
    const deleted = await prisma.profile.findFirst({ where: { id: created.id } });
    expect(deleted).toBeNull();
  });

  test('Test 2 : les champs phone/linkedin/portfolio sont optionnels (null par défaut)', async () => {
    const profile = await prisma.profile.create({
      data: {
        firstName: 'Marie',
        lastName: 'Martin',
        emailSender: null,
      },
    });

    const found = await prisma.profile.findFirst({ where: { id: profile.id } });
    const p = found as typeof found & { phone?: string | null; linkedin?: string | null; portfolio?: string | null };
    expect(p?.phone ?? null).toBeNull();
    expect(p?.linkedin ?? null).toBeNull();
    expect(p?.portfolio ?? null).toBeNull();

    await prisma.profile.delete({ where: { id: profile.id } });
  });
});
