#!/usr/bin/env python
"""
check.py — Garde qualité du scraper Python (à lancer avant commit / build).

Deux étapes, dans l'ordre :

  1. pyflakes — analyse statique. ÉCHEC DUR uniquement sur les « undefined name »
     (la classe de bug NameError qui casse un run réel sans être vue par les tests,
     ex : un symbole déplacé lors d'un refactor mais oublié dans un import).
     Les autres avertissements (imports inutilisés…) sont affichés mais NE bloquent pas.

  2. unittest — la suite tests.test_scraper (logique pure, déterministe).

Codes de sortie : 0 = tout vert · 1 = undefined name ou test en échec · 2 = erreur d'exécution.

Usage :
    cd scripts && python check.py
    pnpm check:py            # depuis la racine (voir package.json)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
TARGETS = ["candio_scraper", "tools"]   # dossiers analysés par pyflakes


def _run(cmd: list[str]) -> tuple[int, str]:
    """Lance une commande, retourne (returncode, stdout+stderr)."""
    proc = subprocess.run(
        cmd, cwd=str(SCRIPTS_DIR),
        capture_output=True, text=True,
        env={**__import__("os").environ, "PYTHONUTF8": "1"},
    )
    return proc.returncode, (proc.stdout + proc.stderr)


def step_pyflakes() -> bool:
    """True si aucun 'undefined name'. Affiche le reste sans bloquer."""
    print("① pyflakes (garde anti-NameError)…")
    targets = [t for t in TARGETS if (SCRIPTS_DIR / t).exists()]
    code, out = _run([sys.executable, "-m", "pyflakes", *targets])

    if "No module named pyflakes" in out:
        print("   ⚠  pyflakes non installé — garde statique SAUTÉE.")
        print("      Installez-le : pip install pyflakes  (ou pip install -r requirements.txt)")
        return True   # dégradation propre : on ne bloque pas faute d'outil

    lines = [l for l in out.splitlines() if l.strip()]
    undefined = [l for l in lines if "undefined name" in l]
    others    = [l for l in lines if "undefined name" not in l]

    if others:
        print(f"   ℹ  {len(others)} avertissement(s) non bloquant(s) (imports inutilisés, etc.) :")
        for l in others[:15]:
            print(f"      {l}")
        if len(others) > 15:
            print(f"      … (+{len(others)-15})")

    if undefined:
        print(f"   ❌  {len(undefined)} NOM(S) NON DÉFINI(S) — bug de type NameError, run cassé :")
        for l in undefined:
            print(f"      {l}")
        return False

    print("   ✓  0 undefined name")
    return True


def step_tests() -> bool:
    """True si la suite unittest passe."""
    print("\n② unittest (tests.test_scraper)…")
    code, out = _run([sys.executable, "-m", "unittest", "tests.test_scraper"])
    # unittest écrit le résumé ('OK' / 'FAILED') sur stderr (capté dans out).
    tail = "\n".join(out.splitlines()[-4:])
    print("   " + tail.replace("\n", "\n   "))
    return code == 0


def main() -> int:
    print("=" * 56)
    print("  CHECK QUALITÉ — candio_scraper")
    print("=" * 56)
    try:
        ok_flakes = step_pyflakes()
        ok_tests  = step_tests()
    except Exception as e:
        print(f"\n💥  Erreur d'exécution du check : {e}")
        return 2

    print("\n" + "=" * 56)
    if ok_flakes and ok_tests:
        print("  ✅  TOUT VERT")
        print("=" * 56)
        return 0
    print("  ❌  ÉCHEC — corrigez avant de commit/build")
    print("=" * 56)
    return 1


if __name__ == "__main__":
    sys.exit(main())
