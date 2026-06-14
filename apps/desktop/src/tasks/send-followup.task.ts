import { taskRunner } from '../lib/task-runner';
import { sendApplicationEmail } from '../lib/mailer';
import { getProfile } from '../modules/profile/profile.service';
import { refreshCampaignStatus } from '../modules/campaign/campaign.service';
import { getApplication } from '../modules/application/application.service';
import { generatePitch } from '../modules/ai/ai.service';
import { prisma } from '../lib/prisma';
import type { CvParsed } from '@candio/shared';

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
    `Tu rédiges une RELANCE COURTE (2-3 phrases max) suite à une candidature spontanée envoyée.
Rappelle la candidature envoyée pour le sujet "${app.subject}" et demande poliment si la candidature a été reçue.`,
    app.companyName,
    null,
    cvParsed,
    profile
  );

  return {
    subject: `Relance : ${app.subject}`,
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
      // Claim atomique : une seule relance par candidature (anti double-clic).
      const claimed = await prisma.application.updateMany({
        where: { id: applicationId, status: 'SENT', followUpSentAt: null },
        data: { status: 'FOLLOWED_UP', followUpSentAt: new Date() },
      });
      if (claimed.count === 0) return;

      const app = await getApplication(applicationId);
      if (!app) return;

      const profile = await getProfile();
      const cv = await loadCampaignCv(app.campaignId);
      if (!profile?.emailSender || !cv) {
        await prisma.application.update({
          where: { id: applicationId },
          data: { status: 'SENT', followUpSentAt: null },
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
          `Tu rédiges une RELANCE COURTE (2-3 phrases max) suite à une candidature spontanée envoyée.
Rappelle la candidature envoyée pour le sujet "${app.subject}" et demande poliment si la candidature a été reçue.`,
          app.companyName,
          null,
          cvParsed,
          profile  // BUG-M1 fix : coordonnées du candidat injectées dans le prompt
        );

        const relanceSubject = `Relance : ${app.subject}`;
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

        await refreshCampaignStatus(app.campaignId);
      } catch (err) {
        if (!smtpSent) {
          // Rollback sûr : l'email n'a pas été envoyé, on peut remettre SENT.
          await prisma.application.update({
            where: { id: applicationId },
            data: {
              status: 'SENT',
              followUpSentAt: null,
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
