"""
email_alerts — Source "webhook" : transforme les emails d'alerte emploi en leads.

Principe : au lieu de scraper les job boards (fragile, bloqué par Cloudflare), on
laisse les sites ENVOYER les nouvelles offres par email (alertes que l'utilisateur
configure sur WTTJ, Indeed, APEC, LinkedIn, HelloWork…). Ce module :

  1. Se connecte à la boîte mail via IMAP (creds fournis par Carreer-ops).
  2. Récupère les emails d'alerte récents (filtre par expéditeur connu).
  3. Parse chaque email selon son format → extrait (entreprise, poste, lieu, url).
  4. Retourne des Company prêts à passer dans le pipeline d'enrichissement.

Avantages vs scraping web :
  - 10× plus fiable : pas de Cloudflare, pas de SPA, pas de CSS qui change.
  - Légal : on consomme un service officiel (alertes email).
  - Passif : configuré une fois, les leads arrivent tout seuls.

NOTE : les formats d'email varient et évoluent. Les parsers ci-dessous sont
"best-effort" basés sur les structures connues + une extraction générique par liens.
Ils peuvent nécessiter un ajustement avec de vrais échantillons d'emails.
"""

from __future__ import annotations

import email
import email.utils
import imaplib
import re
from datetime import date, timedelta
from email.header import decode_header
from urllib.parse import unquote, urlparse, parse_qs

from .models import Company, _domain

try:
    from bs4 import BeautifulSoup as _BS4
    _BS4_OK = True
except ImportError:
    _BS4 = None
    _BS4_OK = False


# ══════════════════════════════════════════════════════════════════════════════
# EXPÉDITEURS D'ALERTES CONNUS
# ══════════════════════════════════════════════════════════════════════════════

# Map fragment d'adresse expéditeur → identifiant de parser.
# On matche par sous-chaîne (insensible à la casse) sur l'adresse From.
ALERT_SENDERS: dict[str, str] = {
    "welcometothejungle.com": "wttj",
    "indeed.com":             "indeed",
    "apec.fr":                "apec",
    "linkedin.com":           "linkedin",
    "hellowork.com":          "hellowork",
    "cadremploi.fr":          "cadremploi",
    "monster.fr":             "monster",
    "glassdoor":              "glassdoor",
}


def _identify_sender(from_addr: str) -> str:
    """Retourne l'identifiant de parser pour une adresse expéditeur, ou '' si inconnu."""
    low = (from_addr or "").lower()
    for fragment, parser_id in ALERT_SENDERS.items():
        if fragment in low:
            return parser_id
    return ""


# ══════════════════════════════════════════════════════════════════════════════
# UTILITAIRES DE PARSING
# ══════════════════════════════════════════════════════════════════════════════

def _decode_mime_header(raw: str) -> str:
    """Décode un header MIME encodé (=?UTF-8?...?=) en texte lisible."""
    if not raw:
        return ""
    parts = decode_header(raw)
    out = []
    for txt, enc in parts:
        if isinstance(txt, bytes):
            try:
                out.append(txt.decode(enc or "utf-8", errors="replace"))
            except Exception:
                out.append(txt.decode("utf-8", errors="replace"))
        else:
            out.append(txt)
    return "".join(out)


def _get_html_body(msg: email.message.Message) -> str:
    """Extrait le corps HTML (ou texte) d'un message email."""
    html = ""
    text = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if "attachment" in disp:
                continue
            try:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
            except Exception:
                continue
            if ctype == "text/html":
                html += decoded
            elif ctype == "text/plain":
                text += decoded
    else:
        try:
            payload = msg.get_payload(decode=True)
            charset = msg.get_content_charset() or "utf-8"
            decoded = payload.decode(charset, errors="replace") if payload else ""
        except Exception:
            decoded = ""
        if msg.get_content_type() == "text/html":
            html = decoded
        else:
            text = decoded
    return html or text


def _clean_company_name(name: str) -> str:
    """Nettoie un nom d'entreprise extrait (espaces, mentions parasites)."""
    name = re.sub(r"\s+", " ", (name or "").strip())
    # Retire les suffixes parasites courants des alertes
    name = re.sub(r"\s*[-–|]\s*(offre|emploi|recrute|jobs?|recrutement).*$", "", name, flags=re.I)
    return name.strip(" -–|·•")


# ══════════════════════════════════════════════════════════════════════════════
# PARSERS PAR EXPÉDITEUR
# ══════════════════════════════════════════════════════════════════════════════
# Chaque parser retourne une liste de dicts : {name, job_title, location, url}

def _parse_links_generic(html: str, host_filter: str = "") -> list[dict]:
    """
    Parser générique basé sur les liens : extrait les ancres pointant vers des
    pages d'offres/entreprises. Le texte de l'ancre = souvent le titre du poste
    ou le nom de l'entreprise. Filtre par host si fourni.
    """
    if not _BS4_OK or not html:
        return []
    results: list[dict] = []
    seen: set[str] = set()
    soup = _BS4(html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(" ", strip=True)
        if not href.startswith("http") or not text or len(text) < 3:
            continue
        if host_filter and host_filter not in href:
            continue
        # Décoder les redirections (les alertes wrappent souvent les liens)
        real_url = _unwrap_redirect(href)
        key = text.lower()[:60]
        if key in seen:
            continue
        seen.add(key)
        results.append({"name": "", "job_title": text, "location": "", "url": real_url})
    return results


def _unwrap_redirect(url: str) -> str:
    """
    Déballe les liens de tracking/redirection courants des emails d'alerte.
    Ex : indeed.com/rc/clk?...&url=https://realsite → https://realsite
    """
    try:
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        for key in ("url", "u", "uddg", "target", "redirect", "link"):
            if key in qs and qs[key]:
                candidate = unquote(qs[key][0])
                if candidate.startswith("http"):
                    return candidate
    except Exception:
        pass
    return url


def parse_wttj(html: str, subject: str = "") -> list[dict]:
    """
    WTTJ : les alertes listent des offres avec entreprise + poste + lieu.
    Les liens pointent vers welcometothejungle.com/fr/companies/{slug} ou /jobs/.
    """
    if not _BS4_OK or not html:
        return []
    results: list[dict] = []
    seen: set[str] = set()
    soup = _BS4(html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = _unwrap_redirect(a["href"])
        m = re.search(r"welcometothejungle\.com/[a-z]{2}/companies/([a-z0-9\-]+)", href, re.I)
        if not m:
            continue
        slug = m.group(1)
        if slug in seen or slug in ("jobs", "companies"):
            continue
        seen.add(slug)
        # Nom lisible depuis le slug (acme-corp → Acme Corp), affiné par le texte si dispo
        text = a.get_text(" ", strip=True)
        name = _clean_company_name(text) if text and len(text) < 60 else slug.replace("-", " ").title()
        results.append({"name": name, "job_title": "", "location": "", "url": href})
    return results


def parse_linkedin(html: str, subject: str = "") -> list[dict]:
    """
    LinkedIn : alertes "X nouveaux postes". Liens vers linkedin.com/jobs/view/ et
    linkedin.com/company/{slug}. Le nom d'entreprise est dans le texte près du poste.
    """
    if not _BS4_OK or not html:
        return []
    results: list[dict] = []
    seen: set[str] = set()
    soup = _BS4(html, "html.parser")
    # Stratégie : chaque bloc d'offre contient un titre (lien /jobs/view/) et une
    # mention entreprise. On parse les liens /company/ pour le nom.
    for a in soup.find_all("a", href=True):
        href = _unwrap_redirect(a["href"])
        m = re.search(r"linkedin\.com/company/([a-z0-9\-]+)", href, re.I)
        if m:
            slug = m.group(1)
            if slug in seen:
                continue
            seen.add(slug)
            text = a.get_text(" ", strip=True)
            name = _clean_company_name(text) if text and len(text) < 60 else slug.replace("-", " ").title()
            results.append({"name": name, "job_title": "", "location": "", "url": href})
    return results


def parse_indeed(html: str, subject: str = "") -> list[dict]:
    """
    Indeed : alertes avec offres. Le nom d'entreprise apparaît en texte sous le titre.
    Les liens sont des redirections /rc/clk ou /pagead. Parsing surtout par texte.
    """
    if not _BS4_OK or not html:
        return []
    results: list[dict] = []
    seen: set[str] = set()
    soup = _BS4(html, "html.parser")
    # Heuristique : Indeed met le nom d'entreprise dans des <span>/<td> près du titre.
    # On cherche les patterns "Poste - Entreprise - Lieu" dans le texte des cellules.
    for tag in soup.find_all(["td", "div", "span"]):
        txt = tag.get_text(" ", strip=True)
        # Pattern courant : "Data Analyst - Acme Corp - Paris (75)"
        m = re.match(r"^(.{3,60}?)\s*[-–]\s*(.{2,50}?)\s*[-–]\s*(.{2,40})$", txt)
        if m:
            job, comp, loc = m.groups()
            name = _clean_company_name(comp)
            key = name.lower()
            if name and key not in seen and len(name) > 1:
                seen.add(key)
                results.append({"name": name, "job_title": job.strip(),
                                "location": loc.strip(), "url": ""})
    return results


def parse_apec(html: str, subject: str = "") -> list[dict]:
    """APEC : format français. Liens vers apec.fr/candidat/... + nom entreprise en texte."""
    return _parse_links_generic(html, host_filter="apec.fr")


def parse_generic(html: str, subject: str = "") -> list[dict]:
    """Fallback : extraction générique par liens pour tout expéditeur non spécifique."""
    return _parse_links_generic(html)


# Registre des parsers
_PARSERS = {
    "wttj":       parse_wttj,
    "linkedin":   parse_linkedin,
    "indeed":     parse_indeed,
    "apec":       parse_apec,
    "hellowork":  parse_generic,
    "cadremploi": parse_generic,
    "monster":    parse_generic,
    "glassdoor":  parse_generic,
}


def parse_alert_email(from_addr: str, subject: str, html_body: str) -> list[Company]:
    """
    Parse un email d'alerte → liste de Company. Choisit le parser selon l'expéditeur.
    Fonction PURE (pas d'IMAP) → testable avec un échantillon HTML.
    """
    parser_id = _identify_sender(from_addr)
    parser = _PARSERS.get(parser_id, parse_generic)
    raw_listings = parser(html_body, subject)

    companies: list[Company] = []
    seen: set[str] = set()
    for item in raw_listings:
        name = _clean_company_name(item.get("name", ""))
        url  = item.get("url", "")
        # Si pas de nom mais une URL d'entreprise → tenter d'extraire un nom du domaine
        if not name and url:
            dom = _domain(url)
            if dom and "welcometothejungle" not in dom and "linkedin" not in dom and "indeed" not in dom:
                name = dom.split(".")[0].replace("-", " ").title()
        if not name:
            continue
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        if not key or key in seen:
            continue
        seen.add(key)

        # Le website : si l'URL pointe vers le vrai site (pas le job board), on le garde.
        # Sinon vide → la Phase 3b le résoudra (Clearbit/DuckDuckGo).
        website = ""
        if url:
            dom = _domain(url)
            if dom and not any(jb in dom for jb in
                               ("welcometothejungle", "linkedin", "indeed",
                                "apec.fr", "hellowork", "cadremploi", "monster", "glassdoor")):
                website = url

        companies.append(Company(
            name=name,
            website=website,
            activity_domain=item.get("job_title", ""),   # le poste vu dans l'alerte
            region=item.get("location", ""),
            freshness_score=95,                          # alerte = offre très récente
            source=f"email_alert:{parser_id or 'generic'}",
        ))
    return companies


# ══════════════════════════════════════════════════════════════════════════════
# FETCHER IMAP
# ══════════════════════════════════════════════════════════════════════════════

def fetch_alert_emails(
    host: str,
    user: str,
    password: str,
    port: int = 993,
    folder: str = "INBOX",
    since_days: int = 7,
    max_emails: int = 200,
) -> list[Company]:
    """
    Se connecte en IMAP, récupère les emails d'alerte récents des expéditeurs connus,
    les parse et retourne une liste de Company dédupliquée.

    Args :
      host/user/password/port : credentials IMAP (fournis par Carreer-ops)
      folder    : dossier à scanner (INBOX, ou un dossier dédié "Job Alerts")
      since_days: ne lit que les emails des N derniers jours
      max_emails: plafond de sécurité sur le nombre d'emails traités

    Retourne les Company extraites (déduplication globale par nom).
    """
    companies: list[Company] = []
    seen: set[str] = set()

    try:
        M = imaplib.IMAP4_SSL(host, port)
    except Exception as e:
        print(f"   ❌  [email_alerts] connexion IMAP échouée : {e}")
        return []

    try:
        M.login(user, password)
    except Exception as e:
        print(f"   ❌  [email_alerts] login IMAP échoué : {e}")
        try:
            M.logout()
        except Exception:
            pass
        return []

    try:
        M.select(folder, readonly=True)

        since = (date.today() - timedelta(days=since_days)).strftime("%d-%b-%Y")
        typ, data = M.search(None, f'(SINCE {since})')
        if typ != "OK" or not data or not data[0]:
            print(f"   ℹ  [email_alerts] aucun email depuis {since} dans '{folder}'.")
            return []

        ids = data[0].split()
        ids = ids[-max_emails:]  # les plus récents
        print(f"   📬  [email_alerts] {len(ids)} emails à examiner depuis {since}…")

        n_alerts  = 0
        n_empty   = 0   # B2-13 : alertes parsées mais ayant renvoyé 0 entreprise
        for msg_id in ids:
            typ, msg_data = M.fetch(msg_id, "(RFC822)")
            if typ != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw)

            from_addr = _decode_mime_header(msg.get("From", ""))
            parser_id = _identify_sender(from_addr)
            if not parser_id:
                continue  # pas un expéditeur d'alerte connu
            n_alerts += 1

            subject = _decode_mime_header(msg.get("Subject", ""))
            html_body = _get_html_body(msg)
            if not html_body:
                n_empty += 1
                continue

            parsed = parse_alert_email(from_addr, subject, html_body)
            if not parsed:
                # B2-13 : HTML présent mais parser n'a rien extrait → probable
                # changement de template du job board. Signaler pour debug.
                n_empty += 1
                continue
            for c in parsed:
                key = re.sub(r"[^a-z0-9]", "", c.name.lower())
                if key and key not in seen:
                    seen.add(key)
                    companies.append(c)

        print(f"   ✔  [email_alerts] {n_alerts} alertes parsées → {len(companies)} entreprises uniques")
        if n_empty:
            print(f"   ⚠  [email_alerts] {n_empty} alerte(s) sans résultat "
                  f"(template HTML changé ? → vérifier les parsers dans email_alerts.py)")
    except Exception as e:
        print(f"   ⚠  [email_alerts] erreur pendant la lecture : {e}")
    finally:
        try:
            M.close()
            M.logout()
        except Exception:
            pass

    return companies
