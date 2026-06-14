"""
candio_scraper — Pipeline de scraping multi-sources pour Carreer-ops.

Découpé depuis l'ancien `scrape_leads.py` monolithique (~5000 lignes).
Modules :
  - models    : dataclasses (Company, EmailResult)
  - infra     : cache, retry, rate limit, fetcher
  - constants : SECTOR_NAF, CONTACT_PATHS, regex globales
  - sources   : tous les scrapers (WTTJ, Indeed, SIRENE, …)
  - enrich    : MX, catch-all, web crawl, Hunter, Snov, Apollo, WHOIS, stack tech, validation
  - scoring   : score_and_sort, fuzzy_dedup, feedback
  - io_csv    : CSV/HTML I/O, merge master
  - pipeline  : RunConfig + orchestration des phases
"""

from .models import Company

__all__ = ["Company"]
