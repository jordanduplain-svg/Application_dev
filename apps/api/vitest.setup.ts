import { beforeAll, afterAll, beforeEach } from 'vitest';
import * as dotenv from 'dotenv';
import path from 'path';

// Forcer les variables de test.
// Port 5544 : celui réellement exposé par le Postgres de docker-compose.yml
// (mapping "5544:5432" — 5432/5433 sont pris par des PostgreSQL natifs
// Windows). `prisma db push` (cf. beforeAll) crée la base `kandi_db_test`
// si elle n'existe pas.
dotenv.config({ path: path.resolve(__dirname, '.env.test'), override: true });
process.env.DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:5544/kandi_db_test?schema=public';

import { prisma } from './src/lib/prisma';
import { execSync } from 'child_process';

beforeAll(async () => {
  // Appliquer le schéma sur la BDD de test.
  // `--skip-generate` : on NE régénère PAS le client Prisma ici. Le client est
  // déjà généré avant le lancement des tests ; le régénérer pendant le
  // `beforeAll` échouerait si un serveur de dev verrouille le moteur Prisma
  // (rename EPERM du `query_engine` sous Windows).
  execSync('npx prisma db push --accept-data-loss --skip-generate', {
    stdio: 'ignore',
    cwd: path.resolve(__dirname),
  });
});

beforeEach(async () => {
  // Purger toutes les tables atomiquement avec TRUNCATE CASCADE.
  // CASCADE truncate aussi les tables référençant celles-ci (Invoice,
  // PasswordResetToken) ; on les liste néanmoins explicitement pour la clarté.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "Application", "Invoice", "PasswordResetToken", "Campaign", "RefreshToken", "User" CASCADE`
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
