import { prisma } from './prisma';
import { logger } from './logger';
import { PRICE_PER_APPLICATION } from '@candio/shared';
import { NotificationService } from '../services/notification.service';

/**
 * Rôle : Facturation (A2) et remboursements (A3).
 *
 * ⚠️ Cohérent avec le mode démo de Stripe : aucune transaction bancaire réelle
 * n'est effectuée. Les factures (`Invoice`) et avoirs sont des enregistrements
 * comptables internes. Lorsqu'un vrai Stripe sera branché (I2), c'est ici
 * qu'il faudra appeler `stripe.refunds.create()` en plus de créer l'avoir.
 */

/**
 * Génère un numéro de facture lisible et unique : `KJ-AAAA-NNNNNN`.
 *
 * ⚠️ Basé sur un `count()` : suffisant en démo, mais une vraie facturation
 * exige une séquence atomique (numérotation continue, sans trou, garantie même
 * en cas d'accès concurrents).
 */
async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count();
  return `KJ-${year}-${String(count + 1).padStart(6, '0')}`;
}

/**
 * Exécute une opération de création de facture en réessayant si le numéro
 * généré entre en collision (deux factures créées en parallèle peuvent obtenir
 * le même `count` → même numéro → violation de la contrainte `@unique`, P2002).
 */
async function withInvoiceNumberRetry<T>(op: (invoiceNumber: string) => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await op(await generateInvoiceNumber());
    } catch (err: any) {
      // P2002 = violation d'unicité. On retente avec un numéro recalculé,
      // sauf à la dernière tentative où l'on laisse l'erreur remonter.
      if (err?.code === 'P2002' && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
  // Inatteignable, mais satisfait l'analyse de flux de TypeScript.
  throw new Error('Génération du numéro de facture impossible');
}

/**
 * Crée une facture d'achat (type CHARGE) pour une campagne payée (A2).
 * Appelée lors de la validation du paiement (cf. stripe.service.ts).
 */
export async function createChargeInvoice(
  userId: string,
  campaignId: string,
  amount: number,
  description: string
) {
  return withInvoiceNumberRetry((number) =>
    prisma.invoice.create({
      data: {
        userId,
        campaignId,
        number,
        type: 'CHARGE',
        amount,
        description,
        status: 'PAID',
      },
    })
  );
}

/**
 * Émet un remboursement (A3) pour les candidatures NON livrées d'une campagne
 * arrivée à un état terminal (FAILED ou COMPLETED).
 *
 * Règle : on rembourse `prix unitaire × (quota − candidatures réellement
 * envoyées)`. Une campagne dont le scraping a totalement échoué (0 candidature
 * envoyée) est donc intégralement remboursée ; une campagne où 3 envois sur 50
 * ont échoué donne lieu à un avoir de 3 × 2 €.
 *
 * Idempotent : si la campagne a déjà été remboursée (`refundedAt`), on ne fait
 * rien — la fonction peut donc être appelée sans risque depuis plusieurs
 * chemins (échec scraper, complétion de campagne).
 */
export async function issueRefundForCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  // Déjà remboursée → rien à faire (idempotence).
  if (campaign.refundedAt) return;

  // Candidatures réellement parvenues au destinataire.
  const delivered = await prisma.application.count({
    where: { campaignId, status: { in: ['SENT', 'OPENED', 'REPLIED'] } },
  });

  const refundableCount = Math.max(0, campaign.applicationQuota - delivered);
  if (refundableCount === 0) return; // Tout a été livré : pas de remboursement.

  const refundAmount = refundableCount * PRICE_PER_APPLICATION;

  // Transaction : on marque la campagne ET on crée l'avoir de façon atomique,
  // pour ne jamais avoir un `refundedAt` sans facture correspondante.
  // En cas de collision de numéro de facture, toute la transaction est rejouée
  // (atomicité → le `campaign.update` est aussi annulé puis refait proprement).
  await withInvoiceNumberRetry((number) =>
    prisma.$transaction([
      prisma.campaign.update({
        where: { id: campaignId },
        data: { refundedAt: new Date(), refundAmount },
      }),
      prisma.invoice.create({
        data: {
          userId: campaign.userId,
          campaignId,
          number,
          type: 'REFUND',
          amount: refundAmount,
          description: `Avoir — ${refundableCount} candidature(s) non livrée(s) sur la campagne « ${campaign.name} »`,
          status: 'REFUNDED',
        },
      }),
    ])
  );

  logger.info(
    { campaignId, refundAmount, refundableCount },
    '[Billing] Remboursement émis pour campagne'
  );

  // Notification (best effort — n'interrompt jamais le flux).
  await NotificationService.sendPushNotification(
    campaign.userId,
    '💶 Remboursement émis',
    `${refundableCount} candidature(s) non envoyée(s) sur « ${campaign.name} » : un avoir de ${refundAmount.toFixed(2)} € a été crédité.`
  );
}
