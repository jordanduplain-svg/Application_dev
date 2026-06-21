import { handle } from './registry';
import { prisma } from '../../src/lib/prisma';
import { logger } from '../../src/lib/logger';

// ADM-S13 : nettoyage des données orphelines et statistiques de santé.
export function registerMaintenanceHandlers(): void {
  // Statistiques sur les données potentiellement orphelines ou inutiles.
  handle('maintenance:getStats', async () => {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [companiesWithoutEmail, failedApplications, oldArchivedCampaigns] = await Promise.all([
      // Entreprises sans email valide (email vide ou absent).
      prisma.company.count({
        where: { OR: [{ contactEmail: '' }, { contactEmail: null as unknown as string }] },
      }),
      // Candidatures en échec.
      prisma.application.count({ where: { status: 'FAILED' } }),
      // Campagnes archivées depuis plus de 90 jours.
      prisma.campaign.count({
        where: { archivedAt: { not: null, lte: ninetyDaysAgo } },
      }),
    ]);

    return { companiesWithoutEmail, failedApplications, oldArchivedCampaigns };
  });

  // Suppression des candidatures en échec.
  handle('maintenance:purgeFailedApplications', async () => {
    const result = await prisma.application.deleteMany({ where: { status: 'FAILED' } });
    logger.info(`[maintenance] ${result.count} candidatures FAILED supprimées`);
    return { deleted: result.count };
  });

  // Suppression des campagnes archivées depuis plus de daysOld jours (cascade).
  handle('maintenance:purgeOldArchived', async ({ daysOld }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await prisma.campaign.deleteMany({
      where: { archivedAt: { not: null, lte: cutoff } },
    });
    logger.info(`[maintenance] ${result.count} campagnes archivées supprimées (>${daysOld}j)`);
    return { deleted: result.count };
  });
}
