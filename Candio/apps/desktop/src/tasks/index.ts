import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getImapPollInterval } from '../lib/secrets';
import { enqueuePollReplies } from './poll-replies.task';

/**
 * Orchestration des tâches de fond : reprise au démarrage et relevé IMAP
 * périodique. Les fonctions d'enfilement (enqueueCvParse, enqueueGeneration,
 * enqueueSend…) sont appelées directement par les handlers IPC.
 */

let pollTimer: NodeJS.Timeout | null = null;

/**
 * UX-11 : démarre le relevé IMAP périodique. L'intervalle est lu depuis les
 * secrets à chaque démarrage (configurable dans les Réglages).
 */
export function startReplyPolling(): void {
  if (pollTimer) return;
  // UX-11 : intervalle configurable (défaut 10 min).
  const intervalMs = getImapPollInterval() * 60_000;
  enqueuePollReplies();
  pollTimer = setInterval(enqueuePollReplies, intervalMs);
}

export function stopReplyPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/**
 * UX-2v2 : hot-reload de l'intervalle sans redémarrer l'app.
 * Arrête le timer existant et en crée un nouveau avec l'intervalle courant.
 */
export function restartReplyPolling(): void {
  stopReplyPolling();
  startReplyPolling();
}

/**
 * Reprise au démarrage. La file de tâches n'est pas persistée : la base est la
 * seule source de vérité. Une candidature restée « SENDING » signifie que
 * l'app s'est fermée pendant un envoi.
 *
 * FM3 : si le messageId est provisoire (commence par "provisional-"), l'email
 * n'est pas parti — on peut marquer FAILED sans risque de doublon.
 * Si le messageId est réel (non provisoire), l'email est peut-être parti —
 * on avertit l'utilisateur de vérifier avant de renvoyer.
 */
export async function resumePendingWork(): Promise<void> {
  const sending = await prisma.application.findMany({
    where: { status: 'SENDING' },
    select: { id: true, messageId: true },
  });

  if (sending.length === 0) return;

  for (const app of sending) {
    const isProvisional = !app.messageId || app.messageId.startsWith('provisional-');
    await prisma.application.update({
      where: { id: app.id },
      data: {
        status: 'FAILED',
        errorMessage: isProvisional
          ? 'Envoi interrompu (app fermée) — à renvoyer manuellement'
          // FM3 : messageId réel présent — l'email est peut-être parti, avertir l'utilisateur.
          : 'Envoi peut-être effectué — vérifiez auprès du destinataire avant de renvoyer',
      },
    });
  }

  logger.warn(`${sending.length} envoi(s) interrompu(s) — marqué(s) à renvoyer.`);
}
