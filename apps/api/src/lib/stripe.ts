import Stripe from 'stripe';
import { env } from '../config/env';

/**
 * Rôle : Client Stripe officiel.
 *
 * ⚠️ Conservé pour l'implémentation RÉELLE des paiements. En mode démo,
 * StripeService (stripe.service.ts) n'utilise pas ce client : le paiement
 * y est entièrement simulé.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  // Version d'API figée. Le cast `as any` évite un faux conflit de types
  // entre la chaîne de version et les types fournis par le SDK.
  apiVersion: '2025-01-27.acacia' as any,
});
