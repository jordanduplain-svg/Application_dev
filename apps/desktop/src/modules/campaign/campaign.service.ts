import type { Campaign, CampaignInput, CampaignStatus } from '@candio/shared';
import type { Campaign as DbCampaign } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

// Type Prisma incluant les _count pour les compteurs de liste.
type DbCampaignWithCount = DbCampaign & {
  _count: { companies: number; applications: number };
  _repliedCount?: number;
  _sentCount?: number;
  cv?: { name: string } | null;   // CV-MULTI : relation cv (nom pour affichage)
};

// Gestion des campagnes de recherche d'emploi.

// Convertit un enregistrement Prisma en DTO partagé (avec ou sans _count).
function toDTO(c: DbCampaign | DbCampaignWithCount): Campaign {
  // UX-9v2 : _count injecté si présent, sinon zéro (ex: campaign:get sans include).
  const withCount = c as DbCampaignWithCount;
  return {
    id: c.id,
    name: c.name,
    prompt: c.prompt,
    jobTitle: c.jobTitle,
    location: c.location,
    contractTypes: c.contractTypes ? c.contractTypes.split(',').filter(Boolean) : [],
    salaryMin: c.salaryMin,
    salaryMax: c.salaryMax,
    // UX-7v2 : notes libres.
    notes: c.notes ?? null,
    // AVAIL : disponibilité saisie (recopiée telle quelle dans la lettre).
    availability: (c as DbCampaign & { availability?: string | null }).availability ?? null,
    status: c.status as CampaignStatus,
    // UX-6 : date d'archivage — null si campagne active.
    archivedAt: c.archivedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    // UX-9v2 : compteurs pour scan rapide.
    companiesCount: withCount._count?.companies ?? 0,
    sentCount: withCount._sentCount ?? 0,
    repliedCount: withCount._repliedCount ?? 0,
    // INT-2v3 : date d'envoi planifié.
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    // ANA-5v3 / B8 : variante B du prompt (était absent du DTO, causait une perte silencieuse à l'édition).
    promptVariantB: c.promptVariantB ?? null,
    // CV-MULTI : CV choisi (id + nom pour affichage dans le sélecteur).
    cvId: c.cvId ?? null,
    cvName: withCount.cv?.name ?? null,
    // SECTOR-PREF : secteurs préférés (CSV → tableau).
    preferredSectors: (c as DbCampaign & { preferredSectors?: string }).preferredSectors
      ? (c as DbCampaign & { preferredSectors: string }).preferredSectors.split(',').filter(Boolean)
      : [],
  };
}

// Transforme le DTO d'entrée en données Prisma.
function toData(input: CampaignInput) {
  return {
    name: input.name,
    prompt: input.prompt,
    jobTitle: input.jobTitle,
    location: input.location,
    contractTypes: input.contractTypes.join(','),
    salaryMin: input.salaryMin,
    salaryMax: input.salaryMax,
    // UX-7v2 : notes libres.
    notes: input.notes ?? null,
    // AVAIL : disponibilité saisie (texte libre, recopiée dans la lettre).
    availability: input.availability?.trim() || null,
    // ANA-5v3 : variante B du prompt.
    promptVariantB: input.promptVariantB ?? null,
    // CV-MULTI : CV choisi (null = aucun).
    cvId: input.cvId ?? null,
    // SECTOR-PREF : secteurs préférés (tableau → CSV, max 5).
    preferredSectors: (input.preferredSectors ?? []).slice(0, 5).join(','),
  };
}

// Options Prisma pour inclure les compteurs de liste + le nom du CV.
const includeCount = {
  _count: { select: { companies: true, applications: true } },
  cv: { select: { name: true } },
} as const;

const SENT_STATUSES = ['SENT', 'REPLIED', 'FOLLOWED_UP'] as const;

// Calcule le nombre de réponses pour un lot de campagnes en une seule requête.
async function attachRepliedCounts(campaigns: (DbCampaign & { _count: { companies: number; applications: number } })[]): Promise<DbCampaignWithCount[]> {
  if (campaigns.length === 0) return [];
  const ids = campaigns.map((c) => c.id);
  const groups = await prisma.application.groupBy({
    by: ['campaignId'],
    where: { campaignId: { in: ids }, status: 'REPLIED' },
    _count: { _all: true },
  });
  const repliedMap = new Map(groups.map((g) => [g.campaignId, g._count._all]));
  return campaigns.map((c) => ({ ...c, _repliedCount: repliedMap.get(c.id) ?? 0 }));
}

// Compte les candidatures réellement envoyées (SENT / REPLIED / FOLLOWED_UP).
async function attachSentCounts(
  campaigns: (DbCampaign & { _count: { companies: number; applications: number }; _repliedCount?: number })[]
): Promise<DbCampaignWithCount[]> {
  if (campaigns.length === 0) return [];
  const ids = campaigns.map((c) => c.id);
  const groups = await prisma.application.groupBy({
    by: ['campaignId'],
    where: { campaignId: { in: ids }, status: { in: [...SENT_STATUSES] } },
    _count: { _all: true },
  });
  const sentMap = new Map(groups.map((g) => [g.campaignId, g._count._all]));
  return campaigns.map((c) => ({ ...c, _sentCount: sentMap.get(c.id) ?? 0 }));
}

async function withCounts(c: DbCampaign & { _count: { companies: number; applications: number } }): Promise<Campaign> {
  const [withReplied] = await attachRepliedCounts([c]);
  const [withSent] = await attachSentCounts([withReplied]);
  return toDTO(withSent);
}

export async function listCampaigns(): Promise<Campaign[]> {
  const rows = await prisma.campaign.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: 'desc' },
    include: includeCount,
  });
  const withReplied = await attachRepliedCounts(rows);
  const withSent = await attachSentCounts(withReplied);
  return withSent.map(toDTO);
}

export async function listArchivedCampaigns(): Promise<Campaign[]> {
  const rows = await prisma.campaign.findMany({
    where: { archivedAt: { not: null } },
    orderBy: { archivedAt: 'desc' },
    include: includeCount,
  });
  const withReplied = await attachRepliedCounts(rows);
  const withSent = await attachSentCounts(withReplied);
  return withSent.map(toDTO);
}

export async function unarchiveCampaign(id: string): Promise<Campaign> {
  const c = await prisma.campaign.update({
    where: { id },
    data: { archivedAt: null },
    include: includeCount,
  });
  return withCounts(c);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const c = await prisma.campaign.findUnique({ where: { id }, include: includeCount });
  if (!c) return null;
  return withCounts(c);
}

export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  const c = await prisma.campaign.create({ data: toData(input), include: includeCount });
  return withCounts(c);
}

export async function updateCampaign(id: string, input: CampaignInput): Promise<Campaign> {
  const c = await prisma.campaign.update({ where: { id }, data: toData(input), include: includeCount });
  return withCounts(c);
}

// UX-4v2 : duplication d'une campagne (même champs + entreprises, sans candidatures).
export async function duplicateCampaign(id: string): Promise<Campaign> {
  const original = await prisma.campaign.findUniqueOrThrow({
    where: { id },
    include: { companies: true },
  });
  const c = await prisma.campaign.create({
    data: {
      name: `${original.name} (copie)`,
      prompt: original.prompt,
      promptVariantB: original.promptVariantB,
      cvId: original.cvId,   // CV-MULTI : conserve le CV de la campagne dupliquée
      preferredSectors: original.preferredSectors,  // SECTOR-PREF : conserve les secteurs
      jobTitle: original.jobTitle,
      location: original.location,
      contractTypes: original.contractTypes,
      salaryMin: original.salaryMin,
      salaryMax: original.salaryMax,
      notes: original.notes,
      availability: original.availability,  // AVAIL : conserve la disponibilité
      status: 'DRAFT',
      archivedAt: null,
      companies: {
        // BUG 3 : copier aussi les champs d'enrichissement (secteur, fiche, localisation,
        // scores…) — sinon les lettres de la copie perdent la personnalisation du §2.
        create: original.companies.map((co) => ({
          name: co.name,
          website: co.website,
          contactEmail: co.contactEmail,
          contactName: co.contactName,
          contactRole: co.contactRole,
          blacklisted: co.blacklisted,
          emailSource: co.emailSource,
          emailAlternatives: co.emailAlternatives,
          region: co.region,
          activityDomain: co.activityDomain,
          companySize: co.companySize,
          country: co.country,
          regionAdmin: co.regionAdmin,
          dept: co.dept,
          deptName: co.deptName,
          city: co.city,
          sector: co.sector,
          description: co.description,
          companySizeBucket: co.companySizeBucket,
          techStack: co.techStack,
          freshnessScore: co.freshnessScore,
          relevanceScore: co.relevanceScore,
        })),
      },
    },
    include: includeCount,
  });
  return withCounts(c);
}

export async function bulkDeleteArchivedCampaigns(): Promise<{ deleted: number }> {
  const result = await prisma.campaign.deleteMany({ where: { archivedAt: { not: null } } });
  return { deleted: result.count };
}

export async function archiveCampaign(id: string): Promise<void> {
  await prisma.campaign.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function deleteCampaign(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sending = await tx.application.count({
      where: { campaignId: id, status: 'SENDING' },
    });
    if (sending > 0) {
      throw new Error(
        'Des candidatures sont en cours d\'envoi — attendez la fin avant de supprimer.'
      );
    }
    await tx.campaign.delete({ where: { id } });
  });
}

export async function refreshCampaignStatus(campaignId: string): Promise<void> {
  const groups = await prisma.application.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });

  const total = groups.reduce((s, g) => s + g._count._all, 0);

  let newStatus: CampaignStatus;
  if (total === 0) {
    newStatus = 'DRAFT';
  } else {
    const TERMINAL_POSITIVE = new Set(['SENT', 'REPLIED', 'FOLLOWED_UP']);
    const TERMINAL = new Set(['SENT', 'REPLIED', 'FAILED', 'FOLLOWED_UP']);

    const pending = groups
      .filter((g) => !TERMINAL.has(g.status))
      .reduce((s, g) => s + g._count._all, 0);
    const positiveTerminal = groups
      .filter((g) => TERMINAL_POSITIVE.has(g.status))
      .reduce((s, g) => s + g._count._all, 0);

    newStatus = pending === 0 && positiveTerminal > 0 ? 'COMPLETED' : 'RUNNING';
  }

  try {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: newStatus },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return;
    throw err;
  }
}
