"""
scrape_leads.py — Point d'entrée CLI du pipeline scraping Carreer-ops.

Ce fichier est volontairement mince : toute la logique est dans le package
`candio_scraper/` (modèles, infra, scrapers, enrich, scoring, I/O, pipeline).

Usage :
  python scrape_leads.py -s "data analyst" -c "Paris" -m 60
  python scrape_leads.py -s "data analyst" -i "finance" -c "Paris" --sources kompass,pj,apec
  python scrape_leads.py --enrich-only --enrich-csv leads.csv
  python scrape_leads.py --resume

Pipeline en 12 phases :
  1.  Collecte     : WTTJ · Indeed · APEC · Cadremploi · Kompass · PJ · SIRENE · Pappers …
  2.  Filtre MX    : élimine les domaines sans serveur mail
  3.  Catch-all    : détecte les domaines qui acceptent tout
  4.  Web crawl    : emails directs sur /recrutement /equipe /contact (avec découverte de liens)
  4b. WHOIS        : emails dans les données d'enregistrement (PME FR)
  5.  Hunter.io    : enrichissement + format email du domaine
  5b. Snov / Apollo: grandes structures
  5c. LinkedIn+SMTP: format Hunter → SMTP RCPT TO
  6.  Stack tech   : Wappalyzer + détection mots-clés
  7.  Validation   : NeverBounce / ZeroBounce (optionnel)
  8.  Score        : fraîcheur + pertinence stack + qualité email
  9.  Dédup global : exclut les domaines déjà en base Carreer-ops
  10. Export CSV   : format importable dans une campagne
"""

from __future__ import annotations

import os
import sys

# Force UTF-8 sur Windows (console cp1252 par défaut)
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass  # Python < 3.7

# Le package est dans le même répertoire que ce script — on s'assure qu'il est trouvable
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from candio_scraper.pipeline import main


if __name__ == "__main__":
    main()
