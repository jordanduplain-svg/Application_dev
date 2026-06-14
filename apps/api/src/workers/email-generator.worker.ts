import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { smtpSenderQueue } from '../lib/queue';
import { aiService } from '../modules/ai/ai.service';
import { maybeCompleteCampaign } from '../lib/campaign-status';

/**
 * Rôle : Worker BullMQ — génération de l'email de candidature.
 *
 * Maillon central du pipeline : il prend une candidature (Application) déjà
 * créée par le scraper, fait rédiger l'email par l'IA, puis transmet le job
 * au worker d'envoi SMTP.
 *   scrape-company  →  [generate-email]  →  send-email
 */

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const emailGeneratorWorker = new Worker(
  'generate-email',
  async (job: Job<{ applicationId: string }>) => {
    const { applicationId } = job.data;

    // On charge la candidature avec tout le contexte nécessaire à la rédaction :
    // la campagne (poste, prompt) et l'utilisateur (CV parsé).
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        campaign: { include: { user: true } },
      },
    });

    if (!application) throw new Error('Application not found');
    const user = application.campaign.user;

    // Le CV est parsé par une autre file (`cv-parsing`), de façon asynchrone.
    // S'il n'est pas encore prêt, on relance l'erreur : BullMQ réessaiera le
    // job (avec backoff), ce qui laisse le temps au parsing de se terminer
    // avant de générer un email sans le contexte du CV.
    if (!user.cvParsed) {
      throw new Error('CV pas encore analysé — nouvelle tentative programmée');
    }

    // Rédaction de l'email personnalisé via GPT-4o.
    const generated = await aiService.generatePitch(
      application.campaign.jobTitle,
      application.campaign.prompt,
      application.companyName,
      application.contactName,
      user.cvParsed
    );

    // On enregistre l'objet et le corps générés sur la candidature.
    await prisma.application.update({
      where: { id: applicationId },
      data: { subject: generated.subject, body: generated.body },
    });

    // Étape suivante du pipeline : l'envoi SMTP (avec throttling anti-spam).
    // `attempts` + backoff : une erreur SMTP transitoire (timeout, greylisting)
    // sera réessayée au lieu de faire échouer définitivement la candidature.
    await smtpSenderQueue.add(
      'send-email',
      { applicationId },
      {
        // jobId déterministe : empêche un envoi en double si ce worker est
        // rejoué pour la même candidature (H2).
        jobId: `send-${applicationId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
      }
    );
  },
  { connection: connection as any, concurrency: 5 }
);

// Si la génération échoue définitivement (CV jamais analysé, IA indisponible…),
// la candidature est marquée FAILED — sinon elle resterait PENDING à jamais et
// la campagne ne pourrait jamais se terminer. On vérifie ensuite si la campagne
// est complète.
emailGeneratorWorker.on('failed', async (job) => {
  if (!job) return;
  // `failed` est émis à CHAQUE tentative ratée. La 1ʳᵉ tentative échoue presque
  // toujours (« CV pas encore analysé ») : on n'agit donc qu'à l'échec DÉFINITIF,
  // une fois toutes les tentatives épuisées.
  if (job.attemptsMade < (job.opts.attempts ?? 1)) return;

  const applicationId = job.data?.applicationId;
  if (!applicationId) return;
  try {
    const application = await prisma.application.update({
      where: { id: applicationId },
      data: { status: 'FAILED', errorMessage: 'Génération de l\'email échouée' },
    });
    await maybeCompleteCampaign(application.campaignId);
  } catch {
    // La candidature a pu être supprimée entre-temps : on ignore.
  }
});
