// Contrat IPC — source de vérité du typage entre l'UI (renderer) et le métier
// (process principal Electron). Le preload et les handlers ipcMain s'y
// conforment, ce qui garantit un typage de bout en bout.

// --- Énumérations (alignées sur le schéma Prisma) ---------------------------

export type CampaignStatus = 'DRAFT' | 'RUNNING' | 'COMPLETED';
export type ApplicationStatus =
  | 'DRAFT'
  | 'SENDING'
  | 'SENT'
  | 'REPLIED'
  | 'FAILED'
  // UX-12 : statut après envoi d'une relance automatique.
  | 'FOLLOWED_UP';

// --- Objets de transfert (DTO) ----------------------------------------------
// Les dates transitent en chaîne ISO : simple et stable à sérialiser via IPC.

export interface Profile {
  id: number;
  firstName: string;
  lastName: string;
  emailSender: string | null;
  cvPath: string | null;
  cvParsed: CvParsed | null;
  createdAt: string;
  updatedAt: string;
  // FM-05 : champs de contact complémentaires.
  phone: string | null;
  linkedin: string | null;
  portfolio: string | null;
  // PROFILE-GH : GitHub perso (preuve de travail).
  github: string | null;
}

// Résultat de l'analyse du CV par l'IA (cf. ai.service.parseCV).
export interface CvParsed {
  // achievements : réalisations/tâches DISTINCTES de ce poste (puces du CV), pour
  // que la lettre puisse en citer UNE précise sans inventer ni fusionner.
  experiences: { title: string; company: string; duration: string; achievements?: string[] }[];
  education: { degree: string; school: string; year: string }[];
  skills: string[];
  languages: string[];
  // CV-REVIEW : évaluation IA du CV (score qualité + recommandations).
  // Optionnel : présent une fois l'évaluation terminée (stocké dans le même JSON
  // que le parse → pas de migration DB).
  review?: {
    score: number;              // /100 — qualité globale pour candidature spontanée
    recommendations: string[];  // conseils d'amélioration concrets
  };
}

// CV-MULTI : un CV nommé. Plusieurs CV possibles, choisis par campagne.
export interface Cv {
  id: string;
  name: string;              // nom manuel (ex: "CV Data Analyst")
  hasFile: boolean;          // un PDF est attaché
  parsed: CvParsed | null;   // analyse IA (null si pas encore analysé)
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  prompt: string;
  jobTitle: string;
  location: string;
  contractTypes: string[]; // Exposé en tableau côté UI (stocké en CSV en base)
  salaryMin: number | null;
  salaryMax: number | null;
  // UX-7v2 : notes libres sur la campagne.
  notes: string | null;
  // AVAIL : disponibilité saisie (ex. « début octobre 2026 »), recopiée dans la lettre.
  availability: string | null;
  status: CampaignStatus;
  // UX-6 : date d'archivage — null si campagne active.
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // UX-9v2 : compteurs pour scan rapide depuis la liste.
  companiesCount: number;
  sentCount: number;
  // ANA-2v2 : nombre de réponses.
  repliedCount: number;
  // INT-2v3 : date d'envoi planifié.
  scheduledAt: string | null;
  // ANA-5v3 : variante B du prompt pour test A/B.
  promptVariantB: string | null;
  // CV-MULTI : CV choisi pour cette campagne (id + nom pour affichage).
  cvId: string | null;
  cvName: string | null;
  // SECTOR-PREF : secteurs préférés (clés). Vide = tous. Max 5. Filtre les leads importés.
  preferredSectors: string[];
}

// BOUNCE-01 : taxonomie UNIQUE des sources d'email. Source de vérité partagée —
// le type `EmailSource` en dérive, et l'import CSV (company.service) DOIT filtrer
// sur cette même liste (plus de tableau dupliqué qui diverge). Toute source émise
// par le scraper Python doit figurer ici.
export const EMAIL_SOURCES = [
  'manual',
  'hunter_verified',    // Hunter.io, confidence ≥ 90 %
  'hunter_found',       // Hunter.io, confidence < 90 %
  'web_crawl',          // trouvé directement sur le site de l'entreprise
  'llm_crawl',          // extrait par LLM sur une page du site (qualité crawl)
  'whois',              // trouvé dans les données WHOIS du domaine
  'snov_found',         // Snov.io API
  'apollo_found',       // Apollo.io API
  'github_org',         // email public d'une org GitHub (non vérifié SMTP)
  'linkedin_smtp',      // nom LinkedIn + format Hunter + SMTP RCPT TO vérifié
  'linkedin_pattern',   // nom LinkedIn + format Hunter, non vérifié SMTP
  'pattern_verified',   // pattern standard rh@… + SMTP RCPT TO vérifié
  'pattern',            // pattern généré rh@…, non vérifié
  'pattern_nominative', // prenom.nom@ construit depuis le pattern domaine, non vérifié
  'catch_all',          // domaine accepte tout → email probable, non garanti
  'no_email',           // aucun email trouvé (skip_no_email)
] as const;

export type EmailSource = (typeof EMAIL_SOURCES)[number];

export interface Company {
  id: string;
  campaignId: string;
  name: string;
  website: string | null;
  contactEmail: string;
  contactName: string | null;
  contactRole: string | null;
  // FM-06 : entreprise blacklistée (exclue de la génération).
  blacklisted: boolean;
  // BOUNCE-01 : source de l'email de contact (cf. EMAIL_SOURCES).
  emailSource: EmailSource;
  // BOUNCE-01 : emails alternatifs à essayer si le principal rebondit (ordonnés par priorité).
  emailAlternatives: string[];
  // SCRAPE-01 : métadonnées d'enrichissement.
  region: string | null;
  activityDomain: string | null;
  companySize: string | null;
  // SCRAPE-LOC : localisation structurée + secteur normalisé.
  country: string | null;
  regionAdmin: string | null;     // région administrative — ex: "Île-de-France"
  dept: string | null;            // code département — ex: "75"
  deptName: string | null;        // nom département — ex: "Paris", "Rhône"
  city: string | null;            // ex: "Paris"
  sector: string | null;          // secteur normalisé — ex: "Tech / IT"
  // SCRAPE-DESC : description courte de l'activité (site résumé par IA) — perso du §2.
  description: string | null;
  companySizeBucket: string | null; // bucket taille — ex: "10-19"
  // SCRAPE-02 : scores de fraîcheur / pertinence.
  freshnessScore: number;
  relevanceScore: number;
}

// SCRAPE-SCORE : poids de scoring configurables manuellement.
// Tous les champs sont optionnels : null/undefined → valeur par défaut du script Python.
export interface ScoringWeights {
  /** Bonus ajouté au relevance_score selon la source de l'email trouvé. */
  emailBonus: {
    hunter_verified: number;
    linkedin_smtp:   number;
    web_crawl:       number;
    catch_all:       number;
    apollo_found:    number;
    snov_found:      number;
    hunter_found:    number;
    whois:           number;
    linkedin_pattern:number;
    pattern_verified:number;
    pattern:         number;
    manual:          number;
  };
  /** Pénalité appliquée si l'email est marqué "invalid" par le service de validation. */
  emailInvalidPenalty: number;
  /** Bonus selon la taille de l'entreprise (sweet spot candidatures spontanées : 50-500). */
  sizeBonus: {
    '10-19':    number;
    '20-49':    number;
    '50-99':    number;
    '100-199':  number;
    '200-249':  number;
    '250-499':  number;
    '500-999':  number;
    '1000-1999':number;
    '2000-4999':number;
  };
  /** Bonus si un ATS (Lever, Greenhouse, Workday…) est détecté sur le site. */
  atsBonus: number;
}

/** Poids par défaut — miroir exact des constantes dans scrape_leads.py. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  emailBonus: {
    hunter_verified:  40,
    linkedin_smtp:    38,
    web_crawl:        35,
    apollo_found:     28,
    snov_found:       28,
    hunter_found:     20,
    whois:            18,
    linkedin_pattern: 15,
    pattern_verified: 12,
    // Sources devinées bloquées à l'envoi → score bas (audit 3, point 2).
    catch_all:         8,
    pattern:           5,
    manual:           40,
  },
  emailInvalidPenalty: -50,
  sizeBonus: {
    '10-19':     5,
    '20-49':    10,
    '50-99':    15,
    '100-199':  20,
    '200-249':  20,
    '250-499':  15,
    '500-999':  10,
    '1000-1999': 5,
    '2000-4999': 3,
  },
  atsBonus: 12,
};

// SCRAPE-01 : configuration du scraper et de la routine mensuelle.
export interface ScrapingConfig {
  sector: string;             // --sector : titre du poste pour job boards (ex: "data analyst")
  industry: string;           // --industry : domaine d'activité pour annuaires Kompass/PJ
                              //   (ex: "finance", "SaaS tech"). Fallback sur sector si vide.
  city: string;
  sources: string[];          // ["wttj","indeed","kompass","pj"]
  max: number;
  hunterKey: string;
  // Plafond de recherches Hunter.io par run (protège le quota — free = 50/mois).
  // Augmentable si plan payant. Le min(plafond, quota réel) est appliqué côté Python.
  hunterMaxSearches?: number;
  pythonPath: string;         // chemin vers l'exécutable Python (défaut: "python")
  scriptPath: string;         // chemin vers scrape_leads.py
  // SCRAPE-02 : validation d'email via service tiers.
  validator: 'none' | 'neverbounce' | 'zerobounce';
  validatorKey: string;       // clé API du service de validation (laisser vide si 'none')
  // SCRAPE-03 : contrôle des sources d'enrichissement email.
  emailSources: string[];     // sous-ensemble de ['web_crawl','hunter','linkedin','pattern']
  skipNoEmail: boolean;       // exclure du CSV les entreprises sans email réel
  // (Snov.io / Apollo.io entièrement retirés — inscriptions API trop pénibles,
  //  jamais utilisés ; enrichissement = crawl web gratuit + Hunter free tier.)
  // SCRAPE-05 : nouvelles améliorations scraping.
  pappersKey: string;         // Pappers.fr token (SIRENE + dirigeants, 500 req/mois gratuits)
  // France Travail (ex-Pôle Emploi) — API officielle FR, OAuth2 client_credentials.
  // Inscription gratuite sur francetravail.io → souscrire "Offres d'emploi v2".
  franceTravailId?: string;   // OAuth client_id
  franceTravailSecret?: string; // OAuth client_secret
  // Source "email alerts" (webhook) : lit les alertes emploi dans la boîte mail IMAP
  // (creds IMAP réutilisés depuis les Réglages). Voir source 'email_alerts'.
  alertsFolder?: string;      // dossier IMAP à scanner (défaut: INBOX)
  alertsSinceDays?: number;   // ne lire que les alertes des N derniers jours (défaut: 7)
  // LLM — extraction structurée sur pages web (contact, recruteur, stack tech).
  // Si actif, améliore web_crawl quand regex échoue. Provider : 'ollama' (local) ou 'openai'.
  llmProvider?: 'ollama' | 'openai' | 'claude' | '';
  ollamaUrl?: string;         // URL Ollama (défaut http://localhost:11434)
  ollamaModel?: string;       // modèle (défaut qwen2.5-coder:7b)
  // SCRAPE-DESC : modèle Ollama DÉDIÉ aux descriptions d'activité (Phase 7b + bouton
  // « Enrichir »). INDÉPENDANT de llmProvider/ollamaModel (le crawl) : tourne même si
  // le LLM de crawl est désactivé. Tâche légère (1 résumé/entreprise) → un 7B est OK.
  describeModel?: string;     // défaut qwen2.5:7b (Ollama) ou gpt-4o-mini (OpenAI)
  // Fournisseur IA des fiches entreprise/actualités : 'ollama' (local), 'openai' ou
  // 'claude' (cloud, réutilise la clé des Réglages). N'affecte PAS le crawl. Défaut 'ollama'.
  describeProvider?: string;
  llmApiKey?: string;         // clé pour LLM cloud (OpenAI ou Claude selon le provider)
  llmBudget?: number;         // appels LLM max par run (défaut 100)
  githubToken: string;        // GitHub personal token (optionnel, 5000 req/h)
  useGithub: boolean;         // activer recherche email via GitHub orgs
  useSmtpBatch: boolean;      // SMTP multi-pattern (rh@, jobs@, contact@…)
  proxies: string;            // proxies rotatifs séparés par virgule
  fuzzyDedup: boolean;        // déduplication floue sur noms d'entreprise
  fuzzyThreshold: number;     // seuil similarité (0.85 par défaut)
  parallelWorkers: number;    // threads phases MX/catch-all
  useClearbit: boolean;       // enrichissement Clearbit (gratuit)
  // SCRAPE-SCORE : scoring configurable manuellement.
  skipScoring: boolean;           // si true : phase 8 sautée, entreprises dans l'ordre de collecte
  scoringWeights: ScoringWeights | null;  // null = poids par défaut du script Python
  // SCRAPE-06 : 10 nouvelles améliorations.
  postedWithinDays: number;       // 0 = pas de filtre; N = exclut offres > N jours
  sizeTarget?: 'all' | 'pme' | 'eti' | 'grand';  // cible de taille (filtre SIRENE) — PME = + d'emails publics
  crawlBudgetSec?: number;        // plafond de crawl PAR entreprise en s (défaut 25). + haut = + de résultats mais + lent
  maxRuntimeMin?: number;         // limite de temps globale en minutes (0 = illimité, défaut 0)
  pagesPerRun?: number;           // pages lues par run par source (1 | 5 | 10 | 25, défaut 2)
  exploreNewPages?: boolean;      // re-crawle les domaines déjà vus SANS email sur des pages neuves (+ d'adresses au fil des runs)
  exploreSources?: boolean;       // pagination progressive des sources (SIRENE/APEC/WTTJ/Indeed) → nouvelles entreprises au fil des runs
  fastCrawl: boolean;             // crawl rapide requests+bs4 avant headless (défaut: true)
  findRecruiter: boolean;         // Phase 4c : chercher prénom/nom du recruteur RH (défaut: true)
  blacklistDomains: string;       // domaines à exclure, séparés par newline ou virgule
  whitelistDomains: string;       // domaines prioritaires, séparés par newline ou virgule
}

// LEADS-VIEW : une ligne du master CSV de leads scrapés (champs utiles à l'affichage).
export interface LeadRow {
  key: string;          // signature unique (name|email|website) pour la suppression
  name: string;
  email: string;
  website: string;
  contactName: string;
  contactRole: string;
  emailSource: string;
  city: string;
  deptCode: string;     // code département (ex: "69")
  deptName: string;     // nom département (ex: "Rhône")
  regionAdmin: string;  // région administrative (ex: "Auvergne-Rhône-Alpes"), si remplie
  sector: string;
  activityDomain: string;
  description: string;  // SCRAPE-DESC : description d'activité (site résumé par IA), si remplie
  descriptionUpdatedAt: string;  // date ISO de génération de la fiche ('' si jamais générée)
  newsUpdatedAt: string;  // date ISO de la dernière vérification des actualités ('' si jamais)
  totalScore: number;
  source: string;
  // Qualité : le domaine du site ne correspond pas au nom (homonyme louche) → à vérifier.
  domainSuspect: boolean;
}

export type ScrapingJobStatus = 'idle' | 'running' | 'done' | 'error';

export interface Application {
  id: string;
  campaignId: string;
  companyId: string;
  companyName: string; // Aplati depuis Company pour simplifier l'affichage
  contactEmail: string;
  subject: string;
  body: string;
  status: ApplicationStatus;
  sentAt: string | null;
  repliedAt: string | null;
  replyContent: string | null;
  errorMessage: string | null;
  // UX-10 : note de suivi saisie manuellement.
  followUpNote: string | null;
  // UX-12 : date d'envoi de la relance automatique.
  followUpSentAt: string | null;
  // UX-4v3 : statut manuel post-réponse (INTERVIEWED/OFFER/REJECTED/ACCEPTED).
  manualStatus: string | null;
  // BUG-04 : Message-ID de l'email de candidature initial — nécessaire pour le threading email.
  messageId: string | null;
  // B2 : Message-ID de la relance — distinct de messageId pour ne pas casser le matching IMAP de l'email initial.
  followUpMessageId: string | null;
  // FM-02 : variante de prompt A/B utilisée lors de la génération ('A', 'B', ou null si antérieur à cette feature).
  promptVariant: string | null;
  // FM-08 : suivi d'entretien.
  interviewDate: string | null;
  interviewLocation: string | null;
  interviewNotes: string | null;
  // BOUNCE-01 : l'email a rebondi (NDR détecté par polling IMAP).
  emailBounced: boolean;
  emailBouncedAt: string | null;
  // DELIV-01 : source de l'email (aplatie depuis Company) — sert à marquer
  // « à vérifier » les emails générés (pattern/linkedin_pattern) côté UI et à
  // bloquer leur envoi automatique. Voir UNVERIFIED_EMAIL_SOURCES.
  emailSource: Company['emailSource'];
}

// DELIV-01 : sources d'email « devinées » (format généré, jamais confirmé) —
// risque de bounce élevé. On NE LES ENVOIE JAMAIS automatiquement : elles sont
// marquées « à vérifier » dans l'UI. L'utilisateur doit corriger/valider
// l'adresse (ce qui repasse emailSource à 'manual') avant tout envoi.
export const UNVERIFIED_EMAIL_SOURCES: ReadonlyArray<Company['emailSource']> = [
  'pattern',
  'linkedin_pattern',
  'pattern_nominative', // prenom.nom@ déduit du pattern — jamais confirmé
  'catch_all',          // domaine accepte tout → rh@ deviné, peut tomber dans le vide
];

// ANA-1 : statistiques globales pour le tableau de bord.
export interface GlobalStats {
  totalCampaigns: number;
  totalCompanies: number;
  totalSent: number;
  totalReplied: number;
  replyRate: number;
  avgDaysToReply: number | null;
  // ANA-3v3 : id ajouté pour la navigation directe depuis le dashboard.
  topCampaign: { id: string; name: string; replyRate: number } | null;
  // UX-4v3 : compteurs de statuts manuels post-réponse.
  totalInterviewed: number;
  totalOffers: number;
  // ANA-1v3 : entonnoir de conversion.
  funnelStats: {
    targeted: number;
    drafted: number;
    sent: number;
    replied: number;
    interviewed: number;
    offers: number;
  };
}

// --- Entrées (payloads de création / mise à jour) ---------------------------

export interface ProfileInput {
  firstName: string;
  lastName: string;
  emailSender: string | null;
  // FM-05 : champs de contact complémentaires.
  phone?: string | null;
  linkedin?: string | null;
  portfolio?: string | null;
  // PROFILE-GH : GitHub perso.
  github?: string | null;
}

export interface CampaignInput {
  name: string;
  prompt: string;
  jobTitle: string;
  location: string;
  contractTypes: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  // UX-7v2 : notes libres sur la campagne.
  notes?: string | null;
  // AVAIL : disponibilité saisie (ex. « début octobre 2026 »), recopiée dans la lettre.
  availability?: string | null;
  // ANA-5v3 : variante B du prompt pour test A/B.
  promptVariantB?: string | null;
  // CV-MULTI : CV choisi pour cette campagne.
  cvId?: string | null;
  // SECTOR-PREF : secteurs préférés (clés, max 5). Vide/absent = tous secteurs.
  preferredSectors?: string[];
}

// SECTOR-PREF : mappe une clé de secteur (UI / scraping) vers les libellés `sector`
// normalisés produits par classification.py (valeurs réelles de la colonne CSV `sector`).
// Sert à filtrer les leads importés dans une campagne selon ses secteurs préférés.
export const SECTOR_KEY_TO_LABELS: Record<string, string[]> = {
  tech:        ['Tech / IT', 'Télécoms', 'Électronique'],
  data:        ['Tech / IT'],
  logiciel:    ['Tech / IT'],
  finance:     ['Finance / Banque'],
  assurance:   ['Assurance'],
  conseil:     ['Conseil', 'Conseil / Juridique', 'Services pro', 'Services aux entreprises'],
  audit:       ['Conseil / Juridique', 'Conseil'],
  industrie:   ['Industrie', 'Automobile', 'Chimie', 'Textile / Mode', 'Électronique'],
  energie:     ['Énergie', 'Environnement'],
  btp:         ['BTP / Construction'],
  sante:       ['Santé', 'Action sociale', 'Vétérinaire'],
  pharma:      ['Pharmacie'],
  retail:      ['Commerce'],
  ecommerce:   ['Commerce'],
  logistique:  ['Transport / Logistique'],
  transport:   ['Transport / Logistique'],
  media:       ['Médias / Audiovisuel', 'Publicité / Marketing', 'Arts / Spectacle'],
  immobilier:  ['Immobilier'],
  education:   ['Éducation'],
  restauration:['Hôtellerie / Restauration', 'Tourisme'],
  agriculture: ['Agriculture', 'Agroalimentaire'],
};

export interface CompanyInput {
  campaignId: string;
  name: string;
  website: string | null;
  contactEmail: string;
  contactName: string | null;
  contactRole: string | null;
}

// Config SMTP saisie dans les Réglages. Le mot de passe n'est jamais relu :
// il est chiffré côté principal et ne ressort plus.
export interface SmtpInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

// Config IMAP pour la détection des réponses.
// `secure: true` = SSL/TLS direct (port 993, Gmail). `false` = STARTTLS (143).
export interface ImapInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

// MOD-05 : config DKIM pour la signature des emails sortants.
export interface DkimInput {
  domainName: string;   // ex: example.com
  keySelector: string;  // ex: mail
  privateKey: string;   // clé privée PEM RSA
}

// État des réglages renvoyé à l'UI (jamais les secrets eux-mêmes).
// OLLAMA-2 : informations hardware pour les recommandations de modèles.
export interface HardwareInfo {
  totalRamGb: number;
  gpuName: string | null;
  gpuVramGb: number | null;
  /** 'nvidia' | 'intel' | 'amd' | 'other' | null */
  gpuVendor: string | null;
}

export interface SettingsStatus {
  openaiKeySet: boolean;
  anthropicKeySet: boolean;
  geminiKeySet: boolean;
  groqKeySet: boolean;
  hunterKeySet: boolean;
  smtpConfigured: boolean;
  imapConfigured: boolean;
  scrapingEnabled: boolean;
  // UX-11 : intervalle de polling IMAP en minutes.
  imapPollIntervalMinutes: number;
  // INT-3 : modèle IA configuré.
  aiModel: string;
  // SEC-M1 : verrouillage automatique par PIN.
  lockEnabled: boolean;
  lockTimeoutMinutes: number;
  // ADM-S2 : indicateurs de santé de la configuration.
  lastSmtpCheckAt: string | null;
  lastSmtpCheckOk: boolean | null;
  lastImapCheckAt: string | null;
  lastImapCheckOk: boolean | null;
  // MOD-05 : DKIM configuré.
  dkimConfigured: boolean;
  // FM-02 : limite quotidienne d'envois.
  dailySendLimit: number;
  dailySendCount: number;   // emails déjà envoyés aujourd'hui
  // OLLAMA-1 : provider IA et config Ollama.
  aiProvider: string;
  ollamaModel: string;
  ollamaHost: string;
}

// UX-S3 : résultat de recherche globale.
export interface SearchResult {
  type: 'campaign' | 'company' | 'application';
  id: string;
  campaignId?: string;
  label: string;      // Nom affiché
  sublabel?: string;  // Contexte (nom campagne, email, etc.)
}

// --- Canaux requête/réponse (renderer → principal via ipcRenderer.invoke) ---

export interface IpcRequests {
  'profile:get': { req: void; res: Profile | null };
  'profile:update': { req: ProfileInput; res: Profile };
  // Ouvre un sélecteur de fichier, copie le PDF en local, lance l'analyse IA.
  // CV-MULTI : gestion de plusieurs CV nommés.
  'cv:list': { req: void; res: Cv[] };
  'cv:create': { req: { name: string }; res: Cv };          // crée un CV vide (nom seul)
  // ouvre dialog PDF + lance l'analyse. imported=false si l'utilisateur annule le dialog.
  'cv:importFile': { req: { id: string }; res: { cv: Cv; imported: boolean } };
  'cv:reanalyze': { req: { id: string }; res: void };        // relance l'analyse IA du PDF déjà importé
  'cv:openFile': { req: { id: string }; res: void };         // ouvre le PDF dans une fenêtre de l'app
  'shell:openExternal': { req: { url: string }; res: void }; // ouvre une URL dans le navigateur
  // PROMPT-HELPER IA : génère 2 prompts enrichis depuis le matériel saisi + le CV.
  // Retourne null si l'IA est indisponible (le renderer retombe sur le template).
  'ai:generateCampaignPrompts': {
    req: { material: string; cvId?: string | null };
    res: { promptA: string; promptB: string; usedCv: boolean } | null;
  };
  'cv:rename': { req: { id: string; name: string }; res: Cv };
  'cv:delete': { req: { id: string }; res: void };

  'campaign:list': { req: void; res: Campaign[] };
  'campaign:get': { req: { id: string }; res: Campaign | null };
  'campaign:create': { req: CampaignInput; res: Campaign };
  'campaign:update': { req: { id: string } & CampaignInput; res: Campaign };
  'campaign:delete': { req: { id: string }; res: void };
  // UX-6 : archivage (soft-delete) d'une campagne.
  'campaign:archive': { req: { id: string }; res: void };
  // UX-1v2 : liste les campagnes archivées.
  'campaign:listArchived': { req: void; res: Campaign[] };
  // UX-1v2 : désarchivage d'une campagne.
  'campaign:unarchive': { req: { id: string }; res: Campaign };
  // UX-4v2 : duplication d'une campagne.
  'campaign:duplicate': { req: { id: string }; res: Campaign };
  // ADM-2v2 : suppression en masse des campagnes archivées.
  'campaign:bulkDeleteArchived': { req: void; res: { deleted: number } };
  // UX-9 : export CSV des candidatures d'une campagne.
  'campaign:exportCsv': { req: { id: string }; res: { path: string } | null };

  'company:listByCampaign': { req: { campaignId: string }; res: Company[] };
  'company:add': { req: CompanyInput; res: Company };
  // UX-2 : mise à jour d'une entreprise cible.
  'company:update': { req: { id: string } & Omit<CompanyInput, 'campaignId'>; res: Company };
  // Ouvre un sélecteur de fichier CSV et importe les lignes valides.
  'company:importCsv': { req: { campaignId: string }; res: { added: number; skipped: number } };
  'company:delete': { req: { id: string }; res: void };
  // UX-3 : téléchargement du modèle CSV vierge.
  'company:downloadCsvTemplate': { req: void; res: void };
  // UX-8v2 : suppression en masse des entreprises sélectionnées.
  'company:bulkDelete': { req: { ids: string[] }; res: { deleted: number } };
  // FM-04 : détection de doublons par similarité de nom.
  'company:findSimilar': { req: { campaignId: string; name: string }; res: Company[] };
  // FM-06 : blacklist d'entreprise.
  'company:setBlacklisted': { req: { id: string; blacklisted: boolean }; res: Company };
  // BOUNCE-01 : passe à l'email alternatif suivant après un bounce.
  'company:retryWithAlternativeEmail': { req: { companyId: string }; res: { nextEmail: string } | null };

  // SCRAPE-01 : lancement du scraper Python.
  'scraping:launch': { req: ScrapingConfig; res: void };
  // SCRAPE-01 : annule le job en cours.
  'scraping:cancel': { req: void; res: void };
  // SCRAPE-01 : statut courant du scraper.
  'scraping:getStatus': { req: void; res: { status: ScrapingJobStatus; csvPath: string | null; linesCount: number } };
  // SCRAPE-01 : récupère la configuration sauvegardée.
  'scraping:getConfig': { req: void; res: ScrapingConfig };
  // SCRAPE-01 : sauvegarde la configuration.
  'scraping:saveConfig': { req: ScrapingConfig; res: void };
  // SCRAPE-01 : importe le dernier CSV généré dans une campagne.
  'scraping:importCsv': { req: { csvPath: string; campaignId: string }; res: { added: number; skipped: number } };
  // SCRAPE-02 : liste les domaines déjà connus (toutes campagnes) pour le dedup inter-campagnes.
  'scraping:getKnownDomains': { req: void; res: string[] };
  // SCRAPE-06 : re-enrichissement d'un CSV existant.
  'scraping:enrichCsv': { req: { csvPath: string; config: ScrapingConfig }; res: void };
  // Import LinkedIn Sales Navigator (CSV externe). Saute la collecte, charge le CSV,
  // enrichit via le pipeline standard (MX, crawl, Hunter, pattern, scoring).
  'scraping:linkedinImport': { req: { csvPath: string; config: ScrapingConfig }; res: void };
  // Ouvre un dialog de sélection de fichier (CSV LinkedIn) — retourne le chemin choisi ou null.
  'dialog:openCsv': { req: { title?: string }; res: string | null };
  // SCRAPE-06 : reprendre le dernier scraping interrompu.
  'scraping:resume': { req: ScrapingConfig; res: void };
  // SCRAPE-06 : retourne le chemin de l'aperçu HTML (ou null si non généré).
  'scraping:getHtmlPreview': { req: void; res: string | null };
  // Retourne les chemins du master CSV + HTML (persiste entre sessions).
  'scraping:getMasterPaths': { req: void; res: { csvPath: string | null; htmlPath: string | null } };
  // SCRAPE-06 : vérifie si un checkpoint de reprise existe pour sector+city du jour.
  'scraping:checkpointExists': { req: { sector: string; city: string }; res: boolean };
  // (scraping:installBrowser retiré — le scraper n'utilise pas Chromium/Patchright.)
  // Réinitialise les curseurs de pagination des sources (clés pagecursor:* du cache).
  // La prochaine recherche repart de la page 1. Retourne le nombre de curseurs effacés.
  'scraping:resetPagination': { req: void; res: { cleared: number } };
  // LEADS-VIEW : consultation / suppression des leads scrapés (master CSV).
  'scraping:listLeads': { req: void; res: LeadRow[] };
  'scraping:deleteLeads': { req: { keys: string[] }; res: { remaining: number } };
  // SECTOR-AUTO : pré-remplit une campagne avec les leads du master filtrés par
  // secteur + lieu, en excluant ceux déjà présents dans une autre campagne, plafonné.
  'scraping:importLeadsToCampaign': {
    req: { campaignId: string; sectors: string[]; location: string; limit: number };
    res: { added: number; matched: number; skippedUsed: number; widened: boolean; capped: boolean; noMaster: boolean };
  };
  // SECTOR-AUTO : clés (nom|email|site) des leads déjà utilisés dans une campagne
  // (toutes campagnes confondues) — sert à marquer les leads « déjà pris » côté UI.
  'scraping:listUsedLeadKeys': { req: void; res: string[] };
  // Efface UNIQUEMENT la fiche (companyDescription + date) des leads donnés — garde les leads.
  'scraping:clearDescriptions': { req: { keys: string[] }; res: { cleared: number } };
  // SCRAPE-DESC : enrichit la description d'activité des leads existants (texte du
  // site + résumé IA). Progression poussée via 'scraping:progress'. Retourne le compte.
  // force=true régénère TOUTES les fiches ; maxAgeDays=N régénère les vides + celles de
  // plus de N jours ; sinon (défaut) complète seulement les manquantes.
  // suggestion : id d'un modèle plus léger si l'IA a galéré (modèle trop lourd pour ce PC), sinon ''.
  // newsOnly=true : régénère SEULEMENT la note actualités (garde la fiche générale).
  // keys : restreint le traitement à ces leads (sous-ensemble affiché/filtré). Vide = tous.
  'scraping:enrichDescriptions': {
    req: { force?: boolean; maxAgeDays?: number; newsOnly?: boolean; keys?: string[] } | void;
    res: { enriched: number; iaCount: number; suggestion: string };
  };
  // Change le modèle des descriptions dans la config scraping (sans passer par la page Scraping).
  'scraping:setDescribeModel': { req: { model: string }; res: { ok: boolean } };
  // Change le fournisseur IA des fiches : 'ollama' (local) ou 'openai' (cloud, clé des Réglages).
  'scraping:setDescribeProvider': { req: { provider: string }; res: { ok: boolean } };
  // Indique si un enrichissement de fiches tourne (pour reconnecter l'UI Leads au retour).
  'scraping:enrichStatus': { req: void; res: { running: boolean } };
  // GPU-SETUP : installe + démarre Ollama IPEX-LLM sur le GPU Intel Arc (télécharge le
  // build, active l'iGPU, réutilise les modèles, lance le serveur). Progression via 'scraping:progress'.
  'ollama:setupIntelGpu': { req: void; res: { ok: boolean; message: string } };
  // Ollama : liste les modèles installés localement (/api/tags). [] si Ollama down.
  'ollama:listModels': { req: void; res: string[] };
  // Ollama : télécharge (pull) un modèle ; progression poussée via 'scraping:progress'.
  'ollama:pullModel': { req: string; res: { ok: boolean; error?: string } };
  // Utilitaire : ouvrir un fichier/URL avec l'app par défaut du système.
  'shell:open': { req: string; res: void };

  // PERF-1v3 : pagination serveur des candidatures.
  'application:listByCampaign': { req: { campaignId: string; page?: number; pageSize?: number }; res: { items: Application[]; total: number } };
  // PERF-M1 : toutes les réponses reçues avec pagination serveur optionnelle.
  'application:listReplied': { req: { page?: number; pageSize?: number } | void; res: { items: Application[]; total: number } };
  // UX-S8 : prévisualisation de la relance avant envoi.
  'application:previewFollowUp': { req: { id: string }; res: { subject: string; body: string } };
  // UX-S8 : envoi de la relance avec le body fourni (pas de régénération IA).
  'application:sendFollowUpWithBody': { req: { id: string; subject: string; body: string }; res: void };
  // UX-S9 : répondre à un recruteur depuis la page Réponses.
  'application:replyToRecruiter': { req: { id: string; body: string }; res: void };
  // Enfile la génération IA des emails pour les entreprises sans candidature.
  'application:generate': { req: { campaignId: string }; res: void };
  // Modifie l'objet/le corps d'un brouillon avant envoi.
  'application:updateDraft': { req: { id: string; subject: string; body: string }; res: Application };
  // Enfile l'envoi SMTP d'une candidature (ou de toutes les DRAFT).
  'application:send': { req: { id: string }; res: void };
  'application:sendAll': { req: { campaignId: string }; res: void };
  // UX-10 : enregistre une note de suivi sur une candidature.
  'application:addFollowUpNote': { req: { id: string; note: string }; res: void };
  // UX-12 : envoi d'une relance automatique.
  'application:sendFollowUp': { req: { id: string }; res: void };
  // FOLLOWUP-BATCH : relance en lot des candidatures éligibles (bornée au quota du jour).
  'application:followUpAllEligible': {
    req: void;
    res: { enqueued: number; eligible: number; remaining: number };
  };
  // UX-1v3 : regénère uniquement cet email sans toucher aux autres.
  'application:regenerateOne': { req: { id: string }; res: void };
  // UX-7v3 : envoie l'email à soi-même pour vérifier le rendu.
  'application:sendTest': { req: { id: string }; res: void };
  // TEST-CAMPAGNE : s'envoie TOUS les brouillons/échecs en test (rendu + CV joint)
  // sans rien envoyer aux destinataires réels ni modifier les statuts.
  'application:sendTestAll': { req: { campaignId: string }; res: { sent: number; total: number } };
  // UX-4v3 : définit le statut manuel post-réponse.
  'application:setManualStatus': { req: { id: string; manualStatus: string | null }; res: void };
  // UX-5v3 : liste toutes les candidatures nécessitant une action.
  'application:listActionRequired': { req: void; res: Application[] };
  // FM-08 : suivi d'entretien.
  'application:setInterview': { req: { id: string; interviewDate: string | null; interviewLocation: string | null; interviewNotes: string | null }; res: void };

  'settings:getStatus': { req: void; res: SettingsStatus };
  'settings:setOpenaiKey': { req: { key: string }; res: void };
  // Claude (Anthropic) : clé API pour la génération via endpoint compatible OpenAI.
  'settings:setAnthropicKey': { req: { key: string }; res: void };
  'settings:clearAnthropicKey': { req: void; res: void };
  // Google Gemini : clé API (endpoint compatible OpenAI).
  'settings:setGeminiKey': { req: { key: string }; res: void };
  'settings:clearGeminiKey': { req: void; res: void };
  // Groq : clé API (endpoint compatible OpenAI).
  'settings:setGroqKey': { req: { key: string }; res: void };
  'settings:clearGroqKey': { req: void; res: void };
  'settings:setSmtp': { req: SmtpInput; res: void };
  // Teste la connexion SMTP sans rien enregistrer de définitif.
  'settings:testSmtp': { req: SmtpInput; res: { ok: boolean; error?: string } };
  'settings:setImap': { req: ImapInput; res: void };
  // UX-4 : test de connexion IMAP.
  'settings:testImap': { req: ImapInput; res: { ok: boolean; error?: string } };
  'settings:setScrapingEnabled': { req: { enabled: boolean }; res: void };
  // UX-11 : intervalle de polling IMAP configurable.
  'settings:setImapPollInterval': { req: { minutes: number }; res: void };
  // INT-3 : modèle IA configurable.
  'settings:setAiModel': { req: { model: string }; res: void };
  // SEC-N1 : effacer la clé OpenAI.
  'settings:clearOpenaiKey': { req: void; res: void };
  // Hunter.io : clé API pour l'enrichissement email.
  'settings:setHunterKey': { req: { key: string }; res: void };
  'settings:clearHunterKey': { req: void; res: void };
  // MOD-05 : DKIM signing.
  'settings:setDkim': { req: DkimInput; res: void };
  'settings:clearDkim': { req: void; res: void };
  // SEC-M1 : gestion du PIN de verrouillage.
  'settings:setLockPin': { req: { pin: string }; res: void };
  'settings:clearLockPin': { req: void; res: void };
  'settings:setLockTimeout': { req: { minutes: number }; res: void };
  'settings:verifyLockPin': { req: { pin: string }; res: { ok: boolean } };
  // FM-02 : limite quotidienne d'envois.
  'settings:setDailySendLimit': { req: { limit: number }; res: void };
  // OLLAMA-1 : configuration du provider IA local.
  'settings:setAiProvider': { req: { provider: string }; res: void };
  'settings:setOllamaModel': { req: { model: string }; res: void };
  'settings:setOllamaHost': { req: { host: string }; res: void };
  'settings:getOllamaModels': { req: void; res: { models: string[] } };
  // OLLAMA-2 : détection hardware pour les recommandations de modèles.
  'settings:getHardwareInfo': { req: void; res: HardwareInfo };
  // Déclenche un relevé immédiat des réponses par IMAP.
  'replies:pollNow': { req: void; res: void };
  // ANA-S3 : données heatmap par heure d'envoi.
  'stats:getHeatmap': { req: void; res: { hour: number; day: number; replyRate: number; count: number }[] };
  // ANA-S4 : export CSV des statistiques.
  'stats:exportCsv': { req: void; res: { path: string } | null };
  // UX-S7 : annulation de tâches par type.
  'taskRunner:cancelType': { req: { type: string }; res: { cancelled: number } };
  // UX-S7 : longueur de la file par type.
  'taskRunner:getQueueLength': { req: { type?: string }; res: { queued: number; active: number } };
  // UX-S10 : recherche globale.
  'search:global': { req: { query: string }; res: SearchResult[] };
  // ADM-S13 : maintenance et nettoyage des données orphelines.
  'maintenance:getStats': { req: void; res: { companiesWithoutEmail: number; failedApplications: number; oldArchivedCampaigns: number } };
  'maintenance:purgeFailedApplications': { req: void; res: { deleted: number } };
  'maintenance:purgeOldArchived': { req: { daysOld: number }; res: { deleted: number } };

  // F9 : ouvre un sélecteur de fichier et copie la base SQLite à l'emplacement choisi.
  'db:backup': { req: void; res: { path: string } | null };
  // SEC-1 : restauration d'une sauvegarde SQLite.
  'db:restore': { req: void; res: { success: boolean; error?: string } };
  // ADM-3 : réinitialisation complète des données.
  'db:reset': { req: void; res: void };
  // ADM-4v3 : export global toutes données en JSON.
  'db:exportAll': { req: void; res: { path: string } | null };
  // SEC : sauvegarde/restauration CHIFFRÉE par mot de passe (AES-256-GCM, portable).
  'db:backupEncrypted': { req: { passphrase: string }; res: { path: string } | null };
  'db:restoreEncrypted': { req: { passphrase: string }; res: { success: boolean; error?: string } };

  // M2 (revue 6) : boîte de confirmation native Electron — remplace window.confirm()
  // synchrone qui bloque le renderer et peut être silencieusement ignoré.
  'dialog:confirm': { req: { message: string; title?: string }; res: boolean };

  // ADM-2 : lecture des dernières lignes du journal de logs.
  'logs:tail': { req: { lines?: number }; res: string[] };

  // ANA-1 : statistiques globales pour le tableau de bord.
  'stats:getGlobal': { req: void; res: GlobalStats };
  // FM-02 : comparaison A/B par campagne — taux de réponse par variante.
  'stats:getAbTest': { req: { campaignId?: string }; res: { campaignId: string; campaignName: string; variantA: { sent: number; replied: number; replyRate: number }; variantB: { sent: number; replied: number; replyRate: number } }[] };
  // ANA-2v3 : activité par jour avec sélecteur de plage temporelle.
  'stats:getActivityByDay': { req: { days?: number }; res: { date: string; sent: number; replied: number }[] };
  // ANA-4v3 : tableau comparatif des campagnes.
  'stats:getCampaignComparison': { req: void; res: { id: string; name: string; sent: number; replied: number; replyRate: number; avgDays: number | null }[] };

  // INT-2v3 : planification de l'envoi d'une campagne.
  'campaign:schedule': { req: { id: string; scheduledAt: string | null }; res: Campaign };

  // RGPD : liste « ne pas contacter » (opt-out / droit d'opposition).
  'optout:list': { req: void; res: OptOutEntry[] };
  'optout:add': { req: { value: string; reason?: string }; res: OptOutEntry };
  'optout:remove': { req: { id: string }; res: void };
  // Droit à l'effacement : opt-out + suppression de toutes les données du contact.
  'optout:erase': { req: { email: string; reason?: string }; res: { erased: number } };
}

/** RGPD : entrée de la liste « ne pas contacter » exposée au renderer. */
export interface OptOutEntry {
  id: string;
  value: string;
  kind: 'email' | 'domain';
  reason: string | null;
  createdAt: string;
}

export type IpcChannel = keyof IpcRequests;

// --- Canaux d'événements (principal → renderer via webContents.send) --------

// Progression d'une tâche de fond, poussée vers l'UI au fil de l'eau.
export interface TaskProgress {
  type: 'cv-parse' | 'scrape' | 'generate-email' | 'send-email' | 'poll-replies';
  status: 'running' | 'done' | 'failed';
  message: string;
}

export interface ReplyNotification {
  companyName: string; // Nom de l'entreprise qui a répondu
  applicantName: string; // Nom du candidat (pour notification)
}

export interface IpcEvents {
  // Seul événement poussé : la progression des tâches de fond. L'UI s'en sert
  // aussi pour se rafraîchir quand une tâche se termine (status 'done').
  'task:progress': TaskProgress;
  // Notification quand une réponse est détectée par le polling IMAP.
  'reply:received': ReplyNotification;
  // BOUNCE-01 : notification quand un NDR (bounce) est détecté.
  'bounce:detected': { companyName: string; nextEmailAvailable: boolean };
  // SCRAPE-01 : ligne de progression du scraper Python (stdout line by line).
  'scraping:progress': { line: string; done: boolean; csvPath: string | null };
  // ADM-3v3 : notification de mise à jour avec version et notes de release.
  'update:ready': { version?: string; releaseNotes?: string | null };
}

export type IpcEventChannel = keyof IpcEvents;
