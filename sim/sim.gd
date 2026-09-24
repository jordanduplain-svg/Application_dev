# Raison d'être : LE point d'entrée unique de mutation du state — tick hebdomadaire et
# intentions de l'UI (appliquer) ; personne d'autre n'écrit dans le state.
# Porté tel quel de bureau-etudes/sim/sim.gd (§13 : socle).
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Economie := preload("res://sim/economy.gd")
const Visibilite := preload("res://sim/visibilite.gd")
const Produit := preload("res://sim/produit.gd")
const Marche := preload("res://sim/marche.gd")
const Recherche := preload("res://sim/recherche.gd")


static func nouvelle_partie(graine: int, data: Dictionary) -> Dictionary:
	# Canonisation JSON immédiate : tous les nombres deviennent des float, comme après un
	# save/load — le run « frais » et le run « rechargé » vivent pareil.
	var state: Dictionary = Etat.nouvelle_partie(graine, data)
	Marche.init_rivaux(state, data)
	return Etat.canonique(state)


static func tick(state: Dictionary, data: Dictionary) -> void:
	if str(state["fin"]) != "":
		return
	state["tick"] = float(state["tick"]) + 1.0
	# LA RECHERCHE AVANCE EN TETE DE TICK (§2bis) : un noeud livre cette semaine elargit
	# l'ecran de conception pour la decision de la semaine SUIVANTE, parce que le joueur
	# decide avant que la semaine ne s'ecoule. L'ordre est une regle de jeu.
	Recherche.tick_hebdo(state, data)
	# Les sept specs, calculées UNE fois par tick et passées à qui en a besoin. Les
	# recalculer dans chaque module donnerait deux vérités pour une recette le jour où une
	# formule bouge, et la seconde serait découverte par un joueur.
	var specs: Dictionary = {}
	if not (state["recette"] as Dictionary).is_empty():
		specs = Produit.specs(state["recette"], data)
	var kg: float = Economie.tick_hebdo(state, data, specs)
	# La visibilité lit le tas de sale APRÈS le blanchiment de la semaine : ce qui est parti
	# au lavage ne t'accuse plus. L'ordre est une règle de jeu, pas un détail d'implémentation.
	Visibilite.tick_hebdo(state, data, kg, float(specs.get("signature", 0.0)))
	# Le marche se resout au TRIMESTRE (§4), la production reste hebdomadaire. L'ordre
	# compte : on vend le stock de la semaine qui vient d'etre produite, pas celui d'avant.
	if int(state["tick"]) % int(data["constants"]["sim"]["semaines_par_trimestre"]) == 0:
		Marche.trimestre(state, data, specs)
	if float(state["tick"]) >= float(data["constants"]["sim"]["semaines_max"]) \
			and str(state["fin"]) == "":
		state["fin"] = "fin_campagne"
	Etat.valider(state)


static func appliquer(state: Dictionary, data: Dictionary, intention: Dictionary) -> bool:
	if str(state["fin"]) != "":
		return false
	match str(intention["type"]):
		"recette":
			return _recette(state, data, intention)
		"production":
			return _production(state, intention)
		"prix":
			return _prix(state, data, intention)
		"recherche":
			return Recherche.lancer(state, data, str(intention["noeud"]))
	return false


# Les six paramètres de §2, normalisés par sim/produit.gd — c'est lui qui connaît les
# plages, pas ce fichier. Le state ne garde que des recettes valides : une recette hors
# bornes n'est pas refusée, elle est ramenée dans le domaine, comme un curseur d'écran qui
# s'arrête en butée.
static func _recette(state: Dictionary, data: Dictionary, intention: Dictionary) -> bool:
	state["recette"] = Produit.normaliser(intention.get("recette", {}), data,
		Recherche.ouvertures(state, data))
	return true


# Le prix est au JOUEUR (§4) : le marche ne le fixe pas, il le juge par `f_prix`. Un prix
# nul veut dire « pas en vente » et sort le produit de la lice de CE segment.
#
# Deux formes, et la seconde n'est pas un raccourci de confort : `{"prix": x}` sans segment
# pose le meme prix partout, ce qui est exactement le comportement d'avant §19bis. C'est ce
# qui a permis de livrer le mecanisme a resultat bit-identique, puis de mesurer separement
# ce que la DIFFERENCIATION change — deux changements melanges n'auraient rien mesure.
static func _prix(state: Dictionary, data: Dictionary, intention: Dictionary) -> bool:
	var prix: Dictionary = state["prix"]
	var valeur: float = maxf(float(intention["prix"]), 0.0)
	var segments: Dictionary = data["segments"]["segments"]
	if intention.has("segment"):
		var seg: String = str(intention["segment"])
		if not segments.has(seg):
			return false
		prix[seg] = valeur
		return true
	for seg2: String in segments:
		prix[seg2] = valeur
	return true


static func _production(state: Dictionary, intention: Dictionary) -> bool:
	state["part_capacite"] = clampf(float(intention["part"]), 0.0, 1.0)
	return true
