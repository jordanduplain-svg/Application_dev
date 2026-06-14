"""
lead_quality — Détection des leads « louches » : le domaine du site/email ne
correspond pas au nom de l'entreprise (homonyme scrapé par erreur, ex. « ITER »
→ itero.com dentaire, « Silicon Store » → svb.com).

Tolérant aux ACRONYMES (Galileo Global Education → ggeedu.com est LÉGITIME) pour
éviter les faux positifs. Ne peut PAS attraper un homonyme qui partage le mot-clé
(ex. « ITER » / itero.com) — limite inhérente, assumée. On ne supprime jamais
automatiquement : on FLAGUE pour que l'utilisateur décide.
"""
from __future__ import annotations

import re
import unicodedata

# Formes juridiques / mots génériques à ignorer dans le nom.
_LEGAL = frozenset({
    "sas", "sasu", "sa", "sarl", "eurl", "sci", "gie", "scp", "snc", "selarl",
    "groupe", "group", "france", "europe", "international", "holding",
    "sud", "est", "ouest", "nord", "centre", "compagnie", "cie", "ets",
    "etablissements", "etablissement", "societe", "ste",
})


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode("ascii")
    return s.lower()


def _tokens(name: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", _norm(name)) if t and t not in _LEGAL]


def _domain_label(url: str) -> str:
    """Label enregistrable (sans www ni TLD) — ex. 'https://www.acme.fr/x' → 'acme'."""
    if not url:
        return ""
    host = re.sub(r"^https?://", "", _norm(url)).split("/")[0]
    host = re.sub(r"^www\.", "", host)
    parts = [p for p in host.split(".") if p]
    if not parts:
        return ""
    label = parts[-2] if len(parts) >= 2 else parts[0]
    return re.sub(r"[^a-z0-9]", "", label)


def is_domain_suspect(name: str, website: str = "", email: str = "") -> bool:
    """True si le domaine ne présente AUCUN lien plausible avec le nom de l'entreprise.

    Utilise le domaine du site ; à défaut, celui de l'email (hors webmail public).
    Renvoie False (= non jugé) si on n'a ni nom exploitable ni domaine."""
    dom = _domain_label(website)
    if not dom and email and "@" in email:
        edom = email.split("@", 1)[1]
        # On n'évalue pas un email sur webmail public (gmail, etc.) — non concluant.
        if not re.search(r"(gmail|yahoo|hotmail|outlook|orange|free|sfr|laposte|wanadoo|icloud)\.", edom):
            dom = _domain_label(edom)
    if not dom:
        return False
    toks = _tokens(name)
    if not toks:
        return False

    for t in toks:
        # Recouvrement direct (token ≥ 3 dans le domaine ou inverse).
        if len(t) >= 3 and (t in dom or dom in t):
            return False
        # Sous-chaîne commune ≥ 4 (gère les rebrands : akkodis ↔ modisfrance via 'odis').
        if len(t) >= 4 and any(t[i:i + 4] in dom for i in range(len(t) - 3)):
            return False

    # Acronyme du nom (1re lettre de chaque mot) : Galileo Global Education → 'gge'.
    acro = "".join(t[0] for t in toks)
    if len(acro) >= 2 and (dom.startswith(acro) or acro in dom):
        return False

    return True  # aucun lien trouvé → louche


# Petit test manuel : python -m candio_scraper.lead_quality
if __name__ == "__main__":
    cases = [
        ("Galileo Global Education", "https://ggeedu.com", False),  # acronyme légitime
        ("NMR - BIO", "https://nmr-bio.com", False),
        ("KEEP IN TOUCH", "https://kit-rh.com", False),            # acronyme KIT
        ("AFB FRANCE", "https://afb-group.fr", False),
        ("VIVERIS", "https://viveris.fr", False),
        ("Silicon Store", "https://svb.com", True),                # homonyme
        ("3 C S I", "https://csis.org", True),
        ("ORIS", "https://fastmag.fr", True),
        ("Agence Quetzal", "https://fle.fr", True),
    ]
    ok = 0
    for n, w, exp in cases:
        got = is_domain_suspect(n, w)
        flag = "OK " if got == exp else "XX "
        ok += got == exp
        print(f"{flag}{n:28} {w:24} suspect={got} (attendu {exp})")
    print(f"{ok}/{len(cases)} corrects")
