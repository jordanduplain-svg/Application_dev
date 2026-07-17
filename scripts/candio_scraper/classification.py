"""
classification — Normalisation taille entreprise + classification secteur d'activité.

Deux fonctions pures, sans dépendance externe :

  normalize_company_size(raw)  →  bucket lisible ("1-5", "10-19", "100-199" …)
    Accepte :
      - codes INSEE bruts ("01", "11", "21" …)
      - texte humain ("TPE", "PME", "5", "1 to 10", "Between 50-200")
      - taille numérique simple ("47")

  classify_sector(naf_code, label)  →  secteur large français
    Prend en priorité le code NAF (rév. 2) puis fallback sur le libellé.
    Retourne un secteur lisible : "Tech/IT", "Conseil", "Pharmacie", "BTP", …

Les buckets de taille suivent la nomenclature officielle INSEE (tranche_effectif_salarie)
mais avec un regroupement humainement lisible.
"""

from __future__ import annotations

import re


# ══════════════════════════════════════════════════════════════════════════════
# TAILLE D'ENTREPRISE — BUCKETS NORMALISÉS
# ══════════════════════════════════════════════════════════════════════════════

# Buckets lisibles, dans l'ordre croissant.
SIZE_BUCKETS = [
    "0",         # auto-entrepreneur, holding sans salariés
    "1-5",       # TPE
    "6-9",
    "10-19",
    "20-49",     # petite entreprise
    "50-99",
    "100-199",   # PME
    "200-249",
    "250-499",   # ETI bas
    "500-999",   # ETI haut
    "1000-1999", # Grande entreprise
    "2000-4999",
    "5000-9999",
    "10000+",
]

# Mapping code INSEE officiel (tranche_effectif_salarie) → bucket
# Source : https://www.insee.fr/fr/information/2028256
_INSEE_TRANCHE = {
    "NN": "",            # Unités non employeuses (inconnu / non renseigné)
    "00": "0",
    "01": "1-5",         # 1 ou 2 salariés
    "02": "1-5",         # 3 à 5 salariés
    "03": "6-9",
    "11": "10-19",
    "12": "20-49",
    "21": "50-99",
    "22": "100-199",
    "31": "200-249",
    "32": "250-499",
    "41": "500-999",
    "42": "1000-1999",
    "51": "2000-4999",
    "52": "5000-9999",
    "53": "10000+",
}

# Mapping aliases texte → bucket (pour les sources qui donnent du texte humain)
# Insensible à la casse, espaces normalisés.
_TEXT_ALIASES = {
    # FR
    "tpe":                 "1-5",
    "très petite":         "1-5",
    "très petite entreprise": "1-5",
    "auto-entrepreneur":   "0",
    "indépendant":         "0",
    "freelance":           "0",
    "micro-entreprise":    "1-5",
    "petite entreprise":   "10-19",
    "pe":                  "10-19",
    "pme":                 "50-99",
    "moyenne entreprise":  "100-199",
    "eti":                 "500-999",
    "grande entreprise":   "1000-1999",
    "ge":                  "1000-1999",
    # EN (LinkedIn, Apollo, etc.)
    "self-employed":       "0",
    "self employed":       "0",
    "sole proprietor":     "0",
    "small":               "10-19",
    "medium":              "100-199",
    "mid-market":          "500-999",
    "large":               "1000-1999",
    "enterprise":          "5000-9999",
}


def _bucket_from_count(n: int) -> str:
    """Trouve le bucket correspondant à un nombre exact d'employés."""
    if n <= 0:    return "0"
    if n <= 5:    return "1-5"
    if n <= 9:    return "6-9"
    if n <= 19:   return "10-19"
    if n <= 49:   return "20-49"
    if n <= 99:   return "50-99"
    if n <= 199:  return "100-199"
    if n <= 249:  return "200-249"
    if n <= 499:  return "250-499"
    if n <= 999:  return "500-999"
    if n <= 1999: return "1000-1999"
    if n <= 4999: return "2000-4999"
    if n <= 9999: return "5000-9999"
    return "10000+"


def normalize_company_size(raw) -> str:
    """
    Normalise une taille d'entreprise vers un bucket standard.

    Accepte :
      - codes INSEE bruts : "01", "11", "21" …
      - texte humain      : "TPE", "PME", "Self-employed", "Mid-market" …
      - intervalles       : "1-10", "50 à 99", "between 100 and 200", "100-200 employees"
      - nombre simple     : "47", 47 …
      - listes LinkedIn   : "1-10 employees", "11-50 employees" …

    Retourne `""` si la valeur est manquante ou non interprétable.
    """
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s:
        return ""

    # 1. Code INSEE pur (ex : "01", "11", "53")
    if s in _INSEE_TRANCHE:
        return _INSEE_TRANCHE[s]

    # 2. Bucket déjà au bon format ("1-5", "10-19", "10000+") → on accepte
    if s in SIZE_BUCKETS:
        return s

    s_lower = s.lower().strip()

    # 3. Alias texte connus
    for alias, bucket in _TEXT_ALIASES.items():
        if alias in s_lower:
            return bucket

    # 4. Intervalle numérique : "50-99", "1 to 10", "between 100 and 200", "100-200 employees"
    # On prend la borne basse comme référence.
    m = re.search(r"(\d{1,6})\s*(?:-|–|—|to|à|and|et)\s*(\d{1,6})", s_lower)
    if m:
        low = int(m.group(1))
        high = int(m.group(2))
        # Si bornes très différentes → bucket de la borne basse (plus prudent)
        return _bucket_from_count(low if low > 0 else high)

    # 5. Nombre simple : "47", "47 employees", "≈ 50"
    m = re.search(r"\b(\d{1,6})\b", s)
    if m:
        return _bucket_from_count(int(m.group(1)))

    return ""


# ══════════════════════════════════════════════════════════════════════════════
# SECTEUR D'ACTIVITÉ — CLASSIFICATION NAF → SECTEUR LARGE
# ══════════════════════════════════════════════════════════════════════════════

# Mapping préfixe NAF (rév. 2) → secteur lisible.
# Le code NAF (Nomenclature d'Activités Française) commence par 2 chiffres = section.
# Source : https://www.insee.fr/fr/information/2406147
# On regroupe au niveau "division" (2 premiers chiffres) pour des secteurs lisibles.

_NAF_TO_SECTOR: dict[str, str] = {
    # Agriculture, sylviculture, pêche (A)
    "01": "Agriculture",
    "02": "Agriculture",
    "03": "Agriculture",
    # Industries extractives (B)
    "05": "Énergie",
    "06": "Énergie",
    "07": "Industrie",
    "08": "Industrie",
    "09": "Industrie",
    # Industrie manufacturière (C)
    "10": "Agroalimentaire",
    "11": "Agroalimentaire",
    "12": "Industrie",     # tabac
    "13": "Textile / Mode",
    "14": "Textile / Mode",
    "15": "Textile / Mode",
    "16": "Industrie",     # bois
    "17": "Industrie",     # papier
    "18": "Imprimerie / Édition",
    "19": "Énergie",       # cokéfaction, raffinage
    "20": "Chimie",
    "21": "Pharmacie",
    "22": "Industrie",     # caoutchouc, plastique
    "23": "Industrie",     # minéraux non métalliques
    "24": "Industrie",     # métallurgie
    "25": "Industrie",     # produits métalliques
    "26": "Électronique",
    "27": "Électronique",  # équipements électriques
    "28": "Industrie",     # machines
    "29": "Automobile",
    "30": "Industrie",     # autres transports (aéro, naval, ferroviaire)
    "31": "Industrie",     # meubles
    "32": "Industrie",     # autres
    "33": "Industrie",     # réparation, installation
    # Énergie (D, E)
    "35": "Énergie",
    "36": "Énergie",       # eau
    "37": "Environnement",
    "38": "Environnement", # déchets
    "39": "Environnement",
    # Construction (F)
    "41": "BTP / Construction",
    "42": "BTP / Construction",
    "43": "BTP / Construction",
    # Commerce (G)
    "45": "Automobile",    # commerce auto
    "46": "Commerce",      # gros
    "47": "Commerce",      # détail
    # Transport (H)
    "49": "Transport / Logistique",
    "50": "Transport / Logistique",
    "51": "Transport / Logistique",
    "52": "Transport / Logistique",
    "53": "Transport / Logistique",
    # Hébergement / Restauration (I)
    "55": "Hôtellerie / Restauration",
    "56": "Hôtellerie / Restauration",
    # Information / Communication (J)
    "58": "Imprimerie / Édition",
    "59": "Médias / Audiovisuel",
    "60": "Médias / Audiovisuel",
    "61": "Télécoms",
    "62": "Tech / IT",         # programmation, conseil informatique
    "63": "Tech / IT",         # services d'information
    # Finance / Assurance (K)
    "64": "Finance / Banque",
    "65": "Assurance",
    "66": "Finance / Banque",
    # Immobilier (L)
    "68": "Immobilier",
    # Activités spécialisées (M)
    "69": "Conseil / Juridique",
    "70": "Conseil",
    "71": "Ingénierie / R&D",
    "72": "R&D",
    "73": "Publicité / Marketing",
    "74": "Services pro",     # design, photo, traduction
    "75": "Vétérinaire",
    # Services administratifs (N)
    "77": "Services aux entreprises",
    "78": "RH / Intérim",
    "79": "Tourisme",
    "80": "Sécurité",
    "81": "Services aux entreprises",
    "82": "Services aux entreprises",
    # Administration publique (O)
    "84": "Administration",
    # Enseignement (P)
    "85": "Éducation",
    # Santé / Action sociale (Q)
    "86": "Santé",
    "87": "Action sociale",
    "88": "Action sociale",
    # Arts, spectacles (R)
    "90": "Arts / Spectacle",
    "91": "Culture",
    "92": "Jeux / Casino",
    "93": "Sport / Loisirs",
    # Autres services (S)
    "94": "Associations",
    "95": "Services pro",     # réparation
    "96": "Services pro",     # services personnels
    # Activités des ménages (T) / extra-territoriales (U) — rarement scrapées
    "97": "Services personnels",
    "98": "Services personnels",
    "99": "International",
}


# Mapping mots-clés textuels → secteur (fallback quand pas de NAF).
# Recherche par mots-clés dans le libellé d'activité.
_LABEL_TO_SECTOR: list[tuple[list[str], str]] = [
    # Ordre = priorité (les plus spécifiques d'abord)
    (["pharmac", "biotech", "médicament", "santé pharm"],         "Pharmacie"),
    (["consult", "conseil", "advisor", "advisory"],               "Conseil"),
    (["saas", "software", "logiciel", "développement informa",
      "programmation", "data analy", "data engineer", "ai ",
      "intelligence artificielle", "machine learning", " ia "],   "Tech / IT"),
    (["banque", "bank", "fintech", "finance"],                    "Finance / Banque"),
    (["assurance", "insurance"],                                  "Assurance"),
    (["immobili", "real estate"],                                 "Immobilier"),
    (["btp", "bâtiment", "travaux publics", "construction"],      "BTP / Construction"),
    (["restaurant", "hôtel", "hotell", "restauration"],           "Hôtellerie / Restauration"),
    (["santé", "health", "médic", "hôpital", "hospital",
      "clinique", "infirm", "médecin"],                           "Santé"),
    (["éducat", "education", "école", "school", "université",
      "university", "formation"],                                 "Éducation"),
    (["transport", "logistique", "logistics", "fret"],            "Transport / Logistique"),
    (["agroaliment", "food", "boisson", "beverage"],              "Agroalimentaire"),
    (["agricult", "viticult", "élevage", "pêche"],                "Agriculture"),
    (["énergie", "energy", "électric", "gaz "],                   "Énergie"),
    (["mode", "fashion", "textile", "habillement", "vêtement"],   "Textile / Mode"),
    (["média", "media ", "presse", "édition", "publishing",
      "audiovisuel", "radio", "tv "],                             "Médias / Audiovisuel"),
    (["télécom", "telecom", "réseau"],                            "Télécoms"),
    (["marketing", "publicité", "advertising", "communication"],  "Publicité / Marketing"),
    (["juridique", "avocat", "law firm", "legal"],                "Conseil / Juridique"),
    (["recrutement", "intérim", "hr ", "ressources humaines"],    "RH / Intérim"),
    (["automob", "voiture"],                                      "Automobile"),
    (["chimie", "chemical"],                                      "Chimie"),
    (["sport", "fitness"],                                        "Sport / Loisirs"),
    (["association", "ong", "non-profit", "non profit"],          "Associations"),
    (["arts ", "spectacle", "cinéma", "musique"],                 "Arts / Spectacle"),
    (["environnement", "déchet", "recyclage", "écologie"],        "Environnement"),
    (["commerce", "retail", "vente au détail"],                   "Commerce"),
    (["administr", "publique", "collectivité"],                   "Administration"),
]


# ══════════════════════════════════════════════════════════════════════════════
# LOCATION — Parsing & enrichissement géographique
# ══════════════════════════════════════════════════════════════════════════════

# Mapping code département → nom officiel (INSEE).
_DEPT_NAMES: dict[str, str] = {
    "01": "Ain",                "02": "Aisne",              "03": "Allier",
    "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",  "06": "Alpes-Maritimes",
    "07": "Ardèche",            "08": "Ardennes",           "09": "Ariège",
    "10": "Aube",               "11": "Aude",               "12": "Aveyron",
    "13": "Bouches-du-Rhône",   "14": "Calvados",           "15": "Cantal",
    "16": "Charente",           "17": "Charente-Maritime",  "18": "Cher",
    "19": "Corrèze",            "2A": "Corse-du-Sud",       "2B": "Haute-Corse",
    "20": "Corse",              "21": "Côte-d'Or",          "22": "Côtes-d'Armor",
    "23": "Creuse",             "24": "Dordogne",           "25": "Doubs",
    "26": "Drôme",              "27": "Eure",               "28": "Eure-et-Loir",
    "29": "Finistère",          "30": "Gard",               "31": "Haute-Garonne",
    "32": "Gers",               "33": "Gironde",            "34": "Hérault",
    "35": "Ille-et-Vilaine",    "36": "Indre",              "37": "Indre-et-Loire",
    "38": "Isère",              "39": "Jura",               "40": "Landes",
    "41": "Loir-et-Cher",       "42": "Loire",              "43": "Haute-Loire",
    "44": "Loire-Atlantique",   "45": "Loiret",             "46": "Lot",
    "47": "Lot-et-Garonne",     "48": "Lozère",             "49": "Maine-et-Loire",
    "50": "Manche",             "51": "Marne",              "52": "Haute-Marne",
    "53": "Mayenne",            "54": "Meurthe-et-Moselle", "55": "Meuse",
    "56": "Morbihan",           "57": "Moselle",            "58": "Nièvre",
    "59": "Nord",               "60": "Oise",               "61": "Orne",
    "62": "Pas-de-Calais",      "63": "Puy-de-Dôme",        "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées",    "66": "Pyrénées-Orientales", "67": "Bas-Rhin",
    "68": "Haut-Rhin",          "69": "Rhône",              "70": "Haute-Saône",
    "71": "Saône-et-Loire",     "72": "Sarthe",             "73": "Savoie",
    "74": "Haute-Savoie",       "75": "Paris",              "76": "Seine-Maritime",
    "77": "Seine-et-Marne",     "78": "Yvelines",           "79": "Deux-Sèvres",
    "80": "Somme",              "81": "Tarn",               "82": "Tarn-et-Garonne",
    "83": "Var",                "84": "Vaucluse",           "85": "Vendée",
    "86": "Vienne",             "87": "Haute-Vienne",       "88": "Vosges",
    "89": "Yonne",              "90": "Territoire de Belfort", "91": "Essonne",
    "92": "Hauts-de-Seine",     "93": "Seine-Saint-Denis",  "94": "Val-de-Marne",
    "95": "Val-d'Oise",
    # DROM
    "971": "Guadeloupe",        "972": "Martinique",        "973": "Guyane",
    "974": "La Réunion",        "976": "Mayotte",
}


def dept_name(code: str) -> str:
    """Retourne le nom du département pour un code donné (ou '' si inconnu)."""
    if not code:
        return ""
    return _DEPT_NAMES.get(str(code).strip().upper().zfill(2), "")


def backfill_derived_fields(c) -> None:
    """
    Remplit les champs dérivés (secteur, bucket taille, localisation structurée)
    d'une Company à partir de ses champs bruts. Idempotent : ne touche que les
    champs vides. À appeler après le chargement CSV ET après la collecte, pour que
    les entreprises rechargées/fusionnées aient aussi leur localisation/secteur.
    """
    # Bucket de taille depuis la taille brute
    if not c.company_size_bucket and c.company_size:
        c.company_size_bucket = normalize_company_size(c.company_size)
    # Secteur depuis le libellé d'activité
    if not c.sector and c.activity_domain:
        c.sector = classify_sector(naf_code="", label=c.activity_domain)
    # Localisation structurée depuis le champ region libre (ex: "Paris", "PARIS (75)")
    if c.region and not (c.country or c.region_admin or c.dept or c.city):
        loc = parse_location(c.region)
        c.country      = c.country      or loc["country"]
        c.region_admin = c.region_admin or loc["region"]
        c.dept         = c.dept         or loc["dept"]
        c.dept_name    = c.dept_name    or loc["dept_name"]
        c.city         = c.city         or loc["city"]
    # Nom de département si on a le code mais pas le nom
    if c.dept and not c.dept_name:
        c.dept_name = dept_name(c.dept)


# Mapping département (2 chiffres) → région administrative française.
# Source : nomenclature INSEE 2016 (13 régions métropolitaines + DROM).
_DEPT_TO_REGION: dict[str, str] = {
    # Île-de-France
    "75": "Île-de-France", "77": "Île-de-France", "78": "Île-de-France",
    "91": "Île-de-France", "92": "Île-de-France", "93": "Île-de-France",
    "94": "Île-de-France", "95": "Île-de-France",
    # Auvergne-Rhône-Alpes
    "01": "Auvergne-Rhône-Alpes", "03": "Auvergne-Rhône-Alpes",
    "07": "Auvergne-Rhône-Alpes", "15": "Auvergne-Rhône-Alpes",
    "26": "Auvergne-Rhône-Alpes", "38": "Auvergne-Rhône-Alpes",
    "42": "Auvergne-Rhône-Alpes", "43": "Auvergne-Rhône-Alpes",
    "63": "Auvergne-Rhône-Alpes", "69": "Auvergne-Rhône-Alpes",
    "73": "Auvergne-Rhône-Alpes", "74": "Auvergne-Rhône-Alpes",
    # Bourgogne-Franche-Comté
    "21": "Bourgogne-Franche-Comté", "25": "Bourgogne-Franche-Comté",
    "39": "Bourgogne-Franche-Comté", "58": "Bourgogne-Franche-Comté",
    "70": "Bourgogne-Franche-Comté", "71": "Bourgogne-Franche-Comté",
    "89": "Bourgogne-Franche-Comté", "90": "Bourgogne-Franche-Comté",
    # Bretagne
    "22": "Bretagne", "29": "Bretagne", "35": "Bretagne", "56": "Bretagne",
    # Centre-Val de Loire
    "18": "Centre-Val de Loire", "28": "Centre-Val de Loire",
    "36": "Centre-Val de Loire", "37": "Centre-Val de Loire",
    "41": "Centre-Val de Loire", "45": "Centre-Val de Loire",
    # Corse
    "2A": "Corse", "2B": "Corse", "20": "Corse",
    # Grand Est
    "08": "Grand Est", "10": "Grand Est", "51": "Grand Est",
    "52": "Grand Est", "54": "Grand Est", "55": "Grand Est",
    "57": "Grand Est", "67": "Grand Est", "68": "Grand Est",
    "88": "Grand Est",
    # Hauts-de-France
    "02": "Hauts-de-France", "59": "Hauts-de-France", "60": "Hauts-de-France",
    "62": "Hauts-de-France", "80": "Hauts-de-France",
    # Normandie
    "14": "Normandie", "27": "Normandie", "50": "Normandie",
    "61": "Normandie", "76": "Normandie",
    # Nouvelle-Aquitaine
    "16": "Nouvelle-Aquitaine", "17": "Nouvelle-Aquitaine",
    "19": "Nouvelle-Aquitaine", "23": "Nouvelle-Aquitaine",
    "24": "Nouvelle-Aquitaine", "33": "Nouvelle-Aquitaine",
    "40": "Nouvelle-Aquitaine", "47": "Nouvelle-Aquitaine",
    "64": "Nouvelle-Aquitaine", "79": "Nouvelle-Aquitaine",
    "86": "Nouvelle-Aquitaine", "87": "Nouvelle-Aquitaine",
    # Occitanie
    "09": "Occitanie", "11": "Occitanie", "12": "Occitanie",
    "30": "Occitanie", "31": "Occitanie", "32": "Occitanie",
    "34": "Occitanie", "46": "Occitanie", "48": "Occitanie",
    "65": "Occitanie", "66": "Occitanie", "81": "Occitanie",
    "82": "Occitanie",
    # Pays de la Loire
    "44": "Pays de la Loire", "49": "Pays de la Loire",
    "53": "Pays de la Loire", "72": "Pays de la Loire",
    "85": "Pays de la Loire",
    # Provence-Alpes-Côte d'Azur — NOM COMPLET (pas « PACA ») pour coller EXACTEMENT au libellé
    # de l'UI (geo.ts FR_REGIONS) : le filtre localisation des campagnes / de la page Leads fait
    # un match de chaîne exact sur regionAdmin. « PACA » ne matchait jamais « Provence-Alpes-Côte
    # d'Azur » → campagnes PACA vides. Tous les autres régions utilisent déjà leur nom complet.
    "04": "Provence-Alpes-Côte d'Azur", "05": "Provence-Alpes-Côte d'Azur",
    "06": "Provence-Alpes-Côte d'Azur", "13": "Provence-Alpes-Côte d'Azur",
    "83": "Provence-Alpes-Côte d'Azur", "84": "Provence-Alpes-Côte d'Azur",
    # DROM (départements et régions d'outre-mer)
    "971": "Guadeloupe", "972": "Martinique", "973": "Guyane",
    "974": "La Réunion", "976": "Mayotte",
}

# Mapping ville → département (étendu de SocieteScraper.DEPT_MAP).
# NOTE : ne pas mettre de noms de régions ici — elles sont matchées séparément à l'étape 5.
_CITY_TO_DEPT: dict[str, str] = {
    "paris": "75",
    "lyon": "69", "marseille": "13", "toulouse": "31", "bordeaux": "33",
    "nantes": "44", "strasbourg": "67", "lille": "59", "nice": "06",
    "rennes": "35", "montpellier": "34", "grenoble": "38", "rouen": "76",
    "toulon": "83", "reims": "51", "saint-étienne": "42", "dijon": "21",
    "angers": "49", "le mans": "72", "le havre": "76",
    "brest": "29", "amiens": "80", "limoges": "87", "tours": "37",
    "clermont-ferrand": "63", "besançon": "25", "nîmes": "30",
    "orléans": "45", "metz": "57", "perpignan": "66", "caen": "14",
    "mulhouse": "68", "nancy": "54", "boulogne": "92", "argenteuil": "95",
    "montreuil": "93", "saint-denis": "93", "versailles": "78",
    "créteil": "94", "poitiers": "86", "pau": "64", "annecy": "74",
    "avignon": "84", "calais": "62", "aix-en-provence": "13", "antibes": "06",
    "cannes": "06",
}


def parse_location(raw_location: str = "", explicit_dept: str = "") -> dict:
    """
    Parse un champ location libre en {country, region, dept, city}.

    Accepte plusieurs formats :
      - "PARIS (75)"              → {city:"Paris", dept:"75", region:"Île-de-France", country:"France"}
      - "Lyon"                    → {city:"Lyon", dept:"69", region:"Auvergne-Rhône-Alpes", country:"France"}
      - "Île-de-France"           → {region:"Île-de-France", country:"France"}
      - "Paris 75002"             → {city:"Paris", dept:"75", region:"Île-de-France", country:"France"}
      - "75002 Paris"             → idem
      - "Boulogne-Billancourt"    → tentative match dans _CITY_TO_DEPT
      - explicit_dept fourni      → utilisé en priorité pour dept + region

    Retourne un dict avec les 4 clés (chaînes vides si absent).
    """
    out = {"country": "", "region": "", "dept": "", "dept_name": "", "city": ""}
    if not raw_location and not explicit_dept:
        return out

    raw = (raw_location or "").strip()

    # 1. Département explicite (depuis une API qui le fournit)
    if explicit_dept:
        dept = str(explicit_dept).strip().upper().zfill(2) if explicit_dept.isdigit() else str(explicit_dept).strip().upper()
        out["dept"]      = dept
        out["dept_name"] = _DEPT_NAMES.get(dept, "")
        out["region"]    = _DEPT_TO_REGION.get(dept, "")
        out["country"]   = "France"   # API FR

    # 2. Pattern "VILLE (75)" — SIRENE format
    m = re.match(r"\s*(.+?)\s*\(\s*(\d{2,3}[AB]?)\s*\)\s*$", raw)
    if m:
        out["city"] = m.group(1).strip().title()
        dept = m.group(2).upper().zfill(2) if m.group(2).isdigit() else m.group(2)
        out["dept"]      = out["dept"]      or dept
        out["dept_name"] = out["dept_name"] or _DEPT_NAMES.get(dept, "")
        out["region"]    = out["region"]    or _DEPT_TO_REGION.get(dept, "")
        out["country"]   = out["country"]   or "France"
        return out

    # 3. Pattern "VILLE 75002" ou "75002 VILLE" — France Travail / codes postaux
    m = re.search(r"\b(\d{5})\b", raw)
    if m:
        cp = m.group(1)
        # DROM-COM = 3 chiffres : 97x (Antilles, Réunion…) ET 98x (Polynésie,
        # Nouvelle-Calédonie, Monaco…). Cohérent avec SocieteScraper._cp_to_dept.
        dept = cp[:3] if cp.startswith(("97", "98")) else cp[:2]
        out["dept"]      = out["dept"]      or dept
        out["dept_name"] = out["dept_name"] or _DEPT_NAMES.get(dept, "")
        out["region"]    = out["region"]    or _DEPT_TO_REGION.get(dept, "")
        out["country"]   = out["country"]   or "France"
        # Ville = ce qui reste sans le code postal
        rest = re.sub(r"\b\d{5}\b", "", raw).strip(" ,-").strip()
        if rest:
            out["city"] = rest.title()
        return out

    # 4. Match direct dans le mapping ville → dept
    raw_lower = raw.lower()
    for city_key, dept in _CITY_TO_DEPT.items():
        if city_key in raw_lower:
            out["city"]      = out["city"]      or city_key.title()
            out["dept"]      = out["dept"]      or dept
            out["dept_name"] = out["dept_name"] or _DEPT_NAMES.get(dept, "")
            out["region"]    = out["region"]    or _DEPT_TO_REGION.get(dept, "")
            out["country"]   = out["country"]   or "France"
            return out

    # 5. Match région connue (texte brut = nom de région)
    for region in set(_DEPT_TO_REGION.values()):
        if region.lower() in raw_lower:
            out["region"] = out["region"] or region
            out["country"] = out["country"] or "France"
            return out

    # 6. Détection pays anglo-saxon basique (LinkedIn export)
    for country_kw, country in [
        (["united states", "usa", "états-unis"], "USA"),
        (["united kingdom", "uk", " england", " scotland"], "UK"),
        (["germany", "allemagne"], "Germany"),
        (["spain", "espagne"], "Spain"),
        (["italy", "italie"], "Italy"),
        (["belgium", "belgique"], "Belgium"),
        (["switzerland", "suisse"], "Switzerland"),
        (["canada"], "Canada"),
    ]:
        if any(kw in raw_lower for kw in country_kw):
            out["country"] = country
            return out

    # 7. Sinon, la chaîne brute pourrait être juste une ville inconnue → conserver.
    # B1-13 : valider que ça ressemble à un NOM DE LIEU avant de le stocker.
    # Critères : uniquement lettres/espaces/traits d'union/apostrophes, sans chiffres,
    # longueur 2-50 chars, sans mots-clés de type contrat ou poste parasites.
    # Évite que "CDI - Temps plein" ou "Mes commentaires" deviennent une fausse ville
    # qui corrompt la clé de dédup P0-4 dans merge_into_master.
    _CITY_BLACKLIST_KW = ("cdi", "cdd", "temps plein", "temps partiel", "offre",
                          "poste", "contrat", "télétravail", "remote", "stage",
                          "alternance", "apprentissage", "http")
    if raw and 2 <= len(raw) <= 50:
        raw_lower_kw = raw.lower()
        if (re.match(r"^[a-zA-ZÀ-ÿ\s\-']+$", raw)
                and not any(kw in raw_lower_kw for kw in _CITY_BLACKLIST_KW)):
            out["city"] = raw.title()

    return out


# Sous-classes NAF PLUS spécifiques que la division 2 chiffres (vérifiées AVANT elle).
# 58.29 (édition de logiciels applicatifs/système) et 58.21 (jeux) = éditeurs de LOGICIELS
# → « Logiciel / SaaS ». Sans ce cas, la division 58 les classait « Imprimerie / Édition »
# (édition de livres/presse) — un éditeur SaaS étiqueté imprimeur. Clés en chiffres seuls.
_NAF_SUBCLASS_TO_SECTOR: dict[str, str] = {
    "5829": "Logiciel / SaaS",
    "5821": "Logiciel / SaaS",
}


def classify_sector(naf_code: str = "", label: str = "") -> str:
    """
    Classe une entreprise dans un secteur d'activité large.

    Stratégie en cascade :
      1. Si `naf_code` est fourni (ex : "62.01Z", "62.01", "62"), on teste d'abord la
         sous-classe (4 chiffres, ex. "58.29") puis la division (2 chiffres).
      2. Sinon (ou si le code NAF n'est pas reconnu), on cherche dans le libellé `label`
         par mots-clés.
      3. Sinon → "" (inconnu).

    Retourne une chaîne lisible : "Tech / IT", "Pharmacie", "Conseil", "BTP / Construction"…
    """
    # 1. Tentative par code NAF — chiffres seuls : "58.29C" → "5829", "62.01Z" → "6201".
    if naf_code:
        digits = re.sub(r"\D", "", str(naf_code))
        # 1a. Sous-classe spécifique (4 chiffres) d'abord — prime sur la division.
        if len(digits) >= 4:
            sub = _NAF_SUBCLASS_TO_SECTOR.get(digits[:4])
            if sub:
                return sub
        # 1b. Division (2 chiffres).
        if len(digits) >= 2:
            sector = _NAF_TO_SECTOR.get(digits[:2])
            if sector:
                return sector

    # 2. Tentative par libellé
    if label:
        label_lower = label.lower()
        for keywords, sector in _LABEL_TO_SECTOR:
            if any(kw in label_lower for kw in keywords):
                return sector

    return ""
