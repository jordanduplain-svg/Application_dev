import cron, { type ScheduledTask } from 'node-cron';
import { getAutoFollowUpEnabled, getDailySendLimit, getDailySendCount } from '../lib/secrets';
import { listFollowUpEligibleIds } from '../modules/application/application.service';
import { enqueueFollowUp } from './send-followup.task';
import { logger } from '../lib/logger';

/**
 * Scheduler d'automatisation (node-cron).
 *
 * Pour l'instant : relance automatique quotidienne. Chaque jour (et au démarrage
 * de l'app), si l'option est activée, on enfile une relance pour les candidatures
 * éligibles (SENT depuis +10 j, sans réponse ni relance), bornée au quota d'envoi
 * RESTANT du jour pour ne pas dépasser le plafond anti-suspension Gmail.
 *
 * Tout passe par enqueueFollowUp → mêmes garde-fous que la relance manuelle
 * (opt-out RGPD, quota, throttle 8 s, claim atomique anti-doublon).
 */

let task: ScheduledTask | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * runAutoFollowUps — ROUAGE de l'automatisation des relances. Le rouage tient en 2 idées :
 *   • on calcule le quota RESTANT du jour, et on ne demande QUE ce nombre d'éligibles
 *     (`listFollowUpEligibleIds(remaining)`) → impossible de dépasser le plafond Gmail ;
 *   • on ne fait qu'ENFILER (`enqueueFollowUp`) : tous les garde-fous réels (opt-out, claim
 *     atomique, quota, throttle 8 s) sont DANS la tâche → une relance auto suit exactement
 *     le même chemin sûr qu'une relance manuelle. Cette fonction n'est qu'un déclencheur.
 * Appelée par le cron 09:00 ET par la passe de rattrapage au démarrage (cf. startScheduler).
 */
export async function runAutoFollowUps(): Promise<number> {
  if (!getAutoFollowUpEnabled()) return 0;
  const remaining = Math.max(0, getDailySendLimit() - getDailySendCount().count);
  if (remaining === 0) {
    logger.info('[scheduler] Relance auto : plafond du jour déjà atteint, rien à faire.');
    return 0;
  }
  const ids = await listFollowUpEligibleIds(remaining);
  for (const id of ids) await enqueueFollowUp(id);
  if (ids.length > 0) logger.info(`[scheduler] Relance auto : ${ids.length} candidature(s) enfilée(s).`);
  return ids.length;
}

/**
 * Démarre la planification quotidienne (09:00 locale) + une passe de rattrapage
 * peu après le démarrage (pour l'utilisateur qui ouvre l'app le matin).
 * Idempotent : un second appel remplace la tâche existante.
 */
export function startScheduler(): void {
  stopScheduler();
  // ← ROUAGE de la planification : node-cron déclenche la passe chaque jour à 09:00 (heure
  //   locale). LIMITE assumée : c'est un timer EN PROCESS → rien ne tourne si l'app est
  //   fermée. Le filet, c'est le `startupTimer` ci-dessous (rattrapage 30 s après le boot)
  //   couplé à l'option « lancer au démarrage » → l'app s'ouvre, la passe se fait.
  task = cron.schedule('0 9 * * *', () => {
    void runAutoFollowUps().catch((err) => logger.warn('[scheduler] Échec de la relance auto planifiée', err));
  });
  // Rattrapage au démarrage (différé de 30 s pour ne pas alourdir le boot).
  // Handle conservé pour pouvoir l'annuler à la fermeture (sinon il se déclenche
  // après prisma.$disconnect() → requête sur une base déconnectée).
  startupTimer = setTimeout(() => {
    startupTimer = null;
    void runAutoFollowUps().catch((err) => logger.warn('[scheduler] Échec de la relance auto au démarrage', err));
  }, 30_000);
}

export function stopScheduler(): void {
  if (task) {
    task.stop();
    task = null;
  }
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
}
