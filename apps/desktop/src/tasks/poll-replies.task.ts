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
import { matchReply, inboxKey } from './reply-matching';

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
