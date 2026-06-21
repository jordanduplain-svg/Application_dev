"""
import_spontaneous.py — Reconstruit l'historique des candidatures spontanées
depuis un export Gmail Takeout (.mbox) pour alimenter le ML prédictif de
Carreer-ops.

Contexte (voir [[Module Scraping Carreer-ops]] dans le wiki) :
    L'utilisateur a envoyé des candidatures via la plateforme Kandijobs depuis
    `postmaster@spontaneousapplication.*`. Le mbox Google Takeout contient :
      - les envois outbound (postmaster@ → recruteur@entreprise)
      - les réponses forwardées (postmaster@ → jordan.duplain@…)
      - les réponses directes du recruteur arrivées dans le Gmail perso
      - les échanges suivants où Jordan répond depuis Gmail

    Une "candidature" = toutes les lignes partageant la même entreprise
    (extraite du sujet `Re: Candidature Spontanée - <Entreprise>`).

Usage :
    python tools/import_spontaneous.py ^
        --mbox "C:/.../Takeout/Mail/Personnel.mbox" ^
        --my-personal-email jordan.duplain@gmail.com ^
        --platform-domain spontaneousapplication ^
        --output data/spontaneous_history.csv

Sortie CSV (une ligne par entreprise) :
    name, contactEmail, sentAt, repliedAt, replied, sentiment, role,
    subject, threadMessageId, replySnippet

`name` et `contactEmail` sont les colonnes obligatoires pour réimporter en tant
qu'entreprises dans Carreer-ops. Les autres colonnes constituent le label/feature
"réponse" pour l'entraînement du modèle prédictif.

100 % local, lecture seule, aucune écriture distante. Stdlib uniquement.
"""

from __future__ import annotations

import argparse
import csv
import email
import email.utils
import mailbox
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from email.header import decode_header
from email.message import Message
from pathlib import Path


# ══════════════════════════════════════════════════════════════════════════════
# CLASSIFICATION DE SENTIMENT
# ══════════════════════════════════════════════════════════════════════════════
# Port direct des patterns de apps/desktop/src/tasks/reply-matching.ts —
# garder les deux côtés synchronisés si l'un évolue (recherche
# `_REJECTION_PATTERNS` / `_POSITIVE_PATTERNS` côté TS).
# Priorité : intérêt > refus > neutre.

_REJECTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"ne\s+(?:pas\s+)?donn(?:er|ons|ons pas)\s+suite", re.I),
    re.compile(r"pas\s+donner\s+suite", re.I),
    # Extension Python : couvre les formes conjuguées que la regex TS rate
    # (« donnerons pas suite », « donnera pas suite »...). Si reply-matching.ts
    # est mis à jour pour les couvrir aussi, supprimer ce pattern ici.
    re.compile(r"donn(?:erons|erez|eront|era|erais|erait|erions|eriez|eraient)\s+pas\s+suite", re.I),
    re.compile(r"n['’]?(?:a|avons|ont)\s+pas\s+(?:été\s+)?reten", re.I),
    re.compile(r"candidature\s+.*reten", re.I),
    re.compile(r"ne\s+correspond\s+pas", re.I),
    re.compile(r"pas\s+(?:de\s+)?(?:poste|besoin|opportunit|recrutement)", re.I),
    re.compile(r"ne\s+recrut(?:ons|e)\s+pas", re.I),
    re.compile(r"déclin(?:ons|er)", re.I),
    re.compile(r"pas\s+en\s+mesure", re.I),
    re.compile(r"au\s+regret", re.I),
    re.compile(r"unfortunately", re.I),
    re.compile(r"not\s+(?:moving|proceed|selected|a\s+fit)", re.I),
    re.compile(r"we\s+(?:will|won['’]?t|are\s+not)\s+(?:not\s+)?(?:proceed|moving|hiring)", re.I),
    re.compile(r"no\s+(?:current\s+)?(?:openings?|positions?|vacanc)", re.I),
]

_POSITIVE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"entretien", re.I),
    re.compile(r"rendez[\s-]?vous", re.I),
    re.compile(r"(?:vous\s+)?rencontr(?:er|ons)", re.I),
    re.compile(r"échang(?:er|eons|e)\b", re.I),
    re.compile(r"(?:votre\s+)?profil\s+.*intéress", re.I),
    re.compile(r"intéress(?:é|és|ée|ant)\s+par\s+(?:votre|ton)", re.I),
    re.compile(r"disponibilit", re.I),
    re.compile(r"interview", re.I),
    re.compile(r"(?:happy|glad|like)\s+to\s+(?:meet|chat|discuss)", re.I),
    re.compile(r"next\s+steps?", re.I),
]


def classify_reply_sentiment(text: str | None) -> str:
    """Retourne 'positive', 'rejection' ou 'neutral'. Voir _PATTERNS ci-dessus."""
    if not text:
        return "neutral"
    snippet = text[:4000]  # mêmes 4 ko que côté TS (les 1res lignes portent le verdict)
    if any(p.search(snippet) for p in _POSITIVE_PATTERNS):
        return "positive"
    if any(p.search(snippet) for p in _REJECTION_PATTERNS):
        return "rejection"
    return "neutral"


# ══════════════════════════════════════════════════════════════════════════════
# PARSING SUJETS & EN-TÊTES MIME
# ══════════════════════════════════════════════════════════════════════════════

# « Candidature Spontanée - <Entreprise> [- <Rôle>] » avec préfixes Re/Fwd/Tr/RE/RV
# tolérés et empilés (« Re: TR: Candidature... » observé dans le mbox).
_SUBJECT_RE = re.compile(
    r"^\s*(?:(?:re|fwd|fw|tr|rv)\s*:\s*)*"
    r"(?:\[external\]\s*)?"                        # marqueur Outlook entreprise
    r"candidature\s+spontan(?:é|e)e"
    r"\s*[-–—:]\s*"
    r"(?P<company>.+?)\s*$",
    re.I,
)


def _decode(raw: str | None) -> str:
    """Décode un en-tête MIME (=?utf-8?B?...?=) en str."""
    if not raw:
        return ""
    out = []
    try:
        for chunk, enc in decode_header(raw):
            if isinstance(chunk, bytes):
                try:
                    out.append(chunk.decode(enc or "utf-8", errors="replace"))
                except (LookupError, TypeError):
                    out.append(chunk.decode("utf-8", errors="replace"))
            else:
                out.append(chunk)
    except Exception:
        return str(raw)
    return "".join(out)


def _addr(raw: str) -> str:
    """Extrait l'adresse email pure depuis un en-tête type 'Nom <a@b.fr>'."""
    _, a = email.utils.parseaddr(_decode(raw) or "")
    return a.lower()


def _all_addrs(raw: str) -> list[str]:
    """Liste des adresses dans un en-tête To/Cc multi-destinataires."""
    return [a.lower() for _, a in email.utils.getaddresses([_decode(raw) or ""]) if a]


def _extract_company_role(subject: str) -> tuple[str | None, str | None]:
    """
    Extrait `(entreprise, rôle?)` depuis un sujet « Candidature Spontanée - X [- Y] ».

    Si une 2e séparation `-` existe, la 2e partie est considérée comme un rôle
    (ex: « ENVISOL - Sites et sols pollués » → entreprise=ENVISOL, rôle=Sites…).
    """
    m = _SUBJECT_RE.match(subject)
    if not m:
        return None, None
    rest = m.group("company").strip()
    if " - " in rest:
        company, role = rest.split(" - ", 1)
        return company.strip() or None, role.strip() or None
    return rest or None, None


def _normalize_company(name: str) -> str:
    """Clé de dédup : casse insensible, espaces écrasés, ponctuation finale virée."""
    n = re.sub(r"\s+", " ", name.strip()).rstrip(".,;:!").lower()
    # variations courantes : enlève les suffixes juridiques pour mieux dédupliquer
    n = re.sub(r"\s+(sas|sa|sarl|scop|group|groupe|company|inc|ltd)\b\.?", "", n)
    return n


def _parse_date(raw: str | None) -> datetime:
    """Parse RFC-2822, retombe sur 'maintenant' si invalide."""
    try:
        dt = email.utils.parsedate_to_datetime(raw) if raw else None
    except (TypeError, ValueError):
        dt = None
    if dt is None:
        dt = datetime.now(tz=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _extract_text(msg: Message) -> str:
    """Corps texte. Préfère text/plain, fallback text/html → strip HTML brut."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                disp = str(part.get("Content-Disposition") or "")
                if "attachment" in disp.lower():
                    continue
                payload = part.get_payload(decode=True)
                if payload:
                    return _decode_bytes(payload, part.get_content_charset())
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    return re.sub(r"<[^>]+>", " ",
                                  _decode_bytes(payload, part.get_content_charset()))
        return ""
    payload = msg.get_payload(decode=True)
    if not payload:
        return ""
    text = _decode_bytes(payload, msg.get_content_charset())
    if msg.get_content_type() == "text/html":
        text = re.sub(r"<[^>]+>", " ", text)
    return text


def _decode_bytes(b: bytes, charset: str | None) -> str:
    try:
        return b.decode(charset or "utf-8", errors="replace")
    except (LookupError, TypeError):
        return b.decode("utf-8", errors="replace")


# ══════════════════════════════════════════════════════════════════════════════
# DATACLASSES
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Msg:
    """Un message du mbox, après extraction."""
    company: str               # nom d'entreprise affiché (1re forme rencontrée)
    company_key: str           # clé de dédup normalisée
    role: str | None
    subject: str
    date: datetime
    from_addr: str
    to_addrs: list[str]
    message_id: str
    body: str
    direction: str             # 'outbound_platform' | 'outbound_self' | 'inbound'


@dataclass
class Aggregated:
    """Une candidature (regroupement par entreprise)."""
    name: str
    role: str | None
    contact_email: str
    sent_at: datetime           # date du 1er message
    replied_at: datetime | None = None
    replied: bool = False
    sentiment: str = "no_reply"
    subject: str = ""
    thread_message_id: str = ""
    reply_snippet: str = ""


# ══════════════════════════════════════════════════════════════════════════════
# PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

def classify_direction(from_addr: str, to_addrs: list[str],
                       platform_domain: str, my_personal: str) -> str:
    """
    Décide le rôle du message :
      - outbound_platform : la plateforme Kandijobs envoie au recruteur
      - outbound_self     : Jordan répond depuis son Gmail perso
      - inbound           : tout le reste (= candidat de réponse à scorer)

    `platform_domain` ne doit pas inclure le @ ni le TLD : on cherche cette
    sous-chaîne dans l'adresse.
    """
    if my_personal and from_addr == my_personal.lower():
        return "outbound_self"
    if platform_domain and platform_domain.lower() in from_addr:
        # postmaster@spontaneousapplication.* → soit envoi outbound, soit forward
        # de réponse. Critère : si AU MOINS UN destinataire est extérieur à la
        # plateforme et n'est pas l'utilisateur, c'est un envoi outbound.
        for to in to_addrs:
            if (platform_domain.lower() not in to
                    and (not my_personal or to != my_personal.lower())):
                return "outbound_platform"
        return "inbound"   # forward de réponse vers la boîte plateforme
    return "inbound"


def load_mbox(mbox_path: Path, platform_domain: str, my_personal: str) -> list[Msg]:
    """Lit le mbox et retourne tous les messages reconnaissables comme
    « Candidature Spontanée - X »."""
    mb = mailbox.mbox(str(mbox_path))
    out: list[Msg] = []
    skipped = 0
    for raw in mb:
        subject = _decode(raw.get("Subject"))
        company, role = _extract_company_role(subject)
        if not company:
            skipped += 1
            continue
        from_addr = _addr(raw.get("From") or "")
        to_addrs = _all_addrs(raw.get("To") or "") + _all_addrs(raw.get("Cc") or "")
        msg = Msg(
            company=company,
            company_key=_normalize_company(company),
            role=role,
            subject=subject,
            date=_parse_date(raw.get("Date")),
            from_addr=from_addr,
            to_addrs=to_addrs,
            message_id=(raw.get("Message-ID") or "").strip(),
            body=_extract_text(raw),
            direction=classify_direction(from_addr, to_addrs, platform_domain, my_personal),
        )
        out.append(msg)
    print(f"[mbox] {len(out)} messages 'Candidature Spontanée' reconnus "
          f"({skipped} sujets non pertinents ignorés)", file=sys.stderr)
    return out


def aggregate(messages: list[Msg], platform_domain: str) -> list[Aggregated]:
    """Groupe par entreprise → 1 ligne par candidature."""
    by_key: dict[str, list[Msg]] = {}
    for m in messages:
        by_key.setdefault(m.company_key, []).append(m)

    rows: list[Aggregated] = []
    for key, msgs in by_key.items():
        msgs.sort(key=lambda m: m.date)
        # Forme d'affichage : la version la plus longue rencontrée (heuristique
        # robuste pour récupérer la casse correcte si on a vu « ENVISOL » et
        # « envisol » par exemple).
        display_name = max((m.company for m in msgs), key=len)
        role = next((m.role for m in msgs if m.role), None)

        # contact_email : on cherche d'abord l'adresse du recruteur dans les
        # réponses entrantes (From), puis dans les destinataires d'un envoi
        # outbound de la plateforme.
        contact_email = ""
        for m in msgs:
            if m.direction == "inbound" and platform_domain.lower() not in m.from_addr:
                contact_email = m.from_addr
                break
        if not contact_email:
            for m in msgs:
                if m.direction == "outbound_platform":
                    for to in m.to_addrs:
                        if platform_domain.lower() not in to:
                            contact_email = to
                            break
                    if contact_email:
                        break

        # Vraie réponse = message inbound venant d'un HUMAIN externe (ni
        # plateforme, ni soi-même). On EXCLUT volontairement les forwards
        # postmaster→jordan : ils contiennent le texte de la candidature
        # initiale dans leur corps (« disponibilité », « rencontrer »…) ce qui
        # produirait un faux-positif systématique. Une réponse réelle apparaît
        # toujours en tant que message direct d'un recruteur dans la boîte.
        direct_replies = [m for m in msgs
                          if m.direction == "inbound"
                          and platform_domain.lower() not in m.from_addr]
        replied = bool(direct_replies)
        first_reply = direct_replies[0] if direct_replies else None

        rows.append(Aggregated(
            name=display_name,
            role=role,
            contact_email=contact_email,
            sent_at=msgs[0].date,
            replied_at=first_reply.date if first_reply else None,
            replied=replied,
            sentiment=classify_reply_sentiment(first_reply.body) if first_reply else "no_reply",
            subject=msgs[0].subject,
            thread_message_id=msgs[0].message_id,
            reply_snippet=(re.sub(r"\s+", " ", first_reply.body[:400]).strip()
                           if first_reply else ""),
        ))

    rows.sort(key=lambda r: r.sent_at)
    return rows


def write_csv(rows: list[Aggregated], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "name", "contactEmail", "sentAt", "repliedAt", "replied",
            "sentiment", "role", "subject", "threadMessageId", "replySnippet",
        ])
        for r in rows:
            w.writerow([
                r.name,
                r.contact_email,
                r.sent_at.isoformat(),
                r.replied_at.isoformat() if r.replied_at else "",
                "1" if r.replied else "0",
                r.sentiment,
                r.role or "",
                r.subject,
                r.thread_message_id,
                r.reply_snippet,
            ])


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def main() -> int:
    p = argparse.ArgumentParser(
        description="Reconstruit l'historique des candidatures spontanées depuis "
                    "un export Gmail Takeout (.mbox) vers un CSV pour le ML prédictif.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--mbox", type=Path, required=True,
                   help="Chemin du fichier .mbox (Gmail Takeout → Mail/<Label>.mbox)")
    p.add_argument("--output", type=Path, required=True,
                   help="Chemin du CSV de sortie")
    p.add_argument("--platform-domain", default="spontaneousapplication",
                   help="Fragment du domaine de la plateforme d'envoi "
                        "(défaut: 'spontaneousapplication'). Tout from/to contenant "
                        "ce fragment est considéré comme la plateforme et non un humain.")
    p.add_argument("--my-personal-email", default="",
                   help="Ton adresse Gmail perso (ex: jordan.duplain@gmail.com). "
                        "Les messages que TU as envoyés depuis cette adresse sont "
                        "exclus du calcul de réponse.")
    args = p.parse_args()

    if not args.mbox.is_file():
        print(f"ERREUR : mbox introuvable : {args.mbox}", file=sys.stderr)
        return 2

    messages = load_mbox(args.mbox, args.platform_domain, args.my_personal_email)
    if not messages:
        print("ERREUR : aucun message reconnu. Vérifier le format du sujet "
              "(« Candidature Spontanée - <Entreprise> »).", file=sys.stderr)
        return 1

    rows = aggregate(messages, args.platform_domain)
    write_csv(rows, args.output)

    # Résumé
    n_total = len(rows)
    n_replied = sum(1 for r in rows if r.replied)
    by_sent: dict[str, int] = {}
    for r in rows:
        by_sent[r.sentiment] = by_sent.get(r.sentiment, 0) + 1
    print(f"\n✅ {n_total} entreprise(s) écrite(s) → {args.output}", file=sys.stderr)
    print(f"   {n_replied} réponse(s) reçue(s) ({n_replied / max(n_total, 1) * 100:.0f}%)",
          file=sys.stderr)
    for s, c in sorted(by_sent.items(), key=lambda kv: -kv[1]):
        print(f"   - {s:<10} : {c}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
