# Raison d'être : le verdict de mai 1945 — score du meilleur appareil militaire EN SERVICE
# contre le Fw 190 D (benchmark data), composite avec livraisons et réputations, verdict
# 4 niveaux (+ faillite), et sélection des fragments d'épilogue : la trajectoire d'entreprise,
# le destin des rivaux et des pilotes. Fonctions PURES : rien n'est écrit dans le state.
extends RefCounted

const Etat := preload("res://sim/state.gd")


# Retourne {"verdict": id, "score": float, "vmax_meilleur": float, "fragments": [[id, texte], ...]}.
static func bilan(state: Dictionary, data: Dictionary) -> Dictionary:
	var narrative: Dictionary = _charger_narrative()
	var fin: Dictionary = data["constants"]["fin"]
	var moderne: Dictionary = _modernite(state, fin)
	var verdict: String = "faillite"
	var score: float = 0.0
	if str(state["fin"]) != "faillite":
		var p: Dictionary = fin["poids_verdict"]
		score = float(p["modernite"]) * float(moderne["score"]) \
			+ float(p["livraisons"]) * clampf(float(state["stats"]["livraisons"]) / float(fin["livraisons_cible"]), 0.0, 1.0) \
			+ float(p["rep_militaire"]) * float(state["rep"]["militaire"]) \
			+ float(p["rep_civile"]) * float(state["rep"]["civile"])
		var seuils: Dictionary = fin["seuils"]
		verdict = "oubliee"
		if score >= float(seuils["legende"]):
			verdict = "legende"
		elif score >= float(seuils["pilier"]):
			verdict = "pilier"
		elif score >= float(seuils["sous_traitant"]):
			verdict = "sous_traitant"
	var fragments: Array = []
	for id_f: Variant in _selection(state, data, moderne):
		var gabarit: String = str(narrative["fragments"][str((id_f as Array)[0])])
		fragments.append([str((id_f as Array)[0]), gabarit % (id_f as Array)[1] if gabarit.contains("%") else gabarit])
	var v: Dictionary = narrative["verdicts"][verdict]
	return {"verdict": verdict, "titre": str(v["titre"]), "texte": str(v["texte"]),
		"score": score, "fragments": fragments}


static func _charger_narrative() -> Dictionary:
	var texte: String = FileAccess.get_file_as_string("res://narrative/fr.json")
	return JSON.parse_string(texte)


# Meilleur produit export en service vs benchmark (le Bf 109E ne pardonne pas).
static func _modernite(state: Dictionary, fin: Dictionary) -> Dictionary:
	var bench: Dictionary = fin["benchmark"]
	var meilleur: float = 0.0
	var vmax: float = 0.0
	for uid: String in Etat.cles_triees(state["catalogue"]):
		var p: Dictionary = state["catalogue"][uid]
		if str(p["segment"]) != "export_militaire":
			continue
		var sp: Dictionary = p["specs"]
		var r_v: float = float(sp["vmax_kmh"]) / float(bench["vmax_kmh"])
		var r_a: float = float(sp["armement"]) / float(bench["armement"])
		var r_p: float = float(sp["plafond_m"]) / float(bench["plafond_m"])
		# Pondérée PUIS bridée par la capacité la plus faible : une moyenne seule compressait un
		# écart catastrophique en un score honorable — un chasseur de 1938 à 409 km/h face aux
		# 700 du Fw 190 D marquait 0.64 et valait « pilier de l'aviation britannique » (playtest
		# n°11). Même remède que `critique_seuil` au marché : on ne rachète pas une capacité
		# effondrée sur les autres. En 1945, un avion qui ne suit pas n'est pas 64 % moderne.
		var s: float = (0.5 * clampf(r_v, 0.0, 1.2) + 0.3 * clampf(r_a, 0.0, 1.2)
			+ 0.2 * clampf(r_p, 0.0, 1.2)) \
			* clampf(minf(r_v, minf(r_a, r_p)), float(fin["modernite_plancher"]), 1.0)
		if s > meilleur:
			meilleur = s
			vmax = float(sp["vmax_kmh"])
	return {"score": meilleur, "vmax": vmax}


# Un fragment par thème (trajectoire, atelier, labo, AO, épreuves, rivaux, caisse, équipe),
# tous les pilotes (lignes garanties). Chaque entrée : [id, argument de format ou null].
static func _selection(state: Dictionary, data: Dictionary, moderne: Dictionary) -> Array:
	var ids: Array = []
	var ventes: Dictionary = _ventes_par_segment(state)
	var total: float = maxf(float(ventes["ligne_postale"]) + float(ventes["transport_civil"]) + float(ventes["export_militaire"]), 1.0)
	# Trajectoire commerciale.
	if float(ventes["export_militaire"]) / total > 0.5:
		ids.append(["arsenal", null])
	elif float(ventes["transport_civil"]) / total > 0.5:
		ids.append(["roi_transport", null])
	elif float(ventes["ligne_postale"]) / total > 0.4:
		ids.append(["postal_fidele", null])
	elif total > 30.0:
		ids.append(["touche_a_tout", null])
	if float(ventes["postal_crise"]) >= 15.0:
		ids.append(["postal_crise", null])
	# Atelier.
	if bool(state["plafond_atelier"]):
		ids.append(["atelier_nationalise", null])
	elif int(state["atelier"]["palier"]) >= 3:
		ids.append(["expansion_max", null])
	# Laboratoire.
	var faites: int = (state["recherche"]["faites"] as Array).size()
	if (state["recherche"]["faites"] as Array).has("soufflerie_interne"):
		ids.append(["soufflerie", null])
	elif faites >= 8:
		ids.append(["pionniere", null])
	elif faites <= 2:
		ids.append(["artisanale", null])
	# Concours d'État.
	var victoires_ao: int = 0
	for id_ao: String in Etat.cles_triees(state["ao"]["resolutions"]):
		if str(state["ao"]["resolutions"][id_ao]["vainqueur"]) == "joueur":
			victoires_ao += 1
	var idx_ao: int = 0
	if victoires_ao >= 3:
		idx_ao = 2
	elif victoires_ao >= 1:
		idx_ao = 1
	ids.append([["ao_zero", "ao_fournisseur", "ao_maison"][idx_ao], null])
	# Épreuves et pilotes (lignes garanties).
	var raids_ok: bool = false
	for r: Dictionary in state["palmares"]:
		if bool(r["succes"]):
			raids_ok = true
	if raids_ok:
		ids.append(["raid_reussi", null])
	for pilote: Dictionary in state["pilotes"]:
		ids.append([("pilote_legende" if float(pilote["celebrite"]) >= 0.8 else "pilote_fidele"), str(pilote["nom"])])
	for nom: Variant in state["memorial"]:
		ids.append(["memorial", str(nom)])
	if (state["pilotes"] as Array).is_empty() and (state["memorial"] as Array).is_empty():
		ids.append(["aucun_pilote", null])
	# Rivaux.
	var rep_j: float = float(state["rep"]["civile"]) + float(state["rep"]["militaire"])
	# Après une fusion il ne reste qu'une maison : on lit ce qui existe, jamais une clé en dur.
	var reps: Dictionary = {}
	for maison: String in Etat.cles_triees(state["rivaux"]):
		reps[maison] = float(state["rivaux"][maison]["rep"]["civile"]) 			+ float(state["rivaux"][maison]["rep"]["militaire"])
	var rep_b: float = float(reps.get("blochard", reps.values()[0] if reps.size() > 0 else 0.0))
	var rep_m: float = float(reps.get("marane", reps.values()[0] if reps.size() > 0 else 0.0))
	if rep_j > rep_b and rep_j > rep_m:
		ids.append(["rivaux_effaces", null])
	elif rep_m >= 1.0:
		ids.append(["marane_prestige", null])
	elif float((state["rivaux"] as Dictionary).get("blochard", {}).get("nb_produits", 0.0)) >= 9.0:
		ids.append(["blochard_domine", null])
	else:
		ids.append(["duel_permanent", null])
	# La caisse et l'équipe.
	if float(state["tresorerie"]) > 10000000.0:
		ids.append(["fortune", null])
	elif float(state["tresorerie"]) < 500000.0 and str(state["fin"]) != "faillite":
		ids.append(["ric_rac", null])
	if (state["ingenieurs"] as Array).size() >= 12:
		ids.append(["grande_maison", null])
	else:
		for ing: Dictionary in state["ingenieurs"]:
			if ["Hartley", "Whitcombe", "Clarke"].has(str(ing["nom"])):
				ids.append(["equipe_fondatrice", null])
				break
	if (state["evenements"]["faits"] as Array).has("1939_mobilisation"):
		ids.append(["equipe_saignee", null])
	var moral_moyen: float = 0.0
	for ing: Dictionary in state["ingenieurs"]:
		moral_moyen += float(ing["moral"])
	moral_moyen /= maxf(float((state["ingenieurs"] as Array).size()), 1.0)
	if moral_moyen >= 0.85:
		ids.append(["moral_haut", null])
	elif moral_moyen < 0.5:
		ids.append(["moral_bas", null])
	if bool(state["revelation"]):
		ids.append(["salon_vitrine", null])
	# La flotte et le benchmark.
	if float(moderne["score"]) <= 0.0:
		ids.append(["sans_armes", null])
	else:
		ids.append(["benchmark_detail", int(moderne["vmax"])])
	if float(state["stats"]["livraisons"]) > 300.0:
		ids.append(["grosse_flotte", null])
	elif float(state["stats"]["livraisons"]) < 50.0:
		ids.append(["petite_serie", null])
	return ids


# Ventes du joueur par segment depuis l'historique du marché (+ postal pendant la crise 30-34).
static func _ventes_par_segment(state: Dictionary) -> Dictionary:
	var totaux: Dictionary = {"ligne_postale": 0.0, "transport_civil": 0.0, "export_militaire": 0.0, "postal_crise": 0.0}
	var marche: Dictionary = state["marche"]
	for nom_seg: String in Etat.cles_triees(marche):
		for h: Dictionary in marche[nom_seg]["historique"]:
			for uid: String in h["ventes"]:
				if not uid.begins_with("p"):
					continue
				totaux[nom_seg] = float(totaux[nom_seg]) + float(h["ventes"][uid])
				if nom_seg == "ligne_postale" and float(h["annee"]) >= 1930.0 and float(h["annee"]) <= 1934.9:
					totaux["postal_crise"] = float(totaux["postal_crise"]) + float(h["ventes"][uid])
	return totaux
