# Raison d'être : l'arbre des 12 technos et le pari pionnier/suiveur — chercher avant
# l'état de l'art mondial coûte ×3 et dure ×2, après ça coûte ×0.6 ; choisir SES paris.
# Les ingénieurs affectés au poste recherche accélèrent l'avancement hebdomadaire.
# Brevets : le premier pionnier (joueur ou rival) verrouille la techno 4 ans — licence
# achetable, contournement plus lent, royalties si un rival adopte VOTRE brevet.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Ingenieurs := preload("res://sim/engineers.gd")
const Comptes := preload("res://sim/comptes.gd")


# ponytail: migration à la volée des saves antérieures aux brevets.
static func brevets(state: Dictionary) -> Dictionary:
	if not state.has("brevets"):
		state["brevets"] = {}
	return state["brevets"]


# Détenteur du brevet actif sur la techno ("" si aucun ou expiré).
static func brevet_actif(state: Dictionary, id_techno: String) -> String:
	var b: Dictionary = brevets(state)
	if not b.has(id_techno) or float(b[id_techno]["expire"]) <= float(state["tick"]):
		return ""
	return str(b[id_techno]["detenteur"])


static func deposer_brevet(state: Dictionary, data: Dictionary, id_techno: String, detenteur: String) -> void:
	brevets(state)[id_techno] = {
		"detenteur": detenteur,
		"expire": float(state["tick"]) + float(data["constants"]["recherche"]["brevet_duree_sem"]),
	}


# Prérequis de lignée ("requiert" en data) : maîtrisé avant d'aller plus loin.
static func prerequis_ok(faites: Array, data: Dictionary, id_techno: String) -> bool:
	var req: String = str((data["technos"][id_techno] as Dictionary).get("requiert", ""))
	return req == "" or faites.has(req)


# Licence sur un brevet rival : cash immédiat contre la techno, sans passer par le labo.
static func acheter_licence(state: Dictionary, data: Dictionary, id_techno: String) -> bool:
	var det: String = brevet_actif(state, id_techno)
	if det == "" or det == "joueur":
		return false
	var rech: Dictionary = state["recherche"]
	if not prerequis_ok(rech["faites"], data, id_techno):
		return false
	if (rech["faites"] as Array).has(id_techno) or (rech["en_cours"] as Dictionary).has(id_techno):
		return false
	var cout: float = float(data["technos"][id_techno]["cout_base"]) \
			* float(data["constants"]["recherche"]["licence_achat_part"])
	if float(state["tresorerie"]) < cout:
		return false
	state["tresorerie"] = float(state["tresorerie"]) - cout
	Comptes.note(state, "recherche", -cout)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout
	(rech["faites"] as Array).append(id_techno)
	(rech["annees"] as Dictionary)[id_techno] = Etat.AN0 + float(state["tick"]) / 52.0
	verifier_archetypes(state, data)
	return true


static func lancer(state: Dictionary, data: Dictionary, id_techno: String) -> bool:
	var technos: Dictionary = data["technos"]
	if not technos.has(id_techno):
		return false
	var rech: Dictionary = state["recherche"]
	if (rech["faites"] as Array).has(id_techno) or (rech["en_cours"] as Dictionary).has(id_techno):
		return false
	if not prerequis_ok(rech["faites"], data, id_techno):
		return false
	var annee: float = Etat.AN0 + float(state["tick"]) / 52.0
	var tn: Dictionary = technos[id_techno]
	var cr: Dictionary = data["constants"]["recherche"]
	var cout: float = float(tn["cout_base"])
	var duree: float = float(tn["duree_sem"])
	var pionnier: bool = annee < float(tn["date_etat_art"])
	if pionnier:
		cout *= float(cr["mult_cout_pionnier"])
		duree *= float(cr["mult_duree_pionnier"])
	else:
		cout *= float(cr["mult_cout_suiveur"])
	# Brevet rival : on contourne sans licence, mais l'astuce juridique se paie en semaines.
	var det: String = brevet_actif(state, id_techno)
	if det != "" and det != "joueur":
		duree *= float(cr["mult_duree_contournement"])
	if float(state["tresorerie"]) < cout:
		return false
	state["tresorerie"] = float(state["tresorerie"]) - cout
	Comptes.note(state, "recherche", -cout)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout
	rech["en_cours"][id_techno] = duree
	if pionnier:
		if not rech.has("paris_pionniers"):
			rech["paris_pionniers"] = []
		(rech["paris_pionniers"] as Array).append(id_techno)
	return true


static func tick_hebdo(state: Dictionary, data: Dictionary) -> void:
	# Études gelées (grèves, motoriste) : le laboratoire n'avance pas cette semaine.
	if float(state["gels"]["etudes"]) > 0.0:
		return
	var rech: Dictionary = state["recherche"]
	var en_cours: Dictionary = rech["en_cours"]
	var avance: float = 1.0 + Ingenieurs.bonus(state, data, "recherche")
	for id_t: String in Etat.cles_triees(en_cours):
		en_cours[id_t] = float(en_cours[id_t]) - avance
		if float(en_cours[id_t]) <= 0.0:
			en_cours.erase(id_t)
			(rech["faites"] as Array).append(id_t)
			(rech["annees"] as Dictionary)[id_t] = Etat.AN0 + float(state["tick"]) / 52.0
			# Pari pionnier tenu et personne n'a déposé avant : le brevet est à vous.
			if (rech.get("paris_pionniers", []) as Array).has(id_t) \
					and brevet_actif(state, id_t) == "":
				deposer_brevet(state, data, id_t, "joueur")
				(state["presse"] as Array).append({"titre": "BREVET DÉPOSÉ",
					"corps": "Votre bureau brevette « %s ». Quatre ans d'exclusivité — les rivaux paieront la licence ou contourneront." % str(data["technos"][id_t]["nom"])})
			verifier_archetypes(state, data)


# Un archétype (combo de technos, data/archetypes.json) nouvellement complet devient un
# préréglage chargeable au Bureau — annoncé une seule fois par la presse.
static func verifier_archetypes(state: Dictionary, data: Dictionary) -> void:
	if not state.has("archetypes"):  # ponytail: migration à la volée des vieux saves
		state["archetypes"] = []
	var faites: Array = state["recherche"]["faites"]
	for id_a: String in Etat.cles_triees(data["archetypes"]):
		if (state["archetypes"] as Array).has(id_a):
			continue
		var complet: bool = true
		for req_v: Variant in data["archetypes"][id_a]["requiert"]:
			if not faites.has(str(req_v)):
				complet = false
				break
		if complet:
			(state["archetypes"] as Array).append(id_a)
			(state["presse"] as Array).append({"titre": "UNE FORMULE EST NÉE",
				"corps": str(data["archetypes"][id_a]["presse"])})
