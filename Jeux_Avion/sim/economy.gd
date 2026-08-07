# Raison d'être : la trésorerie unique et la mort par asphyxie — salaires et frais
# chaque semaine, faillite après 8 semaines dans le rouge (rachat par Blochard).
extends RefCounted

const Comptes := preload("res://sim/comptes.gd")


static func tick_hebdo(state: Dictionary, data: Dictionary) -> void:
	var eco: Dictionary = data["constants"]["eco"]
	var depenses: float = float(eco["frais_fixes_sem"])
	depenses += float(eco["entretien_atelier_sem"][int(state["atelier"]["palier"]) - 1])
	for ing: Dictionary in state["ingenieurs"]:
		depenses += float(ing["salaire_sem"])
	for pilote: Dictionary in state["pilotes"]:
		depenses += float(pilote["salaire_sem"])
	# Assurance-flotte : la prime suit la taille du catalogue.
	if bool(state.get("assurance", false)):
		depenses += float(data["constants"]["accidents"]["assurance_prime_sem_par_produit"]) \
				* float((state["catalogue"] as Dictionary).size())
	# Intérêts de la dette bancaire : le loyer hebdomadaire de l'argent emprunté.
	var dette: float = float(state.get("emprunt", 0.0))
	if dette > 0.0:
		depenses += dette * float(data["constants"]["banque"]["taux_hebdo"])
	state["tresorerie"] = float(state["tresorerie"]) - depenses
	Comptes.note(state, "charges", -depenses)
	state["stats"]["charges_cumulees"] = float(state["stats"]["charges_cumulees"]) + depenses
	if float(state["tresorerie"]) < 0.0:
		state["semaines_rouge"] = float(state["semaines_rouge"]) + 1.0
		if float(state["semaines_rouge"]) >= float(eco["faillite_semaines"]):
			state["fin"] = "faillite"
	else:
		state["semaines_rouge"] = 0.0
