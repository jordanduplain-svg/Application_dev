import { prisma } from './prisma';
import { issueRefundForCampaign } from './billing';

/**
 * Rôle : Helpers de transition de statut des campagnes, partagés par les workers.
 */

/**
 * Marque une campagne comme COMPLETED s'il ne reste plus aucune candidature
 * en cours de traitement (PENDING/SENDING).
 *
 * `updateMany` filtré sur `status: 'RUNNING'` rend l'opération idempotente :
 * une campagne déjà terminée (COMPLETED/FAILED) n'est jamais re-modifiée.
 *
 * Au moment où la campagne devient COMPLETED, on déclenche un éventuel
 * remboursement au prorata des candidatures non livrées (A3).
 */
export async function maybeCompleteCampaign(campaignId: string) {
  const stillProcessing = await prisma.application.count({
    where: { campaignId, status: { in: ['PENDING', 'SENDING'] } },
  });
  if (stillProcessing === 0) {
    const { count } = await prisma.campaign.updateMany({
      where: { id: campaignId, status: 'RUNNING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    // `count > 0` ⇒ c'est CET appel qui a fait la transition vers COMPLETED :
    // on n'émet le remboursement qu'une fois (issueRefundForCampaign est en
    // plus idempotente).
    if (count > 0) {
      await issueRefundForCampaign(campaignId);
    }
  }
}
