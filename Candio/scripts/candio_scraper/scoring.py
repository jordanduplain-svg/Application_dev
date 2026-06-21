"""
scoring — Tri et scoring final des entreprises.

score_and_sort applique freshness + relevance + bonus puis trie.
apply_feedback_scores réintègre les signaux de retour (replied/bounced) de Carreer-ops.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from .models import Company, _domain


# Tables de scoring externalisées — modifiables sans toucher à score_and_sort().
# Surchargeables via --scoring-weights (JSON) : clés "emailBonus" et "sizeBonus".
DEFAULT_EMAIL_BONUS: dict[str, int] = {
    "hunter_verified":  40,
    "manual":           40,
    "linkedin_smtp":    38,  # nom LinkedIn + Hunter format + SMTP confirmé
    "web_crawl":        35,
    "llm_crawl":        35,  # extrait LLM sur le site = qualité crawl
    "apollo_found":     28,
    "snov_found":       28,
    "hunter_found":     20,
    "github_org":       20,  # email trouvé via API GitHub orgs (non vérifié SMTP)
    "whois":            18,
    "linkedin_pattern": 15,
    "pattern_verified": 12,
    # Sources « devinées » bloquées à l'envoi (cf. UNVERIFIED_EMAIL_SOURCES) :
    # score volontairement BAS pour ne pas faire remonter des leads non
    # contactables en tête de liste (audit 3, point 2). Avant, catch_all=30.
    "catch_all":         8,
    "pattern_nominative": 6,
    "pattern":           5,
}

DEFAULT_SIZE_BONUS: dict[str, int] = {
    "50-99": 15, "100-199": 20, "200-249": 20, "250-499": 15,
    "20-49": 10, "500-999": 10, "10-19": 5,
    "1000-1999": 5, "2000-4999": 3,
}



def score_and_sort(
    companies: list[Company],
    weights: dict | None = None,
    whitelist_domains: set[str] | None = None,
) -> list[Company]:
    """
    Calcule le score final et trie les entreprises par priorité décroissante.

    Score = fraîcheur (0-100) + pertinence stack (0-100) + bonus_score (plafonné à 100).
    Max sans whitelist ≈ 300 points. Whitelist ajoutée après cap (+999) → lisible en CSV.

    Fix-E : les bonus normaux (email + taille + ATS + croissance) sont plafonnés à 100
    pour que le total_score soit lisible. La whitelist reste non-bornée (valeur sentinelle
    999 → remonte en tête de liste de façon intentionnelle et visible).

    ``weights`` est un dict JSON optionnel (--scoring-weights) qui permet de surcharger
    chaque valeur sans modifier le script. Les clés absentes conservent leur défaut.
    Voir DEFAULT_EMAIL_BONUS et DEFAULT_SIZE_BONUS pour les valeurs par défaut.
    """
    w = weights or {}

    # ── Poids email — fusionne les défauts avec les surcharges JSON ────────────
    email_bonus_map  = {**DEFAULT_EMAIL_BONUS, **(w.get("emailBonus") or {})}
    invalid_penalty  = w.get("emailInvalidPenalty", -50)

    # ── Poids taille — fusionne les défauts avec les surcharges JSON ───────────
    size_bonus_map = {**DEFAULT_SIZE_BONUS, **(w.get("sizeBonus") or {})}

    # ── Bonus ATS ──────────────────────────────────────────────────────────────
    ats_bonus_val = w.get("atsBonus", 12)

    for c in companies:
        email_bonus = email_bonus_map.get(c.email_source, 0)

        # Pénalité si email invalide (service de validation externe)
        if c.email_validated == "invalid":
            email_bonus = invalid_penalty

        # Bonus taille : sweet spot = 50-500 salariés pour les candidatures spontanées.
        # Priorité : company_size_bucket normalisé (ex "50-99") en correspondance EXACTE,
        # puis fallback substring sur company_size brut (ex "50-99 salariés").
        # Sans la priorité bucket : les codes INSEE bruts ("22" = 100-199 INSEE) ne
        # matchaient jamais les patterns "100-199" → bonus non attribué aux SIRENE PME.
        size_bonus = 0
        bucket = c.company_size_bucket or ""
        raw    = c.company_size    or ""
        for pattern, bonus in size_bonus_map.items():
            if pattern == bucket or (not bucket and pattern in raw):
                size_bonus = bonus
                break

        # Bonus ATS : l'entreprise recrute activement et a un pipeline RH structuré
        ats_bonus = ats_bonus_val if c.ats_name else 0

        # Bonus croissance : signal "hiring_spree" (3+ postes ouverts simultanément)
        growth_bonus = 0
        if c.job_count >= 5:
            growth_bonus = 20
        elif c.job_count >= 3:
            growth_bonus = 10
        elif c.job_count >= 2:
            growth_bonus = 5

        # Whitelist : entreprises prioritaires → score maximal
        whitelist_bonus = 0
        if whitelist_domains:
            dom = _domain(c.website).lower() if c.website else ""
            if dom and dom in whitelist_domains:
                whitelist_bonus = 999  # remonte en tête de liste

        # Fix-E : bonus normaux plafonnés à 100 → total_score lisible en CSV (max ≈ 300)
        # whitelist_bonus reste non-borné (999 = sentinelle « remonte en tête de liste »)
        regular_bonus = min(email_bonus + size_bonus + ats_bonus + growth_bonus, 100)
        # FIX-2 : bonus_score séparé → relevance_score reste pur (issu de detect_stack / feedback)
        # score_and_sort est ainsi idempotent : appels multiples n'accumulent pas les bonus
        c.bonus_score = regular_bonus + whitelist_bonus

    companies.sort(key=lambda c: c.total_score, reverse=True)
    return companies


# ══════════════════════════════════════════════════════════════════════════════
# PHASE 9 — DÉDUP INTER-CAMPAGNES
# ══════════════════════════════════════════════════════════════════════════════

def load_domain_list(path: str) -> set[str]:
    """
    Charge une liste de domaines depuis un fichier texte (un domaine par ligne)
    ou un fichier JSON (liste de chaînes). Retourne un set normalisé.
    Utilisé pour la blacklist et la whitelist.
    """
    if not path or not os.path.exists(path):
        return set()
    try:
        raw = Path(path).read_text(encoding="utf-8")
        if raw.strip().startswith("["):
            items = json.loads(raw)
        else:
            items = [l.strip() for l in raw.splitlines()]
        def _clean_dom(d: str) -> str:
            d = d.strip().lower().rstrip("/")
            return d[4:] if d.startswith("www.") else d
        return {_clean_dom(d) for d in items if d.strip()}
    except Exception as e:
        print(f"⚠  Impossible de charger la liste de domaines {path} : {e}")
        return set()


def apply_feedback_scores(
    companies: list[Company],
    feedback: dict,
) -> None:
    """
    Boucle de rétroaction interne :
    Utilise les données historiques de Carreer-ops pour booster/pénaliser
    les entreprises déjà contactées.

    ``feedback`` dict structure :
      {
        "replied":  ["domaine1.fr", ...],   # réponse POSITIVE/neutre → +40 pts
        "rejected": ["domaine4.fr", ...],   # a répondu mais REFUS → +5 pts seulement
        "bounced":  ["domaine2.com", ...],  # email bounced → -60 pts
        "no_reply": ["domaine3.fr", ...],   # contacté 2+ fois sans réponse → -20 pts
      }
    Si vide (première utilisation) → aucun effet.

    Strat #1 — distinction réponse positive vs refus :
      Toute réponse prouve que l'email est délivrable ET qu'un humain a lu le
      message (signal de délivrabilité). Mais un REFUS sec ne doit pas booster le
      domaine autant qu'une marque d'intérêt — sinon on re-cible en priorité des
      entreprises qui disent systématiquement non. `rejected` = a répondu mais refus
      (déduit du manualStatus REJECTED ou des mots-clés de la réponse côté app) →
      mini-boost délivrabilité (+5) au lieu de +40.

    FIX-8 — Ordre d'application intentionnel :
      1. apply_feedback_scores() modifie ``relevance_score`` (signal métier pur : l'entreprise
         a répondu / fait rebondir → c'est une information sur la qualité du contact, pas sur
         la source de l'email).
      2. score_and_sort() lit relevance_score tel quel et écrit ``bonus_score`` (email, taille,
         ATS…) sans jamais toucher relevance_score.
      3. total_score = freshness + relevance + bonus → l'ordre garantit l'idempotence :
         relancer score_and_sort n'accumule pas les bonus.
    """
    if not feedback:
        return
    replied  = {d.lower() for d in feedback.get("replied",  [])}
    rejected = {d.lower() for d in feedback.get("rejected", [])}
    bounced  = {d.lower() for d in feedback.get("bounced",  [])}
    no_reply = {d.lower() for d in feedback.get("no_reply", [])}
    # Une réponse positive l'emporte sur un refus si les deux existent pour un même
    # domaine (plusieurs contacts) — on ne veut pas pénaliser un domaine qui a aussi
    # montré de l'intérêt.
    rejected -= replied

    boosts = penals = 0
    for c in companies:
        dom = _domain(c.website).lower() if c.website else ""
        if not dom:
            continue
        if dom in replied:
            c.relevance_score = min(100, c.relevance_score + 40)
            if "replied" not in (c.growth_signals or ""):
                c.growth_signals = f"{c.growth_signals}|replied_before".lstrip("|")
            boosts += 1
        elif dom in rejected:
            # A répondu mais refus → simple signal de délivrabilité (email valide,
            # lu par un humain), sans le boost d'intérêt.
            c.relevance_score = min(100, c.relevance_score + 5)
            if "rejected" not in (c.growth_signals or ""):
                c.growth_signals = f"{c.growth_signals}|rejected_before".lstrip("|")
            boosts += 1
        elif dom in bounced:
            # B2-12 : plancher à -100 (valeur sentinelle lisible en CSV).
            # Avant : -60 non borné → un email bounced plusieurs fois pouvait descendre
            # à -120 ou pire, rendant le total_score illisible et le tri aberrant.
            c.relevance_score = max(-100, c.relevance_score - 60)
            penals += 1
        elif dom in no_reply:
            c.relevance_score = max(-100, c.relevance_score - 20)
            penals += 1

    if boosts or penals:
        print(f"   → Feedback historique : +{boosts} boostés, -{penals} pénalisés")

