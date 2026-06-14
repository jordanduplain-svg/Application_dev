import { prisma } from '../../lib/prisma';
import {
  CreateCampaignInput,
  UpdateCampaignInput,
  PRICE_PER_APPLICATION,
} from '@candio/shared';
import { NotFoundError, BadRequestError } from '../../middleware/error';

/**
 * Rôle : Logique métier des campagnes.
 *
 * Toutes les méthodes utilisent la vraie base de données via Prisma.
 *
 * Le budget d'une campagne découle de : quota de candidatures ×
 * `PRICE_PER_APPLICATION` (constante partagée avec l'app mobile).
 */

/**
 * Normalise une campagne pour la sérialisation JSON.
 * `budget` et `refundAmount` sont des `Decimal` Prisma qui se sérialiseraient
 * en CHAÎNE dans la réponse JSON ; on les convertit en `number` pour que le
 * client puisse les exploiter (calculs, affichage) sans surprise.
 * `refundAmount` peut être `null` (campagne non remboursée) : on préserve ce
 * `null` au lieu de le transformer en `0`.
 */
function serializeCampaign<T extends { budget: unknown; refundAmount?: unknown }>(
  campaign: T
) {
  return {
    ...campaign,
    budget: Number(campaign.budget),
    refundAmount: campaign.refundAmount == null ? null : Number(campaign.refundAmount),
  };
}

export class CampaignService {
  /**
   * Crée une campagne en base. Le budget est calculé côté serveur (source de
   * vérité) à partir du quota de candidatures, et n'est jamais accepté du client.
   */
  async createCampaign(userId: string, data: CreateCampaignInput) {
    const campaign = await prisma.campaign.create({
      data: {
        ...data,
        userId,
        budget: data.applicationQuota * PRICE_PER_APPLICATION,
      },
    });
    return serializeCampaign(campaign);
  }

  /**
   * Liste paginée des campagnes de l'utilisateur.
   * Le filtre `where: { userId }` garantit qu'un utilisateur ne voit que ses
   * propres campagnes.
   */
  async getCampaigns(userId: string, page: number = 1, limit: number = 10) {
    const [data, total] = await Promise.all([
      prisma.campaign.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.campaign.count({ where: { userId } }),
    ]);

    return {
      data: data.map(serializeCampaign),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  /**
   * Détail d'une campagne.
   * Contrôle d'appartenance : si la campagne n'existe pas OU n'appartient pas
   * à l'utilisateur, on renvoie 404 (et non 403) pour ne pas révéler
   * l'existence d'une ressource appartenant à autrui.
   */
  async getCampaignById(userId: string, campaignId: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        // On borne le nombre de candidatures chargées : une campagne au quota
        // élevé en compterait des centaines. Les 50 plus récentes suffisent à
        // l'aperçu ; une liste complète passerait par un endpoint paginé dédié.
        applications: { take: 50, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!campaign || campaign.userId !== userId) {
      throw new NotFoundError('Campaign not found');
    }

    // Compteurs agrégés sur TOUTES les candidatures. Le tableau `applications`
    // ci-dessus est tronqué à 50 : s'en servir pour les totaux donnerait des
    // chiffres faux sur une campagne à quota élevé (M10).
    const grouped = await prisma.application.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { _all: true },
    });
    const byStatus = new Map(grouped.map((row) => [row.status, row._count._all]));
    const get = (status: string) => byStatus.get(status as any) ?? 0;
    const applicationStats = {
      total: grouped.reduce((sum, row) => sum + row._count._all, 0),
      sent: get('SENT') + get('OPENED') + get('REPLIED'),
      pending: get('PENDING') + get('SENDING'),
      failed: get('FAILED') + get('BOUNCED'),
    };

    return { ...serializeCampaign(campaign), applicationStats };
  }

  /**
   * Contrôle d'appartenance LÉGER : vérifie que la campagne existe et
   * appartient à l'utilisateur, sans charger les candidatures ni les
   * statistiques agrégées (contrairement à `getCampaignById`). Utilisé par les
   * mutations, qui n'ont besoin que de l'`id` et du `status`.
   */
  private async assertOwnership(userId: string, campaignId: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, userId: true, status: true },
    });
    if (!campaign || campaign.userId !== userId) {
      throw new NotFoundError('Campaign not found');
    }
    return campaign;
  }

  /**
   * Met à jour une campagne.
   * Une campagne ne peut être modifiée que tant qu'elle n'est pas lancée
   * (statut PENDING ou PAUSED uniquement).
   */
  async updateCampaign(userId: string, campaignId: string, data: UpdateCampaignInput) {
    const existing = await this.assertOwnership(userId, campaignId);

    if (existing.status !== 'PENDING' && existing.status !== 'PAUSED') {
      throw new BadRequestError('Cannot update campaign in current status');
    }

    const campaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        ...data,
        // Si le quota change, le budget est recalculé en conséquence.
        budget: data.applicationQuota
          ? data.applicationQuota * PRICE_PER_APPLICATION
          : undefined,
      },
    });
    return serializeCampaign(campaign);
  }

  /**
   * Supprime une campagne.
   * Seules les campagnes non engagées peuvent être supprimées (PENDING ou
   * FAILED) : on interdit la suppression d'une campagne en cours ou terminée.
   */
  async deleteCampaign(userId: string, campaignId: string) {
    const existing = await this.assertOwnership(userId, campaignId);

    if (existing.status !== 'PENDING' && existing.status !== 'FAILED') {
      throw new BadRequestError('Cannot delete a running or completed campaign');
    }

    // Suppression atomique : on retire d'abord les candidatures liées, sinon
    // la suppression de la campagne violerait la contrainte de clé étrangère.
    // (La cascade est aussi déclarée dans schema.prisma ; cette transaction
    // garantit le bon comportement même avant l'application de la migration.)
    await prisma.$transaction([
      prisma.application.deleteMany({ where: { campaignId } }),
      prisma.campaign.delete({ where: { id: campaignId } }),
    ]);
    return { success: true };
  }
}
