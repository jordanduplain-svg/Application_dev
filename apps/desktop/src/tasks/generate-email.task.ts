import type { CvParsed } from '@candio/shared';
import { UNVERIFIED_EMAIL_SOURCES } from '@candio/shared';
import { taskRunner } from '../lib/task-runner';
import { prisma } from '../lib/prisma';
import { getProfile } from '../modules/profile/profile.service';
import { getCv } from '../modules/cv/cv.service';
import { generatePitch } from '../modules/ai/ai.service';
import { upsertDraft } from '../modules/application/application.service';
import { refreshCampaignStatus } from '../modules/campaign/campaign.service';
import { pickCampaignPrompt } from '../lib/campaign-prompt';

// Statuts protégés : une candidature déjà envoyée (ou en cours) n'est JAMAIS régénérée.
const PROTECTED_GEN_STATUSES = new Set(['SENDING', 'SENT', 'REPLIED', 'FOLLOWED_UP']);

/**
 * Enfile la génération des emails de candidature d'une campagne.
 *
 * - mode 'missing' (défaut) : une tâche par entreprise SANS candidature.
 * - mode 'regenerate' : régénère AUSSI les brouillons/échecs existants (écrase),
 *   pour réappliquer le prompt courant. Ne touche jamais aux candidatures déjà
 *   envoyées (SENT/REPLIED/FOLLOWED_UP/SENDING).
 */
export async function enqueueGeneration(
  campaignId: string,
  mode: 'missing' | 'regenerate' = 'missing',
): Promise<{ enqueued: number; skippedUnverified: number }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { companies: { include: { application: true } } },
  });
  if (!campaign) return { enqueued: 0, skippedUnverified: 0 };

  // ÉCONOMIE-TOKENS : ne pas générer de lettre pour une entreprise dont l'email est « à
  // vérifier » (source devinée, risque de rebond → bloquée à l'envoi de toute façon). On
  // compte les sautées pour le signaler dans l'UI (à corriger via Leads « Mettre à jour le CSV »).
  let skippedUnverified = 0;

  // FM-06 : exclure les entreprises blacklistées de la génération.
  const targets = campaign.companies.filter((c) => {
    if ((c as typeof c & { blacklisted?: boolean }).blacklisted) return false;
    // ÉCONOMIE-TOKENS : email non fiable → on saute (aucun appel IA), pour les deux modes.
    if ((UNVERIFIED_EMAIL_SOURCES as readonly string[]).includes(c.emailSource)) {
      // Ne compter que les entreprises qui AURAIENT été générées (sinon on gonfle le compte
      // avec des déjà-envoyées/protégées qu'on n'aurait pas régénérées de toute façon).
      const wouldGenerate = mode === 'regenerate'
        ? (!c.application || !PROTECTED_GEN_STATUSES.has(c.application.status))
        : !c.application;
      if (wouldGenerate) skippedUnverified++;
      return false;
    }
    if (mode === 'regenerate') {
      // Tout sauf les candidatures déjà envoyées/en cours (brouillons + échecs + sans lettre).
      return !c.application || !PROTECTED_GEN_STATUSES.has(c.application.status);
    }
    return !c.application;
  });
  if (targets.length === 0) return { enqueued: 0, skippedUnverified };

  const initialProfile = await getProfile();
  if (!initialProfile) {
    throw new Error('Profil inexistant — créez-le dans le Profil avant de générer.');
  }

  // CV-MULTI : la campagne doit avoir un CV sélectionné et analysé.
  if (!campaign.cvId) {
    throw new Error('Aucun CV sélectionné pour cette campagne — choisis-en un dans le formulaire de campagne.');
  }
  const cv = await getCv(campaign.cvId);
  if (!cv?.parsed) {
    throw new Error('Le CV de cette campagne n\'est pas encore analysé — importe son PDF dans l\'onglet CV.');
  }
  let cvParsed: CvParsed;
  try { cvParsed = JSON.parse(cv.parsed) as CvParsed; }
  catch { throw new Error('CV illisible (données corrompues) — ré-importe le PDF dans l\'onglet CV.'); }

  const campaignSnapshot = {
    jobTitle: campaign.jobTitle,
    prompt: campaign.prompt,
    promptVariantB: campaign.promptVariantB,
    cvParsed,
    // Types de contrat (CSV en base → tableau) pour annoncer le contrat en §1 de l'email.
    contractTypes: (campaign.contractTypes || '').split(',').map((s) => s.trim()).filter(Boolean),
    // AVAIL : disponibilité saisie → recopiée telle quelle au §4 (pas de date inventée).
    availability: campaign.availability,
  };

  for (const company of targets) {
    const c = company as typeof company & {
      sector?: string | null; activityDomain?: string | null; city?: string | null;
      website?: string | null; description?: string | null;
    };
    const companySnapshot = {
      id: company.id,
      name: company.name,
      contactName: company.contactName,
      // SCRAPE : contexte entreprise pour personnaliser le pitch.
      sector: c.sector ?? null,
      activityDomain: c.activityDomain ?? null,
      city: c.city ?? null,
      website: c.website ?? null,
      // SCRAPE-DESC : description d'activité (site résumé par IA) → §2 personnalisé.
      description: c.description ?? null,
    };

    taskRunner.enqueue({
      type: 'generate-email',
      label: `Email pour ${companySnapshot.name}`,
      run: async () => {
        const profile = await getProfile();
        if (!profile) {
          throw new Error('Profil inexistant — créez-le dans le Profil avant de générer.');
        }
        // FM-02 : capturer la variante choisie pour traçabilité A/B.
        const { prompt, variant } = pickCampaignPrompt(campaignSnapshot.prompt, campaignSnapshot.promptVariantB);
        const email = await generatePitch(
          campaignSnapshot.jobTitle,
          prompt,
          companySnapshot.name,
          companySnapshot.contactName,
          campaignSnapshot.cvParsed,   // CV-MULTI : CV de la campagne (plus le profil)
          profile,
          {
            sector: companySnapshot.sector,
            activityDomain: companySnapshot.activityDomain,
            city: companySnapshot.city,
            website: companySnapshot.website,
            description: companySnapshot.description,
          },
          campaignSnapshot.contractTypes,
          campaignSnapshot.availability,
          { kind: 'email', campaignId }, // COST-02 : mail de candidature, rattaché à la campagne
        );
        await upsertDraft({
          campaignId,
          companyId: companySnapshot.id,
          subject: email.subject,
          body: email.body,
          promptVariant: variant,
        });
        await refreshCampaignStatus(campaignId);
      },
    });
  }

  return { enqueued: targets.length, skippedUnverified };
}
