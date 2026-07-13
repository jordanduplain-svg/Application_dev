import Fuse from 'fuse.js';
import { handle } from './registry';
import { prisma } from '../../src/lib/prisma';
import type { SearchResult, SearchHit, ApplicationStatus } from '@candio/shared';

// SEARCH-01 / B8 : pliage insensible à la casse ET aux accents (« Réponse » == « reponse »).
// NFD décompose les accentués (é → e + ◌́) puis on retire les diacritiques. Pour un texte NFC
// (cas normal) la longueur est préservée → les index restent alignés sur l'original.
function fold(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// SEARCH-01 : extrait ~120 caractères autour de la 1ʳᵉ occurrence (recherche pliée).
function snippet(text: string | null, term: string): string {
  if (!text) return '';
  const i = fold(text).indexOf(fold(term));
  if (i < 0) return text.slice(0, 120).trim();
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + text.slice(start, i + term.length + 80).replace(/\s+/g, ' ').trim() + '…';
}

// UX-S10 : recherche globale sur campagnes, entreprises et candidatures.
export function registerSearchHandlers(): void {
  // SEARCH-01 : recherche PLEIN-TEXTE dans les contenus (un hit par candidature, champ le
  // plus pertinent). LIKE SQLite (insensible à la casse ASCII) — suffisant en mono-utilisateur.
  // ponytail: passer en FTS5 (better-sqlite3 déjà présent) si le volume l'exige.
  handle('search:content', async ({ q }) => {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    const needle = fold(term);
    const inField = (t: string | null | undefined) => fold(t).includes(needle);
    // B8/ponytail : LIKE SQLite n'est pas insensible aux accents → on plie en JS sur un
    // périmètre borné (500 candidatures les plus récentes). Passer en FTS5 (tokenizer
    // unicode61 remove_diacritics) si le volume dépasse un jour cette échelle mono-utilisateur.
    const apps = await prisma.application.findMany({
      where: { campaign: { archivedAt: null } },
      include: {
        company: { select: { name: true } },
        messages: { select: { direction: true, body: true }, orderBy: { createdAt: 'desc' } },
      },
      take: 500,
      orderBy: { sentAt: 'desc' },
    });
    const hits: SearchHit[] = [];
    for (const a of apps) {
      const base = {
        applicationId: a.id, campaignId: a.campaignId, companyName: a.company.name,
        subject: a.subject, status: a.status as ApplicationStatus,
      };
      const msg = a.messages.find((m) => inField(m.body));
      if (inField(a.replyContent)) hits.push({ ...base, field: 'réponse', snippet: snippet(a.replyContent, term) });
      else if (msg?.direction === 'IN') hits.push({ ...base, field: 'réponse', snippet: snippet(msg.body, term) });
      else if (inField(a.myReplyContent)) hits.push({ ...base, field: 'ma réponse', snippet: snippet(a.myReplyContent, term) });
      else if (msg?.direction === 'OUT') hits.push({ ...base, field: 'ma réponse', snippet: snippet(msg.body, term) });
      else if (inField(a.followUpNote)) hits.push({ ...base, field: 'note', snippet: snippet(a.followUpNote, term) });
      else if (inField(a.subject)) hits.push({ ...base, field: 'objet', snippet: a.subject });
      else if (inField(a.body)) hits.push({ ...base, field: 'candidature', snippet: snippet(a.body, term) });
      else if (inField(a.company.name)) hits.push({ ...base, field: 'entreprise', snippet: a.company.name });
      if (hits.length >= 60) break;
    }
    return hits;
  });

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
