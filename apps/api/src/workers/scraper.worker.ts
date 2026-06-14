import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { emailGeneratorQueue } from '../lib/queue';
import { issueRefundForCampaign } from '../lib/billing';

/**
 * Rôle : Worker BullMQ — recherche des entreprises/contacts cibles.
 *
 * Premier maillon du pipeline :
 *   [scrape-company]  →  generate-email  →  send-email
 *
 * ⚠️ MOCKÉ : aucun scraping réel. On simule des leads et une probabilité
 * d'échec. Les nouvelles tentatives sont gérées par BullMQ (option `attempts`
 * du job, cf. stripe.service.ts) — et non par une boucle de retry bloquante.
 */

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

interface ScrapeJob {
  campaignId: string;
  query: string;
}

export const scraperWorker = new Worker<ScrapeJob>(
  'scrape-company',
  async (job: Job<ScrapeJob>) => {
    const { campaignId } = job.data;
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    // Simulation d'un appel à un service de scraping. Un échec aléatoire (20 %)
    // fait échouer le job → BullMQ le réessaiera avec un backoff non bloquant.
    if (Math.random() < 0.2) {
      throw new Error('Rate limit proxy BrightData');
    }
    await new Promise((resolve) => setTimeout(resolve, 1500)); // latence réseau simulée

    // Idempotence : si une tentative précédente a déjà créé les candidatures,
    // on ne les recrée pas (évite les doublons lors d'un retry partiel).
    const existing = await prisma.application.count({ where: { campaignId } });
    if (existing === 0) {
      // On génère autant de leads que le quota acheté (modèles cyclés, avec
      // une adresse de contact unique par lead).
      const leadTemplates = [
        { company: 'TechNova', website: 'technova.fr', domain: 'technova.fr', contactName: 'Alice', role: 'CTO' },
        { company: 'FutureApp', website: 'futureapp.io', domain: 'futureapp.io', contactName: 'Bob', role: 'HR' },
      ];
      const leads = Array.from({ length: campaign.applicationQuota }, (_, i) => {
        const tpl = leadTemplates[i % leadTemplates.length];
        return {
          campaignId,
          companyName: `${tpl.company} #${i + 1}`,
          companyWebsite: tpl.website,
          contactEmail: `hr+${i + 1}@${tpl.domain}`,
          contactName: tpl.contactName,
          contactRole: tpl.role,
          subject: '',
          body: '',
          status: 'PENDING' as const,
        };
      });

      // Insertion GROUPÉE : une seule requête, au lieu de N inserts parallèles
      // qui satureraient le pool de connexions Prisma.
      await prisma.application.createMany({ data: leads });
    }

    // On enquête un job de génération d'email par candidature (avec retry, le
    // temps que le CV soit analysé par la file `cv-parsing`).
    const created = await prisma.application.findMany({
      where: { campaignId },
      select: { id: true },
    });
    for (const app of created) {
      await emailGeneratorQueue.add(
        'generate-email',
        { applicationId: app.id },
        {
          // jobId déterministe : si le job `scrape-company` est rejoué (retry
          // BullMQ), on NE crée PAS un second job de génération pour la même
          // candidature — sinon l'email serait généré et envoyé en double (H2).
          jobId: `gen-${app.id}`,
          // attempts élevé + backoff FIXE : la génération attend que le CV soit
          // analysé (file `cv-parsing`, asynchrone). 10 tentatives × 15 s
          // laissent ~2,5 min, marge confortable avant de renoncer (H5).
          attempts: 10,
          backoff: { type: 'fixed', delay: 15000 },
        }
      );
    }
  },
  { connection: connection as any, concurrency: 2 }
);

// Si le scraping échoue définitivement (toutes les tentatives BullMQ épuisées),
// la campagne ne doit pas rester bloquée en RUNNING : on la passe en FAILED.
scraperWorker.on('failed', async (job) => {
  if (!job) return;
  // `failed` est émis à CHAQUE tentative ratée (y compris celles qui seront
  // réessayées). On n'agit qu'à l'échec DÉFINITIF : sinon une simple tentative
  // transitoire ferait basculer en FAILED une campagne qui réussira au retry.
  if (job.attemptsMade < (job.opts.attempts ?? 1)) return;

  const campaignId = job.data?.campaignId;
  if (!campaignId) return;
  const { count } = await prisma.campaign.updateMany({
    where: { id: campaignId, status: 'RUNNING' },
    data: { status: 'FAILED' },
  });
  // La campagne vient de basculer en FAILED (aucune candidature n'a été
  // envoyée) : on rembourse intégralement l'utilisateur (A3).
  if (count > 0) {
    await issueRefundForCampaign(campaignId);
  }
});
