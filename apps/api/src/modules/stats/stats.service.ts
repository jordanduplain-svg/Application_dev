import { prisma } from '../../lib/prisma';

/**
 * Rôle : Calcul des statistiques affichées sur le tableau de bord.
 */

export class StatsService {
  /**
   * Statistiques agrégées du tableau de bord d'un utilisateur :
   * nombre de campagnes + répartition des candidatures par statut.
   * Les comptages sont exécutés en parallèle (`Promise.all`).
   */
  async getDashboardStats(userId: string) {
    // Toutes les candidatures rattachées aux campagnes de cet utilisateur.
    const appWhere = { campaign: { userId } };

    // `groupBy` : une SEULE requête pour la répartition par statut, au lieu de
    // 6 COUNT séparés (cette méthode est rejouée toutes les 15 s par client SSE).
    const [campaignsCount, grouped] = await Promise.all([
      prisma.campaign.count({ where: { userId } }),
      prisma.application.groupBy({
        by: ['status'],
        where: appWhere,
        _count: { _all: true },
      }),
    ]);

    // `groupBy` n'inclut que les statuts réellement présents : on lit avec un
    // repli à 0 pour ceux qui manquent.
    const byStatus = new Map(grouped.map((row) => [row.status, row._count._all]));
    const get = (status: string) => byStatus.get(status as any) ?? 0;
    const total = grouped.reduce((sum, row) => sum + row._count._all, 0);

    return {
      campaignsCount,
      applicationsStats: {
        total,
        pending: get('PENDING'),
        sent: get('SENT'),
        opened: get('OPENED'),
        replied: get('REPLIED'),
        failed: get('FAILED'),
      },
    };
  }

  /**
   * Liste paginée des candidatures ayant reçu une réponse, pour l'utilisateur
   * donné. Le filtre `campaign: { userId }` garantit qu'on ne renvoie que les
   * réponses des campagnes appartenant à cet utilisateur.
   *
   * La pagination (`skip`/`take`) est indispensable au scroll infini côté
   * mobile : sans elle, l'API renvoie toujours TOUT, ce qui casse la détection
   * de fin de liste.
   */
  async getReplies(userId: string, page: number = 1, limit: number = 10) {
    return prisma.application.findMany({
      where: {
        status: 'REPLIED',
        campaign: { userId },
      },
      orderBy: {
        repliedAt: 'desc',
      },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        campaign: {
          select: {
            name: true,
            jobTitle: true,
          },
        },
      },
    });
  }
}
