"""
enrich — Phases d'enrichissement du pipeline (MX, catch-all, crawl, Hunter, APIs, WHOIS, stack, validation).

Toutes les fonctions opèrent in-place sur des list[Company].
Dépendances optionnelles : dnspython, python-whois, beautifulsoup4, Wappalyzer.
"""

from __future__ import annotations

import concurrent.futures
import re
import smtplib
import socket
import threading
import time
import unicodedata
from datetime import datetime
from difflib import SequenceMatcher
from typing import TYPE_CHECKING
from urllib.parse import urljoin, urlparse

import requests

if TYPE_CHECKING:
    # Annotations forward-ref uniquement (jamais évaluées au runtime grâce à
    # `from __future__ import annotations`). Importé ici pour les type-checkers
    # et pour garder pyflakes vert → toute future référence non définie ressort.
    from .crawl_ledger import CrawlLedger

from .models import Company, _domain
from .infra import (
    _retry, RateLimiter, PersistentCache, LRUPageCache, _ThreadSafeFetcher,
    log,
)
from .constants import (
    HR_KEYWORDS, HR_EMAIL_RE, CONTACT_PATHS, ATS_DOMAINS, OBFUSCATION_RE,
    GENERIC_PREFIXES, RECRUITER_NAME_RE, HR_TITLES, HR_TITLE_ROLE,
    CONTACT_LINK_KEYWORDS, CEO_TITLES, CEO_TITLE_ROLE, TARGET_JOB_MANAGER_TITLES,
    ANTISPAM_TOKEN_RE, UNVERIFIED_EMAIL_SOURCES,
    WHOIS_IGNORE_RE as _WHOIS_IGNORE_RE,    # B2-1 : déplacé dans constants.py
    WHOIS_EMAIL_RE  as _WHOIS_EMAIL_RE,     # B2-1 : déplacé dans constants.py
)
# B2-2 : imports promus au niveau module (étaient lazy dans les fonctions).
from .email_pattern import (
    split_name, build_email, KNOWN_PATTERNS,
    detect_domain_pattern,
    HR_PATTERNS, generate_alternatives, guess_email,  # B2-1 : déplacés depuis enrich.py
)
from .classification import (
    classify_sector, normalize_company_size,
)
# B2-1 : re-exports depuis enrich_apis (façade compat descendante).
# Les appelants qui font `from .enrich import HunterClient` continuent de fonctionner.
from .enrich_apis import (          # noqa: E402  (import après constants — voulu)
    # Re-export façade (déclaré dans __all__ en bas → pyflakes ne flague pas).
    # Permet `from .enrich import HunterClient, …` après le split B2-1.
    EmailResult,
    HunterClient,
    apply_email_format, linkedin_find_hr, github_find_email,
    enrich_hunter,
)
# B2-3 : compatibilité locale — les usages dans ce fichier référencent encore les
# noms avec underscore ; on crée des alias locaux le temps de les remplacer partout.
_CONTACT_LINK_KEYWORDS = CONTACT_LINK_KEYWORDS
_GENERIC_PREFIXES      = GENERIC_PREFIXES
_OBFUSCATION_RE        = OBFUSCATION_RE
_RECRUITER_NAME_RE     = RECRUITER_NAME_RE
_HR_TITLES             = HR_TITLES
_HR_TITLE_ROLE         = HR_TITLE_ROLE

# Dépendances optionnelles
try:
    import dns.resolver as dns_resolver
    DNS_AVAILABLE = True
except ImportError:
    DNS_AVAILABLE = False

try:
    import whois as whois_lib
    WHOIS_AVAILABLE = True
except ImportError:
    WHOIS_AVAILABLE = False

try:
    from Wappalyzer import Wappalyzer as _WappalyzerLib, WebPage as _WappalyzerPage
    _WAPPALYZER = _WappalyzerLib.latest()
    WAPPALYZER_AVAILABLE = True
except Exception:
    _WAPPALYZER = None
    WAPPALYZER_AVAILABLE = False

try:
    import warnings as _warnings
    from bs4 import BeautifulSoup as _BS4
    # Certains sites servent du XML (sitemaps, flux RSS) qu'on parse en HTML.
    # BS4 émet un XMLParsedAsHTMLWarning bruyant — on le masque (le parsing marche quand même).
    try:
        from bs4 import XMLParsedAsHTMLWarning as _XMLWarn
        _warnings.filterwarnings("ignore", category=_XMLWarn)
    except ImportError:
        pass  # ancienne version de bs4 sans cette catégorie
    BS4_AVAILABLE = True
except ImportError:
    _BS4 = None
    BS4_AVAILABLE = False

# Scrapling Fetcher pour les fonctions qui l'utilisent encore
# B2-10 : sys.exit() → ImportError (voir infra.py).
try:
    from scrapling import Fetcher, StealthyFetcher
except ImportError as _scrapling_err:
    raise ImportError(
        "Le package 'scrapling' est requis. "
        "Installez-le : pip install 'scrapling[fetchers]'  (aucun navigateur requis)"
    ) from _scrapling_err


# ══════════════════════════════════════════════════════════════════════════════
# SONDE PORT 25 (point #10 audit)
# ══════════════════════════════════════════════════════════════════════════════
# La quasi-totalité des FAI résidentiels BLOQUENT le port 25 sortant. Or catch-all,
# smtp_verify_email et smtp_batch_patterns s'y connectent : depuis chez l'utilisateur
# elles échouent en silence (timeout → False) → temps perdu + faux « pas d'email »
# + pattern_verified jamais atteint. On teste UNE fois la sortie sur :25 et on
# court-circuite proprement ces phases si c'est bloqué.

_SMTP_PORT_OPEN: "bool | None" = None


def smtp_port_open() -> bool:
    """True si une connexion TCP sortante vers un MX public sur le port 25 réussit.
    Résultat mémoïsé pour tout le run (la sonde ne coûte qu'une fois)."""
    global _SMTP_PORT_OPEN
    if _SMTP_PORT_OPEN is not None:
        return _SMTP_PORT_OPEN
    open_ok = False
    # MX Google : stable, répond sur :25. Timeout court — si bloqué, ça pend sinon.
    for host in ("alt1.gmail-smtp-in.l.google.com", "aspmx.l.google.com"):
        try:
            with socket.create_connection((host, 25), timeout=5):
                open_ok = True
                break
        except OSError:
            continue
    _SMTP_PORT_OPEN = open_ok
    if not open_ok:
        log.warning("Port 25 sortant bloqué — phases SMTP (catch-all, vérif, "
                    "smtp_batch) désactivées pour ce run.")
    return open_ok


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — FILTRE DNS / MX
# ══════════════════════════════════════════════════════════════════════════════

def domain_has_mx(domain: str, cache: "PersistentCache | None" = None) -> bool:
    """
    Vérifie qu'un domaine possède au moins un enregistrement MX valide.
    Un domaine sans MX ne peut pas recevoir d'email → inutile d'essayer.
    Résultats mis en cache (TTL 7 jours) pour éviter les re-lookups.
    """
    if not DNS_AVAILABLE or not domain:
        return True  # faute de mieux, on laisse passer
    if cache:
        cached = cache.get(f"mx:{domain}")
        if cached is not None:
            return cached == "1"
    try:
        dns_resolver.resolve(domain, "MX", lifetime=3)
        result = True
    except Exception:
        result = False
    if cache:
        cache.set(f"mx:{domain}", "1" if result else "0", ttl=60 * 60 * 24 * 7)
    return result


def filter_mx(
    companies: list[Company],
    cache: "PersistentCache | None" = None,
    workers: int = 10,
) -> tuple[list[Company], int]:
    """
    Filtre DNS/MX en parallèle.

    A1 : tente d'abord la version async (dns.asyncresolver, Semaphore(40)).
    Si asyncio indisponible ou erreur → bascule sur ThreadPoolExecutor(workers).
    La version async est ~2-3× plus rapide : 40 lookups simultanés sans overhead thread.
    """
    print("\n🔍  Phase 2 : filtre DNS/MX (parallèle)…")
    domains   = [_domain(c.website) for c in companies]
    unique_ds = [d for d in set(domains) if d]
    has_mx: dict[str, bool] = {}

    # ── Essai async (A1) ──────────────────────────────────────────────────────
    try:
        from .enrich_async import async_mx_filter
        has_mx = async_mx_filter(unique_ds, cache, max_concurrent=40)
    except Exception as _async_err:
        log.debug("filter_mx async échoué (%r) → fallback threads", _async_err)
        has_mx = {}

    # ── Fallback threads si async indisponible ou partiel ────────────────────
    missing = [d for d in unique_ds if d not in has_mx]
    if missing:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            future_map = {ex.submit(domain_has_mx, d, cache): d for d in missing}
            for fut in concurrent.futures.as_completed(future_map):
                d = future_map[fut]
                try:
                    has_mx[d] = fut.result()
                except Exception:
                    has_mx[d] = True

    kept, eliminated = [], 0
    for c, domain in zip(companies, domains):
        if not domain or has_mx.get(domain, True):
            kept.append(c)
        else:
            eliminated += 1
            print(f"   ✗  {c.name} ({domain}) — aucun MX")
    print(f"   → {len(kept)} conservées, {eliminated} éliminées (domaine mort)")
    return kept, eliminated


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3 — CATCH-ALL SMTP PROBE
# ══════════════════════════════════════════════════════════════════════════════

# FIX-5 : le dict en mémoire est remplacé par PersistentCache (TTL 7 jours) passé en paramètre.
# Avantage : les résultats survivent au redémarrage du script et les threads partagent la
# même instance SQLite thread-safe (check_same_thread=False).

_CATCH_ALL_TTL = 60 * 60 * 24 * 7  # 7 jours

def is_catch_all(domain: str, cache: "PersistentCache | None" = None) -> bool:
    """
    Envoie RCPT TO avec une adresse aléatoire inexistante.
    Si le serveur répond 250 → domaine catch-all → n'importe quel email sera accepté.

    FIX-5 : cache optionnel PersistentCache (TTL 7 jours) pour éviter les sondes répétées
    entre sessions. Si absent, le résultat est calculé à chaque appel.

    B1-9 : timeout TOTAL de l'échange SMTP (10 s) via Future, en plus du timeout socket
    (5 s par commande). Le timeout socket protège chaque commande individuellement ;
    le timeout total protège contre N commandes lentes cumulées (~5 s × 4 = 20 s max
    avant ce fix). Un serveur anti-spam qui traîne mais ne timeout jamais ne peut plus
    bloquer le run plus de 10 s.
    """
    if not DNS_AVAILABLE or not domain:
        return False

    cache_key = f"catch_all:{domain}"
    if cache:
        cached = cache.get(cache_key)
        if cached is not None:
            return cached == "1"

    def _do_probe() -> bool:
        mx_records = dns_resolver.resolve(domain, 'MX', lifetime=3)
        mx_host = str(sorted(mx_records, key=lambda r: r.preference)[0].exchange).rstrip('.')
        with smtplib.SMTP(timeout=5) as smtp:
            smtp.connect(mx_host, 25)
            smtp.helo('probe.candio.local')
            smtp.mail('noreply@candio.local')
            code, _ = smtp.rcpt(f'zzz_nonexistent_9x7k@{domain}')
            return code == 250

    result = False
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as _ex:
            fut = _ex.submit(_do_probe)
            try:
                result = fut.result(timeout=10)   # 10 s plafond total
            except concurrent.futures.TimeoutError:
                result = False
    except Exception:
        result = False

    if cache:
        cache.set(cache_key, "1" if result else "0", ttl=_CATCH_ALL_TTL)
    return result


def enrich_catch_all(companies: list[Company], workers: int = 8,
                     cache: "PersistentCache | None" = None) -> None:
    """
    Détection catch-all SMTP en parallèle (ThreadPoolExecutor).
    workers=8 par défaut → 8 connexions SMTP simultanées.

    FIX-5 : ``cache`` PersistentCache transmis à is_catch_all pour persister les résultats.
    """
    need = [c for c in companies if not c.contact_email and _domain(c.website)]
    if not need:
        return
    # Point #10 : inutile de sonder si le port 25 sortant est bloqué (FAI résidentiel).
    if not smtp_port_open():
        print("\n⏭   Phase 3 : catch-all SMTP sautée (port 25 sortant bloqué).")
        return
    print(f"\n🔍  Phase 3 : détection catch-all SMTP ({len(need)} domaines, parallèle)…")

    domains  = list({_domain(c.website) for c in need})
    results: dict[str, bool] = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        future_map = {ex.submit(is_catch_all, d, cache): d for d in domains}
        for fut in concurrent.futures.as_completed(future_map):
            d = future_map[fut]
            try:
                results[d] = fut.result()
            except Exception:
                results[d] = False

    count = 0
    for c in need:
        domain = _domain(c.website)
        if results.get(domain, False):
            c.email_source  = "catch_all"
            c.contact_email = f"rh@{domain}"
            count += 1
            print(f"   ✅  {c.name} ({domain}) — catch-all")
    print(f"   → {count} domaines catch-all détectés")


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 4 — CRAWLER PAGE CONTACT / ÉQUIPE
# ══════════════════════════════════════════════════════════════════════════════

# Point #5 (audit) : CONTACT_PATHS, _CONTACT_LINK_KEYWORDS, _GENERIC_PREFIXES,
# ATS_DOMAINS, HR_EMAIL_RE, HR_KEYWORDS sont désormais importés de .constants
# (source UNIQUE). Les copies locales — déjà périmées (la version locale de
# CONTACT_PATHS n'avait pas les chemins /mentions-legales) — ont été supprimées
# pour éliminer le risque de divergence (même classe de bug que _OBFUSCATION_RE).


def detect_ats_from_page(page) -> tuple[str, str]:
    """
    Lit les liens d'une page Scrapling déjà chargée pour détecter l'ATS utilisé.
    Aucune requête supplémentaire — réutilise les pages du web crawler.
    Retourne (ats_name, ats_url) ou ('', '').
    """
    try:
        for a in page.css("a[href]"):
            href = (a.attrib.get("href") or "").lower()
            for ats_domain, ats_name in ATS_DOMAINS.items():
                if ats_domain in href:
                    return ats_name, a.attrib.get("href", "")
    except Exception:
        pass
    return "", ""


def detect_ats_from_soup(soup) -> tuple[str, str]:
    """
    Détection ATS depuis un objet BeautifulSoup (pages crawlées en requests).

    B1-2 : remplace le hack `type('P', (), {'css': lambda...})()` utilisé dans
    crawl_contact_page._visit. L'ancien code créait un faux objet Scrapling
    à la volée — illisible, fragile, et inutile puisque BS4 est déjà chargé.
    Cette fonction travaille directement sur le soup existant sans mock.
    Retourne (ats_name, ats_url) ou ('', '').
    """
    try:
        for a in soup.find_all("a", href=True):
            href = (a.get("href") or "").lower()
            for ats_domain, ats_name in ATS_DOMAINS.items():
                if ats_domain in href:
                    return ats_name, a.get("href", "")
    except Exception:
        pass
    return "", ""


# HR_EMAIL_RE et HR_KEYWORDS : importés de .constants (cf. point #5 ci-dessus).

# ── Regex de désobfuscation ────────────────────────────────────────────────────
# _OBFUSCATION_RE est importé de .constants (source unique). Ne PAS le redéfinir ici :
# une copie locale périmée masquait les formes FR « chez / point / arobase » (bug corrigé).


def _deobfuscate_emails(text: str) -> list[str]:
    """Reconstruit les emails obfusqués : contact[at]société[dot]fr → contact@société.fr"""
    found = []
    for m in _OBFUSCATION_RE.finditer(text):
        email = f"{m.group(1)}@{m.group(2)}.{m.group(3)}".lower()
        if len(email) < 80:
            found.append(_clean_antispam(email))
    return found


def _clean_antispam(email: str) -> str:
    """Retire les jetons anti-spam d'une adresse : jean.dupont-NOSPAM@x.fr → jean.dupont@x.fr."""
    local, sep, domain = email.partition("@")
    if not sep:
        return email
    cleaned = ANTISPAM_TOKEN_RE.sub("", local).strip("._-")
    return f"{cleaned}@{domain}" if cleaned else email


def _decode_cfemail(encoded: str) -> str:
    """
    Décode une adresse protégée par Cloudflare Email Protection.

    Cloudflare remplace les emails par <a data-cfemail="HEX"> où HEX est l'adresse
    XOR-encodée : le 1er octet est la clé, chaque octet suivant XOR clé = un caractère.
    Décodage 100 % déterministe et gratuit — récupère des emails TOTALEMENT invisibles
    au crawler classique (ils ne sont jamais dans le texte rendu).
    """
    try:
        key = int(encoded[:2], 16)
        out = "".join(
            chr(int(encoded[i:i + 2], 16) ^ key)
            for i in range(2, len(encoded), 2)
        )
        return out.lower() if "@" in out else ""
    except (ValueError, IndexError):
        return ""


def _extract_cf_emails(html: str) -> list[str]:
    """
    Extrait les emails obfusqués par Cloudflare depuis le HTML brut.
    Deux formes : l'attribut data-cfemail="…" et le lien /cdn-cgi/l/email-protection#…
    """
    if not html:
        return []
    found: list[str] = []
    for m in re.finditer(r'data-cfemail="([0-9a-fA-F]{6,})"', html):
        e = _decode_cfemail(m.group(1))
        if e:
            found.append(e)
    for m in re.finditer(r'/cdn-cgi/l/email-protection#([0-9a-fA-F]{6,})', html):
        e = _decode_cfemail(m.group(1))
        if e:
            found.append(e)
    return found


def _rank_email(email: str, site_domain: str) -> int:
    """
    Score de pertinence d'un email (plus haut = meilleur contact RH).
    4 – HR keyword dans l'alias  (rh@, talent@, recrutement@…)
    3 – Email nominatif          (prenom.nom@, p.nom@)
    2 – Alias court non-générique (claire@, david@)
    1 – Email sur le bon domaine mais non classé
    0 – Email générique ou hors-domaine
    """
    if not email or site_domain not in email.lower():
        return 0
    # -1 : mailbox bidon/technique/non pertinente → ne doit JAMAIS être retenue.
    # best_score démarre à -1, donc un score -1 ne remplace jamais best_email.
    if _is_junk_email(email):
        return -1
    # Dernier recours (info@, secretariat@…) : score 0 — acceptés uniquement si
    # aucun meilleur email n'est trouvé sur le site (score 0 > -1 initial).
    local = email.lower().split('@')[0]
    if local in _LAST_RESORT_ALIASES:
        return 0
    # Niveau 4 : keyword RH explicite  (B1-7 : double assignation locale supprimée)
    if any(k in local for k in HR_KEYWORDS):
        return 4
    # Niveau 3 : format nominatif prenom.nom ou p.nom
    if re.match(r'^[a-z]{2,15}\.[a-z]{2,20}$', local):
        return 3
    # Niveau 2 : prénom seul court, non-générique
    if re.match(r'^[a-z]{2,15}$', local) and local not in _GENERIC_PREFIXES:
        return 2
    # Niveau 1 : sur le bon domaine mais alias non reconnu
    if local not in _GENERIC_PREFIXES:
        return 1
    return 0


# Local-parts bidons : exemples/placeholders trouvés sur les sites, JAMAIS de vrais contacts.
# Ex : "votre.nom@", "from@" (header d'exemple), "nomdedomaine@" (placeholder FR).
_JUNK_LOCAL_PARTS = frozenset([
    "from", "to", "cc", "bcc", "subject", "reply", "sender", "recipient",
    "example", "exemple", "votrenom", "votre.nom", "votre", "your", "yourname", "your.name",
    "nom", "prenom", "nom.prenom", "prenom.nom", "name", "firstname", "lastname",
    "nomdedomaine", "domainname", "domain", "monemail", "myemail", "email", "mail",
    "user", "username", "utilisateur", "test", "demo", "sample", "placeholder",
    "xxx", "xxxx", "abc", "aaa", "nobody", "someone", "anyone",
    # Fragments de TLD/protocole ramassés par erreur dans du texte/HTML
    # (ex : "…site.com@autre.eu" → local-part "com"). Jamais un vrai contact.
    "com", "www", "website", "site", "http", "https", "fr", "en", "net", "org", "html",
    # Noms de démo classiques (templates, captures d'écran) — ex : john@studiobinder.com
    "john", "jane", "johndoe", "janedoe", "jdoe", "joe", "doe", "foo", "bar", "baz",
    # Mailboxes techniques / registrar / domaine — souvent issues du WHOIS.
    # Ex : gestion.domaine@…, hostmaster@…, dns@…
    "gestion.domaine", "gestiondomaine", "domaine", "domain", "domains",
    "dns", "nic", "hostmaster", "postmaster", "webmaster", "registrar",
    "registry", "noc", "sysadmin", "root", "daemon",
    # Relations investisseurs / actionnaires — mauvaise cible (ex : ir@rexel.com)
    "ir", "investor", "investors", "investisseurs", "actionnaire", "actionnaires",
    "relations", "relationspresse",
    # Conformité / juridique / facturation — pas un contact RH
    "dpo", "rgpd", "gdpr", "privacy", "confidentialite", "cookie", "cookies",
    "invoice", "billing", "facturation", "compta", "comptabilite", "accounting",
    # Politiques / conformité (ex : policies@cgtechlabs.com vu en run réel — boîte
    # légale/conformité, jamais un contact recrutement).
    "policies", "policy", "compliance", "conformite", "conformity", "legalnotice",
    # Sécurité / SOC (ex : security@agora.io vu en run réel — équipe sécu, pas RH).
    "security", "securite", "soc", "csirt", "cert", "vulndisclosure",
    # Mailboxes institutionnelles génériques (ex : etat@ugap.fr — marché public)
    "etat", "service", "services", "standard", "accueil",
    # "secretariat" retiré → géré par _LAST_RESORT_ALIASES (dernier recours, pas junk dur)
    # Mailboxes commandes / achats — jamais un contact RH.
    "orders", "order", "commande", "commandes", "achats", "achat", "purchase", "purchases",
    "shop", "store", "boutique", "vente", "ventes", "sales2", "export", "imports",
])

# Sous-chaînes qui trahissent une mailbox de service/technique même en composé
# (ex : "contactexport" → export, "gestiondesdomaines" → domaine). Recherchées en
# SOUS-CHAÎNE, donc on n'y met QUE des termes qui n'apparaissent jamais dans un
# vrai nom de personne (sinon faux positifs).
_NON_HR_SUBSTRINGS = (
    "hostmaster", "postmaster", "webmaster", "mailmaster", "domainmaster",
    "gestiondomaine", "gestiondesdomaines", "noreply", "no-reply", "donotreply",
    "newsletter", "mailerdaemon", "export", "import", "facturation",
    "comptabilite", "rgpd", "gdpr", "payment", "paiement", "paymentinquiry",
    # Contacts registrar / gestion de domaine (typiques du WHOIS : gestion.registrar@…)
    "registrar", "gestionregistrar", "nomdedomaine", "noms-de-domaine",
    # Boîtes « droits sur les données personnelles » / RGPD (ex : mesdonneesperso@,
    # vosdonnees@, dataprotection@) — c'est un guichet vie privée, jamais un RH.
    "donneesperso", "donneespersonnelles", "mesdonnees", "vosdonnees",
    "dataprivacy", "dataprotection", "protectiondesdonnees", "vieprivee", "privacy",
    # Politiques / conformité en composé (datapolicies@, compliancedept@…).
    "policies", "compliance", "conformite",
)


# Tokens « génériques » : mailbox de service/marketing, jamais une personne.
# Étend GENERIC_PREFIXES (constants) avec des variantes FR. Détecté STRUCTURELLEMENT
# (cf. _is_generic_email) → attrape aussi les composés (serviceinfo, info.br…).
_GENERIC_ROLE_TOKENS = (frozenset(GENERIC_PREFIXES) | {
    "service", "services", "serviceclient", "serviceinfo", "infoservice",
    "commercial", "commerciale", "commerciaux", "accueil", "sav", "aftersales",
    "communication", "secretariat", "standard", "partenariat",
    # 'direction' RETIRÉ : dans une TPE, direction@ = souvent le patron lui-même
    # qui répond aux candidatures. Trop précieux à perdre.
    "partenariats", "presse", "relation", "relations", "webmarketing",
    "newsletter", "info", "infos", "contactez", "boutique", "shop", "store",
    "client", "clients", "clientele", "reservation", "reservations", "devis",
    # Support / aide (FR/EN/ES) — guichet d'assistance, jamais un contact RH.
    "support", "help", "aide", "ayuda", "soporte", "helpdesk", "assistance",
}) - {
    # 'contact@' est ACCEPTÉ (demande utilisateur) — c'est le générique le plus
    # légitime pour joindre une PME. On le retire donc des jetons « génériques ».
    "contact", "contacts", "contactez",
}

# Mailboxes RH = la CIBLE d'une candidature spontanée → JAMAIS considérées génériques,
# même si elles sont « de rôle » (rh@, recrutement@, jobs@…).
_HR_KEEP_KEYWORDS = (
    "rh", "hr", "recrut", "talent", "career", "carriere", "job", "emploi",
    "drh", "people", "candidat", "stage", "alternance", "hiring",
)


def _is_generic_email(email: str) -> bool:
    """
    True si l'adresse est une mailbox GÉNÉRIQUE / de service (info@, marketing@,
    serviceinfo@, info.br@, commercial@…) — pas une personne. Détection
    STRUCTURELLE : on découpe le local-part et on vérifie que TOUS ses jetons
    significatifs sont génériques (ou commencent par un préfixe générique). Ainsi
    on attrape les variantes/composés sans liste exhaustive.

    Les mailboxes RH (rh@, recrutement@, jobs@…) sont explicitement CONSERVÉES :
    ce sont les cibles d'une candidature spontanée.
    """
    local = email.split("@")[0].lower().strip()
    if not local:
        return False
    if any(k in local for k in _HR_KEEP_KEYWORDS):
        return False
    raw = [t for t in re.split(r"[._+\-]", local) if t]
    # Jetons significatifs : on ignore les suffixes courts (pays/langue : br, fr,
    # en, us…) et purement numériques (info2, contact01…).
    tokens = [t for t in raw if len(t) > 2 and not t.isdigit()]
    if not tokens:
        tokens = [t for t in raw if t and not t.isdigit()]
    if not tokens:
        return False

    def _tok_generic(t: str) -> bool:
        if t in _GENERIC_ROLE_TOKENS:
            return True
        return any(len(g) >= 4 and t.startswith(g) for g in _GENERIC_ROLE_TOKENS)

    return all(_tok_generic(t) for t in tokens)


# Aliases génériques mais légitimes pour une PME française : pas du tout « junk »,
# mais pas le meilleur contact non plus. On les laisse passer avec score 0 dans
# _rank_email → ils survivent SEULEMENT si aucun meilleur email n'est trouvé sur le
# site (vrai mécanisme de dernier recours). Si l'entreprise n'a QUE info@ comme
# contact, mieux vaut ça que de l'exclure entièrement.
# Domaines email connus pour être des services de confidentialité WHOIS / registrars.
# Un email "company@domains.ma2t.com" n'est pas le vrai contact de la société.
_WHOIS_PRIVACY_DOMAINS = frozenset({
    "whoisguard.com", "privacyprotect.org", "domainsbyproxy.com",
    "contactprivacy.com", "whoisprivacyprotect.com", "perfectprivacy.com",
    "privacydotlink.com", "anonymize.com", "withheldforprivacy.com",
    "redacted.invalid", "redactedforprivacy.com",
    # Sous-domaines registrar connus (le domaine racine peut être légitime, mais
    # "domains.x.com" ou "proxy.x.com" = service de confidentialité WHOIS).
})

_LAST_RESORT_ALIASES = frozenset({"info", "infos", "secretariat"})


def _is_junk_email(email: str) -> bool:
    """True si l'email est un placeholder/exemple, une mailbox technique OU générique."""
    local = email.split("@")[0].lower().strip()
    # Dernier recours : info@, infos@, secretariat@ — pas filtrés ici, juste déprioritisés.
    if local in _LAST_RESORT_ALIASES:
        return False
    if local in _JUNK_LOCAL_PARTS:
        return True
    # Email domain = service WHOIS / registrar → pas le vrai contact de la société.
    if "@" in email:
        email_domain = email.split("@", 1)[1].lower()
        if email_domain in _WHOIS_PRIVACY_DOMAINS:
            return True
        # Sous-domaine d'un domaine registrar connu (ex: proxy.whoisguard.com)
        if any(email_domain.endswith("." + d) for d in _WHOIS_PRIVACY_DOMAINS):
            return True
        # Heuristique structurelle : "domains.<quelquechose>" = proxy WHOIS quasi-certain
        # (ex: domains.ma2t.com, domains.registrar.eu…)
        if email_domain.startswith("domains."):
            return True
    # Local-part purement répétitif (aaaa, xxxx) ou trop court non-informatif
    if len(local) >= 3 and len(set(local.replace(".", ""))) == 1:
        return True
    # Mailbox de service/technique reconnue en sous-chaîne (contactexport, etc.)
    flat = local.replace(".", "").replace("-", "").replace("_", "")
    if any(kw.replace("-", "") in flat for kw in _NON_HR_SUBSTRINGS):
        return True
    # Mailbox générique / de service détectée structurellement (info@, marketing@,
    # serviceinfo@, info.br@…) — jamais une vraie personne (hors RH).
    if _is_generic_email(email):
        return True
    return False


def _sanitize_email_tld(email: str) -> str:
    """
    Supprime les suffixes parasites collés au TLD par le parser HTML.
    Ex : "nicolas@comotic.io.ce" → "nicolas@comotic.io"
          (source : "…@comotic.io. Ce site…" → IGNORECASE avale ".ce")
    Principe : si le dernier composant du domaine n'est pas un TLD plausible,
    on le retire et on réessaie (une seule passe — un email sain ne nécessite pas plus).
    """
    if "@" not in email:
        return email
    local, domain = email.rsplit("@", 1)
    # Aucun domaine d'email ne commence par "www." : c'est un artefact de parsing
    # (ex : "website@www.quantiota.ai" ramassé dans du texte). On le retire.
    domain = domain[4:] if domain.startswith("www.") else domain
    email = f"{local}@{domain}"
    parts = domain.split(".")
    # TLD final plausible → rien à faire.
    from .domain_resolve import _tld_plausible
    if len(parts) >= 2 and _tld_plausible(domain):
        return email
    # On retire le dernier composant et on reteste.
    if len(parts) >= 3:
        trimmed = ".".join(parts[:-1])
        if _tld_plausible(trimmed):
            return f"{local}@{trimmed}"
    return email   # on ne peut pas corriger → on renvoie tel quel (sera filtré après)


def _collect_all_emails(text: str, html: str, site_domain: str) -> list[str]:
    """
    Collecte TOUS les emails d'une page : regex classique + mailto: + désobfuscation.
    Retourne une liste triée par score décroissant (meilleur contact en premier).
    Filtre les placeholders/exemples (from@, votre.nom@, nomdedomaine@…).
    """
    found: set[str] = set()

    # 1. Regex standard
    for m in HR_EMAIL_RE.finditer(text):
        found.add(m.group(0).lower())

    # 2. Balises mailto: (plus fiables car explicites)
    if html and BS4_AVAILABLE:
        try:
            soup = _BS4(html, 'html.parser')
            for a in soup.find_all('a', href=True):
                href = a['href']
                if href.lower().startswith('mailto:'):
                    email = href[7:].split('?')[0].strip().lower()
                    if '@' in email:
                        found.add(email)
        except Exception:
            pass

    # 3. Désobfuscation (texte : [at]/[dot], chez/point, anti-spam)
    for email in _deobfuscate_emails(text):
        found.add(email)

    # 4. Cloudflare Email Protection — emails XOR-encodés dans data-cfemail / cdn-cgi.
    #    Invisibles au texte rendu : seul le HTML brut les contient.
    for email in _extract_cf_emails(html):
        found.add(_clean_antispam(email))

    # Nettoyage anti-spam + correction TLD parasite sur tout le lot
    found = {_sanitize_email_tld(_clean_antispam(e)) for e in found}

    # Ancrage sur le domaine du site : si le domaine de l'email est le site_domain
    # suivi d'un suffixe PARASITE (ex : "security@agora.io.agora" alors que le site
    # est agora.io — le « .agora » vient d'un artefact de parsing « …agora.io. Agora… »),
    # on le ramène au site_domain. Ne touche PAS les vrais sous-domaines (mail.acme.fr),
    # car ceux-là ont site_domain en SUFFIXE, pas en préfixe.
    if site_domain:
        def _anchor(e: str) -> str:
            if "@" not in e:
                return e
            loc, dom = e.rsplit("@", 1)
            if dom != site_domain and dom.startswith(site_domain + "."):
                return f"{loc}@{site_domain}"
            return e
        found = {_anchor(e) for e in found}

    # Filtre les placeholders/exemples avant scoring
    found = {e for e in found if not _is_junk_email(e)}

    # Trier par score décroissant.
    # B1-6 : walrus operator → _rank_email() appelé UNE seule fois par email
    # (avant : 2 appels par email = scores calculés deux fois à chaque page).
    scored = [(e, s) for e in found if (s := _rank_email(e, site_domain)) > 0]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [e for e, _ in scored]


def _discover_contact_links(base: str, html: str, max_links: int = 15) -> list[str]:
    """
    Parse la homepage (HTML) pour trouver les liens internes qui mènent
    probablement à une page Contact / RH / Équipe.
    Retourne au plus ``max_links`` URLs triées par pertinence.
    """
    if not BS4_AVAILABLE or not html:
        return []
    try:
        soup = _BS4(html, 'html.parser')
        scored: list[tuple[str, int]] = []
        seen: set[str] = set()
        base_stripped = base.rstrip('/')
        for a in soup.find_all('a', href=True):
            href = a['href'].strip()
            if href.startswith(('#', 'mailto:', 'tel:', 'javascript:', 'data:')):
                continue
            # Résolution complète AVANT de tester si le lien est interne.
            # Gère : liens absolus (http://), relatifs (/contact), et
            # protocol-relative (//cdn.acme.fr) que urljoin résout correctement
            # mais que l'ancien code laissait passer avant de résoudre (URLs
            # externes protocol-relative étaient crawlées → faux-positifs).
            full_url = urljoin(base, href).rstrip('/')
            # Rejeter tout ce qui n'est pas interne au domaine de base
            if not (full_url == base_stripped or full_url.startswith(base_stripped + '/')):
                continue
            if full_url in seen:
                continue
            seen.add(full_url)
            path = urlparse(full_url).path.lower()
            link_text = a.get_text(strip=True).lower()
            combined = path + ' ' + link_text
            score = sum(1 for kw in _CONTACT_LINK_KEYWORDS if kw in combined)
            if score > 0:
                scored.append((full_url, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return [url for url, _ in scored[:max_links]]
    except Exception:
        return []


def crawl_contact_page(
    website: str,
    fetcher: "_ThreadSafeFetcher | StealthyFetcher",
    company: "Company | None" = None,
    page_cache: "LRUPageCache | None" = None,
    llm_client = None,                       # LLMClient optionnel — fallback intelligent quand regex échoue
    url_ledger: "CrawlLedger | None" = None, # mode explore : éviter les pages déjà visitées
    budget_override: "float | None" = None,  # budget max en secondes (écrase CRAWL_BUDGET_SEC)
) -> tuple[str, str, str]:
    """
    Visite les pages Contact/Équipe du site pour trouver un email RH direct.

    Stratégie en 3 étapes :
      1. Parcourt les CONTACT_PATHS étendus (~35 chemins).
      2. Depuis la homepage, découvre dynamiquement les liens internes pertinents
         (jusqu'à 15 pages supplémentaires) via _discover_contact_links().
      3. Pour chaque page : mailto: en priorité, puis regex, puis désobfuscation.
         Retourne l'email le mieux classé (HR keyword > nominatif > générique).

    Retourne (email, nom_contact, source) ou ("","","").
    """
    base = website.rstrip('/')
    if not base.startswith('http'):
        return "", "", ""

    site_domain = _domain(website)
    best_email   = ""
    best_score   = -1
    homepage_html: str = ""   # HTML de la homepage, gardé pour la découverte de liens
    all_seen_emails: set[str] = set()   # tous les emails vus → inférence du pattern domaine
    consecutive_fail = 0      # échecs réseau consécutifs → bail-out anti-lenteur

    # Probe TCP rapide — bail-out si le domaine est mort.
    # P1-6 : on partage `_tcp_reachable` avec fast_crawl (cache commun) au lieu de
    # rejouer un HEAD HTTP (5 s + redirections) déjà coûté côté fast-crawl.
    if not _tcp_reachable(site_domain):
        return "", "", ""

    def _visit(url: str) -> None:
        """Visite une URL, extrait les emails, met à jour best_email/best_score."""
        nonlocal best_email, best_score, homepage_html, consecutive_fail

        # Mode explore : page déjà visitée lors d'un run précédent → on l'évite.
        if url_ledger is not None and url_ledger.seen_url(url):
            return

        # Cache partagé avec detect_tech_stack (évite les re-téléchargements)
        cached_text = page_cache.get(url) if page_cache is not None else None
        if cached_text is not None:
            emails = _collect_all_emails(cached_text, "", site_domain)
        else:
            try:
                resp = _get_ssl_lenient(
                    requests, url, 6,  # 6 s + repli SSL verify=False
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0",
                             "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"})
                consecutive_fail = 0
                if url_ledger is not None and resp.status_code in (200, 301, 302):
                    url_ledger.mark_url(url)  # page visitée → évitée aux runs suivants
                if resp.status_code not in (200, 301, 302):
                    return
                html  = resp.text
                # Garder la homepage pour la découverte de liens
                if url == base or url == base + '/':
                    homepage_html = html
                # Parse BS4 UNE seule fois → réutilisé pour text + ATS.
                # Avant : deux appels _BS4(html, 'html.parser') séparés (pour text
                # et pour ATS) → CPU doublé sur chaque page. Maintenant : 1 seul parse.
                if BS4_AVAILABLE:
                    _soup = _BS4(html, 'html.parser')
                    text  = _soup.get_text(separator=' ', strip=True)
                    if company and not company.ats_name:
                        try:
                            ats_name, ats_url = detect_ats_from_soup(_soup)
                            if ats_name:
                                company.ats_name = ats_name
                                company.ats_url  = ats_url
                        except Exception:
                            pass
                else:
                    text = html
                if page_cache is not None:
                    page_cache[url] = text
                emails = _collect_all_emails(text, html, site_domain)
            except Exception:
                consecutive_fail += 1
                return

        # Mémorise tous les emails du domaine → inférence du pattern plus tard
        for email in emails:
            if email.lower().split("@")[-1] == site_domain:
                all_seen_emails.add(email.lower())

        for email in emails:
            score = _rank_email(email, site_domain)
            if score > best_score:
                best_score = score
                best_email = email
                if score >= 4:   # RH keyword → on ne peut pas faire mieux, stop
                    return

    # ── Étape 1 : paths statiques étendus ─────────────────────────────────────
    # On borne le headless aux ~22 chemins les PLUS utiles (RH > équipe > contact).
    # CONTACT_PATHS (unifié, ~60 entrées) inclut beaucoup de pages légales déjà
    # couvertes par le fast-crawl requests ; les rejouer en headless (8 s/page)
    # ferait exploser le temps sur un site lent. Cap = compromis vitesse/couverture.
    # Sous-ensemble CURÉ couvrant TOUTES les catégories à fort rendement (et non
    # les N premiers d'une liste triée RH-d'abord, qui coupait /contact et surtout
    # /mentions-legales — source d'email vérifié la + fiable pour les PME FR/LCEN).
    # La couverture des meilleures pages est préservée ; le PLAFOND TEMPS borne la
    # durée sur les sites lents (et la découverte dynamique Étape 2 complète le reste).
    _HEADLESS_PRIORITY_PATHS = [
        "", "/contact", "/nous-contacter", "/contactez-nous", "/contact-us",
        "/mentions-legales", "/mentions-legales.html", "/legal",
        "/recrutement", "/carrieres", "/careers", "/jobs",
        "/equipe", "/team", "/rh", "/about", "/a-propos",
    ]
    _budget = budget_override if budget_override is not None else CRAWL_BUDGET_SEC
    _t0 = time.monotonic()
    for path in _HEADLESS_PRIORITY_PATHS:
        # Plafond (budget partagé avec fast_crawl) + bail-out après 2 échecs consécutifs.
        if time.monotonic() - _t0 > _budget or consecutive_fail >= 2:
            break
        _visit(base + path)
        if best_score >= 4:
            break
        if path == '' and homepage_html:
            continue  # homepage visitée → on continue les pages prioritaires

    # ── Étape 2 : découverte dynamique depuis la homepage ─────────────────────
    if best_score < 4 and BS4_AVAILABLE:
        # Charger la homepage si pas encore fait
        if not homepage_html:
            try:
                r = requests.get(base, timeout=8, allow_redirects=True,
                                 headers={"User-Agent": "Mozilla/5.0"})
                if r.status_code == 200:
                    homepage_html = r.text
            except Exception:
                pass
        if homepage_html:
            discovered = _discover_contact_links(base, homepage_html, max_links=15)
            for url in discovered:
                # Le plafond couvre AUSSI la découverte dynamique (sinon un gros
                # SPA comme github.com pouvait dépasser via les 15 liens).
                if time.monotonic() - _t0 > _budget or consecutive_fail >= 2:
                    break
                _visit(url)
                if best_score >= 4:
                    break

    # ── Inférence du pattern d'email du domaine ───────────────────────────────
    # Depuis tous les emails nominatifs vus, on déduit le format (ex: {first}.{last}).
    # Stocké sur la company → permettra de construire un email NOMINATIF pour le
    # contact prioritaire (CEO/RH) au lieu d'un générique rh@.
    if company is not None and all_seen_emails:
        try:
            pat = detect_domain_pattern(list(all_seen_emails))
            if pat:
                company.email_pattern = pat
        except Exception:
            pass

    if best_email:
        return best_email, "", "web_crawl"

    # ── Étape 3 : fallback LLM (si configuré et budget disponible) ────────────
    # Quand regex + désobfuscation échouent, le LLM peut extraire des contacts
    # depuis des layouts non standards. On lui passe le texte agrégé des pages
    # déjà visitées (donc pas de coût réseau supplémentaire — juste un appel LLM).
    if llm_client is not None and llm_client.available() and page_cache is not None:
        from .llm_extract import extract_contact_from_page
        # Aggréger les textes des pages les plus pertinentes (contact, equipe, about)
        relevant_texts: list[str] = []
        for url, txt in list(page_cache._data.items())[:5]:
            if any(kw in url.lower() for kw in ("contact", "equipe", "team", "about", "rh", "people")):
                relevant_texts.append(txt[:2000])
        if not relevant_texts:
            # Fallback : on prend juste la homepage
            relevant_texts = [list(page_cache._data.values())[0][:2000]] if page_cache._data else []
        if relevant_texts:
            combined = "\n\n---\n\n".join(relevant_texts)
            llm_result = extract_contact_from_page(llm_client, combined, site_domain, page_url=base)
            if llm_result and llm_result.get("email"):
                contact_name = llm_result.get("name", "") or ""
                # On marque la source spécifiquement "llm_crawl" pour traçabilité
                return llm_result["email"], contact_name, "llm_crawl"

    return "", "", ""


# Cache mémoire des résolutions DNS pour ne pas re-tester le même host à chaque
# fois (et accélérer le skip des domaines morts entre fast_crawl et headless).
_DNS_CACHE: dict[str, bool] = {}

# Plafond de temps de crawl PAR ENTREPRISE (secondes), configurable depuis l'UI
# (réglage « budget crawl »). Borne fast_crawl_email ET crawl_contact_page. Le
# pipeline l'écrase avec la valeur de RunConfig au démarrage du run.
CRAWL_BUDGET_SEC: float = 25.0


_TCP_CACHE: dict[str, bool] = {}   # cache TCP pour éviter re-tests dans le même run
# P0-3 : verrou commun aux caches DNS / TCP. Indispensable depuis que la Phase 4
# fast-crawl tourne en parallèle (sinon écritures concurrentes corrompent le dict).
_NET_CACHE_LOCK = threading.Lock()

def _tcp_reachable(host: str, timeout: float = 2.0) -> bool:
    """
    Vérifie en 2 s max qu'un serveur accepte une connexion TCP sur 443 (ou 80 en
    fallback). Beaucoup plus rapide que d'attendre un ReadTimeout HTTP de 6 s × N paths.
    Résultat mis en cache pour la durée du run.
    """
    if not host:
        return False
    with _NET_CACHE_LOCK:
        if host in _TCP_CACHE:
            return _TCP_CACHE[host]
    ok = False
    for port in (443, 80):
        try:
            with socket.create_connection((host, port), timeout=timeout):
                ok = True
                break
        except Exception:
            continue
    with _NET_CACHE_LOCK:
        _TCP_CACHE[host] = ok
    return ok


def _host_resolves(website: str) -> bool:
    """
    True si le hostname du site résout en DNS. Évite de brûler 22 paths × retries
    (+ fallback headless avec curl ×3) sur un domaine inexistant (NXDOMAIN).
    socket.getaddrinfo échoue en ~ms sur un domaine mort, vs plusieurs secondes
    par tentative HTTP. Résultat mis en cache pour le réutiliser côté headless.
    """
    if not website:
        return False
    host = _domain(website)
    if not host:
        return False
    with _NET_CACHE_LOCK:
        if host in _DNS_CACHE:
            return _DNS_CACHE[host]
    try:
        socket.getaddrinfo(host, None)
        result = True
    except Exception:
        result = False
    with _NET_CACHE_LOCK:
        _DNS_CACHE[host] = result
    return result


def _get_ssl_lenient(sess, url: str, timeout: int, **kw):
    """
    GET tolérant aux certificats mal configurés. Beaucoup de sites FR ont une
    CHAÎNE de certificat incomplète (intermédiaire manquant) → `CERTIFICATE_VERIFY_FAILED:
    unable to get local issuer certificate`. Comme on ne fait que LIRE des pages
    publiques (aucun secret transmis), on retente alors SANS vérification TLS
    plutôt que de perdre une entreprise légitime (ex. segulatechnologies.com).

    ``sess`` peut être une requests.Session OU le module requests lui-même.
    Les kwargs (headers…) sont transmis tels quels.
    """
    try:
        return sess.get(url, timeout=timeout, allow_redirects=True, **kw)
    except requests.exceptions.SSLError:
        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        except Exception:
            pass
        return sess.get(url, timeout=timeout, allow_redirects=True, verify=False, **kw)


def fast_crawl_email(website: str, timeout: int = 8,
                     rate_limiter: "RateLimiter | None" = None,
                     page_cache: "LRUPageCache | None" = None,
                     session: "requests.Session | None" = None,
                     url_ledger: "CrawlLedger | None" = None) -> str:
    """
    Crawl ultra-rapide avec requests + BeautifulSoup (pas de navigateur headless).
    ~0.5 s par site vs ~3 s avec StealthyFetcher. Ne fonctionne pas sur les SPA/JS heavy.
    Retourne le premier email RH trouvé sur le domaine, ou '' si bs4 absent/aucun email.

    Fix-1  : accepte un ``rate_limiter`` pour respecter le budget global de requêtes.
    Fix-4  : retry exponentiel via _retry() sur chaque path.
    Fix-4b : stocke les pages dans ``page_cache`` → réutilisées en Phase 6 sans headless.
    Fix-5  : ``session`` optionnelle partagée entre entreprises (keep-alive TCP réutilisé).
             Si absent, une session locale jetable est créée (comportement précédent).
    """
    if not BS4_AVAILABLE or not website:
        return ""
    # Domaine inexistant (NXDOMAIN) → on ne tente même pas les 22 paths.
    if not _host_resolves(website):
        return ""
    base = website.rstrip('/') if website.startswith('http') else f"https://{website}"
    site_domain = _domain(base)
    # Pré-check TCP (2 s) : si le serveur n'accepte même pas la connexion sur le
    # port 443 (ou 80 en fallback), on saute TOUS les chemins immédiatement.
    # Évite 6 s × N paths d'attente sur les sites ReadTimeout / silencieux.
    if not _tcp_reachable(site_domain):
        return ""
    try:
        # Fix-5 : réutilise la session partagée si fournie, sinon crée une locale
        _sess = session if session is not None else requests.Session()
        if session is None:
            _sess.headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
                "Accept-Language": "fr-FR,fr;q=0.9",
            })
        best_email = ""
        best_score = -1
        homepage_html = ""

        # Étape 1 : paths statiques étendus
        # /mentions-legales en tête des pages légales : email + nom du directeur
        # de publication obligatoires en France → source gratuite très fiable.
        _fast_paths = [
            "", "/contact", "/nous-contacter", "/contact-us",
            "/recrutement", "/carrieres", "/careers", "/jobs",
            "/equipe", "/team", "/about", "/about-us", "/a-propos",
            "/rh", "/hr", "/people", "/talent",
            "/mentions-legales", "/mentions-legales.html", "/legal",
            "/politique-de-confidentialite", "/cgv",
        ]
        # Mode EXPLORE (url_ledger fourni) : on élargit au pool COMPLET de chemins
        # (CONTACT_PATHS ~60 entrées : toutes les variantes RH/équipe/contact/légales
        # + locales /fr/…). Combiné au skip des URLs déjà vues, ça donne de VRAIES
        # nouvelles pages à tenter d'un run à l'autre. Borné par le budget temps.
        if url_ledger is not None:
            _seen = set(_fast_paths)
            _fast_paths = _fast_paths + [p for p in CONTACT_PATHS if p not in _seen]
        consecutive_fail = 0
        _deadline_s = time.monotonic() + CRAWL_BUDGET_SEC   # plafond configurable / entreprise
        for path in _fast_paths:
            # Site joignable mais lent (ex. Segula via verify=False) : on ne brûle
            # pas 22 × timeout. Au-delà de 20 s, on s'arrête avec ce qu'on a.
            if time.monotonic() > _deadline_s:
                break
            url = f"{base}{path}"
            # Mode « explorer de nouvelles pages » : on saute les URLs déjà visitées
            # lors d'un run précédent → on tente d'autres pages pour + d'adresses.
            if url_ledger is not None and url_ledger.seen_url(url):
                continue
            if rate_limiter:
                rate_limiter.wait()
            try:
                # retries=1 : un seul essai par path. Un site lent fait perdre
                # timeout × 22 paths ; pas la peine d'y ajouter 3× de backoff.
                r = _retry(lambda p=path: _get_ssl_lenient(_sess, f"{base}{p}", timeout),
                           retries=1)
            except Exception:
                # _retry() avale déjà les exceptions et renvoie None ; ce except
                # n'attrape donc que l'imprévu. Par sécurité on coupe court.
                break
            # _retry renvoie None quand TOUS les essais ont échoué (timeout, SSL,
            # connexion refusée…). Si même la HOMEPAGE ("") échoue ainsi, le
            # domaine est injoignable → inutile de tenter les 21 autres paths.
            # C'est LE fix de lenteur : avant, on enchaînait les 22 paths sur un
            # site mort car _retry n'a jamais re-levé l'exception.
            if r is None:
                if path == "":
                    break
                # Bail-out après 2 échecs consécutifs : couvre les domaines à
                # REDIRECTION CASSÉE (ex. /contact → www.x.frcontact, slash perdu
                # par le serveur → NXDOMAIN en boucle). La homepage a déjà répondu
                # ici (sinon on aurait cassé à path==""), donc 2 sous-pages mortes
                # d'affilée = serveur qui mangle ses redirections → on arrête.
                consecutive_fail += 1
                if consecutive_fail >= 2:
                    break
                continue
            consecutive_fail = 0
            if r.status_code != 200:
                continue
            if url_ledger is not None:
                url_ledger.mark_url(url)   # page visitée → évitée aux runs suivants
            html = r.text
            if path == "" and not homepage_html:
                homepage_html = html
            soup = _BS4(html, "html.parser")
            page_text = soup.get_text(separator=" ", strip=True)
            if page_cache is not None and url not in page_cache:
                page_cache[url] = page_text
            # Collecter tous les emails (mailto + regex + désobfuscation) et garder le meilleur
            for email in _collect_all_emails(page_text, html, site_domain):
                score = _rank_email(email, site_domain)
                if score > best_score:
                    best_score = score
                    best_email = email
                    if score >= 4:
                        return best_email

        # Étape 2 : découverte dynamique si pas encore trouvé un bon email
        if best_score < 3 and homepage_html:
            discovered = _discover_contact_links(base, homepage_html, max_links=8)
            for url in discovered:
                if rate_limiter:
                    rate_limiter.wait()
                try:
                    r2 = _get_ssl_lenient(_sess, url, timeout)
                    if r2.status_code != 200:
                        continue
                    soup2 = _BS4(r2.text, "html.parser")
                    pt2 = soup2.get_text(separator=" ", strip=True)
                    for email in _collect_all_emails(pt2, r2.text, site_domain):
                        score = _rank_email(email, site_domain)
                        if score > best_score:
                            best_score = score
                            best_email = email
                            if score >= 4:
                                return best_email
                except Exception:
                    continue

        if best_email:
            return best_email
    except Exception as exc:
        log.debug("fast_crawl_email(%s) a échoué : %r", website, exc)
    return ""


# Point #5 (audit) : _RECRUITER_NAME_RE, _HR_TITLES, _HR_TITLE_ROLE importés de
# .constants (source unique) — copies locales identiques supprimées.


def _build_priority_titles(target_job: str = "") -> list[tuple[list[str], dict]]:
    """
    Construit la liste ordonnée des groupes de titres à chercher, par priorité décroissante :
      1. Dirigeants (CEO, fondateur, PDG, DG…)  ← décideur direct
      2. RH (DRH, Talent, recruteur…)            ← contact recrutement
      3. Manager du domaine du poste ciblé       ← hiring manager probable
         (ex: poste "data analyst" → "Head of Data", "CTO"…)

    Chaque entrée = (liste_de_titres, mapping_titre→rôle_lisible).
    """
    groups: list[tuple[list[str], dict]] = [
        (CEO_TITLES, CEO_TITLE_ROLE),     # priorité 1 : dirigeant
        (HR_TITLES, HR_TITLE_ROLE),       # priorité 2 : RH
    ]
    # Priorité 3 : managers liés au poste ciblé (matching par mot-clé)
    if target_job:
        tj = target_job.lower()
        manager_titles: list[str] = []
        for keyword, titles in TARGET_JOB_MANAGER_TITLES.items():
            if keyword in tj:
                manager_titles.extend(titles)
        if manager_titles:
            # rôle lisible = le titre lui-même en Title Case
            role_map = {t: t.title() for t in manager_titles}
            groups.append((manager_titles, role_map))
    return groups


# Phase 4c : mots qui ne sont JAMAIS un prénom/nom (intitulés de section, rôles,
# rubriques de menu). Le regex de nom capture « deux mots capitalisés » près d'un titre ;
# sur une page maigre ça attrape « Recrutement Travailler », « Fondateurs Directeur »…
# Normalisés sans accent, en minuscules.
_NAME_STOPWORDS = frozenset({
    "recrutement", "recrutements", "recruteur", "recruteuse", "recrute", "recrutez",
    "travailler", "travaillez", "rejoindre", "rejoignez", "postuler", "postulez",
    "candidature", "candidatures", "carriere", "carrieres", "emploi", "emplois", "job", "jobs",
    "fondateur", "fondateurs", "fondatrice", "cofondateur", "cofondateurs", "founder", "founders",
    "directeur", "directrice", "directeurs", "direction", "president", "presidente", "pdg",
    "gerant", "gerante", "responsable", "manager", "management", "leadership",
    "ressources", "humaines", "talent", "talents", "people", "equipe", "equipes",
    "contact", "contacts", "accueil", "propos", "apropos", "mentions", "legales",
    "services", "service", "societe", "entreprise", "entreprises", "groupe", "group",
    "notre", "nos", "nous", "qui", "sommes", "histoire", "actualites", "actualite",
    "news", "blog", "presse", "partenaires", "clients",
    # BUG (leads réels vus en prod) : mots de navigation/CTA capturés à côté d'un
    # mot-clé de titre et pris pour un prénom+nom → email nominatif fantaisiste
    # (ex. « Youtube Votre » → youtube.votre@…, « Talial Découvrir » → …decouvrir@…,
    # « Autres Écroutage » → autres.ecroutage@…).
    "votre", "vos", "voir", "decouvrir", "decouvrez", "autres", "autre", "plus",
    "menu", "toutes", "toute", "tous", "tout", "ici", "suivre", "abonnez",
})


def _strip_accents(s: str) -> str:
    """Minuscule sans accents — pour comparer noms et mots-clés de façon robuste."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )


def _looks_like_person_name(name: str, company: "Company") -> bool:
    """
    Garde-fou Phase 4c : vrai SEULEMENT si `name` ressemble à un vrai prénom + nom,
    et pas à un intitulé de section (« Recrutement Travailler ») ni au nom de
    l'entreprise (« Ambulances Jassans »). Filtre les faux positifs AVANT de
    construire un email nominatif (sinon adresses bidon → rebonds garantis).
    """
    toks = [_strip_accents(t) for t in name.split() if t]
    if len(toks) < 2:
        return False
    # (a) un mot générique / rôle / rubrique → ce n'est pas un nom de personne.
    if any(t in _NAME_STOPWORDS for t in toks):
        return False
    # (b) TOUS les mots significatifs = nom de l'entreprise / label du domaine → rejet.
    #     (on garde « Jean Jassans » si « jean » n'est pas une marque ; on rejette
    #      « Ambulances Jassans » dont les deux mots viennent du nom/domaine.)
    brand = {_strip_accents(t) for t in (company.name or "").split() if len(t) > 2}
    label = _domain(company.website or "").split(".")[0]
    if label:
        brand.add(_strip_accents(label))
    sig = [t for t in toks if len(t) > 2]
    if sig and all(t in brand for t in sig):
        return False
    return True


def find_recruiter_name(
    company: Company,
    fetcher: StealthyFetcher,
    cache: "PersistentCache | None" = None,
    llm_client = None,                       # LLMClient optionnel — fallback intelligent
    target_job: str = "",                    # poste ciblé → manager du domaine en 3e priorité
) -> tuple[str, str]:
    """
    Phase 4c : scrape /equipe, /team, /about pour trouver le contact prioritaire.

    Priorité : CEO/Fondateur > RH (DRH/Talent) > manager du domaine du poste ciblé.
    Un email nominatif (Prénom.Nom@) a un taux d'ouverture ~30% supérieur à rh@.

    Retourne (nom, rôle) ou ('', ''). Résultats mis en cache 7 jours.
    """
    if not company.website:
        return "", ""
    # La clé de cache inclut le poste ciblé (le contact prioritaire en dépend)
    cache_key = f"recruiter:{_domain(company.website)}:{(target_job or '').lower()[:20]}"
    if cache:
        cached = cache.get_json(cache_key)
        if cached is not None:
            return cached.get("name", ""), cached.get("role", "")

    base = company.website.rstrip('/')
    if not base.startswith('http'):
        return "", ""

    paths = ["/equipe", "/team", "/about", "/a-propos",
             "/qui-sommes-nous", "/l-equipe", "/notre-equipe", "/rh",
             "/direction", "/management", "/leadership", "/notre-histoire"]

    priority_groups = _build_priority_titles(target_job)

    def _parse_text(text: str) -> tuple[str, str]:
        """
        Cherche un nom+rôle dans le texte, ordre de priorité :
        dirigeant > RH > manager du domaine.

        Stratégie en 2 passes :
          1. Regex RECRUITER_NAME_RE (rapide, ±120 chars autour du mot-clé)
          2. NER spaCy (si regex échoue et spaCy disponible) — comprend des
             structures sans mot-clé immédiat ou avec mise en forme atypique
             (ex : « Marie DUPONT — DRH · acme.fr »).
        """
        text_lower = text.lower()

        # ── Passe 1 : regex ────────────────────────────────────────────────────
        for titles, role_map in priority_groups:
            for title_kw in titles:
                idx = text_lower.find(title_kw)
                if idx < 0:
                    continue
                snippet = text[max(0, idx - 120): idx + 120]
                m = _RECRUITER_NAME_RE.search(snippet)
                if not m:
                    continue
                found_name = f"{m.group(1)} {m.group(2)}".strip()
                if not _looks_like_person_name(found_name, company):
                    continue   # faux positif (intitulé / nom de boîte) → on cherche ailleurs
                found_role = role_map.get(title_kw, "")
                if not found_role:
                    for kw, r in role_map.items():
                        if kw in title_kw:
                            found_role = r
                            break
                found_role = found_role or "Contact"
                return found_name, found_role

        # ── Passe 2 : NER spaCy (fallback si regex n'a rien trouvé) ───────────
        # Couvre les pages structurées différemment : LinkedIn-style, cartes
        # d'équipe sans balise, texte tabulaire, etc.
        try:
            from .ner import extract_contact_ner
            ner_name, ner_role = extract_contact_ner(text, prefer_hr=True)
            if ner_name:
                return ner_name, ner_role or "Contact"
        except Exception:
            pass  # spaCy absent ou erreur → on laisse le LLM prendre le relais

        return "", ""

    consecutive_fail = 0
    _t0 = time.monotonic()
    for path in paths:
        # Même plafond temps/entreprise + bail-out 2 échecs que le reste de la Phase 4.
        if time.monotonic() - _t0 > CRAWL_BUDGET_SEC or consecutive_fail >= 2:
            break
        url = base + path
        text = ""
        if BS4_AVAILABLE:
            # requests d'abord (10× + rapide). Repli SSL verify=False inclus.
            try:
                resp = _get_ssl_lenient(requests, url, 6, headers={"User-Agent": "Mozilla/5.0"})
                consecutive_fail = 0
                if resp.status_code == 200:
                    text = _BS4(resp.text, "html.parser").get_text(separator=" ", strip=True)
                else:
                    # Non-200 (anti-bot 403, 5xx…) : le headless serait bloqué pareil
                    # et coûte 3 retries curl → on NE l'escalade PAS (fin de la tempête).
                    continue
            except Exception as exc:
                log.debug("find_recruiter_name requests(%s) échec : %r", url, exc)
                consecutive_fail += 1
                continue
        else:
            # bs4 absent (rare) → seul cas où on tente le headless Fetcher.
            try:
                page = Fetcher.get(url)
                if page is None:
                    consecutive_fail += 1
                    continue
                consecutive_fail = 0
                text = page.get_text() if hasattr(page, "get_text") else ""
            except Exception:
                consecutive_fail += 1
                continue

        if text:
            found_name, found_role = _parse_text(text)
            if found_name:
                result = {"name": found_name, "role": found_role}
                if cache:
                    cache.set_json(cache_key, result, ttl=60 * 60 * 24 * 7)
                return found_name, found_role

    # Fallback LLM : regex a échoué, demander au LLM avec les textes déjà visités.
    if llm_client is not None and llm_client.available():
        from .llm_extract import extract_recruiter_from_page
        # On retente sur la homepage uniquement (le moins coûteux).
        # B1-1 : utiliser _get_ssl_lenient au lieu de requests.get brut — récupère les
        # sites avec chaîne de certificat incomplète (ex : segulatechnologies.com) qui
        # causaient un SSLError silencieux → occasion LLM perdue.
        try:
            r = _get_ssl_lenient(requests, base, 8, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code == 200 and BS4_AVAILABLE:
                page_text = _BS4(r.text, "html.parser").get_text(separator=" ", strip=True)
                result = extract_recruiter_from_page(llm_client, page_text, page_url=base)
                if result and result.get("name"):
                    name = result["name"]
                    role = result.get("role") or ""   # vide si le LLM n'a pas trouvé de rôle (honnête)
                    if cache:
                        cache.set_json(cache_key, {"name": name, "role": role}, ttl=60 * 60 * 24 * 7)
                    return name, role
        except Exception:
            pass

    if cache:
        cache.set_json(cache_key, {"name": "", "role": ""}, ttl=60 * 60 * 24 * 3)
    return "", ""


def enrich_web_crawl(
    companies: list[Company],
    fetcher: "_ThreadSafeFetcher | StealthyFetcher",
    delay: float,
    fast_crawl: bool = True,
    find_recruiter: bool = True,
    cache: "PersistentCache | None" = None,
    page_cache: "LRUPageCache | None" = None,  # Fix-B : cache partagé avec detect_tech_stack
    rate_limiter: "RateLimiter | None" = None,  # Fix-1 : transmis à fast_crawl_email
    llm_client = None,                           # LLMClient optionnel — fallback intelligent
    deadline = None,                             # Deadline optionnel — arrêt propre si temps écoulé
    target_job: str = "",                        # poste ciblé — priorise le contact pertinent
    ledger: "CrawlLedger | None" = None,         # registre persistant — évite de recrawler entre runs
    explore_new_pages: bool = False,             # re-crawle les domaines sans email sur des pages NEUVES
    proxy_pool = None,                           # ProxyPool | None — passé au client httpx async
) -> None:
    """
    Phase 4 : crawl des pages Contact/Équipe.
    - fast_crawl=True : essaie d'abord requests+BS4 (rapide, sans JS), puis
      headless en fallback uniquement si nécessaire.
    - find_recruiter=True : Phase 4c — cherche le nom/rôle du recruteur RH.
    - ledger : si un domaine a déjà été crawlé lors d'un run précédent (< TTL),
      on réutilise son résultat au lieu de tout refaire (gain majeur de temps).
    - explore_new_pages : si True, un domaine déjà vu SANS email n'est PAS sauté ;
      on le re-crawle en ÉVITANT les pages déjà visitées (registre d'URLs) → chance
      de trouver une adresse sur une page non encore explorée. Les domaines qui
      ont DÉJÀ un email restent sautés (on a ce qu'il faut).
    """
    need_crawl = [c for c in companies if not c.contact_email and c.website]
    if not need_crawl:
        return
    # Message : indique le moteur actif (async httpx ou threads requests)
    try:
        from .enrich_async import HTTPX_AVAILABLE as _HX
        _fast_engine = "async httpx" if (_HX and fast_crawl and BS4_AVAILABLE) else "threads"
    except Exception:
        _fast_engine = "threads"
    fast_msg = f" (fast-crawl {_fast_engine})" if fast_crawl and BS4_AVAILABLE else ""
    print(f"\n🌐  Phase 4 : crawler pages Contact{fast_msg} ({len(need_crawl)} entreprises)…")
    found = 0
    found_fast = 0
    ats_found = 0
    recruiter_found = 0
    nominative_built = 0
    reused = 0      # domaines réutilisés depuis le registre (runs précédents)
    re_explored = 0 # domaines sans email re-crawlés en mode « explorer pages neuves »

    # ── P0-1 : Phase 4 parallélisée ──────────────────────────────────────────
    # Avant : boucle séquentielle (fast → headless → recruteur), 60 entreprises ×
    # 5 s ≈ 5 min minimum. Après : fast-crawl en parallèle (4-6 workers,
    # I/O-bound = ThreadPoolExecutor idéal), puis headless + recruteur en
    # séquentiel sur le reste. Le headless reste séquentiel car il consomme
    # Patchright/Chromium (1 process) et touche `company.ats_name` partagé.
    #
    # Sessions : `requests.Session` n'est PAS thread-safe — on en fournit UNE
    # par worker via `threading.local()` (keep-alive préservé par thread).

    # ── Étape 0 : pré-pass ledger (séquentielle, très rapide) ──────────────────
    # Sépare entre « réutilisable » (cache run précédent) et « à crawler ce run ».
    to_crawl: list[Company] = []
    for c in need_crawl:
        if ledger is not None:
            prev = ledger.lookup_domain(c.website)
            if prev is not None:
                if prev["email"]:
                    reused += 1
                    c.contact_email = prev["email"]
                    c.email_source  = prev["email_source"] or "web_crawl"
                    found += 1
                    print(f"   ♻   {c.name} → {prev['email']} (réutilisé)")
                    continue
                elif not explore_new_pages:
                    reused += 1
                    continue
                else:
                    re_explored += 1
                    print(f"   🔄  {c.name} → re-crawl (pages neuves)")
        to_crawl.append(c)

    # ── Étape 1 : fast-crawl ASYNC (httpx.AsyncClient + asyncio.Semaphore) ──────
    # A1 : remplace ThreadPoolExecutor(6) par asyncio.Semaphore(20).
    # - 1 session httpx partagée → HTTP/2 + keep-alive entre toutes les entreprises
    # - 20 requêtes simultanées sans overhead de thread (1 coroutine ≈ 1 KB)
    # - TCP pré-check async (asyncio.open_connection) — pas de thread bloqué
    # Dégradation propre : si httpx absent → bascule sur le mode threads.
    fast_emails: dict[int, str] = {}
    _used_async = False

    if fast_crawl and BS4_AVAILABLE and to_crawl:
        # ── Essai async (A1) ──────────────────────────────────────────────────
        try:
            from .enrich_async import async_fast_pass, HTTPX_AVAILABLE
            if HTTPX_AVAILABLE:
                fast_emails = async_fast_pass(
                    companies=to_crawl,
                    page_cache=page_cache,
                    explore_new_pages=explore_new_pages,
                    ledger=ledger,
                    deadline=deadline,
                    max_concurrent=20,
                    proxy_pool=proxy_pool,
                )
                _used_async = True
        except Exception as _async_err:
            log.debug("fast_crawl async échoué (%r) → fallback threads", _async_err)

        # ── Fallback threads si httpx absent ou erreur async ─────────────────
        if not _used_async:
            _local = threading.local()

            def _get_session() -> requests.Session:
                sess = getattr(_local, "sess", None)
                if sess is None:
                    sess = requests.Session()
                    sess.headers.update({
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
                        "Accept-Language": "fr-FR,fr;q=0.9",
                    })
                    _local.sess = sess
                return sess

            def _do_fast(c: Company) -> tuple[int, str]:
                if deadline is not None and deadline.expired():
                    return id(c), ""
                _url_ledger = ledger if (explore_new_pages and ledger is not None) else None
                try:
                    e = fast_crawl_email(
                        c.website, timeout=6,
                        rate_limiter=rate_limiter,
                        page_cache=page_cache,
                        session=_get_session(),
                        url_ledger=_url_ledger,
                    )
                except Exception as exc:
                    log.debug("fast_crawl_email thread(%s) : %r", c.website, exc)
                    e = ""
                return id(c), e

            _workers = max(2, min(6, len(to_crawl)))
            with concurrent.futures.ThreadPoolExecutor(max_workers=_workers) as ex:
                for cid, email in ex.map(_do_fast, to_crawl):
                    if email:
                        fast_emails[cid] = email

        found_fast = len(fast_emails)

    # ── Étape 2 : passe séquentielle (headless + recruteur + ledger record) ────
    # B1-4 : `interrupted = False / interrupted = True` supprimé — variable jamais lue.
    for idx, c in enumerate(to_crawl):
        if deadline is not None and deadline.expired():
            print(f"   ⏱   Limite de temps atteinte — crawl arrêté à {idx}/{len(to_crawl)}.")
            break

        # Pression temporelle : si le temps restant divisé par les entreprises
        # restantes < 20 s, on coupe le headless (lent) et on garde la fast pass.
        time_pressure = False
        if deadline is not None:
            remaining_cos = len(to_crawl) - idx
            if remaining_cos > 0 and deadline.remaining() / remaining_cos < 20:
                time_pressure = True

        _url_ledger = ledger if (explore_new_pages and ledger is not None) else None
        _crawl_t0 = time.monotonic()

        # Résultat fast-crawl (déjà calculé en parallèle).
        email = fast_emails.get(id(c), "")
        name, src = "", ""
        if email:
            src = "web_crawl"

        # ── Fallback headless (séquentiel, partage Patchright) ────────────────
        if not email and not time_pressure and _host_resolves(c.website):
            _headless_budget = max(5.0, CRAWL_BUDGET_SEC)
            email, name, src = crawl_contact_page(c.website, fetcher, company=c,
                                                   page_cache=page_cache,
                                                   llm_client=llm_client,
                                                   url_ledger=_url_ledger,
                                                   budget_override=_headless_budget)

        _crawl_dt = time.monotonic() - _crawl_t0
        _crawl_lbl = f"  ({_crawl_dt:.1f} s)"

        if email:
            c.contact_email = email
            c.email_source  = src
            if name:
                c.contact_name = name
            found += 1
            print(f"   ✅  {c.name} → {email}{_crawl_lbl}")
        else:
            if _crawl_dt >= 1.0:
                print(f"   ✗   {c.name} — aucun email{_crawl_lbl}")
        if c.ats_name:
            ats_found += 1

        # Mémorisation registre inter-runs (avant Phase 4c pour ne pas la bloquer).
        if ledger is not None and c.website:
            ledger.record_domain(c.website, c.contact_email or "", c.email_source or "")

        time.sleep(delay * 0.5)

    if reused:
        print(f"   ♻   {reused} domaine(s) réutilisé(s) d'un run précédent (non recrawlés)")
    if re_explored:
        print(f"   🔄  {re_explored} domaine(s) sans email re-crawlé(s) sur pages neuves (explore)")

    # ── Phase 4c : recherche recruteur prioritaire — EN PARALLÈLE ─────────────
    # B0-5 : find_recruiter_name utilise requests (I/O-bound). Avant : séquentiel
    # dans la boucle principale → 1-2 s × N entreprises s'empilaient. Après :
    # batch parallèle sur les candidats (ceux sans contact_name ET site joignable),
    # 6 workers → gain ~6× sur cette sous-phase. Le fetcher headless n'est appelé
    # que si bs4 est absent (cas rare) → lock _ThreadSafeFetcher non contendé.
    if find_recruiter:
        need_recruiter = [
            c for c in to_crawl
            if c.website and not c.contact_name and _host_resolves(c.website)
        ]
        if need_recruiter:
            print(f"   🔍  Phase 4c : recruteurs ({len(need_recruiter)} entreprises, parallèle)…")

            def _do_recruiter(c: Company) -> tuple[int, str, str]:
                rname, rrole = find_recruiter_name(c, fetcher, cache=cache,
                                                   llm_client=llm_client,
                                                   target_job=target_job)
                return id(c), rname, rrole

            # B1-28 : dict {id(c) → c} pour lookup O(1) au lieu de O(n) par résultat.
            _id_to_company = {id(c): c for c in need_recruiter}
            _rec_workers = min(6, len(need_recruiter))
            _rec_total = len(need_recruiter)
            _rec_done = 0
            with concurrent.futures.ThreadPoolExecutor(max_workers=_rec_workers) as ex:
                # as_completed (pas ex.map) : le compteur avance dès qu'UNE entreprise
                # finit, sans attendre que tout le lot soumis dans l'ordre soit traité.
                futures = [ex.submit(_do_recruiter, c) for c in need_recruiter]
                for future in concurrent.futures.as_completed(futures):
                    cid, rname, rrole = future.result()
                    _rec_done += 1
                    if rname:
                        _c = _id_to_company.get(cid)
                        if _c is not None:
                            _c.contact_name = rname
                            _c.contact_role = rrole
                            recruiter_found += 1
                    if _rec_done % 10 == 0 or _rec_done == _rec_total:
                        print(f"      … {_rec_done}/{_rec_total} traités")

    # ── Phase 4d : emails NOMINATIFS ──────────────────────────────────────────
    # B1-8 : si email_pattern est vide mais qu'on a un nom de contact, on essaie
    # le format {first}.{last} (le plus courant en France, ~60%). C'est une hypothèse
    # risquée (bounce possible) donc on marque `pattern_nominative` et non `web_crawl`.
    # Les emails nominatifs ont un taux d'ouverture ~30% supérieur à rh@.
    _FALLBACK_PATTERN = KNOWN_PATTERNS[0]   # "{first}.{last}" (B2-2 : import promu module-level)
    for c in to_crawl:
        if (c.contact_name and c.email_source in ("", "pattern", "no_email")):
            # Garde-fou : ne construit un nominatif que si le nom est plausible. Un nom
            # bidon (faux positif 4c, ou cache antérieur au correctif) produirait une
            # adresse fantaisiste → rebond. Cf. _looks_like_person_name.
            if not _looks_like_person_name(c.contact_name, c):
                continue
            first, last = split_name(c.contact_name)
            if first and last:
                # Utilise le pattern détecté ou le fallback standard si aucun
                pat = c.email_pattern if c.email_pattern else _FALLBACK_PATTERN
                nominative = build_email(pat, first, last, _domain(c.website))
                if nominative:
                    c.contact_email = nominative
                    c.email_source  = "pattern_nominative"
                    nominative_built += 1

    parts = [f"{found}/{len(need_crawl)} emails trouvés via crawl web"]
    if fast_crawl and BS4_AVAILABLE:
        parts.append(f"{found_fast} via fast-crawl")
    if nominative_built:
        parts.append(f"{nominative_built} emails nominatifs (pattern)")
    if ats_found:
        parts.append(f"{ats_found} ATS détectés")
    if recruiter_found:
        parts.append(f"{recruiter_found} noms recruteurs")
    print(f"   → {' · '.join(parts)}")


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 5 — HUNTER.IO / SNOV / APOLLO (B2-1 split → enrich_apis.py)
# ══════════════════════════════════════════════════════════════════════════════
# HR_PATTERNS, generate_alternatives, guess_email → email_pattern.py
# EmailResult, HunterClient, SnovClient, ApolloClient,
# apply_email_format, linkedin_find_hr, github_find_email,
# enrich_hunter, enrich_multi_api → enrich_apis.py (importé en tête de fichier)
# Compatibilité descendante : tous ces noms restent accessibles via `from .enrich import …`

# FIX-9 (note historique) : EmailResult, HunterClient, SnovClient, ApolloClient
# → déplacés dans enrich_apis.py (B2-1 split). Re-exportés en haut de ce fichier.


# ── SMTP RCPT TO

# ── SMTP RCPT TO + LinkedIn snippets ──────────────────────────────────────────

def smtp_verify_email(email: str, timeout: int = 8) -> bool:
    """
    Vérifie l'existence d'un email via SMTP RCPT TO (sans envoyer de message).

    Connexion MX → EHLO → MAIL FROM (fake) → RCPT TO → déconnexion.
    Code 250 = adresse acceptée.  Code 5xx = refusée.
    Retourne False en cas d'erreur réseau ou de serveur qui ne supporte pas la vérif.

    ⚠  Certains serveurs (anti-spam) retournent 250 pour tout (catch-all).
       Utilisez ce résultat comme confirmation forte mais pas absolue.

    B1-9 : timeout TOTAL de l'échange via Future (même logique que is_catch_all).
    `timeout` s'applique au socket ; le plafond total = timeout × 3 (4 commandes,
    marge). Évite qu'un MX lent mais connecté bloque le run.
    """
    if not DNS_AVAILABLE or not email or "@" not in email:
        return False
    if not smtp_port_open():
        return False
    domain = email.split("@")[-1]
    # Strat #3 — DMARC reject : le serveur MX rejettera le RCPT TO de toute façon.
    # On court-circuite la sonde pour éviter de brûler une tentative inutile et de
    # ralentir le run.
    try:
        from .deliverability import smtp_probe_useful
        if not smtp_probe_useful(domain):
            return False
    except Exception:
        pass

    def _do_verify() -> bool:
        records = dns_resolver.resolve(domain, "MX")
        mx_host = str(min(records, key=lambda r: r.preference).exchange).rstrip(".")
        smtp = smtplib.SMTP(timeout=timeout)
        smtp.connect(mx_host, 25)
        smtp.ehlo("carreer-ops.verify.local")
        smtp.mail("noreply@carreer-ops.verify.local")
        code, _ = smtp.rcpt(email)
        try:
            smtp.quit()
        except Exception:
            pass
        return code == 250

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as _ex:
            fut = _ex.submit(_do_verify)
            try:
                return fut.result(timeout=timeout * 3)
            except concurrent.futures.TimeoutError:
                return False
    except Exception:
        return False


def smtp_batch_patterns(domain: str, timeout: int = 5, workers: int = 6) -> str:
    """
    Essaie plusieurs patterns d'alias courants (rh@, jobs@, contact@…) via SMTP RCPT TO.

    A5 : UNE seule connexion SMTP, N RCPT TO en séquence (était N connexions parallèles).
    Avantage : ~N× moins de handshakes TCP+TLS, moins de risque de rate-limit côté MX,
    moins de threads. Protocol-conformant : RFC 5321 autorise plusieurs RCPT TO successifs
    après un seul MAIL FROM.
    Repli sur le mode N-connexions parallèles si la connexion groupée échoue
    (serveur qui ferme la connexion après RCPT TO, SMTP trop strict, etc.).
    """
    if not DNS_AVAILABLE or not domain:
        return ""
    if not smtp_port_open():
        return ""

    candidates = [f"{p}@{domain}" for p in HR_PATTERNS]

    # ── Essai groupé (A5) : 1 connexion, N RCPT TO ────────────────────────────
    def _grouped() -> str:
        records  = dns_resolver.resolve(domain, "MX")
        mx_host  = str(min(records, key=lambda r: r.preference).exchange).rstrip(".")
        smtp_obj = smtplib.SMTP(timeout=timeout)
        smtp_obj.connect(mx_host, 25)
        smtp_obj.ehlo("carreer-ops.verify.local")
        smtp_obj.mail("noreply@carreer-ops.verify.local")
        found = ""
        for email in candidates:
            code, _ = smtp_obj.rcpt(email)
            if code == 250:
                found = email
                break
        try:
            smtp_obj.quit()
        except Exception:
            pass
        return found

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_grouped)
            try:
                result = fut.result(timeout=timeout * (len(candidates) + 3))
                if result:
                    return result
            except concurrent.futures.TimeoutError:
                pass
    except Exception:
        pass

    # ── Repli : N connexions parallèles (ancien comportement) ─────────────────
    # Utilisé si le serveur MX coupe la connexion ou ne supporte pas RCPT multi.
    ex2 = concurrent.futures.ThreadPoolExecutor(max_workers=workers)
    try:
        future_to_email = {ex2.submit(smtp_verify_email, e, timeout): e for e in candidates}
        for fut in concurrent.futures.as_completed(future_to_email):
            try:
                if fut.result():
                    return future_to_email[fut]
            except Exception:
                pass
    finally:
        ex2.shutdown(wait=False, cancel_futures=True)
    return ""

# ══════════════════════════════════════════════════════════════════════════════
# RÉSOLUTION DE DOMAINE
# ══════════════════════════════════════════════════════════════════════════════
# RÉSOLUTION DE DOMAINE — extraite dans domain_resolve.py (point #6 audit)
# ══════════════════════════════════════════════════════════════════════════════
# Bloc cohésif (nom d'entreprise → domaine + validation) déplacé dans son propre
# module pour dégonfler ce module-dieu. Re-export pour compat descendante :
# `from .enrich import resolve_company_domain` (et les helpers) marche toujours.
from .domain_resolve import (  # noqa: E402  (re-export volontaire — déclaré dans __all__)
    _AGGREGATOR_DOMAINS, _is_aggregator, _name_similarity, _IMPLAUSIBLE_TLD_RE,
    _tld_plausible, _domain_core, _domain_matches_name, _homepage_title_confirms,
    resolve_domain_clearbit, resolve_domain_duckduckgo, resolve_company_domain,
    _name_resolution_variants, enrich_domain_resolution,
)

# Façade de re-export (compat descendante après les splits B2-1 / domain_resolve).
# Déclare explicitement les symboles ré-exportés par enrich.py → documente la surface
# publique ET indique à pyflakes que ces imports sont intentionnels (pas du code mort).
__all__ = [
    # depuis enrich_apis (B2-1)
    "EmailResult", "HunterClient",
    "apply_email_format", "linkedin_find_hr", "github_find_email",
    "enrich_hunter",
    # depuis domain_resolve
    "_AGGREGATOR_DOMAINS", "_is_aggregator", "_name_similarity", "_IMPLAUSIBLE_TLD_RE",
    "_tld_plausible", "_domain_core", "_domain_matches_name", "_homepage_title_confirms",
    "resolve_domain_clearbit", "resolve_domain_duckduckgo", "resolve_company_domain",
    "_name_resolution_variants", "enrich_domain_resolution",
    # depuis email_pattern
    "HR_PATTERNS", "generate_alternatives", "guess_email",
]


def clearbit_company_info(domain: str) -> dict:
    """
    Récupère les métadonnées d'une entreprise via Clearbit Autocomplete (gratuit, sans clé).
    Retourne: name, domain, logo, industry (ou {} si rien trouvé).
    """
    if not domain:
        return {}
    try:
        resp = requests.get(
            "https://autocomplete.clearbit.com/v1/companies/suggest",
            params={"query": domain},
            timeout=8,
        )
        if resp.status_code != 200:
            return {}
        # B2-11 : resp.json() appelé UNE seule fois (avant : 2 fois → double décodage JSON).
        results = resp.json() or []
        for r in results:
            if r.get("domain", "").lower().rstrip("/") == domain.lower():
                return r
        return results[0] if results else {}
    except Exception:
        return {}


def enrich_clearbit(
    companies: list[Company],
    cache: "PersistentCache | None",
    delay: float,
) -> None:
    """
    Enrichit les métadonnées manquantes (activité, taille) via Clearbit Autocomplete.
    Gratuit, sans clé API — limité aux infos de base.
    """
    need = [c for c in companies if c.website and not c.activity_domain]
    if not need:
        return
    print(f"\n🔮  Clearbit : enrichissement métadonnées ({len(need)} entreprises)…")
    found = 0
    for c in need:
        domain    = _domain(c.website)
        cache_key = f"clearbit:{domain}"
        if cache:
            info = cache.get_json(cache_key)
            if info is None:
                info = clearbit_company_info(domain)
                cache.set_json(cache_key, info)
        else:
            info = clearbit_company_info(domain)
        if info:
            if not c.activity_domain:
                c.activity_domain = info.get("industry") or ""
            # Normaliser secteur si pas encore fait
            if not c.sector and c.activity_domain:
                c.sector = classify_sector(naf_code="", label=c.activity_domain)
            emp = info.get("employees") or info.get("metrics_employees")
            if emp and not c.company_size_bucket:
                c.company_size = str(emp)
                c.company_size_bucket = normalize_company_size(emp)
            found += 1
        time.sleep(delay * 0.05)
    print(f"   → {found}/{len(need)} enrichies via Clearbit")


def fuzzy_dedup(
    companies: list[Company],
    threshold: float = 0.85,
) -> tuple[list[Company], int]:
    """
    Supprime les doublons par correspondance floue sur les noms d'entreprise.
    Utilise SequenceMatcher — threshold 0.85 = 85 % de similarité → doublon.

    Ex : 'ACME SAS', 'Acme', 'ACME France' → même groupe, on garde le meilleur score.

    Optimisation O(n²) : early-exit sur ratio de longueur avant SequenceMatcher.
    Si ratio(len_a, len_b) < min_len_ratio, ratio() ne peut mathématiquement pas
    atteindre `threshold` → on saute la comparaison.
    Formule : pour ratio() >= T, il faut min(a,b)/max(a,b) >= T/(2-T).
    Exemple : threshold=0.85 → skip si la chaîne courte < 74 % de la longue.

    B0-12 : garde géographique anti-fusion d'établissements distincts.
    Même nom fuzzy-similaire MAIS dept/city différents et renseignés → PAS un doublon.
    Évite d'annuler le travail de P0-4 (merge_into_master clé nom|dept) en Phase 9b.
    Ex : « Pharmacie Centrale » à Lyon (dept=69) ≠ Lille (dept=59) → conservés séparément.
    """
    if not companies:
        return companies, 0

    # Ratio de longueur minimum pour que SequenceMatcher puisse dépasser `threshold`
    # Dérivé de : 2*M/(a+b) >= T  avec M <= min(a,b)  →  min/max >= T/(2-T)
    min_len_ratio = threshold / (2.0 - threshold)

    def _norm(name: str) -> str:
        # Retire uniquement les formes JURIDIQUES — plus les noms de villes (B0-12).
        # Avant : "paris|lyon|bordeaux" était retiré → "Pharmacie Centrale Paris" =
        # "pharmaciecentrale" = "Pharmacie Centrale Lyon" → fusion abusive.
        name = re.sub(
            r"\b(sas|sarl|sa|sasu|sci|eurl|snc|gmbh|ltd|inc|corp|"
            r"group|groupe|holding)\b",
            "", name.lower(), flags=re.IGNORECASE,
        )
        return re.sub(r"[^a-z0-9]", "", name)

    def _geo_key(c: Company) -> str:
        """Clé géographique : dept en priorité, sinon ville normalisée. '' si inconnue."""
        dept = (c.dept or "").strip()
        if dept:
            return dept
        city = (c.city or "").strip().lower()
        return re.sub(r"[^a-z0-9]", "", city)

    def _different_location(a: Company, b: Company) -> bool:
        """
        True si les deux entreprises ont une localisation renseignée ET différente.
        On ne déclare une divergence géo que si les deux ont une info non-vide :
        si l'une est sans localisation, on ne peut pas trancher → on laisse passer
        (comportement conservateur : mieux fusionner une fois de trop que perdre un lead).
        """
        ga, gb = _geo_key(a), _geo_key(b)
        return bool(ga) and bool(gb) and ga != gb

    def _has_real_email(c: Company) -> bool:
        """True si l'entreprise a un email RÉEL (pas un pattern/catch-all/linkedin deviné)."""
        return bool(c.contact_email) and c.email_source not in UNVERIFIED_EMAIL_SOURCES and c.email_source != "no_email"

    def _is_better(candidate: Company, current: Company) -> bool:
        """
        Décide si `candidate` doit remplacer `current` parmi deux doublons.
        Priorité : email réel d'abord (ne JAMAIS perdre un email trouvé),
        puis total_score en départage.
        """
        cand_email = _has_real_email(candidate)
        curr_email = _has_real_email(current)
        if cand_email != curr_email:
            return cand_email          # celui qui a un vrai email gagne
        return candidate.total_score > current.total_score

    kept: list[Company] = []
    kept_norms: list[str] = []   # norms pré-calculées pour éviter les recalculs
    removed = 0
    for c in companies:
        norm_c = _norm(c.name)
        is_dup = False
        for i, norm_e in enumerate(kept_norms):
            if not norm_c or not norm_e:
                continue
            # Early-exit O(1) : si les longueurs sont trop différentes, ratio() < threshold
            len_c, len_e = len(norm_c), len(norm_e)
            if len_c and len_e:
                short, long_ = (len_c, len_e) if len_c < len_e else (len_e, len_c)
                if short / long_ < min_len_ratio:
                    continue
            if SequenceMatcher(None, norm_c, norm_e).ratio() >= threshold:
                # B0-12 : garde géographique — deux établissements distincts (même nom,
                # villes/dept différents) ne doivent PAS être fusionnés.
                if _different_location(c, kept[i]):
                    continue
                # Garde l'entrée prioritaire : email réel > score (ne perd jamais un email)
                if _is_better(c, kept[i]):
                    kept[i] = c
                    kept_norms[i] = norm_c
                removed += 1
                is_dup = True
                break
        if not is_dup:
            kept.append(c)
            kept_norms.append(norm_c)

    if removed:
        print(f"   → {removed} doublons fuzzy supprimés (seuil {threshold:.0%})")
    return kept, removed


def enrich_linkedin_smtp(
    companies: list[Company],
    fetcher: StealthyFetcher,
    hunter: "HunterClient | None",
    delay: float,
    deadline=None,
) -> None:
    """
    Phase 5c : LinkedIn snippets + format Hunter → email exact + vérification SMTP RCPT TO.

    Pour les grandes structures où WHOIS/Snov/Apollo n'ont rien retourné :
      1. Récupère le format email du domaine via Hunter (ex : '{first}.{last}')
      2. Cherche des noms RH via DuckDuckGo → snippets LinkedIn
      3. Construit l'email candidat et le vérifie via SMTP RCPT TO

    emailSource possible :
      'linkedin_smtp'    — nom LinkedIn + format Hunter + SMTP a accepté l'adresse
      'linkedin_pattern' — nom LinkedIn + format Hunter mais SMTP non vérifié
      'pattern_verified' — pattern standard rh@domaine + SMTP a accepté l'adresse

    B0-7 : deadline optionnel — arrêt propre si la limite de temps est atteinte.
    """
    need = [c for c in companies if not c.contact_email and c.website]
    if not need:
        return
    if deadline is not None and deadline.expired():
        print(f"\n⏱   Phase 5c LinkedIn : limite temps atteinte — {len(need)} entreprises sautées.")
        return

    print(f"\n🔗  Phase 5c : LinkedIn snippets + SMTP RCPT TO ({len(need)} entreprises)…")
    found = 0

    for i, c in enumerate(need, 1):
        if deadline is not None and deadline.expired():
            print(f"   ⏱   Limite de temps — LinkedIn arrêté ({i-1}/{len(need)} traités)")
            break
        domain = _domain(c.website)
        if not domain:
            continue
        print(f"   [{i}/{len(need)}] {c.name[:35]}…", end=" ", flush=True)

        # 1. Format email du domaine via Hunter
        email_fmt = hunter.get_email_format(domain) if hunter else ""

        # 2. Noms RH depuis DuckDuckGo → LinkedIn snippets
        hr_names = linkedin_find_hr(c.name, domain, fetcher)
        time.sleep(delay * 0.3)

        email_found = False

        if email_fmt and hr_names:
            for first, last in hr_names:
                candidate = apply_email_format(email_fmt, first, last, domain)
                if not candidate:
                    continue
                if smtp_verify_email(candidate):
                    c.contact_email = candidate
                    c.contact_name  = f"{first} {last}".strip()
                    c.email_source  = "linkedin_smtp"
                    print(f"✅  {candidate} (SMTP vérifié)")
                    found += 1
                    email_found = True
                    break
            if not email_found and hr_names:
                # Construit quand même l'email, non vérifié SMTP
                first, last = hr_names[0]
                candidate = apply_email_format(email_fmt, first, last, domain)
                if candidate:
                    c.contact_email = candidate
                    c.contact_name  = f"{first} {last}".strip()
                    c.email_source  = "linkedin_pattern"
                    print(f"🟡  {candidate} (non vérifié)")
                    found += 1
                    email_found = True

        if not email_found:
            # Dernière chance : email pattern standard vérifié SMTP
            pattern = guess_email(domain)
            if smtp_verify_email(pattern):
                c.contact_email      = pattern
                c.email_source       = "pattern_verified"
                c.email_alternatives = generate_alternatives(domain, exclude=pattern)
                print(f"⚡  {pattern} (pattern + SMTP OK)")
                found += 1
            else:
                print("—")

        time.sleep(delay * 0.3)

    print(f"   → {found}/{len(need)} emails construits via LinkedIn/SMTP")


# ── WHOIS ─────────────────────────────────────────────────────────────────────

# _WHOIS_IGNORE_RE, _WHOIS_EMAIL_RE : importés depuis constants.py (B2-1).
_WHOIS_TTL = 60 * 60 * 24 * 7  # 7 jours


def whois_email(domain: str, cache: "PersistentCache | None" = None) -> str:
    """
    Interroge le WHOIS du domaine pour trouver un email de contact.
    Retourne l'email le plus pertinent ou "" si rien de valable.

    Avantages : légal, public, souvent ignoré par les outils classiques.
    PME françaises = souvent email professionnel réel dans le WHOIS.
    Limite : depuis 2018 (RGPD), les gros registraires masquent les emails.
             Fonctionne surtout pour les .fr via l'AFNIC et les petites boîtes.

    FIX-5 : ``cache`` PersistentCache optionnel (TTL 7 jours) → persiste entre sessions.
    """
    if not WHOIS_AVAILABLE or not domain:
        return ""

    cache_key = f"whois:{domain}"
    if cache:
        cached = cache.get(cache_key)
        if cached is not None:
            return cached  # peut être "" (aucun email trouvé, mis en cache pour éviter re-sonde)

    try:
        w = whois_lib.whois(domain)
        # python-whois renvoie emails en liste ou en string selon la lib
        raw_emails: list[str] = []
        if isinstance(w.emails, list):
            raw_emails = [str(e) for e in w.emails if e]
        elif isinstance(w.emails, str):
            raw_emails = _WHOIS_EMAIL_RE.findall(w.emails)

        # Filtrer les emails de registraire / génériques
        candidates = [
            e for e in raw_emails
            if not _WHOIS_IGNORE_RE.search(e)
            and domain.split('.')[0] in e.lower()  # préfère les emails du même domaine
        ]
        # Fallback : n'importe quel email non-générique du même domaine
        if not candidates:
            candidates = [
                e for e in raw_emails
                if not _WHOIS_IGNORE_RE.search(e) and domain in e.lower()
            ]

        result = candidates[0] if candidates else ""
        if cache:
            cache.set(cache_key, result, ttl=_WHOIS_TTL)
        return result
    except Exception as exc:
        log.debug("whois_email(%s) a échoué : %r", domain, exc)
        if cache:
            cache.set(cache_key, "", ttl=_WHOIS_TTL)
        return ""


def enrich_whois(companies: list[Company], delay: float,
                 cache: "PersistentCache | None" = None,
                 deadline=None) -> None:
    """
    Complète les entreprises encore sans email via le WHOIS de leur domaine.
    Appelé entre le web crawler (Phase 4) et Hunter.io (Phase 5).

    FIX-5 : ``cache`` PersistentCache transmis à whois_email pour persister les résultats.
    B0-7  : ``deadline`` optionnel — arrêt propre si la limite temps globale est atteinte.
    """
    if not WHOIS_AVAILABLE:
        return
    need = [c for c in companies if not c.contact_email and c.website]
    if not need:
        return
    if deadline is not None and deadline.expired():
        print("\n⏱   Phase 4b WHOIS : limite temps atteinte — sautée.")
        return
    print(f"\n🔎  Phase 4b : WHOIS ({len(need)} domaines)…")
    found = 0
    for c in need:
        if deadline is not None and deadline.expired():
            print(f"   ⏱   Limite de temps — WHOIS arrêté ({found}/{len(need)} traités)")
            break
        domain = _domain(c.website)
        if not domain:
            continue
        email = whois_email(domain, cache=cache)
        # Le WHOIS expose souvent des placeholders (nomdedomaine@, abuse@, hostmaster@…)
        # plutôt qu'un vrai contact. On les rejette → l'entreprise retombe sur le pattern.
        if email and _is_junk_email(email):
            email = ""
        if email:
            c.contact_email = email
            c.email_source = "whois"
            c.email_alternatives = generate_alternatives(domain, exclude=email)
            print(f"   ✅  {c.name} ({domain}) → {email}")
            found += 1
        time.sleep(delay * 0.2)
    print(f"   → {found}/{len(need)} emails trouvés via WHOIS")

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 6
# ══════════════════════════════════════════════════════════════════════════════
# PHASE 6 — DÉTECTION STACK TECHNIQUE
# ══════════════════════════════════════════════════════════════════════════════

# Dictionnaire complet des technologies par catégorie.
# Clé = identifiant interne, valeur = liste de variantes textuelles à détecter.
TECH_CATEGORIES: dict[str, list[str]] = {

    # ── Microsoft Power Platform ──────────────────────────────────────────────
    "Power BI":       ["Power BI", "PowerBI", "power bi", "PBI"],
    "Power Apps":     ["Power Apps", "PowerApps", "power apps"],
    "Power Automate": ["Power Automate", "PowerAutomate", "Microsoft Flow"],
    "Power Platform": ["Power Platform"],
    "Azure":          ["Azure", "Microsoft Azure"],
    "Azure Synapse":  ["Azure Synapse", "Synapse Analytics"],
    "Azure Data Factory": ["Azure Data Factory", "ADF"],
    "Azure ML":       ["Azure Machine Learning", "Azure ML", "AzureML"],
    "Azure Databricks": ["Azure Databricks"],

    # ── ETL / ELT / Orchestration ─────────────────────────────────────────────
    "dbt":            ["dbt", "data build tool", "dbt-core", "dbt Core"],
    "Apache Airflow": ["Airflow", "Apache Airflow"],
    "Apache Spark":   ["Spark", "PySpark", "Apache Spark", "Spark Streaming"],
    "Apache Kafka":   ["Kafka", "Apache Kafka", "Confluent"],
    "Apache Flink":   ["Flink", "Apache Flink"],
    "Prefect":        ["Prefect"],
    "Dagster":        ["Dagster"],
    "Luigi":          ["Luigi"],
    "Talend":         ["Talend"],
    "Informatica":    ["Informatica", "IICS"],
    "Fivetran":       ["Fivetran"],
    "Stitch":         ["Stitch", "Singer"],
    "AWS Glue":       ["AWS Glue", "Glue ETL"],
    "AWS Step Functions": ["Step Functions"],
    "Matillion":      ["Matillion"],
    "Pentaho":        ["Pentaho"],

    # ── Data Warehouses / Lakehouse ───────────────────────────────────────────
    "Snowflake":      ["Snowflake"],
    "Databricks":     ["Databricks", "Delta Lake", "Delta Tables"],
    "BigQuery":       ["BigQuery", "Big Query", "Google BigQuery"],
    "Redshift":       ["Redshift", "AWS Redshift", "Amazon Redshift"],
    "Greenplum":      ["Greenplum"],
    "Teradata":       ["Teradata"],
    "ClickHouse":     ["ClickHouse", "Clickhouse"],
    "duckDB":         ["DuckDB", "duckdb"],

    # ── BI / Visualisation ────────────────────────────────────────────────────
    "Tableau":        ["Tableau", "Tableau Desktop", "Tableau Server"],
    "Looker":         ["Looker", "Looker Studio", "Google Data Studio", "Looker ML"],
    "Metabase":       ["Metabase"],
    "Apache Superset":["Superset", "Apache Superset"],
    "Qlik":           ["Qlik", "QlikSense", "QlikView"],
    "MicroStrategy":  ["MicroStrategy"],
    "SAP BusinessObjects": ["SAP BO", "BusinessObjects"],
    "Grafana":        ["Grafana"],

    # ── Machine Learning / IA ─────────────────────────────────────────────────
    "TensorFlow":     ["TensorFlow", "Keras", "tensorflow"],
    "PyTorch":        ["PyTorch", "pytorch", "torch"],
    "scikit-learn":   ["scikit-learn", "sklearn", "scikit learn"],
    "XGBoost":        ["XGBoost", "LightGBM", "CatBoost"],
    "MLflow":         ["MLflow", "mlflow"],
    "Kubeflow":       ["Kubeflow"],
    "AWS SageMaker":  ["SageMaker", "AWS SageMaker", "Amazon SageMaker"],
    "Vertex AI":      ["Vertex AI", "Google Vertex"],
    "Hugging Face":   ["Hugging Face", "HuggingFace", "Transformers", "BERT", "GPT fine-tuning"],
    "LangChain":      ["LangChain", "langchain"],
    "OpenAI API":     ["OpenAI API", "GPT-4", "GPT-3", "Claude API"],
    "RAG":            ["RAG", "Retrieval-Augmented", "vector database", "embeddings"],

    # ── MLOps ─────────────────────────────────────────────────────────────────
    "Weights & Biases": ["W&B", "Weights & Biases", "wandb"],
    "DVC":            ["DVC", "Data Version Control"],
    "BentoML":        ["BentoML"],
    "Seldon":         ["Seldon"],

    # ── Langages & Frameworks data ────────────────────────────────────────────
    "Python":         ["Python", "pandas", "NumPy", "polars"],
    "SQL":            ["SQL", "T-SQL", "PL/SQL", "PostgreSQL", "MySQL"],
    "R":              ["R Studio", "RStudio", "tidyverse", "ggplot2"],
    "Scala":          ["Scala"],
    "Julia":          ["Julia"],

    # ── Cloud ─────────────────────────────────────────────────────────────────
    "AWS":            ["AWS", "Amazon Web Services", "EC2", "AWS Lambda"],
    "GCP":            ["GCP", "Google Cloud", "Google Cloud Platform"],
    "Kubernetes":     ["Kubernetes", "K8s", "Helm"],
    "Docker":         ["Docker", "Dockerfile", "docker-compose"],
    "Terraform":      ["Terraform", "IaC", "Infrastructure as Code"],
}

# Pré-compilation : un motif par variante, avec frontières strictes.
#
# CRITIQUE — corrige les faux positifs catastrophiques du matching par sous-chaîne :
#   "RAG"  était trouvé dans « ombrage », « ourage », « forage »…
#   "BERT" (variante Hugging Face) dans « liberté », « Robert », « Lambert »…
#   "conteneur"/"container" (Docker) → conteneurs physiques sur sites industriels.
#
# (?<![A-Za-z0-9]) / (?![A-Za-z0-9]) = la variante ne doit PAS être collée à un
# caractère alphanumérique ASCII. Les accents (é, è, à…) ne sont pas dans cette
# classe → ils comptent comme frontière, ce qui est exactement le comportement
# voulu pour le français (« liberté » → « bert » précédé de « i » = pas de match).
_TECH_PATTERNS: "list[tuple[str, re.Pattern[str]]]" = [
    (tech, re.compile(rf"(?<![A-Za-z0-9]){re.escape(variant)}(?![A-Za-z0-9])", re.IGNORECASE))
    for tech, variants in TECH_CATEGORIES.items()
    for variant in variants
]

# Pages crawlées pour la détection de stack — classées du plus générique au plus spécifique.
# Les pages produit/plateforme/about permettent de détecter le stack même sur des
# entreprises sans offre data ouverte (cas typique des candidatures spontanées).
STACK_DETECTION_PATHS = [
    # Homepage + présentation produit (stack visible sans offre active)
    '/',
    '/produit', '/produits', '/solution', '/solutions',
    '/plateforme', '/platform', '/outil', '/outils',
    '/technologie', '/technologies', '/technology', '/tech-stack', '/stack',
    # Pages À propos (outils cités dans la présentation de l'entreprise)
    '/a-propos', '/apropos', '/about', '/about-us',
    '/qui-sommes-nous', '/company', '/equipe', '/team',
    # Pages recrutement (bonus : stack mentionné dans les offres actuelles)
    '/jobs', '/offres', '/offres-emploi', '/carrieres', '/recrutement',
    '/careers', '/nous-rejoindre',
]


# Mapping Wappalyzer tech name → clé dans TECH_CATEGORIES
_WAPPALYZER_MAP: dict[str, str] = {
    "React":                  "React",
    "Vue.js":                 "Vue.js",
    "Angular":                "Angular",
    "Next.js":                "Next.js",
    "Nuxt.js":                "Nuxt.js",
    "PostgreSQL":             "SQL",
    "MySQL":                  "SQL",
    "Amazon Web Services":    "AWS",
    "Google Cloud Platform":  "GCP",
    "Microsoft Azure":        "Azure",
    "Docker":                 "Docker",
    "Kubernetes":             "Kubernetes",
    "Python":                 "Python",
    "Grafana":                "Grafana",
    "Tableau":                "Tableau",
    "Power BI":               "Power BI",
    "Snowflake":              "Snowflake",
    "Databricks":             "Databricks",
    "dbt":                    "dbt",
    "Apache Airflow":         "Apache Airflow",
    "Apache Spark":           "Apache Spark",
    "Apache Kafka":           "Apache Kafka",
    "TensorFlow":             "TensorFlow",
    "PyTorch":                "PyTorch",
    "Looker":                 "Looker",
    "MLflow":                 "MLflow",
    "Terraform":              "Terraform",
    "Elasticsearch":          "Elasticsearch",
    "Salesforce":             "Salesforce",
    "HubSpot":                "HubSpot",
    "BigQuery":               "BigQuery",
    "Redshift":               "Redshift",
    "Node.js":                "Node.js",
}


def detect_tech_stack(
    company: Company,
    fetcher: "_ThreadSafeFetcher | StealthyFetcher",
    user_stack: list[str],
    cache: "PersistentCache | None" = None,
    page_cache: "LRUPageCache | None" = None,  # Fix-B : cache partagé avec crawl_contact_page
) -> list[str]:
    """
    Détecte les technologies utilisées via deux passes complémentaires :
    1. Wappalyzer (si disponible) — lit HTTP headers + HTML → fiable, rapide
    2. Keyword matching sur le texte — couvre les outils data moins courants

    Fix-B : ``page_cache`` est un dict {url → texte} partagé avec crawl_contact_page.
    Les pages déjà chargées en Phase 4 sont réutilisées sans requête headless supplémentaire.

    Retourne la liste dédupliquée des techs trouvées.
    """
    if not company.website:
        return []

    cache_key = f"stack:{_domain(company.website)}"
    if cache:
        cached = cache.get_json(cache_key)
        if cached is not None:
            return cached

    # Assemble le texte + pages crawlées
    text_corpus  = ""
    wapp_detected: set[str] = set()
    base = company.website.rstrip("/")
    # Domaine qui ne résout pas → inutile de lancer le fetcher headless (3 retries
    # curl × N paths = tempête, ex. bobard.com SSL/NXDOMAIN). On saute.
    if not _host_resolves(company.website):
        return []

    consecutive_fail = 0
    _t0 = time.monotonic()
    for i, path in enumerate(STACK_DETECTION_PATHS):
        # Plafond temps/entreprise + bail-out 3 échecs (mêmes garde-fous que Phase 4).
        if time.monotonic() - _t0 > CRAWL_BUDGET_SEC or consecutive_fail >= 2:
            break
        url = base + path
        try:
            # Fix-B : vérifier le cache de pages en premier
            cached_text = page_cache.get(url) if page_cache is not None else None
            if cached_text is not None:
                text_corpus += cached_text + "\n"
                if len(text_corpus) > 50_000:
                    break
                continue

            # Fix SSL Phase 6 : requests + repli verify=False D'ABORD (rapide, gère
            # les certificats incomplets, logging propre via _get_ssl_lenient).
            # Le headless curl crachait des erreurs « unable to get local issuer
            # certificate » et échouait sur ces sites. On ne tombe sur le headless
            # qu'en dernier recours (SPA JS lourd où requests ne suffit pas).
            page_text = ""
            html = ""
            try:
                if BS4_AVAILABLE:
                    r = _get_ssl_lenient(
                        requests, url, 6,
                        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0"})
                    if r.status_code == 200:
                        html = r.text
                        page_text = _BS4(html, "html.parser").get_text(separator=" ", strip=True)
            except Exception:
                pass

            if not page_text:
                # Repli headless (SPA / requests bloqué)
                page = fetcher.get(url)
                if not page:
                    consecutive_fail += 1
                    continue
                page_text = page.get_text() if hasattr(page, "get_text") else ""
                html = page.html if hasattr(page, "html") else str(page)

            consecutive_fail = 0
            if page_cache is not None:
                page_cache[url] = page_text
            text_corpus += page_text + "\n"

            # Passe Wappalyzer sur la homepage uniquement (évite les doublons)
            if i == 0 and WAPPALYZER_AVAILABLE and _WAPPALYZER and html:
                try:
                    wp = _WappalyzerPage(base + path, html, {})
                    for tech_name in _WAPPALYZER.analyze(wp):
                        mapped = _WAPPALYZER_MAP.get(tech_name)
                        if mapped:
                            wapp_detected.add(mapped)
                except Exception:
                    pass

            if len(text_corpus) > 50_000:
                break
        except Exception:
            # fetcher.get peut LEVER (après ses 3 retries curl) au lieu de
            # renvoyer None : on incrémente AUSSI ici, sinon le bail-out ne se
            # déclenchait jamais (cause de la tempête btpdistribution.fr en Phase 6).
            consecutive_fail += 1
            continue

    if not text_corpus and not wapp_detected:
        return []

    # Keyword matching — frontières de mot strictes (cf. _TECH_PATTERNS) pour
    # éviter les faux positifs ("RAG" dans "ombrage", "BERT" dans "liberté"…).
    kw_detected = []
    _seen_kw: set[str] = set()
    for tech_name, pat in _TECH_PATTERNS:
        if tech_name in _seen_kw:
            continue
        if pat.search(text_corpus):
            kw_detected.append(tech_name)
            _seen_kw.add(tech_name)

    # Fusion Wappalyzer + keyword matching (Wappalyzer en priorité)
    detected = list(wapp_detected)
    for t in kw_detected:
        if t not in wapp_detected:
            detected.append(t)

    if cache:
        cache.set_json(cache_key, detected)
    return detected


def compute_relevance(tech_stack: list[str], user_stack: list[str]) -> int:
    """
    Score de pertinence 0-100 : proportion du stack utilisateur présente chez l'entreprise.
    """
    if not user_stack or not tech_stack:
        return 0
    matches = sum(1 for t in user_stack if t in tech_stack)
    return min(100, int(matches / len(user_stack) * 100))


def enrich_tech_stack(
    companies: list[Company],
    fetcher: "_ThreadSafeFetcher | StealthyFetcher",
    user_stack: list[str],
    delay: float,
    cache: "PersistentCache | None" = None,
    page_cache: "LRUPageCache | None" = None,  # Fix-B : cache partagé avec Phase 4
) -> None:
    """
    Détecte le stack technique de chaque entreprise (in-place).

    B0-4 : parallélisé via ThreadPoolExecutor. La majorité du travail est dans le
    page_cache (déjà chargé en Phase 4, accès rapide) + keyword matching CPU-pur.
    Les quelques requêtes headless résiduelles (pages non cachées) passent par
    `_ThreadSafeFetcher` qui a son propre lock → elles se sérialisent naturellement
    sans contention supplémentaire. Wappalyzer n'est utilisé que sur la homepage
    (path 0) → pas de conflit cross-company.
    Workers borné à 8 : au-delà les gains sont marginaux vu le lock fetcher.
    """
    if not companies:
        return
    wapp_msg = " + Wappalyzer" if WAPPALYZER_AVAILABLE else ""
    print(f"\n🔬  Phase 6 : détection stack technique{wapp_msg} ({len(companies)} entreprises)…")

    results: dict[int, list[str]] = {}  # id(company) → stack

    def _detect_one(c: Company) -> tuple[int, list[str]]:
        if not c.website:
            return id(c), []
        stack = detect_tech_stack(c, fetcher, user_stack, cache=cache, page_cache=page_cache)
        return id(c), stack

    workers = min(8, len([c for c in companies if c.website]) or 1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for cid, stack in ex.map(_detect_one, companies):
            results[cid] = stack

    found_any = 0
    for i, c in enumerate(companies, 1):
        stack = results.get(id(c), [])
        c.tech_stack       = stack
        c.relevance_score  = compute_relevance(stack, user_stack)
        if stack:
            found_any += 1
            top   = ", ".join(stack[:5])
            extra = f" +{len(stack)-5}" if len(stack) > 5 else ""
            print(f"   [{i}] {c.name[:30]:<30} → {top}{extra}  (pertinence {c.relevance_score}%)")

    print(f"   → Stack détecté pour {found_any}/{len(companies)} entreprises")


# ══════════════════════════════════════════════════════════════════════════════
# SCRAPE-DESC — DESCRIPTION D'ACTIVITÉ (texte du site + résumé IA)
# ══════════════════════════════════════════════════════════════════════════════

# Budget de texte source fourni au LLM (caractères). Ollama tourne à num_ctx=4096
# tokens. Marge de sécurité : 6000 car. source (~1800 tk) + consignes (~500 tk) +
# note (~1000 tk) ≈ 3300 tk < 4096 → PAS de débordement (le bug « ça saute » venait
# de 9000 car. qui frôlaient la limite). On reste donc à 4096, sans le ralentir.
_DESC_SOURCE_BUDGET = 6000
# Longueur max de la note stockée (caractères) — fiche complète et fouillée.
_DESC_MAX_LEN = 3200
# Nombre max de pages internes récupérées par entreprise (mode fetch).
_DESC_MAX_PAGES = 4
# Mots-clés d'URL qui mènent aux pages les plus riches : activité ET actualités.
_DESC_PAGE_HINTS = (
    "a-propos", "apropos", "about", "qui-sommes", "qui_sommes", "notre-histoire",
    "entreprise", "societe", "company", "nos-activites", "activites", "metier",
    "services", "produits", "solutions", "expertise", "savoir-faire", "what-we-do",
    # Actualités / presse / blog — pour capter les signaux récents.
    "actualite", "actualites", "actu", "news", "blog", "presse", "press",
    "communique", "communiques", "evenement", "evenements", "events", "journal",
)
# Mots-clés d'URL spécifiques aux ACTUALITÉS (2ᵉ fiche dédiée).
_DESC_NEWS_HINTS = (
    "actualite", "actualites", "actu", "news", "newsroom", "blog", "presse", "press",
    "communique", "communiques", "evenement", "evenements", "events", "journal",
    "salle-de-presse", "salle-presse", "espace-presse", "media", "medias",
    "le-mag", "lemag", "magazine", "publications", "insights", "agenda",
    # élargissement : davantage de pages actus/presse/blog réellement utilisées.
    "ressources", "resources", "nos-actualites", "toute-l-actualite", "a-la-une", "alaune",
    "annonces", "newsletter", "le-blog", "notre-blog", "decryptage", "decryptages",
    "tribune", "tribunes", "etudes", "rapports", "communication", "vie-du-groupe",
    "nos-news", "blog-news", "actus", "stories", "story",
)
# Longueur max de la section actualités (2ᵉ passe) — analyse complète mais bornée.
_NEWS_MAX_LEN = 1800


def _extract_site_text(html: str) -> str:
    """Extrait un texte riche de l'activité depuis le HTML : meta description + titre
    + intertitres (h1/h2/h3) + paragraphes + items de liste lisibles."""
    if not BS4_AVAILABLE or not html:
        # Repli sans bs4 : meta description brute via regex.
        m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', html or '', re.I)
        return (m.group(1).strip() if m else '')[:1000]
    try:
        soup = _BS4(html, "html.parser")
    except Exception:
        return ''
    for tag in soup(["script", "style", "nav", "footer", "header", "form"]):
        tag.decompose()
    parts: list[str] = []
    md = soup.find("meta", attrs={"name": "description"})
    if md and md.get("content"):
        parts.append(md["content"].strip())
    if soup.title and soup.title.string:
        parts.append(soup.title.string.strip())
    # Intertitres + paragraphes + listes (signal d'activité, services, valeurs…).
    for el in soup.find_all(["h1", "h2", "h3", "p", "li"]):
        t = el.get_text(" ", strip=True)
        if len(t) > 30:
            parts.append(t)
        if sum(len(x) for x in parts) > _DESC_SOURCE_BUDGET:
            break
    # Dédoublonnage en conservant l'ordre.
    seen: set[str] = set()
    uniq = [p for p in parts if not (p in seen or seen.add(p))]
    text = " ".join(uniq)
    return re.sub(r"\s+", " ", text).strip()[:_DESC_SOURCE_BUDGET]


def _domain_of(url: str) -> str:
    try:
        net = urlparse(url).netloc.lower()
        return net[4:] if net.startswith("www.") else net
    except Exception:
        return ""


def _registrable(domain: str) -> str:
    """Domaine « de marque » (2 derniers labels) — pour tolérer les sous-domaines
    (ex: group.bnpparibas.com et bnpparibas.com → même marque). Suffit pour FR/.com."""
    parts = (domain or "").split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else domain


def _same_brand(url: str, base_domain: str) -> bool:
    return _registrable(_domain_of(url)) == _registrable(base_domain)


def _lead_key(c: "Company") -> str:
    """Clé d'un lead — DOIT correspondre à celle du front (listLeads) :
    name|contactEmail|website en minuscules. Sert au filtrage par sous-ensemble affiché."""
    return f"{(c.name or '').strip()}|{(c.contact_email or '').strip()}|{(c.website or '').strip()}".lower()


def _gather_company_text(website: str, page_cache, timeout: float) -> str:
    """Agrège un maximum de matière sur l'entreprise pour une note approfondie :
    1) tout ce que le crawl a déjà mis en cache pour ce domaine (gratuit) ;
    2) sinon/complément : fetch de la home + 2-3 pages clés (à-propos, services…)."""
    domain = _domain_of(website if website.startswith("http") else f"https://{website}")
    chunks: list[str] = []
    total = 0

    # 1) Réutiliser le cache du crawl — priorité aux pages "à-propos/services/actu".
    has_hint_page = False  # le cache contient-il une page d'activité (≠ contact/légal) ?
    if page_cache is not None and hasattr(page_cache, "snapshot"):
        try:
            cached = page_cache.snapshot()
        except Exception:
            cached = {}
        same = [(u, t) for u, t in cached.items() if _domain_of(u) == domain and t and len(t) > 80]
        same.sort(key=lambda ut: (0 if any(h in ut[0].lower() for h in _DESC_PAGE_HINTS) else 1, len(ut[1]) * -1))
        for _u, t in same:
            if any(h in _u.lower() for h in _DESC_PAGE_HINTS):
                has_hint_page = True
            chunks.append(re.sub(r"\s+", " ", t).strip())
            total += len(chunks[-1])
            if total > _DESC_SOURCE_BUDGET:
                break

    # 2) Compléter par un fetch CIBLÉ si le cache est maigre OU ne contient aucune
    #    page d'activité (le crawl a souvent visité /contact /mentions-légales pour
    #    l'email, pas /à-propos). On va alors chercher la bonne matière en direct.
    if total < 1200 or not has_hint_page:
        base = website if website.startswith("http") else f"https://{website}"
        urls = [base]
        # Découvre les pages clés depuis la home.
        try:
            r = requests.get(base, timeout=timeout,
                             headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            if r.status_code == 200 and r.text:
                chunks.append(_extract_site_text(r.text))
                total += len(chunks[-1])
                if BS4_AVAILABLE:
                    soup = _BS4(r.text, "html.parser")
                    found: list[str] = []
                    for a in soup.find_all("a", href=True):
                        href = a["href"].lower()
                        if any(h in href for h in _DESC_PAGE_HINTS):
                            full = urljoin(base, a["href"])
                            if _domain_of(full) == domain and full not in found and full != base:
                                found.append(full)
                        if len(found) >= _DESC_MAX_PAGES:
                            break
                    urls = found
        except Exception:
            urls = []
        for u in urls[:_DESC_MAX_PAGES]:
            if total > _DESC_SOURCE_BUDGET:
                break
            try:
                rr = requests.get(u, timeout=timeout,
                                  headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                if rr.status_code == 200 and rr.text:
                    chunks.append(_extract_site_text(rr.text))
                    total += len(chunks[-1])
            except Exception:
                continue

    text = " ".join(c for c in chunks if c)
    return re.sub(r"\s+", " ", text).strip()[:_DESC_SOURCE_BUDGET]


def _summarize_activity(llm_client, name: str, text: str) -> str:
    """Rédige une NOTE APPROFONDIE sur l'entreprise via le LLM (ou '' si indispo).
    Pas un résumé d'une ligne : une vraie fiche structurée et factuelle."""
    if not llm_client or not getattr(llm_client, "available", lambda: False)():
        return ''
    prompt = (
        f"Voici du texte extrait de plusieurs pages du site de l'entreprise « {name} » "
        f"(accueil, à-propos, services, actualités…). Prends le temps de bien l'analyser, "
        f"puis rédige une NOTE D'ANALYSE APPROFONDIE, COMPLÈTE et FACTUELLE en français, "
        f"structurée en 8 à 12 phrases (≈280-420 mots). Sois exhaustif : exploite TOUTE "
        f"l'information disponible, ne te limite pas à une phrase par point. Couvre, quand "
        f"l'information est présente :\n"
        f"1. Activité principale & secteur (ce qu'elle fait concrètement).\n"
        f"2. Produits / services détaillés.\n"
        f"3. Clients, marché cible, zone géographique.\n"
        f"4. Différenciateurs : technologies, savoir-faire, certifications, valeurs, taille, ancienneté.\n"
        f"5. Un angle d'accroche utile pour une candidature spontanée (en quoi un profil data "
        f"   pourrait l'aider), uniquement si le texte le suggère.\n"
        f"NE TRAITE PAS les actualités/news ici : elles font l'objet d'une fiche séparée. "
        f"Concentre-toi sur le profil DURABLE de l'entreprise.\n"
        f"RÈGLES STRICTES :\n"
        f"- N'invente RIEN : ne cite que ce qui est étayé par le texte.\n"
        f"- NE DÉDUIS JAMAIS l'identité ou l'activité à partir du NOM ou d'un ACRONYME de "
        f"l'entreprise (ex : ne transforme pas un sigle en une autre société). Le nom ne prouve rien.\n"
        f"- Si le texte est trop maigre, ambigu, ou ne décrit pas clairement CETTE entreprise, "
        f"renvoie une description VIDE : {{\"description\": \"\"}}. Mieux vaut RIEN qu'une fiche inventée.\n"
        f"- PRIVILÉGIE LE FACTUEL et le VÉRIFIABLE : produits/services précis, technologies, "
        f"chiffres, implantations/villes, clients ou partenaires nommés, métiers exercés.\n"
        f"- BANNIS les slogans marketing creux et le jargon corporate vague : 'métiers d'avenir', "
        f"'soutien aux licornes à impact', 'engagé pour l'impact', 'solutions innovantes', "
        f"'acteur incontournable', 'au service de la transition'… Ne reprends ce genre de formule "
        f"QUE si elle est rattachée à un fait concret (un programme nommé, un chiffre, un produit). "
        f"En cas de doute, décris l'activité concrète plutôt que de citer le slogan.\n"
        f"- Mieux vaut une note plus courte mais 100 % factuelle qu'une note remplie de slogans.\n"
        f"Réponds en JSON : {{\"description\": \"...\"}}.\n\n"
        f"TEXTE DU SITE (plusieurs pages):\n{text[:_DESC_SOURCE_BUDGET]}"
    )
    try:
        res = llm_client.ask_json(
            prompt,
            system=("Tu es un analyste B2B qui rédige des fiches d'entreprise approfondies, "
                    "factuelles et actionnables pour un candidat préparant une candidature "
                    "spontanée. Tu prends le temps d'exploiter TOUTES les infos fournies."),
            cache_key=f"desc:{name.lower()}",
        )
        if isinstance(res, dict):
            d = str(res.get("description", "")).strip()
            return d[:_DESC_MAX_LEN]
    except Exception:
        pass
    return ''


def _gather_news_text(website: str, page_cache, timeout: float) -> str:
    """Agrège UNIQUEMENT le texte des pages actualités/presse/blog (2ᵉ fiche dédiée)."""
    domain = _domain_of(website if website.startswith("http") else f"https://{website}")
    chunks: list[str] = []
    total = 0
    # 1) Pages actu déjà en cache (crawl).
    if page_cache is not None and hasattr(page_cache, "snapshot"):
        try:
            cached = page_cache.snapshot()
        except Exception:
            cached = {}
        for u, t in cached.items():
            if (_same_brand(u, domain) and t and len(t) > 80
                    and any(h in u.lower() for h in _DESC_NEWS_HINTS)):
                chunks.append(re.sub(r"\s+", " ", t).strip())
                total += len(chunks[-1])
                if total > _DESC_SOURCE_BUDGET:
                    break
    # 2) Sinon, découvre et fetch les pages actu depuis la home.
    if total < 800:
        base = website if website.startswith("http") else f"https://{website}"
        try:
            r = requests.get(base, timeout=timeout,
                             headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            if r.status_code == 200 and r.text and BS4_AVAILABLE:
                soup = _BS4(r.text, "html.parser")
                links: list[str] = []
                for a in soup.find_all("a", href=True):
                    if any(h in a["href"].lower() for h in _DESC_NEWS_HINTS):
                        full = urljoin(base, a["href"])
                        if _same_brand(full, domain) and full not in links:
                            links.append(full)
                    if len(links) >= _DESC_MAX_PAGES:
                        break
                for u in links[:_DESC_MAX_PAGES]:
                    if total > _DESC_SOURCE_BUDGET:
                        break
                    try:
                        rr = requests.get(u, timeout=timeout,
                                          headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                        if rr.status_code == 200 and rr.text:
                            chunks.append(_extract_site_text(rr.text))
                            total += len(chunks[-1])
                    except Exception:
                        continue
        except Exception:
            pass
    text = " ".join(c for c in chunks if c)
    return re.sub(r"\s+", " ", text).strip()[:_DESC_SOURCE_BUDGET]


def _summarize_news(llm_client, name: str, text: str) -> str:
    """2ᵉ passe IA : analyse approfondie des ACTUALITÉS récentes (ou '' si rien/indispo)."""
    if not llm_client or not getattr(llm_client, "available", lambda: False)():
        return ''
    prompt = (
        f"Voici le texte des pages ACTUALITÉS / PRESSE / BLOG du site de « {name} ». "
        f"Rédige une ANALYSE APPROFONDIE, COMPLÈTE et FACTUELLE des actualités récentes, en "
        f"français, en 5 à 8 phrases. Reprends TOUTES les actualités identifiables, pas seulement "
        f"une. Couvre UNIQUEMENT ce qui est étayé par le texte : projets ou produits "
        f"lancés, levées de fonds, recrutements, partenariats, ouvertures, événements, résultats — "
        f"avec les DATES quand elles sont présentes. Pour chaque actualité, précise brièvement ce "
        f"qu'elle implique. Règles : n'invente RIEN, pas de slogan marketing, reste concret. "
        f"S'il n'y a AUCUNE actualité réelle datée/identifiable, renvoie une description VIDE. "
        f"Réponds en JSON : {{\"description\": \"...\"}}.\n\nTEXTE (pages actualités):\n{text[:_DESC_SOURCE_BUDGET]}"
    )
    try:
        res = llm_client.ask_json(
            prompt,
            system=("Tu es un analyste qui synthétise les actualités récentes d'une entreprise "
                    "de façon factuelle et datée, pour un candidat. Aucune invention, aucun slogan."),
            cache_key=f"news:{name.lower()}",
        )
        if isinstance(res, dict):
            d = str(res.get("description", "")).strip()
            return d[:_NEWS_MAX_LEN]
    except Exception:
        pass
    return ''


def _fiche_age_days(c: "Company", now: datetime) -> "float | None":
    """Âge de la fiche en jours (None si pas de date stockée)."""
    ts = getattr(c, "description_updated_at", "") or ""
    if not ts:
        return None
    try:
        return (now - datetime.fromisoformat(ts)).total_seconds() / 86400.0
    except Exception:
        return None


_NEWS_MARKER = "📰 Actualités récentes :"


def _general_part(desc: str) -> str:
    """Renvoie la note GÉNÉRALE (avant la section actualités) d'une fiche combinée."""
    if not desc:
        return ""
    i = desc.find("📰 Actualités récentes")
    return (desc[:i] if i != -1 else desc).rstrip()


def _set_news_section(general: str, news_note: str) -> str:
    """Recompose la fiche : note générale + section actualités (si présente)."""
    base = _general_part(general)  # tolère qu'on passe déjà une fiche combinée
    return f"{base}\n\n{_NEWS_MARKER}\n{news_note}" if news_note else base


def _news_age_days(c: "Company", now: datetime) -> "float | None":
    ts = getattr(c, "news_updated_at", "") or ""
    if not ts:
        return None
    try:
        return (now - datetime.fromisoformat(ts)).total_seconds() / 86400.0
    except Exception:
        return None


def enrich_news(companies: "list[Company]", llm_client=None,
                max_companies: "int | None" = None, timeout: float = 8.0,
                page_cache=None, force: bool = False,
                save_fn=None, save_every: int = 3,
                max_age_days: "int | None" = None,
                only_keys: "set[str] | None" = None) -> int:
    """Régénère UNIQUEMENT la note ACTUALITÉS (2ᵉ fiche), sans toucher la note générale.

    Ne traite que les entreprises ayant DÉJÀ une fiche générale (l'actu s'y rattache).
    force=True : toutes ; max_age_days=N : celles dont l'actu date de plus de N jours (ou
    jamais vérifiée). Met à jour ``news_updated_at`` à chaque vérification (même si aucune
    actu trouvée → évite de re-vérifier en boucle)."""
    now = datetime.now()

    def _needs(c: "Company") -> bool:
        if only_keys is not None and _lead_key(c) not in only_keys:
            return False  # hors sous-ensemble affiché/filtré
        if not c.website or not _general_part(c.description):
            return False  # pas de fiche générale → rien à quoi rattacher l'actu
        if force:
            return True
        if max_age_days:
            age = _news_age_days(c, now)
            return age is None or age >= max_age_days
        return not getattr(c, "news_updated_at", "")  # défaut : actus jamais vérifiées

    todo = [c for c in companies if _needs(c)]
    if max_companies:
        todo = todo[:max_companies]
    if not todo:
        print("ℹ  Actualités : aucune entreprise à rafraîchir.")
        print("ENRICH_DESC_IA 0")
        print("ENRICH_DESC_GAVEUP 0")
        return 0
    has_llm = bool(llm_client and getattr(llm_client, "available", lambda: False)())
    print(f"\n📰  Actualités d'entreprise ({len(todo)} entreprises"
          f"{' · analyse IA' if has_llm else ' · LLM indispo → ignoré'})…")
    n_ia = 0
    for i, c in enumerate(todo, 1):
        news_text = _gather_news_text(c.website, page_cache, timeout)
        news_note = _summarize_news(llm_client, c.name, news_text) if len(news_text) >= 200 else ''
        c.description = _set_news_section(c.description, news_note)
        c.news_updated_at = now.isoformat(timespec="seconds")  # vérifiée (même si vide)
        if news_note:
            n_ia += 1
        if save_fn and (i % save_every == 0):
            try:
                save_fn()
            except Exception:
                pass
        if i % 5 == 0 or i == len(todo):
            print(f"   …{i}/{len(todo)} ({n_ia} avec actu)")
    if save_fn:
        try:
            save_fn()
        except Exception:
            pass
    print(f"   → {n_ia}/{len(todo)} entreprise(s) avec actualités")
    gaveup = 1 if (has_llm and not bool(llm_client and getattr(llm_client, "available", lambda: False)())) else 0
    print(f"ENRICH_DESC_IA {n_ia}")
    print(f"ENRICH_DESC_GAVEUP {gaveup}")
    return n_ia


def enrich_descriptions(companies: "list[Company]", llm_client=None,
                        max_companies: "int | None" = None, timeout: float = 8.0,
                        page_cache=None, force: bool = False,
                        save_fn=None, save_every: int = 3,
                        max_age_days: "int | None" = None,
                        only_keys: "set[str] | None" = None) -> int:
    """Remplit Company.description avec une NOTE APPROFONDIE par entreprise (in-place).

    Agrège un maximum de matière (cache du crawl + pages clés à-propos/services), puis
    demande au LLM une vraie fiche factuelle. Repli sur un extrait du texte brut si aucun
    LLM. Retourne le nombre de descriptions ajoutées.

    force=False, max_age_days=None : ne traite que les entreprises SANS description.
    force=True                     : RÉGÉNÈRE toutes les entreprises avec un site (écrase).
    max_age_days=N (sans force)    : régénère les fiches VIDES + celles de plus de N jours
                                     (une fiche sans date est considérée trop ancienne).
    save_fn : callback appelé tous les ``save_every`` éléments + à la fin → PERSISTE le CSV
              au fil de l'eau (le travail survit si on quitte la page)."""
    now = datetime.now()

    def _needs(c: "Company") -> bool:
        if only_keys is not None and _lead_key(c) not in only_keys:
            return False  # hors sous-ensemble affiché/filtré
        if force or not c.description:
            return True
        if max_age_days:
            age = _fiche_age_days(c, now)
            return age is None or age >= max_age_days  # pas de date = trop ancienne
        return False

    # Candidats = entreprises à (re)décrire, qu'elles aient un site ou non.
    candidates = [c for c in companies if _needs(c)]
    todo = [c for c in candidates if c.website]
    n_no_site = len(candidates) - len(todo)   # impossible de faire une fiche sans site
    if max_companies:
        todo = todo[:max_companies]
    if not todo:
        print("ℹ  Descriptions : aucune entreprise à enrichir avec un site web.")
        print("ENRICH_DESC_IA 0")
        print("ENRICH_DESC_GAVEUP 0")
        print(f"ENRICH_DESC_NOSITE {n_no_site}")
        print("ENRICH_DESC_FAIL 0")
        return 0
    has_llm = bool(llm_client and getattr(llm_client, "available", lambda: False)())
    print(f"\n📝  Fiches d'entreprise approfondies ({len(todo)} entreprises"
          f"{' · note IA' if has_llm else ' · texte brut (LLM indispo)'})…")
    done = 0
    n_ia = 0     # fiches réellement rédigées par l'IA (vs repli texte brut)
    n_fail = 0   # entreprises avec site mais aucune matière récupérée (injoignable)
    for i, c in enumerate(todo, 1):
        text = _gather_company_text(c.website, page_cache, timeout)
        # < 200 car : source trop maigre → l'IA hallucinerait l'identité depuis le nom
        # (ex. « BPCE » → « Bridgers & Paxton »). On préfère ne pas décrire.
        if not text or len(text) < 200:
            n_fail += 1
            continue
        note = _summarize_activity(llm_client, c.name, text)
        stamp = now.isoformat(timespec="seconds")
        if note:
            n_ia += 1
            # 2ᵉ passe IA dédiée aux ACTUALITÉS (fiche séparée → ne déborde pas le contexte).
            # Uniquement si des pages actu existent (sinon pas d'appel LLM supplémentaire).
            news_text = _gather_news_text(c.website, page_cache, timeout)
            news_note = _summarize_news(llm_client, c.name, news_text) if len(news_text) >= 200 else ''
            c.description = _set_news_section(note, news_note)
            c.description_updated_at = stamp
            c.news_updated_at = stamp  # actu vérifiée en même temps (même si vide)
            done += 1
        elif not c.description:
            # Repli enrichi UNIQUEMENT si vide : ne jamais écraser une fiche existante
            # par un extrait brut quand on régénère (force) et que l'IA n'a pas répondu.
            c.description = text[:600]
            c.description_updated_at = stamp
            done += 1
        # Persistance incrémentale : le travail déjà fait n'est pas perdu si on quitte.
        if save_fn and (i % save_every == 0):
            try:
                save_fn()
            except Exception:
                pass
        if i % 5 == 0 or i == len(todo):
            print(f"   …{i}/{len(todo)} ({n_ia} par IA)")
    if save_fn:
        try:
            save_fn()
        except Exception:
            pass
    print(f"   → {done} fiche(s) · {n_ia} rédigée(s) par l'IA, {done - n_ia} en texte brut "
          f"· {n_fail} site(s) injoignable(s) · {n_no_site} sans site")
    # Lignes machine pour Electron : IA réelle, abandon coupe-circuit, sans-site, injoignables.
    gaveup = 1 if (has_llm and not bool(llm_client and getattr(llm_client, "available", lambda: False)())) else 0
    print(f"ENRICH_DESC_IA {n_ia}")
    print(f"ENRICH_DESC_GAVEUP {gaveup}")
    print(f"ENRICH_DESC_NOSITE {n_no_site}")
    print(f"ENRICH_DESC_FAIL {n_fail}")
    return done


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 7 — VALIDATION EMAIL (NeverBounce / ZeroBounce)
# ══════════════════════════════════════════════════════════════════════════════

class EmailValidator:
    """
    Valide les emails via NeverBounce ou ZeroBounce (au choix).
    NeverBounce : 1 000 gratuits à l'inscription → https://neverbounce.com
    ZeroBounce  :   100 gratuits/mois            → https://zerobounce.net
    """

    def __init__(self, provider: str, api_key: str):
        # Fix-3 : assert désactivé en mode python -O → raise ValueError explicite
        if provider not in ("neverbounce", "zerobounce"):
            raise ValueError(
                f"EmailValidator : provider invalide {provider!r}. "
                "Valeurs acceptées : 'neverbounce', 'zerobounce'."
            )
        self.provider = provider
        self.api_key = api_key
        self.calls = 0

    # Seuil de bascule batch : au-dessus de N emails, on utilise l'API batch
    # (1 seul appel HTTP) au lieu des appels individuels (N appels HTTP).
    BATCH_THRESHOLD = 10

    def validate(self, email: str) -> str:
        """Retourne : valid | invalid | catch_all | unknown | disposable | error"""
        if not email or not self.api_key:
            return ""
        self.calls += 1
        try:
            if self.provider == "neverbounce":
                return self._neverbounce(email)
            else:
                return self._zerobounce(email)
        except Exception as e:
            print(f"   ⚠  Validation {self.provider} ({email}) : {e}")
            return "error"

    def validate_batch(self, emails: list[str]) -> dict[str, str]:
        """
        A4 : Validation en lot — 1 appel API pour N emails.

        Avantage : ~N× moins de requêtes HTTP vs validate() individuel.
        NeverBounce : utilise /v4/bulk/check (fourni directement, sans S3).
        ZeroBounce  : utilise /v2/validatebatch (réponse immédiate).
        Retourne {email → résultat}. Les emails non résolus tombent sur "" (inconnu).

        Si n < BATCH_THRESHOLD ou provider non supporté → appels individuels.
        """
        if not emails or not self.api_key:
            return {}
        if len(emails) < self.BATCH_THRESHOLD:
            return {e: self.validate(e) for e in emails}

        try:
            if self.provider == "zerobounce":
                return self._zerobounce_batch(emails)
            elif self.provider == "neverbounce":
                return self._neverbounce_batch(emails)
        except Exception as exc:
            log.warning("validate_batch(%s) échoué (%s) → fallback individuel", self.provider, exc)
        # Fallback : appels individuels
        return {e: self.validate(e) for e in emails}

    def _neverbounce(self, email: str) -> str:
        url = "https://api.neverbounce.com/v4/single/check"
        resp = requests.get(url, params={"email": email, "api_key": self.api_key}, timeout=10)
        if resp.status_code == 401:
            print("   ⚠  NeverBounce : clé invalide.")
            return "error"
        result = resp.json().get("result", "unknown")
        return result.replace("catchall", "catch_all")

    def _neverbounce_batch(self, emails: list[str]) -> dict[str, str]:
        """
        NeverBounce bulk check via /v4/bulk/check.
        Soumet la liste directement (pas de S3 requis pour < 50 k adresses).
        Retourne {email → résultat} après polling (max 60 s).
        """
        # Créer le job
        create_url = "https://api.neverbounce.com/v4/jobs/create"
        payload = {
            "key": self.api_key,
            "input_location": "supplied",
            "input": [{"id": str(i), "email": e} for i, e in enumerate(emails)],
            "auto_start": True,
        }
        resp = requests.post(create_url, json=payload, timeout=20)
        if resp.status_code != 200:
            return {}
        job_id = resp.json().get("id")
        if not job_id:
            return {}
        self.calls += 1

        # Polling jusqu'à completion (max 60 s, polling 3 s)
        for _ in range(20):
            time.sleep(3)
            status_resp = requests.get(
                "https://api.neverbounce.com/v4/jobs/status",
                params={"key": self.api_key, "job_id": job_id},
                timeout=10,
            )
            if status_resp.json().get("status") == "complete":
                break
        else:
            return {}

        # Récupération des résultats
        results_resp = requests.get(
            "https://api.neverbounce.com/v4/jobs/results",
            params={"key": self.api_key, "job_id": job_id, "per_page": len(emails)},
            timeout=15,
        )
        out: dict[str, str] = {}
        for row in results_resp.json().get("results", []):
            email = row.get("data", {}).get("email", "")
            result = row.get("verification", {}).get("result", "unknown")
            out[email] = result.replace("catchall", "catch_all")
        self.calls += 2
        return out

    def _zerobounce_batch(self, emails: list[str]) -> dict[str, str]:
        """
        ZeroBounce batch validate via /v2/validatebatch.
        Répond immédiatement (pas de polling) — idéal pour < 200 emails.
        """
        url = "https://api.zerobounce.net/v2/validatebatch"
        payload = {
            "api_key": self.api_key,
            "email_batch": [{"email_address": e, "ip_address": ""} for e in emails],
        }
        resp = requests.post(url, json=payload, timeout=30)
        if resp.status_code != 200:
            return {}
        self.calls += 1
        out: dict[str, str] = {}
        for row in resp.json().get("email_batch", []):
            email  = row.get("address", "")
            status = row.get("status", "Unknown").lower()
            out[email] = status.replace("catch-all", "catch_all").replace("do_not_mail", "invalid")
        return out

    def _zerobounce(self, email: str) -> str:
        url = "https://api.zerobounce.net/v2/validate"
        resp = requests.get(url, params={"apikey": self.api_key, "email": email, "ip_address": ""}, timeout=10)
        if resp.status_code == 400:
            print("   ⚠  ZeroBounce : quota ou clé invalide.")
            return "error"
        data = resp.json()
        status = data.get("status", "Unknown").lower()
        return status.replace("catch-all", "catch_all").replace("do_not_mail", "invalid")


def enrich_validation(
    companies: list[Company],
    validator: EmailValidator,
    delay: float,
    skip_catch_all: bool = True,
) -> None:
    """
    Valide les emails des entreprises (in-place). Saute les catch-alls déjà confirmés.

    A4 : utilise validate_batch() quand n >= BATCH_THRESHOLD (1 appel HTTP pour tout le lot)
    au lieu d'un appel individuel par email. Repli automatique sur le mode individuel si
    l'API batch échoue.
    """
    need = [c for c in companies if c.contact_email and c.email_source != "catch_all"]
    if not need:
        return
    print(f"\n✉️   Phase 7 : validation email {validator.provider} ({len(need)} adresses)…")
    stats: dict[str, int] = {}

    if len(need) >= validator.BATCH_THRESHOLD:
        # ── Mode batch (A4) : 1 appel API pour tout le lot ─────────────────────
        emails = [c.contact_email for c in need]
        batch_results = validator.validate_batch(emails)
        for c in need:
            result = batch_results.get(c.contact_email, "unknown")
            c.email_validated = result
            stats[result] = stats.get(result, 0) + 1
    else:
        # ── Mode individuel (ancien comportement) ─────────────────────────────
        for i, c in enumerate(need, 1):
            result = validator.validate(c.contact_email)
            c.email_validated = result
            stats[result] = stats.get(result, 0) + 1
            badge = "✅" if result == "valid" else ("🔴" if result == "invalid" else "🟡")
            if i % 10 == 0 or result == "invalid":
                print(f"   [{i}/{len(need)}] {c.contact_email[:40]} → {badge} {result}")
            time.sleep(delay * 0.2)

    print(f"   → Résultats : {stats}  ({validator.calls} appels API)")

