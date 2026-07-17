"""
sources — Scrapers de sources de données (job boards + annuaires).

Tous les scrapers héritent de BaseScraper et implémentent search(sector, city, max_results).
Le registre SCRAPERS expose le nom court → la classe (utilisé par pipeline._run_collect).
"""

from __future__ import annotations

import re
import time
from abc import ABC, abstractmethod
from urllib.parse import urlencode

import requests

from .models import Company
from .infra import _retry, RateLimiter, _ThreadSafeFetcher, ProxyPool

# Scrapling StealthyFetcher — utilisé par certains scrapers pour SPAs.
# B2-10 : sys.exit() → ImportError (voir infra.py).
try:
    from scrapling import StealthyFetcher
except ImportError as _scrapling_err:
    raise ImportError(
        "Le package 'scrapling' est requis. "
        "Installez-le : pip install 'scrapling[fetchers]'  (aucun navigateur requis)"
    ) from _scrapling_err


class BaseScraper(ABC):
    name: str = "base"

    # Nombre de pages de résultats consommées PAR RUN quand la pagination
    # progressive est active (option « pages suivantes des sources »). Le curseur
    # persistant avance de ce montant à chaque run → de nouvelles entreprises.
    PAGES_PER_RUN: int = 2

    def __init__(self, fetcher: "_ThreadSafeFetcher | StealthyFetcher", delay: float = 2.0,
                 rate_limiter: "RateLimiter | None" = None,
                 session: "requests.Session | None" = None,
                 page_offset: int = 0,
                 proxy_pool: "ProxyPool | None" = None):
        self.fetcher      = fetcher
        self.delay        = delay
        self.rate_limiter = rate_limiter  # Fix-A : budget global partagé entre scrapers
        # Point 3 : pool de proxies partagé — rotation automatique sur 429/403.
        self._proxy_pool  = proxy_pool
        # Nombre de pages à SAUTER depuis le début (curseur de pagination inter-runs).
        self.page_offset  = max(0, int(page_offset or 0))
        # Compteur de pages de résultats réellement récupérées pendant search()
        # (incrémenté dans _get/_api_get). Lu par le pipeline pour le log.
        self.pages_scanned = 0
        # De combien le curseur de pagination doit avancer pour le PROCHAIN run.
        # 0 = non renseigné → le pipeline retombe sur pages_per_run.
        # SIRENE le renseigne avec le nb de pages RÉELLEMENT consommées par code :
        # si le plafond per_code stoppe à la page 1, on avance d'1 (pas de pages_per_run)
        # → les pages non lues seront scrapées au run suivant au lieu d'être sautées.
        self.pages_advanced = 0

        # Session HTTP pour les appels REST (non-headless).
        # Si non fournie on en crée une propre au scraper — ainsi _api_get() applique
        # toujours le rate limiting via self.rate_limiter, indépendamment du monkey-patch
        # global de run(). Les scrapers restent utilisables en dehors de run() (tests,
        # notebooks) sans perdre le throttling.
        if session is not None:
            self._session = session
        else:
            self._session = requests.Session()
            self._session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})

    @abstractmethod
    def search(self, sector: str, city: str, max_results: int) -> list[Company]:
        ...

    # Fix-5 : timeout headless configurable.
    # Scrapling v0.3 attend des millisecondes (Playwright) — 30 000 ms = 30 s.
    # Sans timeout, une page qui ne répond pas bloque le thread indéfiniment :
    # _retry attend la fin de chaque tentative → 3 × ∞ = blocage.
    FETCH_TIMEOUT: int = 30_000  # ms

    def _get(self, url: str, proxy_pool: "ProxyPool | None" = None):
        """
        Fetche une URL headless avec rate limiting, timeout et retry exponentiel.

        Point 3 — Proxy rotation : si un ProxyPool est fourni, la requête passe
        par le proxy courant. En cas de code de blocage (429/403/…), on rotate et
        on réessaie une fois avant d'abandonner.
        """
        if self.rate_limiter:
            self.rate_limiter.wait()
        self.pages_scanned += 1
        result = _retry(lambda: self.fetcher.get(url, timeout=self.FETCH_TIMEOUT))
        if result is None:
            print(f"   ⚠  [{self.name}] {url} : échec après 3 tentatives")
        return result

    def _api_get(self, url: str, params: "dict | None" = None, timeout: int = 10,
                 proxy_pool: "ProxyPool | None" = None) -> "requests.Response":
        """
        Appel REST GET avec rate limiting explicite.

        Point 3 — Proxy rotation : si proxy_pool fourni (ou self._proxy_pool),
        la requête passe par le proxy courant. Sur 429/403, rotate + retry 1 fois.
        """
        if self.rate_limiter:
            self.rate_limiter.wait()
        self.pages_scanned += 1
        _pool = proxy_pool or self._proxy_pool
        proxies = _pool.requests_dict() if _pool else {}
        try:
            resp = self._session.get(url, params=params, timeout=timeout, proxies=proxies)
            if _pool and _pool.should_rotate(resp.status_code):
                _pool.rotate(reason=f"HTTP {resp.status_code}")
                proxies = _pool.requests_dict()
                resp = self._session.get(url, params=params, timeout=timeout, proxies=proxies)
            return resp
        except Exception:
            if _pool:
                _pool.rotate(reason="exception")
            raise

    def _api_post(self, url: str, json_body: "dict | None" = None, timeout: int = 12,
                  headers: "dict | None" = None,
                  proxy_pool: "ProxyPool | None" = None) -> "requests.Response":
        """
        Appel REST POST JSON avec rate limiting (miroir de _api_get). Pour les sources
        dont l'API de recherche est en POST (ex : APEC rechercheOffre).
        """
        if self.rate_limiter:
            self.rate_limiter.wait()
        self.pages_scanned += 1
        _pool = proxy_pool or self._proxy_pool
        proxies = _pool.requests_dict() if _pool else {}
        hdrs = {"Content-Type": "application/json", "Accept": "application/json"}
        if headers:
            hdrs.update(headers)
        try:
            resp = self._session.post(url, json=json_body, headers=hdrs, timeout=timeout, proxies=proxies)
            if _pool and _pool.should_rotate(resp.status_code):
                _pool.rotate(reason=f"HTTP {resp.status_code}")
                resp = self._session.post(url, json=json_body, headers=hdrs, timeout=timeout, proxies=proxies)
            return resp
        except Exception:
            if _pool:
                _pool.rotate(reason="exception")
            raise

    def _sleep(self):
        """
        Pause inter-pages — respecte le RateLimiter ET le délai utilisateur.

        B1-15 : avant, avec rate_limiter actif, self.delay était ignoré (seul le
        rate_limiter attendait ~0.5 s). L'utilisateur configurait « Délai : 2 s »
        mais chaque page était crawlée toutes les 0.5 s → contrat violé.
        Après : RateLimiter assure le budget global ; time.sleep(delay) assure la
        politesse configurée par l'utilisateur (les deux sont complémentaires).
        """
        if self.rate_limiter:
            self.rate_limiter.wait()
        if self.delay > 0:
            time.sleep(self.delay)


# ── Welcome to the Jungle ─────────────────────────────────────────────────────

class WTTJScraper(BaseScraper):
    name = "wttj"
    PAGES_PER_RUN = 10   # fenêtre de 10 pages d'API ; le curseur avance de 10/run en explore
    API = "https://api.welcometothejungle.com/api/v1"

    def search(self, sector: str, city: str, max_results: int) -> list[Company]:
        """
        WTTJ via son API REST publique (api.welcometothejungle.com/api/v1/organizations).
        L'ancien scraping du listing HTML renvoyait 0 : le site est une SPA React dont la
        recherche (Algolia) est rendue en JS → aucune ancre dans le HTML headless. L'API
        renvoie du JSON fiable, sans anti-bot.

        Elle n'expose PAS de filtre géographique → on filtre la localisation CÔTÉ CLIENT
        sur les `offices`, à la granularité demandée (ville > département > région), en
        gardant les entreprises multi-sites dont AU MOINS un bureau est dans la zone. Le
        site web externe n'est pas fourni par l'API → résolu en Phase 3b (comme ailleurs).
        """
        from .classification import parse_location

        target   = parse_location(city) if city else {}
        t_city   = (target.get("city") or "").lower()
        t_dept   = target.get("dept") or ""
        t_region = (target.get("region") or "").lower()

        companies: list[Company] = []
        seen: set[str] = set()
        for page_num in range(1 + self.page_offset, 1 + self.page_offset + self.PAGES_PER_RUN):
            params = {"query": sector, "page": page_num}
            print(f"   [{self.name}] p{page_num} (API) → {self.API}/organizations?query={sector}&page={page_num}")
            try:
                resp = self._api_get(f"{self.API}/organizations", params=params, timeout=12)
                if resp.status_code != 200:
                    print(f"   ⚠  [{self.name}] HTTP {resp.status_code} — arrêt.")
                    break
                orgs = resp.json().get("organizations", [])
            except Exception as e:
                print(f"   ⚠  [{self.name}] {e}")
                break
            if not orgs:
                break   # plus de résultats

            for org in orgs:
                name = (org.get("name") or "").strip()
                if not name or name.lower() in seen:
                    continue
                loc = self._match_office(org.get("offices") or [], t_city, t_dept, t_region, parse_location)
                if loc is None:
                    continue   # aucun bureau dans la zone demandée (ou hors France)
                seen.add(name.lower())
                sectors = org.get("sectors") or []
                sec = (sectors[0].get("parent_name") or sectors[0].get("name") or "").strip() if sectors else ""
                companies.append(Company(
                    name=name, source=self.name, sector=sec,
                    country=loc.get("country", ""), region_admin=loc.get("region", ""),
                    dept=loc.get("dept", ""), dept_name=loc.get("dept_name", ""),
                    city=loc.get("city", ""),
                ))
                if len(companies) >= max_results:
                    return companies
            self._sleep()
        return companies

    @staticmethod
    def _match_office(offices: list, t_city: str, t_dept: str, t_region: str, parse_location) -> "dict | None":
        """
        Localisation structurée d'un bureau correspondant à la zone demandée, ou None si
        aucun ne correspond. Sans zone demandée → le siège (ou le 1er bureau), France
        uniquement. Une entreprise multi-sites est conservée si l'UN de ses bureaux est
        dans la zone (ex : siège à Lille mais agence à Lyon → gardée pour Auvergne-Rhône-Alpes).
        """
        want_zone = bool(t_city or t_dept or t_region)

        def _loc(off: dict) -> dict:
            zip_code = str(off.get("zip_code") or "").strip()
            cc = (off.get("country_code") or "").upper()
            dept = ""
            if cc == "FR" and len(zip_code) >= 2:
                dept = zip_code[:3] if zip_code.startswith(("97", "98")) else zip_code[:2]
            parsed = parse_location((off.get("city") or ""), explicit_dept=dept)
            return {
                "country":   "France" if cc == "FR" else (cc or parsed.get("country", "")),
                "region":    parsed.get("region", ""),
                "dept":      dept or parsed.get("dept", ""),
                "dept_name": parsed.get("dept_name", ""),
                "city":      (off.get("city") or parsed.get("city", "")).strip(),
            }

        def _matches(loc: dict) -> bool:
            if loc.get("country") and loc["country"] != "France":
                return False
            if t_city:
                return t_city in (loc.get("city") or "").lower()
            if t_dept:
                return (loc.get("dept") or "") == t_dept
            if t_region:
                return (loc.get("region") or "").lower() == t_region
            return True

        if not offices:
            # Pas de bureau listé → impossible de filtrer. Si une zone est demandée, on
            # écarte (ne pas polluer la région avec des boîtes de lieu inconnu).
            return None if want_zone else {}

        if not want_zone:
            hq = next((o for o in offices if o.get("is_headquarter")), offices[0])
            loc = _loc(hq)
            return loc if loc.get("country", "France") == "France" else None

        for off in offices:
            loc = _loc(off)
            if _matches(loc):
                return loc
        return None


# ── Indeed France ──────────────────────────────────────────────────────────────

class IndeedScraper(BaseScraper):
    name = "indeed"
    PAGES_PER_RUN = 10
    SEARCH = "https://fr.indeed.com/emplois"

    def search(self, sector: str, city: str, max_results: int) -> list[Company]:
        """
        Scrape les offres Indeed (jusqu'à 10 pages × 10 résultats).
        Extrait le nom d'entreprise, le site web (si affiché) et la fraîcheur
        depuis l'ancienneté de l'offre. Déduplique par nom.

        Pagination : step de 10 (taille réelle d'une page Indeed FR).
        Stop après 2 pages consécutives sans nouveau résultat — évite de
        s'arrêter à tort quand Indeed renvoie une page intermédiaire vide.
        """
        companies: list[Company] = []
        seen: set[str] = set()
        consecutive_empty = 0

        for page_num in range(self.page_offset, self.page_offset + self.PAGES_PER_RUN):
            params = {"q": sector, "l": city, "start": page_num * 10}
            url = f"{self.SEARCH}?{urlencode(params)}"
            print(f"   [{self.name}] p{page_num + 1} → {url}")
            page = self._get(url)
            if page is None:
                # Point #13 : Indeed est protégé par Cloudflare et bloque souvent
                # le scraping headless. Échec dès la 1re page = très probablement
                # un blocage, pas une absence d'offres → on guide l'utilisateur.
                if page_num == 0:
                    print("   ℹ  [indeed] page 1 inaccessible (probable blocage Cloudflare). "
                          "Astuce : crée une alerte email Indeed et active la source "
                          "« Alertes email 📬 » — bien plus fiable.")
                break

            found = 0
            for el in page.css("[data-testid='company-name'], .companyName, span[class*='company']"):
                name = el.text.strip()
                if not name or name in seen:
                    continue
                # Filtre les faux positifs : Indeed injecte parfois le terme de
                # recherche dans un span[class*='company'] — pas un vrai nom d'entreprise.
                if name.lower() == sector.lower():
                    continue
                seen.add(name)

                website = ""
                parent = el.parent
                if parent:
                    for a in parent.css("a[href*='http']"):
                        href = a.attrib.get("href", "")
                        if "indeed" not in href:
                            website = href
                            break

                # Fraîcheur depuis l'ancienneté de l'offre
                freshness = 0
                date_el = el.parent.css_first("[class*='date']") if el.parent else None
                if date_el:
                    t = date_el.text.lower()
                    if "aujourd" in t or "heure" in t:
                        freshness = 100
                    elif "hier" in t or "1 jour" in t:
                        freshness = 90
                    elif re.search(r'(\d+)', t):
                        d = int(re.search(r'(\d+)', t).group(1))
                        freshness = max(0, 100 - d * 5)

                # Localisation
                loc_el = el.parent.css_first("[data-testid='text-job-location']") if el.parent else None
                region = loc_el.text.strip() if loc_el else city

                companies.append(Company(
                    name=name, website=website, region=region,
                    freshness_score=freshness, source=self.name,
                ))
                found += 1
                if len(companies) >= max_results:
                    return companies

            if found == 0:
                consecutive_empty += 1
                if consecutive_empty >= 2:
                    break  # 2 pages vides consécutives = fin des résultats Indeed
            else:
                consecutive_empty = 0
            self._sleep()
        return companies


# ── APEC ───────────────────────────────────────────────────────────────────────

class APECScraper(BaseScraper):
    """
    APEC — emploi cadre (data, finance, ingénierie). Via son API REST de recherche
    d'offres (POST /cms/webservices/rechercheOffre) : JSON fiable, sans headless.
    L'ancien scraping HTML (cartes .card-offer rendues en JS) renvoyait 0.
    """
    name = "apec"
    API = "https://www.apec.fr/cms/webservices/rechercheOffre"
    PAGE_SIZE = 50   # offres par page d'API

    def search(self, sector: str, city: str, max_results: int) -> list[Company]:
        """
        Interroge l'API APEC. Chaque offre porte `nomCommercial` (entreprise),
        `lieuTexte` ("Lyon 01 - 69" → ville + dépt) et `offreConfidentielle`. On filtre
        la zone CÔTÉ CLIENT (région > dépt > ville) et on ÉCARTE les offres confidentielles
        (pas d'entreprise réelle à qui candidater). Site web non fourni → Phase 3b.
        """
        from .classification import parse_location

        target   = parse_location(city) if city else {}
        t_city   = (target.get("city") or "").lower()
        t_dept   = target.get("dept") or ""
        t_region = (target.get("region") or "").lower()
        want_zone = bool(t_city or t_dept or t_region)
        referer = {"Referer": "https://www.apec.fr/candidat/recherche-emploi.html"}

        companies: list[Company] = []
        seen: set[str] = set()
        for page in range(self.page_offset, self.page_offset + self.PAGES_PER_RUN):
            payload = {
                "motsCles": sector,
                "pagination": {"startIndex": page * self.PAGE_SIZE, "range": self.PAGE_SIZE},
                "sorts": [{"type": "DATE", "direction": "DESCENDING"}],
            }
            print(f"   [{self.name}] p{page + 1} (API) → rechercheOffre startIndex={page * self.PAGE_SIZE}")
            try:
                resp = self._api_post(self.API, json_body=payload, headers=referer)
                if resp.status_code != 200:
                    print(f"   ⚠  [{self.name}] HTTP {resp.status_code} — arrêt.")
                    break
                offres = resp.json().get("resultats", [])
            except Exception as e:
                print(f"   ⚠  [{self.name}] {e}")
                break
            if not offres:
                break

            for o in offres:
                name = (o.get("nomCommercial") or "").strip()
                if not name or o.get("offreConfidentielle") or name.lower() in seen:
                    continue
                loc = self._loc_from_lieu(o.get("lieuTexte") or "", parse_location)
                if want_zone and not self._loc_matches(loc, t_city, t_dept, t_region):
                    continue
                seen.add(name.lower())
                # secteurActivite d'APEC = ID numérique (pas un libellé) → on laisse
                # sector vide, le pipeline le normalisera via classify_sector.
                companies.append(Company(
                    name=name, source=self.name,
                    country="France", region_admin=loc.get("region", ""),
                    dept=loc.get("dept", ""), dept_name=loc.get("dept_name", ""),
                    city=loc.get("city", ""), freshness_score=70,
                ))
                if len(companies) >= max_results:
                    return companies
            self._sleep()
        return companies

    @staticmethod
    def _loc_from_lieu(lieu: str, parse_location) -> dict:
        """Parse le lieuTexte APEC ("Lyon 01 - 69") → {region, dept, dept_name, city}."""
        m = re.search(r'-\s*(\d{2,3}[AB]?)\s*$', lieu)
        dept = m.group(1) if m else ""
        city = re.sub(r'\s*-\s*\d{2,3}[AB]?\s*$', '', lieu).strip()
        parsed = parse_location(city, explicit_dept=dept) if (city or dept) else {}
        return {
            "region":    parsed.get("region", ""),
            "dept":      dept or parsed.get("dept", ""),
            "dept_name": parsed.get("dept_name", ""),
            "city":      city or parsed.get("city", ""),
        }

    @staticmethod
    def _loc_matches(loc: dict, t_city: str, t_dept: str, t_region: str) -> bool:
        if t_city:
            return t_city in (loc.get("city") or "").lower()
        if t_dept:
            return (loc.get("dept") or "") == t_dept
        if t_region:
            return (loc.get("region") or "").lower() == t_region
        return True


# ── Cadremploi ─────────────────────────────────────────────────────────────────

class CadremploiScraper(BaseScraper):
    """
    Cadremploi — job board cadres, très bien référencé pour data/finance/conseil.
    """
    name = "cadremploi"
    SEARCH = "https://www.cadremploi.fr/emploi/liste_offres.html"

    def search(self, sector: str, city: str, max_results: int) -> list[Company]:
        """
        Scrape une page Cadremploi (offres cadres — data, finance, conseil).
        Extrait nom, site, région et fraîcheur. Déduplique par nom.
        """
        companies: list[Company] = []
        seen: set[str] = set()

        params = {
            "motcle": sector,
            "lieuTravail": city,
            "nbOffres": "30",
        }
        url = f"{self.SEARCH}?{urlencode(params)}"
        print(f"   [{self.name}] → {url}")
        page = self._get(url)
        if page is None:
            return companies

        for card in page.css(".c-job-offer, [class*='job-card'], [class*='offer-item'], article"):
            name_el = card.css_first("[class*='company'], [class*='entreprise'], .company")
            name = name_el.text.strip() if name_el else ""
            if not name or name in seen:
                continue
            seen.add(name)

            website = ""
            for a in card.css("a[href*='http']"):
                href = a.attrib.get("href", "")
                if "cadremploi" not in href:
                    website = href
                    break

            loc_el = card.css_first("[class*='location'], [class*='lieu'], [class*='city']")
            region = loc_el.text.strip() if loc_el else city

            freshness = 0
            date_el = card.css_first("time, [class*='date'], [class*='published']")
            if date_el:
                t = date_el.text.lower()
                if "aujourd" in t or "heure" in t:
                    freshness = 100
                elif "hier" in t:
                    freshness = 90
                elif re.search(r'(\d+)\s*jour', t):
                    days = int(re.search(r'(\d+)\s*jour', t).group(1))
                    freshness = max(0, 100 - days * 4)

            companies.append(Company(
                name=name, website=website, region=region,
                freshness_score=freshness, source=self.name,
            ))
            if len(companies) >= max_results:
                return companies
        return companies


# ── Société.com / SIRENE (API gouvernementale) ────────────────────────────────

class SocieteScraper(BaseScraper):
    """
    API Recherche Entreprises — registre SIRENE officiel du gouvernement français.
    https://recherche-entreprises.api.gouv.fr/

    Avantages :
      - Toutes les entreprises françaises actives, même sans offre d'emploi
      - Classement par code NAF (secteur d'activité officiel)
      - 100 % gratuit, pas de clé API, aucun risque de blocage
      - Retourne la taille de l'entreprise (tranche d'effectif)

    Limite : ne fournit pas le site web — le web crawler (Phase 4) et Hunter.io
    (Phase 5) s'en chargent ensuite.
    """
    name = "societe"
    API = "https://recherche-entreprises.api.gouv.fr/search"

    # Mapping secteur/industrie → codes NAF (APE) les plus courants.
    # Un seul mot-clé peut correspondre à plusieurs codes.
    # Format requis par l'API : "XX.XXZ" (point après les 2 premiers chiffres)
    SECTOR_NAF: dict[str, list[str]] = {
        "finance":       ["64.19Z","64.99Z","66.12Z","66.19B","66.22Z","66.30Z","64.11Z"],
        "banque":        ["64.11Z","64.19Z","64.92Z","64.99Z"],
        "assurance":     ["65.11Z","65.12Z","65.20Z","66.22Z"],
        "tech":          ["62.01Z","62.02A","63.11Z","63.12Z","62.09Z","63.99Z"],
        # ÉDITEURS DE LOGICIELS/SaaS : 58.29C (édition de logiciels applicatifs), 58.29A
        # (systèmes/réseaux), 58.21Z (jeux) = le cœur « produit logiciel », distinct des
        # SSII/prestataires en 62.xx. Sans eux, « Logiciel/SaaS » ne ramenait que des
        # prestataires IT génériques (mêmes codes que « tech »).
        "saas":          ["58.29C","58.29A","62.01Z","62.02A","63.11Z","63.12Z"],
        "logiciel":      ["58.29C","58.29A","58.21Z","62.01Z","62.02A","62.03Z","62.09Z"],
        "data":          ["63.11Z","63.12Z","62.01Z","72.11Z"],
        # R&D / Ingénierie : recherche (72.11Z biotech, 72.19Z autres sciences) et
        # ingénierie/études techniques (71.12B, 71.20B). Le classifieur les étiquette
        # « R&D » (division 72) et « Ingénierie / R&D » (division 71).
        "rd":            ["72.11Z","72.19Z","71.12B","71.20B"],
        "conseil":       ["70.22Z","70.21Z","70.10Z","69.20Z"],
        "consulting":    ["70.22Z","70.21Z","70.10Z"],
        "audit":         ["69.20Z","71.12B","70.22Z"],
        "industrie":     ["24.10Z","25.11Z","25.61Z","25.62B","28.29A","30.11Z"],
        "energie":       ["35.11Z","35.12Z","35.13Z","35.14Z","35.21Z","06.10Z"],
        "retail":        ["47.11A","47.11B","47.19A","47.71Z","47.79Z"],
        "ecommerce":     ["47.91A","47.91B","47.79Z"],
        "logistique":    ["49.41A","52.10A","52.21Z","52.29A","53.10Z"],
        "transport":     ["49.41A","49.42Z","51.10Z","51.21Z","49.10Z"],
        "sante":         ["86.10Z","86.21Z","86.90A","72.11Z","21.10Z"],
        "pharma":        ["21.10Z","21.20Z","72.11Z","72.19Z"],
        "immobilier":    ["68.10Z","68.20A","68.31Z","68.32A"],
        "media":         ["59.11A","59.12Z","60.20A","73.11Z","58.13Z"],
        "btp":           ["41.10A","41.10B","41.20A","42.11Z","42.13A"],
        "education":     ["85.20Z","85.31Z","85.32Z","85.41Z","85.42Z"],
        "restauration":  ["56.10A","56.10B","56.21Z","56.29A"],
        "hotel":         ["55.10Z","55.20Z","55.90Z"],
        "agriculture":   ["01.11Z","01.12Z","01.13Z","01.19Z","01.21Z"],
    }

    # Mapping ville/région → code département (pour filtrer géographiquement)
    DEPT_MAP: dict[str, str] = {
        "paris": "75", "île-de-france": "75", "idf": "75", "ile-de-france": "75",
        "hauts-de-seine": "92", "val-de-marne": "94", "seine-saint-denis": "93",
        "essonne": "91", "yvelines": "78", "val-d'oise": "95",
        "lyon": "69", "marseille": "13", "toulouse": "31", "bordeaux": "33",
        "nantes": "44", "strasbourg": "67", "lille": "59", "nice": "06",
        "rennes": "35", "montpellier": "34", "grenoble": "38", "rouen": "76",
        "toulon": "83", "reims": "51", "saint-étienne": "42", "dijon": "21",
    }

    # Point D (audit) : codes INSEE de région (filtre API `region`). Permet de
    # cibler TOUTE une région (ex. Auvergne-Rhône-Alpes = 84 → 12 départements)
    # au lieu de renvoyer la France entière faute de correspondance. Clés
    # normalisées (sans accent, séparateurs en espaces).
    REGION_INSEE: dict[str, str] = {
        "auvergne rhone alpes": "84", "ara": "84",
        "bourgogne franche comte": "27",
        "bretagne": "53",
        "centre val de loire": "24",
        "corse": "94",
        "grand est": "44", "alsace": "44", "lorraine": "44", "champagne ardenne": "44",
        "hauts de france": "32", "nord pas de calais": "32", "picardie": "32",
        "ile de france": "11", "idf": "11",
        "normandie": "28",
        "nouvelle aquitaine": "75", "aquitaine": "75", "limousin": "75", "poitou charentes": "75",
        "occitanie": "76", "languedoc roussillon": "76", "midi pyrenees": "76",
        "pays de la loire": "52",
        "provence alpes cote d azur": "93", "paca": "93",
    }

    # Codes INSEE de tranche d'effectif par cible de taille (filtre API
    # `tranche_effectif_salarie`). Cibler des PME = bien plus d'emails publics
    # (les grands groupes n'exposent que des formulaires).
    SIZE_TRANCHES: dict[str, list[str]] = {
        # PME inclut désormais les TPE/micro (NN = non employeuse, 00–03 = 0–9 sal.)
        # → ce sont justement celles qui publient le plus souvent un email direct.
        "pme":   ["NN", "00", "01", "02", "03", "11", "12", "21", "22", "31"],  # 0–249 salariés
        "eti":   ["32", "41", "42", "51"],                # 250–4999
        "grand": ["52", "53"],                            # 5000+
    }

    # B2-14 : PAGES_PER_RUN = 1 signifie « on avance d'1 page PAR code NAF par run ».
    # Avec 6 codes NAF, un run consomme réellement 6 pages de résultats SIRENE.
    # Le curseur inter-runs est géré par `page_offset` (voir _run_collect).
    # Valeur 1 est intentionnelle : SIRENE est l'annuaire DE RÉFÉRENCE des PME FR,
    # mieux vaut une couverture progressive/profonde qu'un balayage large/superficiel.
    PAGES_PER_RUN = 1

    def __init__(self, fetcher, delay: float = 2.0, rate_limiter=None,
                 session=None, size_target: str = "all", page_offset: int = 0,
                 proxy_pool=None):
        super().__init__(fetcher, delay, rate_limiter=rate_limiter, session=session,
                         page_offset=page_offset, proxy_pool=proxy_pool)
        # Codes de tranche à filtrer (vide = toutes tailles).
        self.size_target = (size_target or "all").lower()
        self.size_codes = self.SIZE_TRANCHES.get(self.size_target, [])
        # Compteur de personnes physiques (auto-entrepreneurs) écartées ce run.
        self._dropped_pp = 0

    def _size_lbl(self) -> str:
        """Suffixe de log confirmant le filtre taille + personnes physiques écartées."""
        parts = []
        if self.size_codes:
            parts.append(f"taille : {self.size_target} → tranches {','.join(self.size_codes)}")
        if self._dropped_pp:
            parts.append(f"{self._dropped_pp} auto-entrepreneur(s) écarté(s)")
        return f"  [{' ; '.join(parts)}]" if parts else ""

    @staticmethod
    def _norm_geo(s: str) -> str:
        """Normalise un libellé géo : minuscule, sans accent, séparateurs → espaces."""
        s = (s or "").lower().strip()
        for a, b in [("é","e"),("è","e"),("ê","e"),("ë","e"),("à","a"),("â","a"),
                     ("î","i"),("ï","i"),("ô","o"),("ö","o"),("ù","u"),("û","u"),("ç","c")]:
            s = s.replace(a, b)
        s = re.sub(r"[^a-z0-9 ]", " ", s)
        return re.sub(r"\s+", " ", s).strip()

    def _geo_params(self, city: str) -> dict:
        """
        Traduit une saisie géo (ville, département OU région) en filtre API.
        Priorité : région INSEE (couvre tous ses départements) > département/ville.
        Retourne {'region': '84'} ou {'departement': '69'} ou {} (national).
        """
        norm = self._norm_geo(city)
        if norm:
            # 1. Nom de DÉPARTEMENT d'abord (ex. « Isère »→38, « Rhône »→69).
            #    AVANT la région : sinon « rhone » serait capté comme sous-chaîne
            #    de « auvergne rhone alpes » et classé région à tort.
            dept_code = self._dept_name_to_code(norm)
            if dept_code:
                return {"departement": dept_code}
            # 2. Région : correspondance exacte / sous-chaîne.
            for key, code in self.REGION_INSEE.items():
                if key in norm or norm in key:
                    return {"region": code}
            # 3. Région FLOUE — tolère les fautes (« …rhone aples » → « …alpes »).
            from difflib import SequenceMatcher
            nf = norm.replace(" ", "")
            best_code, best_ratio = "", 0.0
            for key, code in self.REGION_INSEE.items():
                ratio = SequenceMatcher(None, nf, key.replace(" ", "")).ratio()
                if ratio > best_ratio:
                    best_code, best_ratio = code, ratio
            if best_ratio >= 0.82:
                return {"region": best_code}
        dept = self._city_to_dept(city)
        return {"departement": dept} if dept else {}

    # Table {nom normalisé de département → code}, construite une fois depuis
    # classification._DEPT_NAMES (source officielle code→nom).
    _DEPT_NAME_TO_CODE: "dict[str, str] | None" = None

    @classmethod
    def _dept_name_to_code(cls, norm_name: str) -> str:
        if cls._DEPT_NAME_TO_CODE is None:
            from .classification import _DEPT_NAMES
            cls._DEPT_NAME_TO_CODE = {
                cls._norm_geo(name): code for code, name in _DEPT_NAMES.items()
            }
        return cls._DEPT_NAME_TO_CODE.get(norm_name, "")

    def search(self, sector: str, city: str, max_results: int) -> list[Company]:
        """
        Interroge l'API SIRENE (registre officiel des entreprises françaises).
        1. Résout le secteur en codes NAF pour un ciblage précis par activité.
        2. Fallback : recherche textuelle si aucun code NAF ne correspond.
        Retourne jusqu'à ``max_results`` entreprises actives dans le département.
        """
        sector_lower = sector.lower().strip()
        geo = self._geo_params(city)  # {'region': …} | {'departement': …} | {}

        # Garde-fou : une ville saisie mais NON résolue → recherche nationale silencieuse
        # (cause classique d'un « run qui ne récolte rien » : SIRENE renvoie la France
        # entière, puis skip-no-email + dédup vident le résultat). On le signale fort.
        if city and city.strip() and not geo:
            print(f"   ⚠  [{self.name}] ville « {city} » non résolue en département/région "
                  f"→ recherche NATIONALE (résultats hors zone, souvent ~0 après filtrage). "
                  f"Essaie le département (« Haute-Savoie ») ou la région (« Auvergne-Rhône-Alpes »).")

        # Résoudre les codes NAF correspondant au secteur.
        # sector_lower peut être une liste CSV ("industrie,energie,btp") quand
        # l'utilisateur a sélectionné plusieurs secteurs dans l'UI — on collecte
        # alors les codes NAF de TOUS les secteurs matchants (pas de break).
        naf_codes: list[str] = []
        _seen_naf: set[str] = set()
        for key, codes in self.SECTOR_NAF.items():
            if key in sector_lower:
                for code in codes:
                    if code not in _seen_naf:
                        _seen_naf.add(code)
                        naf_codes.append(code)

        companies: list[Company] = []
        if naf_codes:
            per_code = max(max_results // max(len(naf_codes), 1), 5)
            for naf in naf_codes:
                batch = self._fetch_naf(naf, geo, per_code)
                for c in batch:
                    if len(companies) >= max_results:
                        break
                    companies.append(c)
                if len(companies) >= max_results:
                    break
            if companies:
                _geo_lbl = geo.get("region") and f"région {geo['region']}" or geo.get("departement") and f"dépt {geo['departement']}" or "national"
                print(f"   [{self.name}] {len(companies)} entreprises — NAF : {', '.join(naf_codes[:3])}… ({_geo_lbl}){self._size_lbl()}")
        else:
            # Fallback : recherche textuelle sur le nom/raison sociale
            companies = self._fetch_text(sector, geo, max_results)
            print(f"   [{self.name}] {len(companies)} entreprises — recherche texte « {sector} »{self._size_lbl()}")

        return companies[:max_results]

    # Cache commune normalisée → code département (résolu via geo.api.gouv.fr).
    # "" mémorise aussi un échec pour ne pas re-tenter le réseau à chaque code NAF.
    _COMMUNE_DEPT_CACHE: "dict[str, str]" = {}
    GEO_API = "https://geo.api.gouv.fr/communes"

    def _commune_to_dept(self, city: str) -> str:
        """
        Résout N'IMPORTE quelle commune française → code département via l'API géo
        officielle (gratuite, sans clé). Remplace la dépendance à DEPT_MAP (table figée
        d'une trentaine de villes) qui faisait silencieusement retomber toute ville non
        listée (Annecy→74, Chambéry→73, Valence→26…) sur une recherche NATIONALE.
        Résultat caché (succès ET échec). Best-effort : jamais d'exception propagée.
        """
        norm = self._norm_geo(city)
        if not norm:
            return ""
        if norm in self._COMMUNE_DEPT_CACHE:
            return self._COMMUNE_DEPT_CACHE[norm]
        dept = ""
        try:
            resp = self._api_get(
                self.GEO_API,
                params={"nom": city, "fields": "codeDepartement",
                        "limit": 1, "boost": "population"},
                timeout=8,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data:
                    dept = (data[0].get("codeDepartement") or "").strip()
        except Exception as e:
            print(f"   ⚠  [{self.name}] résolution géo « {city} » échouée : {e}")
        self._COMMUNE_DEPT_CACHE[norm] = dept
        return dept

    def _city_to_dept(self, city: str) -> str:
        city_lower = city.lower().strip()
        for key, dept in self.DEPT_MAP.items():
            if key in city_lower or city_lower in key:
                return dept
        # Essaie le code postal si présent dans city
        m = re.search(r'\b(0[1-9]|[1-9]\d)\d{3}\b', city)
        if m:
            return m.group(0)[:2]
        # Repli robuste : toute commune FR via l'API géo (Annecy, Chambéry, Valence…).
        return self._commune_to_dept(city)

    def _fetch_naf(self, naf: str, geo: dict, limit: int) -> list[Company]:
        """Interroge SIRENE pour un code NAF sur PAGES_PER_RUN pages consécutives.

        PAGES_PER_RUN contrôle le nombre de pages lues dans ce run (valeur
        configurable depuis l'UI via cfg.pages_per_run). page_offset = page de
        départ (curseur inter-runs géré par le pipeline).
        """
        results: list[Company] = []
        pages_consumed = 0   # pages réellement lues pour CE code NAF ce run
        for p in range(self.page_offset, self.page_offset + self.PAGES_PER_RUN):
            params: dict = {
                "activite_principale": naf,
                "per_page": min(limit, 25),
                "page": 1 + p,
                "etat_administratif": "A",
            }
            params.update(geo or {})
            if self.size_codes:
                params["tranche_effectif_salarie"] = ",".join(self.size_codes)
            batch = self._do_request(params, naf)
            if not batch:
                break   # page vide = source épuisée, on arrête
            pages_consumed += 1
            results.extend(batch)
            if len(results) >= limit:
                break   # plafond per_code atteint → pages suivantes lues au run d'après
        # Curseur : avance du nb de pages réellement consommées (le plus grand sur
        # tous les codes). Si le plafond a coupé à la page 1, on n'avance que d'1 →
        # les pages 2,3… non lues seront scrapées au prochain run (pas sautées).
        self.pages_advanced = max(self.pages_advanced, pages_consumed)
        return results[:limit]

    def _fetch_text(self, query: str, geo: dict, limit: int) -> list[Company]:
        params: dict = {
            "q": query,
            "per_page": min(limit, 25),
            "etat_administratif": "A",
        }
        params.update(geo or {})
        if self.size_codes:
            params["tranche_effectif_salarie"] = ",".join(self.size_codes)
        return self._do_request(params, "")

    # SIRENE (recherche-entreprises.api.gouv.fr) limite le débit et renvoie 429 sous charge
    # (surtout avec plusieurs codes NAF par run). On réessaie alors, en respectant l'en-tête
    # Retry-After quand il est fourni, avec un back-off croissant plafonné. Sans ce retry, un
    # code NAF 429 était simplement SAUTÉ → des leads (ex. pharma) manquaient silencieusement.
    _MAX_429_RETRIES = 3

    def _do_request(self, params: dict, naf_hint: str) -> list[Company]:
        for attempt in range(self._MAX_429_RETRIES + 1):
            try:
                resp = self._api_get(self.API, params=params)
            except Exception as e:
                print(f"   ⚠  [{self.name}] {e}")
                return []

            if resp.status_code == 429 and attempt < self._MAX_429_RETRIES:
                try:
                    wait = float(resp.headers.get("Retry-After", ""))
                except (TypeError, ValueError):
                    wait = 0.0
                # Borne : au moins un back-off croissant, au plus 10 s (jamais de gel long).
                wait = min(max(wait, 1.5 * (attempt + 1)), 10.0)
                print(f"   ⏳  [{self.name}] HTTP 429 (NAF {naf_hint}) — nouvelle tentative "
                      f"dans {wait:.0f}s ({attempt + 1}/{self._MAX_429_RETRIES})")
                time.sleep(wait)
                continue

            if resp.status_code != 200:
                # Affiche le motif renvoyé par l'API (ex. « code NAF non valide ») —
                # diagnostic indispensable : un simple « HTTP 400 » masquait la cause.
                detail = ""
                try:
                    detail = (resp.json().get("erreur") or "")[:160]
                except Exception:
                    detail = resp.text[:160]
                print(f"   ⚠  [{self.name}] HTTP {resp.status_code} (NAF {naf_hint}) : {detail}")
                return []

            # On écarte les PERSONNES PHYSIQUES (nature_juridique 1000 = entrepreneur
            # individuel). Leur « nom » est un nom de personne (ex. STEPHANE LOTITO) :
            # aucun site corporate → la résolution de domaine fabrique des faux
            # dangereux (auger.com, woodmancastingx.com…) et on ne peut pas y postuler.
            try:
                results = resp.json().get("results", [])
            except Exception as e:
                print(f"   ⚠  [{self.name}] réponse illisible (NAF {naf_hint}) : {e}")
                return []
            companies = []
            for r in results:
                if (r.get("nature_juridique") or "").strip() == "1000":
                    self._dropped_pp += 1
                    continue
                companies.append(self._to_company(r, naf_hint))
            return companies

        # Épuisé les tentatives sur 429 → on abandonne ce code NAF proprement (sera réessayé
        # au prochain run par le curseur de pagination).
        print(f"   ⚠  [{self.name}] HTTP 429 persistant (NAF {naf_hint}) — code sauté ce run.")
        return []

    @staticmethod
    def _cp_to_dept(code_postal: str) -> str:
        """
        Déduit le code département du code postal.
        DOM-TOM (971-976) → 3 chiffres ; Corse (20xxx) → 2A/2B ; sinon 2 premiers chiffres.
        Nécessaire car `matching_etablissements` ne renvoie pas le champ `departement`.
        """
        cp = (code_postal or "").strip()
        if not cp[:2].isdigit():
            return ""
        if cp.startswith(("97", "98")):
            return cp[:3]                       # Guadeloupe 971, Réunion 974, etc.
        if cp.startswith("20"):                 # Corse : pas de département "20"
            try:
                return "2A" if int(cp[:5]) < 20200 else "2B"
            except ValueError:
                return "2A"
        return cp[:2]

    def _pick_establishment(self, r: dict) -> dict:
        """
        Choisit l'établissement le plus pertinent pour la localisation.

        SCRAPE-LOC fix : on veut la FILIALE/AGENCE qui a matché le filtre géographique
        (ex. l'agence Lyon), PAS le siège social parisien. L'API expose ce(s) match(s)
        dans `matching_etablissements`. On préfère :
          1. un établissement actif (etat_administratif == 'A')
          2. à défaut, le premier match
          3. en dernier recours, le siège (aucun matching disponible).
        """
        matches = r.get("matching_etablissements") or []
        if matches:
            actifs = [m for m in matches if (m.get("etat_administratif") or "").upper() == "A"]
            return (actifs or matches)[0]
        return r.get("siege") or {}

    def _to_company(self, r: dict, naf_hint: str) -> Company:
        """Convertit un résultat brut de l'API SIRENE en Company. Site web laissé vide — sera enrichi Phase 4/5."""
        name = (r.get("nom_complet") or r.get("nom_raison_sociale") or "").strip()

        # On prend l'établissement qui a matché la recherche géographique (filiale/agence),
        # pas le siège social — sinon une agence lyonnaise serait étiquetée « Paris ».
        etab = self._pick_establishment(r)

        commune  = etab.get("libelle_commune") or ""
        # `departement` est souvent absent sur matching_etablissements → on le déduit du CP.
        dept_str = etab.get("departement") or self._cp_to_dept(etab.get("code_postal") or "")
        region   = f"{commune} ({dept_str})" if dept_str else commune

        naf         = r.get("activite_principale") or naf_hint
        activity    = self._naf_label(naf)
        tranche     = r.get("tranche_effectif_salarie") or ""
        company_size = self._tranche_size(tranche)

        # Classification normalisée — buckets standard + secteur lisible.
        from .classification import normalize_company_size, classify_sector, _DEPT_TO_REGION, _DEPT_NAMES
        size_bucket = normalize_company_size(tranche) or normalize_company_size(company_size)
        sector      = classify_sector(naf, activity)

        # Location structurée : SIRENE expose explicitement commune + département.
        # Pays = France (registre français). Région + nom département déduits du code.
        dept_clean   = dept_str.upper().zfill(2) if dept_str.isdigit() else dept_str.upper()
        region_admin = _DEPT_TO_REGION.get(dept_clean, "")
        dept_label   = _DEPT_NAMES.get(dept_clean, "")

        # Pas de site web dans le registre — sera enrichi en Phase 4/5
        # On tente un guess basique pour donner une base au web crawler.
        website = self._guess_website(name)

        return Company(
            name=name,
            website=website,
            region=region,
            country="France",
            region_admin=region_admin,
            dept=dept_clean,
            dept_name=dept_label,
            city=commune.title() if commune else "",
            activity_domain=activity,
            sector=sector,
            company_size=company_size,
            company_size_bucket=size_bucket,
            source=self.name,
        )

    @staticmethod
    def _guess_website(name: str) -> str:
        """
        FIX-6 : retourne toujours "" — le slug deviné générait trop de faux positifs
        (ex. "BNP Paribas" → https://www.bnpparibas.fr qui peut appartenir à quelqu'un d'autre).
        Le web crawler ne tentera pas de crawl sur une URL non vérifiée.
        """
        return ""  # noqa: SIM910 — intentionnel

    @staticmethod
    def _naf_label(naf: str) -> str:
        PREFIX = {
            "64": "Finance / Banque",  "65": "Assurance",
            "62": "Logiciels / IT",    "63": "Données / Web",
            "70": "Conseil",           "72": "R&D",
            "47": "Commerce détail",   "46": "Commerce gros",
            "49": "Transport",         "52": "Logistique",
            "86": "Santé",             "21": "Pharmacie",
            "41": "Construction",      "35": "Énergie",
            "59": "Audiovisuel",       "85": "Éducation",
        }
        return PREFIX.get(naf[:2], naf) if len(naf) >= 2 else naf

    @staticmethod
    def _tranche_size(t: str) -> str:
        return {
            "00":"0","01":"1-2","02":"3-5","03":"6-9",
            "11":"10-19","12":"20-49","21":"50-99",
            "22":"100-199","31":"200-249","32":"250-499",
            "41":"500-999","42":"1000-1999","51":"2000-4999",
            "52":"5000-9999","53":"10000+",
        }.get(str(t).strip(), "")


# ── Pappers ────────────────────────────────────────────────────────────────────

class PappersScraper(BaseScraper):
    """
    Pappers.fr — registre SIRENE enrichi avec noms des DIRIGEANTS.
    Contrairement à SIRENE seul, Pappers expose le prénom+nom du gérant/DG,
    ce qui permet de construire un email personnalisé (jean.dupont@acme.fr).

    API gratuite : 500 req/mois après inscription sur https://www.pappers.fr/api
    Clé à passer via --pappers-key.
    """
    name = "pappers"
    API  = "https://api.pappers.fr/v2/recherche"

    def __init__(self, fetcher: StealthyFetcher, delay: float = 2.0, api_key: str = "",
                 page_offset: int = 0, rate_limiter=None, session=None, proxy_pool=None):
        super().__init__(fetcher, delay, rate_limiter=rate_limiter,
                         session=session, page_offset=page_offset, proxy_pool=proxy_pool)
        self.api_key = api_key

    def search(self, sector: str, city: str, max_results: int) -> list[Company]:
        """
        Interroge l'API Pappers.fr (SIRENE enrichi avec noms des dirigeants).
        Retourne vide si aucune clé API n'est fournie.
        Les dirigeants (prénom+nom) permettent de construire des emails personnalisés
        en Phase 5 (ex : jean.dupont@acme.fr) — meilleur taux d'ouverture que rh@.
        """
        if not self.api_key:
            return []

        # Mapping ville → département (réutilise celui de SocieteScraper)
        dept = ""
        city_lower = city.lower().strip()
        for key, val in SocieteScraper.DEPT_MAP.items():
            if key in city_lower or city_lower in key:
                dept = val
                break

        params: dict = {
            "q": sector,
            "per_page": min(max_results, 20),
            "api_token": self.api_key,
            "bases": "entreprises",
            "etat_administratif": "A",
        }
        if dept:
            params["departement"] = dept

        try:
            resp = self._api_get(self.API, params=params)
            if resp.status_code == 401:
                print("   ⚠  [pappers] Clé API invalide.")
                return []
            if resp.status_code != 200:
                print(f"   ⚠  [pappers] HTTP {resp.status_code}")
                return []
            results = resp.json().get("resultats", [])
        except Exception as e:
            print(f"   ⚠  [pappers] {e}")
            return []

        companies = [c for r in results if (c := self._to_company(r))]
        return companies[:max_results]

    def _to_company(self, r: dict) -> Company | None:
        """
        Convertit un résultat Pappers en Company.
        Extrait le premier dirigeant clé (DG, président, gérant) comme contact_name
        pour permettre la construction d'emails personnalisés en Phase 5.
        Retourne None si le nom d'entreprise est absent.
        """
        name = (r.get("nom_entreprise") or "").strip()
        if not name:
            return None

        # Comme SIRENE : on préfère l'établissement matché (filiale/agence) au siège.
        matches = r.get("matching_etablissements") or r.get("etablissements") or []
        etab    = matches[0] if matches else (r.get("siege") or {})
        ville   = etab.get("ville") or etab.get("libelle_commune") or ""
        dept    = (etab.get("departement")
                   or SocieteScraper._cp_to_dept(etab.get("code_postal") or ""))
        region  = f"{ville} ({dept})" if dept else ville
        naf    = r.get("code_naf") or ""
        activity = r.get("libelle_code_naf") or SocieteScraper._naf_label(naf)

        # Nom du dirigeant → base pour construire l'email précis
        contact_name, contact_role = "", "Dirigeant"
        for d in (r.get("dirigeants") or []):
            qualite = (d.get("qualite") or "").lower()
            is_key  = any(k in qualite for k in ["directeur", "président", "gérant", "dg", "ceo"])
            if is_key or not contact_name:
                prenom = d.get("prenom") or ""
                nom    = d.get("nom")    or ""
                contact_name = f"{prenom} {nom}".strip()
                contact_role = d.get("qualite") or "Dirigeant"
                if is_key:
                    break

        # Pappers expose la tranche d'effectif INSEE (même nomenclature que SIRENE)
        tranche = r.get("tranche_effectif") or r.get("tranche_effectif_salarie") or ""
        from .classification import normalize_company_size, classify_sector
        size_bucket = normalize_company_size(tranche)
        sector      = classify_sector(naf, activity)

        return Company(
            name=name,
            website=SocieteScraper._guess_website(name),
            contact_name=contact_name,
            contact_role=contact_role,
            region=region,
            activity_domain=activity,
            sector=sector,
            company_size=str(tranche),
            company_size_bucket=size_bucket,
            source=self.name,
        )


# ── Remixjobs ──────────────────────────────────────────────────────────────────

class RemixjobsScraper(BaseScraper):
    """Annuaire tech/remote 100% FR, fort en profils dev/data/product."""
    name   = "remixjobs"
    SEARCH = "https://remixjobs.com/jobs"

    def search(self, sector: str, city: str, max_results: int) -> list[Company]:
        """
        Scrape une page Remixjobs (annuaire tech/remote FR).
        Extrait nom et site web depuis les cards. Une seule page — le moteur
        Remixjobs n'expose pas de pagination standard dans le HTML.
        """
        companies: list[Company] = []
        seen: set[str] = set()
        params = {"search": sector, "location": city}
        url = f"{self.SEARCH}?{urlencode(params)}"
        print(f"   [{self.name}] → {url}")
        page = self._get(url)
        if page is None:
            return companies

        cards = (page.css("[class*='job-card']")
                 or page.css("[class*='JobCard']")
                 or page.css("article")
                 or page.css("li[class*='item']"))

        for card in cards[:max_results * 2]:
            if len(companies) >= max_results:
                break
            name_el = (card.css_first("[class*='company']")
                       or card.css_first("[class*='Company']")
                       or card.css_first("strong"))
            name = name_el.text.strip() if name_el else ""
            if not name or name in seen:
                continue
            seen.add(name)

            website_el = card.css_first("a[href*='http']")
            website = website_el.attrib.get("href", "") if website_el else ""

            companies.append(Company(
                name=name, website=website,
                freshness_score=60, source=self.name,
            ))

        return companies[:max_results]


# ── Registre ──────────────────────────────────────────────────────────────────

SCRAPERS: dict[str, type[BaseScraper]] = {
    "wttj":            WTTJScraper,
    "indeed":          IndeedScraper,
    "apec":            APECScraper,
    "cadremploi":      CadremploiScraper,
    "remixjobs":       RemixjobsScraper,        # tech / remote-first
    "societe":         SocieteScraper,          # registre SIRENE — toutes entreprises FR
    "pappers":         PappersScraper,          # SIRENE enrichi + dirigeants (clé requise)
}


# ══════════════════════════════════════════════════════════════════════════════
# A8 : SYSTÈME DE PLUGINS — scrapers externes sans patcher ce module
# ══════════════════════════════════════════════════════════════════════════════
# L'utilisateur peut ajouter sa propre source (API maison, annuaire de niche…)
# en déposant un fichier .py dans ~/.cache/carreer-ops/scrapers/ qui définit une
# sous-classe de BaseScraper décorée @register_scraper. Aucune modification du
# code packagé n'est requise → mises à jour de l'app sans perdre les sources custom.


def register_scraper(cls: "type[BaseScraper]") -> "type[BaseScraper]":
    """
    Décorateur : enregistre une sous-classe de BaseScraper dans SCRAPERS.

    Usage dans un plugin ::

        from candio_scraper.sources import BaseScraper, register_scraper
        from candio_scraper.models import Company

        @register_scraper
        class MaSource(BaseScraper):
            name = "ma_source"
            def search(self, sector, city, max_results):
                return [Company(name="…", source=self.name)]

    La clé d'enregistrement est ``cls.name``. Lève ValueError si name est absent,
    "base", ou déjà pris par une source intégrée (on ne masque jamais une source core).
    """
    name = getattr(cls, "name", "")
    if not name or name == "base":
        raise ValueError(f"register_scraper : la classe {cls.__name__} doit définir un `name` non vide.")
    if name in SCRAPERS and SCRAPERS[name] is not cls:
        raise ValueError(
            f"register_scraper : la source '{name}' est déjà enregistrée "
            f"({SCRAPERS[name].__name__}). Choisissez un nom unique."
        )
    if not issubclass(cls, BaseScraper):
        raise TypeError(f"register_scraper : {cls.__name__} doit hériter de BaseScraper.")
    SCRAPERS[name] = cls
    return cls


def load_scraper_plugins(plugins_dir: "str | None" = None) -> list[str]:
    """
    Charge dynamiquement tous les plugins scrapers d'un répertoire.

    Chaque fichier .py y est importé ; les classes décorées @register_scraper
    s'auto-enregistrent à l'import. Retourne la liste des noms de sources ajoutées.

    plugins_dir : défaut ~/.cache/carreer-ops/scrapers/. Créé s'il n'existe pas.
    Les erreurs d'import d'un plugin sont isolées (un plugin cassé n'empêche pas
    les autres de se charger) et loguées.
    """
    import importlib.util
    from pathlib import Path

    if plugins_dir is None:
        plugins_dir = str(Path.home() / ".cache" / "carreer-ops" / "scrapers")
    pdir = Path(plugins_dir)
    if not pdir.exists():
        try:
            pdir.mkdir(parents=True, exist_ok=True)
        except Exception:
            return []
        return []

    before = set(SCRAPERS.keys())
    for py_file in sorted(pdir.glob("*.py")):
        if py_file.name.startswith("_"):
            continue   # _helpers.py, __init__.py… ignorés
        try:
            spec = importlib.util.spec_from_file_location(f"candio_plugin_{py_file.stem}", py_file)
            if spec and spec.loader:
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
        except Exception as e:
            print(f"   ⚠  [plugin] échec chargement {py_file.name} : {e}")
    added = sorted(set(SCRAPERS.keys()) - before)
    if added:
        print(f"   🔌  {len(added)} source(s) plugin chargée(s) : {', '.join(added)}")
    return added
