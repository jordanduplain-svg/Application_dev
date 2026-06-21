import { dialog } from 'electron';
import { writeFile } from 'fs/promises';
import { handle } from './registry';
import * as campaignService from '../../src/modules/campaign/campaign.service';
import { prisma } from '../../src/lib/prisma';
import { logger } from '../../src/lib/logger';
// FM2 : validation Zod des payloads IPC.
import { validate, CampaignCreateSchema } from './validation';

/** Handlers IPC du domaine Campagne. */
export function registerCampaignHandlers(): void {
  handle('campaign:list', () => campaignService.listCampaigns());
  handle('campaign:get', ({ id }) => campaignService.getCampaign(id));
  // FM2 : valider le payload avant de le passer au service.
  handle('campaign:create', (input) => {
    validate(CampaignCreateSchema, input);
    return campaignService.createCampaign(input);
  });
  handle('campaign:update', ({ id, ...input }) => {
    validate(CampaignCreateSchema, input);
    return campaignService.updateCampaign(id, input);
  });
  handle('campaign:delete', ({ id }) => campaignService.deleteCampaign(id));

  // UX-6 : archivage (soft-delete) d'une campagne.
  handle('campaign:archive', ({ id }) => campaignService.archiveCampaign(id));

  // UX-1v2 : liste et désarchivage des campagnes archivées.
  handle('campaign:listArchived', () => campaignService.listArchivedCampaigns());
  handle('campaign:unarchive', ({ id }) => campaignService.unarchiveCampaign(id));

  // UX-4v2 : duplication d'une campagne.
  handle('campaign:duplicate', ({ id }) => campaignService.duplicateCampaign(id));

  // ADM-2v2 : suppression en masse des campagnes archivées.
  handle('campaign:bulkDeleteArchived', async () => {
    const result = await campaignService.bulkDeleteArchivedCampaigns();
    // SEC-S2 : audit log de la suppression en masse.
    logger.warn(`[AUDIT] bulkDeleteArchived : ${result.deleted} campagnes supprimées`);
    return result;
  });

  // UX-9 : export CSV des candidatures d'une campagne.
  handle('campaign:exportCsv', async ({ id }) => {
    // Charger la campagne avec ses candidatures et entreprises.
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        applications: { include: { company: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!campaign) return null;

    const result = await dialog.showSaveDialog({
      title: 'Exporter les candidatures',
      defaultPath: `${campaign.name.replace(/[^a-z0-9]/gi, '_')}-candidatures.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;

    // Construire le CSV (séparateur virgule, guillemets sur les champs texte).
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = [
      ['Entreprise', 'Email contact', 'Statut', 'Date envoi', 'Date réponse'].join(','),
      ...campaign.applications.map((a) => [
        escape(a.company.name),
        escape(a.company.contactEmail),
        a.status,
        a.sentAt ? a.sentAt.toISOString().slice(0, 10) : '',
        a.repliedAt ? a.repliedAt.toISOString().slice(0, 10) : '',
      ].join(',')),
    ];

    await writeFile(result.filePath, rows.join('\n'), 'utf8');
    logger.info(`[exportCsv] Campagne "${campaign.name}" exportée : ${result.filePath}`);
    return { path: result.filePath };
  });
}
