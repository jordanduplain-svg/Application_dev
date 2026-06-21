"""
infra — Cache SQLite, checkpoint, rate-limiting, proxy pool, fetcher thread-safe.

Bloc d'infrastructure réutilisable par toutes les phases du pipeline.
Aucune dépendance Chromium/Playwright : uniquement requests-based.
"""

from __future__ import annotations

import collections
import dataclasses
import hashlib
import json
import logging
import sqlite3
import threading
import time
from datetime import date, datetime
from pathlib import Path

# Réduire la verbosité de Scrapling : ses logs INFO "Fetched (200)" partent sur stderr
# et l'app Electron les affiche tous comme des avertissements. On garde uniquement WARNING+.
logging.getLogger("scrapling").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

# Scrapling Fetcher (requests-based, sans navigateur)
# B2-10 : sys.exit() → ImportError. sys.exit() à l'import tue les tests, les linters
# et tout outil qui fait un import sans scraper headless (ex. analyse statique).
# Une ImportError est capturée proprement par les appelants.
try:
    from scrapling import Fetcher
    from scrapling.parser import Selector as _ScraplingSelector
    # Compat v0.3 : css_first → find
    if not hasattr(_ScraplingSelector, "css_first"):
        _ScraplingSelector.css_first = _ScraplingSelector.find  # type: ignore[attr-defined]
except ImportError as _scrapling_err:
    raise ImportError(
        "Le package 'scrapling' est requis. "
        "Installez-le : pip install 'scrapling[fetchers]'  (aucun navigateur requis)"
    ) from _scrapling_err

# Re-suppression APRÈS import (Scrapling reconfigure son logger à l'import).
# On force le niveau WARNING sur TOUS les loggers déjà créés pour être sûr.
for _name in list(logging.root.manager.loggerDict.keys()):
    if _name.startswith(("scrapling", "urllib3", "asyncio", "playwright", "patchright")):
        logging.getLogger(_name).setLevel(logging.WARNING)


# ══════════════════════════════════════════════════════════════════════════════
# LOGGING STRUCTURÉ (point #15 audit)
# ══════════════════════════════════════════════════════════════════════════════
# Un logger fichier persistant en plus des print() : permet le diagnostic
# post-mortem (ex : pourquoi un crawl a été lent / un email manqué) sans rejouer
# tout le run. Fichier tournant dans ~/.cache/carreer-ops/scraper.log.
# Les print() restent pour le flux temps réel affiché par Electron ; le logger
# capte le détail (DEBUG) y compris les exceptions normalement avalées (point #7).

_LOG_CONFIGURED = False


def get_logger(name: str = "candio") -> "logging.Logger":
    """Logger applicatif partagé. Idempotent : configure les handlers une seule fois."""
    global _LOG_CONFIGURED
    logger = logging.getLogger(name)
    if _LOG_CONFIGURED:
        return logger
    try:
        from logging.handlers import RotatingFileHandler
        cache_dir = Path.home() / ".cache" / "carreer-ops"
        cache_dir.mkdir(parents=True, exist_ok=True)
        logger.setLevel(logging.DEBUG)
        # Fichier : tout le détail (DEBUG), rotation 2 Mo × 3.
        fh = RotatingFileHandler(cache_dir / "scraper.log", maxBytes=2_000_000,
                                 backupCount=3, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s", "%Y-%m-%d %H:%M:%S"))
        logger.addHandler(fh)
        # stderr : seulement WARNING+ (le flux INFO/temps réel passe par print()).
        sh = logging.StreamHandler()
        sh.setLevel(logging.WARNING)
        sh.setFormatter(logging.Formatter("⚠  %(message)s"))
        logger.addHandler(sh)
        logger.propagate = False
    except Exception:
        # Logging ne doit jamais faire planter le scraper.
        pass
    _LOG_CONFIGURED = True
    return logger


# Logger module partagé — importable partout : from .infra import log
log = get_logger("candio.scraper")


# ══════════════════════════════════════════════════════════════════════════════
# CACHE PERSISTANT
# ══════════════════════════════════════════════════════════════════════════════

class PersistentCache:
    """
    Cache SQLite dans ~/.cache/carreer-ops/scraper.db. TTL 30 jours par défaut.
    Stocke MX records, WHOIS, Wappalyzer, Clearbit entre sessions.
    """
    DEFAULT_TTL = 60 * 60 * 24 * 30  # 30 jours

    def __init__(self, path: str = ""):
        if not path:
            cache_dir = Path.home() / ".cache" / "carreer-ops"
            cache_dir.mkdir(parents=True, exist_ok=True)
            path = str(cache_dir / "scraper.db")
        self._path = path
        self._lock = threading.Lock()
        # check_same_thread=False : partagé entre threads. WAL : lecteurs concurrents sans blocage.
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS cache "
            "(key TEXT PRIMARY KEY, value TEXT, expires_at REAL)"
        )
        self._conn.commit()

    def get(self, key: str) -> str | None:
        # B0-3 : tout sous un seul lock.
        # Avant : SELECT sans lock → cursor SQLite corrompu en Phase 4 parallèle
        # (le module sqlite3 Python n'est pas thread-safe au niveau du curseur,
        # même avec check_same_thread=False + WAL). Après : lock unique couvre
        # SELECT + DELETE éventuel → pas de lock imbriqué, pas de deadlock.
        with self._lock:
            row = self._conn.execute(
                "SELECT value, expires_at FROM cache WHERE key=?", (key,)
            ).fetchone()
            if row is None:
                return None
            value, expires_at = row
            if expires_at and expires_at < time.time():
                self._conn.execute("DELETE FROM cache WHERE key=?", (key,))
                self._conn.commit()
                return None
            return value

    def set(self, key: str, value: str, ttl: int = DEFAULT_TTL) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO cache VALUES (?, ?, ?)",
                (key, value, time.time() + ttl),
            )
            self._conn.commit()

    def get_json(self, key: str):
        v = self.get(key)
        return json.loads(v) if v is not None else None

    def set_json(self, key: str, value, ttl: int = DEFAULT_TTL) -> None:
        self.set(key, json.dumps(value, ensure_ascii=False), ttl)

    def has(self, key: str) -> bool:
        return self.get(key) is not None

    def clear_prefix(self, prefix: str) -> int:
        """
        Supprime toutes les clés commençant par ``prefix``. Retourne le nombre supprimé.
        Utilisé par reset_pagination.py pour purger les curseurs `pagecursor:*`.
        """
        with self._lock:
            cur = self._conn.execute(
                "SELECT COUNT(*) FROM cache WHERE key LIKE ?", (prefix + "%",)
            )
            n = cur.fetchone()[0]
            self._conn.execute("DELETE FROM cache WHERE key LIKE ?", (prefix + "%",))
            self._conn.commit()
            return int(n)


# ══════════════════════════════════════════════════════════════════════════════
# CHECKPOINT — REPRISE SUR INTERRUPTION
# ══════════════════════════════════════════════════════════════════════════════

class ScrapingCheckpoint:
    """
    Sauvegarde l'état du pipeline après chaque phase dans un JSON.
    --resume repart de la phase sauvegardée sans tout recolleter.
    Fichier : ~/.cache/carreer-ops/checkpoint-{run_id}.json. Durée de vie : 24h.
    """

    def __init__(self, run_id: str):
        cache_dir = Path.home() / ".cache" / "carreer-ops"
        cache_dir.mkdir(parents=True, exist_ok=True)
        self._path = cache_dir / f"checkpoint-{run_id}.json"

    @staticmethod
    def make_run_id(sector: str, city: str) -> str:
        """Identifiant stable pour (sector, city, date du jour)."""
        raw = f"{sector.lower()}|{city.lower()}|{date.today().isoformat()}"
        return hashlib.md5(raw.encode()).hexdigest()[:10]

    def save(self, phase: int, companies: list) -> None:
        try:
            data = {
                "phase": phase,
                "saved_at": datetime.now().isoformat(),
                "companies": [dataclasses.asdict(c) for c in companies],
            }
            self._path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"⚠  Checkpoint : sauvegarde échouée — {e}")

    def load(self) -> "tuple[int, list] | None":
        """
        Charge un checkpoint. Retourne (phase, companies) ou None.
        Rejette les checkpoints > 24h. Tolère les changements de schéma de Company
        (champs inconnus ignorés, manquants → valeurs par défaut).
        """
        from .models import Company  # import différé pour éviter une boucle

        if not self._path.exists():
            return None
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            saved = datetime.fromisoformat(raw.get("saved_at", "2000-01-01"))
            if (datetime.now() - saved).total_seconds() > 86400:
                self.clear()
                return None
            _known = {f.name for f in dataclasses.fields(Company)}
            companies = [
                Company(**{k: v for k, v in d.items() if k in _known})
                for d in raw["companies"]
            ]
            phase = raw["phase"]
            print(f"✅  Checkpoint trouvé (Phase {phase}, {len(companies)} entreprises, sauvegardé {saved.strftime('%H:%M')})")
            return phase, companies
        except Exception as e:
            print(f"⚠  Checkpoint corrompu — ignoré ({e})")
            return None

    def clear(self) -> None:
        try:
            if self._path.exists():
                self._path.unlink()
        except Exception:
            pass

    @property
    def exists(self) -> bool:
        return self._path.exists()


# ══════════════════════════════════════════════════════════════════════════════
# PROXY POOL — ROTATION ROUND-ROBIN
# ══════════════════════════════════════════════════════════════════════════════

class ProxyPool:
    """
    Pool de proxies en round-robin avec rotation automatique sur erreur.

    Format de chaque proxy :
      'http://user:pass@host:port'
      'socks5://user:pass@host:port'
      'http://host:port'  (sans auth)

    Sources recommandées (gratuites/légères) :
      - Fichier texte local  : proxies.txt (1 proxy par ligne)
      - Env var              : CANDIO_PROXIES="http://p1:8080,socks5://p2:1080"
      - ProxyBroker2 (pip)   : génère un pool local SOCKS5 filtré par pays

    Codes HTTP qui déclenchent la rotation :
      429 (rate-limit), 403 (blocage IP), 503, 502, 407 (auth proxy requise).

    Thread-safe via lock interne.
    """

    # Codes qui signalent un blocage côté serveur → changer de proxy.
    ROTATE_ON_STATUS = frozenset({429, 403, 407, 502, 503, 520, 521, 522, 523})

    def __init__(self, proxies: list[str]):
        self._proxies = [p.strip() for p in proxies if p.strip()]
        self._idx  = 0
        self._lock = threading.Lock()
        # Compteur de blocages par proxy (pour logs)
        self._blocks: dict[str, int] = {}

    def __bool__(self) -> bool:
        return bool(self._proxies)

    def __len__(self) -> int:
        return len(self._proxies)

    @classmethod
    def from_env(cls) -> "ProxyPool":
        """Construit un ProxyPool depuis CANDIO_PROXIES (virgule-séparé)."""
        import os
        raw = os.environ.get("CANDIO_PROXIES", "")
        return cls([p for p in raw.split(",") if p.strip()])

    @classmethod
    def from_file(cls, path: "str | None" = None) -> "ProxyPool":
        """Construit un ProxyPool depuis un fichier texte (1 proxy/ligne)."""
        import os
        p = path or os.environ.get("CANDIO_PROXY_FILE", "proxies.txt")
        try:
            lines = open(p, encoding="utf-8").read().splitlines()
            return cls([l for l in lines if l.strip() and not l.startswith("#")])
        except FileNotFoundError:
            return cls([])

    @property
    def current(self) -> str:
        with self._lock:
            return self._proxies[self._idx % len(self._proxies)] if self._proxies else ""

    def rotate(self, reason: str = "") -> None:
        """Passe au proxy suivant. Appeler après un blocage."""
        with self._lock:
            if not self._proxies:
                return
            old = self._proxies[self._idx % len(self._proxies)]
            self._blocks[old] = self._blocks.get(old, 0) + 1
            self._idx = (self._idx + 1) % len(self._proxies)
            new = self._proxies[self._idx]
            log.debug("proxy rotate (%s) : %s → %s", reason or "?", old, new)

    def requests_dict(self) -> dict:
        """Dict proxies pour requests.get(proxies=…)."""
        p = self.current
        return {"http": p, "https": p} if p else {}

    def httpx_proxy(self) -> "str | None":
        """Proxy string pour httpx.AsyncClient(proxy=…)."""
        return self.current or None

    def should_rotate(self, status_code: int) -> bool:
        """Retourne True si ce code HTTP doit déclencher une rotation."""
        return status_code in self.ROTATE_ON_STATUS


# ══════════════════════════════════════════════════════════════════════════════
# CACHE LRU DE PAGES HTML (en mémoire, borné)
# ══════════════════════════════════════════════════════════════════════════════

class LRUPageCache:
    """
    Cache mémoire borné de pages HTML (LRU eviction), thread-safe.
    Sans borne, 200 entreprises × 15 paths × ~50 KB = ~150 MB RAM.
    B0-1 : lock ajouté — Phase 4 fast-crawl écrit en parallèle (4-6 workers)
    dans la même instance → OrderedDict corrompu sans protection.
    """

    def __init__(self, maxsize: int = 500):
        self._maxsize = maxsize
        self._data: collections.OrderedDict[str, str] = collections.OrderedDict()
        self._lock  = threading.Lock()

    def get(self, url: str) -> "str | None":
        with self._lock:
            if url not in self._data:
                return None
            self._data.move_to_end(url)
            return self._data[url]

    def __setitem__(self, url: str, text: str) -> None:
        with self._lock:
            if url in self._data:
                self._data.move_to_end(url)
            self._data[url] = text
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def __getitem__(self, url: str) -> str:
        result = self.get(url)
        if result is None:
            raise KeyError(url)
        return result

    def __contains__(self, url: object) -> bool:
        with self._lock:
            return url in self._data

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)

    def snapshot(self) -> "dict[str, str]":
        """Copie {url: texte} de toutes les pages en cache (thread-safe). Sert à
        agréger tout ce que le crawl a déjà récupéré pour une entreprise donnée."""
        with self._lock:
            return dict(self._data)


# ══════════════════════════════════════════════════════════════════════════════
# RETRY + RATE LIMITING
# ══════════════════════════════════════════════════════════════════════════════

# Erreurs réseau ATTENDUES pendant le crawl (serveur qui coupe la connexion,
# timeout, DNS introuvable, SSL, redirection cassée…). Elles sont normales et
# déjà gérées plus haut (retour None → bail-out). On les log de façon COMPACTE
# et non alarmante pour ne pas noyer les vraies anomalies dans le bruit.
_TRANSIENT_NET_ERRORS = frozenset({
    "ConnectionError", "ConnectionResetError", "ConnectionAbortedError",
    "ConnectionRefusedError", "ReadTimeout", "ConnectTimeout", "Timeout",
    "ReadTimeoutError", "SSLError", "NameResolutionError", "MaxRetryError",
    "ChunkedEncodingError", "ProtocolError", "RemoteDisconnected", "TimeoutError",
    "TooManyRedirects", "InvalidURL", "LocationParseError", "ConnectTimeoutError",
})


def _retry(fn, retries: int = 3, base_delay: float = 1.5):
    """
    Retry avec backoff exponentiel pour appels réseau transitoires.
    Tente `fn()` jusqu'à `retries` fois (1.5 s → 3 s → 6 s). Retourne None si tout échoue.

    B1-11 : remplace print() par log.debug/warning. En Phase 4 parallèle (4-6 threads),
    les print() s'interlaçaient et noyaient l'output utile dans du bruit réseau normal.
    Les erreurs transitoires (timeout, SSL…) partent en DEBUG (fichier log uniquement) ;
    les anomalies inattendues restent en WARNING (visible mais pas spammé).
    """
    for attempt in range(retries):
        try:
            return fn()
        except Exception as exc:
            name = type(exc).__name__
            if name in _TRANSIENT_NET_ERRORS:
                # Bruit réseau normal → DEBUG uniquement (fichier log, pas stderr).
                if attempt == retries - 1:
                    log.debug("site injoignable après %d tentatives : %s", retries, name)
            else:
                # Anomalie inattendue → WARNING (visible dans stderr).
                log.warning("[retry %d/%d] %s: %s", attempt + 1, retries, name, exc)
            if attempt < retries - 1:
                time.sleep(base_delay * (2 ** attempt))
    return None


class Deadline:
    """
    Limite de temps globale pour le pipeline. Permet d'arrêter proprement le scraping
    après N minutes et d'exporter ce qui a été collecté jusque-là.

    Usage :
        dl = Deadline(minutes=20)
        ...
        if dl.expired():
            break  # on s'arrête, on exporte ce qu'on a
    """

    def __init__(self, minutes: float = 0):
        # 0 ou négatif = pas de limite
        self._end = time.monotonic() + minutes * 60 if minutes and minutes > 0 else None

    def expired(self) -> bool:
        return self._end is not None and time.monotonic() >= self._end

    def remaining(self) -> float:
        """Secondes restantes (inf si pas de limite)."""
        if self._end is None:
            return float("inf")
        return max(0.0, self._end - time.monotonic())

    def remaining_str(self) -> str:
        r = self.remaining()
        if r == float("inf"):
            return "∞"
        m, s = divmod(int(r), 60)
        return f"{m}m{s:02d}s"


class RateLimiter:
    """
    Token bucket thread-safe : limite le débit global de requêtes HTTP entre threads.
    Évite les bans IP simultanés sur les services tiers.

    B0-2 : sleep HORS du lock. Avant, tous les workers se serialisaient à l'intérieur
    du lock → débit effectif = interval/1 au lieu de interval/N. Ex : avec 4 workers
    et calls_per_second=2, on obtenait ~0.4 req/s au lieu de 2 req/s.
    Pattern correct : essai atomique d'acquisition du token, si raté → sleep DEHORS
    du lock et réessai (busy-wait court, réveils < interval).
    """

    def __init__(self, calls_per_second: float = 2.0):
        self._interval  = 1.0 / max(calls_per_second, 0.01)
        self._lock      = threading.Lock()
        self._last_call = 0.0

    def wait(self) -> None:
        """Bloque jusqu'à ce que le prochain appel soit autorisé."""
        while True:
            with self._lock:
                now     = time.monotonic()
                elapsed = now - self._last_call
                if elapsed >= self._interval:
                    self._last_call = now
                    return
                sleep_for = self._interval - elapsed
            # Dormir HORS du lock : les autres threads ne sont pas bloqués
            # et peuvent tenter leur propre acquisition dès que le slot est libre.
            time.sleep(sleep_for)


# ══════════════════════════════════════════════════════════════════════════════
# FETCHER THREAD-SAFE (wrapper Scrapling Fetcher)
# ══════════════════════════════════════════════════════════════════════════════

class _ThreadSafeFetcher:
    """
    Enveloppe thread-safe autour de Fetcher (requests-based, sans navigateur).
    Lock pour éviter les conflits d'état Scrapling entre threads.
    """

    def __init__(self):
        self._lock = threading.Lock()

    def get(self, url: str, **kw):
        # Retirer les kwargs Playwright-only que Fetcher ne comprend pas
        kw.pop("extra_flags", None)
        kw.pop("executable_path", None)
        with self._lock:
            return Fetcher.get(url, **kw)

    def __getattr__(self, name: str):
        return getattr(Fetcher, name)
