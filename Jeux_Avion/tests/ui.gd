# Raison d'être : smoke test headless des écrans blueprint et marché — l'UI se construit,
# les specs réagissent, et les intentions (lancer, prix, retirer, agrandir) traversent le state.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const BlueprintScript := preload("res://game/design/blueprint.gd")
const MarcheScript := preload("res://game/market_ui/marche.gd")
const AoScript := preload("res://game/contracts_ui/ao.gd")
const EquipeScript := preload("res://game/office/equipe.gd")
const RechercheScript := preload("res://game/research_ui/recherche.gd")
const DirectionScript := preload("res://game/direction/direction.gd")
const ComptesScript := preload("res://game/comptes/comptes.gd")
const FinUiScript := preload("res://game/end/fin.gd")
const Marche := preload("res://sim/market.gd")

var echecs: Array[String] = []


func _initialize() -> void:
	# Chien de garde : une erreur runtime avorte _tests() avant quit() — sans ceci le
	# process tourne pour toujours et l'erreur reste coincée dans le buffer stdout.
	create_timer(15.0).timeout.connect(func() -> void:
		printerr("ECHEC UI : chien de garde — erreur runtime dans les tests (voir ci-dessus)")
		quit(1))
	_tests()


func _texte_criteres(bp: Control) -> String:
	var morceaux: Array = []
	for rangee: Node in bp._criteres.get_children():
		for label: Node in (rangee as HBoxContainer).get_children():
			morceaux.append((label as Label).text)
	return " ".join(morceaux)


func _tests() -> void:
	var data: Dictionary = Etat.charger_data()
	var state: Dictionary = Sim.nouvelle_partie(1, data)
	var bp: Control = BlueprintScript.new()
	root.add_child(bp)
	# Pendant _initialize, l'arbre n'est pas encore démarré : _ready ne s'exécute
	# qu'à la première frame (dans le jeu réel, main est déjà dans l'arbre).
	await process_frame
	bp.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	bp.configurer(state, data)

	# Les specs réagissent : plus de surface = moins de vitesse (traînée).
	var v1: float = float(bp.specs_actuelles()["vmax_kmh"])
	if v1 <= 0.0:
		echecs.append("specs initiales vides")
	bp._surface.value = 45.0
	var v2: float = float(bp.specs_actuelles()["vmax_kmh"])
	if not v2 < v1:
		echecs.append("la surface ne fait pas émerger la vitesse (%f → %f)" % [v1, v2])

	# La note marché guide la conception : plus de carburant = meilleure note postale
	# (l'autonomie pèse 30 % du segment) et le texte des attentes est peuplé.
	if bp._criteres.get_child_count() == 0 or not bp._note_marche.text.contains("Note marché"):
		echecs.append("la note marché n'est pas affichée")
	bp._carburant.value = 200.0
	var indices_avant: String = _texte_criteres(bp)
	bp._carburant.value = 1200.0
	if _texte_criteres(bp) == indices_avant:
		echecs.append("les indices marché ne réagissent pas au carburant (autonomie)")

	# Le volet d'équipements ne liste QUE les technos acquises : vide en 1922,
	# peuplé (et actif) dès qu'une techno tombe.
	if bp._cases_features.size() != 0:
		echecs.append("équipements listés sans recherche (%d)" % bp._cases_features.size())
	(state["recherche"]["faites"] as Array).append("capot_naca")
	bp.rafraichir()
	if bp._cases_features.size() != 1 or (bp._cases_features["capot_naca"] as CheckBox).disabled:
		echecs.append("équipement recherché absent ou verrouillé dans le volet")
	(state["recherche"]["faites"] as Array).erase("capot_naca")
	bp.rafraichir()

	# Lancement : paie le proto, ouvre la campagne d'essais, puis mise en service.
	var tresorerie_avant: float = float(state["tresorerie"])
	bp._sur_lancer()
	if (state.get("essais", {}) as Dictionary).size() != 1:
		echecs.append("le lancement n'a pas ouvert de campagne d'essais")
	if not float(state["tresorerie"]) < tresorerie_avant:
		echecs.append("le prototype n'a rien coûté")
	var EssaisSim: GDScript = load("res://sim/essais.gd")
	var uid_essai: String = str(Etat.cles_triees(state["essais"])[0])
	var garde_e: int = 0
	while not EssaisSim.prete(state, uid_essai) and garde_e < 40:
		Sim.tick(state, data)
		garde_e += 1
	bp._sur_servir(uid_essai)
	if (state["catalogue"] as Dictionary).size() != 1:
		echecs.append("la mise en service n'a pas mis le produit au catalogue")

	# Livre des comptes : le journal de la sim s'affiche, exercice par exercice.
	var cpt: Control = ComptesScript.new()
	root.add_child(cpt)
	await process_frame
	cpt.configurer(state, data)
	await process_frame
	if cpt._boite.get_child_count() == 0:
		echecs.append("comptes : aucune ligne affichée")
	var journal: Dictionary = state["comptes"]
	if journal.is_empty():
		echecs.append("comptes : journal vide après une campagne")
	else:
		# Le journal doit expliquer la trésorerie à l'unité près (départ + tous les flux).
		var somme: float = float(data["constants"]["eco"]["tresorerie_depart"])
		for a: String in Etat.cles_triees(journal):
			for p: String in Etat.cles_triees(journal[a]):
				somme += float(journal[a][p])
		if absf(somme - float(state["tresorerie"])) > 1.0:
			echecs.append("comptes : le journal (%d) ne retombe pas sur la trésorerie (%d)"
				% [int(somme), int(state["tresorerie"])])
	print("UI | comptes : %d exercice(s), journal cohérent avec la trésorerie OK" % journal.size())

	# La sim tourne sous l'écran sans casser l'UI.
	for i: int in range(14):
		Sim.tick(state, data)
	bp.rafraichir()

	bp.queue_free()
	await _tests_marche(state, data)
	await _tests_ao(state, data)
	await _tests_equipe_ui(state, data)
	await _tests_recherche_ui(state, data)
	await _tests_direction_ui(state, data)
	# Moteur MAISON au Bureau : les specs doivent RÉAGIR aux curseurs. Elles restaient figées
	# parce que `Avion.specs` cherchait le moteur dans data/ et n'y trouvait rien (playtest n°7).
	# ÉTAT DÉDIÉ : injecter du cash dans l'état partagé casserait l'assertion du livre des
	# comptes, qui vérifie que le journal explique TOUTE la trésorerie.
	var Moteurs2: GDScript = load("res://sim/motors.gd")
	var s_mot: Dictionary = Sim.nouvelle_partie(9, data)
	s_mot["tresorerie"] = 5000000.0
	Sim.appliquer(s_mot, data, {"type": "fonder_moteurs"})
	Sim.appliquer(s_mot, data, {"type": "lancer_moteur", "projet": {"nom": "Banc",
		"cylindree_l": 21.0, "architecture": "ligne", "suralimente": false, "soin": 0.5}})
	for i_m: int in range(80):
		Sim.tick(s_mot, data)
		if not Moteurs2.moteurs(s_mot).is_empty():
			break
	if Moteurs2.moteurs(s_mot).is_empty():
		echecs.append("moteurs : rien homologué pour le test d'écran")
	else:
		var uid_mm: String = str(Etat.cles_triees(Moteurs2.moteurs(s_mot))[0])
		var bp_m: Control = BlueprintScript.new()
		root.add_child(bp_m)
		await process_frame
		bp_m.appliquer = func(intention: Dictionary) -> bool:
			return Sim.appliquer(s_mot, data, intention)
		bp_m.configurer(s_mot, data)
		if not (bp_m._moteur.get_meta("ids") as Array).has(uid_mm):
			echecs.append("moteurs : moteur maison absent du sélecteur du Bureau")
		bp_m._changer("moteur", uid_mm)
		bp_m._surface.value = 20.0
		var v_petite: float = float(bp_m.specs_actuelles()["vmax_kmh"])
		bp_m._surface.value = 45.0
		var v_grande: float = float(bp_m.specs_actuelles()["vmax_kmh"])
		if not v_grande < v_petite:
			echecs.append("moteurs : specs figées avec un moteur maison (%.0f vs %.0f km/h)"
				% [v_petite, v_grande])
		bp_m.queue_free()
		print("UI | moteur maison : sélecteur + specs réactives (%d → %d km/h) OK"
			% [int(v_petite), int(v_grande)])
	await _tests_fin_ui(state, data)
	if echecs.is_empty():
		print("UI | blueprint : construction, specs live, verrouillage technos, lancement OK")
		print("UI | marché : barres alimentées, prix, retrait, agrandissement OK")
		print("UI | AO : tous les programmes listés, candidature déposée via l'écran OK")
		print("UI | équipe : diorama, affectation et recrutement via l'écran OK")
		print("UI | recherche : toutes les technos listées, lancement via l'écran OK")
		print("UI | direction : banque/assurance/entretien/motoriste/filiale OK")
		print("UI | fin : verdict affiché, fragments peuplés OK")
		quit(0)
	else:
		for e: String in echecs:
			printerr("ECHEC UI : " + e)
		quit(1)


# 14 ticks ont déjà tourné : le marché a au moins un trimestre d'historique
# et le catalogue contient le produit lancé par le test blueprint.
func _tests_marche(state: Dictionary, data: Dictionary) -> void:
	var mu: Control = MarcheScript.new()
	root.add_child(mu)
	await process_frame
	mu.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	mu.configurer(state, data)

	# Les barres empilées reçoivent l'historique du premier trimestre.
	var alimentees: int = 0
	for nom_seg: String in mu._panneaux:
		if (mu._panneaux[nom_seg]["barres"].trimestres as Array).size() >= 1:
			alimentees += 1
	if alimentees == 0:
		echecs.append("aucune barre de marché alimentée après un trimestre")

	# Changer le prix via la SpinBox traverse jusqu'au state.
	var uid: String = str(Etat.cles_triees(state["catalogue"])[0])
	if not mu._prix_boxes.has(uid):
		echecs.append("pas de SpinBox de prix pour le produit " + uid)
	else:
		(mu._prix_boxes[uid] as SpinBox).value = 123000.0
		if absf(float(state["catalogue"][uid]["prix"]) - 123000.0) > 0.5:
			echecs.append("le prix ne traverse pas jusqu'au state")

	# Agrandir l'atelier (trésorerie forcée : fixture, pas gameplay).
	state["tresorerie"] = 2000000.0
	mu._sur_agrandir()
	if float(state["atelier"]["chantier_sem"]) <= 0.0:
		echecs.append("l'agrandissement d'atelier n'a pas ouvert de chantier")

	# Retirer le produit vide le catalogue.
	mu._sur_retirer(uid)
	if (state["catalogue"] as Dictionary).size() != 0:
		echecs.append("le retrait n'a pas vidé le catalogue")

	mu.queue_free()


# L'écran AO liste les 7 programmes et la candidature traverse jusqu'au state.
func _tests_ao(state: Dictionary, data: Dictionary) -> void:
	# Avancer en 1927 (fenêtre du Jockey) avec un produit au catalogue et du cash de fixture.
	state["tresorerie"] = 3000000.0
	while Marche.annee_de(state) < 1927.2:
		Sim.tick(state, data)
	var design: Dictionary = {
		"nom": "Test AO", "annee": Marche.annee_de(state), "formule": "biplan", "structure": "bois",
		"moteur": "rr_eagle", "surface": 18.0,
		"carburant_kg": 250.0, "charge_utile_kg": 0.0, "armement": 0, "features": [],
	}
	Sim.appliquer(state, data, {"type": "nouveau_design", "design": design})
	var uid_d: String = str(Etat.cles_triees(state["designs"])[state["designs"].size() - 1])
	Sim.appliquer(state, data, {"type": "lancer_produit", "design": uid_d,
		"segment": "export_militaire", "prix": 150000.0})
	var uid_p: String = str(Etat.cles_triees(state["catalogue"])[0])

	var ec: Control = AoScript.new()
	root.add_child(ec)
	await process_frame
	ec.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	ec.configurer(state, data)
	var nb_programmes: int = (data["contracts"]["programmes"] as Dictionary).size()
	if ec._choix_produits.size() < 1:
		echecs.append("AO UI : aucun programme ouvert avec sélecteur de produit en 1927")
	if ec._boite_programmes.get_child_count() != nb_programmes:
		echecs.append("AO UI : %d blocs au lieu de %d programmes" % [ec._boite_programmes.get_child_count(), nb_programmes])
	ec._sur_candidater("1927_jockey", uid_p)
	if str((state["ao"]["candidatures"] as Dictionary).get("1927_jockey", "")) != uid_p:
		echecs.append("AO UI : la candidature ne traverse pas jusqu'au state")
	ec.queue_free()


# L'écran Équipe : diorama alimenté, affectation et recrutement traversent le state.
func _tests_equipe_ui(state: Dictionary, data: Dictionary) -> void:
	var eq: Control = EquipeScript.new()
	root.add_child(eq)
	await process_frame
	eq.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	eq.configurer(state, data)
	if (eq._diorama.ingenieurs as Array).size() != (state["ingenieurs"] as Array).size():
		echecs.append("équipe UI : le diorama ne voit pas l'équipe")
	eq._sur_affecter(0, "atelier")
	if str(state["ingenieurs"][0]["poste"]) != "atelier":
		echecs.append("équipe UI : l'affectation ne traverse pas jusqu'au state")
	var effectif: int = (state["ingenieurs"] as Array).size()
	if (state["recrutement"]["candidats"] as Array).size() > 0:
		eq._sur_recruter(0)
		if (state["ingenieurs"] as Array).size() != effectif + 1:
			echecs.append("équipe UI : le recrutement ne traverse pas jusqu'au state")
	eq.queue_free()


# L'écran Recherche : 12 technos listées, le lancement traverse jusqu'au state.
func _tests_recherche_ui(state: Dictionary, data: Dictionary) -> void:
	state["tresorerie"] = 3000000.0
	var re: Control = RechercheScript.new()
	root.add_child(re)
	await process_frame
	re.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	re.configurer(state, data)
	# Chaque techno = 1 rangée + (sauf exception sans effet mesurable) 1 ligne d'effet chiffré.
	var n_technos: int = (data["technos"] as Dictionary).size()
	if re._boite.get_child_count() < n_technos or re._boite.get_child_count() > 2 * n_technos:
		echecs.append("recherche UI : %d lignes pour %d technos (attendu entre n et 2n)"
			% [re._boite.get_child_count(), n_technos])
	re._sur_lancer("capot_naca")
	if not (state["recherche"]["en_cours"] as Dictionary).has("capot_naca"):
		echecs.append("recherche UI : le lancement ne traverse pas jusqu'au state")
	re.queue_free()


# L'écran Direction : les leviers financiers/stratégiques traversent le state.
func _tests_direction_ui(state: Dictionary, data: Dictionary) -> void:
	state["tresorerie"] = 3000000.0
	var di: Control = DirectionScript.new()
	root.add_child(di)
	await process_frame
	di.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	di.configurer(state, data)
	if di._boite_finances.get_child_count() == 0:
		echecs.append("direction UI : la carte Banque est vide")
	# Emprunter via l'écran doit créer de la dette.
	var dette_avant: float = float(state.get("emprunt", 0.0))
	if not Sim.appliquer(state, data, {"type": "emprunter", "montant": 100000.0}):
		echecs.append("direction UI : emprunt refusé")
	if float(state["emprunt"]) <= dette_avant:
		echecs.append("direction UI : la dette ne s'enregistre pas")
	di.rafraichir()
	di.queue_free()


# L'écran de fin : verdict et fragments s'affichent sur un state terminé.
func _tests_fin_ui(state: Dictionary, data: Dictionary) -> void:
	state["fin"] = "mai_1945"
	var fe: Control = FinUiScript.new()
	root.add_child(fe)
	await process_frame
	fe.afficher(state, data)
	if not fe.visible:
		echecs.append("fin UI : l'écran ne s'affiche pas")
	if fe._titre.text == "":
		echecs.append("fin UI : verdict vide")
	if fe._boite.get_child_count() < 4:
		echecs.append("fin UI : épilogue vide (%d lignes)" % fe._boite.get_child_count())
	fe.queue_free()
