"""
Registre persistant des crawls (« crawl ledger »).

But : ne PAS refaire deux fois le même travail entre les runs de scraping.
Un domaine déjà crawlé il y a moins de TTL n'est pas re-crawlé — on réutilise
directement son résultat (email trouvé, ou « rien trouvé »). Idem au niveau des
URLs individuelles pour ne pas re-télécharger une page déjà visitée.

Stockage : même base SQLite que PersistentCache (~/.cache/carreer-ops/scraper.db),
dans deux tables dédiées. Concurrent-safe (lock + WAL), partagé entre threads.

Pourquoi un module séparé de PersistentCache : la sémantique diffère.
- PersistentCache = cache clé/valeur générique (MX, WHOIS, Clearbit…).
- CrawlLedger     = mémoire métier « ce domaine/cette page a déjà été traité »,
  avec le résultat du crawl, pour piloter le SKIP en Phase 4.
"""
from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

from .models import _domain


def _norm_domain(website: str) -> str:
    """
    Domaine normalisé, robuste à l'absence de schéma. _domain() exige http(s)://
    (``_domain('acme.fr')`` → ''), or le ledger peut recevoir un host nu : on
    préfixe https:// au besoin pour une normalisation cohérente entre
    enregistrement et lecture.
    """
    if not website:
        return ""
    w = website.strip()
    if not w.startswith(("http://", "https://")):
        w = "https://" + w
    return _domain(w)


class CrawlLedger:
    """
    Mémoire persistante des domaines/URLs déjà crawlés.

    Usage typique (Phase 4) ::

        entry = ledger.lookup_domain(domain)
        if entry is not None:                 # déjà crawlé récemment
            if entry["email"]:
                c.contact_email = entry["email"]
                c.email_source  = entry["email_source"]
            # rien trouvé la dernière fois → on ne recrawle pas non plus
        else:
            email, src = crawl(...)           # vrai crawl
            ledger.record_domain(domain, email, src)
    """

    # 14 jours : les pages contact/équipe d'un site bougent lentement. Au-delà,
    # on re-crawle pour rafraîchir (un nouveau RH a pu apparaître).
    DEFAULT_TTL = 60 * 60 * 24 * 14

    def __init__(self, path: str = "", ttl: int = DEFAULT_TTL, enabled: bool = True):
        self.enabled = enabled
        self._ttl = ttl
        self._lock = threading.Lock()
        # compteurs de session (pour le récap de fin de run)
        self.hits_domain = 0      # domaines réutilisés (skippés)
        self.hits_url = 0         # pages réutilisées (skippées)
        self.recorded = 0         # domaines nouvellement enregistrés

        if not enabled:
            self._conn = None
            return

        if not path:
            cache_dir = Path.home() / ".cache" / "carreer-ops"
            cache_dir.mkdir(parents=True, exist_ok=True)
            path = str(cache_dir / "scraper.db")
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS crawl_domains "
            "(domain TEXT PRIMARY KEY, email TEXT, email_source TEXT, "
            " found INTEGER, crawled_at REAL)"
        )
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS crawl_urls "
            "(url TEXT PRIMARY KEY, visited_at REAL)"
        )
        self._conn.commit()

    # ── Niveau DOMAINE ────────────────────────────────────────────────────────

    def lookup_domain(self, domain_or_url: str) -> "dict | None":
        """
        Retourne {'email','email_source','found'} si le domaine a été crawlé il y
        a moins de TTL, sinon None (→ il faut (re)crawler). Incrémente hits_domain
        sur un hit.
        """
        if not self.enabled or not self._conn:
            return None
        dom = _norm_domain(domain_or_url)
        if not dom:
            return None
        row = self._conn.execute(
            "SELECT email, email_source, found, crawled_at FROM crawl_domains WHERE domain=?",
            (dom,),
        ).fetchone()
        if row is None:
            return None
        email, email_source, found, crawled_at = row
        if crawled_at and (time.time() - crawled_at) > self._ttl:
            # périmé : on purge et on signalera qu'il faut recrawler
            with self._lock:
                self._conn.execute("DELETE FROM crawl_domains WHERE domain=?", (dom,))
                self._conn.commit()
            return None
        self.hits_domain += 1
        return {"email": email or "", "email_source": email_source or "", "found": bool(found)}

    def record_domain(self, domain_or_url: str, email: str, email_source: str) -> None:
        """Enregistre le résultat d'un crawl de domaine (email trouvé ou '')."""
        if not self.enabled or not self._conn:
            return
        dom = _norm_domain(domain_or_url)
        if not dom:
            return
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO crawl_domains VALUES (?, ?, ?, ?, ?)",
                (dom, email or "", email_source or "", 1 if email else 0, time.time()),
            )
            self._conn.commit()
        self.recorded += 1

    # ── Niveau URL (page) ───────────────────────────────────────────────────────

    def seen_url(self, url: str) -> bool:
        """True si l'URL a déjà été visitée il y a moins de TTL. Incrémente hits_url."""
        if not self.enabled or not self._conn or not url:
            return False
        row = self._conn.execute(
            "SELECT visited_at FROM crawl_urls WHERE url=?", (url,)
        ).fetchone()
        if row is None:
            return False
        if row[0] and (time.time() - row[0]) > self._ttl:
            with self._lock:
                self._conn.execute("DELETE FROM crawl_urls WHERE url=?", (url,))
                self._conn.commit()
            return False
        self.hits_url += 1
        return True

    def mark_url(self, url: str) -> None:
        """Marque une URL comme visitée (maintenant)."""
        if not self.enabled or not self._conn or not url:
            return
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO crawl_urls VALUES (?, ?)", (url, time.time())
            )
            self._conn.commit()

    # ── Divers ──────────────────────────────────────────────────────────────────

    def summary(self) -> str:
        """Récap lisible des réutilisations de la session."""
        if not self.enabled:
            return "registre de crawl désactivé"
        return (f"{self.hits_domain} domaine(s) réutilisé(s), "
                f"{self.hits_url} page(s) évitée(s), "
                f"{self.recorded} domaine(s) enregistré(s)")

    def reset_session_counters(self) -> None:
        self.hits_domain = self.hits_url = self.recorded = 0

    def close(self) -> None:
        """Ferme la connexion SQLite (libère le fichier ; utile en tests)."""
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
