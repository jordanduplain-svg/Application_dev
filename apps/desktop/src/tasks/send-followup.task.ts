import { taskRunner } from '../lib/task-runner';
import { sendApplicationEmail } from '../lib/mailer';
import { getProfile } from '../modules/profile/profile.service';
import { refreshCampaignStatus } from '../modules/campaign/campaign.service';
import { getApplication, MAX_FOLLOWUPS, recordOutboundMessage } from '../modules/application/application.service';
import { generatePitch } from '../modules/ai/ai.service';
import { prisma } from '../lib/prisma';
import { tryIncrementDailySend, getDailySendLimit, refundDailySend } from '../lib/secrets';
import { isOptedOut } from '../modules/optout/optout.service';
import type { CvParsed } from '@candio/shared';

/**
 * Consigne de relance (directive passée à generatePitch, qui applique par-dessus
 * toutes les règles de style « voix humaine » du prompt principal). Mêmes
 * exigences : naturel, professionnel, sobre, sans cliché ni marqueur d'IA, et
 * clôture formelle. Volontairement TRÈS courte — c'est un simple rappel courtois.
 */
function followUpDirective(subject: string): string {
  return `Tu rédiges une RELANCE d'une candidature spontanée déjà envoyée (objet « ${subject} »). TRÈS COURTE : 3 à 4 phrases maximum.
- Contenu : rappelle brièvement la candidature envoyée, puis demande poliment si elle a bien été reçue et si un échange est envisageable. N'AJOUTE aucun nouvel argument, chiffre ni réalisation — c'est un simple rappel, pas une nouvelle lettre.
- TON : humain, naturel et professionnel, comme un pro qui réécrit en une minute. Pas de flagornerie ni d'enthousiasme excessif (proscris « ravi », « heureux », « hâte »), aucun cliché ni tournure d'IA.
- N'invente rien (faits entreprise/candidat uniquement réels). Aucune URL dans le corps : les liens restent dans la signature.
- Termine par une formule de politesse sobre (« Cordialement, » ou « Bien cordialement, ») suivie de la signature.`;
}

/** Charge le CvParsed + le chemin PDF du CV d'une campagne (CV-MULTI). */
async function loadCampaignCv(campaignId: string): Promise<{ parsed: CvParsed; filePath: string | null } | null> {
  const camp = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { cv: true },
  });
  if (!camp?.cv?.parsed) return null;
  try {
    return { parsed: JSON.parse(camp.cv.parsed) as CvParsed, filePath: camp.cv.filePath };
  } catch { return null; }
}

/**
 * UX-S8 : génère le contenu de la relance sans modifier la DB ni l'envoyer.
 * Utilisé pour la prévisualisation avant envoi.
 */
export async function generateFollowUpContent(
  applicationId: string
): Promise<{ subject: string; body: string }> {
  const app = await getApplication(applicationId);
  if (!app) throw new Error('Candidature introuvable.');

  const profile = await getProfile();
  if (!profile?.emailSender) {
    throw new Error('Profil incomplet — configurez votre adresse d\'envoi dans le Profil.');
  }
  const cv = await loadCampaignCv(app.campaignId);
  if (!cv) throw new Error('Le CV de cette campagne n\'est pas configuré/analysé (onglet CV).');
  const cvParsed = cv.parsed;
  // BUG-M1 fix : passer le profil pour inclure téléphone/LinkedIn/portfolio.
  const generated = await generatePitch(
    app.subject,
    followUpDirective(app.subject),
    app.companyName,
    null,
    cvParsed,
    profile,
    undefined, undefined, undefined,
    { kind: 'followup', campaignId: app.campaignId }, // COST-02 : relance rattachée à la campagne
  );

  return {
    // THREAD-02 : « Re: » (pas « Relance : ») → la relance se regroupe dans le fil de la
    // candidature partout, Gmail compris (dont la vue conversation est sensible à l'objet).
    subject: `Re: ${app.subject}`,
    body: generated.body,
  };
}

/**
 * UX-12 : envoi d'une relance automatique (follow-up) pour une candidature SENT
 * sans réponse depuis plus de 7 jours.
 */
export async function enqueueFollowUp(applicationId: string): Promise<void> {
  const initial = await getApplication(applicationId);
  const label = `Relance à ${initial?.companyName ?? '…'}`;

  taskRunner.enqueue({
    type: 'send-email',
    label,
    run: async () => {
      // FOLLOWUP-N : on capture l'état AVANT le claim pour pouvoir le restaurer
      // exactement en cas de rollback (1ʳᵉ relance SENT vs Nᵉ relance FOLLOWED_UP).
      const before = await prisma.application.findUnique({
        where: { id: applicationId },
        select: { status: true, followUpSentAt: true, followUpCount: true },
      });
      if (!before) return;
      const restore = before; // alias lisible pour les rollbacks

      // Claim atomique : accepte la 1ʳᵉ relance (SENT) ET les suivantes (FOLLOWED_UP
      // dont la dernière relance date de + de 10 j), sans réponse et sous le plafond.
      const tenDaysAgo = new Date(Date.now() - 10 * 864e5);
      const claimed = await prisma.application.updateMany({
        where: {
          id: applicationId,
          repliedAt: null,
          emailBounced: false, // BOUNCE-01 : jamais de relance sur une adresse rebondie.
          followUpCount: { lt: MAX_FOLLOWUPS },
          OR: [
            { status: 'SENT', followUpSentAt: null },
            { status: 'FOLLOWED_UP', followUpSentAt: { lt: tenDaysAgo } },
          ],
        },
        data: { status: 'FOLLOWED_UP', followUpSentAt: new Date(), followUpCount: { increment: 1 } },
      });
      if (claimed.count === 0) return;

      const app = await getApplication(applicationId);
      if (!app) return;

      const profile = await getProfile();
      const cv = await loadCampaignCv(app.campaignId);
      if (!profile?.emailSender || !cv) {
        // Config transitoire manquante → on restaure l'état d'avant pour réessayer plus tard.
        await prisma.application.update({
          where: { id: applicationId },
          data: { status: restore.status, followUpSentAt: restore.followUpSentAt, followUpCount: restore.followUpCount },
        });
        return;
      }

      // RGPD : ne jamais relancer un contact qui s'est désinscrit (opt-out).
      // On annule le claim et on neutralise la candidature pour qu'elle ne
      // ressorte plus comme « relançable ».
      if (await isOptedOut(app.contactEmail)) {
        // Neutralisation DÉFINITIVE : on pousse le compteur au plafond → plus jamais éligible.
        await prisma.application.update({
          where: { id: applicationId },
          data: {
            status: 'FOLLOWED_UP',
            followUpSentAt: new Date(),
            followUpCount: MAX_FOLLOWUPS,
            errorMessage: 'Relance bloquée — le contact figure dans la liste « ne pas contacter » (RGPD).',
          },
        });
        return;
      }

      // BUG-A : une relance compte dans le plafond d'envoi quotidien, comme un
      // envoi initial (anti-suspension Gmail). Si le plafond est atteint, on
      // annule le claim — la candidature redevient relançable dès demain.
      const allowed = await tryIncrementDailySend();
      if (!allowed) {
        // Plafond du jour atteint → on restaure l'état d'avant : redevient éligible
        // (le quota se libère demain ; le claim 10 j reste cohérent).
        await prisma.application.update({
          where: { id: applicationId },
          data: {
            status: restore.status,
            followUpSentAt: restore.followUpSentAt,
            followUpCount: restore.followUpCount,
            errorMessage: `Relance reportée — plafond d'envois du jour atteint (${getDailySendLimit()}/jour).`,
          },
        });
        return;
      }

      // BUG-H2 fix : on ne rollback QUE si l'envoi SMTP n'a pas eu lieu.
      // Si le SMTP réussit mais que la DB échoue ensuite, l'email est déjà parti —
      // rollback invalide → double envoi. On distingue les deux phases avec un flag.
      let smtpSent = false;
      try {
        const cvParsed = cv.parsed;
        // BUG-M1 fix : passer le profil pour inclure téléphone/LinkedIn/portfolio
        // dans le prompt IA de la relance (cohérence avec les emails initiaux FM-05).
        const generated = await generatePitch(
          app.subject,
          followUpDirective(app.subject),
          app.companyName,
          null,
          cvParsed,
          profile,  // BUG-M1 fix : coordonnées du candidat injectées dans le prompt
          undefined, undefined, undefined,
          { kind: 'followup', campaignId: app.campaignId }, // COST-02 : relance rattachée à la campagne
        );

        // THREAD-02 : « Re: » (pas « Relance : ») → regroupement fiable dans le fil, Gmail compris.
        const relanceSubject = `Re: ${app.subject}`;
        // BUG-04 fix : passer le Message-ID original pour que la relance
        // apparaisse dans le même fil (In-Reply-To + References).
        const messageId = await sendApplicationEmail({
          fromName: `${profile.firstName} ${profile.lastName}`,
          fromEmail: profile.emailSender,
          to: app.contactEmail,
          subject: relanceSubject,
          body: generated.body,
          cvPath: cv.filePath ?? undefined,
          inReplyTo: app.messageId ?? undefined,
          references: app.messageId ?? undefined,
        });
        smtpSent = true; // L'email est parti — rollback interdit à partir d'ici.

        await prisma.application.update({
          where: { id: applicationId },
          data: { followUpMessageId: messageId },
        });
        // THREAD-01 : la relance auto figure comme message sortant dans le fil.
        await recordOutboundMessage(applicationId, generated.body, messageId);

        await refreshCampaignStatus(app.campaignId);
      } catch (err) {
        if (!smtpSent) {
          // Rollback sûr : l'email n'a pas été envoyé → on rend le crédit de quota +
          // on restaure l'état d'avant (relance retentée plus tard).
          await refundDailySend();
          await prisma.application.update({
            where: { id: applicationId },
            data: {
              status: restore.status,
              followUpSentAt: restore.followUpSentAt,
              followUpCount: restore.followUpCount,
              errorMessage: err instanceof Error ? err.message : 'Échec de la relance',
            },
          });
        }
        // Si smtpSent = true, on ne rollback pas — l'email est parti.
        // L'erreur est juste loggée (le messageId ne sera pas stocké, mais c'est acceptable).
        throw err;
      }
    },
  });
}
