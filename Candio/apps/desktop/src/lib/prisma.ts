import { PrismaClient } from '@prisma/client';
import { getDbPath } from './paths';

// Client Prisma unique, partagé par toute l'app.
// L'URL de la base est passée explicitement (et non via DATABASE_URL) : le
// fichier SQLite se trouve dans userData, chemin connu seulement à l'exécution.
// C3 : getDbPath() est lazy — appelé ici au moment de la création du client,
// donc après app.whenReady() si l'ordre de démarrage est respecté.
export const prisma = new PrismaClient({
  datasources: { db: { url: `file:${getDbPath()}` } },
});
