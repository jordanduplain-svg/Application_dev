"""
models — Dataclasses du pipeline scraping.

Company : entité centrale, partagée par toutes les phases (collecte → enrichissement → export).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urlparse


def _domain(url: str) -> str:
    """
    Extrait le domaine d'une URL (sans www., en minuscules). Public car utilisé partout.

    NB : on utilise removeprefix('www.') et NON lstrip('www.') — lstrip retire
    n'importe quel caractère de l'ensemble {w,.}, ce qui corrompt les domaines
    commençant par w (ex: 'welcometothejungle.com' → 'elcometothejungle.com').
    """
    if not url:
        return ""
    try:
        netloc = urlparse(url).netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return ""


@dataclass
class Company:
    """
    Entité représentant une entreprise candidate pour la prospection.
    Mutée tout au long du pipeline (enrichie phase après phase).
    """
    name: str
    website: str = ""
    contact_name: str = ""
    # Fonction/rôle du contact. Vide = inconnu (honnête) — rempli seulement quand
    # find_recruiter_name / Pappers / LinkedIn détectent un vrai titre (CEO, DRH, Head of Data…).
    contact_role: str = ""
    contact_email: str = ""
    # Origine de l'email : manual | hunter_verified | hunter_found | pattern | catch_all | web_crawl | …
    email_source: str = "pattern"
    email_alternatives: list = field(default_factory=list)
    email_pattern: str = ""           # format détecté du domaine (ex: "{first}.{last}") pour emails nominatifs
    region: str = ""                  # libre, hérité (legacy — utiliser country/region_admin/dept/city pour structuré)
    # Localisation structurée (remplie par parse_location depuis le champ region ou des données API)
    country: str = ""                 # ex: "France", "USA"
    region_admin: str = ""            # ex: "Île-de-France", "PACA", "Auvergne-Rhône-Alpes"
    dept: str = ""                    # code département : "75", "69", "13", "971" (DROM)
    dept_name: str = ""               # nom département : "Paris", "Rhône", "Bouches-du-Rhône"
    city: str = ""                    # ex: "Paris", "Lyon", "Marseille"
    activity_domain: str = ""        # libellé brut secteur (ex: "Programmation informatique")
    sector: str = ""                  # secteur normalisé (ex: "Tech / IT") — voir classification.py
    # SCRAPE-DESC : description courte de l'activité (extraite du site, résumée par IA).
    # Sert à personnaliser le §2 de l'email de candidature.
    description: str = ""
    # Date ISO (YYYY-MM-DDTHH:MM:SS) de la dernière génération de la fiche — sert à
    # afficher son âge et à ne régénérer que les fiches trop anciennes.
    description_updated_at: str = ""
    # Date ISO de la dernière VÉRIFICATION des actualités (2ᵉ note) — indépendante de
    # la fiche générale, pour pouvoir rafraîchir SEULEMENT les actus trop anciennes.
    news_updated_at: str = ""
    company_size: str = ""           # taille brute (ex: "47 employees", code INSEE "11")
    company_size_bucket: str = ""    # bucket normalisé (ex: "10-19") — voir classification.py
    tech_stack: list = field(default_factory=list)
    freshness_score: int = 0      # 0-100 : fraîcheur de l'offre d'emploi
    relevance_score: int = 0      # 0-100 : correspondance stack avec le profil
    bonus_score: int = 0          # Bonus calculé par score_and_sort (email + taille + ATS…)
    email_validated: str = ""     # valid | invalid | catch_all | unknown | disposable | ""
    ats_name: str = ""            # lever | greenhouse | workday | teamtailor | …
    ats_url: str = ""             # URL directe de la page carrières ATS
    source: str = ""
    job_count: int = 0            # Nombre d'offres actives — signal de croissance
    growth_signals: str = ""      # "hiring_spree|recently_funded|…" séparés par |
    posted_date: str = ""         # Date ISO de la dernière offre vue (YYYY-MM-DD)
    # BOUNCE-CSV : "1" si Carreer-ops a détecté un rebond (NDR) sur cet email lors d'un
    # envoi réel. Fait EXTERNE au scraper (impossible à déduire du crawl) → simple champ
    # de ROUND-TRIP : jamais recalculé ici, seulement lu/réécrit tel quel à la fusion.
    bounced: str = ""

    def key(self) -> str:
        """
        Clé de déduplication intra-run : nom normalisé + domaine + localisation.

        B0-11 : cohérence avec P0-4 (merge_into_master utilise dept/city dans sa clé).
        Sans localisation ici, deux établissements distincts du même nom (ex.
        « Pharmacie Centrale » Lyon et Lille) seraient fusionnés dès la Phase 1
        collecte — avant même la résolution de domaine — et un lead serait perdu.

        Géo : dept en priorité (code officiel INSEE), sinon ville normalisée. Si aucune
        info géo n'est disponible (source sans localisation), on retombe sur l'ancien
        comportement (clé = nom|domaine) pour éviter de casser la dédup existante.
        """
        norm = re.sub(r"[^a-z0-9]", "", self.name.lower())
        dom  = _domain(self.website)
        geo  = (self.dept or re.sub(r"[^a-z0-9]", "", (self.city or "").lower())).lower()
        return f"{norm}|{dom}|{geo}" if geo else f"{norm}|{dom}"

    @property
    def total_score(self) -> int:
        """bonus_score séparé → score_and_sort idempotent (appels multiples sans accumulation)."""
        return self.freshness_score + self.relevance_score + self.bonus_score
