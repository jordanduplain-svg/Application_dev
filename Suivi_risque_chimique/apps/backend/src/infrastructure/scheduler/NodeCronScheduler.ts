import cron, { type ScheduledTask } from "node-cron";

import type { Scheduler, ScheduledJob } from "../../ports/Scheduler.js";

/**
 * Implémentation du port `Scheduler` avec node-cron (MVP).
 *
 * Garanties :
 *  - validation de l'expression cron au moment de `schedule` (un flow mal
 *    configuré échoue tôt et clairement, pas à 2 h du matin) ;
 *  - non-chevauchement : si une occurrence déborde sur la suivante, on saute
 *    l'occurrence en cours plutôt que de lancer deux imports en parallèle sur
 *    la même source (corruption d'historique évitée) ;
 *  - une erreur du handler est isolée et journalisée, jamais propagée au
 *    process (un import raté ne tue pas le serveur — brief §10).
 */
export class NodeCronScheduler implements Scheduler {
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly running = new Set<string>();
  private started = false;

  schedule(job: ScheduledJob): void {
    if (!cron.validate(job.cronExpression)) {
      throw new Error(
        `Expression cron invalide pour le flow ${job.id} : « ${job.cronExpression} ».`,
      );
    }
    // Remplacement idempotent : on retire un éventuel job existant de même id.
    this.unschedule(job.id);

    const task = cron.schedule(
      job.cronExpression,
      () => {
        void this.runGuarded(job);
      },
      { scheduled: this.started },
    );
    this.tasks.set(job.id, task);
  }

  private async runGuarded(job: ScheduledJob): Promise<void> {
    if (this.running.has(job.id)) {
      // eslint-disable-next-line no-console
      console.warn(`[scheduler] flow ${job.id} encore en cours — occurrence sautée.`);
      return;
    }
    this.running.add(job.id);
    try {
      await job.handler();
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`[scheduler] échec du flow ${job.id} :`, err);
    } finally {
      this.running.delete(job.id);
    }
  }

  unschedule(jobId: string): void {
    const task = this.tasks.get(jobId);
    if (task !== undefined) {
      task.stop();
      this.tasks.delete(jobId);
    }
  }

  start(): void {
    this.started = true;
    for (const task of this.tasks.values()) task.start();
  }

  stop(): void {
    this.started = false;
    for (const task of this.tasks.values()) task.stop();
  }
}
