# Raison d'être : les accidents en service — la fiabilité devient une affaire de vies.
# Chaque trimestre, tout produit livré SOUS le pivot de fiabilité risque l'accident
# (proba ∝ manque de fiabilité × livraisons) : une de presse, la réputation du domaine
# frappée, le carnet qui fond. Au-dessus du pivot : AUCUN risque, aucun tirage — la règle
# de conception est limpide et le flux RNG d'une flotte saine reste intact.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Rng := preload("res://sim/rng.gd")
const Reputation := preload("res://sim/reputation.gd")


static func trimestre(state: Dictionary, data: Dictionary) -> void:
	var ca: Dictionary = data["constants"]["accidents"]
	var cat: Dictionary = state["catalogue"]
	for uid: String in Etat.cles_triees(cat):
		var produit: Dictionary = cat[uid]
		var fiab: float = float(produit["specs"]["fiabilite"])
		var manque: float = float(ca["pivot_fiab"]) - fiab
		if manque <= 0.0:
			continue
		var livrees: float = _livrees_trim(state, uid, str(produit["segment"]))
		if livrees <= 0.0:
			continue
		var p: float = minf(manque * livrees * float(ca["k"]), float(ca["proba_max"]))
		if Rng.reel(state) >= p:
			continue
		var seg: Dictionary = data["segments"][str(produit["segment"])]
		# L'assurance-flotte amortit le choc (réputation et carnet) — pas le drame.
		var assure: bool = bool(state.get("assurance", false))
		var malus: float = float(ca["rep_malus_assure" if assure else "rep_malus"])
		# Contrat d'entretien : un accident sur une flotte que VOUS entretenez coûte
		# double — la fiabilité paie deux fois, en revenu comme en risque.
		if bool(state.get("entretien_flotte", false)):
			malus *= 2.0
		Reputation.bonus(state["rep"], str(seg["domaine_repu"]), -malus)
		produit["carnet"] = floorf(float(produit["carnet"])
			* float(ca["carnet_mult_assure" if assure else "carnet_mult"]))
		var nom: String = uid
		if (state["designs"] as Dictionary).has(str(produit["design_uid"])):
			nom = str(state["designs"][str(produit["design_uid"])]["design"]["nom"])
		var suite: String = " L'assurance éponge une partie du désastre." if assure \
			else " La clientèle se détourne, le carnet fond."
		(state["presse"] as Array).append({"titre": "CATASTROPHE AÉRIENNE",
			"corps": "Un %s s'écrase en service. L'enquête pointe la fiabilité (%d %%).%s" % [nom, int(roundf(fiab * 100.0)), suite]})


# Livraisons du produit sur le dernier trimestre résolu (l'historique du marché fait foi).
static func _livrees_trim(state: Dictionary, uid: String, nom_seg: String) -> float:
	var marche: Dictionary = state["marche"]
	if not marche.has(nom_seg):
		return 0.0
	var hist: Array = marche[nom_seg]["historique"]
	if hist.is_empty():
		return 0.0
	return float((hist[hist.size() - 1]["ventes"] as Dictionary).get(uid, 0.0))
