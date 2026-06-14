"""
linkedin — Import de CSV LinkedIn Sales Navigator (+ exports tiers : Evaboot,
Linked Helper, PhantomBuster, Apollo, Wiza, etc.).

Stratégie : lecture flexible des colonnes. Chaque export a des noms différents
mais les champs sont normalisés vers le schéma Company de Carreer-ops :
  - name            ← Company / Organization / Entreprise / Current Company
  - contact_name    ← Full Name / Name (ou First Name + Last Name si séparés)
  - contact_role    ← Title / Job Title / Role / Poste / Position
  - contact_email   ← Email / Work Email / E-mail (souvent vide → enrichi en aval)
  - website         ← Company Website / Domain / Website (PAS LinkedIn URL)
  - region          ← Location / Ville / Country / Region
  - activity_domain ← Industry / Secteur

Après l'import, les Company sont passés dans le pipeline standard (web crawl
+ Hunter + pattern) pour deviner les emails manquants.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

from .models import Company, _domain


# ── Mapping flexible des colonnes ────────────────────────────────────────────
# Liste ordonnée des noms acceptés pour chaque champ. Le premier match gagne.
# Case-insensitive, ignore les espaces/underscores.

COLUMN_ALIASES: dict[str, list[str]] = {
    # Identité personnelle
    "first_name":    ["first name", "firstname", "prénom", "prenom", "given name"],
    "last_name":     ["last name", "lastname", "nom", "family name", "surname"],
    "full_name":     ["full name", "name", "lead name", "contact name", "nom complet",
                      "prénom nom", "prenom nom"],

    # Entreprise
    "company":       ["company", "company name", "current company", "organization",
                      "entreprise", "société", "societe", "employer", "current employer"],

    # Rôle / poste
    "title":         ["title", "job title", "current title", "role", "position",
                      "poste", "fonction"],

    # Email
    "email":         ["email", "work email", "e-mail", "professional email",
                      "email address", "courriel", "mail"],

    # Statut de vérification de l'email (Apollo/Evaboot/Wiza l'exposent souvent).
    # Sert à décider si l'email importé est fiable (→ manual) ou « à vérifier ».
    "email_status":  ["email status", "email_status", "verification status",
                      "email verification", "email verified", "status", "esp status"],

    # Site web entreprise (PAS LinkedIn URL — qui est un profil)
    "website":       ["website", "company website", "domain", "company domain",
                      "site web", "url", "company url"],

    # LinkedIn (profil — utile pour mémoriser, pas pour enrichir directement)
    "linkedin_url":  ["linkedin", "linkedin url", "profile url", "linkedin profile",
                      "lead url", "person linkedin"],

    # Géo
    "location":      ["location", "ville", "city", "region", "country", "country/region",
                      "geo location", "address"],

    # Secteur d'activité
    "industry":      ["industry", "industry name", "secteur", "secteur d'activité",
                      "company industry", "category"],

    # Taille entreprise
    "company_size":  ["company size", "size", "employees", "headcount",
                      "company headcount", "taille", "effectif"],
}


def _normalize_header(s: str) -> str:
    """Normalise un nom de colonne : minuscule, sans accents superflus, sans ponctuation lourde."""
    s = (s or "").strip().lower()
    # Convertir _ ou - en espaces, puis collapse espaces
    s = re.sub(r"[_\-]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s


def _resolve_columns(fieldnames: list[str]) -> dict[str, str | None]:
    """
    Pour chaque champ logique (first_name, company, …) trouve quel header CSV
    réel correspond. Retourne un dict {logical: actual_header_or_None}.
    """
    norm_to_actual = {_normalize_header(h): h for h in (fieldnames or [])}
    resolved: dict[str, str | None] = {}
    for logical, aliases in COLUMN_ALIASES.items():
        match = None
        for alias in aliases:
            if alias in norm_to_actual:
                match = norm_to_actual[alias]
                break
        resolved[logical] = match
    return resolved


def _domain_from_url(url: str) -> str:
    """
    Extrait le domaine d'une URL. Si l'URL est en fait un domaine nu (ex: 'acme.fr'),
    le retourne tel quel. Filtre les URLs LinkedIn (jamais des vrais sites).
    """
    if not url:
        return ""
    url = url.strip()
    if "linkedin.com" in url.lower():
        return ""  # Une URL LinkedIn n'est pas un site web entreprise
    if "://" not in url:
        url = "https://" + url
    return _domain(url)


def load_sales_nav_csv(csv_path: str) -> list[Company]:
    """
    Charge un export LinkedIn Sales Navigator (ou compatible) et retourne
    une liste de Company prêts à passer dans le pipeline d'enrichissement.

    La détection des colonnes est tolérante : si le CSV vient d'Evaboot,
    PhantomBuster, Apollo, Wiza ou Sales Nav brut, on trouve les champs équivalents.

    Une ligne sans nom d'entreprise est ignorée. Les doublons (par nom + domaine)
    sont dédupliqués automatiquement.
    """
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(f"CSV introuvable : {csv_path}")

    companies: list[Company] = []
    seen_keys: set[str] = set()

    # Détection de délimiteur (Sales Nav exporte parfois en TSV, parfois en CSV séparé par ;)
    with open(path, encoding="utf-8-sig", newline="") as f:
        sample = f.read(8192)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except Exception:
            dialect = csv.excel  # fallback : virgule
        reader = csv.DictReader(f, dialect=dialect)

        cols = _resolve_columns(reader.fieldnames or [])
        # Au minimum on doit avoir un nom d'entreprise pour exploiter la ligne
        if not cols["company"]:
            raise ValueError(
                f"Impossible de trouver la colonne 'Company' dans le CSV. "
                f"Colonnes détectées : {reader.fieldnames}"
            )

        for row in reader:
            company_name = (row.get(cols["company"] or "") or "").strip()
            if not company_name:
                continue

            # Construction du nom complet : full_name OU first + last
            full_name = ""
            if cols["full_name"]:
                full_name = (row.get(cols["full_name"]) or "").strip()
            if not full_name and cols["first_name"] and cols["last_name"]:
                first = (row.get(cols["first_name"]) or "").strip()
                last  = (row.get(cols["last_name"]) or "").strip()
                full_name = f"{first} {last}".strip()
            elif not full_name and cols["first_name"]:
                full_name = (row.get(cols["first_name"]) or "").strip()

            # Site web — exclut les URLs LinkedIn
            website_raw = (row.get(cols["website"] or "") or "").strip()
            if website_raw and "linkedin.com" in website_raw.lower():
                website_raw = ""
            # Si pas explicite, on laisse vide — le pipeline tentera Hunter/Clearbit
            website = ""
            if website_raw:
                # Normalisation : ajoute https:// si manquant
                if "://" not in website_raw:
                    website_raw = "https://" + website_raw
                website = website_raw

            # ── Source de l'email (point F audit) ───────────────────────────
            # Un email présent dans le CSV n'est pas forcément fiable : Apollo /
            # Evaboot fournissent souvent des emails DEVINÉS. On ne le marque
            # 'manual' (= envoyable directement) que si une colonne de statut le
            # confirme (« verified », « valid »…). Sinon → 'linkedin_pattern',
            # qui est dans UNVERIFIED_EMAIL_SOURCES : badge « à vérifier » + non
            # envoyé automatiquement (l'utilisateur valide/corrige avant envoi).
            csv_email = (row.get(cols["email"] or "") or "").strip()
            email_status = (row.get(cols["email_status"] or "") or "").strip().lower()
            _VERIFIED = ("verified", "valid", "safe", "ok", "deliverable", "vérifié", "verifie")
            if not csv_email:
                email_source = "pattern"
            elif any(v in email_status for v in _VERIFIED):
                email_source = "manual"
            else:
                email_source = "linkedin_pattern"  # importé mais non confirmé → à vérifier

            # Construction Company
            c = Company(
                name=company_name,
                website=website,
                contact_name=full_name,
                contact_role=(row.get(cols["title"] or "") or "").strip(),  # vide si pas de titre (honnête)
                contact_email=csv_email,
                region=(row.get(cols["location"] or "") or "").strip(),
                activity_domain=(row.get(cols["industry"] or "") or "").strip(),
                company_size=(row.get(cols["company_size"] or "") or "").strip(),
                source="linkedin_sales_nav",
                email_source=email_source,
            )

            # Dédup : un même (nom normalisé + domaine) ne passe qu'une fois
            key = c.key()
            if key in seen_keys:
                continue
            seen_keys.add(key)
            companies.append(c)

    return companies


def summarize_import(companies: list[Company]) -> dict[str, int]:
    """Stats utiles pour le log après import : combien d'emails déjà présents, etc."""
    return {
        "total":              len(companies),
        "with_email":         sum(1 for c in companies if c.contact_email),
        "with_website":       sum(1 for c in companies if c.website),
        "with_contact_name":  sum(1 for c in companies if c.contact_name),
        "with_role":          sum(1 for c in companies if c.contact_role and c.contact_role != "Responsable RH"),
    }
