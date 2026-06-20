import { taskRunner } from '../lib/task-runner';
import { fetchInboxSince } from '../lib/imap';
import { getImap, getLastImapPollAt, setLastImapPollAt } from '../lib/secrets';
import { refreshCampaignStatus } from '../modules/campaign/campaign.service';
import { getProfile } from '../modules/profile/profile.service';
import {
  listSentForReplyMatching,
  markReplied,
  markBounced,
} from '../modules/application/application.service';
import { logger } from '../lib/logger';
import { matchReply, inboxKey, detectOptOutRequest } from './reply-matching';
import { addOptOut } from '../modules/optout/optout.service';

export function enqueuePollReplies(): void {
  if (!getImap()) return;

  taskRunner.enqueue({
    type: 'poll-replies',
    label: 'Recherche de réponses',
    dedup: true,
    run: async () => {
      const sent = await listSentForReplyMatching();
      if (sent.length === 0) return;

      const profile = await getProfile();
      const lastPoll = getLastImapPollAt();

      // BUG-H1 fix : accumulateur = Epoch (pas new Date()) pour trouver le vrai
      // minimum. Avec new Date(), si aucun sentAt n'est antérieur à "maintenant",
      // since = now et on rate toutes les réponses déjà reçues au 1er relevé.
      const earliestSent = sent.reduce<Date>(
        (min, a) => (a.sentAt && a.sentAt < min ? a.sentAt : min),
        new Date(0)
      );
      const since = lastPoll ?? earliestSent;

      const inbox = await fetchInboxSince(since);

      const usedInboxKeys = new Set<string>();
      const touchedCampaigns = new Set<string>();
      for (const app of sent) {
        const reply = inbox.find(
          (m) => !usedInboxKeys.has(inboxKey(m)) && matchReply(m, app, sent)
        );
        if (reply) {
          usedInboxKeys.add(inboxKey(reply));

          // AUTO-REPLY : une réponse automatique (absence du bureau) n'est PAS une
          // vraie réponse à qualifier. On la consomme (pour ne pas la rematcher) mais
          // on laisse la candidature en SENT — une vraie réponse pourra matcher ensuite.
          if (reply.isAutoReply) {
            logger.info(`[AUTO-REPLY] Réponse automatique ignorée de ${reply.from} (${app.company.name}).`);
            continue;
          }

          const MAX_REPLY_LENGTH = 50_000;
          const { marked } = await markReplied(app.id, reply.text.slice(0, MAX_REPLY_LENGTH));
          if (marked) {
            touchedCampaigns.add(app.campaignId);
            if (profile) {
              taskRunner.emitEvent('reply:received', {
                companyName: app.company.name,
                applicantName: `${profile.firstName} ${profile.lastName}`,
              });
            }

            // RGPD (option A) : si la réponse demande explicitement une
            // désinscription, on ajoute le contact à la liste « ne pas contacter »
            // pour qu'il ne reçoive plus aucune relance ni futur envoi.
            if (detectOptOutRequest(reply.text)) {
              try {
                await addOptOut(
                  app.company.contactEmail,
                  `Désinscription détectée dans une réponse (${app.company.name})`,
                );
                logger.info(`[RGPD] Opt-out auto : ${app.company.contactEmail} (désinscription détectée dans la réponse).`);
              } catch (err) {
                logger.warn('Impossible d\'ajouter le contact à la liste opt-out', err);
              }
            }
          }
        }
      }

      // BOUNCE-01 : détecter les NDR (Non-Delivery Reports) dans la boîte.
      // Un NDR = le serveur destinataire a rejeté l'email → on marque la candidature
      // comme rebondie et on notifie l'UI pour proposer un email alternatif.
      for (const msg of inbox) {
        if (!msg.isBounce || !msg.bouncedMessageId) continue;

        // Cherche la candidature correspondant au Message-ID qui a rebondi.
        const bouncedApp = sent.find(
          (a) =>
            a.messageId === msg.bouncedMessageId ||
            a.followUpMessageId === msg.bouncedMessageId
        );
        if (!bouncedApp) continue;

        const { marked } = await markBounced(bouncedApp.id);
        if (marked) {
          touchedCampaigns.add(bouncedApp.campaignId);
          // Vérifie si des alternatives existent pour notifier l'UI.
          const raw = bouncedApp.company as typeof bouncedApp.company & { emailAlternatives?: string };
          let hasAlternatives = false;
          try {
            const alts = JSON.parse(raw.emailAlternatives ?? '[]');
            hasAlternatives = Array.isArray(alts) && alts.length > 0;
          } catch { /* ignore */ }

          taskRunner.emitEvent('bounce:detected', {
            companyName: bouncedApp.company.name,
            nextEmailAvailable: hasAlternatives,
          });
          logger.info(`[BOUNCE] ${bouncedApp.company.name} — ${bouncedApp.company.contactEmail} a rebondi.`);
        }
      }

      for (const campaignId of touchedCampaigns) {
        await refreshCampaignStatus(campaignId);
      }

      try {
        await setLastImapPollAt(new Date());
      } catch (err) {
        logger.warn('Impossible d\'enregistrer la date du dernier relevé IMAP', err);
      }
    },
  });
}
