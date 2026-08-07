# Raison d'être : les 3 bots stratégiques du §15.2 (glouton-civil, pionnier-militaire,
# équilibré) — fonctions pures et déterministes du state, paramétrées par un dict de
# stratégie ; ne servent qu'à l'équilibrage par simulation.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Avion := preload("res://sim/aircraft.gd")
const Marche := preload("res://sim/market.gd")
const Contrats := preload("res://sim/contracts.gd")


static func strategies() -> Dictionary:
	return {
		"glouton_civil": {
			"pricing": 1.20,
			"postal": false,
			"transport": true,
			"export_depuis": 9999.0,
			"pionnier": false,
			"technos": ["radio_embarquee", "capot_naca", "monocoque_metal", "cockpit_ferme", "volets_atterrissage"],
			"seuil_recherche": 250000.0,
			"exp_carnet": 1.0,
			"exp_marge": 200000.0,
			"cycle": 104,
			"buffer_proto": 50000.0,
			"fievre_debut": 1927.5,
			"fievre_fin": 1929.8,
		},
		"pionnier_militaire": {
			"pricing": 1.30,
			"postal": true,
			"transport": false,
			"export_depuis": 1929.0,
			"pionnier": true,
			"technos": ["suralimentation", "helice_pas_variable", "train_rentrant", "capot_naca", "canon_moteur", "monocoque_metal"],
			"seuil_recherche": 250000.0,
			"exp_carnet": 1.2,
			"exp_marge": 600000.0,
			"cycle": 156,
			"buffer_proto": 250000.0,
			"fievre_debut": 0.0,
			"fievre_fin": 0.0,
		},
		"equilibre": {
			"pricing": 1.26,
			"postal": true,
			"transport": true,
			"export_depuis": 1931.0,
			"pionnier": false,
			# Sélectif comme un vrai joueur : les technos à fort impact, pas les gadgets —
			# la liste vide (= tout par date) diluait la R&D depuis le passage à 23 technos.
			"technos": ["radio_embarquee", "capot_naca", "monocoque_metal", "cockpit_ferme",
				"volets_atterrissage", "suralimentation", "helice_pas_variable", "train_rentrant",
				"canon_moteur"],
			"seuil_recherche": 250000.0,
			"exp_carnet": 1.0,
			"exp_marge": 400000.0,
			"cycle": 156,
			"buffer_proto": 250000.0,
			"fievre_debut": 0.0,
			"fievre_fin": 0.0,
		},
	}


static func agir(state: Dictionary, data: Dictionary, strat: Dictionary) -> void:
	var tick: int = int(state["tick"])
	var annee: float = Marche.annee_de(state)
	# Les événements ne restent jamais en attente : le bot suit le choix conseillé en data.
	var en_attente: String = str(state["evenements"]["en_attente"])
	if en_attente != "":
		Sim.appliquer(state, data, {"type": "choisir_evenement", "id": en_attente,
			"choix": str(data["events"]["liste"][en_attente]["choix_bot"])})
	state["presse"] = []
	if tick == 0:
		# Le postal est le filet de sécurité anti-crise — le glouton n'en a pas.
		_produit(state, data, "ligne_postale" if bool(strat["postal"]) else "transport_civil", strat)
	if tick >= 60 and tick % 26 == 8:
		if bool(strat["transport"]) and not _a_segment(state, "transport_civil"):
			_produit(state, data, "transport_civil", strat)
		elif annee >= float(strat["export_depuis"]) and not _a_segment(state, "export_militaire"):
			_produit(state, data, "export_militaire", strat)
	if tick > 0 and tick % int(strat["cycle"]) == 0:
		var seg: String = ""
		if annee >= float(strat["export_depuis"]):
			seg = "export_militaire"
		elif bool(strat["transport"]):
			seg = "transport_civil"
		elif bool(strat["postal"]):
			# Sans ce repli, le profil postal traverse la crise avec son biplan de 1922.
			seg = "ligne_postale"
		if seg != "":
			if (state["catalogue"] as Dictionary).size() >= int(data["constants"]["eco"]["max_produits"]):
				Sim.appliquer(state, data, {"type": "retirer_produit", "produit": _plus_vieux(state)})
			_produit(state, data, seg, strat)
	_recherche(state, data, strat, annee)
	_expansion(state, data, strat)
	_dispersion(state, data)
	# Candidature systématique aux concours ouverts avec le produit LE PLUS RÉCENT du
	# segment visé (les commandes civiles ont le leur) — gratuit, donc tous les profils
	# le font ; seuls les bons designs gagnent.
	var cat: Dictionary = state["catalogue"]
	for id_ao: String in Contrats.ouverts(state, data):
		if (state["ao"]["candidatures"] as Dictionary).has(id_ao):
			continue
		var ao_d: Dictionary = data["contracts"]["programmes"][id_ao]
		var seg_ao: String = str(ao_d.get("segment", "export_militaire"))
		var uid_c: String = ""
		var annee_max: float = -1.0
		for uid: String in Etat.cles_triees(cat):
			if str(cat[uid]["segment"]) == seg_ao and float(cat[uid]["annee"]) > annee_max:
				annee_max = float(cat[uid]["annee"])
				uid_c = uid
		# Discipline de coût : gagner un concours dont le prix fixe est sous le coût de
		# production est un suicide (série à marge négative + atelier réquisitionné).
		if uid_c != "" and float(cat[uid_c]["specs"]["cout_unitaire"]) <= float(ao_d["prix_unitaire"]):
			Sim.appliquer(state, data, {"type": "candidater_ao", "ao": id_ao, "produit": uid_c})


static func _recherche(state: Dictionary, data: Dictionary, strat: Dictionary, annee: float) -> void:
	if not (state["recherche"]["en_cours"] as Dictionary).is_empty():
		return
	var liste: Array = strat["technos"]
	if liste.is_empty():
		liste = []
		var paires: Array = []
		for id_t: String in Etat.cles_triees(data["technos"]):
			if id_t == "soufflerie_interne":
				continue
			paires.append([float(data["technos"][id_t]["date_etat_art"]), id_t])
		paires.sort()
		for p: Array in paires:
			liste.append(str(p[1]))
	var faites: Array = state["recherche"]["faites"]
	var cr: Dictionary = data["constants"]["recherche"]
	for id_v: Variant in liste:
		var id_t: String = str(id_v)
		if faites.has(id_t):
			continue
		if not bool(strat["pionnier"]) and annee < float(data["technos"][id_t]["date_etat_art"]):
			continue
		# Plancher POST-achat : on ne lance que si le coût effectif laisse un coussin —
		# épargner en brûlant du cash vers un gros seuil est un piège mortel.
		var cout_eff: float = float(data["technos"][id_t]["cout_base"])
		if annee < float(data["technos"][id_t]["date_etat_art"]):
			cout_eff *= float(cr["mult_cout_pionnier"])
		else:
			cout_eff *= float(cr["mult_cout_suiveur"])
		if float(state["tresorerie"]) > cout_eff + float(strat["seuil_recherche"]):
			Sim.appliquer(state, data, {"type": "lancer_recherche", "techno": id_t})
		return


static func _expansion(state: Dictionary, data: Dictionary, strat: Dictionary) -> void:
	var eco: Dictionary = data["constants"]["eco"]
	var palier: int = int(state["atelier"]["palier"])
	var paliers: Array = eco["paliers_atelier"]
	if palier >= paliers.size():
		return
	var carnet_total: float = 0.0
	for uid: String in Etat.cles_triees(state["catalogue"]):
		carnet_total += float(state["catalogue"][uid]["carnet"])
	# Fièvre d'expansion (glouton) : dans sa fenêtre historique (Lindbergh → 1931),
	# il agrandit dès que le cash le permet — le carnet ment quand le boom absorbe tout.
	var annee: float = Marche.annee_de(state)
	var fievre: bool = annee >= float(strat["fievre_debut"]) and annee <= float(strat["fievre_fin"]) \
			and float(strat["fievre_debut"]) > 0.0
	var carnet_ok: bool = fievre \
			or carnet_total > float(strat["exp_carnet"]) * float(paliers[palier - 1])
	if carnet_ok and float(state["tresorerie"]) > float(eco["cout_palier"][palier]) + float(strat["exp_marge"]):
		Sim.appliquer(state, data, {"type": "agrandir_atelier"})


# DISPERSION DES CHAÎNES : la parade aux raids, achetée dès qu'un bot en a confortablement les
# moyens. Sans ça les bots subissaient les bombardements SANS pouvoir s'en protéger, alors que
# le joueur le peut — le harnais mesurait cette asymétrie et pas la mécanique (même piège que
# le sur-mesure de voilure, playtest n°7). Toute capacité donnée au joueur doit l'être aux bots.
static func _dispersion(state: Dictionary, data: Dictionary) -> void:
	if bool(state.get("dispersion", false)):
		return
	var cb: Dictionary = data["constants"].get("bombardements", {})
	if cb.is_empty():
		return
	var annee: float = Marche.annee_de(state)
	# On se protège AVANT les raids, pas pendant : deux ans de marge sur la date d'ouverture.
	if annee < float(cb["annee_debut"]) - 2.0 or annee > float(cb["annee_fin"]):
		return
	var cout: float = float(cb["cout_dispersion"])
	if float(state["tresorerie"]) > cout * 3.0:
		Sim.appliquer(state, data, {"type": "disperser_chaines"})


static func _produit(state: Dictionary, data: Dictionary, seg: String, strat: Dictionary) -> void:
	var annee: float = Marche.annee_de(state)
	var faites: Array = state["recherche"]["faites"]
	var candidates: Array = ["capot_naca", "helice_pas_variable", "train_rentrant",
		"cockpit_ferme", "volets_atterrissage"]
	if seg == "export_militaire":
		candidates.append_array(["suralimentation", "canon_moteur", "reservoirs_largables"])
	var features: Array = []
	for f: String in candidates:
		if faites.has(f):
			features.append(f)
	var structure: String = "bois"
	if faites.has("monocoque_metal"):
		structure = "metal"
	elif annee >= 1931.0:
		structure = "mixte"
	var design: Dictionary = {
		"nom": "Bot " + seg,
		"annee": annee,
		"formule": "monoplan" if annee >= 1930.0 else "biplan",
		"structure": structure,
		"moteur": Avion.meilleur_moteur(data, annee, "puissance" if seg == "export_militaire" else "eco"),
		"armement": 0,
		"features": features,
	}
	var kg_pax: float = float(data["constants"]["avion"]["kg_par_passager"])
	match seg:
		"ligne_postale":
			design["surface"] = 30.0
			design["carburant_kg"] = 900.0
			design["charge_utile_kg"] = 250.0
		"transport_civil":
			design["surface"] = 45.0
			design["carburant_kg"] = 500.0
			design["charge_utile_kg"] = kg_pax * (3.0 + (annee - Etat.AN0))
		"export_militaire":
			design["surface"] = 18.0
			design["carburant_kg"] = 350.0
			design["charge_utile_kg"] = 0.0
			design["armement"] = int(roundf(Marche.interp(_ref_critere(data, seg, "armement"), annee)))
	# Un vrai joueur taille sa voilure sur le segment (il lit la note marché) : les bots le font
	# aussi, sinon ils sont mécaniquement perdants face aux rivaux qui, eux, optimisent.
	design["surface"] = Marche.meilleure_surface(data, seg, design)
	var uid_design: String = "d%d" % int(state["prochain_id"])
	if not Sim.appliquer(state, data, {"type": "nouveau_design", "design": design}):
		return
	var specs_d: Dictionary = state["designs"][uid_design]["specs"]
	# Discipline de trésorerie : les prudents gardent un coussin pour RENOUVELER
	# (l'entrée initiale sur le marché, elle, se fait quoi qu'il en coûte).
	var buffer: float = 0.0
	if not (state["catalogue"] as Dictionary).is_empty():
		buffer = float(strat["buffer_proto"])
	if float(state["tresorerie"]) < float(specs_d["cout_proto"]) + buffer:
		return
	var prix: float = float(specs_d["cout_unitaire"]) * float(strat["pricing"])
	Sim.appliquer(state, data, {"type": "lancer_produit", "design": uid_design, "segment": seg, "prix": prix})


static func _a_segment(state: Dictionary, seg: String) -> bool:
	var cat: Dictionary = state["catalogue"]
	for uid: String in cat:
		if str(cat[uid]["segment"]) == seg:
			return true
	return false


static func _plus_vieux_segment(state: Dictionary, seg: String) -> String:
	var cat: Dictionary = state["catalogue"]
	var vieux: String = ""
	var annee_min: float = 1e18
	for uid: String in Etat.cles_triees(cat):
		if str(cat[uid]["segment"]) == seg and float(cat[uid]["annee"]) < annee_min:
			annee_min = float(cat[uid]["annee"])
			vieux = uid
	return vieux


static func _plus_vieux(state: Dictionary) -> String:
	var cat: Dictionary = state["catalogue"]
	var vieux: String = ""
	var annee_min: float = 1e18
	for uid: String in Etat.cles_triees(cat):
		if float(cat[uid]["annee"]) < annee_min:
			annee_min = float(cat[uid]["annee"])
			vieux = uid
	return vieux


static func _ref_critere(data: Dictionary, seg: String, nom: String) -> Array:
	for crit: Dictionary in data["segments"][seg]["criteres"]:
		if str(crit["nom"]) == nom:
			return crit["ref"]
	return [[1925.0, 1.0]]
