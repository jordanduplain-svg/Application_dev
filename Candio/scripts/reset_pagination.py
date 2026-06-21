#!/usr/bin/env python
"""
reset_pagination — Remet à zéro les curseurs de pagination des sources.

L'option « Pages suivantes des sources » (explore_sources) mémorise, par
(source, poste, zone), la page atteinte au run précédent — clés `pagecursor:*`
dans le cache SQLite. Avec le temps, les recherches partent « pages dès 14 »
et le filon se tarit. Ce script supprime ces curseurs → la prochaine recherche
repart de la page 1.

Volontairement léger : uniquement la stdlib `sqlite3` (n'importe PAS candio_scraper,
donc aucun chargement de scrapling/patchright — exécution instantanée).

Usage :
    python reset_pagination.py                 # cache par défaut (~/.cache/carreer-ops/scraper.db)
    python reset_pagination.py --db <chemin>   # chemin de DB explicite (passé par Electron)

Sortie machine (pour l'IPC) : une ligne `RESET_PAGINATION_OK <n>` (n = curseurs supprimés).
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

PREFIX = "pagecursor:"


def _default_db() -> Path:
    return Path.home() / ".cache" / "carreer-ops" / "scraper.db"


def reset_pagination(db_path: Path) -> int:
    """Supprime toutes les clés `pagecursor:*` du cache. Retourne le nombre supprimé."""
    if not db_path.exists():
        print(f"ℹ  Aucun cache trouvé ({db_path}) — rien à réinitialiser.")
        print("RESET_PAGINATION_OK 0")
        return 0
    conn = sqlite3.connect(str(db_path))
    try:
        # Compte avant suppression (pour le retour utilisateur).
        cur = conn.execute(
            "SELECT COUNT(*) FROM cache WHERE key LIKE ?", (PREFIX + "%",)
        )
        n = cur.fetchone()[0]
        conn.execute("DELETE FROM cache WHERE key LIKE ?", (PREFIX + "%",))
        conn.commit()
        return int(n)
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="Réinitialise les curseurs de pagination des sources.")
    ap.add_argument("--db", default="", help="Chemin du cache SQLite (défaut : ~/.cache/carreer-ops/scraper.db)")
    args = ap.parse_args()

    db_path = Path(args.db) if args.db else _default_db()
    try:
        n = reset_pagination(db_path)
    except sqlite3.OperationalError as e:
        # Table 'cache' absente (cache neuf) → traité comme « rien à faire ».
        if "no such table" in str(e).lower():
            print("ℹ  Cache vide (table absente) — rien à réinitialiser.")
            print("RESET_PAGINATION_OK 0")
            return 0
        print(f"❌  Erreur SQLite : {e}")
        return 1
    except Exception as e:
        print(f"❌  Erreur : {e}")
        return 1

    if n:
        print(f"✅  {n} curseur(s) de pagination réinitialisé(s) — les recherches repartent de la page 1.")
    else:
        print("ℹ  Aucun curseur de pagination à réinitialiser (déjà à zéro).")
    print(f"RESET_PAGINATION_OK {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
