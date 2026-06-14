import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { decryptSymmetric } from '../lib/crypto';
import { maybeCompleteCampaign } from '../lib/campaign-status';
import nodemailer from 'nodemailer';

/**
 * Rôle : Worker BullMQ — envoi SMTP effectif de l'email de candidature.
 *
 * Dernier maillon du pipeline :
 *   scrape-company  →  generate-email  →  [send-email]
 *
 * L'email est envoyé via la config SMTP personnelle de l'utilisateur
 * (déchiffrée à la volée). Le rythme d'envoi est limité par le `limiter`
 * BullMQ (cf. plus bas) plutôt que par une pause bloquante dans le handler.
 */

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

interface SendEmailJob {
  applicationId: string;
}

/**
 * Convertit le corps texte de l'email en HTML et y intègre le pixel de
 * tracking d'ouverture (H4). Le texte est échappé pour ne pas casser le HTML
 * ni permettre d'injection.
 */
function buildHtmlBody(text: string, applicationId: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
  const pixelUrl = `${env.API_URL}/api/tracker/${applicationId}`;
  return `<div>${escaped}</div><img src="${pixelUrl}" width="1" height="1" alt="" style="display:none">`;
}

/**
 * Logique de traitement d'un job d'envoi d'email. Exportée séparément du
 * `Worker` afin de pouvoir être testée unitairement sans instancier de
 * connexion Redis ni de worker BullMQ.
 */
export async function processSendEmailJob(job: Job<SendEmailJob>) {
  const { applicationId } = job.data;

  // Chargement de la candidature et de l'utilisateur propriétaire de la campagne.
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { campaign: { include: { user: true } } },
  });
  if (!application) throw new Error('Application not found');

  // Idempotence (H-A) : si la candidature est déjà dans un état terminal
  // d'envoi, ce job est une RÉ-EXÉCUTION (job « calé » repris par BullMQ).
  // L'email est déjà parti — on ne le renvoie pas (sinon doublon au recruteur).
  if (['SENT', 'OPENED', 'REPLIED'].includes(application.status)) {
    return;
  }

  const user = application.campaign.user;

  // Sans config SMTP, impossible d'envoyer : on marque la candidature en échec.
  if (!user.smtpConfig) {
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: 'FAILED', errorMessage: 'SMTP not configured' },
    });
    await maybeCompleteCampaign(application.campaignId);
    return;
  }

  try {
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: 'SENDING' },
    });

    // Le mot de passe SMTP est stocké chiffré (AES-256-GCM) : on le déchiffre
    // uniquement ici, juste avant de créer le transporteur.
    const smtp = user.smtpConfig as any;
    const decryptedPassword = decryptSymmetric(smtp.pass);
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure || false,
      auth: {
        user: smtp.user,
        pass: decryptedPassword,
      },
    });

    await transporter.sendMail({
      from: `"${user.firstName} ${user.lastName}" <${user.emailSender || user.email}>`,
      to: application.contactEmail,
      subject: application.subject,
      text: application.body,
      // Version HTML : porte le pixel de tracking d'ouverture (H4).
      html: buildHtmlBody(application.body, application.id),
      // Message-ID DÉTERMINISTE : si une ré-exécution renvoyait malgré tout
      // l'email (fenêtre étroite entre l'envoi et l'`update` SENT), les deux
      // messages portent le même identifiant — beaucoup de serveurs mail
      // dédupliquent alors la réception (atténuation, cf. #4).
      messageId: `<send-${application.id}@candio.app>`,
    });

    await prisma.application.update({
      where: { id: applicationId },
      data: { status: 'SENT', sentAt: new Date() },
    });

    // Candidature dans un état terminal → la campagne est peut-être terminée.
    await maybeCompleteCampaign(application.campaignId);
  } catch (err: any) {
    // On NE marque PAS la candidature ici. La candidature reste en SENDING le
    // temps des retries ; le passage en FAILED se fait UNIQUEMENT à l'échec
    // définitif, via le handler `failed` ci-dessous (M-A) — convention
    // identique aux workers scraper et email-generator, et fiable car, dans
    // l'événement `failed`, `attemptsMade` a sa valeur finale.
    throw err;
  }
}

export const smtpSenderWorker = new Worker<SendEmailJob>(
  'send-email',
  processSendEmailJob,
  {
    connection: connection as any,
    // Throttling anti-spam NON bloquant : au plus 1 email toutes les 8 s.
    // Le `limiter` de BullMQ espace les jobs sans bloquer le thread du worker
    // (contrairement à un `setTimeout` dans le handler).
    concurrency: 1,
    limiter: { max: 1, duration: 8000 },
  }
);

// Échec DÉFINITIF de l'envoi (toutes les tentatives BullMQ épuisées) : on
// marque la candidature FAILED et on vérifie la complétion de la campagne.
// `attemptsMade < attempts` ⇒ tentative non finale (un retry est prévu) → on
// ne fait rien. `?.` sur `on` : en test, `Worker` est mocké.
smtpSenderWorker.on?.('failed', async (job) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  const applicationId = job.data?.applicationId;
  if (!applicationId) return;
  try {
    const application = await prisma.application.update({
      where: { id: applicationId },
      data: { status: 'FAILED', errorMessage: job.failedReason || "Envoi de l'email échoué" },
    });
    await maybeCompleteCampaign(application.campaignId);
  } catch {
    // La candidature a pu être supprimée entre-temps : on ignore.
  }
});
