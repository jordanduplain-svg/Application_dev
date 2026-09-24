# Raison d'être : §2bis — l'arbre de recherche, branche Chimie. Un nœud à la fois, payé en
# `cash_propre` d'avance, livré après N semaines. Ce qu'il livre n'est JAMAIS un nombre :
# c'est une borne de l'écran de conception qui recule (§2).
#
# ÉCRIT ICI, PAS PORTÉ. §13 ne reprend de `bureau-etudes` que le socle et le marché ; son
# `research.gd` portait un modèle de brevets et de concours qui n'a rien à faire ici.
#
# AUCUN NOMBRE D'ÉQUILIBRAGE DANS CE FICHIER (§14) : les coûts, les durées, l'arbre et les
# ouvertures de départ vivent tous dans data/procedes.json.
#
# LA PROMESSE QUE CE FICHIER DOIT TENIR, et c'est la seule de §2bis qui puisse être fausse
# en silence : **la recherche n'est jamais un prérequis de survie.** Une partie entière est
# jouable sans rien chercher — plus pauvre, plus discrète, parfaitement viable. C'est la
# trajectoire du bot `discret`, et la cible 23 de §16 la mesure campagne par campagne.
extends RefCounted

const Etat := preload("res://sim/state.gd")

# Les quatre seules choses qu'un nœud peut ouvrir. La liste est FERMÉE, et c'est elle qui
# rend vraie la phrase « elle ne donne aucun bonus numérique direct » (§2bis) : une clé de
# plus dans un `ouvre` de data/procedes.json et la promesse tombe, sans qu'une seule ligne
# de code change. tests/run.gd la vérifie contre le fichier de données.
const OUVERTURES: PackedStringArray = ["famille", "purete_max", "complexite_max",
	"stabilisation_max"]


# Ce que le joueur a le droit de concevoir AUJOURD'HUI : les ouvertures de départ, élargies
# par chaque nœud acquis. Les bornes se prennent au PLUS LARGE — deux nœuds qui repoussent
# la même borne ne s'additionnent pas, le meilleur gagne.
static func ouvertures(state: Dictionary, data: Dictionary) -> Dictionary:
	var depart: Dictionary = data["procedes"]["ouvertures_depart"]
	var familles: Array = (depart["familles"] as Array).duplicate()
	var limites: Dictionary = {
		"familles": familles,
		# LA BUTEE NE S'ELARGIT PAS. Elle est declaree dans les donnees et ne bouge jamais :
		# un repli qui suit la recherche est un repli decide par l'alphabet (voir le
		# commentaire de data/procedes.json).
		"famille_defaut": str(depart["famille_defaut"]),
		"purete_max": float(depart["purete_max"]),
		"complexite_max": float(depart["complexite_max"]),
		"stabilisation_max": float(depart["stabilisation_max"]),
	}
	var noeuds: Dictionary = data["procedes"]["noeuds"]
	for id: String in Etat.cles_triees(state["recherche"]["acquis"]):
		if not noeuds.has(id):
			continue
		var ouvre: Dictionary = noeuds[id]["ouvre"]
		if ouvre.has("famille") and not familles.has(str(ouvre["famille"])):
			familles.append(str(ouvre["famille"]))
		for cle: String in ["purete_max", "complexite_max", "stabilisation_max"]:
			if ouvre.has(cle):
				limites[cle] = maxf(float(limites[cle]), float(ouvre[cle]))
	familles.sort()
	return limites


# Un nœud est disponible s'il n'est pas déjà acquis et si tous ses prérequis le sont. Il
# n'est pas dit ici s'il est PAYABLE : c'est au joueur (ou au bot) de regarder sa bourse,
# et un écran qui masquerait ce qu'on ne peut pas s'offrir cacherait l'objectif (§12bis).
static func disponibles(state: Dictionary, data: Dictionary) -> Array:
	var acquis: Dictionary = state["recherche"]["acquis"]
	var noeuds: Dictionary = data["procedes"]["noeuds"]
	var liste: Array = []
	for id: String in Etat.cles_triees(noeuds):
		if acquis.has(id):
			continue
		var pret: bool = true
		for req: Variant in (noeuds[id]["prerequis"] as Array):
			if not acquis.has(str(req)):
				pret = false
		if pret:
			liste.append(id)
	return liste


# UN SEUL CHANTIER À LA FOIS. Ce n'est pas une limite de confort : sans elle, la recherche
# cesse d'être un arbitrage (« lequel d'abord ? ») pour devenir une file d'attente qu'on
# remplit une fois et qu'on oublie — et §2bis dit qu'elle ouvre des CHOIX.
#
# Le coût part en propre immédiatement. Il n'y a pas de remboursement, pas d'annulation :
# un chantier lancé est de l'argent dépensé, ce qui est exactement ce qui rend le choix
# coûteux.
static func lancer(state: Dictionary, data: Dictionary, id: String) -> bool:
	if str(state["recherche"]["en_cours"]) != "":
		return false
	if not disponibles(state, data).has(id):
		return false
	var noeud: Dictionary = data["procedes"]["noeuds"][id]
	var cout: float = float(noeud["cout_propre"])
	# EN PROPRE, et c'est le cœur de §2bis : le sale n'achète rien d'enregistré (§5). Un
	# labo, des réactifs et un chimiste laissent un papier. D'où le fait que le rythme de
	# la recherche soit étranglé par le blanchiment sans qu'on ait eu à l'inventer.
	if float(state["cash_propre"]) < cout:
		return false
	state["cash_propre"] = float(state["cash_propre"]) - cout
	state["recherche"]["en_cours"] = id
	state["recherche"]["semaines_restantes"] = float(noeud["semaines"])
	state["stats"]["propre_recherche"] = float(state["stats"]["propre_recherche"]) + cout
	return true


# Le TEMPS de §2bis. Appelé en tête de tick : un nœud qui se termine cette semaine est
# utilisable pour la conception de la semaine SUIVANTE, parce que le bot (comme le joueur)
# décide avant que la semaine ne s'écoule. L'ordre est une règle de jeu, pas un détail.
static func tick_hebdo(state: Dictionary, _data: Dictionary) -> void:
	var rech: Dictionary = state["recherche"]
	if str(rech["en_cours"]) == "":
		return
	rech["semaines_restantes"] = float(rech["semaines_restantes"]) - 1.0
	if float(rech["semaines_restantes"]) > 0.0:
		return
	(rech["acquis"] as Dictionary)[str(rech["en_cours"])] = 1.0
	rech["en_cours"] = ""
	rech["semaines_restantes"] = 0.0
