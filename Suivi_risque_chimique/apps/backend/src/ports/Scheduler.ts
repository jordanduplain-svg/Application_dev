/**
 * Port `Scheduler` — déclencheurs planifiés (brief §10).
 *
 * MVP : `NodeCronScheduler`. Le port permet de basculer vers une file de jobs
 * (BullMQ + Redis) pour la robustesse en prod (retry, multi-worker,
 * observabilité) sans toucher aux flows ni aux cas d'usage.
 *
 * Un job = une expression cron + un handler asynchrone. Le scheduler garantit
 * qu'une même occurrence ne se chevauche pas avec elle-même (un import nocturne
 * qui déborde ne doit pas être relancé en parallèle).
 */
export interface ScheduledJob {
  id: string;
  cronExpression: string;
  handler: () => Promise<void>;
}

export interface Scheduler {
  /** Enregistre (ou remplace) un job planifié. */
  schedule(job: ScheduledJob): void;
  /** Retire un job planifié. */
  unschedule(jobId: string): void;
  /** Démarre tous les jobs enregistrés. */
  start(): void;
  /** Arrête proprement tous les jobs (arrêt du serveur). */
  stop(): void;
}
