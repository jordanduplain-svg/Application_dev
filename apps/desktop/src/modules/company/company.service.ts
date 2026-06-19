import type { Company, CompanyInput } from '@candio/shared';
import { EMAIL_SOURCES, SECTOR_KEY_TO_LABELS } from '@candio/shared';
import type { Company as DbCompany } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { levenshteinSimilarity } from '../../lib/levenshtein';
import { classifyReplySentiment } from '../../tasks/reply-matching';
import { isOptedOut, matchesOptOut } from '../optout/optout.service';

// Gestion des entreprises cibles : saisie manuelle ou import CSV.

function toDTO(c: DbCompany): Company {
  // BOUNCE-01 : parse le JSON des alternatives (stocké en string SQLite).
  const raw = c as DbCompany & { emailSource?: string; emailAlternatives?: string; blacklisted?: boolean };
  let emailAlternatives: string[] = [];
  try {
    const parsed = JSON.parse(raw.emailAlternatives ?? '[]');
    if (Array.isArray(parsed)) emailAlternatives = parsed as string[];
  } catch { /* malformed JSON — on renvoie un tableau vide */ }

  return {
    id: c.id,
    campaignId: c.campaignId,
    name: c.name,
    website: c.website,
    contactEmail: c.contactEmail,
    contactName: c.contactName,
    contactRole: c.contactRole,
    // FM-06 : champ blacklist.
    blacklisted: raw.blacklisted ?? false,
    // BOUNCE-01 : source de l'email et alternatives pour le bounce tracker.
    emailSource: (raw.emailSource ?? 'manual') as Company['emailSource'],
    emailAlternatives,
    // SCRAPE-01 : métadonnées d'enrichissement.
    region: (raw as typeof raw & { region?: string | null }).region ?? null,
    activityDomain: (raw as typeof raw & { activityDomain?: string | null }).activityDomain ?? null,
    companySize: (raw as typeof raw & { companySize?: string | null }).companySize ?? null,
    // SCRAPE-LOC : localisation structurée + secteur.
    country:           (raw as typeof raw & { country?: string | null }).country ?? null,
    regionAdmin:       (raw as typeof raw & { regionAdmin?: string | null }).regionAdmin ?? null,
    dept:              (raw as typeof raw & { dept?: string | null }).dept ?? null,
    deptName:          (raw as typeof raw & { deptName?: string | null }).deptName ?? null,
    city:              (raw as typeof raw & { city?: string | null }).city ?? null,
    sector:            (raw as typeof raw & { sector?: string | null }).sector ?? null,
    // SCRAPE-DESC : description courte de l'activité (site résumé par IA).
    description:       (raw as typeof raw & { description?: string | null }).description ?? null,
    companySizeBucket: (raw as typeof raw & { companySizeBucket?: string | null }).companySizeBucket ?? null,
    // SCRAPE-02 : scores de pertinence/fraîcheur.
    freshnessScore: (raw as typeof raw & { freshnessScore?: number }).freshnessScore ?? 0,
    relevanceScore: (raw as typeof raw & { relevanceScore?: number }).relevanceScore ?? 0,
  };
}

/**
 * FM-04 : retourne les entreprises de la campagne dont le nom est similaire
 * à `name` avec un score de Levenshtein normalisé > 0.8.
 */
export async function findSimilarCompanies(campaignId: string, name: string): Promise<Company[]> {
  const all = await prisma.company.findMany({ where: { campaignId } });
  return all
    .filter((c) => levenshteinSimilarity(c.name, name) > 0.8)
    .map(toDTO);
}

export async function listByCampaign(campaignId: string): Promise<Company[]> {
  const rows = await prisma.company.findMany({
    where: { campaignId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toDTO);
}

export async function addCompany(input: CompanyInput): Promise<Company> {
  // RGPD : refuser l'ajout d'un contact figurant dans la liste « ne pas contacter ».
  if (await isOptedOut(input.contactEmail)) {
    throw new Error(`${input.contactEmail} figure dans la liste « ne pas contacter » (RGPD) — ajout refusé.`);
  }
  try {
    const c = await prisma.company.create({ data: input });
    return toDTO(c);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error(`L'email ${input.contactEmail} existe déjà dans cette campagne.`);
    }
    throw err;
  }
}

const PROTECTED_APP_STATUSES = new Set(['SENDING', 'SENT', 'REPLIED', 'FOLLOWED_UP']);

async function assertCompanyDeletable(companyId: string): Promise<void> {
  const app = await prisma.application.findUnique({ where: { companyId } });
  if (app && PROTECTED_APP_STATUSES.has(app.status)) {
    throw new Error(
      'Impossible de supprimer : une candidature a déjà été envoyée à cette entreprise.'
    );
  }
}

// Supprime une entreprise (et sa candidature, par cascade).
export async function deleteCompany(id: string): Promise<void> {
  await assertCompanyDeletable(id);
  await prisma.company.delete({ where: { id } });
}

// UX-8v2 : suppression en masse des entreprises sélectionnées.
export async function bulkDeleteCompanies(ids: string[]): Promise<{ deleted: number }> {
  for (const id of ids) {
    await assertCompanyDeletable(id);
  }
  const result = await prisma.company.deleteMany({ where: { id: { in: ids } } });
  return { deleted: result.count };
}

// UX-2 : mise à jour d'une entreprise cible.
export async function updateCompany(
  id: string,
  input: Omit<CompanyInput, 'campaignId'>
): Promise<Company> {
  // DELIV-01 : si l'utilisateur modifie l'adresse email, on considère qu'il l'a
  // vérifiée/corrigée à la main → emailSource repasse à 'manual' (adresse de
  // confiance), ce qui débloque l'envoi même si l'email était auparavant un
  // pattern généré. On ne touche pas emailSource si seul le nom/site change.
  const existing = await prisma.company.findUnique({ where: { id } });
  const emailChanged = !!existing && existing.contactEmail !== input.contactEmail;

  const c = await prisma.company.update({
    where: { id },
    data: {
      name: input.name,
      website: input.website,
      contactEmail: input.contactEmail,
      contactName: input.contactName,
      contactRole: input.contactRole,
      ...(emailChanged ? { emailSource: 'manual' } : {}),
    } as Prisma.CompanyUpdateInput,
  });
  return toDTO(c);
}

/**
 * FM-06 : définit le statut blacklist d'une entreprise.
 */
export async function setBlacklisted(id: string, blacklisted: boolean): Promise<Company> {
  const c = await prisma.company.update({
    where: { id },
    data: { blacklisted } as { blacklisted: boolean },
  });
  return toDTO(c);
}

/**
 * BOUNCE-01 : retourne le prochain email alternatif à essayer pour une entreprise.
 * L'email courant est retiré de la liste des alternatives et l'entreprise est
 * mise à jour avec le nouvel email. Retourne null si aucune alternative n'existe.
 */
export async function retryWithAlternativeEmail(
  companyId: string
): Promise<{ nextEmail: string } | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return null;

  const raw = company as typeof company & { emailAlternatives?: string };
  let alternatives: string[] = [];
  try {
    const parsed = JSON.parse(raw.emailAlternatives ?? '[]');
    if (Array.isArray(parsed)) alternatives = parsed as string[];
  } catch { /* ignore */ }

  if (alternatives.length === 0) return null;

  const [nextEmail, ...remaining] = alternatives;
  // Met à jour l'entreprise avec le nouvel email et retire-le des alternatives.
  await (prisma.company.update as Function)({
    where: { id: companyId },
    data: {
      contactEmail: nextEmail,
      emailAlternatives: JSON.stringify(remaining),
      emailSource: 'pattern',
    },
  });

  // Remet la candidature à FAILED pour permettre une nouvelle génération/envoi.
  const app = await prisma.application.findUnique({ where: { companyId } });
  if (app) {
    await (prisma.application.update as Function)({
      where: { id: app.id },
      data: {
        status: 'FAILED',
        errorMessage: `Email précédent (${company.contactEmail}) a rebondi — réessai avec ${nextEmail}`,
        emailBounced: false,
        emailBouncedAt: null,
      },
    });
  }

  return { nextEmail };
}

/**
 * SCRAPE-02 : retourne la liste dédupliquée des domaines de tous les sites
 * d'entreprises présentes en base (toutes campagnes confondues).
 * Utilisé par scraping.ipc.ts pour générer le fichier --exclude-file.
 */
export async function listAllDomains(): Promise<string[]> {
  const all = await prisma.company.findMany({ select: { website: true } });
  const domains = new Set<string>();
  for (const { website } of all) {
    if (!website) continue;
    try {
      const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
      if (host) domains.add(host.replace(/^www\./, ''));
    } catch { /* URL malformée — on ignore */ }
  }
  return [...domains];
}

/**
 * SCRAPE-FEEDBACK : données de rétroaction historique pour le scraper Python.
 * Retourne les domaines des entreprises ayant répondu, bounced, ou ignoré
 * les candidatures précédentes — utilisé pour ajuster le scoring automatiquement.
 */
export async function listFeedbackData(): Promise<{
  replied: string[];
  rejected: string[];
  bounced: string[];
  noReply: string[];
}> {
  function extractDomain(website: string | null): string {
    if (!website) return '';
    try {
      const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
      return host.replace(/^www\./, '');
    } catch { return ''; }
  }

  // Relation 1:1 Company <-> Application (champ : application Application?)
  // Entreprises qui ont répondu (application.status === 'REPLIED').
  // Strat #1 : on récupère aussi manualStatus + replyContent pour distinguer une
  // réponse POSITIVE d'un REFUS (le refus ne donne qu'un mini-signal délivrabilité).
  const repliedCompanies = await prisma.company.findMany({
    where: { application: { status: 'REPLIED' } },
    select: {
      website: true,
      application: { select: { manualStatus: true, replyContent: true } },
    },
  });

  // Entreprises dont l'email a bounced (emailBounced peut être absent du client généré
  // si prisma generate n'a pas été relancé après la migration BOUNCE-01)
  type BouncedRow = { website: string | null };
  let bouncedCompanies: BouncedRow[] = [];
  try {
    bouncedCompanies = await prisma.$queryRaw<BouncedRow[]>`
      SELECT c.website
      FROM "Company" c
      JOIN "Application" a ON a."companyId" = c.id
      WHERE a."emailBounced" = 1
    `;
  } catch { /* champ absent de la DB → on ignore les bounces */ }

  // Entreprises contactées + relancées sans réponse (FOLLOWED_UP = 2 contacts, toujours sans réponse)
  const noReplyCompanies = await prisma.company.findMany({
    where: { application: { status: 'FOLLOWED_UP' } },
    select: { website: true },
  });

  type Row = { website: string | null };

  // Strat #1 : ventile les domaines ayant répondu entre POSITIF et REFUS.
  // Refus = manualStatus === 'REJECTED' (confirmé par l'utilisateur) OU, à défaut,
  // sentiment de la réponse classé 'rejection'. Un statut manuel positif
  // (INTERVIEWED/OFFER/ACCEPTED) force le POSITIF. L'intérêt prime sur le refus
  // si les deux existent pour un même domaine (plusieurs contacts).
  type ReplyRow = {
    website: string | null;
    application: { manualStatus: string | null; replyContent: string | null } | null;
  };
  const positiveDomains = new Set<string>();
  const rejectedDomains = new Set<string>();
  for (const c of repliedCompanies as ReplyRow[]) {
    const dom = extractDomain(c.website);
    if (!dom) continue;
    const ms = (c.application?.manualStatus ?? '').toUpperCase();
    let isRejection: boolean;
    if (ms === 'REJECTED') {
      isRejection = true;
    } else if (ms === 'INTERVIEWED' || ms === 'OFFER' || ms === 'ACCEPTED') {
      isRejection = false;
    } else {
      isRejection = classifyReplySentiment(c.application?.replyContent) === 'rejection';
    }
    (isRejection ? rejectedDomains : positiveDomains).add(dom);
  }
  for (const d of positiveDomains) rejectedDomains.delete(d); // l'intérêt prime

  const replied  = [...positiveDomains];
  const rejected = [...rejectedDomains];
  const bounced  = [...new Set(bouncedCompanies.map((c: BouncedRow) => extractDomain(c.website)).filter(Boolean))];
  const noReply  = [...new Set(noReplyCompanies.map((c: Row) => extractDomain(c.website)).filter(Boolean))];

  return { replied, rejected, bounced, noReply };
}

// Validation email minimale (suffisante pour filtrer les lignes CSV vides/erronées).
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * B1 : détecte le délimiteur dominant de la première ligne du CSV.
 * Couvre les exports Excel français (';'), TSV ('\t') et les CSV US (',').
 */
function detectDelimiter(firstLine: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Parser CSV à état — gère les champs entre guillemets, les guillemets
 * échappés ("") ET les sauts de ligne à l'intérieur d'un champ entre
 * guillemets (cas fréquent avec Excel/Google Sheets/LinkedIn export).
 *
 * Renvoie un tableau de lignes (chaque ligne = tableau de champs).
 */
function parseCsv(content: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    // On ignore les lignes 100 % vides (entre deux \n par ex.).
    if (row.length > 0 && row.some((f) => f !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"' && content[i + 1] === '"') {
        field += '"';
        i++; // Guillemet échappé : "" → "
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === '\r' || ch === '\n') {
      pushField();
      pushRow();
      if (ch === '\r' && content[i + 1] === '\n') i++; // Saute \r\n d'un coup.
    } else {
      field += ch;
    }
  }
  // Dernière ligne sans saut de ligne final.
  if (field !== '' || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

// Ligne d'entreprise prête à insérer, sans le campaignId (ajouté par l'appelant).
type ParsedCompanyRow = Omit<Prisma.CompanyCreateManyInput, 'campaignId'>;

/**
 * Parse le contenu d'un CSV d'entreprises (scraper OU export manuel/LinkedIn) en
 * lignes prêtes à insérer. Gère le délimiteur, le format LinkedIn et toutes les
 * colonnes d'enrichissement optionnelles. Les lignes sans nom ou sans email
 * valide sont ignorées et comptées dans `skipped`.
 *
 * Source unique de vérité du mapping CSV → Company : réutilisé par
 * `importCsvContent` (import manuel) ET `importLeadsFromMasterContent` (auto).
 */
function parseCompanyCsvRows(content: string): { rows: ParsedCompanyRow[]; skipped: number } {
  // B1 : détecter le délimiteur depuis la 1re ligne (Excel FR → ';', TSV → '\t').
  const firstLine = content.split(/\r?\n/)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const rows = parseCsv(content, delimiter);
  if (rows.length < 2) return { rows: [], skipped: 0 };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());

  // INT-4 : détection du format LinkedIn (colonnes 'first name' + 'company').
  // Si détecté, on mappe les colonnes LinkedIn vers notre format interne avant
  // la validation standard.
  const isLinkedIn = col('first name') !== -1 && col('company') !== -1;

  let iName: number;
  let iEmail: number;
  let iWebsite: number;
  let iContactName: number;
  let iContactRole: number;

  if (isLinkedIn) {
    // INT-4 : mapping des colonnes LinkedIn → format interne.
    iName = col('company');
    iEmail = col('email address');
    iWebsite = col('website'); // peut être -1
    iContactName = -2; // colonne virtuelle construite ci-dessous
    iContactRole = col('position');
  } else {
    iName = col('name');
    iEmail = col('contactemail');
    iWebsite = col('website');
    iContactName = col('contactname');
    iContactRole = col('contactrole');
  }

  // BOUNCE-01 : colonnes optionnelles du scraper.
  const iEmailSource       = col('emailsource');
  const iEmailAlternatives = col('emailalternatives');
  // SCRAPE-01 : métadonnées d'enrichissement.
  const iRegion         = col('region');
  const iActivityDomain = col('activitydomain');
  const iCompanySize    = col('companysize');
  // SCRAPE-LOC : localisation structurée + secteur (colonnes optionnelles).
  const iCountry           = col('country');
  const iRegionAdmin       = col('regionadmin');
  const iDept              = col('dept');
  const iDeptName          = col('deptname');
  const iCity              = col('city');
  const iSector            = col('sector');
  const iDescription       = col('companydescription');
  const iCompanySizeBucket = col('companysizebucket');
  // SCRAPE-02 : scores.
  const iFreshness      = col('freshnessscore');
  const iRelevance      = col('relevancescore');

  // M4 : détecter les colonnes obligatoires manquantes pour informer l'utilisateur
  // au lieu de silencieusement ignorer toutes les lignes.
  const missingCols: string[] = [];
  if (iName === -1)  missingCols.push('"name"');
  if (iEmail === -1) missingCols.push('"contactEmail"');
  if (missingCols.length > 0) {
    throw new Error(
      `Colonne(s) obligatoire(s) introuvable(s) dans le CSV : ${missingCols.join(', ')}.\n` +
      `En-têtes détectés : ${header.length > 0 ? header.join(', ') : '(aucun)'}`
    );
  }

  const iFirstName = isLinkedIn ? col('first name') : -1;
  const iLastName  = isLinkedIn ? col('last name')  : -1;

  // Pré-validation : séparer les lignes valides des lignes à ignorer.
  let skipped = 0;
  const validRows: ParsedCompanyRow[] = [];
  for (const cols of rows.slice(1)) {
    const at = (i: number) => (i >= 0 ? (cols[i] ?? '').trim() : '');
    const name = at(iName);
    const email = at(iEmail);
    if (!name || !isEmail(email)) { skipped++; continue; }

    // INT-4 : construire contactName depuis first name + last name si LinkedIn.
    let contactName: string | null;
    if (isLinkedIn && iFirstName !== -1) {
      const first = at(iFirstName);
      const last  = iLastName !== -1 ? at(iLastName) : '';
      contactName = [first, last].filter(Boolean).join(' ') || null;
    } else {
      contactName = at(iContactName) || null;
    }

    // BOUNCE-01 : parse emailSource + emailAlternatives depuis le CSV du scraper.
    // emailAlternatives est encodé en pipe-séparé dans le CSV ("alt1|alt2|alt3").
    const rawSource = iEmailSource >= 0 ? at(iEmailSource) : '';
    // Sources email connues du scraper — préservées telles quelles (sinon → 'manual').
    // Point #1 (audit 3) : dérivé de la taxonomie UNIQUE @candio/shared (plus de
    // tableau dupliqué qui diverge du contrat).
    const emailSource = (EMAIL_SOURCES as readonly string[]).includes(rawSource) ? rawSource : 'manual';

    const rawAlts = iEmailAlternatives >= 0 ? at(iEmailAlternatives) : '';
    const emailAlternatives = rawAlts
      ? JSON.stringify(rawAlts.split('|').map((s) => s.trim()).filter(Boolean))
      : '[]';

    validRows.push({
      name,
      contactEmail: email,
      website: at(iWebsite) || null,
      contactName,
      contactRole: at(iContactRole) || null,
      emailSource,
      emailAlternatives,
      // SCRAPE-01 : métadonnées d'enrichissement (optionnelles).
      region:         iRegion >= 0 ? at(iRegion) || null : null,
      activityDomain: iActivityDomain >= 0 ? at(iActivityDomain) || null : null,
      companySize:    iCompanySize >= 0 ? at(iCompanySize) || null : null,
      // SCRAPE-LOC : localisation structurée + secteur (optionnelles).
      country:           iCountry >= 0 ? at(iCountry) || null : null,
      regionAdmin:       iRegionAdmin >= 0 ? at(iRegionAdmin) || null : null,
      dept:              iDept >= 0 ? at(iDept) || null : null,
      deptName:          iDeptName >= 0 ? at(iDeptName) || null : null,
      city:              iCity >= 0 ? at(iCity) || null : null,
      sector:            iSector >= 0 ? at(iSector) || null : null,
      // SCRAPE-DESC : description d'activité (site résumé par IA).
      description:       iDescription >= 0 ? at(iDescription) || null : null,
      companySizeBucket: iCompanySizeBucket >= 0 ? at(iCompanySizeBucket) || null : null,
      freshnessScore: iFreshness >= 0 ? (parseInt(at(iFreshness), 10) || 0) : 0,
      relevanceScore: iRelevance >= 0 ? (parseInt(at(iRelevance), 10) || 0) : 0,
    } as ParsedCompanyRow);
  }

  return { rows: validRows, skipped };
}

/**
 * SECTOR-PREF : ne garde que les lignes dont le secteur correspond aux clés
 * préférées (élargit si trop peu). Vide = aucun filtre. Logique partagée entre
 * l'import manuel (filtre seul) et l'import auto (déjà filtré par lieu en amont).
 */
function filterBySectors(rows: ParsedCompanyRow[], prefKeys: string[]): { rows: ParsedCompanyRow[]; widened: boolean } {
  const keys = prefKeys.map((s) => s.trim()).filter(Boolean);
  if (keys.length === 0) return { rows, widened: false };
  const wanted = new Set(
    keys.flatMap((k) => SECTOR_KEY_TO_LABELS[k] ?? []).map((l) => l.toLowerCase()),
  );
  const inPref = (r: ParsedCompanyRow) => wanted.has(String(r.sector ?? '').trim().toLowerCase());
  const preferred = rows.filter(inPref);
  const others = rows.filter((r) => !inPref(r));
  const MIN_PREFERRED = 25;
  if (preferred.length >= MIN_PREFERRED) return { rows: preferred, widened: false };
  // Trop peu dans les secteurs voulus → on élargit (préférés d'abord, puis les autres).
  return { rows: [...preferred, ...others], widened: others.length > 0 };
}

/**
 * Importe des entreprises depuis le contenu d'un fichier CSV (import manuel).
 * Colonnes attendues (1re ligne = en-têtes, ordre indifférent) :
 * name, contactEmail, website, contactName, contactRole. Les lignes sans nom
 * ou sans email valide sont ignorées et comptées dans `skipped`.
 */
export async function importCsvContent(
  campaignId: string,
  content: string
): Promise<{ added: number; skipped: number }> {
  const { rows: validRows, skipped } = parseCompanyCsvRows(content);
  if (validRows.length === 0) return { added: 0, skipped };

  // SECTOR-PREF : filtre par secteurs préférés de la campagne (élargit si trop peu).
  let rowsToInsert = validRows;
  try {
    const camp = await prisma.campaign.findUnique({
      where: { id: campaignId }, select: { preferredSectors: true },
    });
    const prefKeys = (camp?.preferredSectors ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    rowsToInsert = filterBySectors(validRows, prefKeys).rows;
  } catch { /* pas de campagne / colonne absente → import complet */ }

  // RGPD : retire les contacts de la liste « ne pas contacter » avant insertion.
  const optOuts = await prisma.optOut.findMany({ select: { value: true, kind: true } });
  const beforeOptOut = rowsToInsert.length;
  rowsToInsert = rowsToInsert.filter((r) => !matchesOptOut(r.contactEmail, optOuts));
  const optedOutSkipped = beforeOptOut - rowsToInsert.length;

  // H4 : insertion ligne à ligne avec skip des emails déjà présents (P2002).
  let added = 0;
  let duplicatesSkipped = 0;
  for (const row of rowsToInsert) {
    try {
      await prisma.company.create({ data: { ...row, campaignId } });
      added++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        duplicatesSkipped++;
      } else {
        throw new Error(
          `Erreur à la ligne ${added + duplicatesSkipped + skipped + 1} ` +
          `(${added} entreprise(s) déjà ajoutée(s) avant l'erreur) — ` +
          `${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return { added, skipped: skipped + duplicatesSkipped + optedOutSkipped };
}

/**
 * SECTOR-AUTO : clé d'identité d'un lead/entreprise (`nom|email|site`, minuscule).
 * Doit rester IDENTIQUE au format produit par `scraping:listLeads` côté UI, afin
 * que la déduplication inter-campagnes et le marquage « déjà utilisée » concordent.
 */
function leadKey(name: string, email: string, website: string | null | undefined): string {
  return `${name}|${email}|${website ?? ''}`.toLowerCase();
}

/**
 * SECTOR-AUTO : clés de tous les leads déjà présents en base (toutes campagnes
 * confondues) — sert à ne jamais re-proposer une entreprise déjà contactée.
 */
export async function listUsedLeadKeys(): Promise<string[]> {
  const all = await prisma.company.findMany({ select: { name: true, contactEmail: true, website: true } });
  return all.map((c) => leadKey(c.name, c.contactEmail, c.website));
}

/**
 * SECTOR-AUTO : pré-remplit une campagne depuis le master de leads.
 * - Filtre par lieu (ville / département / région) si renseigné — repli sur tous
 *   les leads si aucun ne correspond au lieu (pour ne pas créer une campagne vide).
 * - Filtre par secteurs préférés (élargit si < 25 dans les secteurs voulus).
 * - Exclut les leads déjà utilisés dans une campagne.
 * - Trie par score (pertinence + fraîcheur) décroissant et plafonne à `limit`.
 */
export async function importLeadsFromMasterContent(
  campaignId: string,
  content: string,
  opts: { sectors: string[]; location: string; limit: number },
): Promise<{ added: number; matched: number; skippedUsed: number; widened: boolean; capped: boolean }> {
  const { rows: allRows } = parseCompanyCsvRows(content);
  if (allRows.length === 0) return { added: 0, matched: 0, skippedUsed: 0, widened: false, capped: false };

  // 1) Filtre par lieu (ville / département / région). Repli si zéro correspondance.
  const loc = opts.location.trim().toLowerCase();
  let widened = false;
  let pool = allRows;
  if (loc) {
    const locMatch = (r: ParsedCompanyRow) =>
      [r.city, r.deptName, r.regionAdmin].some((v) => String(v ?? '').trim().toLowerCase() === loc);
    const located = allRows.filter(locMatch);
    if (located.length > 0) pool = located;
    else widened = true; // aucun lead pour ce lieu → on garde tous les leads.
  }

  // 2) Filtre par secteurs préférés (élargit si trop peu).
  const sectorFiltered = filterBySectors(pool, opts.sectors);
  pool = sectorFiltered.rows;
  widened = widened || sectorFiltered.widened;
  const matched = pool.length;

  // 3) Exclut les leads déjà utilisés dans une campagne (toutes campagnes) ET
  //    les contacts de la liste « ne pas contacter » (RGPD).
  const usedKeys = new Set(await listUsedLeadKeys());
  const optOuts = await prisma.optOut.findMany({ select: { value: true, kind: true } });
  const before = pool.length;
  const fresh = pool.filter(
    (r) => !usedKeys.has(leadKey(r.name, r.contactEmail, r.website)) && !matchesOptOut(r.contactEmail, optOuts),
  );
  const skippedUsed = before - fresh.length;

  // 4) Tri par score décroissant (pertinence + fraîcheur) puis plafond.
  fresh.sort((a, b) =>
    (Number(b.relevanceScore ?? 0) + Number(b.freshnessScore ?? 0)) -
    (Number(a.relevanceScore ?? 0) + Number(a.freshnessScore ?? 0)));
  const capped = fresh.length > opts.limit;
  const toInsert = fresh.slice(0, opts.limit);

  // 5) Insertion (skip des doublons d'email dans la campagne — P2002).
  let added = 0;
  for (const row of toInsert) {
    try {
      await prisma.company.create({ data: { ...row, campaignId } });
      added++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
      throw err;
    }
  }

  return { added, matched, skippedUsed, widened, capped };
}
