"""
enrich_apis — Clients API Email (Phase 5) : Hunter.io, GitHub.

Extrait de enrich.py (B2-1 split). Snov.io / Apollo.io retirés (jamais utilisés
en pratique — inscriptions API trop pénibles ; l'enrichissement repose sur le
crawl web gratuit + Hunter free tier).

Dépendances intentionnellement légères :
  models, constants, email_pattern, infra, requests — AUCUN import depuis enrich.py.
  → zéro risque de cycle ; enrich.py importe depuis ce module (re-export compat).

Contenu :
  · EmailResult     — dataclass unifié retourné par les clients
  · HunterClient    — Hunter.io Phase 5
  · apply_email_format — format Hunter → email nominatif
  · linkedin_find_hr   — DuckDuckGo → snippets LinkedIn (noms RH)
  · github_find_email  — API GitHub orgs
  · enrich_hunter      — orchestrateur Phase 5 Hunter
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from urllib.parse import quote as url_quote

import requests

from .constants import WHOIS_IGNORE_RE
from .email_pattern import generate_alternatives, guess_email
from .infra import RateLimiter
from .models import Company, _domain

if TYPE_CHECKING:
    pass   # imports de type uniquement — évite les cycles au runtime


# ══════════════════════════════════════════════════════════════════════════════
# RÉSULTAT UNIFIÉ
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class EmailResult:
    """
    Résultat unifié retourné par HunterClient, SnovClient et ApolloClient.

    FIX-9 (origine) : remplace les tuples de longueurs variables (2, 3 ou 5 éléments)
    qui étaient difficiles à destructurer et sources de bugs silencieux.
    """
    email:        str       = ""
    name:         str       = ""
    role:         str       = ""
    source:       str       = "pattern"
    alternatives: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        """Truthy si un email a été trouvé."""
        return bool(self.email)


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 5 — HUNTER.IO
# ══════════════════════════════════════════════════════════════════════════════

class HunterClient:
    """
    Client Hunter.io — Phase 5.
    Rate limiting et session HTTP partagée — indépendants du monkey-patch global de run().
    Free tier : 50 crédits/mois (modèle unifié : 1 crédit = 1 recherche OU 1 vérification).
    """
    API_BASE = "https://api.hunter.io/v2"

    def __init__(self, api_key: str, rate_limiter: "RateLimiter | None" = None):
        self.api_key      = api_key
        self.calls        = 0
        self.rate_limiter = rate_limiter
        self._session     = requests.Session()
        self._session.headers.update({"User-Agent": "Mozilla/5.0"})

    def _api_get(self, url: str, params: "dict | None" = None, timeout: int = 10) -> "requests.Response":
        """GET throttlé via rate_limiter."""
        if self.rate_limiter:
            self.rate_limiter.wait()
        return self._session.get(url, params=params, timeout=timeout)

    def credits_left(self) -> "int | None":
        """
        Interroge /account (GRATUIT — ne consomme aucun crédit) pour connaître le
        nombre de recherches encore disponibles ce mois-ci.

        Retourne le nombre de crédits restants, ou None si l'info est indisponible
        (clé invalide, format inattendu, réseau). Permet de ne jamais dépasser le
        quota réel avant même de lancer la Phase 5.
        """
        if not self.api_key:
            return None
        try:
            resp = self._api_get(f"{self.API_BASE}/account",
                                  params={"api_key": self.api_key})
            if resp.status_code != 200:
                return None
            data = resp.json().get("data", {})
            reqs = data.get("requests", {})
            # Modèle historique : requests.searches.{used, available}
            searches = reqs.get("searches", {})
            avail = searches.get("available")
            used  = searches.get("used")
            if isinstance(avail, int) and isinstance(used, int):
                return max(0, avail - used)
            # Modèle "credits" unifié : data.calls.{used, available}
            calls = data.get("calls", {})
            avail = calls.get("available")
            used  = calls.get("used")
            if isinstance(avail, int) and isinstance(used, int):
                return max(0, avail - used)
        except Exception:
            return None
        return None

    def find(self, domain: str) -> EmailResult:
        """Retourne un EmailResult pour le domaine (email RH le plus pertinent)."""
        _empty = EmailResult()
        if not domain or not self.api_key:
            return _empty

        url = f"{self.API_BASE}/domain-search"
        params = {"domain": domain, "api_key": self.api_key, "type": "personal", "limit": 10}
        try:
            resp = self._api_get(url, params=params)
            self.calls += 1
            if resp.status_code in (401, 403):
                print("   ⚠  Hunter.io : clé API invalide.")
                return _empty
            if resp.status_code == 429:
                print("   ⚠  Hunter.io : quota mensuel atteint.")
                return _empty
            emails: list[dict] = resp.json().get("data", {}).get("emails", [])
        except Exception as e:
            print(f"   ⚠  Hunter.io : {e}")
            return _empty

        if not emails:
            return _empty

        HR_KW = ["rh", "hr", "talent", "recruit", "hiring", "people", "drh"]
        chosen = None
        for kw in HR_KW:
            for e in emails:
                if kw in (e.get("position") or "").lower():
                    chosen = e
                    break
            if chosen:
                break
        if not chosen:
            chosen = max(emails, key=lambda e: e.get("confidence", 0))

        chosen_email = chosen.get("value", "")
        confidence   = chosen.get("confidence", 0)
        src          = "hunter_verified" if confidence >= 90 else "hunter_found"
        alts = [e.get("value", "") for e in emails if e.get("value") and e.get("value") != chosen_email]
        for alt in generate_alternatives(domain, exclude=chosen_email):
            if alt not in alts:
                alts.append(alt)

        return EmailResult(
            email        = chosen_email,
            name         = f"{chosen.get('first_name','')} {chosen.get('last_name','')}".strip(),
            role         = chosen.get("position", ""),
            source       = src,
            alternatives = alts,
        )

    def find_domain_by_name(self, company_name: str) -> str:
        """Résout un nom d'entreprise → domaine via Hunter.io (Phase 3b)."""
        if not company_name or not self.api_key:
            return ""
        url = f"{self.API_BASE}/domain-search"
        try:
            resp = self._api_get(url, params={"company": company_name,
                                              "api_key": self.api_key, "limit": 1})
            self.calls += 1
            if resp.status_code != 200:
                return ""
            return resp.json().get("data", {}).get("domain", "") or ""
        except Exception:
            return ""

    def get_email_format(self, domain: str) -> str:
        """Retourne le format d'email dominant du domaine (ex: '{first}.{last}')."""
        if not domain or not self.api_key:
            return ""
        url = f"{self.API_BASE}/domain-search"
        try:
            resp = self._api_get(url, params={"domain": domain,
                                              "api_key": self.api_key, "limit": 1})
            self.calls += 1
            if resp.status_code != 200:
                return ""
            return resp.json().get("data", {}).get("pattern", "") or ""
        except Exception:
            return ""


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS LINKEDIN + GITHUB
# ══════════════════════════════════════════════════════════════════════════════

def apply_email_format(fmt: str, first: str, last: str, domain: str) -> str:
    """
    Transforme un format Hunter (ex : '{first}.{last}') + prénom/nom en email.
    Ex : '{first}.{last}' + 'Jean' + 'Dupont' → 'jean.dupont@acme.fr'
    """
    if not fmt or not domain or not first:
        return ""
    first_n = first.lower().strip()
    last_n  = last.lower().strip()
    result  = fmt
    result  = result.replace("{first}", first_n)
    result  = result.replace("{last}",  last_n)
    result  = result.replace("{f}",     first_n[:1] if first_n else "")
    result  = result.replace("{l}",     last_n[:1]  if last_n  else "")
    result  = re.sub(r"\{[^}]+\}", "", result).strip(".")
    if not result:
        return ""
    candidate = f"{result}@{domain}" if "@" not in result else result
    return candidate if re.match(r"^[\w.+-]+@[\w.-]+\.[a-z]{2,}$", candidate, re.IGNORECASE) else ""


_LINKEDIN_NAME_RE = re.compile(
    r"([A-ZÀ-Ÿ][a-zà-ÿ'\-]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ'\-]+)+)"
    r"\s*[—\-–|·]\s*"
    r"(?:RH|HR|Recrut\w*|Talent|DRH|People|Chargée?\s+(?:de\s+)?recrut\w*|"
    r"Responsable\s+RH|Head\s+of\s+HR|Human\s+Res)",
    re.IGNORECASE,
)


def linkedin_find_hr(
    company_name: str,
    domain: str,
    fetcher,
) -> list[tuple[str, str]]:
    """
    Trouve des noms de personnes RH via DuckDuckGo HTML → snippets LinkedIn.
    Retourne une liste de (prénom, nom) sans jamais visiter LinkedIn directement.
    """
    names: list[tuple[str, str]] = []
    query = (
        f'site:linkedin.com/in "{company_name}" '
        f'(RH OR recrutement OR DRH OR "talent acquisition" OR "HR manager" OR recruiter)'
    )
    try:
        search_url = f"https://html.duckduckgo.com/html/?q={url_quote(query)}"
        page = fetcher.get(search_url)
        if not page:
            return names
        text = page.get_text() if hasattr(page, "get_text") else ""
        for m in _LINKEDIN_NAME_RE.finditer(text):
            full  = m.group(1).strip()
            parts = full.split()
            if len(parts) >= 2:
                names.append((parts[0], " ".join(parts[1:])))
            if len(names) >= 3:
                break
    except Exception:
        pass
    return names


def github_find_email(company_name: str, domain: str, github_token: str = "") -> str:
    """
    Cherche l'email public d'une organisation GitHub.
    60 req/h sans auth, 5000 req/h avec token.
    """
    if not company_name and not domain:
        return ""

    def _slug(s: str) -> str:
        for fr, en in [("é","e"),("è","e"),("ê","e"),("à","a"),("â","a"),
                       ("î","i"),("ô","o"),("ù","u"),("û","u"),("ç","c")]:
            s = s.lower().replace(fr, en)
        return re.sub(r"[^a-z0-9-]", "-", s).strip("-")[:40]

    headers = {"Accept": "application/vnd.github.v3+json"}
    if github_token:
        headers["Authorization"] = f"token {github_token}"

    for org in dict.fromkeys([_slug(company_name), domain.split(".")[0]]):
        try:
            resp = requests.get(f"https://api.github.com/orgs/{org}",
                                headers=headers, timeout=8)
            if resp.status_code == 200:
                email = (resp.json().get("email") or "").strip()
                if email and "@" in email and not WHOIS_IGNORE_RE.search(email):
                    return email
        except Exception:
            pass
    return ""


# ══════════════════════════════════════════════════════════════════════════════
# ORCHESTRATEURS PHASE 5
# ══════════════════════════════════════════════════════════════════════════════

def enrich_hunter(
    companies: list[Company],
    hunter: HunterClient,
    delay: float,
    use_pattern: bool = True,
    deadline=None,
    max_searches: int = 20,
) -> None:
    """
    Enrichit avec Hunter.io les entreprises sans email réel.
    use_pattern=False → laisse l'email vide si Hunter ne trouve rien.
    B0-7 : deadline optionnel — arrêt propre si la limite de temps est atteinte.

    Protection quota (free tier = 50 crédits/mois) :
      - max_searches : plafond DUR de recherches Hunter pour CE run (défaut 20).
      - On interroge /account (gratuit) pour connaître le quota réel restant et on
        prend le minimum des deux → jamais de dépassement, jamais de surprise.
      - Les domaines au-delà du budget retombent sur le pattern (ou no_email).
    """
    need = [c for c in companies if not c.contact_email and c.website]
    if not need:
        print("\n🎯  Phase 5 : Hunter.io — aucune entreprise sans email à enrichir")
        return
    if deadline is not None and deadline.expired():
        print(f"\n⏱   Phase 5 Hunter.io : limite temps atteinte — {len(need)} entreprises sautées.")
        return

    # ── Budget de recherches : min(plafond run, quota réel restant) ─────────────
    budget = max(0, int(max_searches))
    real_left = hunter.credits_left()   # None si indisponible (ne consomme rien)
    if real_left is not None:
        budget = min(budget, real_left)
        print(f"   ℹ️  Hunter.io : {real_left} crédit(s) restant(s) ce mois-ci.")
    if budget <= 0:
        print(f"\n⏭   Phase 5 Hunter.io : quota épuisé ou plafond=0 — {len(need)} domaines "
              f"basculés en {'pattern' if use_pattern else 'no_email'}.")
        # Bascule directe sans aucun appel API.
        if use_pattern:
            for c in need:
                domain = _domain(c.website)
                if domain:
                    c.contact_email      = guess_email(domain)
                    c.email_source       = "pattern"
                    c.email_alternatives = generate_alternatives(domain, exclude=c.contact_email)
        else:
            for c in need:
                c.email_source = "no_email"
        return

    # Au-delà du budget : on ne fera PAS d'appel Hunter (économie de quota).
    to_query = need[:budget]
    overflow = need[budget:]
    print(f"\n🎯  Phase 5 : Hunter.io ({len(to_query)} domaines interrogés "
          f"sur {len(need)} sans email · plafond run={max_searches})…")
    found = 0
    pattern_fallback = 0
    for i, c in enumerate(to_query, 1):
        if deadline is not None and deadline.expired():
            print(f"   ⏱   Limite de temps — Hunter arrêté ({i-1}/{len(to_query)} traités)")
            # Les non-traités rejoignent l'overflow pour la bascule pattern.
            overflow = to_query[i-1:] + overflow
            break
        domain = _domain(c.website)
        if not domain:
            continue
        print(f"   [{i}/{len(to_query)}] {domain}…", end=" ", flush=True)
        result = hunter.find(domain)
        if result:
            c.contact_email      = result.email
            c.email_source       = result.source
            c.email_alternatives = result.alternatives
            if result.name:
                c.contact_name = result.name
            if result.role:
                c.contact_role = result.role
            badge = "✅" if result.source == "hunter_verified" else "🟡"
            print(f"{badge} {result.email}")
            found += 1
        elif use_pattern:
            c.contact_email      = guess_email(domain)
            c.email_source       = "pattern"
            c.email_alternatives = generate_alternatives(domain, exclude=c.contact_email)
            print("⚪ pattern")
            pattern_fallback += 1
        else:
            c.email_source = "no_email"
            print("❌ aucun email trouvé")
        time.sleep(delay * 0.5)

    # Domaines au-delà du budget Hunter (non interrogés) : pas d'appel API gaspillé.
    if overflow:
        print(f"   ⏭   {len(overflow)} domaine(s) au-delà du plafond → "
              f"{'pattern' if use_pattern else 'no_email'} (quota préservé).")
        for c in overflow:
            domain = _domain(c.website)
            if use_pattern and domain:
                c.contact_email      = guess_email(domain)
                c.email_source       = "pattern"
                c.email_alternatives = generate_alternatives(domain, exclude=c.contact_email)
            elif not use_pattern:
                c.email_source = "no_email"

    if use_pattern:
        for c in companies:
            if not c.contact_email:
                domain = _domain(c.website)
                if domain:
                    c.contact_email      = guess_email(domain)
                    c.email_source       = "pattern"
                    c.email_alternatives = generate_alternatives(domain, exclude=c.contact_email)

    print(f"   → {found}/{len(to_query)} via Hunter · {pattern_fallback} pattern · "
          f"{hunter.calls} appels API · {len(overflow)} hors budget")

