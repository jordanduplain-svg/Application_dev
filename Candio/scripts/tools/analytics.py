"""
analytics.py — Tableau de bord de conversion Carreer-ops.

Usage :
    python tools/analytics.py [--csv data/candio_leads.csv] [--db ../apps/desktop/prisma/dev.db]
    python tools/analytics.py --open     # ouvre le rapport HTML après génération

Ce script produit :
  1. Un résumé texte dans le terminal (fonctionne même sans matplotlib).
  2. Un rapport HTML interactif avec graphiques inline base64 (ouvrable dans le navigateur).

Données croisées :
  - master CSV  → score, source, secteur, taille, localisation
  - SQLite DB   → statuts des candidatures (SENT / REPLIED / FOLLOWED_UP / FAILED)
    Si la DB est vide ou absente, l'analyse ne couvre que la qualité des leads (pas le taux de réponse).
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import sqlite3
import sys
import webbrowser
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

# ── Dépendances optionnelles ──────────────────────────────────────────────────

try:
    import matplotlib
    matplotlib.use("Agg")   # pas de display X11 requis
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    MATPLOTLIB = True
except ImportError:
    MATPLOTLIB = False

try:
    import numpy as np
    NUMPY = True
except ImportError:
    NUMPY = False


# ── Helpers ───────────────────────────────────────────────────────────────────

PALETTE = ["#007aff", "#34c759", "#ff9f0a", "#ff3b30", "#af52de",
           "#5ac8fa", "#ffcc00", "#ff6b2b", "#30d158", "#64d2ff"]

SOURCE_LABELS = {
    "hunter_verified": "Hunter ✓",
    "web_crawl":       "Crawl web",
    "llm_crawl":       "Crawl LLM",
    "pattern_nominative": "Pattern nominatif",
    "pattern_verified":   "Pattern vérifié",
    "pattern":         "Pattern générique",
    "whois":           "WHOIS",
    "github_org":      "GitHub",
    "hunter_found":    "Hunter (non vérifié)",
    "linkedin_smtp":   "LinkedIn SMTP",
    "catch_all":       "Catch-all",
}


def _domain(url: str) -> str:
    if not url:
        return ""
    url = re.sub(r"^https?://", "", url).lstrip("www.").split("/")[0].lower()
    return url


def _fig_to_b64(fig) -> str:
    """Convertit un figure matplotlib en PNG base64 pour l'HTML inline."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
    buf.seek(0)
    import base64
    return base64.b64encode(buf.read()).decode()


def _bar(ax, labels, values, colors=None, title="", xlabel="", ylabel=""):
    colors = colors or PALETTE[:len(labels)]
    bars = ax.bar(labels, values, color=colors, edgecolor="white", linewidth=0.8)
    ax.set_title(title, fontsize=12, fontweight="bold", pad=8)
    ax.set_xlabel(xlabel, fontsize=9)
    ax.set_ylabel(ylabel, fontsize=9)
    ax.tick_params(axis="x", rotation=30, labelsize=8)
    ax.spines[["top", "right"]].set_visible(False)
    for bar, val in zip(bars, values):
        if val > 0:
            ax.text(bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + max(values) * 0.01,
                    str(val), ha="center", va="bottom", fontsize=8)
    return bars


# ══════════════════════════════════════════════════════════════════════════════
# CHARGEMENT DES DONNÉES
# ══════════════════════════════════════════════════════════════════════════════

def load_csv(path: Path) -> list[dict]:
    if not path.exists():
        print(f"❌  CSV introuvable : {path}")
        sys.exit(1)
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    print(f"✅  {len(rows)} leads chargés depuis {path.name}")
    return rows


def load_db(path: Path) -> dict[str, dict]:
    """
    Retourne {domain → {status, manualStatus, replied, bounced}} depuis la DB Prisma.
    Retourne {} si DB vide ou absente.
    """
    if not path.exists():
        return {}
    try:
        conn = sqlite3.connect(str(path))
        # Jointure Application ↔ Company pour récupérer le domaine
        rows = conn.execute("""
            SELECT c.website, a.status, a.manualStatus
            FROM Application a
            JOIN Company c ON c.id = a.companyId
            WHERE a.status NOT IN ('DRAFT')
        """).fetchall()
        conn.close()
    except Exception as e:
        print(f"⚠  DB inaccessible ({e}) — analyse sans données de campagne")
        return {}

    result: dict[str, dict] = {}
    for website, status, manual_status in rows:
        dom = _domain(website or "")
        if not dom:
            continue
        if dom not in result:
            result[dom] = {"status": status, "manualStatus": manual_status,
                           "replied": False, "bounced": False}
        if status == "REPLIED":
            result[dom]["replied"] = True
        if status == "FAILED" and manual_status == "BOUNCED":
            result[dom]["bounced"] = True

    if result:
        print(f"✅  {len(result)} candidatures chargées depuis la DB")
    else:
        print("ℹ️  DB vide — le taux de réponse ne sera pas calculé (pas encore d'envois)")
    return result


# ══════════════════════════════════════════════════════════════════════════════
# ANALYSES
# ══════════════════════════════════════════════════════════════════════════════

def analyse_quality(rows: list[dict], db: dict[str, dict]) -> dict:
    """Calcule tous les indicateurs depuis le CSV + DB."""
    total = len(rows)

    # ── Sources ──────────────────────────────────────────────────────────────
    source_count: Counter = Counter(r.get("emailSource", "?") for r in rows)

    # Rang de qualité des sources (hérite de io_csv._email_rank)
    SOURCE_RANK = {
        "hunter_verified": 0, "manual": 0,
        "web_crawl": 1, "llm_crawl": 1,
        "linkedin_smtp": 1, "whois": 2,
        "github_org": 3, "hunter_found": 4,
        "pattern_nominative": 5, "pattern_verified": 5,
        "catch_all": 6, "pattern": 7,
    }
    high_quality = sum(1 for r in rows
                       if SOURCE_RANK.get(r.get("emailSource",""), 99) <= 2)

    # ── Scores ───────────────────────────────────────────────────────────────
    scores = [int(r.get("totalScore", 0) or 0) for r in rows]
    buckets = Counter()
    for s in scores:
        if s >= 150:   buckets["≥150 (top)"] += 1
        elif s >= 80:  buckets["80-149"] += 1
        elif s >= 30:  buckets["30-79"] += 1
        else:          buckets["<30"] += 1

    # ── Secteurs ─────────────────────────────────────────────────────────────
    sectors = Counter(r.get("sector", "N/A") or "N/A" for r in rows)

    # ── Tailles ──────────────────────────────────────────────────────────────
    sizes = Counter(r.get("companySizeBucket", "N/A") or "N/A" for r in rows)

    # ── Localisation ─────────────────────────────────────────────────────────
    depts = Counter(r.get("deptName", "") or r.get("dept", "") or "N/A"
                    for r in rows)

    # ── ATS ──────────────────────────────────────────────────────────────────
    ats_names = Counter(r.get("atsName", "") for r in rows if r.get("atsName"))

    # ── Contact name fill rate ───────────────────────────────────────────────
    has_contact = sum(1 for r in rows if r.get("contactName"))

    # ── DB : taux de réponse par segment ────────────────────────────────────
    reply_by_source: dict[str, dict] = defaultdict(lambda: {"sent": 0, "replied": 0})
    reply_by_score_bucket: dict[str, dict] = defaultdict(lambda: {"sent": 0, "replied": 0})
    reply_by_sector: dict[str, dict] = defaultdict(lambda: {"sent": 0, "replied": 0})
    overall_sent = overall_replied = 0

    if db:
        for r in rows:
            dom = _domain(r.get("website", ""))
            if dom not in db:
                continue
            src  = r.get("emailSource", "?")
            score = int(r.get("totalScore", 0) or 0)
            sect  = r.get("sector") or "N/A"

            if score >= 150:  sbucket = "≥150"
            elif score >= 80: sbucket = "80-149"
            elif score >= 30: sbucket = "30-79"
            else:             sbucket = "<30"

            for d in [reply_by_source[src], reply_by_score_bucket[sbucket], reply_by_sector[sect]]:
                d["sent"] += 1
            overall_sent += 1
            if db[dom]["replied"]:
                for d in [reply_by_source[src], reply_by_score_bucket[sbucket], reply_by_sector[sect]]:
                    d["replied"] += 1
                overall_replied += 1

    return {
        "total": total,
        "high_quality": high_quality,
        "source_count": source_count,
        "scores": scores,
        "score_buckets": buckets,
        "sectors": sectors,
        "sizes": sizes,
        "depts": depts,
        "ats_names": ats_names,
        "has_contact": has_contact,
        "db_available": bool(db),
        "overall_sent": overall_sent,
        "overall_replied": overall_replied,
        "reply_by_source": reply_by_source,
        "reply_by_score_bucket": reply_by_score_bucket,
        "reply_by_sector": reply_by_sector,
    }


# ══════════════════════════════════════════════════════════════════════════════
# RAPPORT TERMINAL
# ══════════════════════════════════════════════════════════════════════════════

def print_report(a: dict) -> None:
    total = a["total"]
    print()
    print("═" * 60)
    print("  ANALYTICS — Carreer-ops")
    print("═" * 60)

    print(f"\n📋  LEADS : {total} total")
    pct_hq = a["high_quality"] / total * 100 if total else 0
    print(f"    Emails haute qualité (crawl/hunter/WHOIS) : {a['high_quality']} ({pct_hq:.0f}%)")
    pct_ct = a["has_contact"] / total * 100 if total else 0
    print(f"    Contact nommé trouvé : {a['has_contact']} ({pct_ct:.0f}%)")

    print(f"\n📊  SOURCES EMAIL :")
    for src, cnt in a["source_count"].most_common():
        label = SOURCE_LABELS.get(src, src)
        bar = "█" * cnt
        print(f"    {label:<30} {cnt:3d}  {bar}")

    print(f"\n🎯  DISTRIBUTION DES SCORES :")
    for bucket, cnt in sorted(a["score_buckets"].items(), reverse=True):
        bar = "█" * cnt
        print(f"    {bucket:<12} {cnt:3d}  {bar}")
    if a["scores"]:
        print(f"    Moyenne : {sum(a['scores'])//len(a['scores'])}  "
              f"| Min : {min(a['scores'])}  | Max : {max(a['scores'])}")

    print(f"\n🏭  SECTEURS :")
    for s, cnt in a["sectors"].most_common(8):
        print(f"    {s:<25} {cnt:3d}")

    print(f"\n📍  TOP 5 DÉPARTEMENTS :")
    for d, cnt in a["depts"].most_common(5):
        print(f"    {d:<20} {cnt:3d}")


    if a["ats_names"]:
        print(f"\n🏢  ATS DÉTECTÉS :")
        for name, cnt in a["ats_names"].most_common():
            print(f"    {name:<20} {cnt:3d}")

    if a["db_available"] and a["overall_sent"] > 0:
        rate = a["overall_replied"] / a["overall_sent"] * 100
        print(f"\n📨  TAUX DE RÉPONSE GLOBAL : "
              f"{a['overall_replied']}/{a['overall_sent']} = {rate:.1f}%")

        print(f"\n📈  TAUX DE RÉPONSE PAR SOURCE :")
        for src, d in sorted(a["reply_by_source"].items(),
                              key=lambda x: x[1]["replied"]/max(x[1]["sent"],1), reverse=True):
            r = d["replied"] / max(d["sent"], 1) * 100
            print(f"    {SOURCE_LABELS.get(src,src):<30} {d['replied']}/{d['sent']}  ({r:.0f}%)")

        print(f"\n📈  TAUX DE RÉPONSE PAR SCORE :")
        for bucket, d in sorted(a["reply_by_score_bucket"].items(), reverse=True):
            r = d["replied"] / max(d["sent"], 1) * 100
            print(f"    {bucket:<12} {d['replied']}/{d['sent']}  ({r:.0f}%)")
    else:
        print("\nℹ️  Taux de réponse : pas encore de données (aucune candidature envoyée depuis l'app).")

    print("\n" + "═" * 60)


# ══════════════════════════════════════════════════════════════════════════════
# RAPPORT HTML
# ══════════════════════════════════════════════════════════════════════════════

def _make_charts(a: dict) -> dict[str, str]:
    """Génère les charts matplotlib, retourne {nom → base64 PNG}."""
    charts: dict[str, str] = {}
    if not MATPLOTLIB:
        return charts

    plt.rcParams.update({
        "font.family": "sans-serif",
        "axes.facecolor": "#f9f9fb",
        "figure.facecolor": "#ffffff",
    })

    # ── 1. Sources email ──────────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(7, 3.5))
    srcs = a["source_count"].most_common()
    labels = [SOURCE_LABELS.get(s, s) for s, _ in srcs]
    vals   = [v for _, v in srcs]
    _bar(ax, labels, vals, title="Sources email", ylabel="Leads")
    charts["sources"] = _fig_to_b64(fig); plt.close(fig)

    # ── 2. Distribution des scores ────────────────────────────────────────────
    if a["scores"]:
        fig, ax = plt.subplots(figsize=(6, 3))
        ax.hist(a["scores"], bins=20, color="#007aff", edgecolor="white", linewidth=0.8)
        ax.set_title("Distribution des scores", fontsize=12, fontweight="bold")
        ax.set_xlabel("Score total"); ax.set_ylabel("Leads")
        ax.spines[["top","right"]].set_visible(False)
        charts["scores_hist"] = _fig_to_b64(fig); plt.close(fig)

    # ── 3. Secteurs (pie) ─────────────────────────────────────────────────────
    sects = a["sectors"].most_common(6)
    if sects:
        fig, ax = plt.subplots(figsize=(5, 4))
        slabs  = [s for s,_ in sects]
        svals  = [v for _,v in sects]
        wedges, texts, autotexts = ax.pie(
            svals, labels=slabs, autopct="%1.0f%%",
            colors=PALETTE[:len(slabs)], startangle=90,
            pctdistance=0.8, labeldistance=1.12,
        )
        for at in autotexts: at.set_fontsize(8)
        ax.set_title("Secteurs", fontsize=12, fontweight="bold")
        charts["sectors_pie"] = _fig_to_b64(fig); plt.close(fig)

    # ── 4. Taille entreprises ─────────────────────────────────────────────────
    SIZE_ORDER = ["1-5","6-9","10-19","20-49","50-99","100-199",
                  "250-499","500-999","1000-1999","5000-9999","10000+","N/A"]
    size_labels = [s for s in SIZE_ORDER if s in a["sizes"]]
    size_vals   = [a["sizes"][s] for s in size_labels]
    if size_labels:
        fig, ax = plt.subplots(figsize=(7, 3))
        _bar(ax, size_labels, size_vals,
             title="Taille des entreprises", xlabel="Employés", ylabel="Leads")
        charts["sizes"] = _fig_to_b64(fig); plt.close(fig)

    # ── 5. Taux de réponse par source (si DB disponible) ─────────────────────
    if a["db_available"] and a["overall_sent"] > 0:
        src_data = [(SOURCE_LABELS.get(s,s), d["replied"]/max(d["sent"],1)*100, d["sent"])
                    for s,d in a["reply_by_source"].items() if d["sent"] >= 1]
        src_data.sort(key=lambda x: x[1], reverse=True)
        if src_data:
            fig, ax = plt.subplots(figsize=(7, 3.5))
            slabs = [f"{l}\n({n})" for l,_,n in src_data]
            svals = [r for _,r,_ in src_data]
            _bar(ax, slabs, svals, title="Taux de réponse par source (%)", ylabel="%")
            ax.set_ylim(0, max(svals)*1.3 if svals else 10)
            charts["reply_by_source"] = _fig_to_b64(fig); plt.close(fig)

    return charts


def build_html(a: dict, charts: dict[str, str]) -> str:
    def img(key: str) -> str:
        if key not in charts:
            return "<p style='color:#aaa'>Graphique non disponible (pip install matplotlib)</p>"
        return f"<img src='data:image/png;base64,{charts[key]}' style='max-width:100%'>"

    db_section = ""
    if a["db_available"] and a["overall_sent"] > 0:
        rate = a["overall_replied"] / a["overall_sent"] * 100
        db_section = f"""
        <div class="card full">
          <h2>📨 Taux de réponse</h2>
          <p class="big">{a['overall_replied']}/{a['overall_sent']}
             <span class="tag">{rate:.1f}%</span></p>
          {img("reply_by_source")}
        </div>"""
    else:
        db_section = """
        <div class="card full info">
          <h2>📨 Taux de réponse</h2>
          <p>Aucune candidature envoyée depuis l'app pour l'instant.
             Le taux de réponse s'affichera ici automatiquement dès le premier envoi.</p>
        </div>"""

    hq_pct = int(a["high_quality"] / a["total"] * 100) if a["total"] else 0
    ct_pct = int(a["has_contact"] / a["total"] * 100) if a["total"] else 0
    avg_score = sum(a["scores"]) // len(a["scores"]) if a["scores"] else 0

    return f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Analytics Carreer-ops — {date.today()}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         margin:0; padding:24px; background:#f5f5f7; color:#1c1c1e; }}
  h1   {{ margin:0 0 4px; font-size:22px; }}
  .meta{{ color:#666; font-size:13px; margin-bottom:24px; }}
  .grid{{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
  .card{{ background:#fff; border-radius:12px; padding:20px;
          box-shadow:0 1px 6px #0001; }}
  .full{{ grid-column:1/-1; }}
  .kpi {{ display:flex; gap:16px; margin-bottom:16px; }}
  .kpi-box {{ flex:1; background:#f0f4ff; border-radius:8px; padding:14px;
              text-align:center; }}
  .kpi-box .num {{ font-size:28px; font-weight:700; color:#007aff; }}
  .kpi-box .lbl {{ font-size:11px; color:#666; margin-top:2px; }}
  .tag {{ background:#007aff22; color:#007aff; border:1px solid #007aff44;
          border-radius:4px; padding:2px 8px; font-size:12px; font-weight:600; }}
  .big {{ font-size:24px; font-weight:700; }}
  h2   {{ margin:0 0 12px; font-size:15px; }}
  .info{{ background:#fff9e6; }}
</style></head>
<body>
<h1>Analytics Carreer-ops</h1>
<div class="meta">Généré le {date.today().strftime('%d/%m/%Y')} · {a['total']} leads · master CSV</div>

<div class="kpi">
  <div class="kpi-box"><div class="num">{a['total']}</div><div class="lbl">Leads total</div></div>
  <div class="kpi-box"><div class="num">{hq_pct}%</div><div class="lbl">Email haute qualité</div></div>
  <div class="kpi-box"><div class="num">{ct_pct}%</div><div class="lbl">Contact nommé</div></div>
  <div class="kpi-box"><div class="num">{avg_score}</div><div class="lbl">Score moyen</div></div>
</div>

<div class="grid">
  <div class="card">{img("sources")}</div>
  <div class="card">{img("scores_hist")}</div>
  <div class="card">{img("sectors_pie")}</div>
  <div class="card">{img("sizes")}</div>
  {db_section}
</div>
</body></html>"""


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser(description="Analytics Carreer-ops")
    parser.add_argument("--csv", default="data/candio_leads.csv",
                        help="Chemin vers le master CSV (défaut: data/candio_leads.csv)")
    parser.add_argument("--db",  default="../apps/desktop/prisma/dev.db",
                        help="Chemin vers la DB Prisma SQLite")
    parser.add_argument("--out", default="data/analytics.html",
                        help="Chemin du rapport HTML généré")
    parser.add_argument("--open", action="store_true",
                        help="Ouvrir le rapport HTML dans le navigateur après génération")
    args = parser.parse_args()

    rows = load_csv(Path(args.csv))
    db   = load_db(Path(args.db))
    a    = analyse_quality(rows, db)

    print_report(a)

    charts = _make_charts(a)
    html   = build_html(a, charts)
    out    = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"\n📄  Rapport HTML → {out.resolve()}")
    if not MATPLOTLIB:
        print("⚠  pip install matplotlib numpy   pour activer les graphiques")

    if args.open:
        webbrowser.open(str(out.resolve()))


if __name__ == "__main__":
    main()
