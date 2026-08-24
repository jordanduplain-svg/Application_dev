# Raison d'être : outil de dev — lance la vraie scène avec rendu, capture le blueprint
# (capture.png) puis l'écran marché sur une campagne seedée de 8 ans (capture_marche.png) ;
# preuve visuelle sans jouer. Le marché est capturé hors main pour ne pas toucher la sauvegarde.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const MainScript := preload("res://game/main.gd")
const MarcheScript := preload("res://game/market_ui/marche.gd")
const AoScript := preload("res://game/contracts_ui/ao.gd")
const EquipeScript := preload("res://game/office/equipe.gd")
const RechercheScript := preload("res://game/research_ui/recherche.gd")
const ComptesScript := preload("res://game/comptes/comptes.gd")
const FinUiScript := preload("res://game/end/fin.gd")


func _initialize() -> void:
	create_timer(60.0).timeout.connect(func() -> void: quit(1))
	_capturer()


# Les écrans capturés hors de main n'héritent pas de son thème ; leur _ready écrase
# leur propre theme → la police doit venir d'un PARENT porteur.
func _porteur() -> Control:
	var porteur := Control.new()
	porteur.theme = _theme_pixel()
	porteur.set_anchors_preset(Control.PRESET_FULL_RECT)
	# Même canevas charbon que main : les écrans n'ont plus de fond propre.
	var fond := Panel.new()
	var style := StyleBoxFlat.new()
	style.bg_color = MainScript.Palette.ENCRE
	fond.add_theme_stylebox_override("panel", style)
	fond.set_anchors_preset(Control.PRESET_FULL_RECT)
	porteur.add_child(fond)
	root.add_child(porteur)
	return porteur


func _theme_pixel() -> Theme:
	var th := Theme.new()
	# Fonte lisse par défaut du moteur + habillage global : identique au thème de main.
	th.default_font_size = 9
	MainScript._styler(th)
	return th


func _capturer() -> void:
	var scene: PackedScene = load("res://game/main.tscn")
	var principal: Node = scene.instantiate()
	root.add_child(principal)
	for i: int in range(8):
		await process_frame
	var image: Image = root.get_viewport().get_texture().get_image()
	image.save_png("res://capture.png")
	print("capture écrite : capture.png")
	root.remove_child(principal)
	principal.free()

	var data: Dictionary = Etat.charger_data()
	var state: Dictionary = Sim.nouvelle_partie(3, data)
	Sim.appliquer(state, data, {"type": "nouveau_design", "design": {
		"nom": "Hirondelle I", "annee": 1925.0, "formule": "biplan", "structure": "bois",
		"moteur": "rr_eagle", "surface": 30.0,
		"carburant_kg": 600.0, "charge_utile_kg": 300.0, "armement": 0, "features": []}})
	var uid_design: String = str(Etat.cles_triees(state["designs"])[0])
	var cout: float = float(state["designs"][uid_design]["specs"]["cout_unitaire"])
	Sim.appliquer(state, data, {"type": "lancer_produit", "design": uid_design,
		"segment": "ligne_postale", "prix": snappedf(cout * 1.35, 1000.0)})
	# Fixture de capture, pas du gameplay : on garantit 11 ans sans faillite (base 1922).
	state["tresorerie"] = 2500000.0
	for i: int in range(11 * 52):
		Sim.tick(state, data)
	var mu: Control = MarcheScript.new()
	mu.set_anchors_preset(Control.PRESET_FULL_RECT)
	var porteur_mu: Control = _porteur()
	porteur_mu.add_child(mu)
	await process_frame
	mu.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	mu.configurer(state, data)
	for i: int in range(4):
		await process_frame
	var image_m: Image = root.get_viewport().get_texture().get_image()
	image_m.save_png("res://capture_marche.png")
	print("capture écrite : capture_marche.png")
	root.remove_child(porteur_mu)
	porteur_mu.free()

	# Écran AO en 1934 : A.39/34 ouvert (cahier + note estimée), 3 concours déjà résolus.
	for i: int in range(60):
		Sim.tick(state, data)
	var ec: Control = AoScript.new()
	ec.set_anchors_preset(Control.PRESET_FULL_RECT)
	var porteur_ec: Control = _porteur()
	porteur_ec.add_child(ec)
	await process_frame
	ec.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	ec.configurer(state, data)
	ec._sur_candidater("1934_m4", str(Etat.cles_triees(state["catalogue"])[0]))
	for i: int in range(4):
		await process_frame
	var image_a: Image = root.get_viewport().get_texture().get_image()
	image_a.save_png("res://capture_ao.png")
	print("capture écrite : capture_ao.png")
	root.remove_child(porteur_ec)
	porteur_ec.free()

	# Écran Équipe : on étoffe l'effectif pour ouvrir le 2e étage du diorama.
	Sim.appliquer(state, data, {"type": "recruter", "indice": 0})
	Sim.appliquer(state, data, {"type": "recruter", "indice": 0})
	Sim.appliquer(state, data, {"type": "affecter", "indice": 3, "poste": "etudes"})
	Sim.appliquer(state, data, {"type": "affecter", "indice": 4, "poste": "atelier"})
	var eq: Control = EquipeScript.new()
	eq.set_anchors_preset(Control.PRESET_FULL_RECT)
	var porteur_eq: Control = _porteur()
	porteur_eq.add_child(eq)
	await process_frame
	eq.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	eq.configurer(state, data)
	for i: int in range(4):
		await process_frame
	var image_e: Image = root.get_viewport().get_texture().get_image()
	image_e.save_png("res://capture_equipe.png")
	print("capture écrite : capture_equipe.png")
	root.remove_child(porteur_eq)
	porteur_eq.free()

	# Écran Labo : mélange acquises / en cours / à lancer sur la même campagne.
	Sim.appliquer(state, data, {"type": "lancer_recherche", "techno": str(Etat.cles_triees(data["technos"])[0])})
	var ru: Control = RechercheScript.new()
	ru.set_anchors_preset(Control.PRESET_FULL_RECT)
	var porteur_ru: Control = _porteur()
	porteur_ru.add_child(ru)
	await process_frame
	ru.appliquer = func(intention: Dictionary) -> bool:
		return Sim.appliquer(state, data, intention)
	ru.configurer(state, data)
	# Volet de détail ouvert sur une techno parlante : preuve visuelle du tableau d'effets.
	ru._montrer_detail("suralimentation")
	for i: int in range(4):
		await process_frame
	var image_r: Image = root.get_viewport().get_texture().get_image()
	image_r.save_png("res://capture_labo.png")
	print("capture écrite : capture_labo.png")
	root.remove_child(porteur_ru)
	porteur_ru.free()

	# Écran Comptes : le livre des comptes sur la même campagne seedée (plusieurs exercices).
	var cu: Control = ComptesScript.new()
	cu.set_anchors_preset(Control.PRESET_FULL_RECT)
	var porteur_cu: Control = _porteur()
	porteur_cu.add_child(cu)
	await process_frame
	cu.configurer(state, data)
	for i: int in range(4):
		await process_frame
	var image_c: Image = root.get_viewport().get_texture().get_image()
	image_c.save_png("res://capture_comptes.png")
	print("capture écrite : capture_comptes.png")
	root.remove_child(porteur_cu)
	porteur_cu.free()

	# Une de presse : la vraie scène, avec une une injectée puis l'overlay déclenché.
	var principal2: Node = scene.instantiate()
	root.add_child(principal2)
	for i: int in range(8):
		await process_frame

	# Carte d'événement (voile) : l'événement au titre le plus long du jeu.
	principal2.state["evenements"]["en_attente"] = "1927_lindbergh"
	principal2._verifier_overlays()
	for i: int in range(4):
		await process_frame
	var image_v: Image = root.get_viewport().get_texture().get_image()
	image_v.save_png("res://capture_evenement.png")
	print("capture écrite : capture_evenement.png")
	principal2.state["evenements"]["en_attente"] = ""
	principal2._voile.visible = false
	principal2.state["presse"] = [{"titre": "Lindbergh a traversé",
		"corps": "Le Bourget, minuit. Le monde s'enflamme pour l'aviation — les compagnies commandent."}]
	principal2._verifier_overlays()
	for i: int in range(4):
		await process_frame
	var image_p: Image = root.get_viewport().get_texture().get_image()
	image_p.save_png("res://capture_presse.png")
	print("capture écrite : capture_presse.png")
	root.remove_child(principal2)
	principal2.free()

	# Écran de fin : la campagne seedée jouée jusqu'à mai 1940 (événements au choix conseillé).
	while str(state["fin"]) == "":
		var en_attente: String = str(state["evenements"]["en_attente"])
		if en_attente != "":
			Sim.appliquer(state, data, {"type": "choisir_evenement", "id": en_attente,
				"choix": str(data["events"]["liste"][en_attente]["choix_bot"])})
		Sim.tick(state, data)
	var fe: Control = FinUiScript.new()
	fe.set_anchors_preset(Control.PRESET_FULL_RECT)
	var porteur_fe: Control = _porteur()
	porteur_fe.add_child(fe)
	await process_frame
	fe.afficher(state, data)
	for i: int in range(4):
		await process_frame
	var image_f: Image = root.get_viewport().get_texture().get_image()
	image_f.save_png("res://capture_fin.png")
	print("capture écrite : capture_fin.png")
	quit(0)
