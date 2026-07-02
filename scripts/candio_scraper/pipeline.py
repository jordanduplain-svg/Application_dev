"""
pipeline — Orchestration des phases du scraping.

RunConfig regroupe tous les paramètres CLI/config en un dataclass.
_run_collect → _run_filter → _run_email_enrich → _run_metadata_enrich → _run_score_export.
"""

from __future__ import annotations

import argparse
import threading
import csv
import json
import os
import time
from dataclasses import dataclass, field
from datetime import date, timedelta, datetime
from pathlib import Path

import requests

from .models import Company, _domain
from .lead_quality import is_domain_suspect
from .infra import (
    PersistentCache, ScrapingCheckpoint, ProxyPool, LRUPageCache,
    RateLimiter, Deadline, _ThreadSafeFetcher, log,
)
from .constants import DEFAULT_SOURCES, DIRECTORY_SOURCES, EmailSource
from .sources import SCRAPERS
from .enrich import (
    filter_mx, enrich_catch_all, enrich_web_crawl,
    enrich_hunter, HunterClient, EmailValidator,
    enrich_clearbit, enrich_linkedin_smtp,
    enrich_whois, enrich_validation,
    smtp_batch_patterns, fuzzy_dedup, guess_email, generate_alternatives,
    github_find_email,   # Phase 5d (use_github) — re-exporté depuis enrich_apis (B2-1)
)
from .scoring import score_and_sort, load_domain_list, apply_feedback_scores
from .io_csv import (
    load_companies_from_csv, merge_into_master, export_html_preview,
    load_exclude_domains, filter_known_domains,
    CSV_FIELDNAMES,   # B2-5 : source unique pour les colonnes CSV
)


def _run_collect(
    cfg: "RunConfig",
    fetcher,
    rate_limiter: "RateLimiter | None",
    cache: "PersistentCache | None" = None,
    proxy_pool: "ProxyPool | None" = None,
) -> list[Company]:
    """
    Phase 1 : collecte multi-sources + filtres date et blacklist.

    ROUAGE / comment le VOLUME de résultats est gouverné (3 leviers distincts — c'est la
    source de la confusion fréquente « 1 page = beaucoup de résultats ») :
      • cap = cfg.effective_max (option « Max entreprises ») → PLAFOND TOTAL, toutes
        sources confondues. C'est lui qui borne réellement le nombre final.
      • per_source = cap // nb_sources → part max attribuée à CHAQUE source.
      • cfg.pages_per_run (option « Pages par run ») → PROFONDEUR de lecture par source :
        combien de pages de résultats on lit par run. Attention : pour SIRENE c'est par
        CODE NAF → 1 page × N codes = N×25 résultats. « 1 page » ne veut donc pas dire
        « peu de résultats » : pour en avoir moins, on baisse `max`, pas `pages_per_run`.

    Curseur de pagination (option « Explorer les pages suivantes ») : chaque source a un
    offset persistant en cache ; à chaque run on avance de `pages_advanced` pages → le run
    suivant reprend là où le précédent s'est arrêté, sans rien relire ni sauter.

    Lit sector, city, sources, max_results, industry, delay, posted_within_days,
    pages_per_run, blacklist_domains et pappers_key depuis ``cfg``. Retourne les
    entreprises collectées (non encore filtrées MX/catch-all).
    """
    industry_query = cfg.industry.strip() or cfg.sector
    all_companies: list[Company] = []
    seen_keys: set[str] = set()
    # Repli sur DEFAULT_SOURCES si l'UI n'a transmis aucune source sélectionnée.
    active_sources = cfg.sources if cfg.sources else DEFAULT_SOURCES
    cap = cfg.effective_max   # 0 (illimité) → grand plafond
    per_source = max(cap // len(active_sources), 10)
    total_pages = 0           # cumul des pages de résultats scrapées (toutes sources)

    # kwargs spécifiques par scraper
    scraper_kwargs: dict[str, dict] = {}
    if cfg.pappers_key:
        scraper_kwargs["pappers"] = {"api_key": cfg.pappers_key}
    # Cible de taille d'entreprise (filtre SIRENE par tranche d'effectif).
    if getattr(cfg, "size_target", "all") and cfg.size_target != "all":
        scraper_kwargs["societe"] = {"size_target": cfg.size_target}

    print("\n📡  Phase 1 : collecte multi-sources…")
    # A8 : charge les scrapers plugins de l'utilisateur (~/.cache/carreer-ops/scrapers/)
    # → ils s'ajoutent à SCRAPERS et deviennent utilisables comme n'importe quelle source.
    try:
        from .sources import load_scraper_plugins
        load_scraper_plugins()
    except Exception as e:
        print(f"   ⚠  Chargement plugins ignoré : {e}")

    # B1-14 : session HTTP partagée entre tous les scrapers (keep-alive inter-sources).
    # Avant : chaque scraper créait sa propre Session → TCP fermé entre sources.
    # Après : 1 session = connexions keep-alive réutilisées → moins de handshakes TLS.
    _shared_session = requests.Session()
    _shared_session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "Accept": "text/html,application/json,*/*;q=0.8",
    })

    # ── Source spéciale "email_alerts" (webhook) ───────────────────────────────
    # Pas un scraper classique : lit la boîte mail IMAP et parse les alertes emploi.
    if "email_alerts" in active_sources and cfg.imap_host and cfg.imap_user and cfg.imap_pass:
        print(f"\n  ▸ EMAIL ALERTS  [boîte : {cfg.imap_user} · dossier : {cfg.imap_folder}]")
        try:
            from .email_alerts import fetch_alert_emails
            alert_companies = fetch_alert_emails(
                host=cfg.imap_host, user=cfg.imap_user, password=cfg.imap_pass,
                port=cfg.imap_port, folder=cfg.imap_folder,
                since_days=cfg.alerts_since_days,
            )
            added = 0
            for c in alert_companies:
                k = c.key()
                if k not in seen_keys:
                    seen_keys.add(k)
                    all_companies.append(c)
                    added += 1
            print(f"   ✔  {added} nouvelles via alertes email (total : {len(all_companies)})")
        except Exception as e:
            print(f"   ❌  Erreur email_alerts : {e}")

    for source_name in active_sources:
        if source_name == "email_alerts":
            continue  # déjà traité ci-dessus (pas un scraper SCRAPERS)
        cls = SCRAPERS.get(source_name)
        if not cls:
            print(f"⚠  Source inconnue ignorée : {source_name}")
            continue
        query = industry_query if source_name in DIRECTORY_SOURCES else cfg.sector

        # ── Pagination progressive inter-runs (toujours active) ──────────────────
        # Le curseur avance automatiquement à chaque run : chaque lancement
        # reprend là où le précédent s'est arrêté → nouvelles entreprises à chaque fois.
        # Pour repartir de la page 1, utiliser le bouton « Réinitialiser la pagination ».
        #
        # La clé est indexée sur `query` (= industry pour les annuaires, sinon sector)
        # ET la ville : changer de secteur d'activité OU de zone repart donc bien de
        # la page 1, indépendamment des autres recherches.
        page_offset = 0
        cursor_key = ""
        if cache:
            cursor_key = f"pagecursor:{source_name}:{query.lower()}:{cfg.city.lower()}"
            page_offset = int(cache.get(cursor_key) or "0")

        print(f"\n  ▸ {source_name.upper()}"
              + (f"  [recherche : '{query}']" if query != cfg.sector else "")
              + (f"  [pages dès {page_offset + 1}]" if page_offset else ""))
        try:
            extra = scraper_kwargs.get(source_name, {})
            # Point 3 : ne passe proxy_pool QUE s'il est réellement configuré.
            # Évite de casser un scraper (plugin custom, etc.) dont l'__init__
            # n'accepte pas ce paramètre quand aucun proxy n'est utilisé.
            if proxy_pool:
                extra = {**extra, "proxy_pool": proxy_pool}
            # B1-14 : session partagée passée à tous les scrapers.
            scraper = cls(fetcher=fetcher, delay=cfg.delay, rate_limiter=rate_limiter,
                          page_offset=page_offset, session=_shared_session, **extra)
            # ── ROUAGE de l'option « Pages par run » ────────────────────────────
            # C'est CETTE ligne qui fait que le réglage de l'UI agit vraiment : on écrase
            # le PAGES_PER_RUN par défaut de la CLASSE du scraper par la valeur choisie.
            # Sans elle, chaque scraper garderait sa constante de classe et l'option serait
            # ignorée (c'était le bug France Travail : un range(...,+10) en dur l'ignorait).
            # Chaque scraper.search() lit donc `self.PAGES_PER_RUN` pages, puis s'arrête.
            if cfg.pages_per_run and cfg.pages_per_run > 0:
                scraper.PAGES_PER_RUN = cfg.pages_per_run
            # Lance la recherche : lit jusqu'à PAGES_PER_RUN pages OU per_source résultats.
            results = scraper.search(query, cfg.city, per_source)
        except Exception as e:
            print(f"   ❌  Erreur {source_name} : {e}")
            continue

        # Avance le curseur (toujours) ; si rien trouvé → repart à 0 (source épuisée).
        # On avance du nb de pages RÉELLEMENT consommées (scraper.pages_advanced) :
        # si le plafond per_code a coupé la lecture avant pages_per_run, les pages
        # non lues seront récupérées au run suivant au lieu d'être sautées.
        if cursor_key and cache:
            step = (getattr(scraper, "pages_advanced", 0)
                    or cfg.pages_per_run
                    or getattr(scraper, "PAGES_PER_RUN", 2))
            next_offset = (page_offset + step) if results else 0
            cache.set(cursor_key, str(next_offset), ttl=60 * 60 * 24 * 30)
        added = 0
        for c in results:
            k = c.key()
            if k not in seen_keys:
                seen_keys.add(k)
                all_companies.append(c)
                added += 1
        # Nombre de pages de résultats réellement récupérées par ce scraper.
        pages = getattr(scraper, "pages_scanned", 0)
        total_pages += pages
        pages_lbl = f", {pages} page(s) scrapée(s)" if pages else ""
        print(f"   ✔  {added} nouvelles (total : {len(all_companies)}{pages_lbl})")
        if len(all_companies) >= cap * 2:
            break

    all_companies = all_companies[:cap * 2]
    if total_pages:
        print(f"📄  {total_pages} page(s) de résultats scrapée(s) au total (toutes sources).")
    print(f"\n📋  {len(all_companies)} entreprises collectées avant filtrage.")

    # Normalisation taille + secteur + location — pour les sources qui n'ont pas pu remplir
    # ces champs directement. Fonction partagée (idempotente) avec le chargement CSV.
    from .classification import backfill_derived_fields
    for c in all_companies:
        backfill_derived_fields(c)

    # Filtre date de publication
    if cfg.posted_within_days > 0:
        cutoff = date.today() - timedelta(days=cfg.posted_within_days)
        before = len(all_companies)
        all_companies = [
            c for c in all_companies
            if not c.posted_date or date.fromisoformat(c.posted_date) >= cutoff
        ]
        removed = before - len(all_companies)
        if removed:
            print(f"📅  {removed} entreprises exclues (offre > {cfg.posted_within_days} jours)")

    # Filtre blacklist
    if cfg.blacklist_domains:
        before = len(all_companies)
        all_companies = [
            c for c in all_companies
            if not (_domain(c.website).lower() in cfg.blacklist_domains if c.website else False)
        ]
        print(f"🚫  Blacklist : {before - len(all_companies)} domaines exclus.")

    return all_companies


def _run_filter(
    companies: list[Company],
    cache: "PersistentCache | None",
    parallel_workers: int,
    known_domains: set[str],
    max_results: int,
) -> list[Company]:
    """
    Phases 2-3 : filtre MX (parallèle) → dédup inter-campagnes → tronc → catch-all.
    Retourne les entreprises retenues après filtrage.
    """
    companies, _ = filter_mx(companies, cache=cache, workers=parallel_workers)
    companies, _ = filter_known_domains(companies, known_domains)
    companies = companies[:max_results]
    print(f"\n📋  {len(companies)} entreprises après filtrage.")
    enrich_catch_all(companies, workers=parallel_workers, cache=cache)
    return companies


@dataclass
class RunConfig:
    """
    Regroupe les 34 paramètres de run() dans un dataclass typé.

    Avantages par rapport à une signature à 39 params plats :
      - Passage par valeur unique → compatible avec les tests, les wrappers d'API et les
        futures interfaces (GUI, HTTP, tâche planifiée) sans changer la signature de run().
      - Valeurs par défaut centralisées — plus besoin de les dupliquer dans main() et les tests.
      - Découverte : un IDE affiche les champs avec leur type au lieu d'une liste de kwargs.

    Construction depuis la CLI : ``RunConfig(**_prepare_run_kwargs(args))``.
    Construction dans les tests : ``RunConfig(sector="…", city="…", …)``.
    """

    # ── Collecte ────────────────────────────────────────────────────────────────
    sector:               str
    city:                 str
    max_results:          int
    sources:              list[str]
    industry:             str             = ""
    posted_within_days:   int             = 0
    # Cible de taille d'entreprise pour SIRENE : all | pme | eti | grand.
    size_target:          str             = "all"

    # ── Timing / infra ──────────────────────────────────────────────────────────
    delay:                float           = 2.0
    parallel_workers:     int             = 10

    # ── Clés API ────────────────────────────────────────────────────────────────
    # (Snov.io / Apollo.io retirés — jamais utilisés ; enrichissement = crawl + Hunter.)
    hunter_key:                 str             = ""
    # Plafond DUR de recherches Hunter.io par run (protège le quota free = 50/mois).
    # Le min(plafond, quota réel via /account) est appliqué. 0 = ne pas appeler Hunter.
    hunter_max_searches:        int             = 20
    pappers_key:                str             = ""
    github_token:               str             = ""

    # ── Sources d'enrichissement email ──────────────────────────────────────────
    email_sources:        list[str]       = field(default_factory=lambda: ["web_crawl", "hunter", "pattern"])
    use_github:           bool            = False
    use_smtp_batch:       bool            = False
    skip_no_email:        bool            = False
    fast_crawl:           bool            = True
    # Re-crawle les domaines déjà vus SANS email, sur des pages non encore visitées
    # (registre d'URLs) → plus de chances de trouver une adresse aux runs suivants.
    explore_new_pages:    bool            = False
    # Pagination progressive des SOURCES (curseur inter-runs) → nouvelles entreprises.
    explore_sources:      bool            = False
    find_recruiter:       bool            = True

    # ── Validation email ────────────────────────────────────────────────────────
    validator_provider:   str             = ""
    validator_key:        str             = ""

    # ── Phase 4b WHOIS ──────────────────────────────────────────────────────────
    # P2-8 : désactivé par défaut. Rendement faible (junk fréquent : hostmaster@,
    # gestion.domaine@, abuse@) et coût latence non négligeable. Activable depuis
    # l'UI / CLI quand on veut maximiser la couverture (gratuit).
    use_whois:            bool            = False

    # ── Validation SMTP « légère » ──────────────────────────────────────────────
    # P2-9 : tente un RCPT TO sur l'email pattern généré (rh@). Succès → marqué
    # `pattern_verified` au lieu d'être jeté par skip_no_email. Gratuit mais
    # nécessite que le FAI laisse sortir le port 25 (sondé automatiquement).
    smtp_light_verify:    bool            = False

    # ── Scoring ─────────────────────────────────────────────────────────────────
    skip_scoring:         bool            = False
    scoring_weights:      "dict | None"  = None
    feedback:             "dict | None"  = None

    # ── Dédup fuzzy ─────────────────────────────────────────────────────────────
    fuzzy:                bool            = True
    fuzzy_threshold:      float           = 0.85

    # ── Filtres ─────────────────────────────────────────────────────────────────
    blacklist_domains:    "set | None"   = None
    whitelist_domains:    "set | None"   = None

    # ── Infra ───────────────────────────────────────────────────────────────────
    proxies:              list[str]       = field(default_factory=list)
    use_cache:            bool            = True
    use_clearbit:         bool            = True

    # ── Export ──────────────────────────────────────────────────────────────────
    output_dir:           Path            = field(default_factory=lambda: Path("."))
    exclude_file:         str             = ""

    # ── Modes spéciaux ──────────────────────────────────────────────────────────
    enrich_only:          bool            = False
    enrich_csv:           str             = ""
    # LinkedIn Sales Navigator import : CSV à charger en tant que sources directes.
    linkedin_csv:         str             = ""

    # A10 : Mode incrémental — charge le master CSV existant, isole les leads
    # sans email réel (source "pattern", "no_email" ou "") et ne lance que les
    # phases email (Phase 4-7). Évite de re-scraper des sources entières pour
    # juste compléter les leads incomplets d'une session précédente.
    incremental:          bool            = False

    # ── LLM (extraction structurée sur pages web) ───────────────────────────────
    # Améliore crawl_contact_page, find_recruiter_name, detect_tech_stack.
    # Provider : "ollama" (local, gratuit), "openai" (cloud, payant), "" (désactivé).
    llm_provider:         str             = ""
    ollama_url:           str             = "http://localhost:11434"
    ollama_model:         str             = "qwen2.5-coder:7b"
    llm_budget:           int             = 100
    # ── Descriptions d'activité (résumé du texte des sites par IA) ──────────────
    # INDÉPENDANT du LLM de crawl ci-dessus. Ollama est utilisé UNIQUEMENT ici
    # (tâche légère : 1 résumé par entreprise, sur le texte déjà extrait par le
    # crawl), jamais pour l'extraction email/recruteur/stack — qui resteraient trop
    # lentes sur CPU. describe_provider reste "ollama" même si llm_provider="".
    describe:             bool            = True
    describe_provider:    str             = "ollama"
    describe_model:       str             = "qwen2.5:7b"
    resume:               bool            = False
    # Limite de temps globale (minutes) — le pipeline s'arrête proprement et exporte
    # ce qu'il a collecté. 0 = pas de limite. Défaut : 0 (illimité).
    max_runtime_min:      float           = 0.0
    # Nombre de pages lues par run et par source (SIRENE, APEC, WTTJ, Indeed).
    # Plus élevé = plus d'entreprises collectées, mais run plus long. Défaut : 2.
    pages_per_run:        int             = 2
    # Plafond de temps de crawl PAR ENTREPRISE (secondes) — borne fast_crawl +
    # crawl_contact_page. Plus haut = meilleure couverture mais plus lent. Défaut 25 s.
    crawl_budget_sec:     float           = 25.0

    # ── Source "email alerts" (webhook) — credentials IMAP fournis par Carreer-ops ──
    # Active quand "email_alerts" est dans `sources` ET que imap_host/user/pass sont remplis.
    imap_host:            str             = ""
    imap_port:            int             = 993
    imap_user:            str             = ""
    imap_pass:            str             = ""
    imap_folder:          str             = "INBOX"
    alerts_since_days:    int             = 7

    # Plafond de sécurité du mode « illimité » (max_results = 0). Empêche la
    # collecte de partir en vrille (cf. 1132 entreprises sur 5 secteurs × 5 pages,
    # ingérable en aval). « Illimité » = « beaucoup, mais borné à ce seuil ».
    # Pour dépasser, saisir un Max fini élevé dans l'UI.
    UNLIMITED_SAFETY_CAP = 500

    @property
    def effective_max(self) -> int:
        """max_results normalisé : 0 (illimité dans l'UI) → plafond de sécurité.
        Évite à la fois les bugs de slicing `[:0]` et l'explosion de la collecte."""
        return self.max_results if self.max_results and self.max_results > 0 else self.UNLIMITED_SAFETY_CAP


@dataclass
class EmailEnrichConfig:
    """
    Fix-3 : regroupe les 12 flags booléens/str de _run_email_enrich() dans un
    dataclass. Réduit la signature de 17 à 6 paramètres, facilite les tests
    (on peut instancier une config partielle avec les valeurs par défaut).
    """
    use_web_crawl:  bool = True
    use_hunter:     bool = False
    use_linkedin:   bool = False
    use_pattern:    bool = True
    use_github:     bool = False
    use_smtp_batch: bool = False
    github_token:   str  = ""
    find_recruiter: bool = True
    fast_crawl:     bool = True
    skip_no_email:  bool = False
    explore_new_pages: bool = False   # re-crawle les domaines sans email sur pages neuves
    # P0-2 : court-circuit Phase 5 pattern quand skip_no_email + pas de validator.
    # Sans validator, les emails « pattern » seront jetés en sortie de _run_email_enrich
    # → on évite de générer rh@… qui ne servira à rien (gain temps + log plus propre).
    has_validator:  bool = False
    # P2-8 : WHOIS désactivé par défaut (rendement très faible, junk fréquent,
    # latence non négligeable sur 60 entreprises). Activable à la demande.
    use_whois:      bool = False
    # P2-9 : validation SMTP légère gratuite — quand le port 25 est ouvert,
    # tente un RCPT TO sur l'email « pattern » généré ; succès → pattern_verified.
    smtp_light_verify: bool = False
    # Plafond de recherches Hunter.io pour ce run (miroir de RunConfig.hunter_max_searches ;
    # sans ce champ, _run_email_enrich plantait dès que Hunter était activé).
    hunter_max_searches: int = 20


def _run_email_enrich(
    companies: list[Company],
    fetcher,
    cfg: EmailEnrichConfig,             # Fix-3 : remplace les 12 params booléens/str
    hunter: "HunterClient | None",
    delay: float,
    cache: "PersistentCache | None",
    page_cache: "LRUPageCache | None" = None,
    rate_limiter: "RateLimiter | None" = None,
    llm_client = None,                  # LLMClient optionnel (Ollama/OpenAI) — fallback extraction
    deadline = None,                    # Deadline optionnel — arrêt propre si temps écoulé
    target_job: str = "",               # poste ciblé — sert à prioriser le contact (CEO/RH/manager du domaine)
    ledger = None,                      # CrawlLedger optionnel — anti-doublon inter-runs (Phase 4)
    proxy_pool: "ProxyPool | None" = None,   # Point 3 : pool proxies → enrich_web_crawl → httpx
) -> None:
    """
    Phases 4-5e : enrichissement email (web crawl, WHOIS, Hunter, LinkedIn,
    GitHub, SMTP batch) + pattern fallback + skip_no_email.
    Modifie les Company en place.
    """
    # P0-2 : court-circuit pattern. Quand l'utilisateur a coché skip_no_email
    # ET n'a pas branché de validator, tout email « pattern » sera jeté en sortie
    # → on n'en génère AUCUN (économise les boucles + log moins bruyant). Hunter
    # garde le droit de générer son pattern interne car il s'appuie sur des emails
    # vérifiés du même domaine.
    _pattern_useful = cfg.use_pattern and not (cfg.skip_no_email and not cfg.has_validator)

    # Phase 4 : crawler web
    if cfg.use_web_crawl:
        enrich_web_crawl(companies, fetcher, delay,
                         fast_crawl=cfg.fast_crawl,
                         find_recruiter=cfg.find_recruiter,
                         cache=cache,
                         deadline=deadline,
                         target_job=target_job,
                         page_cache=page_cache,
                         rate_limiter=rate_limiter,
                         llm_client=llm_client,
                         ledger=ledger,
                         explore_new_pages=cfg.explore_new_pages,
                         proxy_pool=proxy_pool if proxy_pool else None)
        # P2-8 : WHOIS désactivé par défaut. Quand activé, rendement bas mais
        # gratuit. Le flag vit dans EmailEnrichConfig pour rester en sync UI/CLI.
        if cfg.use_whois:
            enrich_whois(companies, delay, cache=cache, deadline=deadline)
    else:
        print("\n⏭   Phase 4 : crawler web désactivé (retiré de --email-sources)")

    # Phase 5 : Hunter.io
    if hunter and cfg.use_hunter:
        enrich_hunter(companies, hunter, delay,
                      use_pattern=_pattern_useful and not cfg.use_linkedin,
                      deadline=deadline,
                      max_searches=cfg.hunter_max_searches)
    elif not cfg.use_linkedin and _pattern_useful:
        print("\n⚪  Phase 5 : pattern fallback (Hunter.io désactivé ou sans clé)…")
        count_p = 0
        for c in companies:
            if not c.contact_email:
                domain = _domain(c.website)
                if domain:
                    c.contact_email = guess_email(domain)
                    c.email_source = "pattern"
                    c.email_alternatives = generate_alternatives(domain, exclude=c.contact_email)
                    count_p += 1
        print(f"   → {count_p} emails pattern générés")
    elif cfg.use_pattern and not _pattern_useful:
        # P0-2 : on annonce le court-circuit — l'utilisateur sait pourquoi rien
        # n'est généré (skip_no_email → emails pattern jetés de toute façon).
        no_email = sum(1 for c in companies if not c.contact_email)
        print(f"\n⏭   Phase 5 : pattern court-circuité (skip-no-email actif, "
              f"pas de validator) — {no_email} entreprises restent sans email")
    else:
        no_email = sum(1 for c in companies if not c.contact_email)
        if no_email:
            print(f"\n⏭   Phase 5 : Hunter désactivé — {no_email} entreprises passent en Phase 5c")

    # Phase 5c : LinkedIn snippets + SMTP
    if cfg.use_linkedin:
        enrich_linkedin_smtp(companies, fetcher, hunter, delay, deadline=deadline)
    else:
        remaining = sum(1 for c in companies if not c.contact_email)
        if remaining:
            print(f"\n⏭   Phase 5c : LinkedIn désactivé — {remaining} sans email.")

    # Phase 5d : GitHub org email
    if cfg.use_github:
        need_gh = [c for c in companies if not c.contact_email and c.website]
        if need_gh:
            print(f"\n🐙  Phase 5d : GitHub org email ({len(need_gh)} entreprises)…")
            found_gh = 0
            for c in need_gh:
                domain = _domain(c.website)
                email  = github_find_email(c.name, domain, cfg.github_token)
                if email:
                    c.contact_email = email
                    c.email_source  = "github_org"   # Fix-3b : source correcte (était "web_crawl")
                    found_gh += 1
                    print(f"   🐙  {c.name} → {email}")
                time.sleep(delay * 0.1)
            print(f"   → {found_gh}/{len(need_gh)} emails trouvés via GitHub")

    # Phase 5e : SMTP multi-pattern
    if cfg.use_smtp_batch:
        need_smtp = [c for c in companies if not c.contact_email and c.website]
        if need_smtp:
            print(f"\n⚡  Phase 5e : SMTP multi-pattern ({len(need_smtp)} domaines)…")
            found_smtp = 0
            for c in need_smtp:
                domain = _domain(c.website)
                if not domain:
                    continue
                email = smtp_batch_patterns(domain, timeout=5, workers=6)
                if email:
                    c.contact_email = email
                    c.email_source  = "pattern_verified"
                    c.email_alternatives = generate_alternatives(domain, exclude=email)
                    found_smtp += 1
                    print(f"   ⚡  {c.name} → {email}")
                time.sleep(delay * 0.1)
            print(f"   → {found_smtp}/{len(need_smtp)} emails confirmés via SMTP batch")

    # Pattern fallback final
    # P0-2 : on respecte _pattern_useful (court-circuité si skip_no_email + pas
    # de validator) → on n'écrit aucun email pattern qui sera jeté juste après.
    if _pattern_useful:
        from .enrich import smtp_port_open, smtp_verify_email
        # P2-9 : validation SMTP légère gratuite. Si l'utilisateur a coché l'option
        # ET que le port 25 sortant n'est pas bloqué, on tente un RCPT TO sur
        # l'email pattern généré (rh@). Si le serveur répond 250 → on garde
        # l'email avec source `pattern_verified` (rang meilleur, survivra à
        # skip_no_email). Sinon on garde le `pattern` standard (ancien comportement).
        _smtp_check = cfg.smtp_light_verify and smtp_port_open()
        count_p = 0
        count_v = 0
        for c in companies:
            if not c.contact_email:
                domain = _domain(c.website)
                if domain:
                    c.contact_email = guess_email(domain)
                    c.email_alternatives = generate_alternatives(domain, exclude=c.contact_email)
                    if _smtp_check and smtp_verify_email(c.contact_email, timeout=5):
                        c.email_source = "pattern_verified"
                        count_v += 1
                    else:
                        c.email_source = "pattern"
                    count_p += 1
        if count_p:
            extra = f" (dont {count_v} vérifiés SMTP)" if count_v else ""
            print(f"\n⚪  Pattern fallback final : {count_p} emails rh@… générés{extra}")

    # skip_no_email : exclure les entreprises sans email réel
    if cfg.skip_no_email:
        before = len(companies)
        kept = [c for c in companies if c.contact_email and c.email_source not in ("pattern", "")]
        removed = before - len(kept)
        companies[:] = kept
        if removed:
            print(f"\n🚫  {removed} entreprises exclues (aucun email réel — skip-no-email)")


def _run_metadata_enrich(
    companies: list[Company],
    fetcher,
    cfg: "RunConfig",
    validator: "EmailValidator | None",
    cache: "PersistentCache | None",
    page_cache: "LRUPageCache | None" = None,
    deadline=None,
    skip_clearbit: bool = False,
) -> None:
    """
    Phases 6-7 : enrichissement Clearbit + validation email.
    Lit use_clearbit et delay depuis ``cfg``.
    Modifie les Company en place.

    B0-7 : deadline optionnel — chaque phase vérifie la limite avant de démarrer.
    A9  : skip_clearbit=True si Clearbit a déjà été exécuté en background (pendant Phase 5).
    """
    if cfg.use_clearbit and not skip_clearbit:
        enrich_clearbit(companies, cache, cfg.delay)
    elif skip_clearbit:
        print("   ⚙️   Clearbit : déjà enrichi en background (A9 overlap).")

    if validator:
        if deadline is not None and deadline.expired():
            print("\n⏱   Phase 7 : limite temps atteinte — validation email sautée.")
        else:
            enrich_validation(companies, validator, cfg.delay)
    else:
        print("\n⏭   Phase 7 : validation email ignorée (ajoutez --validator-key pour l'activer)")


def company_to_row_dict(c: Company) -> dict:
    """Mappe une Company vers une ligne CSV (clés = CSV_FIELDNAMES).
    Source unique réutilisée par l'export du pipeline et le mode --enrich-descriptions."""
    return {
        "name":              c.name,
        "contactEmail":      c.contact_email,
        "website":           c.website,
        "contactName":       c.contact_name,
        "contactRole":       c.contact_role,
        "emailSource":       c.email_source,
        "emailPattern":      c.email_pattern,
        "emailAlternatives": "|".join(c.email_alternatives),
        "emailValidated":    c.email_validated,
        "region":            c.region,
        "country":           c.country,
        "regionAdmin":       c.region_admin,
        "dept":              c.dept,
        "deptName":          c.dept_name,
        "city":              c.city,
        "activityDomain":    c.activity_domain,
        "sector":            c.sector,
        "companyDescription": c.description,
        "descriptionUpdatedAt": c.description_updated_at,
        "newsUpdatedAt":     c.news_updated_at,
        "companySize":       c.company_size,
        "companySizeBucket": c.company_size_bucket,
        "freshnessScore":    c.freshness_score,
        "relevanceScore":    c.relevance_score,
        "bonusScore":        c.bonus_score,
        "totalScore":        c.total_score,
        "atsName":           c.ats_name,
        "atsUrl":            c.ats_url,
        "source":            c.source,
        "jobCount":          c.job_count,
        "growthSignals":     c.growth_signals,
        "postedDate":        c.posted_date,
        # Qualité : domaine louche (homonyme) → "1", recalculé à chaque export.
        "domainSuspect":     "1" if is_domain_suspect(c.name, c.website, c.contact_email) else "0",
        # BOUNCE-CSV : round-trip simple (posé par Carreer-ops, jamais par le scraper).
        "bounced":           c.bounced,
    }


def _build_describe_client(cfg: "RunConfig"):
    """Construit le client LLM DÉDIÉ aux descriptions (Ollama par défaut), indépendant
    du LLM de crawl. Retourne None si le provider est vide → repli texte brut.

    ⚠️ Les fiches sont des appels LOURDS (note de 200-300 mots → 60-180 s sur CPU avec
    un 7B), contrairement au crawl (appels courts). On allonge donc fortement le timeout
    et on assouplit le coupe-circuit, sinon 2 fiches lentes d'affilée désactivent l'IA
    pour tout le reste du run (→ bascule en texte brut « au bout d'un moment »)."""
    if not getattr(cfg, "describe_provider", ""):
        return None
    from .llm_extract import LLMConfig, LLMClient
    # Si provider cloud, describe_model peut porter le modèle cloud (ex. gpt-4o-mini) ;
    # sinon on garde le défaut LLMConfig. ollama_model reste describe_model pour Ollama.
    _dm = (cfg.describe_model or "").strip()
    _openai_model = _dm if _dm.startswith("gpt") else "gpt-4o-mini"
    llm_config = LLMConfig(
        provider=cfg.describe_provider,
        ollama_url=cfg.ollama_url,
        ollama_model=cfg.describe_model,
        openai_key=os.environ.get("OPENAI_API_KEY", ""),
        openai_model=_openai_model,
        claude_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        budget=5000,
        timeout=240,         # large : génération longue sur CPU
        warmup_timeout=240,  # 7B cold-start sur CPU peut dépasser 90 s
    )
    client = LLMClient(llm_config, cache=None)
    # Coupe-circuit beaucoup plus tolérant que pour le crawl : une fiche lente isolée
    # ne doit pas couper l'IA pour les 100 entreprises suivantes (attribut d'instance).
    client._MAX_CONSECUTIVE_FAILS = 8
    return client


def run_enrich_descriptions(
    csv_path: str,
    describe_provider: str = "ollama",
    ollama_url: str = "http://localhost:11434",
    describe_model: str = "qwen2.5:7b",
    max_companies: "int | None" = None,
    force: bool = False,
    max_age_days: "int | None" = None,
    news_only: bool = False,
    keys_file: str = "",
) -> int:
    """Mode autonome : charge le master CSV, remplit Company.description (texte du
    site + résumé IA via Ollama), puis réécrit le CSV en place. Retourne le nombre enrichi.
    force=True régénère les fiches existantes (sinon ne complète que les manquantes).
    news_only=True : régénère UNIQUEMENT la note actualités (garde la fiche générale)."""
    from .enrich import enrich_descriptions, enrich_news
    path = Path(csv_path)
    if not path.exists():
        print(f"❌  Master CSV introuvable → {path}")
        return 0
    companies = load_companies_from_csv(str(path))
    print(f"📚  {len(companies)} entreprises chargées depuis {path.name}")

    # GARDE ANTI-VIDAGE : si le fichier existe et n'est pas vide mais qu'on n'a RIEN
    # chargé, c'est une lecture ratée (fichier verrouillé/corrompu). On S'ARRÊTE avant
    # d'écrire : sinon _write_master remplacerait le master par un fichier à l'en-tête
    # seul → tout le cumul perdu (le bug qu'on cherche justement à ne plus reproduire).
    if not companies and path.stat().st_size > 100:
        print("⛔  Master illisible ou verrouillé (0 entreprise chargée d'un fichier non vide)"
              " — enrichissement annulé, master PRÉSERVÉ intact.")
        return 0

    # Filtre optionnel : ne traiter que les leads affichés/filtrés (clés fournies par l'UI).
    only_keys = None
    if keys_file:
        try:
            with open(keys_file, encoding="utf-8") as f:
                only_keys = {ln.strip() for ln in f if ln.strip()}
            print(f"🎯  Filtre : {len(only_keys)} lead(s) affiché(s) ciblé(s).")
        except Exception as e:
            print(f"⚠  Filtre clés illisible ({e}) — traitement de tous les leads.")

    # Client LLM dédié aux descriptions (Ollama). Réutilise _build_describe_client
    # via un RunConfig minimal pour rester DRY.
    llm_client = _build_describe_client(RunConfig(
        sector="", city="", max_results=0, sources=[],
        describe_provider=describe_provider,
        ollama_url=ollama_url, describe_model=describe_model,
    ))

    # Écriture ATOMIQUE du master (réutilisée pour la sauvegarde incrémentale tous les 3
    # leads). temp + os.replace (atomique sur le même volume) : fermer l'app / crasher en
    # pleine écriture laisse soit l'ANCIEN fichier intact, soit le NOUVEAU complet — jamais
    # un master tronqué. Indispensable ici car save_every=3 écrit très souvent.
    def _write_master() -> None:
        tmp = path.with_name(path.name + f".tmp{os.getpid()}")
        with tmp.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_FIELDNAMES)
            writer.writeheader()
            for c in companies:
                writer.writerow(company_to_row_dict(c))
        os.replace(tmp, path)

    # save_fn persiste le CSV tous les 3 leads → si l'utilisateur quitte la page (ou
    # ferme l'app) en cours de route, les fiches déjà rédigées ne sont PAS perdues.
    if news_only:
        done = enrich_news(companies, llm_client=llm_client,
                           max_companies=max_companies, force=force,
                           save_fn=_write_master, save_every=3,
                           max_age_days=max_age_days, only_keys=only_keys)
    else:
        done = enrich_descriptions(companies, llm_client=llm_client,
                                   max_companies=max_companies, force=force,
                                   save_fn=_write_master, save_every=3,
                                   max_age_days=max_age_days, only_keys=only_keys)

    _write_master()
    print(f"💾  Master réécrit → {path}")
    # Ligne machine pour Electron (parsée puis masquée dans l'UI).
    print(f"ENRICH_DESC_OK {done}")
    return done


def _run_score_export(
    companies: list[Company],
    cfg: "RunConfig",
) -> Path:
    """
    Phases 8-10 : feedback → scoring → dédup fuzzy → export CSV + HTML.
    Lit scoring_weights, whitelist_domains, skip_scoring, feedback, fuzzy,
    fuzzy_threshold et output_dir depuis ``cfg``.
    Retourne le chemin du fichier CSV exporté.
    """
    # Feedback historique (avant scoring — voir FIX-8)
    if cfg.feedback:
        print("\n🔁  Application du feedback historique Carreer-ops…")
        apply_feedback_scores(companies, cfg.feedback)

    # Phase 8 : score & tri
    if cfg.skip_scoring:
        print("\n⏩  Phase 8 : scoring désactivé — ordre de collecte conservé.")
    else:
        label = " (poids personnalisés)" if cfg.scoring_weights else ""
        print(f"\n📊  Phase 8 : calcul des scores et tri{label}…")
        companies[:] = score_and_sort(companies, weights=cfg.scoring_weights,
                                      whitelist_domains=cfg.whitelist_domains)

    # Phase 9b : dédup fuzzy
    if cfg.fuzzy:
        deduped, _ = fuzzy_dedup(companies, threshold=cfg.fuzzy_threshold)
        companies[:] = deduped

    # Phase 10 : export CSV — B2-5 : fieldnames importés de io_csv (source unique)
    fieldnames = CSV_FIELDNAMES

    def _write_csv(path: Path, rows: list) -> None:
        """Écrit une liste de Company dans un fichier CSV."""
        with path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for c in rows:
                writer.writerow(company_to_row_dict(c))

    # Crée le dossier de sortie si besoin (ex : scripts/data/) — code et données séparés.
    cfg.output_dir.mkdir(parents=True, exist_ok=True)

    # ── Archive datée (résultats de ce run uniquement) ────────────────────
    archive_file = cfg.output_dir / f"candio_leads_{date.today().isoformat()}.csv"
    _write_csv(archive_file, companies)

    # ── Master cumulatif (toutes sessions confondues, dédup par domaine) ──
    master_file = cfg.output_dir / "candio_leads.csv"

    # Comptage ROBUSTE des enregistrements du master AVANT écriture (csv.reader
    # respecte les champs multi-lignes entre guillemets, contrairement à un split '\n').
    def _count_records(path: "Path") -> int:
        if not path.exists():
            return 0
        try:
            with path.open(encoding="utf-8", newline="") as f:
                return max(0, sum(1 for _ in csv.reader(f)) - 1)
        except Exception:
            return 0

    existing_count = _count_records(master_file)

    # GARDE-FOU 1 : backup horodaté du master AVANT tout écrasement (une perte de
    # cumul a déjà eu lieu — le master avait été réduit à 41 puis reconstruit à 85).
    backup_file = None
    if existing_count > 0:
        backup_file = master_file.with_name(
            f"{master_file.stem}.bak.{datetime.now():%Y%m%d_%H%M%S}.csv")
        try:
            from shutil import copy2
            copy2(master_file, backup_file)
        except Exception as e:
            print(f"⚠  Backup du master impossible ({e}) — on continue prudemment.")

    merged, n_added, n_updated = merge_into_master(master_file, companies, fieldnames)

    # GARDE-FOU 2 : merge_into_master part de l'existant et ne fait QU'AJOUTER. Si le
    # résultat est PLUS PETIT que le master sur disque, c'est que la lecture a échoué
    # (fichier verrouillé par l'app ouverte, écriture partielle, encodage) → on REFUSE
    # d'écraser, sinon tout le cumul est perdu silencieusement. Le master reste intact.
    if existing_count > 0 and len(merged) < existing_count:
        print(f"⛔  Master NON réécrit : fusion={len(merged)} < existant={existing_count} "
              f"→ lecture du master probablement échouée. Cumul PRÉSERVÉ intact.")
        if backup_file:
            print(f"   (backup de sécurité : {backup_file.name})")
    else:
        _write_csv(master_file, merged)

    # Réconciliation explicite : ce run = ajoutées + mises à jour + déjà connues.
    # (sans ça, « 39 exportées » vs « +30 au master » paraissait incohérent)
    run_n = len(companies)
    n_dup = run_n - n_added - n_updated   # déjà présentes au master, inchangées
    print(f"\n✅  Archive de ce run  → {archive_file}")
    print(f"📚  Master cumulatif   → {master_file}")
    print(f"   Ce run : {run_n} entreprise(s) collectée(s) → "
          f"{n_added} ajoutée(s), {n_updated} mise(s) à jour, {n_dup} déjà connue(s)")
    print(f"   Master : {len(merged)} entreprise(s) au total (toutes sessions)")

    # Aperçu HTML du master
    export_html_preview(merged, master_file.with_suffix(".html"))

    return master_file


# ══════════════════════════════════════════════════════════════════════════════
# A6 : STATS JSONL — observabilité par run
# ══════════════════════════════════════════════════════════════════════════════

def _write_run_stats(
    companies: list["Company"],
    cfg: "RunConfig",
    run_id: str,
    start_monotonic: float,
) -> None:
    """
    A6 : Écrit une ligne JSONL dans ~/.cache/carreer-ops/stats.jsonl à la fin de chaque run.

    Format : une ligne JSON par run, append-only.
    Utilisable pour :
      - mesurer la régression de performance entre sessions
      - auditer le taux d'emails trouvés par source
      - construire un tableau de bord minimal (grep / jq / Excel)

    Champs : ts, run_id, sector, city, n_exported, duration_s,
             email_sources, collect_sources, email_found_pct.
    """
    try:
        import json
        from datetime import datetime
        from pathlib import Path

        n = len(companies)
        src_counts: dict[str, int] = {}
        for c in companies:
            src_counts[c.email_source] = src_counts.get(c.email_source, 0) + 1
        collect_counts: dict[str, int] = {}
        for c in companies:
            collect_counts[c.source] = collect_counts.get(c.source, 0) + 1

        real = sum(src_counts.get(s, 0) for s in _REAL_EMAIL_SOURCES)
        pct_real = int(real / n * 100) if n else 0

        stats = {
            "ts":             datetime.now().isoformat(timespec="seconds"),
            "run_id":         run_id,
            "sector":         cfg.sector,
            "city":           cfg.city,
            "sources":        cfg.sources,
            "n_exported":     n,
            "duration_s":     round(time.monotonic() - start_monotonic, 1),
            "email_sources":  src_counts,
            "collect_sources": collect_counts,
            "email_found_pct": pct_real,
        }
        stats_path = Path.home() / ".cache" / "carreer-ops" / "stats.jsonl"
        stats_path.parent.mkdir(parents=True, exist_ok=True)
        with stats_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(stats, ensure_ascii=False) + "\n")
        print(f"📊  Stats du run → {stats_path}")
    except Exception as e:
        log.debug("_write_run_stats a échoué : %r", e)


# ══════════════════════════════════════════════════════════════════════════════
# RÉCAPITULATIF FINAL
# ══════════════════════════════════════════════════════════════════════════════

# B2-4 : code extrait de run() (était ~80 lignes inline) → lisibilité + testabilité.
_SOURCE_LABELS: dict[str, str] = {
    "wttj":          "WTTJ (offres actives)",
    "indeed":        "Indeed (offres actives)",
    "apec":          "APEC (offres actives)",
    "cadremploi":    "Cadremploi (offres actives)",
    "hellowork":     "HelloWork (offres actives)",
    "remixjobs":     "Remixjobs (tech/remote)",
    "kompass":       "Kompass (annuaire B2B)",
    "pj":            "Pages Jaunes (annuaire)",
    "societe":       "Société.com SIRENE (annuaire)",
    "pappers":       "Pappers (SIRENE + dirigeants)",
    "linkedin_sales_nav": "LinkedIn Sales Nav (import)",
    "email_alert:wttj":   "Alertes email WTTJ",
    "email_alert:indeed": "Alertes email Indeed",
    "email_alert:apec":   "Alertes email APEC",
}

_REAL_EMAIL_SOURCES = frozenset({
    "hunter_verified", "hunter_found", "web_crawl", "whois",
    "snov_found", "apollo_found", "linkedin_smtp", "linkedin_pattern",
    "pattern_verified", "pattern_nominative", "manual", "github_org", "llm_crawl",
})

# Libellés lisibles par source d'email, ordonnés du plus fiable au moins fiable.
# La ventilation du récap itère sur CE dict → toute source présente est affichée
# (plus de lignes manquantes : la somme affichée = le total annoncé).
_EMAIL_SOURCE_LABELS: dict[str, str] = {
    # Vérifiés — envoyables directement
    "hunter_verified":    "✅ Vérifié — Hunter.io",
    "linkedin_smtp":      "✅ Vérifié — LinkedIn + SMTP",
    "manual":             "✅ Saisi manuellement",
    # Trouvés — fiables mais non vérifiés SMTP
    "web_crawl":          "🟢 Trouvé sur le site web",
    "llm_crawl":          "🟢 Trouvé sur le site web (IA)",
    "whois":              "🟢 Trouvé via WHOIS",
    "snov_found":         "🟢 Trouvé via Snov.io",
    "apollo_found":       "🟢 Trouvé via Apollo.io",
    "hunter_found":       "🟢 Trouvé via Hunter.io (non vérifié)",
    "github_org":         "🟢 Trouvé via GitHub",
    # Motifs construits — à vérifier avant envoi en masse
    "pattern_verified":   "⚡ Motif vérifié SMTP (rh@…)",
    "pattern_nominative": "⚡ Motif nominatif (prénom.nom@)",
    "linkedin_pattern":   "🔸 Motif LinkedIn (non vérifié)",
    "catch_all":          "🟠 Domaine catch-all (fiabilité faible)",
    "pattern":            "⚪ Généré (rh@…, risque de bounce)",
    # Sans email
    "no_email":           "⛔ Aucun email trouvé",
}


def _print_summary(companies: list["Company"], cfg: "RunConfig") -> None:
    """
    Affiche le récapitulatif final du run (sources, qualité emails, top techs).

    B2-4 : extrait de run() pour alléger l'orchestrateur. Peut être unitairement
    testable et ré-utilisable par une future interface GUI/HTTP.
    """
    n = len(companies)
    if not n:
        print("\n⚠  Aucune entreprise exportée.")
        return

    src_counts: dict[str, int] = {}
    for c in companies:
        src_counts[c.email_source] = src_counts.get(c.email_source, 0) + 1

    # Trois seaux qui se RECONCILIENT : réels + à-vérifier + sans-email = n.
    real       = sum(src_counts.get(s, 0) for s in _REAL_EMAIL_SOURCES)
    generated  = src_counts.get("pattern", 0)
    unverified = sum(src_counts.get(s, 0) for s in EmailSource.UNVERIFIED_SOURCES)
    none_      = src_counts.get("no_email", 0) + src_counts.get("", 0)
    pct_real   = round(real / n * 100)

    collect_counts: dict[str, int] = {}
    for c in companies:
        collect_counts[c.source] = collect_counts.get(c.source, 0) + 1

    sep = "─" * 58
    print(f"\n{sep}")
    print(f"  RÉCAPITULATIF DU SCRAPING — {n} entreprise(s) exportée(s)")
    print(sep)

    print("\n  Sources de collecte :")
    for src, cnt in sorted(collect_counts.items(), key=lambda x: -x[1]):
        print(f"    {_SOURCE_LABELS.get(src, src):<36} {cnt:>4}")

    # Ventilation DÉRIVÉE des données : on n'affiche que les sources présentes, et la
    # somme des lignes = n (plus jamais d'écart « 19 affichés / 39 annoncés »).
    print("\n  Qualité des emails (de la plus fiable à la moins fiable) :")
    for src, label in _EMAIL_SOURCE_LABELS.items():
        cnt = src_counts.get(src, 0)
        if cnt:
            print(f"    {label:<42} {cnt:>4}")
    # Filet : une source non répertoriée ne doit JAMAIS disparaître silencieusement.
    for src, cnt in src_counts.items():
        if cnt and src and src not in _EMAIL_SOURCE_LABELS:
            print(f"    ❔ {src:<40} {cnt:>4}")

    print(f"\n  → {real} exploitables ({pct_real}%)  ·  {unverified} à vérifier  ·  "
          f"{none_} sans email   (total {n})")
    if generated or unverified:
        print('  ℹ  Les emails « générés/motif » risquent le bounce — activez')
        print("     Hunter.io / LinkedIn pour fiabiliser les grandes boîtes.")
    print(sep)


# ══════════════════════════════════════════════════════════════════════════════
# ORCHESTRATEUR
# ══════════════════════════════════════════════════════════════════════════════

def run(cfg: RunConfig) -> None:
    """
    Orchestrateur principal du pipeline scraping (12 phases).

    Reçoit un ``RunConfig`` unique — voir la docstring de RunConfig pour la liste
    complète des champs. Ne contient aucune logique métier : délègue aux sous-fonctions
    _run_collect / _run_filter / _run_email_enrich / _run_metadata_enrich / _run_score_export.

    Cycle de vie :
      1–3.  Collecte + filtres MX / catch-all / dédup inter-campagnes
      4–5e. Enrichissement email (web crawl, Hunter, LinkedIn, GitHub, SMTP)
      6–7.  Clearbit + validation NeverBounce / ZeroBounce
      8–10. Scoring, dédup fuzzy, export CSV + HTML preview
    """
    # ── Dérivation des flags email depuis la liste de sources ─────────────
    email_sources = cfg.email_sources or ["web_crawl", "hunter", "pattern"]
    use_web_crawl = "web_crawl" in email_sources
    use_hunter    = "hunter"    in email_sources
    use_linkedin  = "linkedin"  in email_sources
    use_pattern   = "pattern"   in email_sources

    _run_start = time.monotonic()   # A6 : chrono global du run (pour stats JSONL)

    # ── Cache persistant ──────────────────────────────────────────────────
    cache = PersistentCache() if cfg.use_cache else None
    if cache:
        print(f"💾  Cache SQLite actif : {cache._path}")

    # ── Registre de crawl persistant (anti-doublon inter-runs) ─────────────
    # Mémorise les domaines/pages déjà crawlés ; un domaine vu < 14 j n'est pas
    # re-crawlé, on réutilise son résultat. Partage la même base que le cache.
    from .crawl_ledger import CrawlLedger
    crawl_ledger = CrawlLedger(enabled=cfg.use_cache)
    if crawl_ledger.enabled:
        print("🧭  Registre de crawl actif (ne recrawle pas les domaines déjà vus < 14 j)")

    # ── Pool de proxies ───────────────────────────────────────────────────
    # Charge depuis cfg.proxies (IPC/CLI) puis tente proxies.txt en fallback.
    proxy_pool = ProxyPool(cfg.proxies or [])
    if not proxy_pool:
        proxy_pool = ProxyPool.from_file()   # lit scripts/proxies.txt si présent
    if proxy_pool:
        print(f"🔄  Pool proxies : {len(proxy_pool)} entrée(s) (rotation sur 429/403)")

    # Fix-A : RateLimiter global — 2 req/s par défaut, partagé entre TOUS les threads
    # (scrapers, enrichissement email, stack…). Patch requests.get/post automatiquement.
    rate_limiter = RateLimiter(calls_per_second=2.0)

    # Limite de temps globale — arrêt propre + export de ce qui est collecté.
    deadline = Deadline(minutes=cfg.max_runtime_min)
    if cfg.max_runtime_min and cfg.max_runtime_min > 0:
        print(f"⏱   Limite de temps : {cfg.max_runtime_min:.0f} min")

    # Plafond de crawl par entreprise (réglage UI) → variable de module enrich.
    from . import enrich as _enrich
    if cfg.crawl_budget_sec and cfg.crawl_budget_sec > 0:
        _enrich.CRAWL_BUDGET_SEC = float(cfg.crawl_budget_sec)
    print(f"🕸   Budget crawl/entreprise : {_enrich.CRAWL_BUDGET_SEC:.0f} s")

    # ── Clients ───────────────────────────────────────────────────────────
    # StealthyFetcher (Patchright/Chromium headless) pour tous les scrapers.
    fetcher = _ThreadSafeFetcher()
    hunter    = HunterClient(cfg.hunter_key, rate_limiter=rate_limiter) if (cfg.hunter_key and use_hunter) else None
    validator = EmailValidator(cfg.validator_provider, cfg.validator_key) if cfg.validator_key else None

    # ── Client LLM (Ollama / OpenAI) ──────────────────────────────────────────
    # Optionnel : si --llm est fourni, améliore l'extraction sur pages /contact, /equipe, /careers.
    llm_client = None
    if cfg.llm_provider:
        from .llm_extract import LLMConfig, LLMClient
        llm_config = LLMConfig(
            provider=cfg.llm_provider,
            ollama_url=cfg.ollama_url,
            ollama_model=cfg.ollama_model,
            # Clés cloud lues depuis l'env (passées par Electron via spawnEnv).
            openai_key=os.environ.get("OPENAI_API_KEY", ""),
            claude_key=os.environ.get("ANTHROPIC_API_KEY", ""),
            budget=cfg.llm_budget,
            # timeout explicite depuis la config (défaut 45 s, suffisant sur CPU)
            timeout=getattr(cfg, "llm_timeout", 45),
        )
        llm_client = LLMClient(llm_config, cache=cache)

    # Injecter proxy + rate_limiter dans les appels requests.
    # Point #11 (audit) : garde-fou d'idempotence. Si requests.get est DÉJÀ notre
    # wrapper (run() ré-entré, ou run précédent mal restauré), on récupère
    # l'original stocké au lieu d'empiler un 2e wrapper (sinon : double wait(),
    # voire restauration impossible). Le marqueur _candio_orig porte l'original.
    _orig_get  = getattr(requests.get,  "_candio_orig", requests.get)
    _orig_post = getattr(requests.post, "_candio_orig", requests.post)

    def _patched_get(*a, **kw):
        rate_limiter.wait()
        if proxy_pool:
            kw.setdefault("proxies", proxy_pool.requests_dict())
        resp = _orig_get(*a, **kw)
        # Point 3 : rotation intelligente — seulement sur code de blocage.
        # Avant : rotation systématique à chaque requête → change de proxy inutilement
        # même quand tout va bien (gâche les proxies, brise les sessions avec cookie).
        if proxy_pool and proxy_pool.should_rotate(resp.status_code):
            proxy_pool.rotate(reason=f"HTTP {resp.status_code}")
        return resp

    def _patched_post(*a, **kw):
        rate_limiter.wait()
        if proxy_pool:
            kw.setdefault("proxies", proxy_pool.requests_dict())
        resp = _orig_post(*a, **kw)
        if proxy_pool and proxy_pool.should_rotate(resp.status_code):
            proxy_pool.rotate(reason=f"HTTP {resp.status_code}")
        return resp

    # Le marqueur permet de retrouver l'original (idempotence + restauration sûre).
    _patched_get._candio_orig  = _orig_get   # type: ignore[attr-defined]
    _patched_post._candio_orig = _orig_post  # type: ignore[attr-defined]
    requests.get  = _patched_get   # type: ignore[assignment]
    requests.post = _patched_post  # type: ignore[assignment]

    # Fix-2 : try/finally pour restaurer requests.get/post même en cas d'exception
    try:

        # ── Checkpoint / reprise ─────────────────────────────────────────────
        run_id     = ScrapingCheckpoint.make_run_id(cfg.sector, cfg.city)
        checkpoint = ScrapingCheckpoint(run_id)
        resume_phase = 0

        if cfg.resume and checkpoint.exists:
            loaded = checkpoint.load()
            if loaded:
                resume_phase, all_companies_resumed = loaded
                print(f"⏩  Reprise depuis Phase {resume_phase} — {len(all_companies_resumed)} entreprises restaurées.")
            else:
                resume_phase = 0

        # ── Phase 9 préchargement : domaines à exclure ─────────────────────────
        known_domains = load_exclude_domains(cfg.exclude_file)
        if known_domains:
            print(f"📋  {len(known_domains)} domaines déjà en base → seront exclus.")

        # A7 : initialisé ici (avant le if/elif/else) → toujours défini quel que soit
        # le mode emprunté. Évite le hack `"_domain_resolve_thread" in dir()`.
        _domain_resolve_thread: "threading.Thread | None" = None

        # ── Phase 1 : collecte (sauf mode re-enrichissement, LinkedIn import, incremental ou reprise) ──
        if cfg.incremental:
            # A10 : mode incrémental — charge le master CSV existant et isole
            # uniquement les leads sans email réel (source "pattern", "no_email", "").
            # Ré-enrichit UNIQUEMENT ces leads (Phase 4-7) sans re-scraper les sources.
            # Utile pour : débloquer une session précédente avec une nouvelle clé Hunter,
            # ou passer smtp_batch sur les leads restés au pattern.
            from .constants import EmailSource
            master_file = cfg.output_dir / "candio_leads.csv"
            if not master_file.exists():
                print(f"❌  Mode incrémental : master CSV introuvable → {master_file}")
                return
            all_companies = load_companies_from_csv(str(master_file))
            before = len(all_companies)
            all_companies = [
                c for c in all_companies
                if c.email_source in EmailSource.UNVERIFIED_SOURCES or not c.contact_email
            ]
            print(f"\n📥  Mode incrémental : {len(all_companies)}/{before} leads sans email réel "
                  f"(source pattern/vide) → ré-enrichissement Phase 4-7.")
            resume_phase = 3   # skip Phase 1-3 (collecte, MX, catch-all)

        elif cfg.linkedin_csv:
            # Mode "LinkedIn Sales Nav import" : charge un CSV externe (Sales Nav, Evaboot,
            # PhantomBuster, Apollo, …) avec détection flexible des colonnes. Le pipeline
            # standard d'enrichissement (MX, crawl, Hunter, scoring) s'applique ensuite.
            from .linkedin import load_sales_nav_csv, summarize_import
            print(f"\n📥  Mode LinkedIn — chargement de {cfg.linkedin_csv}…")
            try:
                all_companies = load_sales_nav_csv(cfg.linkedin_csv)
            except Exception as e:
                print(f"❌  Échec du chargement LinkedIn : {e}")
                return
            stats = summarize_import(all_companies)
            print(f"   ✔  {stats['total']} leads chargés "
                  f"({stats['with_email']} avec email, "
                  f"{stats['with_contact_name']} avec nom, "
                  f"{stats['with_website']} avec site web)")
            checkpoint.save(1, all_companies)
            # Filtre MX standard : élimine les domaines au serveur mail mort.
            # Sales Nav contient parfois des entreprises fermées / fusionnées.
            if resume_phase < 3:
                all_companies = _run_filter(
                    companies=all_companies, cache=cache,
                    parallel_workers=cfg.parallel_workers,
                    known_domains=known_domains,
                    max_results=cfg.effective_max,
                )
                checkpoint.save(3, all_companies)
        elif cfg.enrich_only and cfg.enrich_csv:
            print(f"\n🔄  Mode re-enrichissement — chargement de {cfg.enrich_csv}…")
            all_companies = load_companies_from_csv(cfg.enrich_csv)
            all_companies = [c for c in all_companies
                             if not c.contact_email or c.email_source in ("pattern", "")]
            print(f"   → {len(all_companies)} entreprises à ré-enrichir.")
            resume_phase = 3
        elif cfg.resume and resume_phase > 0:
            all_companies = all_companies_resumed
        else:
            all_companies = _run_collect(cfg=cfg, fetcher=fetcher, rate_limiter=rate_limiter,
                                         cache=cache, proxy_pool=proxy_pool)
            checkpoint.save(1, all_companies)

            # A7 : démarrer la résolution de domaine en arrière-plan pour les
            # entreprises SANS site web (SIRENE/Pappers) pendant que le filtre MX
            # (Phase 2) traite celles qui ont déjà un site. Ensembles disjoints →
            # aucune race condition.  Le thread est rejoint avant Phase 3b.
            _no_site_for_resolve = [c for c in all_companies if not c.website]
            if _no_site_for_resolve:
                from .enrich import enrich_domain_resolution as _enrich_dr
                def _bg_resolve():
                    _enrich_dr(
                        _no_site_for_resolve, cache=cache,
                        rate_limiter=rate_limiter, delay=cfg.delay,
                        workers=min(cfg.parallel_workers, 5),
                    )
                _domain_resolve_thread = threading.Thread(
                    target=_bg_resolve, daemon=True, name="domain_resolve_bg"
                )
                _domain_resolve_thread.start()
                print(f"⚙️   Résolution domaine (background) : {len(_no_site_for_resolve)} entreprises…")

            if resume_phase < 3:
                all_companies = _run_filter(
                    companies=all_companies, cache=cache,
                    parallel_workers=cfg.parallel_workers,
                    known_domains=known_domains,
                    max_results=cfg.effective_max,
                )
                checkpoint.save(3, all_companies)

        # ── Phase 3b : résolution de domaine pour les entreprises sans website ──
        # CRITIQUE pour les sources annuaire (SIRENE) qui ne donnent que le nom.
        # Sans site web → impossible de crawler l'email. C'est LE maillon des
        # candidatures spontanées : annuaire → nom → SITE WEB → email.
        #
        # A7 : la résolution de domaine des entreprises SANS site web est démarrée
        # en arrière-plan juste APRÈS la collecte (Phase 1), avant même que le
        # filtre MX (Phase 2) ne commence. Ces deux opérations opèrent sur des
        # sous-ensembles disjoints (avec-site vs sans-site) → aucune race condition.
        # La résolution tourne donc pendant les Phases 2-3 et est jointe ici.
        # Si elle est déjà terminée, join() retourne immédiatement.
        if _domain_resolve_thread is not None:
            _domain_resolve_thread.join()
            print("   ✓  Résolution de domaine (background) complète")

        if resume_phase < 4:
            # Vérification : des entreprises sans site qui n'ont pas encore été résolues ?
            # (Peut arriver si elles ont été collectées après le démarrage du background thread)
            from .enrich import enrich_domain_resolution
            _still_no_site = [c for c in all_companies if not c.website]
            if _still_no_site:
                enrich_domain_resolution(
                    _still_no_site, cache=cache,
                    rate_limiter=rate_limiter, delay=cfg.delay,
                    workers=min(cfg.parallel_workers, 5),
                )
            # 2. Hunter en complément pour les domaines encore introuvables (si clé dispo)
            if hunter:
                still_no_domain = [c for c in all_companies if not c.website]
                if still_no_domain:
                    print(f"   🔍  Hunter.io : {len(still_no_domain)} domaines restants…")
                    for c in still_no_domain:
                        domain = hunter.find_domain_by_name(c.name)
                        if domain:
                            c.website = f"https://{domain}"
                            print(f"   ✔  {c.name[:35]:35s} → {domain}")
                        time.sleep(cfg.delay)

            # ── Dédup inter-campagnes — 2e passe APRÈS résolution de domaine ──────
            # Le 1er filtre (Phase 2) ne voyait pas les domaines des sources
            # annuaire (SIRENE/Pappers) qui n'ont que le nom à la collecte. Une
            # fois le site résolu en Phase 3b, on re-filtre : une entreprise déjà
            # en base (même découverte sans domaine) n'est plus re-scrapée/crawlée.
            if known_domains:
                all_companies, _n_excl = filter_known_domains(all_companies, known_domains)
                checkpoint.save(3, all_companies)

        # LRUPageCache borné (max 500 entrées ≈ 25 MB) partagé Phase 4 ↔ Phase 6.
        page_cache = LRUPageCache(maxsize=500)

        # ── A9 (minimal DAG) : Clearbit en background pendant Phase 5 ────────────
        # Clearbit enrichit activity_domain/sector/company_size (champs différents
        # de ceux écrits par Phase 5 : contact_email/email_source) → pas de race sur
        # les *attributs* (le GIL rend atomiques les écritures de champs disjoints).
        # MAIS Phase 5 (skip_no_email) exécute `all_companies[:] = kept` : une mutation
        # *en place de la liste*. Si Clearbit itère cette même liste à cet instant →
        # `RuntimeError: list changed size during iteration`. On lui passe donc un
        # SNAPSHOT `list(all_companies)` : la liste itérée est figée, les objets Company
        # restent partagés (l'enrichissement s'applique bien aux vraies entreprises).
        _clearbit_thread: "threading.Thread | None" = None
        if cfg.use_clearbit and not deadline.expired():
            from .enrich import enrich_clearbit
            _clearbit_snapshot = list(all_companies)
            def _bg_clearbit():
                enrich_clearbit(_clearbit_snapshot, cache, cfg.delay)
            _clearbit_thread = threading.Thread(target=_bg_clearbit, daemon=True, name="clearbit_bg")
            _clearbit_thread.start()

        # ── Phases 4-5e : enrichissement email ───────────────────────────────
        if resume_phase < 4:
            _email_cfg = EmailEnrichConfig(
                use_web_crawl=use_web_crawl, use_hunter=use_hunter,
                use_linkedin=use_linkedin,   use_pattern=use_pattern,
                use_github=cfg.use_github,   use_smtp_batch=cfg.use_smtp_batch,
                github_token=cfg.github_token,
                find_recruiter=cfg.find_recruiter,
                fast_crawl=cfg.fast_crawl,
                skip_no_email=cfg.skip_no_email,
                explore_new_pages=cfg.explore_new_pages,
                # P0-2 : validator présent ? → autorise la génération de patterns
                # (sinon ils sont jetés en sortie de _run_email_enrich).
                has_validator=bool(validator),
                # P2-8 : WHOIS opt-in (RunConfig.use_whois, défaut False).
                use_whois=getattr(cfg, "use_whois", False),
                # P2-9 : validation SMTP légère opt-in (RunConfig.smtp_light_verify).
                smtp_light_verify=getattr(cfg, "smtp_light_verify", False),
                hunter_max_searches=cfg.hunter_max_searches,
            )
            _run_email_enrich(
                companies=all_companies, fetcher=fetcher,
                cfg=_email_cfg,
                hunter=hunter,
                delay=cfg.delay, cache=cache,
                page_cache=page_cache,
                rate_limiter=rate_limiter,
                llm_client=llm_client,
                deadline=deadline,
                target_job=cfg.sector,
                ledger=crawl_ledger,
                proxy_pool=proxy_pool,
            )
            checkpoint.save(4, all_companies)
            if crawl_ledger.enabled:
                print(f"🧭  Registre de crawl : {crawl_ledger.summary()}")

        # ── Phases 6-7 : métadonnées + validation ────────────────────────────
        # A9 : joindre le thread Clearbit si il tournait en background.
        # S'il n'est pas encore terminé, on attend (il est presque toujours fini
        # depuis longtemps car Phase 5 prend bien plus de temps).
        if _clearbit_thread is not None:
            _clearbit_thread.join(timeout=60)

        if not deadline.expired():
            _run_metadata_enrich(
                companies=all_companies, fetcher=fetcher,
                cfg=cfg, validator=validator,
                cache=cache, page_cache=page_cache,
                deadline=deadline,
                # A9 : Clearbit déjà fait en background → ne pas le refaire
                skip_clearbit=(_clearbit_thread is not None),
            )
            checkpoint.save(5, all_companies)
        else:
            print("\n⏱   Limite de temps atteinte — phases 6-7 sautées, export immédiat.")

        # ── Phase 7b : descriptions d'activité (Ollama UNIQUEMENT ici) ────────
        # Résume le texte des sites DÉJÀ extrait par le crawl (page_cache) → §2 perso
        # de l'email. Client LLM dédié (Ollama local), indépendant du LLM de crawl :
        # même si --llm est désactivé pour le scraping, les descriptions sont résumées.
        # Si Ollama est injoignable → repli automatique sur le texte brut tronqué.
        if cfg.describe and not deadline.expired():
            try:
                describe_client = _build_describe_client(cfg)
                from .enrich import enrich_descriptions
                enrich_descriptions(all_companies, llm_client=describe_client,
                                    page_cache=page_cache)
                checkpoint.save(5, all_companies)
            except Exception as _e:  # ne jamais casser l'export pour une description
                print(f"⚠   Phase 7b (descriptions) ignorée : {_e}")

        # ── Phases 8-10 : scoring + export ───────────────────────────────────
        _run_score_export(companies=all_companies, cfg=cfg)
    
        # ── Nettoyage checkpoint (scraping terminé avec succès) ──────────────
        checkpoint.clear()

        # ── Récapitulatif final + stats JSONL ────────────────────────────────
        _print_summary(all_companies, cfg)
        # A6 : écrit les métriques du run dans ~/.cache/carreer-ops/stats.jsonl
        _write_run_stats(all_companies, cfg, run_id, _run_start)
    finally:
        requests.get  = _orig_get   # Fix-2 : restaure les originaux
        requests.post = _orig_post  # même en cas d'exception


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def _prepare_run_kwargs(args: argparse.Namespace) -> RunConfig:
    """
    Transforme un Namespace argparse en RunConfig prêt pour run().

    Séparation des responsabilités : main() déclare les arguments, cette
    fonction les valide / convertit / enrichit. Retourne un RunConfig typé
    plutôt qu'un dict générique — plus facile à tester unitairement.
    """
    # ── Point #14 : secrets via variables d'environnement ────────────────────
    # On préfère l'env (HUNTER_API_KEY) à l'argument CLI : un argument est visible
    # dans la liste des processus (ps / Gestionnaire des tâches), pas une variable
    # d'env. L'arg --hunter-key reste accepté en fallback (usage CLI manuel).
    if not args.hunter_key:
        args.hunter_key = os.environ.get("HUNTER_API_KEY", "")

    # ── Normalisation des listes CSV de sources ───────────────────────────────
    sources       = [s.strip() for s in args.sources.split(",")       if s.strip()]
    email_sources = [s.strip() for s in args.email_sources.split(",") if s.strip()]

    # Fix-2 : Pappers — ajoute la source si une clé est fournie.
    # La clé est passée via scraper_kwargs dans _run_collect(), plus de monkey-patch.
    if args.pappers_key and "pappers" not in sources:
        sources.append("pappers")

    # ── Affichage récapitulatif avant exécution ───────────────────────────────
    industry_display  = args.industry.strip() or f"(fallback : {args.sector})"
    email_src_display = ", ".join(email_sources) if email_sources else "aucune"

    apis_en = []
    if args.hunter_key and "hunter" in email_sources:  apis_en.append("Hunter")
    if "linkedin" in email_sources:                    apis_en.append("LinkedIn+SMTP")
    apis_str = ", ".join(apis_en) if apis_en else "aucune"

    # Libellés lisibles pour la tranche d'effectif SIRENE (affichage bandeau).
    _SIZE_LABELS = {
        "all":   "toutes tailles",
        "pme":   "TPE/PME (0–249 salariés)",
        "eti":   "ETI (250–4999)",
        "grand": "Grand groupe (5000+)",
    }
    print(f"""
╔════════════════════════════════════════════════════════╗
║   Carreer-ops Lead Scraper — Pipeline 12 phases        ║
║   Poste ciblé  : {args.sector:<38}║
║   Industrie    : {industry_display:<38}║
║   Ville        : {args.city:<38}║
║   Sources      : {', '.join(sources):<38}║
║   Max          : {(f'illimité (plafond sécurité {RunConfig.UNLIMITED_SAFETY_CAP})' if args.max == 0 else str(args.max)):<38}║
║   Taille (SIRENE): {_SIZE_LABELS.get(args.size_target, args.size_target):<36}║
║   Email sources: {email_src_display:<38}║
║   APIs email   : {apis_str:<38}║
║   Skip no-email: {'✔ oui (sans email réel → exclu)' if args.skip_no_email else '✗ non (pattern conservé)':<38}║
║   Validation   : {args.validator or 'désactivée':<38}║
╚════════════════════════════════════════════════════════╝
""")

    # ── Proxies ───────────────────────────────────────────────────────────────
    proxies_list = [p.strip() for p in args.proxies.split(",") if p.strip()] if args.proxies else []

    # ── Poids de scoring personnalisés (fichier JSON optionnel) ──────────────
    scoring_weights_dict: dict | None = None
    if args.scoring_weights:
        try:
            with open(args.scoring_weights, "r", encoding="utf-8") as f:
                scoring_weights_dict = json.load(f)
        except Exception as e:
            print(f"⚠  Impossible de charger --scoring-weights : {e} — poids par défaut utilisés.")

    # ── Feedback historique (JSON optionnel) ──────────────────────────────────
    feedback_dict: dict | None = None
    if args.feedback_file:
        try:
            with open(args.feedback_file, "r", encoding="utf-8") as f:
                feedback_dict = json.load(f)
        except Exception as e:
            print(f"⚠  Impossible de charger --feedback-file : {e} — rétroaction ignorée.")

    # ── Blacklist / whitelist (fichiers texte) ────────────────────────────────
    blacklist_set = load_domain_list(args.blacklist_file) if args.blacklist_file else None
    whitelist_set = load_domain_list(args.whitelist_file) if args.whitelist_file else None
    if blacklist_set:
        print(f"🚫  Blacklist chargée : {len(blacklist_set)} domaines exclus.")
    if whitelist_set:
        print(f"⭐  Whitelist chargée : {len(whitelist_set)} domaines prioritaires.")

    return RunConfig(
        sector=args.sector,
        city=args.city,
        max_results=args.max,
        sources=sources,
        hunter_key=args.hunter_key,
        hunter_max_searches=args.hunter_max_searches,
        delay=args.delay,
        output_dir=Path(args.output),
        validator_provider=args.validator,
        validator_key=args.validator_key,
        exclude_file=args.exclude_file,
        industry=args.industry,
        email_sources=email_sources,
        skip_no_email=args.skip_no_email,
        pappers_key=args.pappers_key,
        github_token=args.github_token,
        llm_provider=args.llm,
        ollama_url=args.ollama_url,
        ollama_model=args.ollama_model,
        llm_budget=args.llm_budget,
        # Descriptions d'activité (Phase 7b), indépendant du LLM de crawl.
        # Provider dédié : ollama (local) | openai | claude. Sans cette ligne, le
        # scrape principal ignorait --describe-provider et rédigeait TOUJOURS en Ollama.
        describe=not args.no_descriptions,
        describe_provider=("" if args.no_descriptions else args.describe_provider),
        describe_model=args.describe_model,
        proxies=proxies_list,
        fuzzy=not args.no_fuzzy_dedup,
        fuzzy_threshold=args.fuzzy_threshold,
        parallel_workers=args.parallel_workers,
        use_cache=not args.no_cache,
        use_clearbit=not args.no_clearbit,
        use_github=args.use_github,
        use_smtp_batch=args.smtp_batch,
        skip_scoring=args.no_scoring,
        scoring_weights=scoring_weights_dict,
        posted_within_days=args.posted_within_days,
        size_target=args.size_target,
        fast_crawl=not args.no_fast_crawl,
        explore_new_pages=args.explore_new_pages,
        explore_sources=args.explore_sources,
        find_recruiter=not args.no_find_recruiter,
        feedback=feedback_dict,
        blacklist_domains=blacklist_set,
        whitelist_domains=whitelist_set,
        enrich_only=args.enrich_only,
        enrich_csv=args.enrich_csv,
        linkedin_csv=args.linkedin_csv,
        max_runtime_min=args.max_runtime,
        crawl_budget_sec=args.crawl_budget,
        pages_per_run=args.pages_per_run,
        # B0-6 : options précédemment mortes (dans RunConfig mais absentes du CLI)
        use_whois=args.whois,
        smtp_light_verify=args.smtp_light_verify,
        incremental=args.incremental,
        imap_host=args.imap_host,
        imap_port=args.imap_port,
        imap_user=args.imap_user,
        imap_pass=args.imap_pass,
        imap_folder=args.imap_folder,
        alerts_since_days=args.alerts_since_days,
        resume=args.resume,
    )




# ══════════════════════════════════════════════════════════════════════════════
# CLI — POINT D'ENTRÉE
# ══════════════════════════════════════════════════════════════════════════════

def main():
    """
    Point d'entrée CLI. Déclare les arguments argparse, délègue la conversion
    à _prepare_run_kwargs() et démarre le pipeline via run().
    """
    parser = argparse.ArgumentParser(
        description="Scraping leads → Carreer-ops (pipeline 10 phases)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Sources : wttj · indeed · kompass · pj · apec · cadremploi
  wttj       → startups & scale-ups (tech, data, product)
  apec       → emploi cadre — meilleur pour data analyst / finance
  cadremploi → cadres tous secteurs
  indeed     → tous secteurs (offres actives)
  kompass    → B2B (finance, industrie, conseil)
  pj         → PME locales
        """
    )
    parser.add_argument("--sector",  "-s", default="data analyst",
                        help="Titre du poste pour les job boards (WTTJ, Indeed, APEC…)")
    parser.add_argument("--industry", "-i", default="",
                        help=(
                            "Domaine d'activité pour les annuaires Kompass / PJ "
                            "(ex: 'finance', 'SaaS', 'industrie'). "
                            "Si absent, --sector est utilisé en fallback."
                        ))
    parser.add_argument("--city",    "-c", default="Paris")
    parser.add_argument("--max",     "-m", type=int, default=60)
    parser.add_argument("--sources", default=",".join(DEFAULT_SOURCES))
    parser.add_argument("--hunter-key",  default="",    metavar="KEY")
    parser.add_argument("--hunter-max-searches", type=int, default=20, metavar="N",
                        help="Plafond de recherches Hunter.io par run (défaut 20 ; "
                             "le min avec le quota réel via /account est appliqué). "
                             "Augmentez-le si vous avez un plan payant.")
    parser.add_argument("--delay",   "-d", type=float, default=2.0)
    # Par défaut : scripts/data/ — sous-dossier dédié aux DONNÉES (master CSV,
    # archives datées, aperçu HTML), séparé du CODE (scripts/*.py, candio_scraper/).
    # Évite que le dossier scripts/ se remplisse de CSV/HTML au fil des runs.
    # Le dossier est créé automatiquement par _run_score_export si absent.
    parser.add_argument("--output",  "-o",
                        default=str(Path(__file__).resolve().parent.parent / "data"))

    # Phase 7 : validation email
    parser.add_argument("--validator",     default="", choices=["neverbounce", "zerobounce", ""])
    parser.add_argument("--validator-key", default="", metavar="KEY")

    # Phase 9 : dédup inter-campagnes
    parser.add_argument("--exclude-file", default="",
                        help="Chemin vers un fichier JSON de domaines déjà en base (généré par Carreer-ops)")

    # Sources d'enrichissement email
    parser.add_argument("--email-sources", default="web_crawl,hunter,pattern",
                        help=(
                            "Sources d'email à utiliser, séparées par virgule. "
                            "Valeurs : web_crawl, hunter, linkedin, pattern. "
                            "Ex: --email-sources web_crawl,hunter,linkedin"
                        ))
    parser.add_argument("--skip-no-email", action="store_true",
                        help="Exclut du CSV les entreprises où aucun email réel n'a été trouvé")

    # Phase 5d : GitHub
    parser.add_argument("--github-token", default="",
                        help="GitHub personal token (optionnel, 5000 req/h au lieu de 60)")
    parser.add_argument("--use-github",  action="store_true",
                        help="Active la recherche d'email via l'API GitHub orgs")

    # Phase 5e : SMTP multi-pattern
    parser.add_argument("--smtp-batch",  action="store_true",
                        help="Essaie rh@, jobs@, contact@… via SMTP RCPT TO (lent)")

    # Pappers.fr (source SIRENE + dirigeants)
    parser.add_argument("--pappers-key", default="", metavar="TOKEN",
                        help="Pappers.fr API token — 500 req/mois gratuits, retourne les dirigeants")

    # LLM — extraction structurée via Ollama local ou OpenAI cloud
    parser.add_argument("--llm", default="", choices=["", "ollama", "openai", "claude"],
                        help="Active l'extraction LLM (Ollama local ou OpenAI). Améliore crawl emails, recruteurs, stack tech.")
    parser.add_argument("--ollama-url", default="http://localhost:11434", metavar="URL",
                        help="URL du serveur Ollama (défaut : http://localhost:11434)")
    parser.add_argument("--ollama-model", default="qwen2.5-coder:7b", metavar="MODEL",
                        help="Modèle Ollama à utiliser (défaut : qwen2.5-coder:7b — bon pour extraction structurée)")
    parser.add_argument("--llm-budget", type=int, default=100, metavar="N",
                        help="Nombre maximum d'appels LLM par run (défaut : 100). Au-delà, fallback regex.")

    # Dédup fuzzy
    parser.add_argument("--no-fuzzy-dedup", action="store_true",
                        help="Désactive le dédup fuzzy sur les noms d'entreprise")
    parser.add_argument("--fuzzy-threshold", type=float, default=0.85,
                        help="Seuil de similarité pour le dédup fuzzy (défaut: 0.85)")

    # Proxies
    parser.add_argument("--proxies", default="",
                        help="Liste de proxies rotatifs séparés par virgule (http://user:pass@host:port)")

    # Paramètres système
    parser.add_argument("--parallel-workers", type=int, default=10,
                        help="Threads pour les phases parallèles MX/catch-all (défaut: 10)")
    parser.add_argument("--no-cache",   action="store_true",
                        help="Désactive le cache SQLite persistant")
    parser.add_argument("--no-clearbit", action="store_true",
                        help="Désactive l'enrichissement Clearbit (métadonnées)")

    # Scoring configurable
    parser.add_argument("--no-scoring", action="store_true",
                        help="Saute la phase 8 : les entreprises sont exportées dans l'ordre de collecte")
    parser.add_argument("--scoring-weights", default="",
                        help="Chemin vers un fichier JSON de poids de scoring (surcharge les valeurs par défaut)")

    # Nouvelles options (10 améliorations)
    parser.add_argument("--posted-within-days", type=int, default=0, metavar="N",
                        help="Exclut les offres publiées il y a plus de N jours (0 = pas de filtre)")
    parser.add_argument("--size-target", default="all", choices=["all", "pme", "eti", "grand"],
                        help="Cible de taille (filtre SIRENE) : pme(10-249), eti(250-4999), grand(5000+)")
    parser.add_argument("--no-fast-crawl", action="store_true",
                        help="Désactive le crawl rapide requests+bs4 (utilise uniquement le navigateur headless)")
    parser.add_argument("--no-find-recruiter", action="store_true",
                        help="Désactive la recherche du nom du recruteur RH (Phase 4c)")
    parser.add_argument("--explore-new-pages", action="store_true",
                        help="Re-crawle les domaines déjà vus SANS email sur des pages non encore "
                             "visitées (registre d'URLs) → plus d'adresses au fil des runs.")
    parser.add_argument("--explore-sources", action="store_true",
                        help="Pagination progressive des sources (SIRENE/APEC/WTTJ/Indeed) : "
                             "chaque run reprend aux pages suivantes → de NOUVELLES entreprises.")
    parser.add_argument("--feedback-file", default="",
                        help="JSON {replied:[…], bounced:[…], no_reply:[…]} pour la boucle de rétroaction")
    parser.add_argument("--blacklist-file", default="",
                        help="Fichier texte (un domaine par ligne) de sites à exclure de la collecte")
    parser.add_argument("--whitelist-file", default="",
                        help="Fichier texte (un domaine par ligne) d'entreprises prioritaires (+999 pts)")
    parser.add_argument("--enrich-only", action="store_true",
                        help="Mode re-enrichissement : charge --enrich-csv, relance uniquement les phases email")
    parser.add_argument("--enrich-csv", default="",
                        help="Chemin CSV source pour --enrich-only")
    parser.add_argument("--linkedin-csv", default="", metavar="PATH",
                        help=("Import CSV LinkedIn Sales Navigator (ou export tiers : Evaboot, "
                              "PhantomBuster, Apollo, Wiza…). Détection flexible des colonnes. "
                              "Saute la collecte multi-sources et enrichit directement les leads."))
    parser.add_argument("--max-runtime", type=float, default=0.0, metavar="MIN",
                        help="Limite de temps globale en minutes (défaut: 0 = illimité). "
                             "Le scraper s'arrête proprement et exporte ce qu'il a collecté.")
    parser.add_argument("--crawl-budget", type=float, default=25.0, metavar="SEC",
                        help="Plafond de temps de crawl par entreprise en secondes (défaut: 25). "
                             "Plus haut = meilleure couverture email mais plus lent.")
    parser.add_argument("--pages-per-run", type=int, default=2, metavar="N",
                        help="Nombre de pages lues par run par source (défaut: 2). "
                             "Plus élevé = plus d'entreprises mais run plus long. "
                             "N'a d'effet que si --explore-sources est activé.")

    # Source "email alerts" (webhook) — credentials IMAP
    parser.add_argument("--imap-host", default="", help="Hôte IMAP pour la source email_alerts")
    parser.add_argument("--imap-port", type=int, default=993, help="Port IMAP (défaut: 993)")
    parser.add_argument("--imap-user", default="", help="Utilisateur IMAP")
    parser.add_argument("--imap-pass", default="", help="Mot de passe IMAP")
    parser.add_argument("--imap-folder", default="INBOX", help="Dossier IMAP à scanner (défaut: INBOX)")
    parser.add_argument("--alerts-since-days", type=int, default=7,
                        help="Ne lire que les alertes des N derniers jours (défaut: 7)")
    parser.add_argument("--resume", action="store_true",
                        help="Reprend le dernier scraping interrompu depuis le checkpoint sauvegardé")

    # A10 : Mode incrémental
    parser.add_argument("--incremental", action="store_true",
                        help=(
                            "Charge le master CSV (candio_leads.csv) et ne ré-enrichit que "
                            "les leads sans email réel (source 'pattern' ou vide). "
                            "Évite de re-scraper les sources — parfait pour compléter une "
                            "session précédente avec une nouvelle clé API (Hunter)."
                        ))

    # Phase 4b : WHOIS (désactivé par défaut — faible rendement depuis RGPD)
    parser.add_argument("--whois", action="store_true",
                        help="Active la recherche d'email via WHOIS (Phase 4b). "
                             "Fonctionne surtout sur les .fr AFNIC ; depuis le RGPD "
                             "la plupart des grands registraires masquent les emails.")

    # Validation SMTP légère sur les emails « pattern » générés
    parser.add_argument("--smtp-light-verify", action="store_true",
                        help="Tente un RCPT TO SMTP sur l'email pattern généré (rh@…). "
                             "Si le serveur répond 250, le marque 'pattern_verified' "
                             "au lieu de 'pattern' — survive à --skip-no-email. "
                             "Nécessite que le port 25 sortant soit ouvert (non FAI résidentiel).")

    parser.add_argument("--enrich-descriptions", action="store_true",
                        help="Mode autonome : charge le master CSV et remplit la description "
                             "d'activité de chaque entreprise (texte du site + résumé IA). "
                             "Réécrit le CSV en place. Idéal pour enrichir des leads existants.")
    parser.add_argument("--desc-max", type=int, default=0, metavar="N",
                        help="Plafond d'entreprises à décrire avec --enrich-descriptions (0 = toutes)")
    parser.add_argument("--describe-model", default="qwen2.5:7b", metavar="MODEL",
                        help="Modèle DÉDIÉ aux descriptions d'activité (résumé du texte "
                             "des sites). Indépendant de --ollama-model (crawl). Défaut: qwen2.5:7b "
                             "(Ollama) ou gpt-4o-mini si --describe-provider openai.")
    parser.add_argument("--describe-provider", default="ollama", metavar="PROVIDER",
                        choices=["ollama", "openai", "claude"],
                        help="Fournisseur IA des fiches entreprise/actualités : 'ollama' (local, "
                             "gratuit) ou 'openai' (cloud, clé OPENAI_API_KEY requise). Défaut: ollama. "
                             "N'affecte PAS le crawl, seulement les fiches.")
    parser.add_argument("--no-descriptions", action="store_true",
                        help="Désactive la Phase 7b (descriptions d'activité résumées par Ollama).")
    parser.add_argument("--desc-force", action="store_true",
                        help="Avec --enrich-descriptions : RÉGÉNÈRE les fiches existantes "
                             "(écrase les notes actuelles) au lieu de ne compléter que les manquantes.")
    parser.add_argument("--desc-max-age", type=int, default=0, metavar="N",
                        help="Avec --enrich-descriptions : régénère les fiches VIDES + celles "
                             "de plus de N jours (0 = pas de filtre d'âge).")
    parser.add_argument("--news-only", action="store_true",
                        help="Avec --enrich-descriptions : régénère UNIQUEMENT la note "
                             "actualités (garde la fiche générale). Combiner avec --desc-max-age.")
    parser.add_argument("--desc-keys-file", default="", metavar="PATH",
                        help="Avec --enrich-descriptions : fichier texte (1 clé name|email|website "
                             "par ligne) → ne traite QUE ces leads (sous-ensemble affiché/filtré).")

    args = parser.parse_args()

    if args.enrich_descriptions:
        from pathlib import Path as _P
        csv_path = args.enrich_csv or str(_P(args.output) / "candio_leads.csv")
        run_enrich_descriptions(
            csv_path=csv_path,
            describe_provider=("" if args.no_descriptions else args.describe_provider),
            ollama_url=args.ollama_url,
            describe_model=args.describe_model,
            max_companies=(args.desc_max or None),
            force=args.desc_force,
            max_age_days=(args.desc_max_age or None),
            news_only=args.news_only,
            keys_file=args.desc_keys_file,
        )
        return

    run(_prepare_run_kwargs(args))
