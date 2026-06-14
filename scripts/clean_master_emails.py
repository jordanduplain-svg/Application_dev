#!/usr/bin/env python3
"""
Nettoie le master candio_leads.csv des emails non pertinents (mailboxes
techniques/registrar/IR/conformité…), en réutilisant EXACTEMENT le même filtre
que le scraper (candio_scraper.enrich._is_junk_email) pour rester cohérent.

Pour chaque ligne :
  - si contactEmail est junk → on le vide et on tente de le remplacer par la
    meilleure alternative non-junk (emailAlternatives) ; sinon emailSource = no_email.
  - on purge aussi emailAlternatives de ses entrées junk.

Un backup horodaté est créé avant toute écriture. Idempotent : relançable sans risque.

Usage :
    python clean_master_emails.py [chemin_csv]   # défaut : ./candio_leads.csv
"""
from __future__ import annotations

import csv
import shutil
import sys
from datetime import datetime
from pathlib import Path

# Console Windows en cp1252 : force l'UTF-8 pour pouvoir afficher les emojis
# (sinon UnicodeEncodeError sur les print). No-op si déjà UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Réutilise le filtre du scraper (source unique de vérité)
from candio_scraper.enrich import _is_junk_email, _rank_email
from candio_scraper.models import _domain

# Séparateur utilisé dans emailAlternatives (cf. io_csv : "a@x|b@x|…")
_ALT_SEP = "|"


def _clean_alternatives(raw: str) -> list[str]:
    """Retourne la liste des alternatives non-junk, dédupliquées, ordre préservé."""
    out: list[str] = []
    seen: set[str] = set()
    for part in (raw or "").replace(",", _ALT_SEP).replace(";", _ALT_SEP).split(_ALT_SEP):
        em = part.strip()
        if not em or "@" not in em:
            continue
        key = em.lower()
        if key in seen or _is_junk_email(em):
            continue
        seen.add(key)
        out.append(em)
    return out


def _best_alternative(alts: list[str], website: str) -> str:
    """Choisit la meilleure alternative via le scoring RH du scraper."""
    if not alts:
        return ""
    dom = _domain(website) if website else ""
    # _rank_email exige que le domaine du site soit dans l'email ; à défaut on
    # prend la 1re alternative (déjà filtrée des junk).
    if dom:
        ranked = sorted(alts, key=lambda e: _rank_email(e, dom), reverse=True)
        if _rank_email(ranked[0], dom) > 0:
            return ranked[0]
    return alts[0]


def clean_csv(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f"❌ Fichier introuvable : {path}")

    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    if "contactEmail" not in fieldnames:
        raise SystemExit("❌ Colonne 'contactEmail' absente — format inattendu.")

    # Sources « devinées » (jamais confirmées, à risque de bounce) — l'utilisateur
    # ne veut PAS ces lignes dans le master.
    GUESSED_SOURCES = {"pattern", "pattern_nominative", "catch_all"}

    stats = {"supprimees_vides": 0, "supprimees_junk": 0, "supprimees_devinees": 0,
             "promus_depuis_alt": 0, "alts_nettoyees": 0, "lignes": len(rows)}
    kept: list[dict] = []

    for row in rows:
        email = (row.get("contactEmail") or "").strip()
        website = row.get("website") or ""
        src = (row.get("emailSource") or "").strip().lower()

        # 1. Nettoie les alternatives (retire les junk/génériques)
        cleaned_alts = _clean_alternatives(row.get("emailAlternatives", "")) if "emailAlternatives" in row else []
        if "emailAlternatives" in row:
            new_alt_str = _ALT_SEP.join(cleaned_alts)
            if new_alt_str != (row.get("emailAlternatives") or "").strip():
                stats["alts_nettoyees"] += 1
            row["emailAlternatives"] = new_alt_str

        # 2. Cas à problème : email vide, junk/générique, ou source devinée.
        bad_empty   = not email
        bad_junk    = bool(email) and _is_junk_email(email)
        bad_guessed = bool(email) and src in GUESSED_SOURCES
        if bad_empty or bad_junk or bad_guessed:
            # On tente d'abord de promouvoir une VRAIE alternative (non junk).
            replacement = _best_alternative(cleaned_alts, website)
            if replacement and not _is_junk_email(replacement):
                row["contactEmail"] = replacement
                if "emailSource" in row:
                    row["emailSource"] = "web_crawl"
                if "emailValidated" in row:
                    row["emailValidated"] = "false"
                row["emailAlternatives"] = _ALT_SEP.join(
                    [a for a in cleaned_alts if a.lower() != replacement.lower()])
                stats["promus_depuis_alt"] += 1
                kept.append(row)
                continue
            # Sinon : on SUPPRIME la ligne (demande utilisateur).
            if bad_empty:
                stats["supprimees_vides"] += 1
            elif bad_junk:
                stats["supprimees_junk"] += 1
            else:
                stats["supprimees_devinees"] += 1
            continue

        kept.append(row)

    # Backup avant écriture
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_name(f"{path.stem}.bak.cleanmail_{ts}.csv")
    shutil.copy2(path, backup)

    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(kept)

    stats["restantes"] = len(kept)

    # Régénère l'aperçu HTML depuis le CSV nettoyé pour qu'il reste synchronisé
    # avec l'app (sinon l'utilisateur reverrait les emails purgés dans l'aperçu).
    try:
        from candio_scraper.io_csv import load_companies_from_csv, export_html_preview
        companies = load_companies_from_csv(str(path))
        export_html_preview(companies, path.with_suffix(".html"))
        stats["html"] = str(path.with_suffix(".html"))
    except Exception as exc:  # non bloquant
        stats["html"] = f"(non régénéré : {exc})"

    stats["backup"] = str(backup)
    return stats


def main() -> None:
    # Défaut : scripts/data/candio_leads.csv (les données ont migré dans data/).
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "data" / "candio_leads.csv"
    stats = clean_csv(path)
    print(f"✅ Nettoyage terminé : {path}")
    print(f"   Lignes au départ        : {stats['lignes']}")
    print(f"   Supprimées (vides)      : {stats['supprimees_vides']}")
    print(f"   Supprimées (junk/génér.): {stats['supprimees_junk']}")
    print(f"   Supprimées (devinées)   : {stats['supprimees_devinees']}")
    print(f"   Promues depuis alt.     : {stats['promus_depuis_alt']}")
    print(f"   Listes alt. nettoyées   : {stats['alts_nettoyees']}")
    print(f"   → Lignes restantes      : {stats['restantes']}")
    print(f"   Aperçu HTML             : {stats.get('html', '—')}")
    print(f"   Backup                  : {stats['backup']}")


if __name__ == "__main__":
    main()
