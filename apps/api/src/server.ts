import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import Fastify from 'fastify';
import { env } from './config/env';

// Initialisation Sentry (monitoring d'erreurs + performance).
// Activée uniquement si un DSN est fourni.
if (env.SENTRY_DSN) {
  // En production, on échantillonne à 10 % pour limiter le volume (et le coût)
  // de données envoyées à Sentry ; en dev/test on capture tout (100 %).
  const sampleRate = env.NODE_ENV === 'production' ? 0.1 : 1.0;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    integrations: [
      // nodeProfilingIntegration(), // Désactivé sous Windows (binaires manquants dans certains environnements)
    ],
    // Taux d'échantillonnage du tracing de performance.
    tracesSampleRate: sampleRate,
    // Taux d'échantillonnage du profiling (relatif à tracesSampleRate).
    profilesSampleRate: sampleRate,
  });
}

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import { errorHandler } from './middleware/error';
import { authRoutes } from './modules/auth/auth.routes';
import { userRoutes } from './modules/user/user.routes';
import { campaignRoutes } from './modules/campaign/campaign.routes';
import { stripeRoutes } from './modules/stripe/stripe.routes';
import { statsRoutes } from './modules/stats/stats.routes';
import { loggerOptions } from './lib/logger';
import rawBody from 'fastify-raw-body';
import { trackerRoutes } from './modules/tracker/tracker.routes';
import { invoiceRoutes } from './modules/invoice/invoice.routes';

/**
 * Rôle : Point d'entrée principal de l'API Fastify.
 *
 * `buildServer()` enregistre les plugins, le gestionnaire d'erreurs et les
 * modules de routes, puis renvoie l'instance. Le bloc en fin de fichier ne
 * démarre réellement le serveur que si ce fichier est exécuté directement.
 */

export const app = Fastify({
  logger: loggerOptions,
  // trustProxy : en production l'API est derrière un reverse proxy ; sans
  // cette option `request.ip` vaut l'IP du proxy → le rate limiting devient
  // global au lieu d'être par client. À restreindre à l'IP du proxy de
  // confiance dans un déploiement réel (`trustProxy: '10.0.0.0/8'`, etc.).
  trustProxy: true,
});

export async function buildServer() {
  // helmet : ajoute des en-têtes HTTP de sécurité (XSS, clickjacking, etc.).
  await app.register(helmet);

  // CORS : on autorise UNIQUEMENT les origines explicitement déclarées dans CORS_ORIGINS.
  // `credentials: true` (cookies/Authorization) interdit `origin: true` (qui réfléchit
  // n'importe quelle origine) : sinon n'importe quel site web pourrait émettre des
  // requêtes authentifiées vers l'API au nom de l'utilisateur.
  const allowedOrigins = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: (origin, cb) => {
      // Absence d'en-tête Origin = requête non navigateur (app mobile native, curl,
      // health check serveur à serveur) → autorisée.
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('Origin non autorisée par la politique CORS'), false);
    },
    credentials: true,
  });
  // Limite le débit de requêtes : 100 requêtes / 15 min par IP (anti-abus).
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '15 minutes',
  });
  // Lecture/écriture des cookies (utilisé pour le refresh token).
  await app.register(fastifyCookie);
  // JWT : signe et vérifie les access tokens, lus depuis l'en-tête
  // `Authorization: Bearer ...`. On ne configure PAS d'option `cookie` ici :
  // le cookie `refreshToken` ne contient pas un JWT mais un secret aléatoire,
  // le faire vérifier par `jwtVerify` n'aurait aucun sens.
  await app.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
  });
  // Upload de fichiers multipart (CV), plafonné à 5 Mo.
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // limite de 5 Mo
    },
  });

  // Route de santé : permet aux outils de monitoring de vérifier que l'API répond.
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // rawBody : expose le corps brut de la requête (non parsé). Indispensable
  // pour vérifier la signature des webhooks Stripe. `global: false` → activé
  // route par route via `config: { rawBody: true }`.
  app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  });

  // Gestionnaire d'erreurs global (cf. middleware/error.ts).
  app.setErrorHandler(errorHandler as any);

  // Enregistrement des modules de routes, chacun sous son préfixe d'URL.
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(userRoutes, { prefix: '/api' });
  app.register(campaignRoutes, { prefix: '/api/campaigns' });
  app.register(stripeRoutes, { prefix: '/api/stripe' });
  app.register(statsRoutes, { prefix: '/api/stats' });
  app.register(trackerRoutes, { prefix: '/api/tracker' });
  app.register(invoiceRoutes, { prefix: '/api/invoices' });

  return app;
}

// Démarrage du serveur uniquement si ce fichier est le point d'entrée
// (exécution directe ou via tsx) — pas lors d'un import (ex : dans les tests).
if (require.main === module || process.argv[1]?.includes('tsx')) {
  buildServer()
    .then((server) => {
      server.listen({ port: env.PORT, host: '0.0.0.0' }, (err, address) => {
        if (err) {
          server.log.error(err);
          process.exit(1);
        }
        // Confirmation de démarrage (utile en conteneur / CI).
        server.log.info(`API à l'écoute sur ${address}`);
      });
    })
    .catch((err) => {
      console.error('Error building server:', err);
      process.exit(1);
    });
}
