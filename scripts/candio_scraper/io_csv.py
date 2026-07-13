"""
io_csv — Lecture / écriture CSV + HTML preview + merge dans le master CSV.

Format de colonnes stable avec Carreer-ops (importable directement dans une campagne).
"""

from __future__ import annotations

import csv
import json
import re
from datetime import date
from pathlib import Path

from .models import Company, _domain
from .constants import UNVERIFIED_EMAIL_SOURCES


# ── Liste canonique des colonnes CSV — source unique ─────────────────────────
# B2-5 : la liste était dupliquée dans pipeline.py ET tests/test_scraper.py.
# Une divergence silencieuse entre les deux causait des colonnes manquantes en test
# ou des rounds-trips CSV incomplets. Désormais importée partout depuis ici.
CSV_FIELDNAMES: list[str] = [
    "name", "contactEmail", "website", "contactName", "contactRole",
    "emailSource", "emailPattern", "emailAlternatives", "emailValidated",
    # Localisation : region (legacy libre) + 5 champs structurés
    "region", "country", "regionAdmin", "dept", "deptName", "city",
    "activityDomain", "sector", "companyDescription", "descriptionUpdatedAt", "newsUpdatedAt",
    "companySize", "companySizeBucket",
    "freshnessScore", "relevanceScore", "bonusScore", "totalScore",
    "atsName", "atsUrl",
    "source", "jobCount", "growthSignals", "postedDate",
    # Qualité : "1" si le domaine du site ne correspond pas au nom (homonyme louche).
    "domainSuspect",
    # BOUNCE-CSV : "1" si Carreer-ops a détecté un rebond confirmé sur cet email.
    "bounced",
]


def load_companies_from_csv(csv_path: str) -> list[Company]:
    """
    Re-enrichissement (Item 6) : charge des entreprises depuis un CSV existant.
    Permet de relancer uniquement les phases email sur des entreprises déjà en base
    sans tout recolleter.
    """
    companies: list[Company] = []
    try:
        with open(csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                c = Company(
                    name           = row.get("name", ""),
                    website        = row.get("website", ""),
                    contact_email  = row.get("contactEmail", ""),
                    contact_name   = row.get("contactName", ""),
                    contact_role   = row.get("contactRole", ""),
                    email_source   = row.get("emailSource", "pattern"),
                    email_pattern  = row.get("emailPattern", ""),
                    # Relus pour éviter de les écraser à la fusion master (sinon
                    # chaque run vidait emailAlternatives / emailValidated).
                    email_alternatives = [a for a in row.get("emailAlternatives", "").split("|") if a],
                    email_validated = row.get("emailValidated", ""),
                    region         = row.get("region", ""),
                    country        = row.get("country", ""),
                    region_admin   = row.get("regionAdmin", ""),
                    dept           = row.get("dept", ""),
                    dept_name      = row.get("deptName", ""),
                    city           = row.get("city", ""),
                    activity_domain= row.get("activityDomain", ""),
                    sector         = row.get("sector", ""),
                    description    = row.get("companyDescription", ""),
                    description_updated_at = row.get("descriptionUpdatedAt", ""),
                    news_updated_at = row.get("newsUpdatedAt", ""),
                    company_size   = row.get("companySize", ""),
                    company_size_bucket = row.get("companySizeBucket", ""),
                    freshness_score= int(row.get("freshnessScore", 0) or 0),
                    relevance_score= int(row.get("relevanceScore", 0) or 0),
                    bonus_score    = int(row.get("bonusScore", 0) or 0),  # FIX-2
                    ats_name       = row.get("atsName", ""),
                    ats_url        = row.get("atsUrl", ""),
                    source         = row.get("source", "csv_import"),
                    job_count      = int(row.get("jobCount", 0) or 0),
                    growth_signals = row.get("growthSignals", ""),
                    posted_date    = row.get("postedDate", ""),
                    # BOUNCE-CSV : round-trip simple, jamais recalculé côté Python.
                    bounced        = row.get("bounced", ""),
                )
                if c.name:
                    # Backfill localisation/secteur/taille depuis les champs bruts
                    # (les vieux CSV n'ont que `region` libre, pas les colonnes structurées).
                    try:
                        from .classification import backfill_derived_fields
                        backfill_derived_fields(c)
                    except Exception:
                        pass
                    companies.append(c)
    except Exception as e:
        print(f"❌  Impossible de charger le CSV d'enrichissement : {e}")
    return companies


# Ordre de qualité des sources email — plus l'index est bas, meilleure est la source.
_EMAIL_SOURCE_RANK: dict[str, int] = {
    "hunter_verified":    0,
    "manual":             0,
    "linkedin_smtp":      1,
    "web_crawl":          2,
    "llm_crawl":          2,   # extraction LLM = qualité crawl
    "whois":              3,
    "snov_found":         4,
    "apollo_found":       5,
    "hunter_found":       6,
    "github_org":         6,
    "pattern_verified":   7,
    "pattern_nominative": 7,   # nominatif déduit du pattern domaine (prénom.nom@)
    "catch_all":          8,
    "pattern":            9,   # générique rh@ — dernier recours
}

def _email_rank(source: str) -> int:
    """Retourne le rang de qualité d'une source email (0 = meilleure)."""
    return _EMAIL_SOURCE_RANK.get(source, 99)


def merge_into_master(
    master_path: Path,
    new_companies: list["Company"],
    fieldnames: list[str],
) -> tuple[list["Company"], int, int]:
    """
    Fusionne ``new_companies`` dans le CSV master existant.

    Clé de déduplication : domaine du site web (ex: ironhack.com).
    Si une entreprise est déjà présente :
      - on garde la ligne existante SAUF si la nouvelle a un meilleur email
        (rang _EMAIL_SOURCE_RANK plus bas) → mise à jour de l'email + source.
    Retourne (liste_finale, n_ajoutées, n_mises_à_jour).
    """
    # Charger le master existant
    existing: list["Company"] = []
    if master_path.exists():
        existing = load_companies_from_csv(str(master_path))

    def _norm_name(n: str) -> str:
        """Nom normalisé pour dédup (insensible casse/ponctuation/formes juridiques courantes)."""
        n = re.sub(r"\b(sas|sasu|sarl|sa|group|groupe|france|international)\b", "", n.lower())
        return re.sub(r"[^a-z0-9]", "", n)

    def _norm_loc(c: "Company") -> str:
        """
        P0-4 : suffixe localisation (dept code OU ville normalisée) pour la clé
        de dédup par nom. Sans ça, deux établissements distincts portant le même
        nom (ex. « Pharmacie Centrale » à Lyon et à Lille) fusionnaient en un
        seul → perte d'un lead réel. Avec la ville/dept dans la clé, ils restent
        séparés. On retombe sur "" quand aucune info géo n'est dispo (compat
        ascendante avec les vieilles entrées CSV sans localisation).
        """
        dept = (c.dept or "").strip().lower()
        if dept:
            return dept
        city = (c.city or "").strip().lower()
        return re.sub(r"[^a-z0-9]", "", city) if city else ""

    def _key_name(c: "Company") -> str:
        """Clé de dédup combinée : nom_normalisé + suffixe géo (P0-4)."""
        nn = _norm_name(c.name)
        if not nn:
            return ""
        loc = _norm_loc(c)
        return f"{nn}|{loc}" if loc else nn

    # Index par domaine ET par nom+localisation → évite les doublons quand une
    # entreprise gagne un domaine (avant : son jumeau sans-domaine n'était plus
    # matché → doublon). P0-4 : la clé nom inclut désormais ville/dept pour
    # séparer deux établissements distincts portant le même nom (« Pharmacie
    # Centrale » à Lyon ≠ Lille).
    domain_index: dict[str, int] = {}
    name_index: dict[str, int] = {}
    # B-2 (migration clé localisation) : index secondaire par nom NU (sans suffixe
    # géo). Les vieilles entrées du master (créées avant P0-4) n'ont pas de dept/city
    # → clé `nom`. Une nouvelle entrée géolocalisée a la clé `nom|69` → l'exact-match
    # par clé échoue → DOUBLON. Ce repli rattrape ce cas quand UN SEUL des deux côtés
    # a une localisation (donc sans reconfondre deux établissements distincts dont les
    # deux dept/ville diffèrent — cf. « Pharmacie Centrale » Lyon ≠ Lille).
    bare_index: dict[str, list[int]] = {}
    for i, c in enumerate(existing):
        d = _domain(c.website)
        if d:
            domain_index[d] = i
        k = _key_name(c)
        if k:
            name_index.setdefault(k, i)
        nn = _norm_name(c.name)
        if nn:
            bare_index.setdefault(nn, []).append(i)

    added = 0
    updated = 0

    def _maybe_update(idx: int, new_c: "Company") -> bool:
        """Met à jour l'entrée existante si la nouvelle a un meilleur email. Retourne True si MAJ."""
        old_c = existing[idx]
        changed = False
        # LEADS-UPDATE : un lead marqué REBONDI garde une adresse morte. Si le ré-enrichissement
        # a trouvé un email DIFFÉRENT, il remplace TOUJOURS l'ancien (le rang de source n'a aucun
        # sens pour une adresse qui a rebondi) et on lève le drapeau bounced. Ne concerne QUE les
        # leads bounced → le chemin de fusion normal (ci-dessous) est intact.
        if (old_c.bounced == "1" and new_c.contact_email
                and new_c.contact_email.strip().lower() != (old_c.contact_email or "").strip().lower()):
            old_c.contact_email   = new_c.contact_email
            old_c.contact_name    = new_c.contact_name or old_c.contact_name
            old_c.contact_role    = new_c.contact_role or old_c.contact_role
            old_c.email_source    = new_c.email_source
            old_c.email_pattern   = new_c.email_pattern or old_c.email_pattern
            old_c.email_validated = new_c.email_validated
            old_c.bounced         = ""   # nouvelle adresse → on repart propre
            changed = True
        # Email : on prend le meilleur des deux (rang plus bas = meilleur)
        elif (new_c.contact_email and _email_rank(new_c.email_source) < _email_rank(old_c.email_source)):
            old_c.contact_email   = new_c.contact_email
            old_c.contact_name    = new_c.contact_name or old_c.contact_name
            old_c.contact_role    = new_c.contact_role or old_c.contact_role
            old_c.email_source    = new_c.email_source
            old_c.email_pattern   = new_c.email_pattern or old_c.email_pattern
            old_c.email_validated = new_c.email_validated
            changed = True
        # LEADS-UPDATE : l'ancien email était déjà NON FIABLE (pattern/catch-all/nominatif
        # bidon…) et le ré-enrichissement ne trouve RIEN de mieux (new_c.contact_email vide,
        # ex. faux nom désormais rejeté par le garde-fou anti-faux-positifs, cf. enrich.py
        # _looks_like_person_name). Sans cette règle, la ligne garde l'adresse fantaisiste
        # POUR TOUJOURS — la règle générale ci-dessus ne s'applique jamais avec un new_c vide.
        # On l'efface donc plutôt que de la garder : jamais appliqué à un email réel
        # (hunter/web_crawl), seulement à une source déjà non fiable.
        elif (not new_c.contact_email and old_c.contact_email
              and old_c.email_source in UNVERIFIED_EMAIL_SOURCES):
            old_c.contact_email = ""
            old_c.contact_name  = ""
            old_c.contact_role  = ""
            old_c.email_source  = "no_email"
            changed = True
        # Backfill : compléter les champs vides de l'ancien avec ceux du nouveau
        for fld in ("website", "sector", "company_size_bucket", "region_admin",
                    "dept", "dept_name", "city", "country", "activity_domain"):
            if not getattr(old_c, fld, "") and getattr(new_c, fld, ""):
                setattr(old_c, fld, getattr(new_c, fld))
                changed = True
        return changed

    for new_c in new_companies:
        d = _domain(new_c.website)
        k = _key_name(new_c)

        # 1. Match par domaine (le plus fiable)
        if d and d in domain_index:
            if _maybe_update(domain_index[d], new_c):
                updated += 1
            continue
        # 2. Match par (nom_normalisé + localisation) — rattrape les jumeaux
        # sans-domaine SANS confondre deux établissements distincts du même nom.
        if k and k in name_index:
            idx = name_index[k]
            if _maybe_update(idx, new_c):
                updated += 1
            # Si l'entrée vient de gagner un domaine, on l'indexe
            d2 = _domain(existing[idx].website)
            if d2 and d2 not in domain_index:
                domain_index[d2] = idx
            continue
        # 2b. B-2 — repli par nom NU : même nom normalisé mais au moins un côté SANS
        # localisation (typiquement une vieille entrée master sans dept/city). On
        # fusionne pour éviter le doublon de migration ; on NE fusionne PAS deux
        # entrées toutes deux géolocalisées mais sur des localités différentes.
        nn_new = _norm_name(new_c.name)
        if nn_new and nn_new in bare_index:
            new_loc = _norm_loc(new_c)
            match_idx = None
            for idx in bare_index[nn_new]:
                old_loc = _norm_loc(existing[idx])
                if old_loc == "" or new_loc == "":
                    match_idx = idx
                    break
            if match_idx is not None:
                if _maybe_update(match_idx, new_c):
                    updated += 1
                # L'entrée a pu gagner une localisation (backfill) et/ou un domaine →
                # réindexer pour que les prochains matches exacts retombent dessus.
                new_key = _key_name(existing[match_idx])
                if new_key:
                    name_index.setdefault(new_key, match_idx)
                d2 = _domain(existing[match_idx].website)
                if d2 and d2 not in domain_index:
                    domain_index[d2] = match_idx
                continue
        # 3. Nouvelle entreprise
        existing.append(new_c)
        new_idx = len(existing) - 1
        if d:
            domain_index[d] = new_idx
        if k:
            name_index.setdefault(k, new_idx)
        if nn_new:
            bare_index.setdefault(nn_new, []).append(new_idx)
        added += 1

    return existing, added, updated


def export_html_preview(companies: list[Company], out_path: Path) -> None:
    """
    Item 10 : génère un aperçu HTML des résultats à côté du CSV.
    Ouvre dans le navigateur par défaut, lisible sans app.
    """
    top = companies[:50]  # afficher au max 50 entreprises

    def badge(src: str) -> str:
        colors = {
            "hunter_verified": "#34c759", "linkedin_smtp": "#0077b5", "web_crawl": "#30d158",
            "catch_all": "#ff6b2b", "apollo_found": "#bf5af2", "snov_found": "#5ac8fa",
            "hunter_found": "#ff9f0a", "whois": "#64d2ff", "pattern_verified": "#ffd60a",
            "pattern": "#aaa", "manual": "#5ac8fa",
        }
        color = colors.get(src, "#ccc")
        return f'<span style="background:{color}22;color:{color};border:1px solid {color};border-radius:4px;padding:1px 6px;font-size:11px">{src}</span>'

    rows = ""
    for i, c in enumerate(top, 1):
        score_color = "#34c759" if c.total_score >= 150 else "#ff9f0a" if c.total_score >= 80 else "#aaa"
        growth = c.growth_signals.replace("|", " · ") if c.growth_signals else ""
        ats = f'<span style="color:#007aff">🏢 {c.ats_name}</span>' if c.ats_name else ""
        # Affichage taille : bucket en priorité (lisible), brut en sous-titre si différent.
        size_display = c.company_size_bucket or c.company_size or "—"
        if c.company_size_bucket and c.company_size and c.company_size_bucket != c.company_size:
            size_display = f"<strong>{c.company_size_bucket}</strong><br><small style='color:#888'>{c.company_size}</small>"

        # Secteur normalisé en badge coloré pour faciliter le tri visuel.
        sector_html = ""
        if c.sector:
            sector_html = (
                f'<span style="background:#eef4ff;color:#007aff;border:1px solid #007aff44;'
                f'border-radius:4px;padding:1px 6px;font-size:11px;font-weight:500">'
                f'{c.sector}</span>'
            )

        # Localisation : ville en gras, département (nom + code) + région en sous-titre.
        loc_main = c.city or "—"
        loc_sub_parts = []
        if c.dept_name or c.dept:
            loc_sub_parts.append(f"{c.dept_name or ''} ({c.dept})" if c.dept else c.dept_name)
        if c.region_admin:
            loc_sub_parts.append(c.region_admin)
        loc_sub = " · ".join(p for p in loc_sub_parts if p)
        loc_html = f"<strong>{loc_main}</strong>"
        if loc_sub:
            loc_html += f"<br><small style='color:#888'>{loc_sub}</small>"

        rows += f"""
        <tr>
          <td style="color:#888;font-size:11px">{i}</td>
          <td><strong>{c.name}</strong>
            {"<br><small style='color:#888'>" + c.activity_domain + "</small>" if c.activity_domain else ""}
          </td>
          <td>{"<a href='"+c.website+"'>"+c.website[:40]+"</a>" if c.website else "—"}</td>
          <td>{c.contact_email or "—"}<br><small style='color:#888'>{badge(c.email_source)}</small></td>
          <td>{c.contact_name or "—"}<br><small style='color:#888'>{c.contact_role}</small></td>
          <td style="text-align:center;font-weight:600;color:{score_color}">{c.total_score}</td>
          <td style="font-size:11px">{loc_html}</td>
          <td style="font-size:11px">{size_display}</td>
          <td style="font-size:11px">{sector_html or "—"}</td>
          <td style="font-size:11px">{ats}{(" · " if ats and growth else "") + growth}</td>
        </tr>"""

    total = len(companies)
    real_emails = sum(
        1 for c in companies
        if c.email_source not in UNVERIFIED_EMAIL_SOURCES and c.email_source != "no_email"
    )
    html = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Résultats scraping — {date.today().isoformat()}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         margin: 0; padding: 24px; background: #f5f5f7; color: #1c1c1e; }}
  h1   {{ margin: 0 0 4px; font-size: 20px; }}
  .meta{{ color: #666; font-size: 13px; margin-bottom: 20px; }}
  table{{ width: 100%; border-collapse: collapse; background: #fff;
          border-radius: 10px; overflow: hidden; box-shadow: 0 1px 6px #0001; }}
  th   {{ background: #1c1c1e; color: #fff; text-align: left; padding: 8px 10px; font-size: 12px; }}
  td   {{ padding: 8px 10px; border-bottom: 1px solid #f0f0f0; font-size: 13px; vertical-align: top; }}
  tr:last-child td {{ border-bottom: none; }}
  tr:hover td {{ background: #f9f9fb; }}
</style></head><body>
<h1>Résultats scraping Carreer-ops</h1>
<div class="meta">{date.today().strftime('%d/%m/%Y')} · {total} entreprises · {real_emails} emails trouvés ({int(real_emails/total*100) if total else 0}%) · affichage des {len(top)} meilleures</div>
<table>
  <thead><tr>
    <th>#</th><th>Entreprise</th><th>Site</th><th>Email</th><th>Contact</th>
    <th>Score</th><th>Localisation</th><th>Taille</th><th>Secteur</th><th>Signaux</th>
  </tr></thead>
  <tbody>{rows}</tbody>
</table>
</body></html>"""

    try:
        out_path.write_text(html, encoding="utf-8")
        print(f"🔍  Aperçu HTML → {out_path}")
    except Exception as e:
        print(f"⚠  Impossible d'écrire l'aperçu HTML : {e}")


def load_exclude_domains(exclude_file: str) -> set[str]:
    """
    Charge un fichier JSON (liste de domaines) généré par Carreer-ops.
    Format : ["domain1.com", "domain2.fr", ...]
    """
    if not exclude_file:
        return set()
    try:
        with open(exclude_file, 'r', encoding='utf-8') as f:
            domains = json.load(f)
        # Normalisation IDENTIQUE à _domain() (minuscule + sans www. + sans / final)
        # — sinon « www.acme.fr » en base ne matcherait pas « acme.fr » résolu.
        def _norm(d: str) -> str:
            d = d.strip().lower().rstrip("/")
            return d[4:] if d.startswith("www.") else d
        return {_norm(d) for d in domains if isinstance(d, str) and d.strip()}
    except Exception as e:
        print(f"   ⚠  Impossible de lire le fichier d'exclusion : {e}")
        return set()


def filter_known_domains(
    companies: list[Company],
    known_domains: set[str],
) -> tuple[list[Company], int]:
    if not known_domains:
        return companies, 0
    kept, excluded = [], 0
    for c in companies:
        if _domain(c.website) in known_domains:
            excluded += 1
        else:
            kept.append(c)
    if excluded:
        print(f"   → {excluded} entreprises déjà en base exclues (dédup inter-campagnes)")
    return kept, excluded


