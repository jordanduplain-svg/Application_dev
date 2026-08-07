# Raison d'être : les 20 événements historiquement ancrés (1923-1944) — déclenchement daté déterministe
# (zéro RNG), jamais deux en attente, cooldown, effets chiffrés génériques appliqués AU CHOIX
# (l'UI les affiche avant). Porte aussi les gels (production/études), les modificateurs de
# demande temporaires et la file de presse.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Reputation := preload("res://sim/reputation.gd")
const Raids := preload("res://sim/raids.gd")
const Comptes := preload("res://sim/comptes.gd")


static func _annee(state: Dictionary) -> float:
	return Etat.AN0 + float(state["tick"]) / 52.0


static func tick_hebdo(state: Dictionary, data: Dictionary) -> void:
	var gels: Dictionary = state["gels"]
	if float(gels["production"]) > 0.0:
		gels["production"] = float(gels["production"]) - 1.0
		gels["gele_trim"] = float(gels["gele_trim"]) + 1.0
	if float(gels["etudes"]) > 0.0:
		gels["etudes"] = float(gels["etudes"]) - 1.0
	# Purge des modificateurs de demande expirés.
	var actifs: Array = []
	for m: Dictionary in state["modificateurs"]:
		if float(m["fin_tick"]) > float(state["tick"]):
			actifs.append(m)
	state["modificateurs"] = actifs
	# Déclenchement : un seul événement en attente à la fois, cooldown entre deux.
	var ev: Dictionary = state["evenements"]
	if str(ev["en_attente"]) != "":
		return
	if float(state["tick"]) - float(ev["dernier_tick"]) < float(data["events"]["cooldown_sem"]):
		return
	var annee: float = _annee(state)
	for id_ev: String in Etat.cles_triees(data["events"]["liste"]):
		if (ev["faits"] as Array).has(id_ev):
			continue
		var e: Dictionary = data["events"]["liste"][id_ev]
		if annee < float(e["des"]):
			continue
		if not _condition_ok(state, str(e["condition"])):
			# Fenêtre d'un an pour remplir la condition, sinon l'événement est manqué.
			if annee > float(e["des"]) + 1.0:
				(ev["faits"] as Array).append(id_ev)
			continue
		ev["en_attente"] = id_ev
		ev["dernier_tick"] = float(state["tick"])
		return


static func choisir(state: Dictionary, data: Dictionary, id_ev: String, choix: String) -> bool:
	var ev: Dictionary = state["evenements"]
	if str(ev["en_attente"]) != id_ev:
		return false
	var e: Dictionary = data["events"]["liste"][id_ev]
	if choix != "a" and choix != "b":
		return false
	var branche: Variant = e[choix]
	if branche == null:
		return false
	_appliquer_effets(state, data, (branche as Dictionary)["effets"])
	(ev["faits"] as Array).append(id_ev)
	ev["en_attente"] = ""
	if bool(e["presse"]):
		(state["presse"] as Array).append({"titre": str(e["titre"]), "corps": str(e["texte"])})
	return true


static func _condition_ok(state: Dictionary, condition: String) -> bool:
	match condition:
		"":
			return true
		"produit_postal":
			return _a_segment(state, "ligne_postale")
		"produit_export":
			return _a_segment(state, "export_militaire")
		"pilote_recrute":
			return (state["pilotes"] as Array).size() > 0
		"a_emprunt":
			return float(state.get("emprunt", 0.0)) > 0.0
	return true


static func _a_segment(state: Dictionary, seg: String) -> bool:
	var cat: Dictionary = state["catalogue"]
	for uid: String in Etat.cles_triees(cat):
		if str(cat[uid]["segment"]) == seg:
			return true
	return false


# Effets génériques data-driven ; chaque clé spéciale tient en quelques lignes.
static func _appliquer_effets(state: Dictionary, data: Dictionary, effets: Dictionary) -> void:
	for cle: String in Etat.cles_triees(effets):
		var v: Variant = effets[cle]
		match cle:
			"tresorerie":
				state["tresorerie"] = float(state["tresorerie"]) + float(v)
				Comptes.note(state, "evenements", float(v))
				state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) + float(v)
			"rep_civile":
				Reputation.bonus(state["rep"], "civile", float(v))
			"rep_militaire":
				Reputation.bonus(state["rep"], "militaire", float(v))
			"rep_marane_militaire":
				# La maison peut avoir disparu dans une fusion : l'effet devient sans objet.
				if (state["rivaux"] as Dictionary).has("marane"):
					Reputation.bonus(state["rivaux"]["marane"]["rep"], "militaire", float(v))
			"ministere":
				state["ministere"] = clampf(float(state.get("ministere", 0.5)) + float(v), 0.0, 1.0)
			"demande_mult", "demande_mult2":
				(state["modificateurs"] as Array).append({
					"segment": str((v as Dictionary)["segment"]),
					"mult": float((v as Dictionary)["mult"]),
					"fin_tick": float(state["tick"]) + float((v as Dictionary)["duree_sem"]),
				})
			"gel_production_sem":
				state["gels"]["production"] = float(state["gels"]["production"]) + float(v)
			"gel_etudes_sem":
				state["gels"]["etudes"] = float(state["gels"]["etudes"]) + float(v)
			"contrat_postal":
				for uid: String in Etat.cles_triees(state["catalogue"]):
					if str(state["catalogue"][uid]["segment"]) == "ligne_postale":
						state["catalogue"][uid]["carnet"] = float(state["catalogue"][uid]["carnet"]) + float(v)
						break
			"carnet_transport_mult":
				for uid: String in Etat.cles_triees(state["catalogue"]):
					if str(state["catalogue"][uid]["segment"]) == "transport_civil":
						state["catalogue"][uid]["carnet"] = floorf(float(state["catalogue"][uid]["carnet"]) * float(v))
			"prix_transport_mult":
				for uid: String in Etat.cles_triees(state["catalogue"]):
					if str(state["catalogue"][uid]["segment"]) == "transport_civil":
						state["catalogue"][uid]["prix"] = maxf(float(state["catalogue"][uid]["prix"]) * float(v), 1.0)
			"annuler_candidatures":
				(state["ao"]["candidatures"] as Dictionary).clear()
			"capacite_plafonnee":
				# Le shadow scheme est un dispositif de GUERRE, pas une nationalisation :
				# l'atelier est gelé le temps du plan, puis la maison redevient maîtresse de
				# son outil (retour playtest n°7 — un plafond à vie pour 800 000 £ fermait
				# tout le développement industriel de fin de partie).
				state["plafond_atelier"] = true
				state["plafond_atelier_fin"] = float(state["tick"]) 					+ float(data["constants"]["eco"]["plafond_atelier_sem"])
			"revelation_specs":
				state["revelation"] = true
			"retirer_pilote":
				if (state["pilotes"] as Array).size() > 0:
					(state["pilotes"] as Array).remove_at(0)
			"retirer_meilleur_ingenieur", "retirer_dernier_ingenieur":
				_retirer_ingenieur(state, cle == "retirer_meilleur_ingenieur")
			"salaire_meilleur_mult":
				var idx: int = _meilleur_ingenieur(state)
				if idx >= 0:
					state["ingenieurs"][idx]["salaire_sem"] = float(state["ingenieurs"][idx]["salaire_sem"]) * float(v)
			"raid_immediat":
				Raids.raid_scripte(state, data, str(v))
			"rappel_pret":
				# La banque rappelle son dû : la dette est exigée SÈCHE de la trésorerie.
				var du: float = float(state.get("emprunt", 0.0))
				state["emprunt"] = 0.0
				state["tresorerie"] = float(state["tresorerie"]) - du
				Comptes.note(state, "evenements", -du)
				state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - du


static func _retirer_ingenieur(state: Dictionary, meilleur: bool) -> void:
	var ings: Array = state["ingenieurs"]
	if ings.size() <= 1:
		return
	ings.remove_at(_meilleur_ingenieur(state) if meilleur else ings.size() - 1)


static func _meilleur_ingenieur(state: Dictionary) -> int:
	var ings: Array = state["ingenieurs"]
	var meilleur: int = -1
	var total_max: float = -1.0
	for i: int in range(ings.size()):
		var comp: Dictionary = ings[i]["comp"]
		var total: float = float(comp["etudes"]) + float(comp["recherche"]) + float(comp["atelier"])
		if total > total_max:
			total_max = total
			meilleur = i
	return meilleur
