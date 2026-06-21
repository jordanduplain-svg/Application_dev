"""
deliverability — Contrôles de délivrabilité email.

Fonctions pures (pas d'I/O côté envoi) pour :
  - Déterminer la politique DMARC d'un domaine destinataire.
  - Détecter un SPF strict côté expéditeur.

Utilisé par :
  - SMTP light-validation (enrich.py) : skip si le domaine a p=reject
    (la sonde EHLO sera bloquée par la plupart des serveurs DMARC strict).
  - Phase 5 Hunter : avertit si on injecte des emails sur domaine strict.
  - Mailer TS (via IPC) : vérifie le domaine expéditeur au test SMTP.

Pas de dépendance optionnelle : utilise uniquement dnspython (déjà requis
pour le filtre MX) et le module stdlib `re`.
"""

from __future__ import annotations

import re
from typing import Literal

DmarcPolicy = Literal["none", "quarantine", "reject", "unknown"]

# Cache en mémoire simple (pas de PersistentCache ici — TTL de session suffit).
_dmarc_cache: dict[str, DmarcPolicy] = {}
_spf_cache:   dict[str, bool] = {}       # True = domaine a un SPF valide


def _txt_records(domain: str) -> list[str]:
    """Résout les enregistrements TXT d'un domaine (synchrone, stdlib)."""
    try:
        import dns.resolver
        answers = dns.resolver.resolve(domain, "TXT", lifetime=5)
        return [b"".join(rdata.strings).decode("utf-8", errors="ignore")
                for rdata in answers]
    except Exception:
        return []


def check_dmarc(domain: str) -> DmarcPolicy:
    """
    Retourne la politique DMARC du domaine : 'none' | 'quarantine' | 'reject' | 'unknown'.

    'unknown' = enregistrement absent ou non parseable → comportement par défaut du
    récepteur (souvent traitement normal, pas de rejet strict).
    'reject'  = rejet garanti côté récepteur → SMTP probe inutile, pattern email à risque.
    """
    dom = domain.lower().lstrip("www.").rstrip("/")
    if dom in _dmarc_cache:
        return _dmarc_cache[dom]

    policy: DmarcPolicy = "unknown"
    records = _txt_records(f"_dmarc.{dom}")
    for rec in records:
        if not rec.startswith("v=DMARC1"):
            continue
        m = re.search(r"\bp=(\w+)", rec, re.I)
        if m:
            p = m.group(1).lower()
            if p in ("none", "quarantine", "reject"):
                policy = p  # type: ignore[assignment]
        break   # un seul enregistrement DMARC par domaine

    _dmarc_cache[dom] = policy
    return policy


def check_spf(domain: str) -> bool:
    """
    Retourne True si le domaine a un enregistrement SPF valide (v=spf1 …).
    Un domaine sans SPF est susceptible de faire spammer les réponses automatiques.
    """
    dom = domain.lower().lstrip("www.").rstrip("/")
    if dom in _spf_cache:
        return _spf_cache[dom]

    has_spf = any(rec.startswith("v=spf1") for rec in _txt_records(dom))
    _spf_cache[dom] = has_spf
    return has_spf


def smtp_probe_useful(domain: str) -> bool:
    """
    Retourne False si une sonde SMTP vers ce domaine est inutile / contre-productive :
    - politique DMARC 'reject' → le serveur rejettera le RCPT TO de toute façon.
    - Pré-check rapide : évite de brûler des tentatives SMTP sur des domaines hermétiques.
    """
    return check_dmarc(domain) != "reject"


def deliverability_risk(domain: str) -> str:
    """
    Retourne une étiquette de risque délivrabilité pour un domaine destinataire.
    Utilisée dans le rapport de run + les signaux CSV.

      ''          → pas de contrainte détectée
      'dmarc:q'   → quarantine (email peut atterrir en spam)
      'dmarc:r'   → reject strict (risque refus / perte du message)
      'no_spf'    → pas de SPF sur le domaine expéditeur (info seulement)
    """
    pol = check_dmarc(domain)
    if pol == "reject":
        return "dmarc:r"
    if pol == "quarantine":
        return "dmarc:q"
    return ""
