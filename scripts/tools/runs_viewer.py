#!/usr/bin/env python
"""
runs_viewer — Tableau de bord HTML des runs de scraping (A14).

Sert une page web minimaliste qui visualise :
  - l'historique des runs (depuis stats.jsonl, A6) : durée, volume, taux email
  - un graphe sparkline du taux d'email trouvé dans le temps
  - les checkpoints actifs (runs interrompus, depuis checkpoint-*.json)

100 % stdlib (http.server) — aucune dépendance Flask. Ouvre le navigateur.

Usage :
    python tools/runs_viewer.py             # sert sur http://localhost:8770
    python tools/runs_viewer.py --port 9000
    python tools/runs_viewer.py --no-open   # ne pas ouvrir le navigateur
"""
from __future__ import annotations

import argparse
import json
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


def _cache_dir() -> Path:
    return Path.home() / ".cache" / "carreer-ops"


def load_runs() -> list[dict]:
    path = _cache_dir() / "stats.jsonl"
    if not path.exists():
        return []
    out: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def load_checkpoints() -> list[dict]:
    """Liste les checkpoints actifs (runs interrompus récupérables)."""
    out: list[dict] = []
    for cp in _cache_dir().glob("checkpoint-*.json"):
        try:
            data = json.loads(cp.read_text(encoding="utf-8"))
            out.append({
                "file":      cp.name,
                "phase":     data.get("phase"),
                "saved_at":  data.get("saved_at", "")[:19],
                "companies": len(data.get("companies", [])),
            })
        except Exception:
            pass
    return out


def _render_html() -> str:
    runs = load_runs()
    checkpoints = load_checkpoints()

    # Sparkline du taux d'email (SVG inline, sans dépendance)
    pcts = [r.get("email_found_pct", 0) for r in runs][-40:]
    spark = ""
    if len(pcts) >= 2:
        w, h = 600, 80
        step = w / (len(pcts) - 1)
        pts = " ".join(
            f"{i*step:.1f},{h - (p/100*h):.1f}" for i, p in enumerate(pcts)
        )
        spark = (f'<svg width="{w}" height="{h}" style="background:#0d1117;border-radius:8px">'
                 f'<polyline fill="none" stroke="#30d158" stroke-width="2" points="{pts}"/></svg>')

    rows = ""
    for r in reversed(runs[-50:]):
        ts     = (r.get("ts") or "")[:19]
        dur    = r.get("duration_s", 0)
        m, s   = divmod(int(dur), 60)
        dur_s  = f"{m}m{s:02d}s" if m else f"{s}s"
        exp    = r.get("n_exported", 0)
        pct    = r.get("email_found_pct", 0)
        sector = r.get("sector", "")
        city   = r.get("city", "")
        srcs   = ", ".join(r.get("sources", []))
        pct_color = "#30d158" if pct >= 50 else "#ff9f0a" if pct >= 25 else "#ff453a"
        rows += f"""<tr>
          <td style="color:#8b949e;font-size:12px">{ts}</td>
          <td><strong>{sector}</strong><br><small style="color:#8b949e">{city}</small></td>
          <td style="font-size:12px;color:#8b949e">{srcs}</td>
          <td style="text-align:right">{dur_s}</td>
          <td style="text-align:right">{exp}</td>
          <td style="text-align:right;color:{pct_color};font-weight:600">{pct}%</td>
        </tr>"""

    cp_rows = ""
    for cp in checkpoints:
        cp_rows += f"""<tr>
          <td style="font-family:monospace;font-size:12px">{cp['file']}</td>
          <td style="text-align:center">Phase {cp['phase']}</td>
          <td style="text-align:right">{cp['companies']}</td>
          <td style="color:#8b949e;font-size:12px">{cp['saved_at']}</td>
        </tr>"""
    cp_section = ""
    if checkpoints:
        cp_section = f"""
        <h2>⏸ Checkpoints actifs ({len(checkpoints)})</h2>
        <p style="color:#8b949e">Runs interrompus — relançables avec <code>--resume</code>.</p>
        <table>
          <thead><tr><th>Fichier</th><th>Phase</th><th>Entreprises</th><th>Sauvegardé</th></tr></thead>
          <tbody>{cp_rows}</tbody>
        </table>"""

    n = len(runs)
    avg_pct = sum(pcts) / len(pcts) if pcts else 0

    return f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Carreer-ops — Runs</title>
<style>
  body {{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          background:#010409; color:#e6edf3; margin:0; padding:24px; }}
  h1 {{ font-size:22px; margin:0 0 4px; }}
  h2 {{ font-size:16px; margin:28px 0 8px; }}
  .meta {{ color:#8b949e; font-size:13px; margin-bottom:20px; }}
  table {{ width:100%; border-collapse:collapse; background:#0d1117;
           border-radius:10px; overflow:hidden; box-shadow:0 1px 6px #0008; }}
  th {{ background:#161b22; text-align:left; padding:8px 12px; font-size:12px; color:#8b949e; }}
  td {{ padding:8px 12px; border-bottom:1px solid #21262d; font-size:13px; vertical-align:top; }}
  tr:last-child td {{ border-bottom:none; }}
  tr:hover td {{ background:#161b22; }}
  code {{ background:#161b22; padding:2px 6px; border-radius:4px; }}
</style></head><body>
<h1>📊 Carreer-ops — Tableau de bord des runs</h1>
<div class="meta">{n} run(s) enregistré(s) · taux email moyen {avg_pct:.0f}% · données : ~/.cache/carreer-ops/stats.jsonl</div>
<h2>📈 Taux d'email trouvé (40 derniers runs)</h2>
{spark or '<p style="color:#8b949e">Pas assez de données pour le graphe (≥ 2 runs requis).</p>'}
{cp_section}
<h2>🗂 Historique des runs (50 derniers)</h2>
<table>
  <thead><tr><th>Date</th><th>Recherche</th><th>Sources</th><th>Durée</th><th>Export</th><th>%Email</th></tr></thead>
  <tbody>{rows or '<tr><td colspan=6 style="text-align:center;color:#8b949e">Aucun run.</td></tr>'}</tbody>
</table>
</body></html>"""


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path not in ("/", "/index.html"):
            self.send_response(404)
            self.end_headers()
            return
        html = _render_html().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html)))
        self.end_headers()
        self.wfile.write(html)

    def log_message(self, *args):  # silence les logs HTTP par requête
        pass


def main() -> int:
    ap = argparse.ArgumentParser(description="Tableau de bord HTML des runs (A14)")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--no-open", action="store_true", help="Ne pas ouvrir le navigateur")
    args = ap.parse_args()

    url = f"http://localhost:{args.port}"
    server = HTTPServer(("127.0.0.1", args.port), _Handler)
    print(f"🌐  Tableau de bord Carreer-ops → {url}  (Ctrl+C pour arrêter)")
    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋  Arrêt.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
