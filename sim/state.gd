# Raison d'être : construction du state initial (100 % JSON), sérialisation canonique
# (clés triées, pleine précision) et garde-fous de fin de tick (NaN, bornes, bourses).
# Porté de bureau-etudes/sim/state.gd (§13 : socle, tel quel) — seul le CONTENU du state
# change. Pas d'équivalent de `AN0` ici : l'horloge de Cartel est interne, la semaine 1
# n'est aucune date réelle (§1).
extends RefCounted

# La liste grandit d'un jalon à l'autre (§14 : precurseurs, procedes, graphe, vehicules…).
# Au jalon 0, une seule entrée — et charger_data() crie si elle manque, plutôt que de
# laisser un `data` à moitié vide traverser tout le harnais.
const CHEMINS_DATA: Dictionary = {
	"constants": "res://data/constants.json",
	"precurseurs": "res://data/precurseurs.json",
	"calibration": "res://data/calibration.json",
	"segments": "res://data/segments.json",
	"rivaux": "res://data/rivaux.json",
	"procedes": "res://data/procedes.json",
}


static func charger_data() -> Dictionary:
	var data: Dictionary = {}
	for cle: String in CHEMINS_DATA:
		var texte: String = FileAccess.get_file_as_string(str(CHEMINS_DATA[cle]))
		assert(texte != "", "data manquante : " + str(CHEMINS_DATA[cle]))
		data[cle] = JSON.parse_string(texte)
		assert(data[cle] != null, "JSON invalide : " + str(CHEMINS_DATA[cle]))
	return data


static func nouvelle_partie(graine: int, data: Dictionary) -> Dictionary:
	var eco: Dictionary = data["constants"]["eco"]
	var dette: Dictionary = data["constants"]["dette"]
	return {
		"rng": float(graine & 0xFFFFFFFF),
		"graine": float(graine & 0xFFFFFFFF),
		"tick": 0.0,
		"fin": "",
		# LES DEUX BOURSES (§5) : séparées ici comme partout ailleurs. Rien dans ce fichier,
		# ni dans le harnais, ne les additionne — pas même pour calculer « la richesse ».
		"cash_propre": float(eco["cash_propre_depart"]),
		"cash_sale": float(eco["cash_sale_depart"]),
		# L'horloge de l'acte I (§1bis) : le RESTANT dû, remboursable en propre à l'échéance.
		"dette": float(dette["montant"]),
		"semaines_rouge": 0.0,
		"visibilite": 0.0,
		"semaines_traque": 0.0,
		"stock_kg": 0.0,
		# La recette : les SIX paramètres de §2. Elle reste VIDE tant que personne n'en a
		# posé une — aucune valeur de départ en dur, et aucune constante de départ que les
		# bots écraseraient au tick 0 (ce serait un levier mort-né).
		# `ponytail:` UNE recette à la fois au jalon 1. Le catalogue de trois (§2) arrive
		# avec les trois segments de §4 — trois recettes sans trois marchés à servir ne
		# seraient qu'un tableur de plus.
		"recette": {},
		# Part du débit de la recette effectivement lancée en production cette semaine.
		"part_capacite": 0.0,
		# UN PRIX PAR SEGMENT (§4, §19bis) : nom_segment -> $/kg. Absent ou 0 = on ne vend
		# pas là ; le marché ne met en lice que ce qui a une recette ET un prix, donc se
		# retirer d'un segment est une décision, pas un cas dégénéré.
		#
		# C'est ce qui rend le marché opérant. Avec un prix unique, vendre un kilo à la rue
		# ou au haut de gamme rapportait exactement la même chose, et comme le joueur est
		# limité par son stock à tous les trimestres, ses parts de marché ne décidaient de
		# RIEN (mesure en §16). Maintenant qu'un kilo ne vaut pas le même prix partout, OÙ
		# partent les kilos est la décision de l'acte I.
		"prix": {},
		# Le marché (§4) : nom_segment -> {parts, demande_fidele, ventes_joueur}. Les parts
		# sont par MAISON (le joueur en est une) et se déplacent avec inertie.
		"marche": {},
		# Les deux cartels (§4). Le troisième emplacement reste vide jusqu'à la première
		# trahison (§6, jalon 4).
		"rivaux": {},
		# LA RECHERCHE (§2bis) : un chantier a la fois, paye d'avance en propre. `acquis`
		# est un dictionnaire et non une liste pour que la serialisation canonique le trie
		# — deux campagnes identiques doivent produire deux textes identiques, et l'ordre
		# d'acquisition ne fait pas partie de l'etat du jeu.
		"recherche": {"acquis": {}, "en_cours": "", "semaines_restantes": 0.0},
		"stats": {"kg_produits": 0.0, "kg_vendus": 0.0, "sale_encaisse": 0.0,
			"propre_blanchi": 0.0, "precurseurs_sale": 0.0, "precurseurs_propre": 0.0,
			"propre_recherche": 0.0},
	}


static func cles_triees(d: Dictionary) -> Array:
	var cles: Array = d.keys()
	cles.sort()
	return cles


static func serialiser(state: Dictionary) -> String:
	return JSON.stringify(state, "", true, true)


static func canonique(state: Dictionary) -> Dictionary:
	return JSON.parse_string(serialiser(state))


static func hacher(state: Dictionary) -> String:
	return serialiser(state).sha256_text()


# Équivalence à epsilon près : le round-trip texte JSON de Godot n'est pas bit-exact
# sur les doubles (dernier ULP), donc le contrat save/load est « même campagne à 1e-9
# relatif » — le déterminisme bit-exact, lui, se teste en mémoire sans round-trip.
static func equivalents(a: Variant, b: Variant) -> bool:
	if typeof(a) != typeof(b):
		return false
	match typeof(a):
		TYPE_FLOAT:
			return absf(a - b) <= maxf(1e-6, 1e-9 * maxf(absf(a), absf(b)))
		TYPE_DICTIONARY:
			if (a as Dictionary).size() != (b as Dictionary).size():
				return false
			for cle: Variant in a:
				if not (b as Dictionary).has(cle) or not equivalents(a[cle], b[cle]):
					return false
			return true
		TYPE_ARRAY:
			if (a as Array).size() != (b as Array).size():
				return false
			for i: int in range((a as Array).size()):
				if not equivalents(a[i], b[i]):
					return false
			return true
	return a == b


static func valider(state: Dictionary) -> void:
	# assert() est retiré des builds exportés : sans ce garde, _sain parcourrait tout le
	# state à chaque tick pour ne rien vérifier (coût pur, filet nul). En debug (éditeur,
	# tests headless) tout tourne — c'est là qu'un NaN/hors-borne doit crier.
	if not OS.is_debug_build():
		return
	_sain(state, "state")
	# Le sale ne se découvre pas à découvert : on ne dépense que ce qu'on a physiquement (§5).
	assert(float(state["cash_sale"]) >= -1e-6, "cash_sale négatif")
	assert(float(state["stock_kg"]) >= -1e-6, "stock négatif")
	assert(float(state["visibilite"]) >= 0.0, "visibilité hors bornes")
	assert(float(state["dette"]) >= 0.0, "dette négative")
	for nom_seg: String in state["prix"]:
		assert(float(state["prix"][nom_seg]) >= 0.0, "prix négatif sur " + nom_seg)
	# Σ parts = 1 sur tout segment ouvert : c'est l'invariant que `bureau-etudes` a payé
	# cher pour apprendre, et il crie ici plutôt que trois écrans plus loin.
	for nom_seg: String in state["marche"]:
		var parts: Dictionary = state["marche"][nom_seg]["parts"]
		if parts.is_empty():
			continue
		var somme: float = 0.0
		for uid: String in parts:
			somme += float(parts[uid])
		assert(absf(somme - 1.0) < 0.001, "somme des parts != 1 dans " + nom_seg)
	assert(float(state["recherche"]["semaines_restantes"]) >= 0.0, "recherche à semaines négatives")
	assert(float(state["cash_propre"]) > -1e12, "trésorerie propre absurde")


static func _sain(valeur: Variant, chemin: String) -> void:
	match typeof(valeur):
		TYPE_FLOAT:
			assert(not is_nan(valeur), "NaN : " + chemin)
			assert(not is_inf(valeur), "Inf : " + chemin)
		TYPE_DICTIONARY:
			for cle: Variant in valeur:
				_sain(valeur[cle], chemin + "." + str(cle))
		TYPE_ARRAY:
			for i: int in range((valeur as Array).size()):
				_sain(valeur[i], chemin + "[%d]" % i)
