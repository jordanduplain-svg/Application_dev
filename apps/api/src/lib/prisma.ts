import { PrismaClient } from '@prisma/client';

/**
 * Rôle : Instance unique (singleton) du client Prisma partagée par toute l'API.
 *
 * En développement, le rechargement à chaud (hot-reload) ré-exécute ce module
 * plusieurs fois ; sans précaution, chaque exécution créerait une nouvelle
 * connexion à la base et finirait par épuiser le pool de connexions.
 * On mémorise donc l'instance sur l'objet `global` pour la réutiliser.
 */

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

// En production le module n'est chargé qu'une fois : inutile de polluer `global`.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
