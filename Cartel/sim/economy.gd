# Raison d'être : le tick hebdomadaire de l'argent — production, vente, les DEUX bourses
# non fongibles (§5), le débit de blanchiment plafonné, l'horloge de la dette (§1bis) et
# la faillite. Porté de bureau-etudes/sim/economy.gd, trésorerie DÉDOUBLÉE (§13).
#
# Périmètre jalon 0 : le squelette de l'acte I, réduit aux constantes qui existent
# aujourd'hui dans data/constants.json. Tout ce qui coûte du propre plus tard (labos
# supplémentaires, engins et leur entretien §3bis, recherche §2bis, équipes §8) n'est pas
# là — c'est pourquoi les cibles 1-3 de §16 ne mesurent encore qu'un demi-jeu.
extends RefCounted

const Rng := preload("res://sim/rng.gd")


# ON FABRIQUE TOUTES LES SEMAINES, ON VEND TOUS LES TRIMESTRES (§4) : la vente a quitte
# ce fichier pour sim/marche.gd, et le stock fait le tampon entre les deux cadences. Ce
# qui reste ici est le drain hebdomadaire — precurseurs, charges fixes, blanchiment,
# dette, faillite.
#
# Retourne les kg produits cette semaine : la visibilité en a besoin (§7), et c'est la seule
# valeur du tick qui sorte d'ici — personne d'autre n'écrit dans les bourses.
static func tick_hebdo(state: Dictionary, data: Dictionary, specs: Dictionary) -> float:
	var eco: Dictionary = data["constants"]["eco"]
	var kg_produits: float = 0.0
	if not specs.is_empty():
		# Le plafond de production n'est plus la capacité nue du labo : c'est le DÉBIT de la
		# recette (§2), qui en dérive mais que le rendement, la complexité et la rareté de la
		# famille rabotent. Un procédé lent sur une famille rare ne remplit pas un labo.
		kg_produits = float(specs["debit_kg_sem"]) * float(state["part_capacite"])
		_payer_precurseurs(state, kg_produits * float(specs["cout_unitaire"]))
		state["stock_kg"] = float(state["stock_kg"]) + kg_produits
		state["stats"]["kg_produits"] = float(state["stats"]["kg_produits"]) + kg_produits
	# Charges fixes : labo, loyers, salaires déclarés. Il y a un papier, donc c'est du PROPRE.
	state["cash_propre"] = float(state["cash_propre"]) - float(eco["cout_fixe_sem"])
	_blanchir(state, data)
	_dette(state, data)
	_faillite(state, data)
	return kg_produits


# Les précurseurs se paient au marché noir tant que le tas y suffit (§5 : le sale achète du
# précurseur), et au fournisseur déclaré pour le reste — il y a une facture, donc du propre.
# C'est aussi ce qui rend l'amorçage possible : on démarre avec 0 sale.
# `ponytail:` les deux filières ne diffèrent ici QUE par la bourse. Leur prix et leur
# traçabilité distincts arrivent avec data/precurseurs.json (§14).
static func _payer_precurseurs(state: Dictionary, montant: float) -> void:
	var par_le_noir: float = minf(float(state["cash_sale"]), montant)
	state["cash_sale"] = float(state["cash_sale"]) - par_le_noir
	state["cash_propre"] = float(state["cash_propre"]) - (montant - par_le_noir)
	state["stats"]["precurseurs_sale"] = float(state["stats"]["precurseurs_sale"]) + par_le_noir
	state["stats"]["precurseurs_propre"] = \
		float(state["stats"]["precurseurs_propre"]) + (montant - par_le_noir)


# §5 : le blanchiment n'est pas une transaction et aucun bouton ne le déclenche — c'est un
# DÉBIT hebdomadaire plafonné. D'où sa place dans le tick et pas dans Sim.appliquer().
static func _blanchir(state: Dictionary, data: Dictionary) -> void:
	var cb: Dictionary = data["constants"]["blanchiment"]
	var debit: float = minf(float(state["cash_sale"]), float(cb["capacite_sem"]))
	if debit <= 0.0:
		return
	var propre: float = debit * float(cb["taux"])
	state["cash_sale"] = float(state["cash_sale"]) - debit
	state["cash_propre"] = float(state["cash_propre"]) + propre
	state["stats"]["propre_blanchi"] = float(state["stats"]["propre_blanchi"]) + propre


# §1bis : en une fois, à la date, en argent PROPRE. Le `>=` (et non `==`) est délibéré —
# levier.gd déplace l'échéance de ±30 %, et une égalité stricte raterait la semaine décalée.
static func _dette(state: Dictionary, data: Dictionary) -> void:
	var cd: Dictionary = data["constants"]["dette"]
	if float(state["dette"]) <= 0.0 or float(state["tick"]) < float(cd["echeance_sem"]):
		return
	if float(state["cash_propre"]) < float(state["dette"]):
		state["fin"] = "saisie"
		return
	state["cash_propre"] = float(state["cash_propre"]) - float(state["dette"])
	state["dette"] = 0.0


static func _faillite(state: Dictionary, data: Dictionary) -> void:
	if float(state["cash_propre"]) >= 0.0:
		state["semaines_rouge"] = 0.0
		return
	state["semaines_rouge"] = float(state["semaines_rouge"]) + 1.0
	if float(state["semaines_rouge"]) >= float(data["constants"]["eco"]["semaines_faillite"]):
		state["fin"] = "faillite"
