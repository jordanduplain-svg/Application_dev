import { prisma } from '../../lib/prisma';
import { NotFoundError, BadRequestError } from '../../middleware/error';
import { NotificationService } from '../../services/notification.service';
import { scrapeQueue } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { createChargeInvoice } from '../../lib/billing';

/**
 * Rôle : Gestion (MOCKÉE) du paiement des campagnes.
 *
 * ⚠️ Mode DÉMO : aucun appel réel à l'API Stripe n'est effectué.
 * - `createCheckoutSession` simule un paiement immédiatement réussi : la
 *   campagne passe directement en statut PAID.
 * - `handleWebhook` est un simple accusé de réception (aucun webhook Stripe
 *   réel n'est émis en mode démo).
 *
 * Pour activer les paiements réels, il faudrait :
 *  1. créer une vraie Checkout Session via `stripe.checkout.sessions.create()`
 *     en y attachant `metadata: { campaignId, userId }` ;
 *  2. déplacer le passage en PAID dans `handleWebhook`, déclenché par
 *     l'événement `checkout.session.completed` (cf. lib/stripe.ts).
 */
export class StripeService {
  /**
   * Simule l'achat d'une campagne, puis DÉCLENCHE le pipeline de candidatures.
   * Vérifie l'appartenance et l'éligibilité de la campagne, la passe en
   * RUNNING, enquête le job de scraping, notifie l'utilisateur, et renvoie le
   * deep link de succès que l'app mobile ouvrira.
   */
  async createCheckoutSession(userId: string, campaignId: string) {
    // Contrôle d'appartenance : on empêche un utilisateur de payer/activer
    // la campagne d'un autre compte. On renvoie 404 (et non 403) pour ne pas
    // révéler l'existence de la ressource.
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.userId !== userId) {
      throw new NotFoundError('Campaign not found');
    }

    // Idempotence : seule une campagne EN ATTENTE de paiement peut être payée.
    // Évite de re-déclencher le pipeline (et de re-notifier) sur une campagne
    // déjà active ou terminée.
    if (campaign.status !== 'PENDING') {
      throw new BadRequestError('Cette campagne a déjà été payée');
    }

    // MOCK : paiement considéré comme instantanément validé. La campagne passe
    // directement en RUNNING (en production, ce serait le webhook Stripe).
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'RUNNING',
        stripePaymentId: `mock_pi_${Date.now()}`,
        startedAt: new Date(),
      },
    });

    // Facture d'achat (A2) : trace comptable du paiement, consultable par
    // l'utilisateur dans son historique de facturation.
    // Non bloquant : un échec de génération de facture ne doit pas annuler un
    // paiement déjà validé (la campagne est déjà passée en RUNNING).
    try {
      await createChargeInvoice(
        userId,
        campaignId,
        Number(campaign.budget),
        `Campagne « ${campaign.name} » — ${campaign.applicationQuota} candidatures`
      );
    } catch (err) {
      logger.error({ err, campaignId }, '[Stripe MOCK] Échec de génération de la facture');
    }

    // Déclenchement du pipeline asynchrone : on enquête le job de scraping.
    // C'est ce job qui, via les workers, recherchera les entreprises, générera
    // puis enverra les emails de candidature.
    // `attempts` + backoff : le scraping peut échouer temporairement (rate
    // limit) ; BullMQ le réessaie. Après épuisement, le worker marque la
    // campagne FAILED (cf. scraper.worker.ts).
    await scrapeQueue.add(
      'scrape-company',
      { campaignId, query: campaign.prompt },
      { attempts: 3, backoff: { type: 'exponential', delay: 15000 } }
    );

    // Notification push : on informe l'utilisateur que sa campagne démarre.
    await NotificationService.sendPushNotification(
      userId,
      '🚀 Campagne activée !',
      `Votre campagne "${campaign.name}" a été payée et va démarrer.`
    );

    // Deep link renvoyé à l'app mobile pour afficher l'écran de succès.
    return {
      url: `mobile://(tabs)/campaigns?success=true&session_id=mock_session_${campaign.id}`,
    };
  }

  /**
   * MOCK : en mode démo, Stripe n'émet aucun webhook. Cette méthode se
   * contente donc d'accuser réception. L'activation de la campagne est
   * réalisée directement dans `createCheckoutSession`.
   */
  async handleWebhook(_signature: string, _rawBody: string | Buffer) {
    logger.info('[Stripe MOCK] Webhook reçu — ignoré en mode démo');
    return { received: true };
  }
}
