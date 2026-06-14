#!/usr/bin/env python
"""
bench_report — Agrégation des stats de run (A13).

Lit ~/.cache/carreer-ops/stats.jsonl (écrit par pipeline._write_run_stats, A6)
et produit un rapport synthétique : durée moyenne, tendance du taux d'emails
trouvés, rendement par source de collecte. 100 % stdlib, offline, sans réseau.

Usage :
    python tools/bench_report.py                 # rapport des 20 derniers runs
    python tools/bench_report.py --all           # tous les runs
    python tools/bench_report.py --json           # sortie JSON brute
    python tools/bench_report.py --file chemin.jsonl
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _default_stats_path() -> Path:
    return Path.home() / ".cache" / "carreer-ops" / "stats.jsonl"


def load_runs(path: Path) -> list[dict]:
    """Charge les lignes JSONL valides (ignore les lignes corrompues)."""
    if not path.exists():
        return []
    runs: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            runs.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return runs


def _fmt_duration(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m}m{s:02d}s" if m else f"{s}s"


def print_report(runs: list[dict]) -> None:
    if not runs:
        print("Aucun run enregistré. Lancez d'abord un scraping (stats écrites en fin de run).")
        return

    n = len(runs)
    durations = [r.get("duration_s", 0) for r in runs]
    exported  = [r.get("n_exported", 0) for r in runs]
    pcts      = [r.get("email_found_pct", 0) for r in runs]

    avg_dur = sum(durations) / n
    avg_exp = sum(exported) / n
    avg_pct = sum(pcts) / n

    print("=" * 64)
    print(f"  RAPPORT BENCH — {n} run(s)")
    print("=" * 64)
    print(f"  Durée moyenne       : {_fmt_duration(avg_dur)}  (min {_fmt_duration(min(durations))} · max {_fmt_duration(max(durations))})")
    print(f"  Entreprises/run     : {avg_exp:.0f}  (min {min(exported)} · max {max(exported)})")
    print(f"  Taux email trouvé   : {avg_pct:.0f}%  (min {min(pcts)}% · max {max(pcts)}%)")

    # Vitesse : entreprises par minute (proxy de débit)
    speeds = [(e / (d / 60)) for e, d in zip(exported, durations) if d > 0]
    if speeds:
        print(f"  Débit moyen         : {sum(speeds)/len(speeds):.1f} entreprises/min")

    # ── Rendement email agrégé par source d'email ─────────────────────────────
    email_src_total: dict[str, int] = {}
    for r in runs:
        for src, cnt in (r.get("email_sources") or {}).items():
            email_src_total[src] = email_src_total.get(src, 0) + cnt
    if email_src_total:
        print("\n  Sources d'email (cumulé) :")
        for src, cnt in sorted(email_src_total.items(), key=lambda x: -x[1]):
            print(f"    {src:<22} : {cnt}")

    # ── Rendement par source de collecte ──────────────────────────────────────
    collect_total: dict[str, int] = {}
    for r in runs:
        for src, cnt in (r.get("collect_sources") or {}).items():
            collect_total[src] = collect_total.get(src, 0) + cnt
    if collect_total:
        print("\n  Sources de collecte (cumulé) :")
        for src, cnt in sorted(collect_total.items(), key=lambda x: -x[1]):
            print(f"    {src:<22} : {cnt}")

    # ── Tendance : 5 derniers runs (détection de régression) ──────────────────
    print("\n  5 derniers runs :")
    print(f"    {'date':<20} {'durée':>8} {'export':>7} {'%email':>7}  secteur")
    for r in runs[-5:]:
        ts     = (r.get("ts") or "")[:19]
        dur    = _fmt_duration(r.get("duration_s", 0))
        exp    = r.get("n_exported", 0)
        pct    = r.get("email_found_pct", 0)
        sector = (r.get("sector") or "")[:24]
        print(f"    {ts:<20} {dur:>8} {exp:>7} {pct:>6}%  {sector}")
    print("=" * 64)


def main() -> int:
    ap = argparse.ArgumentParser(description="Rapport d'agrégation des stats de run (A13)")
    ap.add_argument("--file", default="", help="Chemin du stats.jsonl (défaut : ~/.cache/carreer-ops/stats.jsonl)")
    ap.add_argument("--all", action="store_true", help="Analyser tous les runs (défaut : 20 derniers)")
    ap.add_argument("--json", action="store_true", help="Sortie JSON brute des runs analysés")
    args = ap.parse_args()

    path = Path(args.file) if args.file else _default_stats_path()
    runs = load_runs(path)
    if not args.all:
        runs = runs[-20:]

    if args.json:
        print(json.dumps(runs, ensure_ascii=False, indent=2))
    else:
        print_report(runs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
