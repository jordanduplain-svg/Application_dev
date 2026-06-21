import { handle } from './registry';
import { prisma } from '../../src/lib/prisma';

const SENT_STATUSES = ['SENT', 'REPLIED', 'FOLLOWED_UP'] as const;

export function registerStatsHandlers(): void {
  handle('stats:getGlobal', async () => {
    // PERF-S2 : toutes les requêtes indépendantes en parallèle.
    const [totalCampaigns, totalCompanies, statusGroups, avgRaw, campaignGroups, manualGroups, totalDrafted] =
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
