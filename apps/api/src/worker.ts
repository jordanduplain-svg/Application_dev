/**
 * Rôle : Point d'entrée des workers BullMQ.
 *
 * Un `new Worker(...)` ne démarre que si son module est importé. On importe
 * donc les workers (ce qui les instancie), et ce fichier doit être lancé comme
 * un process distinct. Sans lui, les jobs s'empilent dans Redis sans jamais
 * être traités.
 */
import { cvParserWorker } from './workers/cv-parser.worker';
import { scraperWorker } from './workers/scraper.worker';
import { emailGeneratorWorker } from './workers/email-generator.worker';
import { smtpSenderWorker } from './workers/smtp-sender.worker';
import { env } from './config/env';
import { logger } from './lib/logger';

const workers = [cvParserWorker, scraperWorker, emailGeneratorWorker, smtpSenderWorker];

/**
 * Arrêt gracieux (#7) : à la réception d'un signal d'arrêt (déploiement,
 * Ctrl+C), on ferme proprement les workers. `Worker.close()` attend la fin des
 * jobs ACTIFS avant de couper la connexion — un envoi en cours n'est donc pas
 * interrompu brutalement (ce qui aurait pu, via le mécanisme « stalled » de
 * BullMQ, provoquer une ré-exécution).
 */
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return; // évite un double arrêt si plusieurs signaux arrivent
  shuttingDown = true;
  logger.info({ signal }, '[Workers] Arrêt gracieux en cours...');
  await Promise.allSettled(workers.map((w) => w.close()));
  logger.info('[Workers] Arrêtés proprement.');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

logger.info(`[Workers] Démarrés et à l'écoute des files (Redis: ${env.REDIS_URL})`);
