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
 * éligibles (SENT depuis +7 j, sans réponse ni relance), bornée au quota d'envoi
 * RESTANT du jour pour ne pas dépasser le plafond anti-suspension Gmail.
 *
 * Tout passe par enqueueFollowUp → mêmes garde-fous que la relance manuelle
 * (opt-out RGPD, quota, throttle 8 s, claim atomique anti-doublon).
 */

let task: ScheduledTask | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

/** Exécute une passe de relance automatique. Renvoie le nombre enfilé. No-op si désactivé. */
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
  // Tous les jours à 09:00 (heure locale de la machine).
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
