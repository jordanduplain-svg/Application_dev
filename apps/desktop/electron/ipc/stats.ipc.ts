import { handle } from './registry';
import { prisma } from '../../src/lib/prisma';
import { classifyReplySentiment, stripQuotedReply } from '../../src/tasks/reply-matching';
import { estimateCostUsd } from '../../src/lib/ai-cost';

const SENT_STATUSES = ['SENT', 'REPLIED', 'FOLLOWED_UP'] as const;

export function registerStatsHandlers(): void {
  // F3 : taux de réponse par secteur d'activité (donnée d'enrichissement scraper).
  // Permet de voir quels secteurs répondent le mieux → réorienter le ciblage.
  handle('stats:getBySector', async () => {
    const apps = await prisma.application.findMany({
      where: { sentAt: { not: null } },
      select: { repliedAt: true, company: { select: { sector: true } } },
    });
    const acc = new Map<string, { sent: number; replied: number }>();
    for (const a of apps) {
      const sector = a.company.sector?.trim() || 'Non renseigné';
      const e = acc.get(sector) ?? { sent: 0, replied: 0 };
      e.sent += 1;
      if (a.repliedAt) e.replied += 1;
      acc.set(sector, e);
    }
    return [...acc.entries()]
      .map(([sector, { sent, replied }]) => ({
        sector, sent, replied,
        replyRate: sent > 0 ? Math.round((replied / sent) * 1000) / 10 : 0,
      }))
      .sort((x, y) => y.sent - x.sent);
  });

  handle('stats:getGlobal', async () => {
    // PERF-S2 : toutes les requêtes indépendantes en parallèle.
    const [totalCampaigns, totalCompanies, statusGroups, avgRaw, campaignGroups, manualGroups, totalDrafted,
           followUpSent, followUpReplied, replyTexts] =
      await Promise.all([
        prisma.campaign.count({ where: { archivedAt: null } }),
        prisma.company.count(),
        prisma.application.groupBy({ by: ['status'], _count: { _all: true } }),
        // PERF-S2 : calcul en DB via AVG(JULIANDAY) au lieu de charger toutes les lignes.
        prisma.$queryRaw<[{ avg: number | null }]>`
          SELECT AVG(JULIANDAY(repliedAt) - JULIANDAY(sentAt)) AS avg
          FROM Application
          WHERE status = 'REPLIED' AND sentAt IS NOT NULL AND repliedAt IS NOT NULL
        `,
        prisma.application.groupBy({
          by: ['campaignId', 'status'],
          where: { campaign: { archivedAt: null } },
          _count: { _all: true },
        }),
        prisma.application.groupBy({
          by: ['manualStatus'],
          _count: { _all: true },
        }),
        prisma.application.count({ where: { body: { not: '' } } }),
        // STATS-FU : relances RÉELLEMENT envoyées. followUpSentAt n'est posé qu'après
        // un envoi (le report quota restaure l'état ; seul l'opt-out le laisse posé sans
        // envoi — cas rare et assumé). Une réponse ne peut arriver qu'APRÈS la relance,
        // le claim exigeant repliedAt=null → repliedAt non-null ⇒ retour post-relance.
        prisma.application.count({ where: { followUpSentAt: { not: null } } }),
        prisma.application.count({ where: { followUpSentAt: { not: null }, repliedAt: { not: null } } }),
        // STATS-SENT : on charge le texte des réponses pour les classer (heuristique locale,
        // même code que la page Réponses). ponytail: scan en mémoire ; O(n) sur les réponses
        // reçues (dizaines/centaines pour un mono-utilisateur) — passer en SQL si ça grossit.
        prisma.application.findMany({ where: { status: 'REPLIED' }, select: { replyContent: true } }),
      ]);

    const countByStatus = Object.fromEntries(
      statusGroups.map((g) => [g.status, g._count._all])
    );
    const totalSent = SENT_STATUSES.reduce((s, st) => s + (countByStatus[st] ?? 0), 0);
    const totalReplied = countByStatus['REPLIED'] ?? 0;
    const replyRate = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

    // PERF-S2 : avgDaysToReply calculé en DB.
    const avgDaysToReply = avgRaw[0]?.avg != null ? Math.round(avgRaw[0].avg) : null;

    const campaignStats = new Map<string, { sent: number; replied: number }>();
    for (const g of campaignGroups) {
      const cur = campaignStats.get(g.campaignId) ?? { sent: 0, replied: 0 };
      if ((SENT_STATUSES as readonly string[]).includes(g.status)) cur.sent += g._count._all;
      if (g.status === 'REPLIED') cur.replied += g._count._all;
      campaignStats.set(g.campaignId, cur);
    }

    const campaignNames = await prisma.campaign.findMany({
      where: { archivedAt: null, id: { in: [...campaignStats.keys()] } },
      select: { id: true, name: true },
    });

    let topCampaign: { id: string; name: string; replyRate: number } | null = null;
    for (const c of campaignNames) {
      const stats = campaignStats.get(c.id);
      if (!stats || stats.sent === 0) continue;
      const rate = Math.round((stats.replied / stats.sent) * 100);
      if (!topCampaign || rate > topCampaign.replyRate) {
        topCampaign = { id: c.id, name: c.name, replyRate: rate };
      }
    }

    const countByManual = Object.fromEntries(
      manualGroups
        .filter((g) => g.manualStatus !== null)
        .map((g) => [g.manualStatus!, g._count._all])
    );
    const totalInterviewed = countByManual['INTERVIEWED'] ?? 0;
    const totalOffers = countByManual['OFFER'] ?? 0;

    const followUpReplyRate = followUpSent > 0 ? Math.round((followUpReplied / followUpSent) * 100) : 0;

    // STATS-SENT : classe chaque réponse (positive / négative / neutre) sur le vrai
    // message (dé-cité), comme la page Réponses — cohérence UI/stats.
    const sentiment = { positive: 0, neutral: 0, rejection: 0 };
    for (const r of replyTexts) {
      sentiment[classifyReplySentiment(stripQuotedReply(r.replyContent))] += 1;
    }

    return {
      totalCampaigns,
      totalCompanies,
      totalSent,
      totalReplied,
      replyRate,
      avgDaysToReply,
      topCampaign,
      totalInterviewed,
      totalOffers,
      followUpSent,
      followUpReplied,
      followUpReplyRate,
      sentiment,
      funnelStats: {
        targeted: totalCompanies,
        drafted: totalDrafted,
        sent: totalSent,
        replied: totalReplied,
        interviewed: totalInterviewed,
        offers: totalOffers,
      },
    };
  });

  // COST-01 : coût des appels IA — cumulé, 30 derniers jours, moyen par mail, par type.
  handle('stats:getAiCost', async () => {
    const rows = await prisma.aiUsage.findMany({
      select: { model: true, kind: true, promptTokens: true, completionTokens: true, at: true },
    });
    const since30 = Date.now() - 30 * 864e5;
    let totalUsd = 0, totalTokens = 0, last30dUsd = 0, emailCount = 0, emailUsd = 0;
    const byKind = new Map<string, { count: number; usd: number; tokens: number }>();
    for (const r of rows) {
      const usd = estimateCostUsd(r.model, r.promptTokens, r.completionTokens);
      const tokens = r.promptTokens + r.completionTokens;
      totalUsd += usd; totalTokens += tokens;
      if (r.at.getTime() >= since30) last30dUsd += usd;
      const k = byKind.get(r.kind) ?? { count: 0, usd: 0, tokens: 0 };
      k.count += 1; k.usd += usd; k.tokens += tokens; byKind.set(r.kind, k);
      if (r.kind === 'email' || r.kind === 'followup') { emailCount += 1; emailUsd += usd; }
    }
    const avgUsdPerEmail = emailCount > 0 ? emailUsd / emailCount : 0;

    // COST-02 : coût ESTIMÉ par campagne = VOLUME réellement envoyé × coût moyen/mail.
    // Le volume est exact (compté dans les candidatures) : mails générés (corps non vide) +
    // relances (followUpCount). Marche identiquement pour le passé et le futur, sans dépendre
    // du rattachement des appels IA. Archivées incluses (le coût a bien eu lieu).
    const apps = await prisma.application.findMany({
      select: { campaignId: true, body: true, followUpCount: true },
    });
    const vol = new Map<string, { emails: number; followups: number }>();
    for (const a of apps) {
      const v = vol.get(a.campaignId) ?? { emails: 0, followups: 0 };
      if (a.body && a.body.trim()) v.emails += 1;        // un corps généré = 1 appel IA « email »
      v.followups += a.followUpCount ?? 0;               // chaque relance = 1 appel IA « followup »
      vol.set(a.campaignId, v);
    }
    const cids = [...vol.keys()];
    const names = cids.length
      ? new Map((await prisma.campaign.findMany({ where: { id: { in: cids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]))
      : new Map<string, string>();

    return {
      totalUsd, totalTokens, last30dUsd,
      emailCount,
      avgUsdPerEmail,
      byKind: [...byKind.entries()]
        .map(([kind, v]) => ({ kind, count: v.count, usd: v.usd, tokens: v.tokens }))
        .sort((a, b) => b.usd - a.usd),
      byCampaign: [...vol.entries()]
        .map(([cid, v]) => ({
          campaignId: cid,
          name: names.get(cid) ?? '(campagne supprimée)',
          emails: v.emails,
          followups: v.followups,
          usd: (v.emails + v.followups) * avgUsdPerEmail,
        }))
        .filter((c) => c.emails + c.followups > 0)
        .sort((a, b) => b.usd - a.usd),
    };
  });

  handle('stats:getActivityByDay', async ({ days } = {}) => {
    const lookback = days ?? 30;

    let since: Date | undefined;
    if (lookback > 0) {
      since = new Date();
      since.setDate(since.getDate() - (lookback - 1));
      since.setHours(0, 0, 0, 0);
    } else {
      // Mode « tout le temps » : plafonné à 2 ans pour limiter la charge mémoire.
      since = new Date();
      since.setFullYear(since.getFullYear() - 2);
      since.setHours(0, 0, 0, 0);
    }

    const apps = await prisma.application.findMany({
      where: {
        OR: [
          { sentAt: { gte: since } },
          { repliedAt: { gte: since } },
        ],
      },
      select: { sentAt: true, repliedAt: true },
    });

    const sentMap = new Map<string, number>();
    const repliedMap = new Map<string, number>();
    for (const a of apps) {
      if (a.sentAt) {
        const d = a.sentAt.toISOString().slice(0, 10);
        sentMap.set(d, (sentMap.get(d) ?? 0) + 1);
      }
      if (a.repliedAt) {
        const d = a.repliedAt.toISOString().slice(0, 10);
        repliedMap.set(d, (repliedMap.get(d) ?? 0) + 1);
      }
    }

    if (lookback <= 0) {
      const allDates = new Set([...sentMap.keys(), ...repliedMap.keys()]);
      const sorted = [...allDates].sort();
      return sorted.map((dateStr) => ({
        date: dateStr,
        sent: sentMap.get(dateStr) ?? 0,
        replied: repliedMap.get(dateStr) ?? 0,
      }));
    }

    const result: { date: string; sent: number; replied: number }[] = [];
    for (let i = 0; i < lookback; i++) {
      const d = new Date(since!);
      d.setDate(since!.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      result.push({
        date: dateStr,
        sent: sentMap.get(dateStr) ?? 0,
        replied: repliedMap.get(dateStr) ?? 0,
      });
    }
    return result;
  });

  // FM-02 : comparaison A/B — taux de réponse par variante de prompt par campagne.
  handle('stats:getAbTest', async ({ campaignId } = {}) => {
    // Requête SQL brute pour éviter les subtilités de typage de groupBy Prisma.
    // On compte les envois et les réponses par (campagne, variant).
    type AbRow = { campaignId: string; promptVariant: string; sent: bigint; replied: bigint };
    const rows = campaignId
      ? await prisma.$queryRaw<AbRow[]>`
          SELECT campaignId, promptVariant,
            COUNT(*) AS sent,
            SUM(CASE WHEN status = 'REPLIED' THEN 1 ELSE 0 END) AS replied
          FROM Application
          WHERE promptVariant IN ('A','B')
            AND status IN ('SENT','REPLIED','FOLLOWED_UP')
            AND campaignId = ${campaignId}
          GROUP BY campaignId, promptVariant
        `
      : await prisma.$queryRaw<AbRow[]>`
          SELECT campaignId, promptVariant,
            COUNT(*) AS sent,
            SUM(CASE WHEN status = 'REPLIED' THEN 1 ELSE 0 END) AS replied
          FROM Application
          WHERE promptVariant IN ('A','B')
            AND status IN ('SENT','REPLIED','FOLLOWED_UP')
          GROUP BY campaignId, promptVariant
        `;

    if (rows.length === 0) return [];

    // Regrouper par campagne → variante → comptages.
    const map = new Map<string, { A: { sent: number; replied: number }; B: { sent: number; replied: number } }>();
    for (const r of rows) {
      const v = r.promptVariant as 'A' | 'B';
      if (v !== 'A' && v !== 'B') continue;
      const entry = map.get(r.campaignId) ?? { A: { sent: 0, replied: 0 }, B: { sent: 0, replied: 0 } };
      entry[v].sent += Number(r.sent);
      entry[v].replied += Number(r.replied);
      map.set(r.campaignId, entry);
    }

    // Récupérer les noms des campagnes concernées.
    const campaignNames = await prisma.campaign.findMany({
      where: { id: { in: [...map.keys()] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(campaignNames.map((c) => [c.id, c.name]));

    return [...map.entries()].map(([cid, { A, B }]) => ({
      campaignId: cid,
      campaignName: nameById.get(cid) ?? cid,
      variantA: {
        sent: A.sent,
        replied: A.replied,
        replyRate: A.sent > 0 ? Math.round((A.replied / A.sent) * 100) : 0,
      },
      variantB: {
        sent: B.sent,
        replied: B.replied,
        replyRate: B.sent > 0 ? Math.round((B.replied / B.sent) * 100) : 0,
      },
    }));
  });

  handle('stats:getCampaignComparison', async () => {
    const campaigns = await prisma.campaign.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
    });
    const ids = campaigns.map((c) => c.id);
    if (ids.length === 0) return [];

    const [groups, repliedDates] = await Promise.all([
      prisma.application.groupBy({
        by: ['campaignId', 'status'],
        where: { campaignId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.application.findMany({
        where: {
          campaignId: { in: ids },
          status: 'REPLIED',
          sentAt: { not: null },
          repliedAt: { not: null },
        },
        select: { campaignId: true, sentAt: true, repliedAt: true },
      }),
    ]);

    const statsMap = new Map<string, { sent: number; replied: number }>();
    for (const g of groups) {
      const cur = statsMap.get(g.campaignId) ?? { sent: 0, replied: 0 };
      if ((SENT_STATUSES as readonly string[]).includes(g.status)) cur.sent += g._count._all;
      if (g.status === 'REPLIED') cur.replied += g._count._all;
      statsMap.set(g.campaignId, cur);
    }

    const avgMap = new Map<string, number[]>();
    for (const a of repliedDates) {
      const days = (a.repliedAt!.getTime() - a.sentAt!.getTime()) / (1000 * 60 * 60 * 24);
      const arr = avgMap.get(a.campaignId) ?? [];
      arr.push(days);
      avgMap.set(a.campaignId, arr);
    }

    return campaigns.map((c) => {
      const stats = statsMap.get(c.id) ?? { sent: 0, replied: 0 };
      const replyRate = stats.sent > 0 ? Math.round((stats.replied / stats.sent) * 100) : 0;
      const daysArr = avgMap.get(c.id);
      const avgDays = daysArr && daysArr.length > 0
        ? Math.round(daysArr.reduce((s, d) => s + d, 0) / daysArr.length)
        : null;
      return { id: c.id, name: c.name, sent: stats.sent, replied: stats.replied, replyRate, avgDays };
    });
  });
}
