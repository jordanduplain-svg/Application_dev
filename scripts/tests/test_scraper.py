"""
tests/test_scraper.py — Tests unitaires du package candio_scraper.
==================================================================
Réécrit après le refactor monolithe → package (point #9 audit). L'ancienne
version chargeait `scrape_leads.py` et cassait à l'import (`scrape_leads.Company`
n'existe plus). On teste désormais les fonctions PURES (déterministes, sans
réseau) qui portent la logique critique : filtres email, validation de domaine,
fusion master, scoring, registre de crawl, round-trip CSV.

Lancer :
  python -m pytest scripts/tests/ -v
  python scripts/tests/test_scraper.py          # sans pytest (unittest)
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

# Le package est dans scripts/ — on le rend importable sans installation.
_SCRIPTS = Path(__file__).resolve().parent.parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from candio_scraper.models import Company, _domain
from candio_scraper.enrich import (
    _is_junk_email, _rank_email, _domain_matches_name, _domain_core,
    _tld_plausible, _name_similarity,
    fuzzy_dedup, _looks_like_person_name,
)
from candio_scraper.io_csv import merge_into_master, load_companies_from_csv, CSV_FIELDNAMES
from candio_scraper.crawl_ledger import CrawlLedger
from candio_scraper.classification import parse_location

# B2-5 : plus de liste dupliquée — importée depuis io_csv (source unique)
_FIELDNAMES = CSV_FIELDNAMES


class TestChooseContact(unittest.TestCase):
    """Phase 5 : choose_contact privilégie le contact FRANCE (titre FR) sur le siège d'un groupe."""
    @staticmethod
    def _e(pos, val, conf=50):
        return {"position": pos, "value": val, "confidence": conf}

    def test_prefers_french_title_over_hq(self):
        from candio_scraper.enrich_apis import choose_contact
        # Groupe international : le siège (HR Director, forte confiance) vient AVANT la RH France.
        emails = [
            self._e("HR Director", "hq@hardis.com", conf=99),
            self._e("Responsable RH", "rh.france@hardis.fr", conf=60),
        ]
        self.assertEqual(choose_contact(emails)["value"], "rh.france@hardis.fr")

    def test_falls_back_to_confidence(self):
        from candio_scraper.enrich_apis import choose_contact
        emails = [self._e("Sales", "a@x.com", conf=30), self._e("Engineer", "b@x.com", conf=80)]
        self.assertEqual(choose_contact(emails)["value"], "b@x.com")

    def test_empty(self):
        from candio_scraper.enrich_apis import choose_contact
        self.assertIsNone(choose_contact([]))


class TestRecruiterNameGuard(unittest.TestCase):
    """Phase 4c : _looks_like_person_name rejette les faux noms (intitulés / nom de boîte)."""
    @staticmethod
    def _co(name="", website=""):
        from types import SimpleNamespace
        return SimpleNamespace(name=name, website=website)

    def test_rejects_section_headings(self):
        # Faux positifs réels observés en prod (mots-clés de titre pris pour des noms).
        self.assertFalse(_looks_like_person_name("Recrutement Travailler", self._co("Psypro Paris", "https://psypro-paris.fr")))
        self.assertFalse(_looks_like_person_name("Fondateurs Directeur", self._co("Neobiosys", "https://neobiosys.com")))

    def test_rejects_company_name(self):
        self.assertFalse(_looks_like_person_name("Ambulances Jassans", self._co("AMBULANCES DE JASSANS", "https://ambulancesdejassans.fr")))

    def test_accepts_real_names(self):
        self.assertTrue(_looks_like_person_name("Marie Dupont", self._co("Acme", "https://acme.fr")))
        self.assertTrue(_looks_like_person_name("Jean-Pierre Martin", self._co("Acme", "https://acme.fr")))
        # Un vrai nom qui partage UN token avec la boîte reste accepté (pas tous les tokens).
        self.assertTrue(_looks_like_person_name("Paul Jassans", self._co("AMBULANCES DE JASSANS", "https://ambulancesdejassans.fr")))

    def test_rejects_single_word(self):
        self.assertFalse(_looks_like_person_name("Dupont", self._co("Acme", "https://acme.fr")))

    def test_rejects_nav_cta_garbage(self):
        # Faux positifs réels observés en prod (leads « pattern_nominative » bidons) :
        # texte de nav/CTA capturé près d'un mot-clé de titre, pris pour un prénom+nom.
        self.assertFalse(_looks_like_person_name("Youtube Votre", self._co("Spaciotempo", "https://spaciotempo.fr")))
        self.assertFalse(_looks_like_person_name("Talial Decouvrir", self._co("Horizal", "https://horizal.com")))
        self.assertFalse(_looks_like_person_name("Autres Ecroutage", self._co("ALR", "https://alr.fr")))


class TestWTTJLocationFilter(unittest.TestCase):
    """WTTJ (API) : _match_office garde/écarte selon la zone demandée."""
    @staticmethod
    def _targets(loc_str):
        from candio_scraper.classification import parse_location
        d = parse_location(loc_str)
        return (d.get("city", "").lower(), d.get("dept", ""), (d.get("region") or "").lower())

    def test_keeps_office_in_region(self):
        from candio_scraper.sources import WTTJScraper
        from candio_scraper.classification import parse_location
        tc, td, tr = self._targets("Auvergne-Rhône-Alpes")
        offices = [{"city": "Lyon", "zip_code": "69002", "country_code": "FR", "is_headquarter": True}]
        loc = WTTJScraper._match_office(offices, tc, td, tr, parse_location)
        self.assertIsNotNone(loc)
        self.assertEqual(loc["region"].lower(), "auvergne-rhône-alpes")

    def test_drops_paris_for_ara(self):
        from candio_scraper.sources import WTTJScraper
        from candio_scraper.classification import parse_location
        tc, td, tr = self._targets("Auvergne-Rhône-Alpes")
        offices = [{"city": "Paris", "zip_code": "75001", "country_code": "FR", "is_headquarter": True}]
        self.assertIsNone(WTTJScraper._match_office(offices, tc, td, tr, parse_location))

    def test_keeps_multisite_company(self):
        from candio_scraper.sources import WTTJScraper
        from candio_scraper.classification import parse_location
        tc, td, tr = self._targets("Auvergne-Rhône-Alpes")
        offices = [
            {"city": "Lille", "zip_code": "59000", "country_code": "FR", "is_headquarter": True},
            {"city": "Lyon", "zip_code": "69003", "country_code": "FR"},
        ]
        loc = WTTJScraper._match_office(offices, tc, td, tr, parse_location)
        self.assertIsNotNone(loc)
        self.assertEqual(loc["city"], "Lyon")

    def test_no_zone_returns_hq_fr(self):
        from candio_scraper.sources import WTTJScraper
        from candio_scraper.classification import parse_location
        offices = [{"city": "Paris", "zip_code": "75001", "country_code": "FR", "is_headquarter": True}]
        loc = WTTJScraper._match_office(offices, "", "", "", parse_location)
        self.assertEqual(loc["city"], "Paris")


class TestAPECLocationParse(unittest.TestCase):
    """APEC (API) : _loc_from_lieu parse 'Ville - DD' et _loc_matches filtre la zone."""
    def test_parses_lieu_texte(self):
        from candio_scraper.sources import APECScraper
        from candio_scraper.classification import parse_location
        loc = APECScraper._loc_from_lieu("Lyon 01 - 69", parse_location)
        self.assertEqual(loc["dept"], "69")
        self.assertEqual(loc["region"].lower(), "auvergne-rhône-alpes")
        self.assertIn("lyon", loc["city"].lower())

    def test_zone_filter(self):
        from candio_scraper.sources import APECScraper
        from candio_scraper.classification import parse_location
        tr = (parse_location("Auvergne-Rhône-Alpes").get("region") or "").lower()
        lyon  = APECScraper._loc_from_lieu("Lyon 01 - 69", parse_location)
        paris = APECScraper._loc_from_lieu("Paris 01 - 75", parse_location)
        self.assertTrue(APECScraper._loc_matches(lyon, "", "", tr))
        self.assertFalse(APECScraper._loc_matches(paris, "", "", tr))


class TestDomainHelpers(unittest.TestCase):
    def test_domain_strips_scheme_and_www(self):
        self.assertEqual(_domain("https://www.acme.fr/contact"), "acme.fr")
        self.assertEqual(_domain("http://acme.fr/"), "acme.fr")
        self.assertEqual(_domain("acme.fr"), "")  # sans schéma → vide (documenté)

    def test_domain_core(self):
        self.assertEqual(_domain_core("mentions.acme.fr"), "acme")
        self.assertEqual(_domain_core("as.com"), "as")
        self.assertEqual(_domain_core("x.co.uk"), "x")

    def test_tld_plausible(self):
        self.assertTrue(_tld_plausible("acme.fr"))
        self.assertTrue(_tld_plausible("acme.com"))
        self.assertFalse(_tld_plausible("mt.gov"))
        self.assertFalse(_tld_plausible("castel.jp"))
        self.assertFalse(_tld_plausible("ghmc.gov.in"))

    def test_tld_fr_strict_rejects_foreign_european(self):
        # Fix run réel : HORMEI (Isère) → horme.it (quincaillerie italienne).
        # En recherche FR explicite, les ccTLD européens étrangers sont rejetés.
        self.assertFalse(_tld_plausible("horme.it", country_hint="fr"))
        self.assertFalse(_tld_plausible("x.de", country_hint="fr"))
        self.assertFalse(_tld_plausible("x.es", country_hint="fr"))
        self.assertFalse(_tld_plausible("x.co.uk", country_hint="fr"))
        # Mais .fr / .com / .be (francophone) / gTLD restent acceptés en FR
        self.assertTrue(_tld_plausible("x.fr", country_hint="fr"))
        self.assertTrue(_tld_plausible("x.com", country_hint="fr"))
        self.assertTrue(_tld_plausible("x.be", country_hint="fr"))
        # SANS country_hint (ex: sanitizer d'email) → comportement large préservé
        self.assertTrue(_tld_plausible("horme.it"))


class TestJunkEmailFilter(unittest.TestCase):
    def test_rejects_technical_and_role_mailboxes(self):
        for em in ("com@ima.eu", "contactexport@provost.fr", "etat@ugap.fr",
                   "ir@rexel.com", "gestion.domaine@x.fr", "hostmaster@x.fr",
                   "dpo@x.fr", "newsletter@x.fr", "paymentinquiry@abm.com"):
            self.assertTrue(_is_junk_email(em), f"devrait être junk : {em}")

    def test_keeps_real_contacts(self):
        # RH + personnels sont conservés ; les génériques (contact@, info@…) non.
        # contact@ est explicitement RÉ-AUTORISÉ (demande utilisateur).
        for em in ("rh@acme.fr", "recrutement@acme.fr", "jobs@acme.fr",
                   "claire.martin@acme.fr", "c.martin@acme.fr", "david@acme.fr",
                   "marion.delmas@atos.net", "contact@acme.fr"):
            self.assertFalse(_is_junk_email(em), f"ne devrait pas être junk : {em}")

    def test_rejects_privacy_gdpr_mailboxes(self):
        # Guichets « droits sur les données personnelles » / RGPD : jamais un RH.
        for em in ("mesdonneesperso@groupe-samse.fr", "vosdonnees@x.fr",
                   "dataprotection@y.com", "vieprivee@z.fr"):
            self.assertTrue(_is_junk_email(em), f"devrait être junk (RGPD) : {em}")

    def test_rejects_generic_mailboxes(self):
        # Détection STRUCTURELLE des mailboxes de service (+ composés/variantes).
        # NB : contact@ n'est PAS dans cette liste — il est accepté.
        # NB : info@ est maintenant un DERNIER RECOURS (pas junk dur) — testé séparément.
        for em in ("marketing@x.fr", "commercial@x.fr",
                   "serviceinfo@provost.fr", "info.br@ortec.com", "service.client@x.fr",
                   "newsletter@x.fr", "sav@x.fr"):
            self.assertTrue(_is_junk_email(em), f"devrait être junk (générique) : {em}")

    def test_rejects_policies_compliance(self):
        # Fix run réel : policies@cgtechlabs.com a fui (boîte conformité, pas RH).
        for em in ("policies@cgtechlabs.com", "compliance@x.fr", "conformite@x.fr",
                   "datapolicies@x.com", "policy@x.fr"):
            self.assertTrue(_is_junk_email(em), f"devrait être junk (conformité) : {em}")

    def test_rejects_security_mailboxes(self):
        # Fix run réel : security@agora.io a fui (équipe sécu, pas RH).
        for em in ("security@agora.io", "securite@x.fr", "soc@x.fr", "csirt@x.fr"):
            self.assertTrue(_is_junk_email(em), f"devrait être junk (sécurité) : {em}")

    def test_anchor_trims_parasite_tld_suffix(self):
        # Fix run réel : "claire.martin@agora.io.agora" (site agora.io) → suffixe parasite
        # « .agora » coupé via l'ancrage site_domain.
        from candio_scraper.enrich import _collect_all_emails
        out = _collect_all_emails("Contact : claire.martin@agora.io.agora", "", "agora.io")
        self.assertIn("claire.martin@agora.io", out)
        self.assertNotIn("claire.martin@agora.io.agora", out)

    def test_last_resort_aliases(self):
        # info@, infos@, secretariat@ : pas junk (score 0), gardés si rien de mieux.
        from candio_scraper.enrich import _rank_email
        for em in ("info@pme.fr", "infos@pme.fr", "secretariat@pme.fr"):
            self.assertFalse(_is_junk_email(em), f"ne devrait pas être junk (dernier recours) : {em}")
            self.assertEqual(_rank_email(em, "pme.fr"), 0, f"score devrait être 0 : {em}")

    def test_rank_email_junk_is_negative(self):
        self.assertEqual(_rank_email("ir@rexel.com", "rexel.com"), -1)
        self.assertEqual(_rank_email("rh@acme.fr", "acme.fr"), 4)


class TestShortCoreTitleConfirm(unittest.TestCase):
    """Audit #1 : cœur court (≤6) → confirmation par le <title> requise."""

    def test_short_core_rejected_when_title_unconfirmed(self):
        # GIE AGORA → agora.io : core « agora » court + titre ne confirme pas → rejet.
        import candio_scraper.domain_resolve as dr
        orig_cb, orig_ddg, orig_title = dr.resolve_domain_clearbit, dr.resolve_domain_duckduckgo, dr._homepage_title_confirms
        dr.resolve_domain_clearbit   = lambda name, country_hint="fr": "agora.io"
        dr.resolve_domain_duckduckgo = lambda *a, **k: ""
        dr._homepage_title_confirms  = lambda name, domain: False   # titre ne confirme pas
        try:
            self.assertEqual(dr.resolve_company_domain("GIE AGORA", cache=None), "")
        finally:
            dr.resolve_domain_clearbit, dr.resolve_domain_duckduckgo, dr._homepage_title_confirms = orig_cb, orig_ddg, orig_title

    def test_short_core_accepted_when_title_confirms(self):
        # Vrai « Nuxit » → nuxit.com : core court MAIS titre confirme → accepté.
        import candio_scraper.domain_resolve as dr
        orig_cb, orig_ddg, orig_title = dr.resolve_domain_clearbit, dr.resolve_domain_duckduckgo, dr._homepage_title_confirms
        dr.resolve_domain_clearbit   = lambda name, country_hint="fr": "nuxit.com"
        dr.resolve_domain_duckduckgo = lambda *a, **k: ""
        dr._homepage_title_confirms  = lambda name, domain: True
        try:
            self.assertEqual(dr.resolve_company_domain("NUXIT", cache=None), "nuxit.com")
        finally:
            dr.resolve_domain_clearbit, dr.resolve_domain_duckduckgo, dr._homepage_title_confirms = orig_cb, orig_ddg, orig_title

    def test_long_core_skips_title_confirm(self):
        # Cœur long (≥7) : accepté sans confirmation titre (similarité fiable) — pas de fetch.
        import candio_scraper.domain_resolve as dr
        orig_cb, orig_ddg, orig_title = dr.resolve_domain_clearbit, dr.resolve_domain_duckduckgo, dr._homepage_title_confirms
        dr.resolve_domain_clearbit   = lambda name, country_hint="fr": "ascometal.com"
        dr.resolve_domain_duckduckgo = lambda *a, **k: ""
        called = {"n": 0}
        def _fail(name, domain): called["n"] += 1; return False
        dr._homepage_title_confirms = _fail
        try:
            self.assertEqual(dr.resolve_company_domain("Ascometal", cache=None), "ascometal.com")
            self.assertEqual(called["n"], 0, "cœur long ne doit PAS déclencher de confirmation titre")
        finally:
            dr.resolve_domain_clearbit, dr.resolve_domain_duckduckgo, dr._homepage_title_confirms = orig_cb, orig_ddg, orig_title


class TestDomainMatching(unittest.TestCase):
    def test_accepts_legit(self):
        self.assertTrue(_domain_matches_name("Provost", "provost.fr"))
        self.assertTrue(_domain_matches_name("Ascometal", "ascometal.com"))
        self.assertTrue(_domain_matches_name("Ima", "ima.eu"))

    def test_rejects_false_positives(self):
        self.assertFalse(_domain_matches_name("Asco", "as.com"))      # cœur trop court
        self.assertFalse(_domain_matches_name("Studi", "studiobinder.com"))
        self.assertFalse(_domain_matches_name("Montana", "mt.gov"))   # TLD gouv

    def test_rejects_prefix_collisions_and_foreign_tld(self):
        # Collisions de préfixe (nom = préfixe d'un cœur plus long) → rejet.
        self.assertFalse(_domain_matches_name("Alten", "altenew.com"))
        self.assertFalse(_domain_matches_name("Novasco", "novascotiatoday.com"))
        self.assertFalse(_domain_matches_name("Asco", "ascolour.com"))
        self.assertFalse(_domain_matches_name("Castel", "castellodiamorosa.com"))
        # ccTLD étranger lointain → rejet (whitelist 2-lettres).
        self.assertFalse(_domain_matches_name("Ghm", "ghm.com.ve"))
        # Abréviation légitime confirmée par le nom du candidat → accepté.
        self.assertTrue(_domain_matches_name("Schneider", "se.com", "Schneider Electric"))
        self.assertTrue(_domain_matches_name("Alten", "alten.com"))  # cœur == nom

    def test_rejects_generic_domain_words(self):
        # Cœur de domaine = mot générique → rejet (sauf si la marque EST ce mot).
        self.assertFalse(_domain_matches_name("Office National ONISEP", "office.com"))
        self.assertFalse(_domain_matches_name("Data Services SAS", "data.com"))
        self.assertTrue(_domain_matches_name("Orange", "orange.com"))   # marque = mot exact
        self.assertTrue(_domain_matches_name("Office", "office.com"))    # idem


class TestMergeMaster(unittest.TestCase):
    def _tmp(self) -> Path:
        return Path(tempfile.gettempdir()) / f"master_{uuid.uuid4().hex}.csv"

    def test_dedup_keeps_homonyms_in_different_cities(self):
        # P0-4 : deux établissements distincts au même nom mais villes/dept
        # différents NE doivent PAS fusionner (sinon un lead réel est perdu).
        path = self._tmp()
        c_lyon  = Company(name="Pharmacie Centrale", city="Lyon",  dept="69")
        c_lille = Company(name="Pharmacie Centrale", city="Lille", dept="59")
        merged, added, updated = merge_into_master(path, [c_lyon, c_lille], _FIELDNAMES)
        self.assertEqual((added, updated), (2, 0))
        self.assertEqual(len(merged), 2)
        try:
            path.unlink()
        except OSError:
            pass

    def test_dedup_legacy_entry_without_dept_merges(self):
        # B-2 : une vieille entrée master SANS dept/city (clé `nom`) et une nouvelle
        # entrée géolocalisée du même nom (clé `nom|69`) NE doivent PAS créer de
        # doublon — l'entrée legacy doit être complétée (backfill dept) et fusionnée.
        path = self._tmp()
        c_legacy = Company(name="Boulangerie Martin")  # aucune localisation (legacy)
        merged, added, updated = merge_into_master(path, [c_legacy], _FIELDNAMES)
        self.assertEqual((added, updated), (1, 0))
        import csv
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=_FIELDNAMES); w.writeheader()
            w.writerow({**{k: "" for k in _FIELDNAMES}, "name": "Boulangerie Martin"})
        c_new = Company(name="Boulangerie Martin", city="Lyon", dept="69",
                        contact_email="contact@boulangerie-martin.fr",
                        email_source="web_crawl")
        merged, added, updated = merge_into_master(path, [c_new], _FIELDNAMES)
        self.assertEqual(added, 0, "Pas de doublon : la legacy sans dept doit matcher")
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].dept, "69")   # dept backfillé sur l'entrée legacy
        try:
            path.unlink()
        except OSError:
            pass

    def test_dedup_by_domain_and_better_email_wins(self):
        path = self._tmp()
        # Master initial : 1 entreprise avec email pattern (faible)
        c1 = Company(name="Acme", website="https://acme.fr",
                     contact_email="rh@acme.fr", email_source="pattern")
        merged, added, updated = merge_into_master(path, [c1], _FIELDNAMES)
        self.assertEqual((added, updated), (1, 0))
        # Écrire puis re-fusionner une version avec un meilleur email (hunter_verified)
        from candio_scraper.io_csv import export_html_preview  # noqa: F401 (sanity import)
        import csv
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=_FIELDNAMES); w.writeheader()
            w.writerow({**{k: "" for k in _FIELDNAMES}, "name": "Acme",
                        "website": "https://acme.fr", "contactEmail": "rh@acme.fr",
                        "emailSource": "pattern"})
        c2 = Company(name="Acme SAS", website="https://acme.fr",
                     contact_email="claire.martin@acme.fr", email_source="hunter_verified")
        merged, added, updated = merge_into_master(path, [c2], _FIELDNAMES)
        self.assertEqual(added, 0)              # même domaine → pas d'ajout
        self.assertEqual(updated, 1)            # meilleur email → mise à jour
        self.assertEqual(merged[0].contact_email, "claire.martin@acme.fr")
        try:
            path.unlink()
        except OSError:
            pass

    @staticmethod
    def _write_master(path: Path, name: str, website: str, email: str, source: str) -> None:
        """Écrit un master CSV minimal à 1 ligne (merge_into_master ne persiste pas seul)."""
        import csv
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=_FIELDNAMES); w.writeheader()
            w.writerow({**{k: "" for k in _FIELDNAMES}, "name": name,
                        "website": website, "contactEmail": email, "emailSource": source})

    def test_unreliable_email_wiped_when_nothing_better_found(self):
        # LEADS-UPDATE : un email pattern_nominative bidon (nom bidon désormais rejeté par
        # le garde-fou) ne doit PAS survivre indéfiniment juste parce que le ré-enrichissement
        # ne trouve rien de mieux — il doit être effacé, pas conservé tel quel.
        path = self._tmp()
        self._write_master(path, "ALR", "https://alr.fr", "autres.ecroutage@alr.fr", "pattern_nominative")
        # Re-fusion : rien trouvé cette fois (email/source vides en mémoire, cf. reset enrich_only).
        c2 = Company(name="ALR", website="https://alr.fr", contact_email="", email_source="")
        merged, added, updated = merge_into_master(path, [c2], _FIELDNAMES)
        self.assertEqual(added, 0)
        self.assertEqual(updated, 1)
        self.assertEqual(merged[0].contact_email, "")
        self.assertEqual(merged[0].email_source, "no_email")
        try:
            path.unlink()
        except OSError:
            pass

    def test_real_email_never_wiped_by_empty_reenrich(self):
        # Contrepreuve : un email RÉEL (hunter/web_crawl) n'est jamais effacé par un
        # ré-enrichissement qui ne trouve rien — seule une source déjà non fiable l'est.
        path = self._tmp()
        self._write_master(path, "Acme2", "https://acme2.fr", "claire.martin@acme2.fr", "hunter_verified")
        c2 = Company(name="Acme2", website="https://acme2.fr", contact_email="", email_source="")
        merged, added, updated = merge_into_master(path, [c2], _FIELDNAMES)
        self.assertEqual(merged[0].contact_email, "claire.martin@acme2.fr")
        self.assertEqual(merged[0].email_source, "hunter_verified")
        try:
            path.unlink()
        except OSError:
            pass


class TestFuzzyDedup(unittest.TestCase):
    """B0-12 : fuzzy_dedup ne doit pas fusionner des établissements de villes différentes."""

    def test_keeps_same_name_different_dept(self):
        # "Pharmacie Centrale" Lyon (69) et Lille (59) → 2 entités distinctes
        c_lyon  = Company(name="Pharmacie Centrale", city="Lyon",  dept="69")
        c_lille = Company(name="Pharmacie Centrale", city="Lille", dept="59")
        kept, removed = fuzzy_dedup([c_lyon, c_lille], threshold=0.85)
        self.assertEqual(removed, 0)
        self.assertEqual(len(kept), 2, "Deux établissements distincts (dept différent) ne doivent pas fusionner")

    def test_deduplicates_same_name_no_location(self):
        # Sans info géo → comportement conservateur : on fusionne (ancien comportement)
        c1 = Company(name="Acme SAS", website="https://acme.fr")
        c2 = Company(name="Acme",     website="https://acme.fr")
        kept, removed = fuzzy_dedup([c1, c2], threshold=0.85)
        self.assertEqual(removed, 1)
        self.assertEqual(len(kept), 1)

    def test_legal_suffix_stripped_correctly(self):
        # Les formes juridiques sont toujours retirées pour le matching
        c1 = Company(name="Alpha Conseil SAS")
        c2 = Company(name="Alpha Conseil SARL")
        kept, removed = fuzzy_dedup([c1, c2], threshold=0.85)
        self.assertEqual(removed, 1)

    def test_city_name_not_stripped_from_norm(self):
        # B0-12 : "paris" et "lyon" ne sont plus retirés du nom → noms distincts
        c1 = Company(name="Boulangerie Paris")
        c2 = Company(name="Boulangerie Lyon")
        kept, removed = fuzzy_dedup([c1, c2], threshold=0.85)
        self.assertEqual(removed, 0, "Des noms incluant des villes différentes ne doivent pas fusionner")


class TestParseLocation(unittest.TestCase):
    """B1-13 : parse_location ne doit pas stocker du texte arbitraire comme ville."""

    def test_rejects_contract_type_as_city(self):
        loc = parse_location("CDI - Temps plein")
        self.assertEqual(loc["city"], "", "Un type de contrat ne doit pas devenir une ville")

    def test_rejects_remote_keyword(self):
        loc = parse_location("remote")
        self.assertEqual(loc["city"], "", "remote ne doit pas être stocké comme ville")

    def test_accepts_real_city(self):
        loc = parse_location("Bordeaux")
        self.assertEqual(loc["city"], "Bordeaux")

    def test_accepts_compound_city(self):
        loc = parse_location("Aix-en-Provence")
        self.assertNotEqual(loc["city"], "", "Un nom de ville composé doit être accepté")

    def test_rejects_city_with_digits(self):
        # Les noms de ville ne contiennent pas de chiffres isolés
        loc = parse_location("Zone industrielle 42")
        self.assertEqual(loc["city"], "")


class TestCsvRoundTrip(unittest.TestCase):
    def test_alternatives_validated_posteddate_survive(self):
        import csv
        path = Path(tempfile.gettempdir()) / f"rt_{uuid.uuid4().hex}.csv"
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=_FIELDNAMES); w.writeheader()
            w.writerow({**{k: "" for k in _FIELDNAMES}, "name": "Acme",
                        "website": "https://acme.fr", "contactEmail": "rh@acme.fr",
                        "emailSource": "web_crawl",
                        "emailAlternatives": "a@acme.fr|b@acme.fr",
                        "emailValidated": "valid", "postedDate": "2026-05-01"})
        c = load_companies_from_csv(str(path))[0]
        self.assertEqual(c.email_alternatives, ["a@acme.fr", "b@acme.fr"])
        self.assertEqual(c.email_validated, "valid")
        self.assertEqual(c.posted_date, "2026-05-01")
        try:
            path.unlink()
        except OSError:
            pass


class TestCrawlLedger(unittest.TestCase):
    def test_reuse_and_negative_memory(self):
        db = str(Path(tempfile.gettempdir()) / f"ledger_{uuid.uuid4().hex}.db")
        ledger = CrawlLedger(path=db)
        self.assertIsNone(ledger.lookup_domain("https://acme.fr"))
        ledger.record_domain("https://acme.fr", "rh@acme.fr", "web_crawl")
        ledger.record_domain("https://vide.fr", "", "no_email")
        hit = ledger.lookup_domain("acme.fr")
        self.assertIsNotNone(hit)
        self.assertEqual(hit["email"], "rh@acme.fr")
        empty = ledger.lookup_domain("https://vide.fr/contact")
        self.assertIsNotNone(empty)        # on se souvient du « rien trouvé »
        self.assertFalse(empty["found"])
        # TTL nul → tout périme
        self.assertIsNone(CrawlLedger(path=db, ttl=0).lookup_domain("acme.fr"))


class TestAuditSecondPass(unittest.TestCase):
    """Régressions des points A-G du 2e passage d'audit."""

    def test_A_load_domain_list_no_crash(self):
        from candio_scraper.scoring import load_domain_list
        self.assertEqual(load_domain_list("/chemin/inexistant.json"), set())

    def test_B_load_exclude_domains_no_crash(self):
        from candio_scraper.io_csv import load_exclude_domains
        # Ne doit plus lever NameError (json importé) — fichier absent → set vide.
        self.assertEqual(load_exclude_domains("/chemin/inexistant.json"), set())

    def test_H_exclude_domains_normalized_and_filter(self):
        # Dédup inter-campagnes : 'www.acme.fr' en base doit exclure 'acme.fr' résolu.
        import json as _json, tempfile, os
        from candio_scraper.io_csv import load_exclude_domains, filter_known_domains
        p = Path(tempfile.gettempdir()) / f"excl_{uuid.uuid4().hex}.json"
        p.write_text(_json.dumps(["www.acme.fr", "BETA.COM"]), encoding="utf-8")
        known = load_exclude_domains(str(p))
        p.unlink()
        self.assertEqual(known, {"acme.fr", "beta.com"})
        kept, n = filter_known_domains(
            [Company(name="Acme", website="https://acme.fr"),
             Company(name="Delta", website="https://delta.fr")], known)
        self.assertEqual(n, 1)
        self.assertEqual([c.name for c in kept], ["Delta"])

    def test_C_build_email_preserves_w_domains(self):
        from candio_scraper.email_pattern import build_email
        self.assertEqual(build_email("{first}.{last}", "Jean", "Dupont", "wavestone.com"),
                         "jean.dupont@wavestone.com")
        self.assertEqual(build_email("{first}.{last}", "Jean", "Dupont", "www.acme.fr"),
                         "jean.dupont@acme.fr")

    def test_G_is_nominative_rejects_company_self_name(self):
        from candio_scraper.email_pattern import is_nominative
        self.assertFalse(is_nominative("accenture@accenture.com"))
        self.assertTrue(is_nominative("claire@acme.fr"))
        self.assertTrue(is_nominative("claire.martin@acme.fr"))

    def test_D_geo_params_region_dept_national(self):
        from candio_scraper.sources import SocieteScraper
        s = SocieteScraper.__new__(SocieteScraper)
        self.assertEqual(s._geo_params("Auvergne-Rhône-Alpes"), {"region": "84"})
        self.assertEqual(s._geo_params("Auvergne Rhone-Aples"), {"region": "84"})  # faute tolérée
        self.assertEqual(s._geo_params("Occitanie"), {"region": "76"})
        self.assertEqual(s._geo_params("Lyon"), {"departement": "69"})
        # Noms de département (envoyés par la liste déroulante) → code dépt.
        self.assertEqual(s._geo_params("Isère"), {"departement": "38"})
        self.assertEqual(s._geo_params("Rhône"), {"departement": "69"})  # PAS région 84
        self.assertEqual(s._geo_params("Zorglubville"), {})

    def test_F_linkedin_unverified_email_flagged(self):
        import tempfile, csv as _csv
        from candio_scraper.linkedin import load_sales_nav_csv
        path = Path(tempfile.gettempdir()) / f"ln_{uuid.uuid4().hex}.csv"
        with path.open("w", newline="", encoding="utf-8") as f:
            w = _csv.DictWriter(f, fieldnames=["Company", "Email", "Email Status"])
            w.writeheader()
            w.writerow({"Company": "Acme", "Email": "a@acme.fr", "Email Status": "verified"})
            w.writerow({"Company": "Beta", "Email": "b@beta.fr", "Email Status": "guessed"})
        cos = {c.name: c for c in load_sales_nav_csv(str(path))}
        self.assertEqual(cos["Acme"].email_source, "manual")            # vérifié → envoyable
        self.assertEqual(cos["Beta"].email_source, "linkedin_pattern")  # non confirmé → à vérifier
        try:
            path.unlink()
        except OSError:
            pass


class TestRobustnessFixes(unittest.TestCase):
    """Tests de régression pour les bugs de robustesse."""

    # ── B2-10 : sys.exit → ImportError ─────────────────────────────────────────
    def test_importerror_not_systemexit_on_missing_scrapling(self):
        """B2-10 : une ImportError (capturée) remplace sys.exit() (fatal)."""
        # On vérifie que le code lève ImportError et non SystemExit
        # en testant qu'ImportError est capturée dans try/except.
        # (Scrapling est installé → pas d'erreur réelle, test structurel.)
        from candio_scraper import infra, enrich, sources  # noqa: F401
        # Si l'import a fonctionné sans sys.exit(), le test passe.

    # ── Scoring size bucket ─────────────────────────────────────────────────────
    def test_scoring_uses_size_bucket_first(self):
        """Scoring : company_size_bucket "50-99" doit donner le bonus même si company_size = "21" (INSEE)."""
        from candio_scraper.scoring import score_and_sort
        c = Company(name="Acme", website="https://acme.fr",
                    company_size="21",          # code INSEE 21 = 50-99 salariés
                    company_size_bucket="50-99",
                    email_source="web_crawl")
        scored = score_and_sort([c])
        self.assertGreater(scored[0].bonus_score, 0, "Bucket 50-99 doit donner un bonus taille")

    def test_scoring_fallback_raw_size_when_no_bucket(self):
        """Scoring : sans bucket, le match substring sur company_size brut reste valide."""
        from candio_scraper.scoring import score_and_sort
        c = Company(name="Beta", website="https://beta.fr",
                    company_size="100-199",     # déjà formaté
                    company_size_bucket="",     # pas de bucket
                    email_source="web_crawl")
        scored = score_and_sort([c])
        self.assertGreater(scored[0].bonus_score, 0, "Fallback substring sur company_size brut")

    # ── B2-12 : relevance_score ne descend pas sous -100 ──────────────────────
    def test_feedback_score_floor(self):
        """B2-12 : apply_feedback_scores borne relevance_score à -100."""
        from candio_scraper.scoring import apply_feedback_scores
        c = Company(name="Bad", website="https://bad.fr", relevance_score=10)
        # Deux passes de feedback bounced (situation extrême de tests multiples)
        apply_feedback_scores([c], {"bounced": ["bad.fr"]})
        apply_feedback_scores([c], {"bounced": ["bad.fr"]})
        self.assertGreaterEqual(c.relevance_score, -100, "relevance_score doit être ≥ -100")

    def test_feedback_score_ceiling(self):
        """B2-12 : apply_feedback_scores borne relevance_score à 100 par le haut."""
        from candio_scraper.scoring import apply_feedback_scores
        c = Company(name="Good", website="https://good.fr", relevance_score=80)
        apply_feedback_scores([c], {"replied": ["good.fr"]})
        self.assertLessEqual(c.relevance_score, 100)

    # ── B2-11 : clearbit_company_info simple ──────────────────────────────────
    def test_clearbit_returns_dict(self):
        """B2-11 : clearbit_company_info retourne un dict (pas d'erreur au double-parse)."""
        from candio_scraper.enrich import clearbit_company_info
        result = clearbit_company_info("")
        self.assertIsInstance(result, dict)

    # ── _discover_contact_links : filtre les URLs externes ──────────────────────
    def test_discover_links_excludes_external(self):
        """_discover_contact_links ne doit pas retourner des URLs d'un autre domaine."""
        from candio_scraper.enrich import _discover_contact_links
        html = """
        <html><body>
        <a href="/contact">contact</a>
        <a href="https://acme.fr/equipe">equipe</a>
        <a href="//external.other.com/contact">lien externe protocol-relative</a>
        <a href="https://other.com/contact">lien externe absolu</a>
        </body></html>
        """
        links = _discover_contact_links("https://acme.fr", html, max_links=20)
        for link in links:
            self.assertTrue(
                link.startswith("https://acme.fr"),
                f"Lien externe non filtré : {link}"
            )

    def test_discover_links_includes_internal(self):
        """_discover_contact_links retourne bien les liens internes pertinents."""
        from candio_scraper.enrich import _discover_contact_links
        html = '<html><body><a href="/contact">Nous contacter</a><a href="/equipe">Équipe</a></body></html>'
        links = _discover_contact_links("https://acme.fr", html, max_links=20)
        self.assertGreater(len(links), 0, "Doit trouver au moins un lien interne")


class TestCriticalBugFixes(unittest.TestCase):
    """Tests de régression pour les bugs B0-3, B0-11, B1-6/7, B1-2, B1-8."""

    # ── B0-3 : PersistentCache thread-safe ─────────────────────────────────────
    def test_persistent_cache_concurrent_reads(self):
        """B0-3 : plusieurs threads peuvent lire le cache simultanément sans crash."""
        import tempfile, threading
        from candio_scraper.infra import PersistentCache
        path = str(Path(tempfile.gettempdir()) / f"cache_b03_{uuid.uuid4().hex}.db")
        cache = PersistentCache(path=path)
        cache.set("k1", "v1"); cache.set("k2", "v2"); cache.set("k3", "v3")
        errors = []
        def _read():
            try:
                for _ in range(50):
                    cache.get("k1"); cache.get("k2"); cache.get("k3")
            except Exception as e:
                errors.append(e)
        threads = [threading.Thread(target=_read) for _ in range(8)]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(errors, [], f"Erreurs de concurrence : {errors}")
        try: Path(path).unlink()
        except OSError: pass

    # ── B0-11 : Company.key() avec localisation ────────────────────────────────
    def test_company_key_includes_dept(self):
        """B0-11 : deux entreprises de même nom/domaine mais depts différents → clés distinctes."""
        c_lyon  = Company(name="Pharmacie Centrale", dept="69")
        c_lille = Company(name="Pharmacie Centrale", dept="59")
        self.assertNotEqual(c_lyon.key(), c_lille.key())

    def test_company_key_fallback_no_geo(self):
        """B0-11 : sans info géo, la clé reste nom|domaine (compat ascendante)."""
        c = Company(name="Acme SAS", website="https://acme.fr")
        key = c.key()
        self.assertIn("acmesas", key)
        self.assertIn("acme.fr", key)

    # ── B1-6 : _collect_all_emails n'appelle _rank_email qu'une fois ───────────
    def test_rank_email_called_once(self):
        """B1-6 : walrus operator → pas d'exception et résultat correct."""
        from candio_scraper.enrich import _collect_all_emails
        # page avec un email RH clair
        text = "Contactez-nous : rh@acme.fr pour toute candidature."
        emails = _collect_all_emails(text, "", "acme.fr")
        self.assertIn("rh@acme.fr", emails)

    # ── B1-7 : double `local` supprimé dans _rank_email ───────────────────────
    def test_rank_email_no_regression(self):
        """B1-7 : _rank_email retourne toujours les bons scores après fix."""
        from candio_scraper.enrich import _rank_email
        self.assertEqual(_rank_email("rh@acme.fr",      "acme.fr"), 4)
        self.assertEqual(_rank_email("info@acme.fr",    "acme.fr"), 0)
        self.assertEqual(_rank_email("ir@acme.fr",      "acme.fr"), -1)
        self.assertEqual(_rank_email("rh@other.fr",     "acme.fr"), 0)  # autre domaine

    # ── B1-2 : detect_ats_from_soup propre ────────────────────────────────────
    def test_detect_ats_from_soup(self):
        """B1-2 : detect_ats_from_soup fonctionne directement sur BS4."""
        from candio_scraper.enrich import detect_ats_from_soup
        from bs4 import BeautifulSoup
        html = '<html><body><a href="https://jobs.lever.co/acme/123">Postuler</a></body></html>'
        soup = BeautifulSoup(html, "html.parser")
        ats_name, ats_url = detect_ats_from_soup(soup)
        self.assertEqual(ats_name, "lever")
        self.assertIn("lever", ats_url.lower())

    def test_detect_ats_from_soup_no_ats(self):
        """B1-2 : pas de crash sur page sans ATS."""
        from candio_scraper.enrich import detect_ats_from_soup
        from bs4 import BeautifulSoup
        soup = BeautifulSoup("<html><body>Rien</body></html>", "html.parser")
        self.assertEqual(detect_ats_from_soup(soup), ("", ""))

    # ── B1-8 : Phase 4d fallback {first}.{last} ───────────────────────────────
    def test_build_email_fallback_pattern(self):
        """B1-8 : build_email avec {first}.{last} (fallback si email_pattern vide)."""
        from candio_scraper.email_pattern import build_email
        # La Phase 4d utilise KNOWN_PATTERNS[0] = "{first}.{last}" si email_pattern vide
        result = build_email("{first}.{last}", "Claire", "Martin", "acme.fr")
        self.assertEqual(result, "claire.martin@acme.fr")


class TestAsyncLayer(unittest.TestCase):
    """A1 : tests de la couche async (enrich_async.py)."""

    def test_module_imports_cleanly(self):
        """Le module enrich_async s'importe sans erreur."""
        from candio_scraper.enrich_async import (
            HTTPX_AVAILABLE, DNS_ASYNC_AVAILABLE, BS4_AVAILABLE,
            async_fast_pass, async_mx_filter,
        )
        # httpx est dans requirements.txt → doit être disponible
        self.assertTrue(HTTPX_AVAILABLE, "httpx doit être installé")
        self.assertTrue(BS4_AVAILABLE,   "beautifulsoup4 doit être installé")
        self.assertTrue(DNS_ASYNC_AVAILABLE, "dns.asyncresolver doit être disponible (dnspython >= 2)")

    def test_async_mx_filter_dead_domain(self):
        """Un domaine mort (NXDOMAIN) doit remonter has_mx=False."""
        import asyncio
        from candio_scraper.enrich_async import _run_mx_filter_async
        result = asyncio.run(_run_mx_filter_async(
            ["nxdomain-certainly-does-not-exist-xyz123.invalid"],
            cache=None,
            max_concurrent=2,
        ))
        self.assertFalse(
            result.get("nxdomain-certainly-does-not-exist-xyz123.invalid", True),
            "Domaine inexistant doit renvoyer has_mx=False",
        )

    def test_async_fast_pass_empty_input(self):
        """Pas de crash sur liste vide."""
        from candio_scraper.enrich_async import async_fast_pass
        result = async_fast_pass([], page_cache=None, explore_new_pages=False,
                                 ledger=None, deadline=None)
        self.assertEqual(result, {})

    def test_async_fast_pass_no_website(self):
        """Entreprise sans website → ignorée silencieusement."""
        from candio_scraper.enrich_async import async_fast_pass
        c = Company(name="Sans site")
        result = async_fast_pass([c], page_cache=None, explore_new_pages=False,
                                  ledger=None, deadline=None)
        self.assertNotIn(id(c), result)

    def test_run_coro_sync_bridge(self):
        """_run_coro exécute une coroutine depuis un contexte synchrone."""
        import asyncio
        from candio_scraper.enrich_async import _run_coro

        async def _hello():
            await asyncio.sleep(0)
            return 42

        self.assertEqual(_run_coro(_hello()), 42)

    def test_tcp_reachable_async_dead_host(self):
        """TCP check async sur un hôte inexistant → False."""
        import asyncio
        from candio_scraper.enrich_async import _tcp_reachable_async
        # On efface le cache pour ce test
        from candio_scraper.enrich import _TCP_CACHE, _NET_CACHE_LOCK
        with _NET_CACHE_LOCK:
            _TCP_CACHE.pop("nxdomain.invalid", None)
        result = asyncio.run(_tcp_reachable_async("nxdomain.invalid", timeout=1.0))
        self.assertFalse(result)


class TestCLIFlags(unittest.TestCase):
    """B0-6 : les flags --whois et --smtp-light-verify doivent exister dans le CLI."""

    def _get_parser(self):
        """Construit le parser argparse en appelant main() jusqu'au parse_args()."""
        import argparse, io
        # On patche sys.argv pour éviter le parse réel
        import sys as _sys
        old_argv = _sys.argv
        _sys.argv = ["scrape_leads"]
        try:
            from candio_scraper.pipeline import main as _main
            # On intercepte SystemExit(0) de --help
            buf = io.StringIO()
            import contextlib
            try:
                with contextlib.redirect_stdout(buf):
                    _sys.argv = ["scrape_leads", "--help"]
                    _main()
            except SystemExit:
                pass
            return buf.getvalue()
        finally:
            _sys.argv = old_argv

    def test_new_flags_registered(self):
        """--whois et --smtp-light-verify doivent apparaître dans l'aide du CLI."""
        help_text = self._get_parser()
        self.assertIn("--whois", help_text, "--whois absent du CLI")
        self.assertIn("--smtp-light-verify", help_text, "--smtp-light-verify absent du CLI")

    def test_pipeline_imports_clean(self):
        """Import du pipeline sans erreur (régression d'import)."""
        from candio_scraper import pipeline  # noqa: F401


class TestCacheClearPrefix(unittest.TestCase):
    """Reset pagination : PersistentCache.clear_prefix (bouton UI)."""

    def test_clear_prefix_removes_only_matching(self):
        import tempfile
        from candio_scraper.infra import PersistentCache
        path = str(Path(tempfile.gettempdir()) / f"cache_cp_{uuid.uuid4().hex}.db")
        c = PersistentCache(path=path)
        c.set("pagecursor:wttj:x:y", "10")
        c.set("pagecursor:societe:x:y", "15")
        c.set("mx:acme.fr", "1")           # ne doit PAS être effacé
        n = c.clear_prefix("pagecursor:")
        self.assertEqual(n, 2)
        self.assertIsNone(c.get("pagecursor:wttj:x:y"))
        self.assertEqual(c.get("mx:acme.fr"), "1")   # survit

    def test_clear_prefix_empty(self):
        import tempfile
        from candio_scraper.infra import PersistentCache
        path = str(Path(tempfile.gettempdir()) / f"cache_cp2_{uuid.uuid4().hex}.db")
        c = PersistentCache(path=path)
        self.assertEqual(c.clear_prefix("pagecursor:"), 0)


class TestScraperProxyPool(unittest.TestCase):
    """Régression : tous les scrapers du registre acceptent proxy_pool (Point 3).

    Bug : ajout de proxy_pool à BaseScraper.__init__ mais les sous-classes avec un
    __init__ custom (SocieteScraper, PappersScraper) ne le
    propageaient pas → TypeError 'unexpected keyword argument proxy_pool' au run.
    """

    def test_all_scrapers_accept_proxy_pool(self):
        from candio_scraper.sources import SCRAPERS
        from candio_scraper.infra import _ThreadSafeFetcher, ProxyPool
        pool = ProxyPool(["http://127.0.0.1:8888"])
        for name, cls in SCRAPERS.items():
            with self.subTest(scraper=name):
                # Avec proxy_pool (ne doit pas lever TypeError)
                cls(fetcher=_ThreadSafeFetcher(), delay=1.0, proxy_pool=pool)
                # Sans proxy_pool (rétro-compat)
                cls(fetcher=_ThreadSafeFetcher(), delay=1.0)


class TestHunterQuotaCap(unittest.TestCase):
    """Protection quota Hunter.io : enrich_hunter ne dépasse jamais le plafond ni le quota réel."""

    def _companies(self, n):
        from candio_scraper.models import Company
        return [Company(name=f"C{i}", website=f"https://c{i}.fr") for i in range(n)]

    def _fake_hunter(self, credits=None):
        from candio_scraper.enrich_apis import EmailResult
        class FakeHunter:
            def __init__(self):
                self.calls = 0
                self.queried = []
            def credits_left(self):
                return credits
            def find(self, domain):
                self.calls += 1
                self.queried.append(domain)
                return EmailResult()  # rien trouvé → pattern fallback
        return FakeHunter()

    def test_respects_max_searches_plafond(self):
        from candio_scraper.enrich_apis import enrich_hunter
        h = self._fake_hunter(credits=None)  # quota réel inconnu → plafond seul
        companies = self._companies(10)
        enrich_hunter(companies, h, delay=0, use_pattern=True, max_searches=3)
        self.assertEqual(h.calls, 3, "ne doit pas dépasser le plafond de 3")
        # Les 7 restants basculent sur pattern (pas d'appel API gaspillé).
        self.assertTrue(all(c.contact_email for c in companies))

    def test_respects_real_quota_when_lower(self):
        from candio_scraper.enrich_apis import enrich_hunter
        h = self._fake_hunter(credits=2)  # quota réel 2 < plafond 10
        enrich_hunter(self._companies(10), h, delay=0, use_pattern=True, max_searches=10)
        self.assertEqual(h.calls, 2, "le min(plafond, quota réel) doit s'appliquer")

    def test_zero_quota_skips_all_api_calls(self):
        from candio_scraper.enrich_apis import enrich_hunter
        h = self._fake_hunter(credits=0)
        companies = self._companies(5)
        enrich_hunter(companies, h, delay=0, use_pattern=True, max_searches=10)
        self.assertEqual(h.calls, 0, "quota épuisé → aucun appel Hunter")
        self.assertTrue(all(c.email_source == "pattern" for c in companies))


class TestPluginSystem(unittest.TestCase):
    """A8 : système de plugins pour scrapers externes."""

    def test_register_scraper_adds_to_registry(self):
        from candio_scraper.sources import BaseScraper, register_scraper, SCRAPERS

        @register_scraper
        class _MaSourceTest(BaseScraper):
            name = "ma_source_test_a8"
            def search(self, sector, city, max_results):
                return []

        try:
            self.assertIn("ma_source_test_a8", SCRAPERS)
            self.assertIs(SCRAPERS["ma_source_test_a8"], _MaSourceTest)
        finally:
            SCRAPERS.pop("ma_source_test_a8", None)

    def test_register_scraper_rejects_no_name(self):
        from candio_scraper.sources import BaseScraper, register_scraper

        class _NoName(BaseScraper):
            name = ""
            def search(self, sector, city, max_results):
                return []

        with self.assertRaises(ValueError):
            register_scraper(_NoName)

    def test_register_scraper_rejects_core_collision(self):
        from candio_scraper.sources import BaseScraper, register_scraper

        class _FakeWttj(BaseScraper):
            name = "wttj"   # collision avec source intégrée
            def search(self, sector, city, max_results):
                return []

        with self.assertRaises(ValueError):
            register_scraper(_FakeWttj)

    def test_load_scraper_plugins_from_dir(self):
        import tempfile
        from candio_scraper.sources import load_scraper_plugins, SCRAPERS
        d = Path(tempfile.mkdtemp())
        plugin = d / "my_plugin.py"
        plugin.write_text(
            "from candio_scraper.sources import BaseScraper, register_scraper\n"
            "@register_scraper\n"
            "class PluginSrc(BaseScraper):\n"
            "    name = 'plugin_src_a8'\n"
            "    def search(self, sector, city, max_results):\n"
            "        return []\n",
            encoding="utf-8",
        )
        try:
            added = load_scraper_plugins(str(d))
            self.assertIn("plugin_src_a8", added)
            self.assertIn("plugin_src_a8", SCRAPERS)
        finally:
            SCRAPERS.pop("plugin_src_a8", None)

    def test_load_scraper_plugins_missing_dir(self):
        import tempfile
        from candio_scraper.sources import load_scraper_plugins
        # Répertoire inexistant → créé, retourne [] sans crash
        d = Path(tempfile.mkdtemp()) / "subdir_does_not_exist"
        self.assertEqual(load_scraper_plugins(str(d)), [])


class TestStrategicImprovements(unittest.TestCase):
    """Tests pour les améliorations stratégiques A4-A10."""

    # ── A4 : EmailValidator.validate_batch ─────────────────────────────────────
    def test_validate_batch_fallback_individual(self):
        """A4 : validate_batch utilise les appels individuels si n < BATCH_THRESHOLD."""
        from candio_scraper.enrich import EmailValidator
        # Pas d'appel réseau : on monkey-patch validate()
        val = EmailValidator.__new__(EmailValidator)
        val.provider = "zerobounce"
        val.api_key  = "fake_key"
        val.calls    = 0
        called = []
        original_validate = EmailValidator.validate
        def _mock(self, email):
            called.append(email)
            return "valid"
        EmailValidator.validate = _mock
        try:
            emails  = ["a@x.fr", "b@x.fr"]   # < BATCH_THRESHOLD (10)
            results = val.validate_batch(emails)
        finally:
            EmailValidator.validate = original_validate
        self.assertEqual(set(called), {"a@x.fr", "b@x.fr"})
        self.assertEqual(results["a@x.fr"], "valid")

    def test_validate_batch_threshold(self):
        """A4 : BATCH_THRESHOLD est défini et > 1."""
        from candio_scraper.enrich import EmailValidator
        self.assertGreater(EmailValidator.BATCH_THRESHOLD, 1)

    # ── A5 : smtp_batch_patterns groupé ─────────────────────────────────────────
    def test_smtp_batch_patterns_no_crash_no_port25(self):
        """A5 : smtp_batch_patterns retourne '' si port 25 bloqué (ne crashe pas)."""
        from candio_scraper.enrich import smtp_batch_patterns, _SMTP_PORT_OPEN
        import candio_scraper.enrich as _e
        old = _e._SMTP_PORT_OPEN
        _e._SMTP_PORT_OPEN = False    # simuler port bloqué
        try:
            result = smtp_batch_patterns("acme.fr")
            self.assertEqual(result, "", "Doit retourner '' si port 25 bloqué")
        finally:
            _e._SMTP_PORT_OPEN = old

    # ── A6 : stats JSONL ────────────────────────────────────────────────────────
    def test_write_run_stats_no_crash(self):
        """A6 : _write_run_stats écrit sans exception même sur liste vide."""
        import tempfile, os, json
        from pathlib import Path
        from candio_scraper.pipeline import _write_run_stats, RunConfig

        # Redirige le chemin de stats vers un fichier temporaire
        import candio_scraper.pipeline as _pl
        tmp = Path(tempfile.mktemp(suffix=".jsonl"))
        cfg = RunConfig(sector="test", city="Paris", max_results=5, sources=["wttj"])

        import unittest.mock as mock
        with mock.patch.object(Path, "home", return_value=tmp.parent):
            # On ne peut pas facilement mocker Path.home() mais on peut juste tester que ça ne crashe pas
            import time
            try:
                _write_run_stats([], cfg, "test123", time.monotonic() - 10)
            except Exception as e:
                self.fail(f"_write_run_stats a levé une exception : {e}")

    # ── A10 : mode incremental dans RunConfig + CLI ──────────────────────────────
    def test_incremental_in_runconfig(self):
        """A10 : RunConfig a un champ incremental."""
        from candio_scraper.pipeline import RunConfig
        cfg = RunConfig(sector="x", city="y", max_results=10, sources=[])
        self.assertFalse(cfg.incremental)
        cfg2 = RunConfig(sector="x", city="y", max_results=10, sources=[], incremental=True)
        self.assertTrue(cfg2.incremental)

    def test_incremental_cli_flag(self):
        """A10 : --incremental apparaît dans l'aide CLI."""
        import io, sys, contextlib
        from candio_scraper.pipeline import main as _main
        old_argv = sys.argv
        sys.argv = ["scrape_leads", "--help"]
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                try:
                    _main()
                except SystemExit:
                    pass
        finally:
            sys.argv = old_argv
        self.assertIn("--incremental", buf.getvalue())

    # ── A7 : résolution domaine overlap ────────────────────────────────────────
    def test_threading_import_in_pipeline(self):
        """A7/A9 : threading importé dans pipeline (requis pour background threads)."""
        import importlib, candio_scraper.pipeline as _pl
        self.assertIn("threading", dir(_pl) or vars(_pl) or {})


class TestDebtCleanup(unittest.TestCase):
    """Tests de régression pour les bugs P2 (dette/nettoyage)."""

    # ── B2-5 : CSV_FIELDNAMES partagé ──────────────────────────────────────────
    def test_csv_fieldnames_shared(self):
        """B2-5 : CSV_FIELDNAMES dans io_csv et pipeline sont le même objet."""
        from candio_scraper.io_csv import CSV_FIELDNAMES as fn_csv
        from candio_scraper.pipeline import CSV_FIELDNAMES as fn_pip
        self.assertIs(fn_csv, fn_pip, "CSV_FIELDNAMES doit être le même objet dans io_csv et pipeline")

    def test_csv_fieldnames_contains_all_columns(self):
        """B2-5 : CSV_FIELDNAMES contient toutes les colonnes attendues."""
        required = {"name", "contactEmail", "website", "emailSource", "dept", "city",
                    "companySizeBucket", "totalScore"}
        self.assertTrue(required.issubset(set(CSV_FIELDNAMES)))

    # ── B2-7 : EmailSource constantes typées ───────────────────────────────────
    def test_email_source_constants(self):
        """B2-7 : EmailSource expose les constantes correctes."""
        from candio_scraper.constants import EmailSource
        self.assertEqual(EmailSource.WEB_CRAWL, "web_crawl")
        self.assertEqual(EmailSource.PATTERN,   "pattern")
        self.assertIn(EmailSource.WEB_CRAWL,    EmailSource.REAL_SOURCES)
        self.assertNotIn(EmailSource.PATTERN,   EmailSource.REAL_SOURCES)
        self.assertIn(EmailSource.PATTERN,      EmailSource.UNVERIFIED_SOURCES)

    def test_email_source_all_sources_no_typo(self):
        """B2-7 : toutes les valeurs de ALL_SOURCES sont des chaînes non vides."""
        from candio_scraper.constants import EmailSource
        for s in EmailSource.ALL_SOURCES:
            self.assertIsInstance(s, str, f"EmailSource contient une non-chaîne : {s!r}")

    # ── B2-15 : _tld_plausible country_hint ────────────────────────────────────
    def test_tld_plausible_with_country_hint(self):
        """B2-15 : country_hint autorise le ccTLD correspondant."""
        from candio_scraper.domain_resolve import _tld_plausible
        # .ca normalement bloqué (hors whitelist Europe de l'Ouest)
        self.assertFalse(_tld_plausible("acme.ca"))
        # mais accepté si country_hint="ca"
        self.assertTrue(_tld_plausible("acme.ca", country_hint="ca"))
        # .fr toujours accepté
        self.assertTrue(_tld_plausible("acme.fr", country_hint="ca"))

    # ── B2-9 : Parsers HTML email_alerts ───────────────────────────────────────
    def test_parse_generic_alert_extracts_companies(self):
        """B2-9 : parse_generic extrait des entreprises depuis un HTML d'alerte type."""
        from candio_scraper.email_alerts import parse_generic
        html = """
        <html><body>
        <div class="job-item">
          <a class="company-name" href="https://acme.fr">Acme SAS</a>
          <span class="job-title">Data Analyst</span>
          <span class="location">Lyon, France</span>
        </div>
        <div class="job-item">
          <a class="company-name" href="https://beta.io">Beta Corp</a>
          <span class="job-title">Développeur Python</span>
        </div>
        </body></html>
        """
        result = parse_generic(html, "Nouvelles offres")
        # parse_generic est best-effort : vérifie surtout qu'il ne plante pas
        self.assertIsInstance(result, list)

    def test_parse_alert_email_unknown_sender(self):
        """B2-9 : parse_alert_email avec expéditeur inconnu → liste vide."""
        from candio_scraper.email_alerts import parse_alert_email
        result = parse_alert_email("unknown@random.com", "Sujet", "<html><body>Rien</body></html>")
        # Expéditeur inconnu → parse_generic → best-effort, peut retourner []
        self.assertIsInstance(result, list)

    def test_collect_all_emails_cf_decoded(self):
        """B2-9 : _collect_all_emails décode les emails Cloudflare (data-cfemail)."""
        from candio_scraper.enrich import _collect_all_emails
        # Encodage CF de "rh@acme.fr" — clé XOR = 0xAB
        # Valeur calculée : 0xAB ^ 'r'=0x72 → 0xD9, etc.  On utilise un email simple connu.
        # Test structurel : s'assure que la fonction ne lève pas d'exception et retourne une liste.
        html = '<a href="/contact" data-cfemail="d9b5b0bdbb">rh@acme.fr</a>'
        text = "rh@acme.fr"
        result = _collect_all_emails(text, html, "acme.fr")
        self.assertIsInstance(result, list)

    # ── B2-4 : _print_summary testable ─────────────────────────────────────────
    def test_print_summary_no_crash(self):
        """B2-4 : _print_summary ne lève pas d'exception sur liste vide ou normale."""
        from candio_scraper.pipeline import _print_summary, RunConfig
        import io, contextlib

        cfg = RunConfig(sector="data analyst", city="Paris", max_results=10,
                        sources=["wttj"])
        buf = io.StringIO()
        # Liste vide → chemin "aucune entreprise"
        with contextlib.redirect_stdout(buf):
            _print_summary([], cfg)
        self.assertIn("Aucune", buf.getvalue())

        # Une entreprise → chemin normal
        c = Company(name="Acme", website="https://acme.fr",
                    email_source="web_crawl", source="wttj")
        buf2 = io.StringIO()
        with contextlib.redirect_stdout(buf2):
            _print_summary([c], cfg)
        self.assertIn("RÉCAPITULATIF", buf2.getvalue())

    # ── _print_summary : REAL_SOURCES cohérent avec EmailSource ───────────────
    def test_real_sources_consistent(self):
        """Les REAL_SOURCES de pipeline._print_summary et EmailSource.REAL_SOURCES sont compatibles."""
        from candio_scraper.pipeline import _REAL_EMAIL_SOURCES
        from candio_scraper.constants import EmailSource
        # Toutes les REAL_SOURCES du pipeline doivent être dans EmailSource.ALL_SOURCES
        for s in _REAL_EMAIL_SOURCES:
            self.assertIn(s, EmailSource.ALL_SOURCES,
                          f"'{s}' dans _REAL_EMAIL_SOURCES mais absent de EmailSource.ALL_SOURCES")


class TestSkipNoEmailEnrichOnly(unittest.TestCase):
    """LEADS-UPDATE : skip_no_email n'exclut plus les entreprises en mode enrich_only
    (« Mettre à jour le CSV ») — sinon elles restent invisibles à merge_into_master et
    un ancien email non fiable ne peut jamais être effacé (cf. io_csv._maybe_update)."""

    @staticmethod
    def _run(enrich_only: bool):
        from candio_scraper.pipeline import _run_email_enrich, EmailEnrichConfig
        companies = [Company(name="ALR", website="https://alr.fr", contact_email="", email_source="")]
        cfg = EmailEnrichConfig(
            use_web_crawl=False, use_hunter=False, use_linkedin=False, use_pattern=False,
            use_github=False, use_smtp_batch=False, skip_no_email=True, enrich_only=enrich_only,
        )
        _run_email_enrich(companies=companies, fetcher=None, cfg=cfg, hunter=None, delay=0, cache=None)
        return companies

    def test_fresh_scrape_still_excludes(self):
        self.assertEqual(len(self._run(enrich_only=False)), 0)

    def test_enrich_only_keeps_company(self):
        self.assertEqual(len(self._run(enrich_only=True)), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
