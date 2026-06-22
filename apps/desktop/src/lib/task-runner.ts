import type { TaskProgress, IpcEventChannel, IpcEvents } from '@candio/shared';
import { logger } from './logger';

/**
 * Task-runner en mémoire — remplace Redis/BullMQ.
 *
 * File FIFO avec limite de concurrence (CONCURRENCY=2) et réessais exponentiels.
 * La file n'est PAS persistée ; la base reste la source de vérité (cf. resumePendingWork).
 */

type ProgressListener = (progress: TaskProgress) => void;
type EventListener<T extends IpcEventChannel> = (data: IpcEvents[T]) => void;

interface Task {
  type: TaskProgress['type'];
  label: string;
  run: () => Promise<void>;
  /** H5 : si true, une seule instance de ce type peut être en file/active simultanément. */
  dedup?: boolean;
}

const MAX_ATTEMPTS = 3;
const CONCURRENCY = 2;

/**
 * FM10 : erreurs permanentes — ne pas gaspiller les tentatives de réessai.
 * Ces erreurs ne sont pas récupérables par un simple retry.
 * Exportée pour les tests unitaires.
 */
export function isPermanentError(err: unknown): boolean {
  const e = err as { status?: number; code?: string } | null;
  // OpenAI 401 (clé invalide) ou 400 (requête malformée).
  if (e?.status === 401 || e?.status === 400) return true;
  // Erreur d'authentification SMTP.
  if (e?.code === 'EAUTH') return true;
  // Prisma : enregistrement introuvable (P2025).
  if ((err as { code?: string } | null)?.code === 'P2025') return true;
  return false;
}

/** Exportée pour instanciation dans les tests unitaires (isolation par test). */
export class TaskRunner {
  private queue: Task[] = [];
  private active = 0;
  // AUDIT-H3 fix : compte les tâches actives par type pour getQueueLength(type).
  private activeByType = new Map<string, number>();
  private listeners: ProgressListener[] = [];
  private eventListeners: Map<IpcEventChannel, EventListener<any>[]> = new Map();
  // H5 : types de tâches dedup en file ou en exécution.
  private dedupTypes = new Set<string>();

  // F2 : renvoie une fonction de désabonnement pour éviter les doublons de
  // listeners si wireTaskProgress() est jamais rappelé (reload, tests…).
  onProgress(listener: ProgressListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  on<T extends IpcEventChannel>(channel: T, listener: EventListener<T>): () => void {
    if (!this.eventListeners.has(channel)) this.eventListeners.set(channel, []);
    this.eventListeners.get(channel)!.push(listener);
    return () => {
      const arr = this.eventListeners.get(channel);
      if (arr) this.eventListeners.set(channel, arr.filter((l) => l !== listener));
    };
  }

  emitEvent<T extends IpcEventChannel>(channel: T, data: IpcEvents[T]): void {
    for (const l of this.eventListeners.get(channel) || []) l(data);
  }

  private emit(progress: TaskProgress): void {
    for (const l of this.listeners) l(progress);
  }

  enqueue(task: Task): void {
    // H5 : dédup — ignore si une tâche du même type est déjà en file ou active.
    if (task.dedup && this.dedupTypes.has(task.type)) return;
    if (task.dedup) this.dedupTypes.add(task.type);
    this.queue.push(task);
    this.pump();
  }

  /** UX-S7 : annule les tâches en attente du type donné (pas les actives). */
  cancelType(type: string): number {
    const before = this.queue.length;
    // BUG-03 : nettoyer dedupTypes pour les tâches annulées, sinon le type
    // reste bloqué et ne peut plus être enfilé jusqu'au redémarrage.
    const cancelled = this.queue.filter((t) => t.type === type);
    this.queue = this.queue.filter((t) => t.type !== type);
    for (const t of cancelled) {
      if (t.dedup) this.dedupTypes.delete(t.type);
    }
    return before - this.queue.length;
  }

  /** UX-S7 : retourne le nombre de tâches en file et actives, filtré par type si fourni. */
  getQueueLength(type?: string): { queued: number; active: number } {
    if (type) {
      const queued = this.queue.filter((t) => t.type === type).length;
      // AUDIT-H3 fix : utiliser activeByType pour un count exact par type.
      return { queued, active: this.activeByType.get(type) ?? 0 };
    }
    return { queued: this.queue.length, active: this.active };
  }

  /**
   * pump — ROUAGE du moteur de file. C'est la boucle qui « tire » des tâches de la file
   * tant qu'il reste un slot libre (active < CONCURRENCY). Appelée à chaque enqueue ET à
   * chaque fin de tâche (le `.finally` ci-dessous) → l'exécution se relance toute seule en
   * cascade jusqu'à vider la file ou saturer les slots. Sans ce rappel en cascade, une
   * tâche enfilée pendant que les slots sont pleins ne démarrerait jamais.
   */
  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.active++;
      // AUDIT-H3 fix : incrémenter le compteur par type.
      this.activeByType.set(task.type, (this.activeByType.get(task.type) ?? 0) + 1);
      this.execute(task).finally(() => {
        this.active--;
        // AUDIT-H3 fix : décrémenter le compteur par type.
        const prev = this.activeByType.get(task.type) ?? 1;
        if (prev <= 1) this.activeByType.delete(task.type);
        else this.activeByType.set(task.type, prev - 1);
        if (task.dedup) this.dedupTypes.delete(task.type);
        this.pump();
      });
    }
  }

  /**
   * execute — ROUAGE de la fiabilité : exécute une tâche avec réessais. La ligne qui
   * fait le travail réel est `await task.run()` ; tout le reste est de la résilience —
   * back-off exponentiel (2 s × n° d'essai) entre les tentatives, abandon immédiat sur
   * erreur PERMANENTE (clé invalide, 400…) pour ne pas gaspiller 3 essais, et libération
   * du slot PENDANT le back-off pour ne pas geler les autres tâches.
   */
  private async execute(task: Task): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        this.emit({ type: task.type, status: 'running', message: task.label });
        await task.run();   // ← le travail réel (envoi, génération IA, polling…)
        this.emit({ type: task.type, status: 'done', message: task.label });
        return;
      } catch (err) {
        logger.error(`Tâche ${task.type} — échec (essai ${attempt}/${MAX_ATTEMPTS})`, err);
        // FM10 : erreur permanente → pas de retry inutile.
        if (isPermanentError(err) || attempt === MAX_ATTEMPTS) {
          this.emit({ type: task.type, status: 'failed', message: `${task.label} — échec` });
          return;
        }

        // M3 : libérer le slot pendant le backoff pour ne pas bloquer les autres tâches.
        this.active--;
        // AUDIT-H3 fix : décrémenter aussi par type pendant le backoff.
        const prevBackoff = this.activeByType.get(task.type) ?? 1;
        if (prevBackoff <= 1) this.activeByType.delete(task.type);
        else this.activeByType.set(task.type, prevBackoff - 1);
        this.pump();
        await new Promise<void>((resolve) => setTimeout(resolve, 2000 * attempt));

        // H2 : attendre qu'un slot soit réellement disponible avant de re-prendre le slot.
        // Sans cette attente, active++ après le sleep peut dépasser CONCURRENCY si pump()
        // a rempli tous les slots pendant le backoff.
        while (this.active >= CONCURRENCY) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }
        this.active++;
        // AUDIT-H3 fix : réincrémenter par type quand on reprend le slot.
        this.activeByType.set(task.type, (this.activeByType.get(task.type) ?? 0) + 1);
      }
    }
  }
}

export const taskRunner = new TaskRunner();
