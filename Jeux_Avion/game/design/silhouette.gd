# Raison d'être : la silhouette procédurale du blueprint — vue de dessus dessinée par
# calques depuis le design (formule, surface, moteur, équipements), lignes claires sur
# cyanotype, aucun sprite, aucun shader ; redessinée uniquement quand le design change.
extends Control

const Palette := preload("res://game/ui/palette.gd")

var design: Dictionary = {}
var data: Dictionary = {}
var specs_vue: Dictionary = {}


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Palette.BLEU_CYANOTYPE)
	var grille: Color = Palette.LIGNE_BLUEPRINT
	grille.a = 0.10
	var pas: float = 16.0
	var gx: float = 0.0
	while gx < size.x:
		draw_line(Vector2(gx, 0.0), Vector2(gx, size.y), grille, 1.0)
		gx += pas
	var gy: float = 0.0
	while gy < size.y:
		draw_line(Vector2(0.0, gy), Vector2(size.x, gy), grille, 1.0)
		gy += pas
	if design.is_empty() or data.is_empty():
		return
	_dessiner_avion()
	_dessiner_cartouche()


func _dessiner_avion() -> void:
	var ligne: Color = Palette.LIGNE_BLUEPRINT
	var centre: Vector2 = size / 2.0
	var biplan: bool = str(design["formule"]) == "biplan"
	var surface: float = float(design["surface"])
	var feats: Array = design.get("features", [])
	var allongement: float = 5.5 if biplan else 6.5
	var surface_plan: float = surface / 2.0 if biplan else surface
	var envergure_m: float = sqrt(surface_plan * allongement)
	var px: float = clampf(size.y * 0.9 / (envergure_m * 1.15), 4.0, 9.0)
	var envergure: float = envergure_m * px
	var longueur: float = envergure * (0.78 if biplan else 0.68)
	var corde: float = clampf(surface_plan / envergure_m * px, 8.0, 34.0)

	# Fuselage (coque fermée).
	var demi_l: float = longueur / 2.0
	var largeur: float = clampf(longueur * 0.085, 5.0, 14.0)
	var coque: PackedVector2Array = PackedVector2Array([
		centre + Vector2(0.0, -demi_l),
		centre + Vector2(largeur, -demi_l + largeur * 2.2),
		centre + Vector2(largeur * 0.85, demi_l * 0.25),
		centre + Vector2(largeur * 0.30, demi_l - 8.0),
		centre + Vector2(0.0, demi_l),
		centre + Vector2(-largeur * 0.30, demi_l - 8.0),
		centre + Vector2(-largeur * 0.85, demi_l * 0.25),
		centre + Vector2(-largeur, -demi_l + largeur * 2.2),
		centre + Vector2(0.0, -demi_l),
	])
	draw_polyline(coque, ligne, 1.0)

	# Ailes (une paire, ou deux décalées + mâts pour le biplan).
	var y_aile: float = -demi_l * 0.30
	_dessiner_paire_ailes(centre, y_aile, envergure, corde, largeur, ligne)
	if biplan:
		_dessiner_paire_ailes(centre, y_aile + corde + 6.0, envergure * 0.92, corde, largeur, ligne)
		for cote: float in [-1.0, 1.0]:
			var xm: float = cote * envergure * 0.30
			draw_line(centre + Vector2(xm, y_aile + 2.0), centre + Vector2(xm, y_aile + corde + 8.0), ligne, 1.0)

	# Empennage + dérive.
	var y_emp: float = demi_l - 12.0
	_dessiner_paire_ailes(centre, y_emp, envergure * 0.34, corde * 0.55, largeur * 0.3, ligne)
	draw_line(centre + Vector2(0.0, y_emp - 6.0), centre + Vector2(0.0, demi_l), ligne, 1.0)

	# Moteur : radial = cercle (double si capot NACA), en ligne = capot rectangulaire.
	# Même règle que `Avion.specs` : un moteur MAISON n'est pas au catalogue du commerce,
	# ses caractéristiques sont tamponnées dans le design.
	var moteur: Dictionary = design.get("moteur_specs",
		(data["engines"] as Dictionary).get(str(design["moteur"]), {}))
	if str(moteur.get("type", "ligne")) == "radial":
		draw_arc(centre + Vector2(0.0, -demi_l + 6.0), largeur + 2.0, 0.0, TAU, 24, ligne, 1.0)
		if feats.has("capot_naca"):
			draw_arc(centre + Vector2(0.0, -demi_l + 6.0), largeur + 5.0, 0.0, TAU, 24, ligne, 1.0)
	else:
		draw_rect(Rect2(centre + Vector2(-largeur * 0.7, -demi_l + 2.0), Vector2(largeur * 1.4, largeur * 2.0)), ligne, false, 1.0)
	# Hélice.
	draw_line(centre + Vector2(-envergure * 0.10, -demi_l - 3.0), centre + Vector2(envergure * 0.10, -demi_l - 3.0), ligne, 1.0)

	# Train : fixe = jambes + roues ; rentrant = logements en pointillés.
	var y_train: float = y_aile + corde + 4.0
	for cote: float in [-1.0, 1.0]:
		var xt: float = cote * envergure * 0.16
		if feats.has("train_rentrant"):
			draw_dashed_line(centre + Vector2(xt - 4.0, y_train), centre + Vector2(xt + 4.0, y_train), ligne, 1.0, 2.0)
		else:
			draw_line(centre + Vector2(xt, y_train - 4.0), centre + Vector2(xt, y_train + 3.0), ligne, 1.0)
			draw_arc(centre + Vector2(xt, y_train + 5.0), 2.5, 0.0, TAU, 12, ligne, 1.0)

	# Cockpit : fermé = verrière complète, ouvert = demi-arc.
	var y_ck: float = -demi_l * 0.08
	if feats.has("cockpit_ferme"):
		draw_rect(Rect2(centre + Vector2(-3.0, y_ck - 7.0), Vector2(6.0, 14.0)), ligne, false, 1.0)
	else:
		draw_arc(centre + Vector2(0.0, y_ck), 3.5, PI, TAU, 10, ligne, 1.0)

	# Soute à bombes : trappe ventrale en pointillés sur l'axe du fuselage.
	if feats.has("soute_bombes"):
		var y_s0: float = y_aile + corde + 6.0
		var y_s1: float = minf(y_s0 + demi_l * 0.45, demi_l - 14.0)
		for cote: float in [-1.0, 1.0]:
			draw_dashed_line(centre + Vector2(cote * largeur * 0.45, y_s0),
				centre + Vector2(cote * largeur * 0.45, y_s1), ligne, 1.0, 3.0)
		draw_dashed_line(centre + Vector2(-largeur * 0.45, y_s1), centre + Vector2(largeur * 0.45, y_s1), ligne, 1.0, 3.0)

	# Tourelle défensive : anneau dorsal derrière le poste.
	if feats.has("tourelle_defensive"):
		var c_t: Vector2 = centre + Vector2(0.0, y_ck + 16.0)
		draw_arc(c_t, 5.0, 0.0, TAU, 16, ligne, 1.0)
		draw_line(c_t, c_t + Vector2(0.0, -8.0), Palette.LAITON, 1.0)

	# Armement : marques sur le bord d'attaque (les batteries d'ailes en ajoutent deux).
	var armement: int = int(design.get("armement", 0)) + (1 if feats.has("canon_moteur") else 0) \
		+ (2 if feats.has("armes_ailes") else 0)
	for i: int in range(armement):
		for cote: float in [-1.0, 1.0]:
			var xa: float = cote * envergure * (0.24 + 0.07 * float(i))
			draw_line(centre + Vector2(xa, y_aile), centre + Vector2(xa, y_aile - 5.0), Palette.LAITON, 1.0)


func _dessiner_paire_ailes(centre: Vector2, y0: float, envergure: float, corde: float, x_emplanture: float, ligne: Color) -> void:
	for cote: float in [-1.0, 1.0]:
		var aile: PackedVector2Array = PackedVector2Array([
			centre + Vector2(cote * x_emplanture, y0),
			centre + Vector2(cote * envergure / 2.0, y0 + 3.0),
			centre + Vector2(cote * envergure / 2.0, y0 + 3.0 + corde * 0.72),
			centre + Vector2(cote * x_emplanture, y0 + corde),
			centre + Vector2(cote * x_emplanture, y0),
		])
		draw_polyline(aile, ligne, 1.0)


func _dessiner_cartouche() -> void:
	var police: Font = get_theme_default_font()
	# Rétréci plutôt que débordé : un panneau plus étroit que 186 px (petite fenêtre) ne
	# doit jamais pousser le cartouche à cheval sur le panneau voisin.
	var largeur: float = minf(180.0, size.x - 12.0)
	var hauteur: float = minf(52.0, size.y - 12.0)
	if largeur <= 0.0 or hauteur <= 0.0:
		return
	var boite: Rect2 = Rect2(Vector2(size.x - largeur - 6.0, size.y - hauteur - 6.0), Vector2(largeur, hauteur))
	draw_rect(boite, Palette.BLEU_CYANOTYPE)
	draw_rect(boite, Palette.LAITON, false, 2.0)
	var nom: String = str(design.get("nom", tr("Sans nom")))
	var annee: int = int(design.get("annee", 1925))
	var vmax: String = "%d km/h" % int(specs_vue.get("vmax_kmh", 0.0))
	draw_string(police, boite.position + Vector2(6.0, 14.0), nom, HORIZONTAL_ALIGNMENT_LEFT, boite.size.x - 12.0, 8, Palette.LIGNE_BLUEPRINT)
	draw_string(police, boite.position + Vector2(6.0, 28.0), tr("BUREAU D'ÉTUDES — %d") % annee, HORIZONTAL_ALIGNMENT_LEFT, boite.size.x - 12.0, 8, Palette.LAITON)
	draw_string(police, boite.position + Vector2(6.0, 41.0), vmax, HORIZONTAL_ALIGNMENT_LEFT, boite.size.x - 12.0, 8, Palette.LIGNE_BLUEPRINT)
