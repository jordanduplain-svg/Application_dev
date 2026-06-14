import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

/**
 * Rôle : Déclaration des files d'attente BullMQ (back-end Redis).
 *
 * Le traitement d'une candidature suit ce pipeline asynchrone :
 *   scrape-company  →  generate-email  →  send-email
 * Le parsing de CV (cv-parsing) est une file indépendante.
 */

// Connexion Redis partagée par les producteurs de jobs.
// `maxRetriesPerRequest: null` est imposé par BullMQ.
const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Rétention des jobs : sans cela, BullMQ conserve INDÉFINIMENT les jobs
// terminés et échoués dans Redis → la mémoire croît sans limite. On borne :
//  - terminés : gardés 24 h, et au plus 1000 (le plus récent prime) ;
//  - échoués  : gardés 7 j (utile au diagnostic).
const defaultJobOptions = {
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 604_800 },
};

// File : analyse du CV uploadé (extraction du texte + parsing IA).
export const cvParsingQueue = new Queue('cv-parsing', { connection: connection as any, defaultJobOptions });
// File : recherche des entreprises / contacts cibles d'une campagne.
export const scrapeQueue = new Queue('scrape-company', { connection: connection as any, defaultJobOptions });
// File : génération de l'email de candidature par l'IA.
export const emailGeneratorQueue = new Queue('generate-email', { connection: connection as any, defaultJobOptions });
// File : envoi SMTP effectif de l'email (avec throttling anti-spam).
export const smtpSenderQueue = new Queue('send-email', { connection: connection as any, defaultJobOptions });
