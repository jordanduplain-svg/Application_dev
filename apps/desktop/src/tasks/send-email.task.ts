import { randomUUID } from 'crypto';
import { UNVERIFIED_EMAIL_SOURCES } from '@candio/shared';
import { taskRunner } from '../lib/task-runner';
import { sendApplicationEmail } from '../lib/mailer';
import { getProfile } from '../modules/profile/profile.service';
import { refreshCampaignStatus } from '../modules/campaign/campaign.service';
import {
  getApplication,
  markSending,
  markSent,
  markFailed,
} from '../modules/application/application.service';
import { prisma } from '../lib/prisma';
import { tryIncrementDailySend, getDailySendLimit, refundDailySend } from '../lib/secrets';
import { isOptedOut } from '../modules/optout/optout.service';

/**
 * Envoi SMTP d'une candidature.
 *
 * Throttling anti-spam SÉRIALISÉ : un envoi au plus toutes les 8 s, même avec
 * plusieurs tâches send-email en parallèle. La sérialisation passe par une
 * chaîne de promesses : sans elle, les deux premières tâches partiraient
 * simultanément (lastSendAt = 0), bypassant le délai.
 */
const SEND_INTERVAL_MS = 8000;
let lastSendAt = 0;
let throttleChain: Promise<void> = Promise.resolve();

// BUG-H4 fix : exporté pour être réutilisé par les handlers IPC qui appellent
// sendApplicationEmail directement (ex: sendFollowUpWithBody) sans passer par
// le task-runner, afin d'appliquer le même délai anti-spam de 8 s.
export async function throttleSend(): Promise<void> {
  // Chaque appel s'inscrit en queue et attend la fin du précédent throttle.
  let release!: () => void;
  const slot = new Promise<void>((r) => (release = r));
  const previous = throttleChain;
  throttleChain = slot;
  await previous;
  try {
    const wait = SEND_INTERVAL_MS - (Date.now() - lastSendAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSendAt = Date.now();
  } finally {
    release();
  }
}

/**
 * enqueueSend — ROUAGE de l'envoi d'une candidature, blindé contre le double-envoi et le
 * dépassement de quota. L'ordre des gardes EST le rouage (chacune protège la suivante) :
 *   1. idempotence : on ne renvoie jamais un SENT/REPLIED (doublon recruteur) ;
 *   2. on refuse les emails « devinés » (pattern non vérifié → bounce → réputation) ;
 *   3. RGPD : on n'envoie jamais à un opt-out ;
 *   4. on EXIGE un CV attaché (une candidature spontanée sans CV est pire que rien) ;
 *   5. `markSending` = claim ATOMIQUE DRAFT/FAILED→SENDING : si deux tâches visent la même
 *      candidature (double-clic, sendAll + send), une seule gagne — LE verrou anti-doublon ;
 *   6. quota quotidien consommé AVANT le throttle (pour ne pas attendre 8 s si plafond atteint) ;
 *   7. envoi SMTP, puis markSent. Si le SMTP réussit mais que markSent échoue, on force SENT
 *      sans messageId (JAMAIS FAILED) — sinon un renvoi manuel = double email parti.
 *
 * Asynchrone car on pré-charge le nom de l'entreprise pour libeller la tâche ("Envoi à
 * Acme") — lisible dans le journal quand plusieurs envois s'enchaînent.
 */
export async function enqueueSend(applicationId: string): Promise<void> {
  const initial = await getApplication(applicationId);
  const label = `Envoi à ${initial?.companyName ?? '…'}`;

  taskRunner.enqueue({
    type: 'send-email',
    label,
    run: async () => {
      const app = await getApplication(applicationId);
      if (!app) return;

      // Idempotence : ne jamais renvoyer un email déjà parti (doublon recruteur).
      // Une candidature FAILED reste renvoyable (nouvelle tentative manuelle).
      if (app.status === 'SENT' || app.status === 'REPLIED') return;

      // DELIV-01 : ne JAMAIS envoyer un email simplement « deviné » (pattern /
      // linkedin_pattern). Ce sont des formats générés sans aucune vérification —
      // risque de bounce élevé qui dégrade la réputation d'expéditeur. On bloque
      // l'envoi et on marque la candidature « à vérifier » : l'utilisateur doit
      // confirmer/corriger l'adresse (l'édition repasse emailSource à 'manual',
      // ce qui débloque l'envoi).
      if (UNVERIFIED_EMAIL_SOURCES.includes(app.emailSource)) {
        await markFailed(
          applicationId,
          `⚠️ À vérifier — l'adresse ${app.contactEmail} a été générée automatiquement ` +
            `(format « pattern », non confirmée) et risque de rebondir. ` +
            `Vérifiez/corrigez l'email du contact avant de l'envoyer.`
        );
        await refreshCampaignStatus(app.campaignId);
        return;
      }

      // RGPD : ne jamais envoyer à un contact figurant dans la liste opt-out
      // (« ne pas contacter »). On marque la candidature en échec explicite.
      if (await isOptedOut(app.contactEmail)) {
        await markFailed(
          applicationId,
          `Envoi bloqué — ${app.contactEmail} figure dans la liste « ne pas contacter » (RGPD).`,
        );
        await refreshCampaignStatus(app.campaignId);
        return;
      }

      const profile = await getProfile();
      if (!profile?.emailSender) {
        await markFailed(applicationId, "Adresse d'envoi non configurée (Profil)");
        await refreshCampaignStatus(app.campaignId);
        return;
      }

      // CV-MULTI : le CV de la campagne est joint à l'email. On le résout AVANT de
      // claim/consommer le quota et on BLOQUE si aucun CV n'est attaché — envoyer une
      // candidature spontanée sans CV est pire que ne rien envoyer (cas typique :
      // le CV a été supprimé/remplacé → cvId remis à null par onDelete:SetNull).
      const campaignCv = await prisma.campaign.findUnique({
        where: { id: app.campaignId },
        select: { cv: { select: { filePath: true } } },
      });
      const cvPath = campaignCv?.cv?.filePath ?? undefined;
      if (!cvPath) {
        await markFailed(
          applicationId,
          "Aucun CV attaché à cette campagne — sélectionne un CV dans la campagne avant d'envoyer.",
        );
        await refreshCampaignStatus(app.campaignId);
        return;
      }

      // ← ROUAGE anti-doublon : claim atomique DRAFT/FAILED→SENDING en une requête SQL.
      //   La base arbitre la course (UPDATE ... WHERE status IN (...)) → une seule tâche
      //   passe. Sans ce claim, deux clics « Envoyer » enverraient deux fois le même email.
      const claimed = await markSending(applicationId);
      if (!claimed) return;

      // FM3 : stocker un messageId provisoire avant envoi pour détecter les doublons post-crash.
      const provisionalId = `provisional-${randomUUID()}`;
      await prisma.application.update({
        where: { id: applicationId },
        data: { messageId: provisionalId },
      });

      // FM-02 : vérifier la limite quotidienne AVANT le throttle pour ne pas
      // consommer un slot d'attente de 8 s si la limite est déjà atteinte.
      const allowed = await tryIncrementDailySend();
      if (!allowed) {
        await markFailed(
          applicationId,
          `Limite quotidienne d'envois atteinte (${getDailySendLimit()} emails/jour) — réessayez demain.`
        );
        await refreshCampaignStatus(app.campaignId);
        return;
      }

      await throttleSend();
      let smtpSent = false;
      try {
        // Le Message-ID renvoyé est stocké : il sert au matching IMAP des réponses.
        const messageId = await sendApplicationEmail({
          fromName: `${profile.firstName} ${profile.lastName}`,
          fromEmail: profile.emailSender,
          to: app.contactEmail,
          subject: app.subject,
          body: app.body,
          cvPath, // Joindre le CV de la campagne si disponible.
        });
        smtpSent = true;
        await markSent(applicationId, messageId);
      } catch (err) {
        if (smtpSent) {
          // BUG double-envoi : l'email EST parti mais l'enregistrement (markSent) a
          // échoué. On ne marque SURTOUT PAS FAILED (sinon un renvoi manuel = double
          // email). On force SENT sans messageId : le matching IMAP par adresse/domaine
          // reste possible, et la candidature n'est plus « à renvoyer ».
          await prisma.application
            .update({ where: { id: applicationId }, data: { status: 'SENT', sentAt: new Date() } })
            .catch(() => { /* best-effort : l'email reste parti, on ne re-tente pas */ });
        } else {
          // L'email n'est pas parti : on rend le crédit de quota + marque FAILED
          // (l'utilisateur peut relancer l'envoi manuellement depuis l'UI).
          await refundDailySend();
          await markFailed(applicationId, err instanceof Error ? err.message : "Échec de l'envoi");
        }
      }
      await refreshCampaignStatus(app.campaignId);
    },
  });
}
