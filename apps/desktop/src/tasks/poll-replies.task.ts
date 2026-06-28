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
import { matchReply, inboxKey, detectOptOutRequest, pollSinceDate, stripQuotedReply } from './reply-matching';
import { addOptOut } from '../modules/optout/optout.service';

/**
 * enqueuePollReplies — ROUAGE de la détection des réponses. Relie la boîte mail (IMAP) au
 * suivi des candidatures, en 3 temps :
 *   1. fenêtre de relevé : `pollSinceDate` (depuis le dernier relevé, sinon le plus ancien
 *      envoi borné à 60 j → jamais un scan complet de la boîte) ;
 *   2. APPARIEMENT (le cœur) : pour chaque candidature envoyée, on cherche dans l'inbox un
 *      message qui matche (`matchReply`) ET pas déjà consommé (`usedInboxKeys`) ;
 *   3. effets : markReplied (idempotent), notif, et opt-out RGPD auto si la réponse demande
 *      une désinscription (sur le texte DÉ-CITÉ pour ne pas réagir à un footer marketing).
 * `dedup:true` : une seule passe de polling à la fois (le timer ne se chevauche pas).
 * Les NDR (bounces) sont traités à part, par Message-ID rebondi.
 */
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

      // Depuis quand relever : dernier relevé, sinon le plus ancien envoi borné à
      // 60 j (jamais 1970 → sinon scan complet de la boîte → timeout mailbox).
      const sentMs = sent
        .map((a) => a.sentAt?.getTime())
        .filter((t): t is number => typeof t === 'number');
      const since = pollSinceDate(sentMs, lastPoll ? lastPoll.getTime() : null, Date.now());

      const inbox = await fetchInboxSince(since);

      const usedInboxKeys = new Set<string>();
      const touchedCampaigns = new Set<string>();
      for (const app of sent) {
        // ← ROUAGE : on cherche LE message inbox qui répond à cette candidature, en
        //   excluant ceux déjà attribués (usedInboxKeys) pour qu'un même email ne soit
        //   pas compté pour deux candidatures. matchReply tranche (Message-ID > email > domaine).
        // BUG-1 fix : on EXCLUT les auto-replies du matching (`!m.isAutoReply`). Avant, un
        // accusé automatique matchait en premier (UID plus ancien), « consommait » le créneau
        // de la candidature puis `continue` → la VRAIE réponse ultérieure, partageant souvent
        // le même In-Reply-To (donc le même inboxKey) ou le même expéditeur, était masquée à
        // CHAQUE relevé. En les écartant ici, ils ne prennent plus la place d'une vraie réponse.
        const reply = inbox.find(
          (m) => !m.isAutoReply && !usedInboxKeys.has(inboxKey(m)) && matchReply(m, app, sent)
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

            // RGPD (option A) : si la réponse demande explicitement une
            // désinscription, on ajoute le contact à la liste « ne pas contacter »
            // pour qu'il ne reçoive plus aucune relance ni futur envoi.
            // B2 : on détecte sur le VRAI message (sans le thread cité ni nos propres
            // emails recopiés dessous) — sinon un footer marketing standard
            // (« pour vous désinscrire… ») d'un recruteur intéressé le blackliste à tort.
            if (detectOptOutRequest(stripQuotedReply(reply.text))) {
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
