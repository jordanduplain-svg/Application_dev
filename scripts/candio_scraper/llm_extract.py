"""
llm_extract — Extraction structurée via LLM local (Ollama) ou cloud (OpenAI).

Trois extracteurs ciblés où les regex/CSS échouent souvent :
  - extract_contact_from_page() : email RH + nom + rôle depuis une page /contact ou /équipe
  - extract_recruiter_from_page() : identification du contact RH sur /a-propos
  - extract_tech_stack_from_text() : liste des techs mentionnées sur /careers

Stratégie :
  1. Si Ollama est joignable → utiliser le modèle local (gratuit, privé)
  2. Sinon, si une clé OpenAI est fournie → fallback cloud (rapide, payant)
  3. Sinon → retourne None, l'appelant garde son extraction regex de fallback

Cache : chaque extraction est mise en cache 7 jours via PersistentCache pour
éviter de re-LLM la même page si on relance le scraping. Budget configurable
(max N appels par run) pour éviter les abus.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from typing import Optional

import requests


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION & CLIENT
# ══════════════════════════════════════════════════════════════════════════════

class LLMConfig:
    """Configuration immuable d'un client LLM. Construite depuis CLI/env."""

    def __init__(
        self,
        provider:     str = "ollama",           # "ollama" | "openai" | ""
        ollama_url:   str = "http://localhost:11434",
        ollama_model: str = "qwen2.5:3b",
        openai_key:   str = "",
        openai_model: str = "gpt-4o-mini",
        claude_key:   str = "",
        claude_model: str = "claude-haiku-4-5",
        budget:       int = 100,                # max appels LLM par run
        timeout:      int = 45,                 # secondes par appel (Ollama sur CPU peut prendre 20-40 s)
        warmup_timeout: int = 90,               # cold-start (chargement modèle) — plus long pour les gros modèles
        num_ctx:      int = 4096,               # fenêtre de contexte Ollama (tokens). Plus grand = + de source + note + longue
    ):
        # Variables env en fallback (utile pour configuration via Electron spawn env)
        self.provider     = (provider or os.environ.get("CANDIO_LLM", "")).lower().strip()
        self.ollama_url   = ollama_url   or os.environ.get("OLLAMA_URL", "http://localhost:11434")
        self.ollama_model = ollama_model or os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")
        self.openai_key   = openai_key   or os.environ.get("OPENAI_API_KEY", "")
        self.openai_model = openai_model
        self.claude_key   = claude_key   or os.environ.get("ANTHROPIC_API_KEY", "")
        self.claude_model = claude_model or os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5")
        self.budget       = budget
        self.timeout      = timeout
        self.warmup_timeout = warmup_timeout
        self.num_ctx      = num_ctx

    def is_active(self) -> bool:
        """True si une source LLM est utilisable (vérification réseau légère)."""
        if self.provider == "ollama":
            return self._ping_ollama()
        if self.provider == "openai":
            return bool(self.openai_key)
        if self.provider == "claude":
            return bool(self.claude_key)
        return False

    def model_label(self) -> str:
        """Modèle affiché selon le provider actif (pour les logs)."""
        return {"ollama": self.ollama_model, "openai": self.openai_model,
                "claude": self.claude_model}.get(self.provider, "")

    def _ping_ollama(self) -> bool:
        try:
            r = requests.get(f"{self.ollama_url}/api/tags", timeout=2)
            return r.status_code == 200
        except Exception:
            return False


class LLMClient:
    """
    Client thread-safe avec budget partagé + cache.

    Le budget protège contre l'explosion d'appels (ex : 500 entreprises × 5 pages
    crawlées = 2500 appels potentiels). Quand le budget est épuisé, les appels
    suivants retournent None et l'extraction tombe sur le fallback regex.
    """

    # Coupe-circuit : après N échecs CONSÉCUTIFS (timeout, Ollama trop lent /
    # injoignable), on désactive le LLM pour le reste du run. Évite que chaque
    # appel bloque `timeout` s × dizaines d'entreprises → run qui pend.
    _MAX_CONSECUTIVE_FAILS = 2

    # Timeout du warm-up (chargement modèle en RAM) — plus long que les appels
    # normaux car le premier appel Ollama charge le modèle (~20-60 s selon la machine).
    _WARMUP_TIMEOUT = 90

    def __init__(self, config: LLMConfig, cache=None):
        self._config = config
        self._cache  = cache             # PersistentCache | None
        self._used   = 0
        self._fails  = 0                 # échecs consécutifs (coupe-circuit)
        self._lock   = threading.Lock()
        # Vérifie joignabilité basique (ping réseau) — rapide.
        self._active = config.is_active()
        if self._active and config.provider == "ollama":
            # Warm-up : le 1er appel Ollama charge le modèle en RAM (cold start
            # ~20-60 s). On le fait ici, AVANT le crawl, avec un timeout généreux.
            # → les vrais appels en Phase 4 seront instantanés.
            # → si le warm-up échoue, _active=False immédiatement, sans jamais
            #   polluer le circuit breaker (le compteur _fails reste à 0).
            print(f"   ⏳  Chargement modèle Ollama ({config.ollama_model}) — jusqu'à {config.warmup_timeout} s…", flush=True)
            if self._warmup_ollama():
                print(f"   🤖  LLM prêt : {config.provider} / {config.model_label()}", flush=True)
            else:
                self._active = False
                print("   ⚠  Ollama inaccessible ou trop lent au démarrage — LLM désactivé pour ce run.", flush=True)
        elif self._active:
            print(f"   🤖  LLM actif : {config.provider} / {config.model_label()}", flush=True)
        elif config.provider:
            print(f"   ⚠  LLM {config.provider} demandé mais inaccessible — extraction LLM désactivée.", flush=True)

    def _warmup_ollama(self) -> bool:
        """
        Appel trivial pour charger le modèle en RAM avant le crawl.
        Timeout généreux (_WARMUP_TIMEOUT s) pour absorber le cold start.
        Retourne True si le modèle répond, False sinon.
        """
        try:
            resp = requests.post(
                f"{self._config.ollama_url}/api/generate",
                json={
                    "model":  self._config.ollama_model,
                    "prompt": "ok",
                    "stream": False,
                    "options": {"num_predict": 1},   # 1 token → le plus court possible
                },
                timeout=self._config.warmup_timeout,
            )
            return resp.status_code == 200
        except Exception:
            return False

    # ── API publique ───────────────────────────────────────────────────────────

    def available(self) -> bool:
        """True si le client peut traiter de nouvelles requêtes (budget + connectivité)."""
        return self._active and self._used < self._config.budget

    def remaining_budget(self) -> int:
        return max(0, self._config.budget - self._used)

    def ask_json(self, prompt: str, system: str = "", cache_key: str = "") -> Optional[dict]:
        """
        Envoie un prompt au LLM en demandant une réponse JSON.
        Retourne le dict parsé, ou None si LLM down / budget épuisé / parse échoue.
        Cache 7 jours sur cache_key si fourni.
        """
        if not self.available():
            return None

        # 1. Tentative cache
        if cache_key and self._cache:
            cached = self._cache.get_json(f"llm:{cache_key}")
            if cached is not None:
                return cached if cached else None  # {} ↔ pas de match (négatif)

        # 2. Appel LLM
        with self._lock:
            if not self.available():
                return None
            self._used += 1

        raw = ""
        try:
            if self._config.provider == "ollama":
                raw = self._call_ollama(prompt, system)
            elif self._config.provider == "openai":
                raw = self._call_openai(prompt, system)
            elif self._config.provider == "claude":
                raw = self._call_claude(prompt, system)
            self._fails = 0   # succès → on réarme le coupe-circuit
        except Exception as e:
            # Coupe-circuit : trop d'échecs consécutifs → on désactive le LLM pour
            # le reste du run (sinon chaque appel bloque `timeout` s et fait pendre).
            self._fails += 1
            if self._fails >= self._MAX_CONSECUTIVE_FAILS:
                self._active = False
                print(f"   ⛔  LLM désactivé pour ce run après {self._fails} échecs "
                      f"(trop lent / injoignable) — on continue sans LLM.", flush=True)
            else:
                print(f"   ⚠  LLM erreur : {e}", flush=True)
            return None

        if not raw:
            return None

        # 3. Parse JSON (tolère le bruit autour)
        result = _extract_json(raw)

        # 4. Cache (positif ET négatif — éviter de re-LLM les pages stériles)
        if cache_key and self._cache:
            try:
                self._cache.set_json(
                    f"llm:{cache_key}",
                    result or {},                   # {} = négatif explicite
                    ttl=60 * 60 * 24 * 7,
                )
            except Exception:
                pass

        return result

    # ── Backends ───────────────────────────────────────────────────────────────

    def _call_ollama(self, prompt: str, system: str) -> str:
        """Ollama /api/generate non-streaming avec format=json forcé."""
        resp = requests.post(
            f"{self._config.ollama_url}/api/generate",
            json={
                "model":   self._config.ollama_model,
                "prompt":  prompt,
                "system":  system,
                "stream":  False,
                "format":  "json",     # le modèle est forcé à produire du JSON
                "options": {"temperature": 0.1, "num_ctx": self._config.num_ctx},
            },
            timeout=self._config.timeout,
        )
        if resp.status_code != 200:
            return ""
        return resp.json().get("response", "")

    def _call_openai(self, prompt: str, system: str) -> str:
        """OpenAI Chat Completions avec response_format=json_object."""
        if not self._config.openai_key:
            return ""
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self._config.openai_key}",
                "Content-Type":  "application/json",
            },
            json={
                "model": self._config.openai_model,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system or "Reply with strict JSON only."},
                    {"role": "user",   "content": prompt},
                ],
                "temperature": 0.1,
            },
            timeout=self._config.timeout,
        )
        if resp.status_code != 200:
            return ""
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    def _call_claude(self, prompt: str, system: str) -> str:
        """Anthropic Messages API (Claude). Réponse texte attendue en JSON strict."""
        if not self._config.claude_key:
            return ""
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key":         self._config.claude_key,
                "anthropic-version": "2023-06-01",
                "Content-Type":      "application/json",
            },
            json={
                "model":      self._config.claude_model,
                "max_tokens": 1024,
                "system":     system or "Reply with strict JSON only, no prose.",
                "messages":   [{"role": "user", "content": prompt}],
            },
            timeout=self._config.timeout,
        )
        if resp.status_code != 200:
            return ""
        data = resp.json()
        # content = liste de blocs ; on concatène le texte.
        parts = data.get("content") or []
        return "".join(b.get("text", "") for b in parts if isinstance(b, dict))


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _extract_json(raw: str) -> Optional[dict]:
    """
    Parse une chaîne JSON tolérant au bruit autour (markdown ``` block, texte intro…).
    Retourne le premier dict valide trouvé, ou None.
    """
    if not raw:
        return None
    raw = raw.strip()
    # Strip markdown code fences
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1] if raw.count("```") >= 2 else raw.lstrip("```")
        if raw.startswith("json"):
            raw = raw[4:].lstrip()
    # Trouve le premier { et le } qui le ferme
    try:
        return json.loads(raw)
    except Exception:
        pass
    # Fallback : tentative greedy avec recherche d'accolades
    start = raw.find("{")
    if start < 0:
        return None
    depth = 0
    for i, ch in enumerate(raw[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(raw[start:i + 1])
                except Exception:
                    return None
    return None


def _cache_key(*parts: str) -> str:
    """Clé de cache stable pour le LLM (URL + version prompt + modèle)."""
    h = hashlib.md5("|".join(parts).encode("utf-8")).hexdigest()[:16]
    return h


def _truncate(text: str, max_chars: int = 6000) -> str:
    """Tronque le texte autour des emails @ trouvés (priorité aux zones intéressantes)."""
    if len(text) <= max_chars:
        return text
    # Conserver les ~3000 premiers chars + ~3000 chars autour du premier @ trouvé
    head = text[:max_chars // 2]
    at_pos = text.find("@", max_chars // 2)
    if at_pos > 0:
        tail = text[max(at_pos - 1500, max_chars // 2): at_pos + 1500]
        return head + "\n\n[...]\n\n" + tail
    return head


# ══════════════════════════════════════════════════════════════════════════════
# EXTRACTEURS — interfaces publiques utilisées par enrich.py
# ══════════════════════════════════════════════════════════════════════════════

def extract_contact_from_page(
    client: LLMClient,
    page_text: str,
    site_domain: str,
    page_url: str = "",
) -> Optional[dict]:
    """
    Cherche un contact RH sur une page de contact/équipe.

    Retourne :
      {"email": "claire.martin@société.fr", "name": "Claire Martin",
       "role": "DRH", "confidence": 0.9}
    ou None si rien trouvé / LLM indisponible.

    Le LLM est plus robuste que les regex pour :
      - emails obfusqués (« contact [at] société (point) fr »)
      - mises en page non standard
      - différencier email perso vs pro vs RH
    """
    if not client.available() or not page_text:
        return None

    text = _truncate(page_text, max_chars=6000)
    system = (
        "You are a precise data extraction tool. "
        "Output ONLY a JSON object, no commentary, no explanation."
    )
    prompt = f"""Find the HR (human resources / recruitment) contact info on this webpage.
Target domain: {site_domain}
- The email must contain the target domain ({site_domain}) — otherwise return empty.
- Deobfuscate emails like "contact [at] domain (point) com" or "contact AT domain DOT com".
- Look for French roles: DRH, Responsable RH, Talent Acquisition, Chargé/Chargée de Recrutement, People & Culture.
- Look for English roles: HR Manager, Talent Acquisition Manager, Head of People, Recruiter.

Output strict JSON with these keys (use empty string "" if not found):
{{"email": "...", "name": "...", "role": "...", "confidence": 0.0-1.0}}

Webpage content:
---
{text}
---

JSON:"""

    key = _cache_key("contact", site_domain, page_url, client._config.ollama_model)
    result = client.ask_json(prompt, system=system, cache_key=key)
    if not result:
        return None

    # Validation stricte côté Python : l'email doit appartenir au domaine attendu
    email = (result.get("email") or "").strip().lower()
    if email and site_domain.lower() not in email:
        result["email"] = ""

    return result


def extract_recruiter_from_page(
    client: LLMClient,
    page_text: str,
    page_url: str = "",
) -> Optional[dict]:
    """
    Cherche le nom + rôle du recruteur sur une page /equipe ou /a-propos.

    Retourne {"name": "Claire Martin", "role": "DRH"} ou None.
    Ne retourne PAS d'email — c'est le job de extract_contact_from_page.
    """
    if not client.available() or not page_text:
        return None

    text = _truncate(page_text, max_chars=5000)
    system = "Output ONLY a JSON object. No explanation, no markdown."
    prompt = f"""Find the person responsible for HR / recruitment on this team/about page.
Look for someone with a title like:
  - French: DRH, Directeur/Directrice des Ressources Humaines, Responsable RH,
            Talent Acquisition, Recruteur/Recruteuse, Chargé(e) de Recrutement,
            People & Culture, Head of People.
  - English: HR Manager, Talent Acquisition Manager, Head of People, Recruiter.

Output strict JSON:
{{"name": "First Last", "role": "Job Title", "confidence": 0.0-1.0}}

If nothing found:
{{"name": "", "role": "", "confidence": 0}}

Page text:
---
{text}
---

JSON:"""

    key = _cache_key("recruiter", page_url, client._config.ollama_model)
    return client.ask_json(prompt, system=system, cache_key=key)


def extract_tech_stack_from_text(
    client: LLMClient,
    text: str,
    page_url: str = "",
) -> Optional[list[str]]:
    """
    Extrait les technologies/outils mentionnés sur une page (typiquement /careers
    ou un descriptif d'offre d'emploi).

    Retourne une liste de techs normalisées : ["Python", "Snowflake", "dbt", "Airflow"]
    Filtre automatiquement les mots non-techniques (entreprises, soft skills).
    """
    if not client.available() or not text:
        return None

    text = _truncate(text, max_chars=5000)
    system = "Output ONLY JSON. No markdown."
    prompt = f"""Extract the list of technical tools and programming languages mentioned in this text.
Include only concrete tech: programming languages, frameworks, databases, cloud services,
data tools, DevOps tools (ex: Python, React, AWS, Snowflake, dbt, Kubernetes, Power BI…).
EXCLUDE: company names, soft skills, certifications, generic terms like "Cloud", "Data", "AI".

Output strict JSON:
{{"stack": ["Tech1", "Tech2", "Tech3"]}}

If no tech found:
{{"stack": []}}

Text:
---
{text}
---

JSON:"""

    key = _cache_key("stack", page_url, client._config.ollama_model)
    result = client.ask_json(prompt, system=system, cache_key=key)
    if not result:
        return None
    stack = result.get("stack")
    if not isinstance(stack, list):
        return None
    # Normalisation : trim + dédup + max 20
    seen, out = set(), []
    for item in stack:
        if not isinstance(item, str):
            continue
        t = item.strip()
        if not t or t.lower() in seen:
            continue
        seen.add(t.lower())
        out.append(t)
        if len(out) >= 20:
            break
    return out
