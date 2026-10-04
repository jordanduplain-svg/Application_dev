# Raison d'être : §2bis — la recherche en GRILLE D'HEXAGONES, à la Plague Inc. On achète
# une case voisine de ce qu'on possède, en `cash_propre`, instantanément ; chaque case
# acquise renchérit les suivantes de sa branche. Ce qu'une case livre n'est JAMAIS un
# nombre : c'est une borne de l'écran de conception qui recule (§2).
#
# ÉCRIT ICI, PAS PORTÉ. §13 ne reprend de `bureau-etudes` que le socle et le marché ; son
# `research.gd` portait un modèle de brevets et de concours qui n'a rien à faire ici — et la
# première version de ce fichier, un arbre de prérequis à chantier unique, lui ressemblait
# encore trop. C'est l'utilisateur qui l'a vu (§2bis).
#
# AUCUN NOMBRE D'ÉQUILIBRAGE DANS CE FICHIER (§14) : les coûts, l'inflation, la grille et
# les ouvertures de départ vivent tous dans data/procedes.json.
#
# LA PROMESSE QUE CE FICHIER DOIT TENIR, et c'est la seule de §2bis qui puisse être fausse
# en silence : **la recherche n'est jamais un prérequis de survie.** Une partie entière est
# jouable sans rien chercher — plus pauvre, plus discrète, parfaitement viable. C'est la
# trajectoire du bot `discret`, et la cible 23 de §16 la mesure campagne par campagne.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Produit := preload("res://sim/produit.gd")

# Les six seules choses qu'une case peut ouvrir. La liste est FERMÉE, et c'est elle qui
# rend vraie la phrase « elle ne donne aucun bonus numérique direct » (§2bis) : une clé de
# plus dans un `ouvre` de data/procedes.json et la promesse tombe, sans qu'une seule ligne
# de code change. tests/run.gd la vérifie contre le fichier de données.
const OUVERTURES: PackedStringArray = ["famille", "purete_max", "rendement_max",
	"complexite_max", "coupe_max", "stabilisation_max", "marquage_max", "forme", "agent",
	"cadence"]
const BORNES: PackedStringArray = ["purete_max", "rendement_max", "complexite_max",
	"coupe_max", "stabilisation_max", "marquage_max"]
# Les ouvertures qui AJOUTENT une option a une liste, comme une famille : la cle d'une case
# -> la liste des options ouvertes dans `ouvertures()`.
const LISTES: Dictionary = {"famille": "familles", "forme": "formes", "agent": "agents",
	"cadence": "cadences"}

# Les six voisins d'une case en coordonnées axiales. C'est de la géométrie, pas de
# l'équilibrage : une grille hexagonale a six voisins et n'en aura jamais sept.
const VOISINS: Array = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]

# Le minimum de chaque curseur, pour la proximité du savoir-faire. Ce sont les bornes de
# domaine de sim/produit.gd, pas de l'équilibrage.
const BORNES_MIN: Dictionary = {
	"purete": Produit.PURETE_MIN, "rendement": Produit.RENDEMENT_MIN,
	"complexite": Produit.COMPLEXITE_MIN, "coupe": 0.0, "stabilisation": 0.0,
}


# Ce que le joueur a le droit de concevoir AUJOURD'HUI : les ouvertures de départ, élargies
# par chaque case acquise. Les bornes se prennent au PLUS LARGE — deux cases qui repoussent
# la même borne ne s'additionnent pas, la meilleure gagne. C'est ce qui rend les raccourcis
# de la grille honnêtes : sauter une case de veine donne la borne de la case atteinte, ni
# plus, ni moins.
static func ouvertures(state: Dictionary, data: Dictionary) -> Dictionary:
	var depart: Dictionary = data["procedes"]["ouvertures_depart"]
	var familles: Array = (depart["familles"] as Array).duplicate()
	var limites: Dictionary = {
		"familles": familles,
		"formes": (depart["formes"] as Array).duplicate(),
		"agents": (depart["agents"] as Array).duplicate(),
		"cadences": (depart["cadences"] as Array).duplicate(),
		# LA BUTEE NE S'ELARGIT PAS. Elle est declaree dans les donnees et ne bouge jamais :
		# un repli qui suit la recherche est un repli decide par l'alphabet (voir le
		# commentaire de data/procedes.json).
		"famille_defaut": str(depart["famille_defaut"]),
	}
	for cle: String in BORNES:
		limites[cle] = float(depart[cle])
	var noeuds: Dictionary = data["procedes"]["noeuds"]
	for id: String in (state["recherche"]["acquis"] as Dictionary):
		if not noeuds.has(id):
			continue
		var ouvre: Dictionary = noeuds[id]["ouvre"]
		for cle_l: String in LISTES:
			var liste_l: Array = limites[str(LISTES[cle_l])]
			if ouvre.has(cle_l) and not liste_l.has(str(ouvre[cle_l])):
				liste_l.append(str(ouvre[cle_l]))
		for cle2: String in BORNES:
			if ouvre.has(cle2):
				limites[cle2] = maxf(float(limites[cle2]), float(ouvre[cle2]))
	for cle_t: String in LISTES:
		(limites[str(LISTES[cle_t])] as Array).sort()
	return limites


# "q,r" -> [q, r]. Les coordonnées sont des chaînes dans le JSON pour échapper au levier.
static func lire_case(texte: String) -> Array:
	var morceaux: PackedStringArray = texte.split(",")
	return [int(morceaux[0]), int(morceaux[1])]


static func voisines(a: Array, b: Array) -> bool:
	for v: Array in VOISINS:
		if int(a[0]) + int(v[0]) == int(b[0]) and int(a[1]) + int(v[1]) == int(b[1]):
			return true
	return false


# Une case est disponible si elle n'est pas acquise et si elle TOUCHE le centre ou une case
# acquise. Il n'est pas dit ici si elle est PAYABLE : c'est au joueur (ou au bot) de
# regarder sa bourse, et un écran qui masquerait ce qu'on ne peut pas s'offrir cacherait
# l'objectif (§12bis).
static func disponibles(state: Dictionary, data: Dictionary) -> Array:
	var liste: Array = []
	for id: String in Etat.cles_triees(data["procedes"]["noeuds"]):
		if est_disponible(state, data, id):
			liste.append(id)
	return liste


# La meme question pour UNE case. `acheter` la pose a chaque tentative, et les bots
# retentent chaque semaine tant que le savoir-faire manque : recalculer toute la grille a
# chaque fois coutait plus que la simulation elle-meme (`perf.gd`, colonne us/tick).
static func est_disponible(state: Dictionary, data: Dictionary, id: String) -> bool:
	var acquis: Dictionary = state["recherche"]["acquis"]
	var noeuds: Dictionary = data["procedes"]["noeuds"]
	if acquis.has(id) or not noeuds.has(id):
		return false
	var ici: Array = lire_case(str(noeuds[id]["case"]))
	if voisines(ici, lire_case(str(data["procedes"]["centre"]))):
		return true
	for acq: String in acquis:
		if noeuds.has(acq) and voisines(ici, lire_case(str(noeuds[acq]["case"]))):
			return true
	return false


# LE PRIX DU JOUR, et il n'est pas celui du JSON : chaque case déjà acquise dans la même
# branche le renchérit (§2bis). C'est l'inflation qui remplace la durée comme frein de la
# montée — et c'est elle qui fait de chaque achat un engagement : une case prise par
# curiosité rend toutes les autres plus chères.
static func cout(state: Dictionary, data: Dictionary, id: String) -> float:
	var noeuds: Dictionary = data["procedes"]["noeuds"]
	var branche: String = str(noeuds[id]["branche"])
	var n: int = 0
	for acq: String in (state["recherche"]["acquis"] as Dictionary):
		if noeuds.has(acq) and str(noeuds[acq]["branche"]) == branche:
			n += 1
	return float(noeuds[id]["cout_propre"]) \
		* (1.0 + float(data["procedes"]["inflation_par_acquis"]) * float(n))


# L'ACHAT EST INSTANTANÉ (§2bis, à la Plague Inc) : la borne recule pour la conception de
# cette semaine même. Il n'y a ni chantier, ni remboursement, ni dé-évolution : une case
# achetée est de l'argent et de l'expérience dépensés, ce qui est exactement ce qui rend le
# choix coûteux.
static func acheter(state: Dictionary, data: Dictionary, id: String) -> bool:
	if not est_disponible(state, data, id):
		return false
	var noeud: Dictionary = data["procedes"]["noeuds"][id]
	var prix: float = cout(state, data, id)
	# EN PROPRE, et c'est le cœur de §2bis : le sale n'achète rien d'enregistré (§5). Un
	# labo, des réactifs et un chimiste laissent un papier. D'où le fait que le rythme de
	# la recherche soit étranglé par le blanchiment sans qu'on ait eu à l'inventer.
	if float(state["cash_propre"]) < prix:
		return false
	# ET EN SAVOIR-FAIRE DU BRAS, et seulement du sien : l'expérience de la coupe n'achète
	# pas de la pureté. Pas d'inflation ici — le temps passé à apprendre freine déjà.
	var bras: String = str(noeud["bras"])
	var savoir: Dictionary = state["recherche"]["savoir"]
	var exige: float = float(noeud["cout_savoir"])
	if float(savoir.get(bras, 0.0)) < exige:
		return false
	state["cash_propre"] = float(state["cash_propre"]) - prix
	savoir[bras] = float(savoir[bras]) - exige
	(state["recherche"]["acquis"] as Dictionary)[id] = 1.0
	state["stats"]["propre_recherche"] = float(state["stats"]["propre_recherche"]) + prix
	return true


# LE SAVOIR-FAIRE S'APPREND EN PRODUISANT (§2bis), une fois par semaine, après la
# production. Chaque bras n'apprend que de ses propres curseurs, et d'autant plus qu'ils
# sont près de leur plafond ACTUEL : on cherche la pureté en produisant en butée de pureté,
# le volume en poussant rendement et coupe. Aucune direction n'est récompensée plus qu'une
# autre — c'est la raison des réserves séparées.
#
# PAR SEMAINE, pondéré par la part de capacité, et pas par kilo : un petit labo plein
# apprend aussi vite qu'une usine pleine. Un gain au kilo aurait été plus proche de la
# courbe d'apprentissage industrielle, et il aurait donné aux gros producteurs une boule de
# neige que rien d'autre dans le jeu ne compense.
#
# Ne touche à AUCUNE bourse : le savoir-faire ne s'échange jamais contre de l'argent.
static func apprendre(state: Dictionary, data: Dictionary) -> void:
	var recette: Dictionary = state["recette"]
	var part: float = clampf(float(state["part_capacite"]), 0.0, 1.0)
	if recette.is_empty() or part <= 0.0:
		return
	var cs: Dictionary = data["procedes"]["savoir"]
	var lim: Dictionary = ouvertures(state, data)
	var savoir: Dictionary = state["recherche"]["savoir"]
	var bras_data: Dictionary = cs["bras"]
	for bras: String in bras_data:
		if bras.begins_with("_"):
			continue
		var b: Dictionary = bras_data[bras]
		var meilleure: float = 0.0
		for curseur: Variant in (b.get("curseurs", []) as Array):
			meilleure = maxf(meilleure, proximite(recette, lim, str(curseur),
				float(cs["seuil_proximite"])))
		if bool(b.get("famille_avancee", false)) \
				and str(recette.get("famille", "")) == famille_avancee(lim, data):
			meilleure = 1.0
		savoir[bras] = float(savoir.get(bras, 0.0)) \
			+ part * meilleure * float(cs["gain_semaine"])


# Où est ce curseur entre son minimum et son plafond du jour, ramené de [seuil, 1] vers
# [0, 1]. Un plafond encore égal au minimum ne donne rien : être en butée d'un palier
# unique ne coûte rien et ne prouve rien (complexité 1 et stabilisation 0 au départ).
static func proximite(recette: Dictionary, lim: Dictionary, curseur: String,
		seuil: float) -> float:
	var mini: float = float(BORNES_MIN[curseur])
	var plafond: float = float(lim[curseur + "_max"])
	if plafond - mini <= 1e-9:
		return 0.0
	var pos: float = clampf((float(recette.get(curseur, mini)) - mini) / (plafond - mini),
		0.0, 1.0)
	return clampf((pos - seuil) / maxf(1.0 - seuil, 1e-9), 0.0, 1.0)


# La famille ouverte la plus puissante (plus fort `k_famille`) — celle qu'on « maîtrise »
# pour avancer dans la veine Familles. Égalité tranchée par l'ordre des clés : déterministe.
static func famille_avancee(lim: Dictionary, data: Dictionary) -> String:
	var familles: Dictionary = data["precurseurs"]["familles"]
	var meilleure: String = ""
	var k_max: float = -1.0
	for f: Variant in (lim["familles"] as Array):
		var k: float = float(familles[str(f)]["k_famille"])
		if k > k_max:
			k_max = k
			meilleure = str(f)
	return meilleure
