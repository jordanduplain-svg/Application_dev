"""
domain_resolve — Résolution « nom d'entreprise → domaine web » + validation.

Extrait d'enrich.py (point #6 audit : casser le module-dieu). Bloc cohésif et
SANS dépendance au côté « email » d'enrich — il ne dépend que des couches basses
(models, infra, requests, bs4), donc aucun risque d'import circulaire.

enrich.py ré-exporte tout ce module pour la compatibilité descendante
(`from .enrich import resolve_company_domain` continue de fonctionner).
"""
from __future__ import annotations

import concurrent.futures
import re
import time
from difflib import SequenceMatcher

import requests

from .models import Company, _domain
from .infra import _retry, RateLimiter, PersistentCache, log

# bs4 optionnel (comme dans enrich) — _homepage_title_confirms en a besoin.
try:
    from bs4 import BeautifulSoup as _BS4
    BS4_AVAILABLE = True
except ImportError:
    _BS4 = None
    BS4_AVAILABLE = False


# Domaines à exclure de la résolution : annuaires, réseaux sociaux, agrégateurs.
# Ce ne sont jamais le vrai site d'une entreprise.
_AGGREGATOR_DOMAINS = frozenset([
    "societe.com", "verif.com", "pappers.fr", "infogreffe.fr", "manageo.fr",
    "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
    "youtube.com", "wikipedia.org", "wikidata.org", "viadeo.com",
    "kompass.com", "europages.fr", "pagesjaunes.fr", "indeed.com",
    "welcometothejungle.com", "glassdoor.fr", "glassdoor.com", "apec.fr",
    "google.com", "bing.com", "yelp.com", "trustpilot.com", "leboncoin.fr",
    "amazon.fr", "amazon.com", "youtube.fr", "francetravail.fr", "pole-emploi.fr",
])


def _is_aggregator(domain: str) -> bool:
    """True si le domaine est un annuaire/réseau social (jamais le vrai site d'une boîte)."""
    d = domain.lower()
    if d.startswith("www."):
        d = d[4:]
    return any(d == agg or d.endswith("." + agg) for agg in _AGGREGATOR_DOMAINS)


def _name_similarity(a: str, b: str) -> float:
    """Similarité 0-1 entre deux noms normalisés (pour valider un match nom→domaine)."""
    def norm(s: str) -> str:
        s = s.lower()
        for fr, en in [("é","e"),("è","e"),("ê","e"),("à","a"),("â","a"),
                       ("î","i"),("ô","o"),("ù","u"),("û","u"),("ç","c")]:
            s = s.replace(fr, en)
        return re.sub(r"[^a-z0-9]", "", s)
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


# TLD implausibles pour une PME française/européenne : gouvernements, armée,
# universités, et ccTLD lointains (un industriel d'Auvergne-Rhône-Alpes n'est
# jamais sur .jp / .ca / .gov.in). Évite les faux comme MONTANA→mt.gov,
# G.H.M.→ghmc.gov.in, CASTEL ET FROMAGET→castel.jp, NOVASCO→novascotia.ca.
_IMPLAUSIBLE_TLD_RE = re.compile(
    r"(?:"
    r"\.gov(?:\.[a-z]{2})?$|\.gouv(?:\.[a-z]{2})?$|\.mil(?:\.[a-z]{2})?$|"
    r"\.edu(?:\.[a-z]{2})?$|\.ac\.[a-z]{2}$|\.go\.[a-z]{2}$|"
    # ccTLD hors Europe de l'Ouest
    r"\.(?:jp|ca|in|cn|au|br|mx|ru|kr|us|za|ar|cl|nz|sg|hk|tw|th|id|my|ph|vn|ae|sa|tr|il)$"
    r")",
    re.IGNORECASE,
)


# ccTLD (2 lettres) plausibles pour une entreprise FR/Europe de l'Ouest + 2-lettres
# utilisés comme gTLD (eu, io, co, ai, me, tv). Tout autre ccTLD 2-lettres
# (jp, ca, in, ve, br…) est rejeté. Les gTLD (≥3 lettres : com, org, tech…) passent.
_ALLOWED_2LETTER_TLD = frozenset({
    "fr", "be", "de", "es", "it", "nl", "ch", "lu", "pt", "ie", "uk", "at",
    "dk", "se", "no", "fi", "pl", "cz",          # Europe de l'Ouest/proche
    "eu", "io", "co", "ai", "me", "tv",          # 2-lettres usités comme gTLD
})

# Fix domaines-étrangers : pour une recherche EXPLICITEMENT française (country_hint=fr),
# une PME a son vrai site sur .fr ou .com (~90%), parfois .eu/.io/.net — quasi JAMAIS
# sur .it/.de/.es/.uk/.sg… Ce set restreint les ccTLD 2-lettres acceptés en mode FR.
# Évite les faux positifs type « HORMEI » (Isère) → horme.it (quincaillerie italienne).
# Les gTLD (≥3 lettres : com, org, tech…) restent toujours acceptés.
_FR_ADJACENT_2LETTER = frozenset({
    "fr", "be", "ch", "lu", "mc",                # francophone / frontalier
    "eu", "io", "co", "ai", "me", "tv",          # 2-lettres usités comme gTLD (neutres)
})


def _tld_plausible(domain: str, country_hint: str = "") -> bool:
    """
    False si le TLD trahit un site gouvernemental/étranger lointain.
    Stratégie WHITELIST pour les ccTLD 2-lettres (plus robuste qu'un blocklist
    interminable : .ve, .jp, .ca, .in… sont rejetés sans devoir les lister).

    B2-15 : ``country_hint`` optionnel. Si fourni, le ccTLD correspondant est
    toujours accepté — sinon une entreprise allemande (.de) serait bloquée lors
    d'une expansion internationale du scraper (seuls les ccTLD EU de l'Ouest
    étaient dans _ALLOWED_2LETTER_TLD). Ex : country_hint="de" → .de admis même
    si l'utilisateur scrape hors de la whitelist statique.
    """
    d = domain.lower().rstrip(".")
    tld = d.rsplit(".", 1)[-1]

    ch = (country_hint or "").lower()

    # B2-15 : country_hint prioritaire sur tout filtrage.
    # Si le TLD correspond exactement au pays cible (ex: country_hint="ca" → .ca),
    # on l'accepte MÊME s'il est dans _IMPLAUSIBLE_TLD_RE (liste statique Europe).
    if ch and len(tld) == 2 and tld == ch[:2]:
        # Seule exclusion maintenue : .gov/.gouv/.mil/.edu (jamais un site pro)
        if re.search(r'\.(gov|gouv|mil|edu)(?:\.[a-z]{2})?$', d):
            return False
        return True

    if _IMPLAUSIBLE_TLD_RE.search(d):       # gov/gouv/mil/edu/ac.xx/go.xx + ccTLD lointains
        return False
    if len(tld) == 2:                       # ccTLD pays → whitelist
        # Fix domaines-étrangers : recherche EXPLICITEMENT française → set FR-strict.
        # Rejette .it/.de/.es/.uk… (présents dans la whitelist large mais étrangers
        # pour une PME FR). Le sanitizer d'email appelle sans country_hint → garde
        # le comportement large (un email @x.de reste valide).
        if ch in ("fr", "france"):
            return tld in _FR_ADJACENT_2LETTER
        return tld in _ALLOWED_2LETTER_TLD
    return True                             # gTLD (com, org, …) → plausible


def _looks_like_prefix_collision(name: str, core: str) -> bool:
    """
    True si `name` n'est qu'un PRÉFIXE d'un cœur de domaine nettement plus long
    (ex. 'alten'→'altenew', 'asco'→'ascolour', 'novasco'→'novascotiatoday',
    'castel'→'castellodiamorosa'). Ces correspondances ont une similarité élevée
    mais pointent vers une AUTRE entreprise → on les rejette.
    """
    n = re.sub(r"[^a-z0-9]", "", name.lower())
    c = re.sub(r"[^a-z0-9]", "", core.lower())
    if not n or not c or n == c:
        return False
    # name est un préfixe (ou c préfixe de n) ET l'écart de longueur est notable.
    longer, shorter = (c, n) if len(c) >= len(n) else (n, c)
    return longer.startswith(shorter) and (len(longer) - len(shorter)) >= 2


# Cœurs de domaine GÉNÉRIQUES : mots communs qui appartiennent à de gros sites
# sans rapport (office.com = Microsoft, data.com…). On les refuse SAUF si le nom
# de l'entreprise est LITTÉRALEMENT ce mot (protège les marques type « Orange »).
# B2-8 : deux frozensets distincts selon la nature du mot-clé.
# Avant : un seul ensemble mélangeait mots techniques et mots géographiques,
# rendant difficile l'extension ciblée (ex. ajouter "berlin" sans toucher
# aux outils techniques, ou vice-versa).

# Mots génériques d'outil/service — jamais le vrai domaine d'une entreprise précise.
_GENERIC_TECH_WORDS = frozenset({
    "office", "service", "services", "contact", "info", "infos", "group", "groupe",
    "data", "cloud", "web", "online", "digital", "mail", "email", "home", "site",
    "shop", "store", "news", "world", "global", "company", "business", "media",
    "network", "portal", "work", "jobs", "team", "market", "expert", "conseil",
    "solution", "solutions",
})

# Mots géographiques/institutionnels — le domaine appartient à une entité
# nationale/internationale, pas à une PME ciblée.
_GENERIC_GEO_WORDS = frozenset({
    "france", "paris", "europe", "international",
})

# Union pour la logique existante (compat descendante — utilisée dans _domain_matches_name).
_GENERIC_DOMAIN_CORES = _GENERIC_TECH_WORDS | _GENERIC_GEO_WORDS

# Tokens SECTORIELS / juridiques / de liaison qui ne doivent JAMAIS, à eux seuls, valider un
# domaine. Étend les mots génériques de domaine (media, group, france, conseil…) avec les
# suffixes de secteur (sante, pharma…) et de forme juridique (sas, sarl…). Sert à comparer la
# partie DISTINCTIVE des noms : « CEGI-SANTE » et « media-sante » ne partagent que « sante » —
# une fois ce token retiré, « cegi » ≠ « media » → homonyme sectoriel, à rejeter.
_GENERIC_NAME_TOKENS = _GENERIC_DOMAIN_CORES | frozenset({
    "sante", "pharma", "pharmacie", "medical", "medicale", "bio", "tech",
    "consulting", "sas", "sasu", "sarl", "eurl", "sa", "scop", "sci",
    "compagnie", "societe", "et", "de", "du", "des", "la", "le", "les", "the",
})


def _distinctive(s: str) -> str:
    """Réduit un nom à sa partie DISTINCTIVE (tokens sectoriels/juridiques/liaison retirés)."""
    toks = [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t and t not in _GENERIC_NAME_TOKENS]
    return "".join(toks)


# Mots de MÉTIER / ACTIVITÉ génériques : décrivent ce que fait la boîte, pas QUI elle est.
# Des dizaines d'entreprises partagent « RENOV TOUT », « BATIMENT SERVICES », « TOUS TRAVAUX » —
# toutes avec une similarité de nom ~1.0. Un nom composé UNIQUEMENT de ces mots (+ tokens
# juridiques/liaison) n'a aucune identité distinctive → résoudre son domaine par similarité,
# c'est tirer au hasard entre les homonymes (cf. RENOV TOUT Lyon → renov-tout.com Saint-Nazaire).
_GENERIC_TRADE_WORDS = frozenset({
    "renov", "renove", "renovation", "renovations", "reno", "renovtout",
    "batiment", "batiments", "bati", "travaux", "construction", "constructions",
    "btp", "maconnerie", "macon", "plomberie", "plombier", "sanitaire",
    "electricite", "electricien", "elec", "peinture", "peintre", "toiture",
    "couverture", "couvreur", "menuiserie", "menuisier", "isolation", "carrelage",
    "platrerie", "platrier", "chauffage", "climatisation", "clim", "facade", "ravalement",
    "jardin", "jardins", "paysage", "paysagiste", "espaces", "vert", "verts",
    "nettoyage", "proprete", "entretien", "transport", "transports", "taxi", "vtc",
    "auto", "autos", "automobile", "garage", "immobilier", "immo", "securite",
    "coiffure", "coiffeur", "esthetique", "restaurant", "resto", "pizza", "pizzeria",
    "boulangerie", "patisserie", "traiteur", "multiservices", "multiservice", "multi",
    "habitat", "maison", "maisons", "deco", "decoration", "amenagement", "amenagements",
    "sol", "sols", "mur", "murs", "renover", "tout", "tous", "toute", "toutes",
})


def _is_generic_business_name(name: str) -> bool:
    """
    True si le nom n'est composé QUE de mots génériques de métier/activité (renov, batiment,
    travaux, tout…) et de tokens juridiques/liaison, SANS aucune partie DISTINCTIVE (patronyme,
    marque inventée). Pour ces libellés, des dizaines d'homonymes existent en France → un domaine
    deviné par similarité de nom est un tirage au sort entre eux ; on refuse alors de résoudre.
    Ex : « RENOV TOUT », « BATIMENT SERVICES », « TOUS TRAVAUX RENOVATION » → True.
        « DUPONT RENOVATION », « AKKODIS », « CAPGEMINI » → False (token distinctif présent).
    Conservateur : ne renvoie True QUE si RIEN de distinctif ne subsiste (zéro faux positif visé).
    """
    toks = [t for t in re.split(r"[^a-z0-9]+", name.lower()) if t]
    if not toks:
        return False
    generic = _GENERIC_NAME_TOKENS | _GENERIC_TRADE_WORDS
    distinctive = [t for t in toks if len(t) > 1 and t not in generic]
    return not distinctive


def _distinctive_match(name: str, core: str) -> bool:
    """
    APPROCHE HYBRIDE — cœur de la validation anti-homonyme-sectoriel, DÉDIÉE au matching
    nom↔domaine (on ne touche PAS à la primitive globale `_name_similarity`, réutilisée par
    _homepage_title_confirms, le seuil collision 0.9 et enrich.py → zéro effet de bord).

    La partie DISTINCTIVE du nom (tokens sectoriels/génériques retirés : sante, tech, france…)
    doit réellement se retrouver dans le cœur du domaine. On teste par CONTAINMENT (et non par
    score) car c'est robuste au COLLAGE : « cegi » ⊂ « cegisante » ✔ mais « cegi » ⊄ « mediasante » ✘
    — là où un score serait asymétrique (« cegi » vs « cegisante » ≈ 0.6).

    Renvoie True (match plausible) si :
      - le nom n'a pas de partie distinctive (entièrement générique) → indécidable, on n'oppose
        pas de veto (mieux vaut comparer trop que sur-rejeter) ; OU
      - la partie distinctive est contenue dans le cœur (ou l'inverse), OU concorde par
        similarité distinctive (≥ 0.5) pour les variantes orthographiques.
    """
    dn = _distinctive(name)
    if not dn:
        return True
    core_norm = re.sub(r"[^a-z0-9]", "", core.lower())
    if dn in core_norm or core_norm in dn:
        return True
    dc = _distinctive(core)
    return bool(dc and _name_similarity(dn, dc) >= 0.5)


def _domain_core(domain: str) -> str:
    """Étiquette principale du domaine : 'mentions.acme.fr' → 'acme', 'as.com' → 'as'."""
    d = domain.lower()
    if d.startswith("www."):
        d = d[4:]
    labels = [p for p in d.split(".") if p]
    if not labels:
        return ""
    # Si TLD composé (co.uk, com.br) on prend l'avant-avant-dernier label
    if len(labels) >= 3 and labels[-2] in ("co", "com", "gouv", "gov", "org", "net", "ac"):
        return labels[-3]
    return labels[-2] if len(labels) >= 2 else labels[0]


def _domain_matches_name(name: str, domain: str, cand_name: str = "",
                         country_hint: str = "") -> bool:
    """
    Valide qu'un domaine correspond réellement à l'entreprise. Garde-fous :
      - TLD plausible (pas .gov/.jp/…) — B2-15 : tient compte de country_hint
      - similarité suffisante entre le nom et (le nom du candidat OU le cœur du domaine)
      - cœur de domaine très court (≤ 3) → exige une quasi-égalité (évite 'Asco'→'as.com')
    """
    if not _tld_plausible(domain, country_hint=country_hint):
        return False
    core = _domain_core(domain)
    if not core:
        return False
    # Reco 2 (audit) : cœur de domaine = mot GÉNÉRIQUE (office, data, service…)
    # → c'est un gros site sans rapport, SAUF si l'entreprise s'appelle littéralement
    # ainsi (ex. ONISEP « Office National… » → office.com REJETÉ ; une marque
    # nommée exactement « Office » serait gardée).
    nn = re.sub(r"[^a-z0-9]", "", name.lower())
    if core in _GENERIC_DOMAIN_CORES and nn != core:
        return False
    # Collision de préfixe (alten→altenew, asco→ascolour…) : rejet, sauf si le
    # NOM du candidat (cand_name, fourni par Clearbit) confirme une vraie égalité.
    if _looks_like_prefix_collision(name, core):
        if not (cand_name and _name_similarity(name, cand_name) >= 0.9):
            return False
    sim = max(_name_similarity(name, cand_name) if cand_name else 0.0,
              _name_similarity(name, core))
    # Domaine ultra-court : 'as', 'mt', 'se', 'bd'… très risqué (as.com ≠ Asco).
    # On valide seulement si :
    #   - quasi-égalité de similarité, OU
    #   - le NOM du candidat (Clearbit) COMMENCE par le nom recherché (≥4 lettres)
    #     → récupère les abréviations légitimes : Schneider Electric → se.com,
    #       sans admettre 'Diario AS' → as.com pour « Asco ».
    if len(core) <= 3:
        cn = re.sub(r"[^a-z0-9]", "", (cand_name or "").lower())
        nn = re.sub(r"[^a-z0-9]", "", name.lower())
        if len(nn) >= 4 and cn.startswith(nn):
            return True
        return sim >= 0.9
    # HYBRIDE anti-homonyme-sectoriel : la partie distinctive du nom doit se retrouver dans le
    # domaine (containment, cf. _distinctive_match) — SAUF si la similarité complète est déjà
    # forte (≥ 0.85) ou si un cand_name Clearbit confirme (≥ 0.85). Ce garde-fou n'est PAS un
    # angle mort : un homonyme porté par un seul token sectoriel plafonne bien plus bas
    # (CEGI-SANTE/media-sante 0.74 ; HUNTX PHARMA/sunpharma 0.80), tandis que les vrais matches
    # très proches passent. On reste LOCALISÉ au matching de domaine → la primitive globale
    # `_name_similarity` (0.9 collision, 0.55 homepage-confirm, enrich.py) reste intacte.
    strong = sim >= 0.85 or bool(cand_name and _name_similarity(name, cand_name) >= 0.85)
    if not strong and not _distinctive_match(name, core):
        return False
    return sim >= 0.62


def _homepage_title_confirms(name: str, domain: str) -> bool:
    """
    Point #12 : confirmation par le <title> de la homepage. Récupère la page
    d'accueil (GET court) et vérifie que le nom de l'entreprise apparaît dans le
    <title> / <meta og:site_name>. Sert de SECONDE CHANCE pour les candidats que
    la similarité stricte rejette de justesse — sans admettre de faux, car le
    site doit réellement se nommer ainsi.

    Conçu pour être bon marché : timeout 4 s, TLD déjà filtré en amont, et appelé
    seulement quand aucun candidat n'a validé par similarité.
    """
    if not _tld_plausible(domain) or not BS4_AVAILABLE:
        return False
    try:
        r = _retry(lambda: requests.get(f"https://{domain}", timeout=4,
                                        allow_redirects=True), retries=1)
        if r is None or r.status_code != 200:
            return False
        soup = _BS4(r.text, "html.parser")
        haystack = ""
        if soup.title and soup.title.string:
            haystack += soup.title.string + " "
        og = soup.find("meta", attrs={"property": "og:site_name"})
        if og and og.get("content"):
            haystack += og["content"]
        # Le nom (ou son cœur) doit apparaître dans le titre/og:site_name.
        nn = re.sub(r"[^a-z0-9]", "", name.lower())
        hh = re.sub(r"[^a-z0-9]", "", haystack.lower())
        if not nn or not hh:
            return False
        return nn in hh or _name_similarity(name, haystack) >= 0.55
    except Exception as exc:
        log.debug("_homepage_title_confirms(%s, %s) a échoué : %r", name, domain, exc)
        return False


def _tld_priority(domain: str, country_hint: str) -> int:
    """
    Score de priorité TLD (plus bas = meilleur) pour trier les candidats Clearbit.
    Pour une entreprise française, .fr et .com sont à préférer à .co.uk / .ie / .de…
    """
    tld = domain.rsplit(".", 1)[-1].lower()
    if country_hint.lower() in ("fr", "france"):
        if tld == "fr":   return 0    # domaine national = priorité max
        if tld in ("com", "io", "eu", "net", "org"): return 1
        if tld in ("be", "ch", "lu"):  return 2   # pays francophones proches
        return 3          # tout autre TLD (co.uk, ie, de…) = dépriorisé
    return 1              # pas de hint → ordre neutre


def resolve_domain_clearbit(name: str, country_hint: str = "fr") -> str:
    """
    Résout un nom d'entreprise → domaine via Clearbit Autocomplete (gratuit, sans clé).
    Valide la pertinence par similarité de nom. Retourne le domaine ou "".
    country_hint : "fr" par défaut (source SIRENE = entreprises françaises).
    """
    if not name:
        return ""
    try:
        resp = requests.get(
            "https://autocomplete.clearbit.com/v1/companies/suggest",
            params={"query": name},
            timeout=8,
        )
        if resp.status_code != 200:
            return ""
        results = resp.json() or []
        # Construit la liste des candidats valides (similarité + TLD plausible),
        # puis les trie par priorité TLD pour le pays cible.
        valid: list[tuple[int, str]] = []   # (priorité, domaine)
        for r in results:
            domain = (r.get("domain") or "").lower().rstrip("/")
            if not domain or _is_aggregator(domain):
                continue
            cand_name = r.get("name") or ""
            if _domain_matches_name(name, domain, cand_name, country_hint=country_hint):
                prio = _tld_priority(domain, country_hint)
                valid.append((prio, domain))
        if valid:
            valid.sort(key=lambda x: x[0])
            return valid[0][1]
        # PAS de fallback « 1er résultat » ni de « seconde chance » par titre de
        # homepage : cette dernière admettait des faux par sous-chaîne.
        # Mieux vaut "" (pas de domaine) qu'un faux.
        return ""
    except Exception as exc:
        log.debug("resolve_domain_clearbit(%s) a échoué : %r", name, exc)
        return ""


def resolve_domain_duckduckgo(name: str, region_hint: str = "",
                              country_hint: str = "") -> str:
    """
    Résout un nom d'entreprise → domaine via DuckDuckGo HTML (gratuit, pas de blocage).
    Fallback quand Clearbit ne connaît pas la PME. Retourne le domaine ou "".

    Fix domaines-étrangers : country_hint propagé à _domain_matches_name → le filtre
    FR-strict s'applique aussi aux résultats DDG (avant : DDG contournait le filtre).
    """
    if not name:
        return ""
    query = f"{name} {region_hint} site officiel".strip()
    try:
        resp = requests.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query},
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=10,
        )
        if resp.status_code != 200:
            return ""
        # Les résultats DDG HTML : liens dans <a class="result__a" href="...">
        # Le href réel est parfois encodé via /l/?uddg=...
        from urllib.parse import unquote, parse_qs, urlsplit
        candidates: list[str] = []
        for m in re.finditer(r'href="(https?://[^"]+)"', resp.text):
            url = m.group(1)
            # Décoder les redirections DDG
            if "duckduckgo.com/l/" in url:
                qs = parse_qs(urlsplit(url).query)
                if "uddg" in qs:
                    url = unquote(qs["uddg"][0])
            dom = _domain(url)
            if dom and not _is_aggregator(dom):
                candidates.append(dom)
        # Premier candidat qui valide réellement (similarité + TLD plausible).
        # PAS de fallback « 1er résultat » : DDG renvoie souvent des sites sans
        # rapport en tête (faux positifs garantis sinon).
        for dom in candidates:
            if _domain_matches_name(name, dom, country_hint=country_hint):
                return dom
        return ""
    except Exception as exc:
        log.debug("resolve_domain_duckduckgo(%s) a échoué : %r", name, exc)
        return ""


def resolve_company_domain(name: str, region_hint: str = "",
                           cache: "PersistentCache | None" = None,
                           country_hint: str = "fr") -> str:
    """
    Résout un nom d'entreprise → domaine web. Cascade :
      1. Cache persistant (30j)
      2. Clearbit Autocomplete + DuckDuckGo sur le nom complet
      3. Idem sur des variantes NETTOYÉES (sans formes juridiques/géo) — crucial pour
         les noms SIRENE verbeux ("CAPGEMINI TECHNOLOGY SERVICES" → "Capgemini").

    Retourne le domaine (ex: "acme.fr") ou "" si introuvable.
    """
    if not name:
        return ""
    # ANTI-HOMONYME GÉNÉRIQUE : un nom entièrement générique (« RENOV TOUT », « TOUS TRAVAUX »)
    # a des dizaines de porteurs en France, tous à similarité ~1.0 → le domaine deviné serait
    # un homonyme au hasard (cf. RENOV TOUT Lyon → renov-tout.com = Saint-Nazaire). On ne résout
    # PAS : mieux vaut aucune adresse (pas d'envoi) qu'un email à la mauvaise entreprise.
    if _is_generic_business_name(name):
        log.debug("résolution ignorée (nom générique, homonymes indistinguables) : %s", name)
        return ""
    # Préfixe de version : invalide les résolutions mises en cache AVANT chaque
    # durcissement — sinon les mauvais domaines ressortent du cache 30 j malgré le fix.
    # v5→v6 : filtre FR-strict des ccTLD étrangers (horme.it, …) — purge les faux positifs.
    cache_key = f"domain_resolve:v7:{name.lower().strip()}"   # v7 : confirmation titre cœurs courts
    if cache:
        cached = cache.get(cache_key)
        if cached is not None:
            return cached  # peut être "" (résolution négative mise en cache)

    # P1-5 : on borne le coût réseau par entreprise. Avant : jusqu'à 4 variantes
    # × (Clearbit + DDG) → ~8 appels possibles sans plafond temps → blocages
    # observés à plusieurs dizaines de secondes / entreprise. Après : 2 variantes
    # max + plafond global 15 s — au-delà, on retourne "" (mieux qu'un fauf positif).
    domain = ""
    _DEADLINE_SEC = 15.0
    _t0 = time.monotonic()
    variants = _name_resolution_variants(name)[:2]
    for variant in variants:
        if time.monotonic() - _t0 > _DEADLINE_SEC:
            break
        cand = resolve_domain_clearbit(variant, country_hint=country_hint)
        if not cand and time.monotonic() - _t0 < _DEADLINE_SEC:
            cand = resolve_domain_duckduckgo(variant, region_hint, country_hint=country_hint)
        if not cand:
            continue

        # Audit #1 : confirmation par le <title> pour les CŒURS COURTS (≤ 6 lettres).
        # Sur un nom/core court, la similarité est trompeuse (« agora » match agora.io
        # à 100% alors que c'est une AUTRE société ; « ieva » → 2ieval.org sim 0.80).
        # On exige alors que le NOM COMPLET ORIGINAL (pas la variante nettoyée) soit
        # confirmé par le <title> de la home — « GIE AGORA » n'apparaît pas dans le
        # titre d'agora.io → rejet ; un vrai « Nuxit » → nuxit.com est confirmé.
        # Les cœurs longs (≥ 7) restent acceptés sur la seule similarité (fiable).
        core = _domain_core(cand)
        if len(core) <= 6 and not _homepage_title_confirms(name, cand):
            log.debug("résolution rejetée (cœur court non confirmé par titre) : %s → %s", name, cand)
            continue   # tente la variante suivante / abandonne

        domain = cand
        break

    if cache:
        # Cache même les échecs (TTL plus court) pour ne pas re-tenter en boucle
        cache.set(cache_key, domain, ttl=60 * 60 * 24 * (30 if domain else 3))
    return domain


# Prénoms courants (FR + internationaux fréquents en France) : jamais utilisés
# SEULS comme variante de résolution (cf. _name_resolution_variants). Liste volontairement
# compacte — vise les cas dangereux les plus probables, pas l'exhaustivité.
_COMMON_FIRST_NAMES = frozenset({
    "jean", "pierre", "paul", "jacques", "michel", "andre", "philippe", "alain",
    "bernard", "claude", "daniel", "marcel", "robert", "rene", "louis", "henri",
    "georges", "christian", "marc", "olivier", "thierry", "patrick", "nicolas",
    "stephane", "pascal", "laurent", "eric", "david", "frederic", "vincent",
    "francois", "gerard", "julien", "sebastien", "guillaume", "alexandre",
    "antoine", "thomas", "maxime", "florian", "romain", "mathieu", "matthieu",
    "arnaud", "cedric", "bertrand", "yohan", "jonas", "adam", "mohamed", "yanis",
    "marie", "anne", "sophie", "catherine", "isabelle", "sylvie", "nathalie",
    "valerie", "veronique", "sandrine", "celine", "julie", "aurelie", "emilie",
    "camille", "laura", "manon", "lea", "chloe", "sarah", "sara", "virginie",
    "gaelle", "marguerite", "claire", "helene", "christine", "monique",
    "erwan", "yann", "loic", "gwenael", "morgane",
})


def _name_resolution_variants(name: str) -> list[str]:
    """
    Génère des variantes d'un nom d'entreprise pour la résolution de domaine,
    de la plus complète à la plus simple. Permet de résoudre les noms SIRENE
    verbeux où le domaine est sous la marque cœur.

    Ex : "CAPGEMINI TECHNOLOGY SERVICES" → ["CAPGEMINI TECHNOLOGY SERVICES", "Capgemini Technology", "Capgemini"]
         "AKKODIS FRANCE SAS"            → ["AKKODIS FRANCE SAS", "Akkodis"]
         "SNAPDESK (SNAPDESK)"           → ["SNAPDESK (SNAPDESK)", "Snapdesk"]
    """
    variants: list[str] = []
    raw = name.strip()
    if raw:
        variants.append(raw)

    # 1. Retirer le contenu entre parenthèses : "SNAPDESK (SNAPDESK)" → "SNAPDESK"
    no_paren = re.sub(r"\([^)]*\)", "", raw).strip()
    if no_paren and no_paren not in variants:
        variants.append(no_paren)

    # 2. Retirer formes juridiques + suffixes géo/génériques fréquents
    _NOISE = (
        r"\b(sas|sasu|sarl|sa|sci|eurl|snc|gie|gmbh|ltd|inc|llc|corp|co|plc|ag|bv|"
        r"group|groupe|holding|company|technologies?|technology services|services?|"
        r"solutions?|consulting|conseil|informatique|systems?|software|asset management|"
        r"international|france|europe|monde|global|worldwide)\b"
    )
    cleaned = re.sub(_NOISE, "", no_paren, flags=re.IGNORECASE)
    cleaned = re.sub(r"[,\-–]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if cleaned and len(cleaned) >= 2 and cleaned.title() not in variants and cleaned not in variants:
        variants.append(cleaned.title())

    # 3. Marque cœur : les 1-2 premiers mots significatifs (souvent = le domaine)
    words = [w for w in re.split(r"\s+", no_paren) if len(w) > 1]
    if words:
        core1 = words[0].title()
        # Garde-fou : un PRÉNOM seul comme variante (« Stephane », « Pierre ») matche
        # des homonymes célèbres → domaines absurdes/dangereux (Stéphane Auger →
        # auger.com, Pierre Woodman → woodmancastingx.com). On ne l'émet jamais seul.
        if (core1 not in variants and len(core1) >= 3
                and core1.lower() not in _COMMON_FIRST_NAMES):
            variants.append(core1)
        if len(words) >= 2:
            core2 = f"{words[0]} {words[1]}".title()
            if core2 not in variants:
                variants.append(core2)

    # Dédup en préservant l'ordre. P1-5 : plafond ramené 4 → 2 (le caller `resolve_company_domain`
    # tronque déjà à [:2], mais on l'applique aussi ici par cohérence + pour les
    # éventuels appelants directs).
    seen: set[str] = set()
    out: list[str] = []
    for v in variants:
        k = v.lower()
        if k not in seen:
            seen.add(k)
            out.append(v)
        if len(out) >= 2:
            break
    return out


def enrich_domain_resolution(
    companies: list[Company],
    cache: "PersistentCache | None" = None,
    rate_limiter: "RateLimiter | None" = None,
    delay: float = 1.0,
    workers: int = 5,
) -> int:
    """
    Phase 3b (gratuite) : résout le site web des entreprises qui n'en ont pas.
    Indispensable pour les sources annuaire (SIRENE) qui ne donnent que le nom.
    Sans site web → pas de crawl email possible.

    Retourne le nombre de domaines résolus. Modifie les Company in-place.
    """
    need = [c for c in companies if not c.website and c.name]
    if not need:
        return 0

    print(f"\n🌐  Phase 3b : résolution des sites web ({len(need)} entreprises sans domaine)…")
    resolved = 0

    def _resolve(c: Company) -> bool:
        if rate_limiter:
            rate_limiter.wait()
        region_hint = c.city or c.region_admin or ""
        # P2-7 : country_hint dérivé du Company (pas un "fr" hardcodé). Source =
        # le champ `country` issu du scraper (SIRENE → "FR", LinkedIn import →
        # libre, etc.). On normalise iso-2 minuscule ; fallback "fr" si vide
        # (compat ascendante : la quasi-totalité des sources actuelles sont FR).
        ch = (c.country or "").strip().lower()
        if not ch:
            ch = "fr"
        elif len(ch) > 2 and ch in ("france", "france métropolitaine", "français"):
            ch = "fr"
        domain = resolve_company_domain(c.name, region_hint=region_hint,
                                        cache=cache, country_hint=ch)
        if domain:
            c.website = f"https://{domain}"
            return True
        return False

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_resolve, c): c for c in need}
        for fut in concurrent.futures.as_completed(futures):
            c = futures[fut]
            try:
                if fut.result():
                    resolved += 1
                    print(f"   ✔  {c.name[:35]:35s} → {_domain(c.website)}")
            except Exception:
                pass

    print(f"   → {resolved}/{len(need)} sites web résolus")
    return resolved
