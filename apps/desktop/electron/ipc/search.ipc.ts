import Fuse from 'fuse.js';
import { handle } from './registry';
import { prisma } from '../../src/lib/prisma';
import type { SearchResult } from '@candio/shared';

// UX-S10 : recherche globale sur campagnes, entreprises et candidatures.
export function registerSearchHandlers(): void {
  handle('search:global', async ({ query }) => {
    if (!query || query.trim().length < 2) return [];

    const q = `%${query.trim()}%`;
    const LIMIT_PER_TYPE = 20;
    const results: SearchResult[] = [];

    // Requêtes en parallèle pour limiter la latence.
    const [campaigns, companies, applications] = await Promise.all([
      // Recherche dans les campagnes.
      prisma.campaign.findMany({
        where: {
          archivedAt: null,
          OR: [
            { name: { contains: query.trim() } },
          ],
        },
        select: { id: true, name: true },
        take: LIMIT_PER_TYPE,
      }),
      // Recherche dans les entreprises (nom + email).
      // BUG-M3 fix : JOIN Campaign pour exclure les campagnes archivées.
      prisma.$queryRaw<{ id: string; name: string; contactEmail: string; campaignId: string }[]>`
        SELECT co.id, co.name, co.contactEmail, co.campaignId
        FROM Company co
        JOIN Campaign camp ON camp.id = co.campaignId
        WHERE (co.name LIKE ${q} OR co.contactEmail LIKE ${q})
          AND camp.archivedAt IS NULL
        LIMIT ${LIMIT_PER_TYPE}
      `,
      // Recherche dans les candidatures (sujet + nom entreprise).
      // BUG-M3 fix : même filtre archivé.
      prisma.$queryRaw<{ id: string; subject: string; companyName: string; campaignId: string }[]>`
        SELECT a.id, a.subject, c.name AS companyName, a.campaignId
        FROM Application a
        JOIN Company c ON c.id = a.companyId
        JOIN Campaign camp ON camp.id = a.campaignId
        WHERE (a.subject LIKE ${q} OR c.name LIKE ${q})
          AND camp.archivedAt IS NULL
        LIMIT ${LIMIT_PER_TYPE}
      `,
    ]);

    for (const c of campaigns) {
      results.push({ type: 'campaign', id: c.id, label: c.name });
    }

    for (const co of companies) {
      // BUG-M2 fix : id = identifiant de l'entité (co.id), pas du parent (campaignId).
      results.push({
        type: 'company',
        id: co.id,
        campaignId: co.campaignId,
        label: co.name,
        sublabel: co.contactEmail,
      });
    }

    for (const a of applications) {
      // BUG-M2 fix : id = identifiant de la candidature (a.id).
      results.push({
        type: 'application',
        id: a.id,
        campaignId: a.campaignId,
        label: a.companyName,
        sublabel: a.subject,
      });
    }

    // MOD-04 : second pass Fuse.js pour scorer et réordonner par pertinence.
    // L'index est reconstruit à chaque appel (résultats déjà filtrés à ~60 max).
    const fuse = new Fuse(results, {
      threshold: 0.4,
      keys: ['label', 'sublabel'],
    });
    const fuseResults = fuse.search(query.trim());

    // Si Fuse retourne des résultats, on utilise leur ordre (par score desc).
    // Sinon (pas de matches fuzzy), on renvoie les résultats SQL bruts.
    const ordered = fuseResults.length > 0
      ? fuseResults.map((r) => r.item)
      : results;

    return ordered.slice(0, 50);
  });
}
