"""
constants — Tables, listes et regex globales partagées par le pipeline.

Aucun import circulaire possible : ce module ne dépend que de la stdlib.
"""

from __future__ import annotations

import re

# ══════════════════════════════════════════════════════════════════════════════
# SOURCES — listes par défaut et catégorisation
# ══════════════════════════════════════════════════════════════════════════════

# Sources actives par défaut.
DEFAULT_SOURCES = ["wttj", "apec", "societe", "indeed"]

# Annuaires : cherchent par activité (industry), pas par poste. Idéal candidatures spontanées.
DIRECTORY_SOURCES = {"societe", "pappers"}

# Sources DEVINÉES (jamais confirmées qu'un humain les lit) — même liste que
# UNVERIFIED_EMAIL_SOURCES côté TS (packages/shared/src/ipc-contract.ts). Miroir
# volontaire : si une source est ajoutée d'un côté sans l'autre, --skip-no-email
# laisse passer des emails à risque de bounce (bug corrigé ici : "linkedin_pattern"
# et "catch_all" avaient un email généré mais n'étaient PAS exclus par le filtre).
UNVERIFIED_EMAIL_SOURCES = {"pattern", "linkedin_pattern", "pattern_nominative", "catch_all", ""}


# ══════════════════════════════════════════════════════════════════════════════
# WEB CRAWLER — paths à visiter pour trouver un email RH
# ══════════════════════════════════════════════════════════════════════════════

CONTACT_PATHS = [
    # RH / recrutement
    '/recrutement', '/carrieres', '/carrières', '/careers', '/career',
    '/rejoignez-nous', '/nous-rejoindre', '/rejoindre-nous', '/join-us',
    '/jobs', '/offres', '/offres-emploi', '/offres-de-poste', '/postuler',
    '/on-recrute', '/on-embauche', '/recrutements',
    # Équipe / people
    '/equipe', '/équipe', '/team', '/notre-equipe', '/l-equipe',
    '/people', '/talent', '/talents', '/rh', '/hr',
    '/ressources-humaines', '/human-resources',
    # Contact
    '/contact', '/nous-contacter', '/contactez-nous', '/contact-us',
    '/about', '/about-us', '/a-propos', '/qui-sommes-nous',
    # Mentions légales — OBLIGATOIRES en France (loi LCEN art. 6) : contiennent
    # presque toujours un email réel + le nom du directeur de publication.
    # C'est la meilleure source GRATUITE d'email vérifié pour les PME/ETI FR.
    '/mentions-legales', '/mentions-legales.html', '/mentions-legales/',
    '/mentions-legal', '/legal', '/legals', '/legal-notice',
    '/cgu', '/cgv', '/conditions-generales-de-vente',
    '/politique-de-confidentialite', '/confidentialite', '/privacy', '/privacy-policy',
    '/rgpd', '/gdpr', '/donnees-personnelles',
    # Chemins avec locale FR
    '/fr/recrutement', '/fr/carrieres', '/fr/contact',
    '/fr/equipe', '/fr/jobs', '/fr/about', '/fr/about-us',
    '/fr/mentions-legales',
    # Homepage (toujours visité en dernier recours)
    '',
]

# Mots-clés filtrant les liens internes pertinents lors de la découverte dynamique.
CONTACT_LINK_KEYWORDS = [
    'contact', 'rh', 'hr', 'equipe', 'team', 'about', 'carrieres',
    'careers', 'jobs', 'people', 'recrutement', 'rejoindre', 'talent',
    'postuler', 'nous', 'employ', 'embauche', 'recrut',
    # Pages légales FR (mentions légales = email + directeur de publication obligatoires)
    'mentions', 'legal', 'legales', 'confidentialite', 'rgpd',
    'privacy', 'cgu', 'cgv', 'juridique',
]

# B2-3 : _CONTACT_LINK_KEYWORDS = alias historique supprimé — utiliser CONTACT_LINK_KEYWORDS

# Emails génériques à exclure (ne sont jamais le bon contact RH).
GENERIC_PREFIXES = frozenset([
    # 'hello' et 'bonjour' RETIRÉS : les startups/PME les utilisent souvent comme
    # boîte principale ET comme point d'entrée RH → trop risqué de les filtrer.
    'info', 'contact', 'support', 'admin',
    'noreply', 'no-reply', 'newsletter', 'notification', 'notifications',
    'webmaster', 'postmaster', 'mailer', 'bounce', 'abuse',
    'sales', 'marketing', 'press', 'media', 'legal', 'juridique',
    'comptabilite', 'accounting', 'facturation', 'billing',
])
# B2-3 : _GENERIC_PREFIXES = alias historique supprimé — utiliser GENERIC_PREFIXES


# ══════════════════════════════════════════════════════════════════════════════
# ATS DETECTION
# ══════════════════════════════════════════════════════════════════════════════

ATS_DOMAINS: dict[str, str] = {
    "jobs.lever.co":          "lever",
    "boards.greenhouse.io":   "greenhouse",
    "myworkdayjobs.com":      "workday",
    "teamtailor.com":         "teamtailor",
    "welcomekit.co":          "welcomekit",
    "smartrecruiters.com":    "smartrecruiters",
    "recruitee.com":          "recruitee",
    "breezy.hr":              "breezy",
    "ashbyhq.com":            "ashby",
    "notion.so/jobs":         "notion",
    "join.com":               "join",
    "talentio.com":           "talentio",
}


# ══════════════════════════════════════════════════════════════════════════════
# REGEX EMAIL & RH
# ══════════════════════════════════════════════════════════════════════════════

# Email standard (alias + domaine + TLD).
# Le TLD est limité à 2-10 caractères ET doit être suivi d'un non-alphanumérique
# (ou fin de chaîne) pour éviter d'avaler un suffixe HTML/CSS collé.
# Ex : "nicolas@comotic.io.ce" → le ".ce" vient d'un artefact HTML (class CSS, ponctuation…)
# et doit être rejeté. L'assertion (?![a-z0-9]) coupe net après le TLD légitime.
HR_EMAIL_RE = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,10}(?![a-z0-9])', re.IGNORECASE)

# Mots-clés identifiant un alias RH dans l'adresse locale.
HR_KEYWORDS = ['rh', 'hr', 'recrut', 'talent', 'drh', 'people', 'carrieres', 'jobs', 'employ']

# Désobfuscation : contact[at]société[dot]fr, contact(at)société.fr, contact AT société.fr,
# + variantes FR très courantes : « contact chez société point fr », « … arobase … point … ».
# Chaque séparateur gère sa propre espace : les formes-mots (at/chez/point) exigent des
# espaces autour (\s+), les symboles ([at], @, .) tolèrent des espaces optionnels (\s*).
_SEP_AT  = r'(?:\s*[\[\(\{]\s*at\s*[\]\)\}]\s*|\s*@\s*|\s+(?:at|arobase|chez)\s+)'
_SEP_DOT = r'(?:\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*|\s*\.\s*|\s+(?:dot|point)\s+)'
OBFUSCATION_RE = re.compile(
    r'([\w.+-]+)' + _SEP_AT + r'([\w.-]+)' + _SEP_DOT + r'([a-z]{2,})',
    re.IGNORECASE
)
# B2-3 : _OBFUSCATION_RE = alias historique supprimé — utiliser OBFUSCATION_RE

# Jetons anti-spam insérés dans les adresses (« jean.dupont-NOSPAM@… »).
# On les retire pour reconstruire l'adresse réelle. Conservateur : tokens connus uniquement.
ANTISPAM_TOKEN_RE = re.compile(
    r'[._-]?(?:nospam|no-spam|no_spam|antispam|anti-spam|removethis|spamfree|enleverceci)[._-]?',
    re.IGNORECASE
)


# ══════════════════════════════════════════════════════════════════════════════
# DÉTECTION DE RECRUTEURS (find_recruiter_name)
# ══════════════════════════════════════════════════════════════════════════════

RECRUITER_NAME_RE = re.compile(
    r'\b([A-ZÉÈÊËÀÙÛÜÎÏÔŒÆÇ][a-zéèêëàùûüîïôœæç]{1,20})'                              # Prénom
    r'(?:\s+[A-ZÉÈÊËÀÙÛÜÎÏÔŒÆÇ]?[a-zéèêëàùûüîïôœæç]{0,20}){0,2}'                     # particule / 2e prénom
    r'\s+([A-ZÉÈÊËÀÙÛÜÎÏÔŒÆÇ][A-ZÉÈÊËÀÙÛÜÎÏÔŒÆÇa-zéèêëàùûüîïôœæç]{1,25})'             # Nom
)
# B2-3 : _RECRUITER_NAME_RE = alias historique supprimé — utiliser RECRUITER_NAME_RE

HR_TITLES = [
    "drh", "directeur des ressources humaines", "directeur rh", "directrice rh",
    "responsable rh", "responsable ressources humaines",
    "talent acquisition", "talent manager", "recruteur", "recruteuse",
    "chargé de recrutement", "chargée de recrutement",
    "hr manager", "rh manager", "people & culture", "people manager",
    "head of people", "head of talent", "recruitment manager",
]
# B2-3 : _HR_TITLES = alias historique supprimé — utiliser HR_TITLES

HR_TITLE_ROLE = {
    "drh": "DRH", "directeur des ressources": "DRH",
    "directeur rh": "DRH", "directrice rh": "DRH",
    "responsable rh": "Responsable RH", "responsable ressources": "Responsable RH",
    "talent acquisition": "Talent Acquisition", "talent manager": "Talent Manager",
    "recruteur": "Recruteur(se)", "recruteuse": "Recruteur(se)",
    "chargé de recrutement": "Chargé(e) de Recrutement",
    "chargée de recrutement": "Chargé(e) de Recrutement",
    "people": "People & Culture", "head of people": "Head of People",
    "head of talent": "Head of Talent", "recruitment manager": "Recruitment Manager",
}
# B2-3 : _HR_TITLE_ROLE = alias historique supprimé — utiliser HR_TITLE_ROLE


# ── Titres de DIRIGEANTS (priorité maximale pour candidatures spontanées) ──────
# Atteindre le décideur direct a plus d'impact qu'un email RH générique.
CEO_TITLES = [
    "ceo", "président", "presidente", "présidente", "pdg", "p-dg",
    "directeur général", "directrice générale", "directeur general", "directrice generale",
    "dg", "fondateur", "fondatrice", "founder", "co-founder", "cofounder",
    "co-fondateur", "cofondateur", "managing director", "gérant", "gerant",
    "chief executive",
]
CEO_TITLE_ROLE = {
    "ceo": "CEO", "président": "Président", "presidente": "Présidente",
    "présidente": "Présidente", "pdg": "PDG", "p-dg": "PDG",
    "directeur général": "Directeur Général", "directrice générale": "Directrice Générale",
    "directeur general": "Directeur Général", "directrice generale": "Directrice Générale",
    "dg": "Directeur Général", "fondateur": "Fondateur", "fondatrice": "Fondatrice",
    "founder": "Founder", "co-founder": "Co-Founder", "cofounder": "Co-Founder",
    "co-fondateur": "Co-Fondateur", "cofondateur": "Co-Fondateur",
    "managing director": "Managing Director", "gérant": "Gérant", "gerant": "Gérant",
    "chief executive": "CEO",
}


# Mapping mot-clé du poste ciblé → titres de managers liés (le hiring manager probable).
# Ex : si le poste visé est "data analyst", le décideur est souvent un "Head of Data",
# "Lead Data", "CTO", "Directeur Data". On cible ces rôles en 3e priorité (après CEO et RH).
TARGET_JOB_MANAGER_TITLES: dict[str, list[str]] = {
    "data": ["head of data", "lead data", "directeur data", "data manager",
             "responsable data", "chief data officer", "cdo", "cto",
             "directeur technique", "head of analytics", "responsable bi"],
    "marketing": ["head of marketing", "directeur marketing", "directrice marketing",
                  "cmo", "responsable marketing", "growth manager", "head of growth"],
    "sales": ["head of sales", "directeur commercial", "directrice commerciale",
              "vp sales", "responsable commercial", "sales manager"],
    "finance": ["cfo", "directeur financier", "directrice financière", "daf",
                "responsable financier", "head of finance"],
    "dev": ["cto", "directeur technique", "lead developer", "head of engineering",
            "engineering manager", "vp engineering", "tech lead"],
    "developer": ["cto", "directeur technique", "lead developer", "head of engineering",
                  "engineering manager", "vp engineering", "tech lead"],
    "ingénieur": ["cto", "directeur technique", "head of engineering", "engineering manager"],
    "product": ["head of product", "cpo", "product manager", "directeur produit"],
    "design": ["head of design", "lead designer", "design manager", "directeur artistique"],
    "rh": ["drh", "directeur des ressources humaines", "responsable rh"],
    "communication": ["directeur communication", "responsable communication", "dircom"],
    "juridique": ["directeur juridique", "responsable juridique", "general counsel"],
    "consultant": ["partner", "associé", "directeur de mission", "manager"],
}


# ══════════════════════════════════════════════════════════════════════════════
# CATCH-ALL TTL (utilisé par enrich.is_catch_all)
# ══════════════════════════════════════════════════════════════════════════════

_CATCH_ALL_TTL = 60 * 60 * 24 * 7   # 7 jours

# ── Regex WHOIS partagée — extraite depuis enrich.py (B2-1 split) ─────────────
# Utilisée dans whois_email (enrich.py) ET github_find_email (enrich_apis.py).
WHOIS_IGNORE_RE = re.compile(
    r'whois|abuse|noreply|no-reply|privacy|proxy|redacted|protect|withheld|anonymized|'
    r'hostmaster|webmaster|postmaster|'
    r'gandi\.|ovh\.net|1and1|ionos|namecheap|godaddy|eurodns|'
    r'safebrands|indom\.com|ascio\.|nicrelations|legalservices|'
    r'markmonitor|networksolutions|register\.com|'
    r'@hotmail\.|@gmail\.|@yahoo\.|@free\.|@orange\.|@sfr\.|@laposte\.|@wanadoo\.|@outlook\.',
    re.IGNORECASE,
)
WHOIS_EMAIL_RE = re.compile(r'[\w.+-]+@[\w-]+\.[a-z]{2,}', re.IGNORECASE)


# ══════════════════════════════════════════════════════════════════════════════
# EMAIL SOURCES — constantes typées (B2-7)
# ══════════════════════════════════════════════════════════════════════════════
# Avant : "hunter_verifed" (faute) ou "web_Crawl" passaient silencieusement.
# Après : accès via EmailSource.HUNTER_VERIFIED → autocompletion IDE + grep fiable.
# On garde des chaînes (pas d'Enum) pour ne pas casser les comparaisons existantes
# (c.email_source == "web_crawl") ni le round-trip CSV.

class EmailSource:
    """
    Constantes pour les valeurs de Company.email_source.

    Usage : ``c.email_source = EmailSource.WEB_CRAWL``
    Vérif : ``if c.email_source in EmailSource.REAL_SOURCES:``
    """
    # ── Emails vérifiés (envoyables directement) ────────────────────────────
    HUNTER_VERIFIED    = "hunter_verified"    # Hunter.io, confidence ≥ 90%
    MANUAL             = "manual"             # fourni par l'utilisateur / importé vérifié
    LINKEDIN_SMTP      = "linkedin_smtp"      # nom LinkedIn + format Hunter + SMTP 250

    # ── Emails trouvés (fiables, non vérifiés SMTP) ────────────────────────
    WEB_CRAWL          = "web_crawl"          # extrait du site web (requests/headless)
    LLM_CRAWL          = "llm_crawl"          # extrait par LLM depuis page crawlée
    WHOIS              = "whois"              # trouvé dans le registre WHOIS
    SNOV_FOUND         = "snov_found"         # Snov.io domain-search
    APOLLO_FOUND       = "apollo_found"       # Apollo.io people-search
    HUNTER_FOUND       = "hunter_found"       # Hunter.io, confidence < 90%
    GITHUB_ORG         = "github_org"         # email public org GitHub

    # ── Patterns (construit, à vérifier avant envoi) ──────────────────────
    PATTERN_VERIFIED   = "pattern_verified"   # pattern rh@ accepté par SMTP RCPT TO
    PATTERN_NOMINATIVE = "pattern_nominative" # prénom.nom@ déduit du pattern domaine
    CATCH_ALL          = "catch_all"          # domaine accepte tout (fiabilité faible)
    LINKEDIN_PATTERN   = "linkedin_pattern"   # nom LinkedIn + format Hunter, non SMTP
    PATTERN            = "pattern"            # rh@domaine généré, non vérifié

    # ── Sans email ─────────────────────────────────────────────────────────
    NO_EMAIL           = "no_email"           # aucun email trouvé (skip-no-email)

    # ── Sets utilitaires ───────────────────────────────────────────────────
    # Sources considérées « email réel » (pas un pattern généré) :
    REAL_SOURCES: frozenset = frozenset({
        HUNTER_VERIFIED, MANUAL, LINKEDIN_SMTP, WEB_CRAWL, LLM_CRAWL,
        WHOIS, SNOV_FOUND, APOLLO_FOUND, HUNTER_FOUND, GITHUB_ORG,
        PATTERN_VERIFIED, PATTERN_NOMINATIVE,
    })
    # Sources non vérifiées (à valider avant envoi en masse) :
    UNVERIFIED_SOURCES: frozenset = frozenset({
        CATCH_ALL, LINKEDIN_PATTERN, PATTERN,
    })
    # Toutes les sources valides :
    ALL_SOURCES: frozenset = frozenset({
        HUNTER_VERIFIED, MANUAL, LINKEDIN_SMTP, WEB_CRAWL, LLM_CRAWL,
        WHOIS, SNOV_FOUND, APOLLO_FOUND, HUNTER_FOUND, GITHUB_ORG,
        PATTERN_VERIFIED, PATTERN_NOMINATIVE, CATCH_ALL, LINKEDIN_PATTERN,
        PATTERN, NO_EMAIL, "",
    })
