import { FastifyLoggerOptions } from 'fastify';
import pino from 'pino';

/**
 * Rôle : Configuration du logger Fastify (basé sur Pino).
 *
 * `pino-pretty` formate les logs de façon lisible en console (couleurs,
 * horodatage). En production, on préférerait du JSON brut pour l'ingestion
 * par un agrégateur de logs.
 */
export const loggerOptions: FastifyLoggerOptions = {
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname', // champs superflus en développement
    },
  },
} as any;

/**
 * Logger autonome (hors contexte de requête Fastify).
 * À utiliser dans les services et workers qui n'ont pas accès à `request.log`
 * (ex : NotificationService, StripeService) — pour des logs structurés
 * cohérents au lieu de `console.log`.
 */
export const logger = pino(loggerOptions as any);
