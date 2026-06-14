"""
enrich_async — Cœur HTTP asynchrone : Phase 2 MX + Phase 4 fast-crawl.

Remplacement du ThreadPoolExecutor par asyncio + httpx.AsyncClient :

  ThreadPoolExecutor(6) → asyncio.Semaphore(20)
  ─────────────────────────────────────────────
  · 20 connexions simultanées sans overhead de thread
    (1 coroutine ≈ 1 KB RAM vs 1 thread ≈ 8 MB stack)
  · 1 session HTTP/2 partagée entre toutes les entreprises
    → keep-alive + multiplexage → bien moins de handshakes TLS
  · TCP natif async (asyncio.open_connection) : pas de thread
    bloqué pendant les connexions réseau
  · DNS MX via dns.asyncresolver : lookups parallèles sans threads

Architecture :
  Toutes les fonctions sont des coroutines (async def). Le pont
  sync→async se fait via asyncio.run() appelé depuis enrich.py.
  Fonctionne car le pipeline est lancé depuis un subprocess Electron
  (aucun event loop actif). Les fonctions vérifient ce cas en test.

  Phases headless (crawl_contact_page, find_recruiter_name) restent
  SYNC : elles utilisent Patchright (Chromium) qui n'est pas async.
"""

from __future__ import annotations

import asyncio
import socket
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Company
    from .infra import PersistentCache, LRUPageCache
    from .crawl_ledger import CrawlLedger


# ── Dépendances optionnelles ───────────────────────────────────────────────────

try:
    import httpx
    HTTPX_AVAILABLE = True
    # HTTP/2 requiert le package `h2` (pip install httpx[http2]).
    # Détecté via find_spec (sans importer h2) pour éviter l'ImportError tardif
    # dans AsyncClient(http2=True) ET un import « inutilisé » côté linters.
    import importlib.util as _ilu
    HTTP2_AVAILABLE = _ilu.find_spec("h2") is not None
except ImportError:
    httpx = None          # type: ignore[assignment]
    HTTPX_AVAILABLE = False
    HTTP2_AVAILABLE = False

try:
    import dns.asyncresolver as _dns_async
    DNS_ASYNC_AVAILABLE = True
except ImportError:
    _dns_async = None     # type: ignore[assignment]
    DNS_ASYNC_AVAILABLE = False

try:
    from bs4 import BeautifulSoup as _BS4
    BS4_AVAILABLE = True
except ImportError:
    _BS4 = None
    BS4_AVAILABLE = False


# ── Headers HTTP communs ───────────────────────────────────────────────────────

_HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
}

# B-3 : politesse par domaine. Les requêtes vers UN même site sont séquentielles
# (la boucle `for path` await chaque GET), donc aucun parallélisme sur un serveur
# donné — mais en mode explore on enchaîne potentiellement ~20 paths d'affilée.
# Ce petit délai borne le débit par domaine à ~5 req/s sans pénaliser le débit
# global (les 20 coroutines visent des domaines distincts en parallèle).
_PER_DOMAIN_DELAY_SEC = 0.2


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS RÉSEAU ASYNC — partagent les caches de enrich.py
# ══════════════════════════════════════════════════════════════════════════════

def _get_net_caches():
    """Accès différé aux caches réseau de enrich.py (évite l'import circulaire)."""
    from .enrich import _DNS_CACHE, _TCP_CACHE, _NET_CACHE_LOCK
    return _DNS_CACHE, _TCP_CACHE, _NET_CACHE_LOCK


async def _host_resolves_async(website: str) -> bool:
    """
    Résolution DNS async (asyncio.to_thread → socket.getaddrinfo).
    Partage _DNS_CACHE/_NET_CACHE_LOCK avec la version sync de enrich.py.
    """
    from .models import _domain
    if not website:
        return False
    host = _domain(website)
    if not host:
        return False
    _DNS_CACHE, _, lock = _get_net_caches()
    with lock:
        if host in _DNS_CACHE:
            return _DNS_CACHE[host]
    try:
        await asyncio.to_thread(socket.getaddrinfo, host, None)
        result = True
    except Exception:
        result = False
    with lock:
        _DNS_CACHE[host] = result
    return result


async def _tcp_reachable_async(host: str, timeout: float = 2.0) -> bool:
    """
    Pré-check TCP async natif (asyncio.open_connection — pas de thread).
    Partage _TCP_CACHE/_NET_CACHE_LOCK avec la version sync de enrich.py.
    Port 443 en priorité, 80 en fallback.
    """
    if not host:
        return False
    _, _TCP_CACHE, lock = _get_net_caches()
    with lock:
        if host in _TCP_CACHE:
            return _TCP_CACHE[host]
    ok = False
    for port in (443, 80):
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=timeout
            )
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout=0.3)
            except Exception:
                pass
            ok = True
            break
        except Exception:
            continue
    with lock:
        _TCP_CACHE[host] = ok
    return ok


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — FILTRE MX ASYNC
# ══════════════════════════════════════════════════════════════════════════════

async def _domain_has_mx_async(
    domain: str,
    cache: "PersistentCache | None",
    sem: asyncio.Semaphore,
) -> tuple[str, bool]:
    """
    Vérifie l'enregistrement MX d'un domaine via dns.asyncresolver (async natif).
    Retourne (domain, has_mx). Résultats mis en cache 7 jours.
    """
    if not domain:
        return domain, True  # laisse passer par sécurité

    # Cache en priorité (synchrone, instant)
    if cache:
        cached = cache.get(f"mx:{domain}")
        if cached is not None:
            return domain, (cached == "1")

    async with sem:
        result = True
        if DNS_ASYNC_AVAILABLE:
            try:
                await _dns_async.resolve(domain, "MX", lifetime=3)
                result = True
            except Exception:
                result = False
        else:
            # Fallback synchrone dans un thread (dnspython v1 ou dns.asyncresolver absent)
            import dns.resolver as _dns_sync
            try:
                await asyncio.to_thread(_dns_sync.resolve, domain, "MX", lifetime=3)
                result = True
            except Exception:
                result = False

    if cache:
        cache.set(f"mx:{domain}", "1" if result else "0", ttl=60 * 60 * 24 * 7)
    return domain, result


async def _run_mx_filter_async(
    unique_domains: list[str],
    cache: "PersistentCache | None",
    max_concurrent: int = 40,
) -> dict[str, bool]:
    """
    Filtre MX de tous les domaines en parallèle via asyncio.gather.

    max_concurrent=40 : bien plus élevé que les 10 threads précédents car
    les lookups DNS async ne bloquent pas le CPU. L'overhead est presque nul.
    """
    sem = asyncio.Semaphore(max_concurrent)
    tasks = [_domain_has_mx_async(d, cache, sem) for d in unique_domains]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out: dict[str, bool] = {}
    for r in results:
        if isinstance(r, tuple) and len(r) == 2:
            domain, has = r
            out[domain] = has
        # En cas d'exception inattendue → laisse passer (True)
    return out


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 4 — FAST-CRAWL EMAIL ASYNC
# ══════════════════════════════════════════════════════════════════════════════

async def _fetch_async(
    client: "httpx.AsyncClient",
    url: str,
    timeout: float = 6.0,
) -> "httpx.Response | None":
    """
    GET async avec repli SSL verify=False (même sémantique que _get_ssl_lenient).
    Retourne la Response ou None si toutes les tentatives échouent.
    """
    if not HTTPX_AVAILABLE or httpx is None:
        return None
    for verify in (True, False):
        try:
            r = await client.get(url, timeout=timeout, follow_redirects=True)
            return r
        except httpx.SSLError:
            if verify:
                continue   # réessai sans vérification
            return None
        except Exception:
            return None
    return None


async def fast_crawl_email_async(
    website: str,
    client: "httpx.AsyncClient",
    page_cache: "LRUPageCache | None" = None,
    url_ledger: "CrawlLedger | None" = None,
    timeout: float = 6.0,
) -> str:
    """
    Version async de fast_crawl_email : même logique, mais avec httpx.AsyncClient.

    · Pas de session par thread (une seule session AsyncClient partagée → HTTP/2 mux)
    · TCP check async natif
    · BS4 parsing sync mais CPU-only (pas d'I/O) → OK dans un async context
    · Retourne le premier email RH trouvé, ou '' si aucun.
    """
    if not BS4_AVAILABLE or not website:
        return ""
    from .models import _domain
    from .enrich import (
        _collect_all_emails, _rank_email,
        _discover_contact_links, CONTACT_PATHS,
        CRAWL_BUDGET_SEC,
    )

    # ── Pre-checks (shared caches) ────────────────────────────────────────────
    if not await _host_resolves_async(website):
        return ""
    base = website.rstrip("/") if website.startswith("http") else f"https://{website}"
    site_domain = _domain(base)
    if not await _tcp_reachable_async(site_domain):
        return ""

    # ── Paths à tenter ────────────────────────────────────────────────────────
    _fast_paths = [
        "", "/contact", "/nous-contacter", "/contact-us",
        "/recrutement", "/carrieres", "/careers", "/jobs",
        "/equipe", "/team", "/about", "/about-us", "/a-propos",
        "/rh", "/hr", "/people", "/talent",
        "/mentions-legales", "/mentions-legales.html", "/legal",
        "/politique-de-confidentialite", "/cgv",
    ]
    if url_ledger is not None:
        _seen_set = set(_fast_paths)
        _fast_paths = _fast_paths + [p for p in CONTACT_PATHS if p not in _seen_set]

    best_email  = ""
    best_score  = -1
    homepage_html = ""
    consecutive_fail = 0
    deadline_s  = time.monotonic() + CRAWL_BUDGET_SEC

    try:
        for _i_path, path in enumerate(_fast_paths):
            if time.monotonic() > deadline_s:
                break
            url = f"{base}{path}"
            if url_ledger is not None and url_ledger.seen_url(url):
                continue

            # B-3 : politesse inter-requêtes sur le MÊME domaine (pas avant la 1re).
            if _i_path > 0:
                await asyncio.sleep(_PER_DOMAIN_DELAY_SEC)

            resp = await _fetch_async(client, url, timeout)

            if resp is None:
                if path == "":
                    return ""
                consecutive_fail += 1
                if consecutive_fail >= 2:
                    break
                continue
            consecutive_fail = 0

            if resp.status_code != 200:
                continue
            if url_ledger is not None:
                url_ledger.mark_url(url)

            html = resp.text
            if path == "" and not homepage_html:
                homepage_html = html

            # BS4 parsing (sync, CPU-only — pas d'I/O)
            soup = _BS4(html, "html.parser")
            page_text = soup.get_text(separator=" ", strip=True)

            if page_cache is not None and url not in page_cache:
                page_cache[url] = page_text

            for email in _collect_all_emails(page_text, html, site_domain):
                score = _rank_email(email, site_domain)
                if score > best_score:
                    best_score = score
                    best_email = email
                    if score >= 4:
                        return best_email

        # Découverte dynamique si best_score < 3
        if best_score < 3 and homepage_html:
            discovered = _discover_contact_links(base, homepage_html, max_links=8)
            for _i_disc, url in enumerate(discovered):
                if time.monotonic() > deadline_s:
                    break
                if _i_disc > 0:
                    await asyncio.sleep(_PER_DOMAIN_DELAY_SEC)
                resp = await _fetch_async(client, url, timeout)
                if resp is None or resp.status_code != 200:
                    continue
                soup2 = _BS4(resp.text, "html.parser")
                pt2   = soup2.get_text(separator=" ", strip=True)
                for email in _collect_all_emails(pt2, resp.text, site_domain):
                    score = _rank_email(email, site_domain)
                    if score > best_score:
                        best_score = score
                        best_email = email
                        if score >= 4:
                            return best_email

    except Exception:
        pass

    return best_email


async def _run_fast_pass_async(
    companies: list["Company"],
    page_cache: "LRUPageCache | None",
    url_ledger_fn,          # callable(company) → CrawlLedger | None
    deadline,               # Deadline | None
    max_concurrent: int = 20,
    proxy_pool = None,      # ProxyPool | None
) -> dict[int, str]:
    """
    Fast-crawl de TOUTES les entreprises en parallèle via asyncio.gather.

    max_concurrent=20 : bien au-dessus des 6 threads d'avant.
    Chaque coroutine attend du réseau sans bloquer les autres.
    Une seule session httpx.AsyncClient est partagée → connexions keep-alive
    réutilisées entre entreprises du même domaine (CDN communs, IP proches).

    Retourne {id(company) → email}.
    """
    if not HTTPX_AVAILABLE or httpx is None or not BS4_AVAILABLE:
        return {}

    sem = asyncio.Semaphore(max_concurrent)
    limits = httpx.Limits(
        max_connections=max_concurrent + 5,
        max_keepalive_connections=max_concurrent,
        keepalive_expiry=30,
    )

    async def _crawl_one(c: "Company") -> tuple[int, str]:
        if deadline is not None and deadline.expired():
            return id(c), ""
        async with sem:
            email = await fast_crawl_email_async(
                c.website,
                client=client,
                page_cache=page_cache,
                url_ledger=url_ledger_fn(c),
            )
        return id(c), email

    # httpx.AsyncClient unique pour tout le batch.
    # HTTP/2 activé seulement si h2 est installé (pip install httpx[http2]).
    # Point 3 : proxy httpx — si un ProxyPool est fourni, on passe le proxy courant.
    # En cas de blocage (429/403) détecté dans _fetch_async, la coroutine peut
    # appeler pool.rotate() avant de réessayer (non implémenté ici : le fast-crawl
    # visite des domaines distincts — la rotation n'a d'intérêt que pour les scrapers
    # qui répètent des requêtes vers le MÊME hôte, ex: Kompass/PJ).
    _proxy = proxy_pool.httpx_proxy() if proxy_pool else None
    async with httpx.AsyncClient(
        headers=_HEADERS,
        follow_redirects=True,
        limits=limits,
        http2=HTTP2_AVAILABLE,  # True si h2 installé ; False = HTTP/1.1 keep-alive
        verify=True,            # SSL par défaut ; _fetch_async gère le fallback False
        proxy=_proxy,           # None si pas de proxy configuré
    ) as client:
        tasks = [_crawl_one(c) for c in companies if c.website]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    out: dict[int, str] = {}
    for r in results:
        if isinstance(r, tuple) and len(r) == 2:
            cid, email = r
            if email:
                out[cid] = email
    return out


# ══════════════════════════════════════════════════════════════════════════════
# POINT D'ENTRÉE SYNCHRONE — Pont sync → async
# ══════════════════════════════════════════════════════════════════════════════

def _run_coro(coro):
    """
    Exécute une coroutine depuis un contexte synchrone.

    Cas 1 (normal) : aucun event loop actif → asyncio.run().
    Cas 2 (tests async / Jupyter) : event loop déjà actif → sous-thread dédié.
    """
    try:
        asyncio.get_running_loop()
        # Un event loop tourne déjà (ex : test async) → nouveau thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()
    except RuntimeError:
        # Pas d'event loop → chemin normal
        return asyncio.run(coro)


def async_fast_pass(
    companies: list["Company"],
    page_cache: "LRUPageCache | None",
    explore_new_pages: bool,
    ledger: "CrawlLedger | None",
    deadline,
    max_concurrent: int = 20,
    proxy_pool = None,   # ProxyPool | None — passe au client httpx
) -> dict[int, str]:
    """
    Point d'entrée sync → async pour la Phase 4 fast-crawl.
    Appelé depuis enrich_web_crawl() à la place du ThreadPoolExecutor.

    Retourne {id(company) → email}.
    Dégradation propre : si httpx indisponible ou BS4 absent → {} (fallback threads).
    """
    if not HTTPX_AVAILABLE or not BS4_AVAILABLE:
        return {}  # enrich_web_crawl bascule en mode threads

    def _url_ledger(c: "Company") -> "CrawlLedger | None":
        return ledger if (explore_new_pages and ledger is not None) else None

    return _run_coro(
        _run_fast_pass_async(
            companies=companies,
            page_cache=page_cache,
            url_ledger_fn=_url_ledger,
            deadline=deadline,
            max_concurrent=max_concurrent,
            proxy_pool=proxy_pool,
        )
    )


def async_mx_filter(
    unique_domains: list[str],
    cache: "PersistentCache | None",
    max_concurrent: int = 40,
) -> dict[str, bool]:
    """
    Point d'entrée sync → async pour le filtre MX (Phase 2).
    Appelé depuis filter_mx() à la place du ThreadPoolExecutor.

    Retourne {domain → has_mx}.
    """
    return _run_coro(
        _run_mx_filter_async(
            unique_domains=unique_domains,
            cache=cache,
            max_concurrent=max_concurrent,
        )
    )
