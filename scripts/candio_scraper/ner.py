"""
ner.py — Extraction de contacts par NER (Named Entity Recognition) avec spaCy.

Remplace / augmente le regex RECRUITER_NAME_RE dans find_recruiter_name :
  - Regex : cherche Prénom Nom à ±120 chars d'un mot-clé RH/CEO.
             Rapide mais fragile (rend la main si pas de match strict).
  - NER   : comprend « Marie-Claire DUPONT — Talent Acquisition » sans mot-clé
             ni positionnement spatial précis. Détecte aussi les structures
             LinkedIn-style « DRH · 3 ans chez Acme ».

Architecture de fallback (dans find_recruiter_name) :
  1. Regex (instant, 0 dépendance)
  2. NER spaCy (si disponible, ~10 ms/page, modèle 12 MB chargé une seule fois)
  3. LLM Ollama (si disponible, 200-800 ms/page)

spaCy et fr_core_news_sm sont chargés de façon LAZY (au 1er appel) et mis en
cache dans _NLP_MODEL. Le chargement prend ~0.3 s une seule fois par run.
Pas d'erreur si spaCy absent : toutes les fonctions retournent ('', '').
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

# ── Chargement lazy du modèle ──────────────────────────────────────────────────

_NLP_MODEL = None    # spacy.Language | None | False (False = tentative échouée)
_NLP_TRIED = False   # on ne réessaie pas si le modèle est absent


def _get_nlp():
    """Retourne le modèle spaCy fr_core_news_sm, ou None si indisponible."""
    global _NLP_MODEL, _NLP_TRIED
    if _NLP_TRIED:
        return _NLP_MODEL
    _NLP_TRIED = True
    try:
        import spacy
        try:
            _NLP_MODEL = spacy.load("fr_core_news_sm",
                                    disable=["parser", "lemmatizer"])
            # Ajouter le sentencizer (plus léger que le parser) pour segmenter.
            if "sentencizer" not in _NLP_MODEL.pipe_names:
                _NLP_MODEL.add_pipe("sentencizer")
        except OSError:
            # Modèle absent → log discret, on continuera avec regex/LLM
            import logging
            logging.getLogger("candio.ner").warning(
                "fr_core_news_sm absent — NER désactivé. "
                "Pour l'activer : python -m spacy download fr_core_news_sm"
            )
            _NLP_MODEL = None
    except ImportError:
        _NLP_MODEL = None
    return _NLP_MODEL


# ── Titres RH / dirigeant connus (FR + EN) ────────────────────────────────────
# Sert à qualifier le rôle d'une entité PER trouvée par NER quand la phrase
# ne le dit pas explicitement (contexte immédiat).

_HR_TITLE_RE = re.compile(
    r"\b(d\.?r\.?h|responsable\s+rh|responsable\s+(?:des\s+)?ressources\s+humaines"
    r"|talent\s+acquisition|talent\s+manager|charg[ée]e?\s+(?:de\s+)?recrutement"
    r"|recruteuse?|hiring\s+manager|people\s+(?:ops|partner|manager)"
    r"|human\s+resources|rh\b|hr\b"
    r"|directeur\s+(?:g[eé]n[eé]ral|adjoint|des\s+op[eé]rations)"
    r"|chief\s+(?:executive|people|talent)\s+officer"
    r"|ceo|coo|cto|cpo|fondateur|cofondateur|co-fondateur"
    r"|pr[eé]sident|g[eé]rant|associate\s+partner|partner\b)",
    re.I,
)

_CEO_TITLE_RE = re.compile(
    r"\b(ceo|pdg|pr[eé]sident[-\s]?directeur|directeur\s+g[eé]n[eé]ral"
    r"|fondateur|co.?fondateur|chief\s+executive)",
    re.I,
)

# Blacklist : entités NER faussement taguées PER (noms de villes, produits, etc.)
_PER_BLACKLIST = re.compile(
    r"^(france|paris|lyon|bordeaux|nantes|montpellier|toulouse|marseille"
    r"|microsoft|google|apple|amazon|linkedin|github|slack|notion"
    r"|excellence|intelligence|innovation|performance|management"
    r"|solutions?|services?|consulting|digital)$",
    re.I,
)


def _looks_like_name(text: str) -> bool:
    """Filtre rapide : un vrai nom propre contient au moins 2 tokens de 2+ lettres."""
    tokens = [t for t in text.split() if len(t) >= 2 and t[0].isupper()]
    return len(tokens) >= 2


def _infer_role_from_context(sentence_text: str, entity_text: str) -> str:
    """
    Déduit le rôle de la personne depuis la phrase qui la contient.
    Exemple : « Marie Dupont, DRH · 5 ans chez Acme » → « DRH »
    """
    ctx = sentence_text.replace(entity_text, "")
    m = _CEO_TITLE_RE.search(ctx)
    if m:
        return m.group(0).strip().capitalize()
    m = _HR_TITLE_RE.search(ctx)
    if m:
        return m.group(0).strip().capitalize()
    return ""


def extract_contact_ner(
    text: str,
    prefer_hr: bool = True,
) -> tuple[str, str]:
    """
    Extrait (nom, rôle) depuis le texte libre via NER spaCy.

    Stratégie :
      1. Toutes les entités PER détectées (filtrées par blacklist + structure nom).
      2. Pour chaque PER → contexte de ±1 phrase → cherche un titre RH/CEO.
      3. Priorité : CEO/Fondateur > RH > PER sans rôle (premier trouvé).

    Retourne ('', '') si spaCy indisponible ou aucune entité pertinente.
    """
    nlp = _get_nlp()
    if nlp is None or not text:
        return "", ""

    # On tronque à 8 000 chars (limite confortable pour fr_core_news_sm sans GPU)
    doc = nlp(text[:8_000])

    ceo_candidates:  list[tuple[str, str]] = []
    hr_candidates:   list[tuple[str, str]] = []
    other_candidates: list[tuple[str, str]] = []

    for ent in doc.ents:
        if ent.label_ != "PER":
            continue
        # Nettoyer le texte de l'entité : supprimer les ponctuation parasites
        # (tirets em-dash, guillemets, puces) introduits par le parseur HTML.
        name = re.sub(r"[—–•·:,;\"'()\[\]]+", " ", ent.text).strip()
        name = re.sub(r"\s{2,}", " ", name)
        if not _looks_like_name(name) or _PER_BLACKLIST.match(name.split()[0]):
            continue

        # Contexte : la phrase qui contient l'entité
        sent = ent.sent.text if hasattr(ent, "sent") else ""
        role = _infer_role_from_context(sent, name)

        if _CEO_TITLE_RE.search(role):
            ceo_candidates.append((name, role))
        elif _HR_TITLE_RE.search(role):
            hr_candidates.append((name, role))
        else:
            other_candidates.append((name, role or "Contact"))

    # Ordre de priorité
    if prefer_hr:
        ordered = hr_candidates + ceo_candidates + other_candidates
    else:
        ordered = ceo_candidates + hr_candidates + other_candidates

    return ordered[0] if ordered else ("", "")


def extract_contact_ner_from_snippet(
    text: str,
    keyword_idx: int,
    window: int = 300,
) -> tuple[str, str]:
    """
    NER ciblé sur une fenêtre de texte autour d'un mot-clé (position keyword_idx).
    Utilisé comme remplacement précis du regex RECRUITER_NAME_RE dans _parse_text.

    Plus rapide qu'un passage NER complet sur toute la page (traite ~600 chars).
    """
    snippet = text[max(0, keyword_idx - window): keyword_idx + window]
    return extract_contact_ner(snippet, prefer_hr=True)
