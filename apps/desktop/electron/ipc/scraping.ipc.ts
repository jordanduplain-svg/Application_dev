/**
 * scraping.ipc.ts — Handlers IPC du scraper Python.
 *
 * Spawn le script scrape_leads.py dans un processus enfant, stream sa sortie
 * vers le renderer ligne par ligne via l'événement `scraping:progress`, puis
 * notifie la fin avec le chemin du CSV généré.
 *
 * La configuration (chemins, schedule) est persistée dans un fichier JSON
 * dans userData (même stratégie que les secrets, mais non chiffrée).
 */

import { spawn, type ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readFile } from 'fs';
import { shell } from 'electron';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { app, BrowserWindow } from 'electron';
import type { ScrapingConfig, ScrapingJobStatus } from '@candio/shared';
import { DEFAULT_SCORING_WEIGHTS } from '@candio/shared';
import { handle } from './registry';
import { logger } from '../../src/lib/logger';
import { getHunterKey, getImap, getOpenaiKey, getAnthropicKey } from '../../src/lib/secrets';
import * as companyService from '../../src/modules/company/company.service';

// ── Persistance de la config ──────────────────────────────────────────────────

const CONFIG_FILE = 'scraping-config.json';
function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE);
}

const DEFAULT_CONFIG: ScrapingConfig = {
  sector: 'data analyst',
  industry: '',             // vide = fallback sur sector pour Kompass/PJ
  city: 'Paris',
  sources: ['wttj', 'indeed'],
  max: 300,
  hunterKey: '',
  hunterMaxSearches: 20,   // plafond recherches Hunter/run (free = 50 crédits/mois)
  pythonPath: 'python',
  scriptPath: join(app.getAppPath(), '..', '..', 'scripts', 'scrape_leads.py'),
  validator: 'none',
  validatorKey: '',
  // SCRAPE-03 : sources d'enrichissement email.
  emailSources: ['web_crawl', 'hunter', 'pattern'],
  skipNoEmail: false,
  // (Snov.io / Apollo.io retirés — voir ScrapingConfig.)
  // SCRAPE-05 : nouvelles améliorations.
  pappersKey: '',
  // France Travail (ex-Pôle Emploi) — credentials OAuth, vides par défaut
  franceTravailId: '',
  franceTravailSecret: '',
  // Source email alerts (webhook) — réutilise les creds IMAP des Réglages
  alertsFolder: 'INBOX',
  alertsSinceDays: 7,
  // LLM extraction — Ollama (local, gratuit) activé PAR DÉFAUT. Si Ollama n'est
  // pas joignable, le pipeline le détecte (ping) et continue sans LLM. Coupe-circuit
  // côté Python si Ollama répond trop lentement. Changeable en OpenAI dans l'UI.
  llmProvider: '',   // désactivé par défaut — utile seulement avec GPU (trop lent sur CPU)
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:3b',   // modèle léger/rapide par défaut (évite les timeouts du 7b)
  // SCRAPE-DESC : modèle dédié aux descriptions (Phase 7b + bouton). Indépendant du
  // crawl : tâche légère (1 résumé/entreprise) → un 7B est rentable côté qualité FR.
  describeModel: 'qwen2.5:7b',
  describeProvider: 'ollama', // fiches : 'ollama' (local) ou 'openai' (cloud)
  llmApiKey: '',           // clé pour LLM cloud (OpenAI ou Claude selon le provider)
  llmBudget: 100,
  githubToken: '',
  useGithub: false,
  useSmtpBatch: false,
  proxies: '',
  fuzzyDedup: true,
  fuzzyThreshold: 0.85,
  parallelWorkers: 10,
  useClearbit: true,
  // SCRAPE-SCORE : scoring manuel.
  skipScoring: false,
  scoringWeights: null,   // null = poids par défaut du script Python
  // SCRAPE-06 : 10 améliorations.
  postedWithinDays: 0,
  sizeTarget: 'all',
  crawlBudgetSec: 25,
  maxRuntimeMin: 0,        // 0 = illimité
  pagesPerRun: 5,          // pages lues par source par run
  exploreNewPages: false,
  exploreSources: true,   // toujours actif — pagination auto inter-runs
  fastCrawl: true,
  findRecruiter: true,
  blacklistDomains: '',
  whitelistDomains: '',
};

// Sources/emailSources réellement proposées par l'UI actuelle.
// Mise à jour à chaque ajout/retrait de source dans ALL_SOURCES (ScrapingPage.tsx).
// kompass et pj réintégrés (proxy rotation disponible), hellowork ajouté.
const VALID_SOURCES = new Set(['email_alerts', 'wttj', 'apec', 'indeed', 'societe']);
const VALID_EMAIL_SOURCES = new Set(['web_crawl', 'hunter', 'linkedin', 'pattern']);

function readConfig(): ScrapingConfig {
  try {
    const p = configPath();
    if (!existsSync(p)) return DEFAULT_CONFIG;
    const merged = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(p, 'utf8')) } as ScrapingConfig;
    // Auto-nettoyage : retire les sources retirées de l'app d'une config héritée.
    if (Array.isArray(merged.sources)) {
      merged.sources = merged.sources.filter((s) => VALID_SOURCES.has(s));
    }
    if (Array.isArray(merged.emailSources)) {
      merged.emailSources = merged.emailSources.filter((s) => VALID_EMAIL_SOURCES.has(s));
    }
    // Migration : l'ancien modèle Ollama par défaut (7b, lent → timeouts) est
    // remplacé par le léger qwen2.5:3b. On ne touche pas un modèle choisi à la main.
    if (merged.ollamaModel === 'qwen2.5-coder:7b') {
      merged.ollamaModel = 'qwen2.5:3b';
    }
    // SCRAPE-DESC : modèle des descriptions par défaut si absent d'une config héritée.
    if (!merged.describeModel) merged.describeModel = 'qwen2.5:7b';
    // Clamp : max 3 secteurs d'activité (anti-explosion). Les configs héritées
    // avec plus de secteurs sont tronquées aux 3 premiers.
    if (typeof merged.industry === 'string' && merged.industry.includes(',')) {
      const parts = merged.industry.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length > 3) merged.industry = parts.slice(0, 3).join(',');
    }
    // Clamp : pages par run plafonnées à 5.
    if (merged.pagesPerRun && merged.pagesPerRun > 5) merged.pagesPerRun = 5;
    // Clamp : max entreprises borné [10, 300] (illimité retiré → 0 ou >300 ramené à 300).
    if (!merged.max || merged.max <= 0 || merged.max > 300) merged.max = 300;
    return merged;
  } catch { return DEFAULT_CONFIG; }
}

function writeConfig(c: ScrapingConfig): void {
  writeFileSync(configPath(), JSON.stringify(c, null, 2), 'utf8');
}

/**
 * SCRAPE-DESC : suggère un modèle Ollama plus léger quand le modèle courant est trop
 * lourd pour la machine (l'IA « saute » : coupe-circuit / bascule en texte brut).
 * Retourne '' si le modèle est déjà léger (≤ 3B) ou inconnu.
 */
function lighterDescribeModel(current: string): string {
  const m = (current || '').toLowerCase();
  // Déjà léger (0.5B–3B) → rien à suggérer.
  if (/:(0\.5|1|1\.5|2|3)b/.test(m)) return '';
  // Modèles lourds (7B et plus) → qwen2.5:3b (rapide, JSON fiable, bon FR pour sa taille).
  if (/:(7|8|9|1[0-9]|[2-9][0-9])b/.test(m)) return 'qwen2.5:3b';
  return '';
}

// ── LEADS-VIEW : utilitaires CSV pour le master de leads scrapés ──────────────

/** Chemin du master candio_leads.csv (data/ puis repli legacy). */
function masterCsvPath(): string | null {
  const scriptDir = join(readConfig().scriptPath, '..');
  const inData = join(scriptDir, 'data', 'candio_leads.csv');
  if (existsSync(inData)) return inData;
  const legacy = join(scriptDir, 'candio_leads.csv');
  return existsSync(legacy) ? legacy : null;
}

// Détecteur « domaine louche » (miroir de candio_scraper/lead_quality.py) : permet
// de flaguer les leads EXISTANTS sans attendre une régénération du CSV.
const _LEAD_LEGAL = new Set(['sas', 'sasu', 'sa', 'sarl', 'eurl', 'sci', 'gie', 'scp', 'snc', 'selarl',
  'groupe', 'group', 'france', 'europe', 'international', 'holding', 'sud', 'est', 'ouest', 'nord',
  'centre', 'compagnie', 'cie', 'ets', 'etablissements', 'etablissement', 'societe', 'ste']);
function _leadNorm(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function _domainLabel(url: string): string {
  if (!url) return '';
  const host = _leadNorm(url).replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  const parts = host.split('.').filter(Boolean);
  if (!parts.length) return '';
  const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return label.replace(/[^a-z0-9]/g, '');
}
function isDomainSuspect(name: string, website: string, email = ''): boolean {
  let dom = _domainLabel(website);
  if (!dom && email.includes('@')) {
    const edom = email.split('@')[1] || '';
    if (!/(gmail|yahoo|hotmail|outlook|orange|free|sfr|laposte|wanadoo|icloud)\./.test(edom)) dom = _domainLabel(edom);
  }
  if (!dom) return false;
  const toks = _leadNorm(name).split(/[^a-z0-9]+/).filter((t) => t && !_LEAD_LEGAL.has(t));
  if (!toks.length) return false;
  for (const t of toks) {
    if (t.length >= 3 && (dom.includes(t) || t.includes(dom))) return false;
    if (t.length >= 4) { for (let i = 0; i + 4 <= t.length; i++) if (dom.includes(t.slice(i, i + 4))) return false; }
  }
  const acro = toks.map((t) => t[0]).join('');
  if (acro.length >= 2 && (dom.startsWith(acro) || dom.includes(acro))) return false;
  return true;
}

/** Parseur CSV minimal (gère les guillemets, les virgules et sauts de ligne échappés). */
function parseCsvFile(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

/** Sérialise une ligne CSV (échappe les champs contenant , " ou saut de ligne). */
function toCsvLine(fields: string[]): string {
  return fields.map((f) => {
    const v = f ?? '';
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');
}

// ── Checkpoint (miroir de ScrapingCheckpoint.make_run_id en Python) ──────────

/**
 * Reproduit exactement la logique Python :
 *   md5(f"{sector.lower()}|{city.lower()}|{date.today().isoformat()}")[:10]
 * Le résultat est stable pour la même combinaison sector+city le même jour.
 */
function checkpointFilePath(sector: string, city: string): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const raw   = `${sector.toLowerCase()}|${city.toLowerCase()}|${today}`;
  const runId = createHash('md5').update(raw).digest('hex').slice(0, 10);
  return join(homedir(), '.cache', 'carreer-ops', `checkpoint-${runId}.json`);
}

// ── État du job courant ───────────────────────────────────────────────────────

let activeProcess: ChildProcess | null = null;
let jobStatus: ScrapingJobStatus = 'idle';
let lastCsvPath: string | null = null;
let lastCsvLines = 0;   // nombre de lignes du CSV (hors header)
// SCRAPE-DESC : un enrichissement de fiches tourne-t-il ? Permet à la page Leads de se
// reconnecter (afficher la progression, recharger à la fin) si on l'a quittée puis rouverte.
let enrichRunning = false;

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

function pushProgress(line: string, done = false, csvPath: string | null = null): void {
  getWindow()?.webContents.send('scraping:progress', { line, done, csvPath });
}

// ── Lancement du script ───────────────────────────────────────────────────────

async function launchScript(
  config: ScrapingConfig,
  overrides: {
    enrich_only?: boolean;
    enrich_csv?: string;
    resume?: boolean;
    linkedin_csv?: string;
  } = {},
): Promise<void> {
  if (activeProcess) {
    logger.warn('Scraping déjà en cours — appel ignoré.');
    return;
  }

  // Garde-fou final : même si une config héritée arrive ici (renderer pas
  // rafraîchi, schedule ancien…), on ne transmet JAMAIS au scraper Python une
  // source/email-source retirée de l'app. C'est la dernière ligne de défense.
  const cleanSources      = (config.sources ?? []).filter((s) => VALID_SOURCES.has(s));
  const cleanEmailSources = (config.emailSources ?? []).filter((s) => VALID_EMAIL_SOURCES.has(s));

  const args: string[] = [
    // -u : Python en mode unbuffered. Sans ça, stdout est block-buffered quand piped
    // à Electron → l'utilisateur ne voit rien tant que ~4 KB de logs ne sont pas accumulés
    // (apparence d'un script "qui ne démarre pas").
    '-u',
    config.scriptPath,
    '--sector', config.sector,
    '--city', config.city,
    // Si cleanSources est vide (toutes décochées ou config héritée filtrée),
    // ne pas passer --sources "" → Python utilisera son DEFAULT_SOURCES.
    ...(cleanSources.length > 0 ? ['--sources', cleanSources.join(',')] : []),
    '--max', String(config.max),
    '--delay', '1.5',
    // Sortie FORCÉE dans scripts/data/ (données séparées du code). Explicite ici
    // pour être déterministe quel que soit le défaut Python / l'état du build.
    '--output', join(config.scriptPath, '..', 'data'),
  ];
  // SCRAPE-02 : domaine d'activité pour les annuaires (Kompass/PJ).
  // Permet de cibler des entreprises sans offre active (candidatures spontanées).
  if (config.industry?.trim()) {
    args.push('--industry', config.industry.trim());
  }
  // Clé Hunter : priorité à la config du scraper, fallback sur le secret Réglages.
  // Point #14 (audit) : transmise via variable d'env (spawnEnv.HUNTER_API_KEY)
  // et NON en argument CLI — un argument est visible dans la liste des processus.
  const effectiveHunterKey = config.hunterKey?.trim() || getHunterKey() || '';
  // Plafond de recherches Hunter.io par run (protège le quota free = 50/mois).
  // Modifiable dans l'UI ; augmentable si plan payant. Toujours transmis (défaut 20).
  if (typeof config.hunterMaxSearches === 'number' && config.hunterMaxSearches >= 0) {
    args.push('--hunter-max-searches', String(Math.floor(config.hunterMaxSearches)));
  }
  // SCRAPE-02 : validation d'email via service tiers.
  if (config.validator && config.validator !== 'none') {
    args.push('--validator', config.validator);
    if (config.validatorKey?.trim()) {
      args.push('--validator-key', config.validatorKey.trim());
    }
  }
  // SCRAPE-03 : sources d'enrichissement email (filtrées des ids retirés).
  if (cleanEmailSources.length) {
    args.push('--email-sources', cleanEmailSources.join(','));
  }
  if (config.skipNoEmail) {
    args.push('--skip-no-email');
  }
  // Snov.io / Apollo.io / France Travail retirés : inscriptions API trop pénibles
  // (Snov/Apollo) ou clé impossible à obtenir sans site web (France Travail).
  // L'enrichissement repose désormais sur crawler web + Hunter + LinkedIn+SMTP.
  // SCRAPE-05 : Pappers (annuaire entreprises FR).
  if (config.pappersKey?.trim()) {
    args.push('--pappers-key', config.pappersKey.trim());
  }
  // Source "email alerts" (webhook) : si sélectionnée, on injecte les credentials IMAP
  // déjà configurés dans Carreer-ops (Réglages). Python lit alors la boîte mail et parse
  // les alertes emploi (WTTJ, Indeed, APEC, LinkedIn…).
  if (config.sources.includes('email_alerts')) {
    const imap = getImap();
    if (imap) {
      args.push('--imap-host', imap.host);
      args.push('--imap-port', String(imap.port));
      args.push('--imap-user', imap.user);
      args.push('--imap-pass', imap.pass);
      if (config.alertsFolder?.trim())   args.push('--imap-folder', config.alertsFolder.trim());
      if (config.alertsSinceDays)        args.push('--alerts-since-days', String(config.alertsSinceDays));
    } else {
      logger.warn('[SCRAPING] Source email_alerts sélectionnée mais IMAP non configuré dans Réglages.');
    }
  }
  // LLM extraction (Ollama local par défaut, ou OpenAI/Claude cloud) — améliore
  // le crawl emails/recruteurs. La clé cloud est passée via spawnEnv (cf. plus bas).
  if (config.llmProvider) {
    args.push('--llm', config.llmProvider);
    if (config.ollamaUrl)   args.push('--ollama-url',   config.ollamaUrl);
    if (config.ollamaModel) args.push('--ollama-model', config.ollamaModel);
    if (config.llmBudget && config.llmBudget > 0) {
      args.push('--llm-budget', String(config.llmBudget));
    }
  }
  // SCRAPE-DESC : fiches entreprise/actualités (Phase 7b), INDÉPENDANT du LLM de
  // crawl ci-dessus — tournent même si le crawl LLM est désactivé.
  // (--ollama-url déjà passé si le crawl LLM est actif → on évite le doublon.)
  if (!config.llmProvider && config.ollamaUrl) args.push('--ollama-url', config.ollamaUrl);
  // Provider des fiches : ollama (local) | openai | claude. Les modèles cloud sont
  // imposés ici (gpt-4o-mini / claude-haiku-4-5) ; describeModel ne sert qu'à Ollama.
  const fichesProvider = config.describeProvider || 'ollama';
  args.push('--describe-provider', fichesProvider);
  if (fichesProvider === 'openai') args.push('--describe-model', 'gpt-4o-mini');
  else if (fichesProvider === 'claude') args.push('--describe-model', 'claude-haiku-4-5');
  else if (config.describeModel) args.push('--describe-model', config.describeModel);
  if (config.githubToken?.trim()) {
    args.push('--github-token', config.githubToken.trim());
  }
  if (config.useGithub)    args.push('--use-github');
  if (config.useSmtpBatch) args.push('--smtp-batch');
  if (config.proxies?.trim()) {
    args.push('--proxies', config.proxies.trim());
  }
  if (config.fuzzyDedup === false)  args.push('--no-fuzzy-dedup');
  if (config.fuzzyThreshold && config.fuzzyThreshold !== 0.85) {
    args.push('--fuzzy-threshold', String(config.fuzzyThreshold));
  }
  if (config.parallelWorkers && config.parallelWorkers !== 10) {
    args.push('--parallel-workers', String(config.parallelWorkers));
  }
  if (!config.useClearbit) args.push('--no-clearbit');
  // SCRAPE-SCORE : scoring configurable.
  if (config.skipScoring) {
    args.push('--no-scoring');
  } else if (config.scoringWeights) {
    // Sérialise les poids dans un fichier temporaire et passe son chemin au script.
    try {
      const weightsFile = join(tmpdir(), `carreer-ops-scoring-${Date.now()}.json`);
      writeFileSync(weightsFile, JSON.stringify(config.scoringWeights), 'utf8');
      args.push('--scoring-weights', weightsFile);
    } catch (err) {
      logger.warn('[SCRAPING] Impossible d\'écrire le fichier de scoring.', err);
    }
  }
  // Mode re-enrichissement / reprise
  if (overrides.enrich_only && overrides.enrich_csv) {
    args.push('--enrich-only', '--enrich-csv', overrides.enrich_csv);
  }
  if (overrides.resume) {
    args.push('--resume');
  }
  // Mode import LinkedIn Sales Navigator (CSV externe → enrichissement direct)
  if (overrides.linkedin_csv) {
    args.push('--linkedin-csv', overrides.linkedin_csv);
  }

  // SCRAPE-06 : nouvelles options.
  if (config.postedWithinDays > 0) {
    args.push('--posted-within-days', String(config.postedWithinDays));
  }
  if (config.sizeTarget && config.sizeTarget !== 'all') {
    args.push('--size-target', config.sizeTarget);
  }
  // Plafond de crawl par entreprise (réglage UI). Défaut 25 s si non défini.
  if (config.crawlBudgetSec && config.crawlBudgetSec > 0) {
    args.push('--crawl-budget', String(config.crawlBudgetSec));
  }
  if (config.exploreNewPages) args.push('--explore-new-pages');
  if (config.exploreSources)  args.push('--explore-sources');
  // Limite de temps globale (0 = illimité).
  if (config.maxRuntimeMin !== undefined && config.maxRuntimeMin > 0) {
    args.push('--max-runtime-min', String(config.maxRuntimeMin));
  }
  // Pages lues par run par source (1 | 5 | 10 | 25).
  if (config.pagesPerRun && config.pagesPerRun > 0) {
    args.push('--pages-per-run', String(config.pagesPerRun));
  }
  if (!config.fastCrawl)      args.push('--no-fast-crawl');
  if (!config.findRecruiter)  args.push('--no-find-recruiter');
  // Blacklist → fichier temp
  if (config.blacklistDomains?.trim()) {
    try {
      const blFile = join(tmpdir(), `carreer-ops-blacklist-${Date.now()}.txt`);
      writeFileSync(blFile, config.blacklistDomains.replace(/,/g, '\n'), 'utf8');
      args.push('--blacklist-file', blFile);
    } catch (err) { logger.warn('[SCRAPING] Écriture blacklist échouée.', err); }
  }
  // Whitelist → fichier temp
  if (config.whitelistDomains?.trim()) {
    try {
      const wlFile = join(tmpdir(), `carreer-ops-whitelist-${Date.now()}.txt`);
      writeFileSync(wlFile, config.whitelistDomains.replace(/,/g, '\n'), 'utf8');
      args.push('--whitelist-file', wlFile);
    } catch (err) { logger.warn('[SCRAPING] Écriture whitelist échouée.', err); }
  }
  // Feedback historique (données Carreer-ops)
  try {
    const feedback = await companyService.listFeedbackData();
    const hasData = feedback.replied.length || feedback.rejected.length
                 || feedback.bounced.length || feedback.noReply.length;
    if (hasData) {
      const fbFile = join(tmpdir(), `carreer-ops-feedback-${Date.now()}.json`);
      writeFileSync(fbFile, JSON.stringify({
        replied:  feedback.replied,
        rejected: feedback.rejected,   // Strat #1 : refus → mini-signal délivrabilité seulement
        bounced:  feedback.bounced,
        no_reply: feedback.noReply,
      }), 'utf8');
      args.push('--feedback-file', fbFile);
      logger.info(
        `[SCRAPING] Feedback : ${feedback.replied.length} replied, `
        + `${feedback.rejected.length} rejected, `
        + `${feedback.bounced.length} bounced, ${feedback.noReply.length} no_reply`
      );
    }
  } catch (err) { logger.warn('[SCRAPING] Feedback historique indisponible.', err); }

  // SCRAPE-02 : dedup inter-campagnes — écrit la liste des domaines connus dans un
  // fichier temporaire et passe son chemin en --exclude-file au script Python.
  try {
    const knownDomains = await companyService.listAllDomains();
    if (knownDomains.length > 0) {
      const excludeFile = join(tmpdir(), `carreer-ops-known-${Date.now()}.json`);
      writeFileSync(excludeFile, JSON.stringify(knownDomains), 'utf8');
      args.push('--exclude-file', excludeFile);
      logger.info(`[SCRAPING] ${knownDomains.length} domaines exclus (--exclude-file).`);
    }
  } catch (err) {
    logger.warn('[SCRAPING] Impossible de générer le fichier d\'exclusion.', err);
  }

  logger.info(`[SCRAPING] Lancement : ${config.pythonPath} ${args.join(' ')}`);
  jobStatus = 'running';
  lastCsvPath = null;
  lastCsvLines = 0;
  pushProgress('⟳  Démarrage du scraping…');

  // Force les variables d'env critiques pour que Patchright/Playwright trouve Chromium.
  // On écrase PLAYWRIGHT_BROWSERS_PATH (pas de fallback conditionnel) car Electron peut
  // avoir hérité d'un chemin incorrect (ex : celui de son propre Chromium embarqué).
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    LOCALAPPDATA:  localAppData,
    APPDATA:       process.env.APPDATA   || join(homedir(), 'AppData', 'Roaming'),
    USERPROFILE:   process.env.USERPROFILE || homedir(),
    // TOUJOURS forcer vers le dossier ms-playwright de l'utilisateur — pas d'héritage.
    PLAYWRIGHT_BROWSERS_PATH: join(localAppData, 'ms-playwright'),
    // Forcer Python à ne PAS bufferiser stdout/stderr — sinon Electron ne reçoit aucun
    // log avant ~4 KB, ce qui donne l'impression que le script ne démarre pas.
    PYTHONUNBUFFERED: '1',
    // Encodage UTF-8 forcé pour les emojis / accents (Windows = cp1252 par défaut)
    PYTHONIOENCODING: 'utf-8',
    // Point #14 : clé Hunter par variable d'env (invisible dans `ps`), pas en arg CLI.
    ...(effectiveHunterKey ? { HUNTER_API_KEY: effectiveHunterKey } : {}),
    // Clé LLM cloud du CRAWL par variable d'env selon le provider choisi (OpenAI / Claude).
    ...(config.llmApiKey && config.llmProvider === 'openai' ? { OPENAI_API_KEY: config.llmApiKey } : {}),
    ...(config.llmApiKey && config.llmProvider === 'claude' ? { ANTHROPIC_API_KEY: config.llmApiKey } : {}),
    // Clé cloud des FICHES (Phase 7b) — réutilise la clé des Réglages (celle des lettres).
    // N'écrase pas une clé déjà posée par le crawl ci-dessus (même provider → même var).
    ...(fichesProvider === 'openai' && config.llmProvider !== 'openai' && getOpenaiKey() ? { OPENAI_API_KEY: getOpenaiKey() as string } : {}),
    ...(fichesProvider === 'claude' && config.llmProvider !== 'claude' && getAnthropicKey() ? { ANTHROPIC_API_KEY: getAnthropicKey() as string } : {}),
  };
  // Avertit si les fiches cloud sont demandées sans clé (Python retombera en texte brut).
  if (fichesProvider === 'openai' && !getOpenaiKey() && !(config.llmApiKey && config.llmProvider === 'openai')) {
    logger.warn('[SCRAPING] Fiches via OpenAI demandées mais aucune clé OpenAI — fiches en texte brut.');
  } else if (fichesProvider === 'claude' && !getAnthropicKey() && !(config.llmApiKey && config.llmProvider === 'claude')) {
    logger.warn('[SCRAPING] Fiches via Claude demandées mais aucune clé Anthropic — fiches en texte brut.');
  }

  let buffer = '';
  activeProcess = spawn(config.pythonPath, args, {
    env: spawnEnv,
    windowsHide: true,
  });

  // Stream stdout ligne par ligne
  activeProcess.stdout?.setEncoding('utf8');
  activeProcess.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      pushProgress(line);
      // Détecte le chemin CSV dans la sortie ("Exporté → /path/to/file.csv")
      const match = line.match(/→\s*(.+\.csv)/);
      if (match) lastCsvPath = match[1].trim();
    }
  });

  // stderr → certaines libs Python (Scrapling, urllib3) loggent leurs INFO sur stderr.
  // On ne préfixe ⚠ que pour les VRAIES erreurs : on filtre les logs INFO/DEBUG qui ne
  // sont pas des avertissements (sinon l'utilisateur croit que tout est cassé).
  activeProcess.stderr?.setEncoding('utf8');
  activeProcess.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Logs INFO/DEBUG des libs Python → affichés sans préfixe d'erreur
      const isLibInfo = /\b(INFO|DEBUG):\s/.test(trimmed)
                     || /^\[20\d{2}-\d{2}-\d{2}/.test(trimmed);  // timestamp ISO de logging.basicConfig
      if (isLibInfo) {
        pushProgress(trimmed);            // affichage neutre
      } else {
        pushProgress(`⚠  ${trimmed}`);    // vrai avertissement
      }
    }
  });

  activeProcess.on('close', async (code) => {
    if (buffer.trim()) pushProgress(buffer.trim());
    activeProcess = null;

    if (code === 0 && lastCsvPath) {
      jobStatus = 'done';
      // Compter les lignes du CSV généré (hors header)
      try {
        const content = await new Promise<string>((res, rej) =>
          readFile(lastCsvPath!, 'utf8', (err, d) => err ? rej(err) : res(d))
        );
        lastCsvLines = Math.max(0, content.split(/\r?\n/).filter(Boolean).length - 1);
      } catch { /* non bloquant */ }
      pushProgress(`✅  Scraping terminé — ${lastCsvLines} entreprises dans ${lastCsvPath}`, true, lastCsvPath);
      logger.info(`[SCRAPING] Terminé avec succès. CSV : ${lastCsvPath}`);
    } else {
      jobStatus = 'error';
      pushProgress(`❌  Scraping échoué (code ${code})`, true, null);
      logger.error(`[SCRAPING] Échec. Code : ${code}`);
    }
  });

  activeProcess.on('error', (err) => {
    activeProcess = null;
    jobStatus = 'error';
    const hint = err.message.includes('ENOENT')
      ? ` — Python introuvable. Installez Python 3.10+ et vérifiez le chemin dans les Réglages Scraping.`
      : '';
    pushProgress(`❌  Erreur : ${err.message}${hint}`, true, null);
    logger.error(`[SCRAPING] Erreur de spawn`, err);
  });
}

// ── Handlers IPC ──────────────────────────────────────────────────────────────

export function registerScrapingHandlers(): void {

  handle('scraping:launch', async (config) => {
    await launchScript(config);
    // Persiste la config utilisée comme dernière config
    writeConfig(config);
  });

  handle('scraping:cancel', () => {
    if (activeProcess) {
      activeProcess.kill();
      activeProcess = null;
      jobStatus = 'idle';
      pushProgress('🛑  Scraping annulé.', true, null);
    }
  });

  handle('scraping:getStatus', () => ({
    status: jobStatus,
    csvPath: lastCsvPath,
    linesCount: lastCsvLines,
  }));

  handle('scraping:getConfig', () => readConfig());

  handle('scraping:saveConfig', (config) => {
    writeConfig(config);
  });

  // SCRAPE-06 : re-enrichissement d'un CSV existant (entreprises sans email).
  handle('scraping:enrichCsv', async ({ csvPath, config: cfg }: { csvPath: string; config: ScrapingConfig }) => {
    await launchScript({ ...cfg, sources: [] }, { enrich_only: true, enrich_csv: csvPath });
    writeConfig(cfg);
  });

  // Import LinkedIn Sales Navigator (CSV externe → enrichissement direct).
  // Saute la collecte multi-sources : les leads viennent du CSV, pas de WTTJ/SIRENE/etc.
  handle('scraping:linkedinImport', async ({ csvPath, config: cfg }: { csvPath: string; config: ScrapingConfig }) => {
    await launchScript({ ...cfg, sources: [] }, { linkedin_csv: csvPath });
    writeConfig(cfg);
  });

  // SCRAPE-06 : reprendre le dernier scraping interrompu.
  handle('scraping:resume', async (config: ScrapingConfig) => {
    await launchScript(config, { resume: true });
  });

  // SCRAPE-06 : retourne le chemin de l'aperçu HTML du dernier CSV généré.
  handle('scraping:getHtmlPreview', () => {
    if (!lastCsvPath) return null;
    const htmlPath = lastCsvPath.replace(/\.csv$/, '.html');
    return existsSync(htmlPath) ? htmlPath : null;
  });

  // Retourne les chemins du master CSV et de son aperçu HTML (persistent entre sessions).
  // Les données vivent désormais dans scripts/data/ (séparé du code) — voir le défaut
  // --output du scraper Python. Repli sur l'ancien emplacement scripts/ pour les
  // installations qui n'ont pas encore migré leur master.
  handle('scraping:getMasterPaths', () => {
    const cfg = readConfig();
    const scriptDir = join(cfg.scriptPath, '..');
    const dataDir   = join(scriptDir, 'data');
    const pick = (name: string): string | null => {
      const inData = join(dataDir, name);
      if (existsSync(inData)) return inData;
      const legacy = join(scriptDir, name);   // ancien emplacement (compat)
      return existsSync(legacy) ? legacy : null;
    };
    return {
      csvPath:  pick('candio_leads.csv'),
      htmlPath: pick('candio_leads.html'),
    };
  });

  // ── LEADS-VIEW : consultation / suppression des leads scrapés (master CSV) ──
  handle('scraping:listLeads', () => {
    const path = masterCsvPath();
    if (!path) return [];
    const rows = parseCsvFile(readFileSync(path, 'utf8'));
    if (rows.length < 2) return [];
    const header = rows[0];
    const idx = (name: string) => header.indexOf(name);
    const iName = idx('name'), iEmail = idx('contactEmail'), iWeb = idx('website'),
      iCName = idx('contactName'), iCRole = idx('contactRole'), iSrc = idx('emailSource'),
      iCity = idx('city'), iDeptCode = idx('dept'), iDeptName = idx('deptName'),
      iRegAdmin = idx('regionAdmin'), iSector = idx('sector'), iAct = idx('activityDomain'),
      iDesc = idx('companyDescription'), iDescAt = idx('descriptionUpdatedAt'), iNewsAt = idx('newsUpdatedAt'),
      iScore = idx('totalScore'), iSource = idx('source'), iSuspect = idx('domainSuspect');
    const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    return rows.slice(1).filter((r) => at(r, iName)).map((r) => {
      const name = at(r, iName), email = at(r, iEmail), website = at(r, iWeb);
      // Colonne domainSuspect si présente (CSV régénéré), sinon calcul à la volée.
      const domainSuspect = iSuspect >= 0 ? at(r, iSuspect) === '1' : isDomainSuspect(name, website, email);
      return {
        key: `${name}|${email}|${website}`.toLowerCase(),
        name, email, website,
        contactName: at(r, iCName), contactRole: at(r, iCRole), emailSource: at(r, iSrc),
        city: at(r, iCity), deptCode: at(r, iDeptCode), deptName: at(r, iDeptName),
        regionAdmin: at(r, iRegAdmin),
        sector: at(r, iSector), activityDomain: at(r, iAct),
        description: at(r, iDesc), descriptionUpdatedAt: at(r, iDescAt), newsUpdatedAt: at(r, iNewsAt),
        totalScore: Number(at(r, iScore)) || 0, source: at(r, iSource),
        domainSuspect,
      };
    });
  });

  handle('scraping:deleteLeads', ({ keys }) => {
    const path = masterCsvPath();
    if (!path) return { remaining: 0 };
    const rows = parseCsvFile(readFileSync(path, 'utf8'));
    if (rows.length < 2) return { remaining: 0 };
    const header = rows[0];
    const iName = header.indexOf('name'), iEmail = header.indexOf('contactEmail'), iWeb = header.indexOf('website');
    const toDelete = new Set(keys);
    const kept = rows.slice(1).filter((r) => {
      const k = `${(r[iName] ?? '').trim()}|${(r[iEmail] ?? '').trim()}|${(r[iWeb] ?? '').trim()}`.toLowerCase();
      return !toDelete.has(k);
    });
    writeFileSync(path, [header, ...kept].map(toCsvLine).join('\n'), 'utf8');
    return { remaining: kept.length };
  });

  // SECTOR-AUTO : pré-remplit une campagne avec les leads du master filtrés par
  // secteur + lieu, en excluant ceux déjà utilisés ailleurs, plafonné à `limit`.
  handle('scraping:importLeadsToCampaign', async ({ campaignId, sectors, location, limit }) => {
    const path = masterCsvPath();
    if (!path) return { added: 0, matched: 0, skippedUsed: 0, widened: false, capped: false, noMaster: true };
    const content = readFileSync(path, 'utf8');
    const r = await companyService.importLeadsFromMasterContent(campaignId, content, { sectors, location, limit });
    return { ...r, noMaster: false };
  });

  // SECTOR-AUTO : clés des leads déjà présents dans une campagne (pour le marquage UI).
  handle('scraping:listUsedLeadKeys', () => companyService.listUsedLeadKeys());

  // SCRAPE-DESC : efface la fiche (companyDescription + descriptionUpdatedAt) des leads
  // donnés, SANS supprimer les leads. Utilisé par « Supprimer les fiches affichées ».
  handle('scraping:clearDescriptions', ({ keys }) => {
    const path = masterCsvPath();
    if (!path) return { cleared: 0 };
    const rows = parseCsvFile(readFileSync(path, 'utf8'));
    if (rows.length < 2) return { cleared: 0 };
    const header = rows[0];
    const iName = header.indexOf('name'), iEmail = header.indexOf('contactEmail'), iWeb = header.indexOf('website');
    const iDesc = header.indexOf('companyDescription');
    const iDescAt = header.indexOf('descriptionUpdatedAt');
    if (iDesc < 0) return { cleared: 0 };
    const target = new Set(keys);
    let cleared = 0;
    const out = rows.slice(1).map((r) => {
      const k = `${(r[iName] ?? '').trim()}|${(r[iEmail] ?? '').trim()}|${(r[iWeb] ?? '').trim()}`.toLowerCase();
      if (target.has(k) && (r[iDesc] ?? '').trim()) {
        cleared++;
        r[iDesc] = '';
        if (iDescAt >= 0) r[iDescAt] = '';
      }
      return r;
    });
    writeFileSync(path, [header, ...out].map(toCsvLine).join('\n'), 'utf8');
    return { cleared };
  });

  // SCRAPE-DESC : enrichit les descriptions d'activité des leads existants (master CSV).
  // Spawn scrape_leads.py --enrich-descriptions : pour chaque entreprise avec un site,
  // récupère la homepage, en extrait le texte et le résume (IA si dispo) → §2 perso.
  handle('scraping:enrichDescriptions', (arg) => new Promise<{ enriched: number; iaCount: number; suggestion: string }>((resolve) => {
    const force = !!(arg && (arg as { force?: boolean }).force);
    const maxAgeDays = (arg && (arg as { maxAgeDays?: number }).maxAgeDays) || 0;
    const newsOnly = !!(arg && (arg as { newsOnly?: boolean }).newsOnly);
    const keys = (arg && (arg as { keys?: string[] }).keys) || null;
    if (activeProcess) {
      pushProgress('⚠  Un scraping est déjà en cours — réessayez après.');
      return resolve({ enriched: 0, iaCount: 0, suggestion: '' });
    }
    const cfg = readConfig();
    const csvPath = masterCsvPath();
    if (!csvPath || !existsSync(csvPath)) {
      pushProgress('❌  Aucun fichier de leads à enrichir (master CSV introuvable).');
      return resolve({ enriched: 0, iaCount: 0, suggestion: '' });
    }

    // Ollama est utilisé UNIQUEMENT ici (résumé du texte des sites), JAMAIS pour le
    // crawl email/recruteur — découplé du provider LLM du scraping (cfg.llmProvider).
    // Si Ollama est injoignable, le Python retombe sur le texte brut tronqué.
    // Fiches via OpenAI (cloud) si choisi : réutilise la clé OpenAI des Réglages (celle des
    // lettres) — config « globale ». Sinon Ollama local. Le crawl reste local quoi qu'il arrive.
    const fichesProvider = cfg.describeProvider === 'openai' ? 'openai'
      : cfg.describeProvider === 'claude' ? 'claude' : 'ollama';
    const fichesCloud = fichesProvider !== 'ollama';
    const openaiKey = fichesProvider === 'openai' ? getOpenaiKey() : null;
    const anthropicKey = fichesProvider === 'claude' ? getAnthropicKey() : null;
    if (fichesProvider === 'openai' && !openaiKey) {
      pushProgress('❌  Fiches via OpenAI demandées mais aucune clé OpenAI — renseigne-la dans les Réglages.');
      return resolve({ enriched: 0, iaCount: 0, suggestion: '' });
    }
    if (fichesProvider === 'claude' && !anthropicKey) {
      pushProgress('❌  Fiches via Claude demandées mais aucune clé Anthropic — renseigne-la dans les Réglages.');
      return resolve({ enriched: 0, iaCount: 0, suggestion: '' });
    }

    const args = ['-u', cfg.scriptPath, '--enrich-descriptions', '--enrich-csv', csvPath];
    if (cfg.ollamaUrl)     args.push('--ollama-url', cfg.ollamaUrl);
    // Provider + modèle des fiches : openai (gpt-4o-mini), claude (haiku) ou ollama (describeModel).
    args.push('--describe-provider', fichesProvider);
    args.push('--describe-model',
      fichesProvider === 'openai' ? 'gpt-4o-mini'
      : fichesProvider === 'claude' ? 'claude-haiku-4-5'
      : (cfg.describeModel || 'qwen2.5:7b'));
    if (newsOnly) args.push('--news-only'); // régénère seulement la note actualités
    if (force) args.push('--desc-force'); // régénère toutes les fiches existantes
    else if (maxAgeDays > 0) args.push('--desc-max-age', String(maxAgeDays)); // + vides + > N jours
    // Restreint aux leads affichés/filtrés (clés écrites dans un fichier temp).
    if (keys && keys.length > 0) {
      try {
        const kf = join(tmpdir(), `carreer-ops-desc-keys-${Date.now()}.txt`);
        writeFileSync(kf, keys.join('\n'), 'utf8');
        args.push('--desc-keys-file', kf);
      } catch { /* si échec : on traite tout (comportement par défaut) */ }
    }

    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    const spawnEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      LOCALAPPDATA: localAppData,
      // Clé cloud injectée UNIQUEMENT si les fiches passent par le cloud (lue par Python).
      ...(openaiKey ? { OPENAI_API_KEY: openaiKey } : {}),
      ...(anthropicKey ? { ANTHROPIC_API_KEY: anthropicKey } : {}),
    };

    pushProgress(newsOnly
      ? '📰  Mise à jour des actualités d\'entreprise…'
      : force
        ? '🔄  Régénération de TOUTES les fiches d\'entreprise…'
        : '📝  Enrichissement des fiches manquantes…');
    const proc = spawn(cfg.pythonPath, args, { env: spawnEnv, windowsHide: true });
    activeProcess = proc;
    enrichRunning = true;

    let enriched = 0;
    let iaCount = -1; // -1 = ligne ENRICH_DESC_IA non vue (Python ancien / crash)
    let gaveUp = false; // IA désactivée en cours de run (coupe-circuit = modèle trop lent)
    let noSite = 0;     // entreprises à décrire mais sans site web
    let failCount = 0;  // entreprises avec site mais injoignable
    const onData = (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const m = t.match(/^ENRICH_DESC_OK\s+(\d+)/);
        if (m) { enriched = parseInt(m[1], 10); continue; }
        const mi = t.match(/^ENRICH_DESC_IA\s+(\d+)/);
        if (mi) { iaCount = parseInt(mi[1], 10); continue; }
        const mg = t.match(/^ENRICH_DESC_GAVEUP\s+(\d+)/);
        if (mg) { gaveUp = mg[1] === '1'; continue; }
        const mn = t.match(/^ENRICH_DESC_NOSITE\s+(\d+)/);
        if (mn) { noSite = parseInt(mn[1], 10); continue; }
        const mf = t.match(/^ENRICH_DESC_FAIL\s+(\d+)/);
        if (mf) { failCount = parseInt(mf[1], 10); continue; }
        pushProgress(t);
      }
    };
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', onData);
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', onData);

    proc.on('close', () => {
      activeProcess = null;
      enrichRunning = false;
      const ia = iaCount < 0 ? 0 : iaCount;
      // Libellé du moteur des fiches (cloud ou modèle Ollama).
      const iaLabel = fichesProvider === 'openai' ? 'OpenAI gpt-4o-mini'
        : fichesProvider === 'claude' ? 'Claude Haiku'
        : (cfg.describeModel || 'qwen2.5:7b');
      // Modèle trop lourd pour ce PC ? Soit l'IA a abandonné (coupe-circuit), soit la
      // majorité des fiches a basculé en texte brut → on suggère un modèle plus léger.
      // (Sans objet si les fiches passent par le cloud : pas de problème de lourdeur local.)
      const mostlyRaw = enriched >= 4 && ia * 2 < enriched;
      const tooSlow = !fichesCloud && (gaveUp || mostlyRaw);
      const suggestion = tooSlow ? lighterDescribeModel(cfg.describeModel || '') : '';
      // Message explicite : l'IA a-t-elle vraiment rédigé, ou repli texte brut ?
      let msg: string;
      if (enriched === 0) {
        // Distingue « rien à faire » de « impossible » (sans site / injoignable).
        const reasons: string[] = [];
        if (noSite > 0) reasons.push(`${noSite} sans site web`);
        if (failCount > 0) reasons.push(`${failCount} site(s) injoignable(s)`);
        msg = reasons.length > 0
          ? `ℹ️  Aucune fiche générée : ${reasons.join(' · ')} (une fiche nécessite un site web accessible).`
          : '✅  Aucune nouvelle fiche (toutes déjà à jour).';
      } else if (ia === 0) {
        msg = `⚠️  ${enriched} description(s) en TEXTE BRUT — l'IA (${iaLabel}) n'a pas répondu. `
            + (fichesCloud ? 'Vérifie ta clé cloud et ta connexion.' : 'Vérifie qu\'Ollama est lancé et que le modèle est installé.');
      } else if (ia === enriched) {
        msg = `✅  ${enriched} fiche(s) rédigée(s) par l'IA (${iaLabel}).`;
      } else {
        msg = `✅  ${enriched} description(s) : ${ia} par l'IA (${iaLabel}), `
            + `${enriched - ia} en texte brut.`;
      }
      if (tooSlow) {
        msg += suggestion
          ? `  ⚠️ Le modèle ${cfg.describeModel} semble trop lourd pour ce PC — essaie ${suggestion} (plus léger/rapide).`
          : `  ⚠️ L'IA a eu du mal (modèle peut-être trop lourd ou Ollama lent).`;
      }
      pushProgress(msg, true);
      resolve({ enriched, iaCount: ia, suggestion });
    });
    proc.on('error', (err) => {
      activeProcess = null;
      enrichRunning = false;
      const hint = err.message.includes('ENOENT')
        ? ' — Python introuvable. Vérifiez le chemin Python dans les Réglages Scraping.'
        : '';
      pushProgress(`❌  Enrichissement échoué : ${err.message}${hint}`, true);
      logger.error('[SCRAPING] enrichDescriptions error', err);
      resolve({ enriched: 0, iaCount: 0, suggestion: '' });
    });
  }));

  // SCRAPE-DESC : un enrichissement de fiches tourne-t-il ? (reconnexion page Leads)
  handle('scraping:enrichStatus', () => ({ running: enrichRunning }));

  // SCRAPE-DESC : change le modèle des descriptions depuis la page Leads (suggestion
  // « modèle trop lourd »), sans passer par la page Scraping.
  handle('scraping:setDescribeModel', ({ model }: { model: string }) => {
    const cfg = readConfig();
    cfg.describeModel = model;
    writeConfig(cfg);
    return { ok: true };
  });

  // SCRAPE-06 : vérifie si un checkpoint de reprise existe pour la config du jour.
  handle('scraping:checkpointExists', ({ sector, city }: { sector: string; city: string }) => {
    return existsSync(checkpointFilePath(sector, city));
  });

  // (Handler scraping:installBrowser supprimé : le scraper utilise scrapling.Fetcher
  // (HTTP/curl) et httpx/requests — aucun navigateur Chromium/Patchright n'est lancé.
  // StealthyFetcher n'est jamais instancié. Le bouton « Installer Chromium » a donc
  // été retiré de l'UI.)

  // Réinitialise les curseurs de pagination des sources (clés pagecursor:* du cache).
  // Spawn reset_pagination.py (sqlite3 pur, instantané — n'importe pas scrapling).
  handle('scraping:resetPagination', () => new Promise<{ cleared: number }>((resolve) => {
    const cfg = readConfig();
    // reset_pagination.py est à côté de scrape_leads.py (dossier scripts/).
    const resetScript = join(cfg.scriptPath, '..', 'reset_pagination.py');
    // Chemin du cache : ~/.cache/carreer-ops/scraper.db (passé explicitement pour
    // être robuste si le homedir du process diffère).
    const dbPath = join(homedir(), '.cache', 'carreer-ops', 'scraper.db');

    pushProgress('⟳  Réinitialisation de la pagination des sources…');
    const proc = spawn(cfg.pythonPath, ['-u', resetScript, '--db', dbPath], {
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });

    let cleared = 0;
    let out = '';
    const onData = (chunk: string) => {
      out += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        // Ligne machine RESET_PAGINATION_OK <n> → on extrait le compte sans l'afficher.
        const m = t.match(/^RESET_PAGINATION_OK\s+(\d+)/);
        if (m) { cleared = parseInt(m[1], 10); continue; }
        pushProgress(t);
      }
    };
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', onData);
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', onData);

    proc.on('close', () => resolve({ cleared }));
    proc.on('error', (err) => {
      const hint = err.message.includes('ENOENT')
        ? ' — Python introuvable. Vérifiez le chemin Python dans les Réglages Scraping.'
        : '';
      pushProgress(`❌  Réinitialisation échouée : ${err.message}${hint}`);
      logger.error('[SCRAPING] reset_pagination error', err);
      resolve({ cleared: 0 });
    });
  }));

  // ── GPU-SETUP : installe + démarre Ollama IPEX-LLM sur le GPU Intel Arc ──────
  // Télécharge le build Intel (Vulkan), écrit un launcher avec OLLAMA_IGPU_ENABLE=1
  // (sinon l'iGPU est ignoré) + réutilise les modèles déjà téléchargés, puis lance
  // le serveur. Idempotent : si déjà installé, ne re-télécharge pas.
  handle('ollama:setupIntelGpu', () => new Promise<{ ok: boolean; message: string }>((resolve) => {
    const installDir = join(homedir(), 'ollama-ipex');
    const modelsDir = join(homedir(), '.ollama', 'models');
    const url = 'https://github.com/ipex-llm/ipex-llm/releases/download/v2.3.0-nightly/ollama-ipex-llm-2.3.0b20250725-win.zip';
    const esc = (s: string) => s.replace(/'/g, "''"); // échappement quote PowerShell
    const ps = [
      "$ErrorActionPreference='Stop'",
      `$install='${esc(installDir)}'`,
      `$models='${esc(modelsDir)}'`,
      `$url='${url}'`,
      "$exe=$null",
      "if (Test-Path $install) { $exe=(Get-ChildItem -Recurse $install -Filter ollama.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }",
      "if (-not $exe) {",
      "  Write-Output 'STEP Téléchargement du moteur GPU (~108 Mo, 1-2 min)...'",
      "  $zip=Join-Path $env:TEMP 'carreer-ollama-ipex.zip'",
      "  Invoke-WebRequest -Uri $url -OutFile $zip",
      "  Write-Output 'STEP Extraction...'",
      "  if (Test-Path $install) { Remove-Item $install -Recurse -Force }",
      "  Expand-Archive -Path $zip -DestinationPath $install -Force",
      "  Remove-Item $zip -Force -ErrorAction SilentlyContinue",
      "  $exe=(Get-ChildItem -Recurse $install -Filter ollama.exe | Select-Object -First 1).FullName",
      "}",
      "if (-not $exe) { throw 'ollama.exe introuvable apres extraction' }",
      "$dir=Split-Path $exe",
      "$bat=Join-Path $dir 'start-gpu.bat'",
      "$lines=@('@echo off','set OLLAMA_NUM_GPU=999','set no_proxy=localhost,127.0.0.1','set ZES_ENABLE_SYSMAN=1','set OLLAMA_KEEP_ALIVE=10m','set OLLAMA_NUM_PARALLEL=2','set OLLAMA_HOST=127.0.0.1:11434','set OLLAMA_IGPU_ENABLE=1',('set OLLAMA_MODELS='+$models),'cd /d %~dp0','ollama.exe serve')",
      "Set-Content -Path $bat -Value $lines -Encoding ascii",
      "Write-Output 'STEP Arret du Ollama standard...'",
      "Get-Process 'ollama','ollama app' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue",
      "Start-Sleep 2",
      "Write-Output 'STEP Demarrage du moteur GPU...'",
      "Start-Process -FilePath $bat -WindowStyle Minimized",
      "Start-Sleep 16",
      "Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 6 | Out-Null",
      "Write-Output 'OK'",
    ].join('\r\n');
    const psFile = join(tmpdir(), `carreer-ollama-gpu-${Date.now()}.ps1`);
    try { writeFileSync(psFile, ps, 'utf8'); }
    catch (e) { return resolve({ ok: false, message: `Écriture script échouée : ${e instanceof Error ? e.message : String(e)}` }); }
    pushProgress('⚡  Mise en place du GPU Intel Arc…');
    const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], { windowsHide: true });
    let out = '';
    const onData = (chunk: string) => {
      out += chunk;
      for (const ln of chunk.split(/\r?\n/)) {
        const t = ln.trim();
        if (t.startsWith('STEP ')) pushProgress(`⚙️  ${t.slice(5)}`);
      }
    };
    proc.stdout?.setEncoding('utf8'); proc.stdout?.on('data', onData);
    proc.stderr?.setEncoding('utf8'); proc.stderr?.on('data', (c: string) => { out += c; });
    proc.on('close', () => {
      const ok = /(^|\r?\n)OK\s*$/.test(out.trim()) || /\bOK\b/.test(out.split(/\r?\n/).filter(Boolean).pop() || '');
      const msg = ok
        ? '✅ GPU Intel Arc activé — Ollama tourne sur ton GPU (localhost:11434). Lance « start-gpu.bat » dans ~/ollama-ipex pour le redémarrer plus tard.'
        : `❌ Échec : ${out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(-3).join(' · ') || 'voir logs'}`;
      pushProgress(ok ? '✅  GPU Intel Arc prêt.' : '❌  Mise en place GPU échouée.', true);
      resolve({ ok, message: msg });
    });
    proc.on('error', (err) => resolve({ ok: false, message: `PowerShell introuvable : ${err.message}` }));
  }));

  // Utilitaire : ouvrir un fichier/URL avec l'app par défaut du système.
  handle('shell:open', async (path: string) => {
    await shell.openPath(path);
  });
}
