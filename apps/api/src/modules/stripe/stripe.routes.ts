import { FastifyInstance } from 'fastify';
import { StripeService } from './stripe.service';
import { authGuard } from '../../middleware/authGuard';
import { z } from 'zod';

/**
 * Rôle : Routes liées au paiement des campagnes (MOCKÉ — voir stripe.service.ts).
 */
export async function stripeRoutes(app: FastifyInstance) {
  const stripeService = new StripeService();

  // Crée la "session de paiement" (mockée) pour une campagne donnée.
  // Route protégée : seul un utilisateur authentifié peut payer.
  app.post('/checkout/:campaignId', { preHandler: [authGuard] }, async (request, reply) => {
    const { campaignId } = z.object({ campaignId: z.string().cuid() }).parse(request.params);
    const session = await stripeService.createCheckoutSession(request.user.sub, campaignId);
    return reply.send(session);
  });

  // Endpoint webhook Stripe. Conservé pour l'implémentation réelle future :
  // en mode démo il n'est appelé par personne (handleWebhook est un no-op).
  // `rawBody: true` est requis pour pouvoir vérifier la signature Stripe.
  app.post('/webhook', { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers['stripe-signature'];

    if (!signature || typeof signature !== 'string') {
      return reply.status(400).send({ error: 'Missing stripe signature' });
    }

    const rawBody = (request as any).rawBody;

    if (!rawBody) {
      return reply.status(400).send({ error: 'Missing raw body. Ensure fastify-raw-body is registered.' });
    }

    try {
      const result = await stripeService.handleWebhook(signature, rawBody);
      return reply.send(result);
    } catch (err: any) {
      request.log.error(err);
      return reply.status(400).send({ error: err.message });
    }
  });
}
