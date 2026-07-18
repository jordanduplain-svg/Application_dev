import { taskRunner } from '../lib/task-runner';
import { fetchInboxSince } from '../lib/imap';
import { getImap, getLastImapPollAt, setLastImapPollAt } from '../lib/secrets';
import { refreshCampaignStatus } from '../modules/campaign/campaign.service';
import { getProfile } from '../modules/profile/profile.service';
import {
  listSentForReplyMatching,
  markReplied,
  markBounced,
  recordInboundMessage,
  touchLatestReply,
} from '../modules/application/application.service';
import { logger } from '../lib/logger';
import { matchReply, matchBounce, inboxKey, detectOptOutRequest, pollSinceDate, stripQuotedReply } from './reply-matching';
import { addOptOut } from '../modules/optout/optout.service';
import { optOutTargetForReply } from '../modules/optout/optout-match';
import { markLeadBounced } from '../lib/leadsMaster';

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
        // BUG-ÉCHANGE : on prend TOUS les messages du fil, pas seulement le premier.
        // Avant (`inbox.find`), une seule réponse par candidature et par relevé était traitée :
        // si le recruteur avait envoyé plusieurs mails depuis le dernier relevé (cas courant au
        // 1er relevé, qui remonte jusqu'à 60 j), les suivants étaient perdus DÉFINITIVEMENT
        // (le relevé d'après ne les refetch plus). Triés par date → le fil reste chronologique.
        const replies = inbox
          .filter((m) => !m.isAutoReply && !usedInboxKeys.has(inboxKey(m)) && matchReply(m, app, sent))
          .sort((a, b) => a.date.getTime() - b.date.getTime());
        if (replies.length === 0) continue;
        // Réserve TOUS ces messages pour cette candidature (aucun ne doit être réattribué).
        for (const m of replies) usedInboxKeys.add(inboxKey(m));

        let markedFirst = false;
        let newInboundCount = 0;
        for (const reply of replies) {
          const MAX_REPLY_LENGTH = 50_000;
          const body = reply.text.slice(0, MAX_REPLY_LENGTH);
          // REPLY-IN : on transmet l'adresse réelle de l'expéditeur (reply.from) → « Répondre
          // au recruteur » visera cette boîte, pas forcément l'email scrapé d'origine.
          const { marked } = await markReplied(app.id, body, reply.from || undefined);
          // THREAD-01 : consigner le message entrant dans le fil (dédupliqué par Message-ID).
          const isNewInbound = await recordInboundMessage(app.id, body, reply.from || null, reply.messageId);
          if (isNewInbound) newInboundCount++;
          if (marked) {
            markedFirst = true;
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
                // On bloque le DOMAINE entier pour une adresse pro (toute l'entreprise
                // ne sera plus recontactée), l'ADRESSE seule pour un freemail.
                const target = optOutTargetForReply(app.company.contactEmail);
                await addOptOut(
                  target,
                  `Désinscription détectée dans une réponse (${app.company.name})`,
                );
                logger.info(`[RGPD] Opt-out auto : ${target} (désinscription détectée dans la réponse).`);
              } catch (err) {
                logger.warn('Impossible d\'ajouter le contact à la liste opt-out', err);
              }
            }
          }
        }
        // B3 : une réponse sur une candidature DÉJÀ REPLIED doit quand même faire remonter le
        // fil et rebasculer le badge → on bump repliedAt/replyFrom sur le message le PLUS RÉCENT.
        const latest = replies[replies.length - 1];
        if (newInboundCount > 0 && !markedFirst) {
          await touchLatestReply(app.id, latest.date ?? new Date(), latest.from || null);
          touchedCampaigns.add(app.campaignId);
        }
      }

      // BOUNCE-01 : détecter les NDR (Non-Delivery Reports) dans la boîte.
      // Un NDR = le serveur destinataire a rejeté l'email → on marque la candidature
      // comme rebondie et on notifie l'UI pour proposer un email alternatif.
      // B2 : on compte les NDR NON attribués (adresse ambiguë, ou NDR sans Message-ID ni
      // adresse) pour les rendre visibles dans les logs plutôt que de les ignorer en silence.
      let unmatchedBounces = 0;
      for (const msg of inbox) {
        if (!msg.isBounce) continue;

        // BOUNCE-FALLBACK : matchBounce essaie d'abord le Message-ID (fiable), puis
        // replie sur l'adresse du contact citée dans le NDR (non ambigu uniquement) —
        // un rejet immédiat « adresse introuvable » (email pattern/deviné inexistant)
        // ne recopiant souvent PAS le Message-ID original, ces bounces étaient jusque-là
        // silencieusement ignorés.
        const bouncedApp = matchBounce(msg, sent);
        if (!bouncedApp) {
          unmatchedBounces++;
          // B10 : NDR non attribué mais avec une adresse en clair → on PRÉVIENT l'utilisateur
          // (toast) pour vérif manuelle, sans marquer à tort une candidature (l'adresse est
          // portée par ≥2 candidatures, on ne sait pas laquelle a rebondi).
          const ambiguous = msg.bouncedCandidateEmails[0];
          if (ambiguous) {
            taskRunner.emitEvent('bounce:detected', {
              companyName: `${ambiguous} (adresse ambiguë — à vérifier)`,
              nextEmailAvailable: false,
            });
          }
          continue;
        }

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

        // BOUNCE-CSV : propage le rebond vers le master de leads (page Leads), sinon un
        // email confirmé mauvais reste « valide » pour une future campagne. HORS du gate
        // `marked` (et idempotent) : si un relevé précédent l'a sautée (scraper actif),
        // ce relevé-ci la ré-applique. Best-effort — n'échoue jamais le traitement du bounce.
        try {
          markLeadBounced(bouncedApp.company.contactEmail);
        } catch (err) {
          logger.warn('[BOUNCE] Propagation vers le master de leads échouée (non bloquant).', err);
        }
      }
      // B2 : NDR non attribués (adresse portée par ≥2 candidatures, ou NDR sans Message-ID
      // ni adresse en clair) → visibles dans les logs au lieu d'être ignorés en silence.
      if (unmatchedBounces > 0) {
        logger.info(`[BOUNCE] ${unmatchedBounces} NDR non attribué(s) ce relevé (adresse ambiguë ou sans identifiant) — à vérifier manuellement.`);
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
