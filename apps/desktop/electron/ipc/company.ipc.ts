import { dialog } from 'electron';
import { readFile, stat, writeFile } from 'fs/promises';
import { handle } from './registry';
import { prisma } from '../../src/lib/prisma';
import * as companyService from '../../src/modules/company/company.service';
import { assertEmail, assertNonEmpty } from '../../src/lib/validation';
import { validate, CampaignIdSchema, BulkDeleteSchema, IdSchema } from './validation';
import { logger } from '../../src/lib/logger';

/** Handlers IPC du domaine Entreprises cibles. */
export function registerCompanyHandlers(): void {
  handle('company:listByCampaign', ({ campaignId }) => companyService.listByCampaign(campaignId));

  // DEDUP-01 : entreprises présentes dans PLUSIEURS campagnes actives — évite de contacter
  // deux fois la même boîte (mauvais effet). Regroupées par domaine email (fiable), sinon
  // par nom normalisé (insensible casse/accents).
  handle('company:crossCampaignDuplicates', async () => {
    const companies = await prisma.company.findMany({
      where: { campaign: { archivedAt: null } },
      select: { name: true, contactEmail: true, campaignId: true, campaign: { select: { name: true } } },
    });
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const domainOf = (email: string) => { const m = /@(.+)$/.exec(email.trim()); return m ? m[1].toLowerCase() : ''; };
    const groups = new Map<string, { label: string; campaigns: Map<string, string> }>();
    for (const c of companies) {
      const key = domainOf(c.contactEmail) || norm(c.name);
      if (!key) continue;
      const g = groups.get(key) ?? { label: c.name, campaigns: new Map<string, string>() };
      g.campaigns.set(c.campaignId, c.campaign.name);
      groups.set(key, g);
    }
    return [...groups.entries()]
      .filter(([, g]) => g.campaigns.size >= 2)
      .map(([key, g]) => ({ key, label: g.label, campaigns: [...g.campaigns.entries()].map(([id, name]) => ({ id, name })) }))
      .sort((a, b) => b.campaigns.length - a.campaigns.length);
  });

  handle('company:add', (input) => {
    // H6 : validation côté main-process (double-check même si l'UI valide déjà).
    assertNonEmpty(input.name, 'Nom de l\'entreprise');
    assertEmail(input.contactEmail, 'Email du contact');
    return companyService.addCompany(input);
  });

  // UX-2 : mise à jour d'une entreprise cible.
  handle('company:update', ({ id, ...input }) => {
    assertNonEmpty(input.name, 'Nom de l\'entreprise');
    assertEmail(input.contactEmail, 'Email du contact');
    return companyService.updateCompany(id, input);
  });

  handle('company:delete', (payload) => {
    validate(IdSchema, payload);
    return companyService.deleteCompany(payload.id);
  });

  handle('company:bulkDelete', async (payload) => {
    const data = validate(BulkDeleteSchema, payload);
    // SEC-S2 : audit log de la suppression en masse.
    logger.warn(`[AUDIT] company:bulkDelete : ${data.ids.length} entreprises supprimées`);
    return companyService.bulkDeleteCompanies(data.ids);
  });

  handle('company:resetUsedLeads', async (payload) => {
    const { keys } = payload as { keys: string[] };
    if (!Array.isArray(keys) || keys.length === 0) return { reset: 0, skipped: 0 };
    const r = await companyService.resetUsedLeads(keys);
    logger.warn(`[AUDIT] company:resetUsedLeads : ${r.reset} libéré(s), ${r.skipped} protégé(s) ignoré(s)`);
    return r;
  });

  handle('company:importCsv', async (payload) => {
    const { campaignId } = validate(CampaignIdSchema, payload);
    const result = await dialog.showOpenDialog({
      title: 'Importer un CSV d\'entreprises',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { added: 0, skipped: 0 };
    }
    // H8 (revue 6) : vérifier la taille du fichier avant de le charger en RAM.
    // Un CSV de plusieurs Go provoque un heap overflow dans le process principal.
    const MAX_CSV_SIZE = 10 * 1024 * 1024; // 10 Mo
    const { size } = await stat(result.filePaths[0]);
    if (size > MAX_CSV_SIZE) {
      throw new Error(
        `Fichier CSV trop volumineux (${Math.round(size / 1024 / 1024)} Mo) — 10 Mo maximum.`
      );
    }
    // M1 : détecter le BOM UTF-8 ; sinon Latin-1 (compatible Windows-1252 pour les
    // exports Excel Windows — noms avec accents français non corrompus).
    const raw = await readFile(result.filePaths[0]);
    const content = (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF)
      ? raw.toString('utf8')
      : raw.toString('latin1');
    return companyService.importCsvContent(campaignId, content);
  });

  // FM-04 : détection de doublons par similarité de nom.
  handle('company:findSimilar', ({ campaignId, name }) =>
    companyService.findSimilarCompanies(campaignId, name)
  );

  // FM-06 : blacklist d'entreprise.
  handle('company:setBlacklisted', ({ id, blacklisted }) =>
    companyService.setBlacklisted(id, blacklisted)
  );

  // BOUNCE-01 : passe à l'email alternatif suivant après un bounce.
  handle('company:retryWithAlternativeEmail', ({ companyId }) =>
    companyService.retryWithAlternativeEmail(companyId)
  );

  // UX-3 : génère un fichier CSV modèle avec 2 lignes d'exemple.
  handle('company:downloadCsvTemplate', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Enregistrer le modèle CSV',
      defaultPath: 'candio-modele-entreprises.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return;

    const csvContent = [
      'name,contactEmail,website,contactName,contactRole',
      'Acme Corp,rh@acme.com,https://acme.com,Marie Dupont,Responsable RH',
      'Beta Inc,contact@beta.io,https://beta.io,Jean Martin,Directeur Technique',
    ].join('\n');

    await writeFile(result.filePath, csvContent, 'utf8');
  });
}
