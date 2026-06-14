"""
email_pattern — Détection du format d'email d'un domaine + construction d'emails nominatifs.

Objectif : transformer "rh@acme.fr" (générique, bounce) en "claire.martin@acme.fr"
(nominatif, +30% d'ouverture).

Deux voies de détection :
  1. Inférence structurelle (sans connaître le nom) — depuis n'importe quel email
     nominatif trouvé sur le site. "marie.dupont@" → pattern "{first}.{last}".
  2. Reverse-engineering (avec le nom) — si on connaît la personne derrière un email.
     ("jean.dupont@acme.fr", "Jean", "Dupont") → "{first}.{last}".

Puis on applique le pattern au contact prioritaire (CEO/RH/manager) trouvé par le crawler.
"""

from __future__ import annotations

import re
import unicodedata

from .constants import GENERIC_PREFIXES

# ── Patterns de mailbox RH courants — utilisés par generate_alternatives() et
# smtp_batch_patterns(). Extraits depuis enrich.py (B2-1 split).
# Fusion de HR_PATTERNS (8) + HR_EMAIL_PATTERNS (12) → liste complète sans doublon.
HR_PATTERNS: list[str] = [
    "rh", "recrutement", "careers", "contact", "jobs", "talent",
    "drh", "hr", "hiring", "people", "recrut", "emploi",
]


def generate_alternatives(domain: str, exclude: str = "") -> list[str]:
    """Génère les alternatives email RH pour un domaine (rh@, jobs@, careers@…)."""
    if not domain:
        return []
    return [f"{p}@{domain}" for p in HR_PATTERNS if f"{p}@{domain}" != exclude]


def guess_email(domain: str) -> str:
    """Retourne l'email RH de premier recours pour un domaine (rh@)."""
    if not domain:
        return ""
    return f"{HR_PATTERNS[0]}@{domain}"

# Patterns d'email courants, du plus fréquent au moins fréquent (France + international).
# Ordre = priorité lors du reverse-engineering exact.
KNOWN_PATTERNS = [
    "{first}.{last}",   # claire.martin    (le plus courant en France ~60%)
    "{f}{last}",        # cmartin
    "{first}{last}",    # clairemartin
    "{f}.{last}",       # c.martin
    "{first}_{last}",   # claire_martin
    "{first}-{last}",   # claire-martin
    "{last}.{first}",   # martin.claire
    "{last}{f}",        # martinc
    "{first}",          # claire          (ambigu — testé tard)
    "{last}",           # martin          (ambigu — testé tard)
    "{f}{l}",           # cm              (rare, très ambigu)
]


def _strip_accents(s: str) -> str:
    """Retire les accents : 'Clément' → 'clement'."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _norm(s: str) -> str:
    """Normalise un prénom/nom pour la construction d'email : sans accent, minuscule, alphanumérique."""
    s = _strip_accents((s or "").lower().strip())
    return re.sub(r"[^a-z0-9]", "", s)


def split_name(full_name: str) -> tuple[str, str]:
    """
    Sépare un nom complet en (prénom, nom). Heuristique simple :
    premier mot = prénom, dernier mot = nom. Gère les particules (de, le, van…).
    """
    parts = [p for p in re.split(r"\s+", (full_name or "").strip()) if p]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    first = parts[0]
    # Le nom = dernier mot (on ignore les particules au milieu)
    last = parts[-1]
    return first, last


def build_email(pattern: str, first: str, last: str, domain: str) -> str:
    """
    Construit un email depuis un pattern + prénom/nom + domaine.
    Ex : build_email("{first}.{last}", "Claire", "Martin", "acme.fr") → "claire.martin@acme.fr"
    Retourne "" si invalide.
    """
    if not pattern or not domain:
        return ""
    f, l = _norm(first), _norm(last)
    if not f and not l:
        return ""
    local = pattern
    local = local.replace("{first}", f)
    local = local.replace("{last}",  l)
    local = local.replace("{f}", f[:1] if f else "")
    local = local.replace("{l}", l[:1] if l else "")
    # Supprime les placeholders non résolus + nettoie les séparateurs orphelins
    local = re.sub(r"\{[^}]+\}", "", local).strip("._-")
    local = re.sub(r"[._-]{2,}", ".", local)  # double séparateur → simple
    if not local:
        return ""
    # removeprefix (PAS lstrip) : lstrip('www.') retire tout caractère de {w,.}
    # en tête → corromprait 'wavestone.com' en 'avestone.com'.
    email = f"{local}@{domain.lower().removeprefix('www.')}"
    return email if re.match(r"^[\w.+-]+@[\w.-]+\.[a-z]{2,}$", email, re.IGNORECASE) else ""


def detect_pattern_from_known(email: str, first: str, last: str) -> str:
    """
    Reverse-engineering EXACT : connaissant l'email d'une personne ET son nom,
    retrouve le pattern utilisé par le domaine.

    Ex : detect_pattern_from_known("jean.dupont@acme.fr", "Jean", "Dupont") → "{first}.{last}"
    Retourne "" si aucun pattern connu ne correspond.
    """
    if not email or "@" not in email:
        return ""
    local = email.split("@")[0].lower()
    f, l = _norm(first), _norm(last)
    if not f or not l:
        return ""
    for pat in KNOWN_PATTERNS:
        candidate = pat
        candidate = candidate.replace("{first}", f).replace("{last}", l)
        candidate = candidate.replace("{f}", f[:1]).replace("{l}", l[:1])
        candidate = re.sub(r"\{[^}]+\}", "", candidate).strip("._-")
        if candidate and candidate == local:
            return pat
    return ""


def infer_pattern_from_local(local_or_email: str) -> str:
    """
    Inférence STRUCTURELLE : devine le pattern à partir de la STRUCTURE d'un email
    nominatif, SANS connaître le nom de la personne.

    Ex : "marie.dupont@acme.fr" → "{first}.{last}"
         "mdupont@acme.fr"       → "{f}{last}"
         "marie-dupont@..."      → "{first}-{last}"

    Hypothèse France : ordre prénom→nom (le plus courant). Retourne "" si générique ou ambigu.
    """
    local = local_or_email.split("@")[0].lower().strip()
    if not local or local in GENERIC_PREFIXES:
        return ""

    # Deux parties alpha séparées par . _ -
    m = re.match(r"^([a-z]+)([._-])([a-z]+)$", local)
    if m:
        a, sep, b = m.groups()
        sep_map = {".": ".", "_": "_", "-": "-"}
        s = sep_map[sep]
        if len(a) == 1:
            return f"{{f}}{s}{{last}}"       # j.dupont → {f}.{last}
        if len(b) == 1:
            return f"{{first}}{s}{{l}}"      # claire.m → {first}.{l} (rare)
        return f"{{first}}{s}{{last}}"       # claire.martin → {first}.{last}

    # Mot unique sans séparateur ("sophie", "mdupont", "martin") → AMBIGU.
    # "sophie" (prénom) et "mdupont" ({f}{last}) sont structurellement identiques :
    # impossible de distinguer de façon fiable. Comme un pattern faux = bounce,
    # on refuse de deviner sur un mot unique. On ne garde que les patterns à séparateur.
    return ""


def is_nominative(email: str) -> bool:
    """
    True si l'email ressemble à celui d'une PERSONNE (pas une boîte générique).
    Ex : "claire.martin@" → True ; "contact@" / "rh@" / "info@" → False.
    """
    if not email or "@" not in email:
        return False
    local, _, domain = email.partition("@")
    local = local.lower()
    if local in GENERIC_PREFIXES:
        return False
    # Point G (audit) : exclure le local-part égal au NOM du domaine
    # (ex : "accenture@accenture.com") — c'est l'entreprise, pas une personne,
    # et ça fausserait la détection de pattern.
    domain_core = domain.lower().removeprefix("www.").split(".")[0]
    if local == domain_core:
        return False
    # Un séparateur nom = bon signe ; ou un mot unique assez long non générique
    if re.match(r"^[a-z]+[._-][a-z]+$", local):
        return True
    # Mot unique : nominatif seulement s'il n'est pas générique et > 2 lettres
    if re.match(r"^[a-z]{3,}$", local) and local not in GENERIC_PREFIXES:
        # Prudence : "sales", "press" déjà exclus par GENERIC_PREFIXES
        return True
    return False


def detect_domain_pattern(emails: list[str]) -> str:
    """
    Infère le pattern dominant d'un domaine depuis une liste d'emails nominatifs trouvés.
    Vote majoritaire sur les inférences structurelles. Retourne "" si rien d'exploitable.
    """
    votes: dict[str, int] = {}
    for e in emails:
        if not is_nominative(e):
            continue
        pat = infer_pattern_from_local(e)
        if pat:
            votes[pat] = votes.get(pat, 0) + 1
    if not votes:
        return ""
    # Pattern le plus voté (en cas d'égalité, le plus courant via l'ordre KNOWN_PATTERNS)
    best = max(votes.items(), key=lambda kv: (kv[1], -KNOWN_PATTERNS.index(kv[0]) if kv[0] in KNOWN_PATTERNS else 0))
    return best[0]
