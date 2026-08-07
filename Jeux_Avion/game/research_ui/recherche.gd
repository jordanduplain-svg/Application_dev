# Raison d'être : l'arbre des 12 technos rendu jouable — pour chacune : état de l'art mondial,
# coût/durée EFFECTIFS selon le pari (pionnier ×3/×2 avant la date, suiveur ×0.6 après),
# progression en cours, bouton Lancer. Le gel d'études (événements) est affiché.
# N'écrit jamais dans le state : intentions via le Callable `appliquer` injecté par main.
extends Control

const Etat := preload("res://sim/state.gd")
const Marche := preload("res://sim/market.gd")
const Recherche := preload("res://sim/research.gd")
const Ingenieurs := preload("res://sim/engineers.gd")
const Moteurs := preload("res://sim/motors.gd")
const Avion := preload("res://sim/aircraft.gd")
const Palette := preload("res://game/ui/palette.gd")
const Cartes := preload("res://game/ui/cartes.gd")
const MarcheEcran := preload("res://game/market_ui/marche.gd")
const Criteres := preload("res://game/ui/criteres_ui.gd")

var appliquer: Callable = Callable()  # func(intention: Dictionary) -> bool, injecté par main
var state: Dictionary = {}
var data: Dictionary = {}

var _entete: Label
var _boite: VBoxContainer
var _panneau_detail: PanelContainer
var _boite_detail: VBoxContainer
var _tech_sel: String = ""
var _boite_moteurs: VBoxContainer
var _projet: Dictionary = {"nom": "Moteur maison", "cylindree_l": 21.0, "architecture": "ligne",
	"suralimente": false, "soin": 0.5}


# `recherche.en_cours` et `technos.duree_sem` comptent des POINTS ; la sim en retire
# (1 + bonus recherche) par semaine (`research.tick_hebdo`). Afficher les points bruts
# faisait croire que l'équipe ne sert à rien : embaucher un chercheur ne bougeait aucun
# chiffre de l'écran (playtest n°7). Ici on affiche les SEMAINES réelles.
func _semaines(points: float) -> int:
	return int(ceilf(points / (1.0 + Ingenieurs.bonus(state, data, "recherche"))))

# [spec, libellé, gabarit, seuil de signifiance, « plus = mieux »] — l'ordre est l'affichage.
const LIGNES_DETAIL: Array = [
	["vmax_kmh", "Vitesse", "%+d km/h", 1.0, true],
	["fiabilite", "Fiabilité", "%+d pt", 0.005, true],
	["autonomie_km", "Autonomie", "%+d km", 10.0, true],
	["plafond_m", "Plafond", "%+d m", 50.0, true],
	["maniabilite", "Maniabilité", "%+d", 1.0, true],
	["capacite", "Passagers", "%+d", 1.0, true],
	["armement", "Armement", "%+d", 1.0, true],
	["masse_totale", "Masse", "%+d kg", 5.0, false],
	["cout_unitaire", "Coût unitaire", "%+d £", 200.0, false],
	["delai_semaines", "Études", "%+d sem", 1.0, false],
]


func _ready() -> void:
	# Fond charbon : c'est le canevas de main qui se voit autour de la carte papier.
	var th := Theme.new()
	th.default_font_size = 9
	theme = th


func configurer(state_: Dictionary, data_: Dictionary) -> void:
	state = state_
	data = data_
	var marge := MarginContainer.new()
	marge.set_anchors_preset(Control.PRESET_FULL_RECT)
	for cote: String in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		marge.add_theme_constant_override(cote, 8)
	add_child(marge)
	var carte := Cartes.carte()
	marge.add_child(carte)
	var defilement := ScrollContainer.new()
	# Vertical uniquement : le repli des libellés fait tenir la largeur, un défilement
	# horizontal cacherait du texte hors cadre (cf. marche.gd).
	defilement.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	carte.add_child(defilement)
	var colonne := VBoxContainer.new()
	colonne.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	colonne.add_theme_constant_override("separation", 2)
	defilement.add_child(colonne)
	_entete = _etiquette("", Palette.BOIS_MIEL)
	_entete.add_theme_font_size_override("font_size", 9)
	colonne.add_child(_entete)
	colonne.add_child(HSeparator.new())
	_boite = VBoxContainer.new()
	_boite.add_theme_constant_override("separation", 1)
	colonne.add_child(_boite)
	# Bureau d'études MOTEURS : n'apparaît qu'une fois le département fondé (écran Direction).
	# Il vit ici et pas dans un 8e onglet : c'est du développement, comme les technos.
	colonne.add_child(HSeparator.new())
	_boite_moteurs = VBoxContainer.new()
	_boite_moteurs.add_theme_constant_override("separation", 1)
	colonne.add_child(_boite_moteurs)
	# Volet de détail (droite) : cliquer une techno l'ouvre — tableau chiffré de ses effets
	# sur un chasseur type, coût/durée effectifs, prérequis, actions.
	_panneau_detail = Cartes.carte(Palette.PAPIER_CREME, 7.0)
	_panneau_detail.visible = false
	_panneau_detail.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	_panneau_detail.offset_left = -282.0
	_panneau_detail.offset_right = -16.0
	_panneau_detail.offset_top = 16.0
	_panneau_detail.offset_bottom = -16.0
	add_child(_panneau_detail)
	var defilement_d := ScrollContainer.new()
	defilement_d.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_panneau_detail.add_child(defilement_d)
	_boite_detail = VBoxContainer.new()
	_boite_detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_boite_detail.add_theme_constant_override("separation", 2)
	defilement_d.add_child(_boite_detail)
	rafraichir()


# ponytail: reconstruction à chaque rafraîchissement — pooling si le profiler râle (étape 9).
func rafraichir() -> void:
	if state.is_empty() or _boite == null:
		return
	var annee: float = Marche.annee_de(state)
	var gel: float = float(state["gels"]["etudes"])
	var vitesse: int = int(roundf(Ingenieurs.bonus(state, data, "recherche") * 100.0))
	_entete.text = tr("RECHERCHE — %d %% plus vite avec l'équipe au labo%s") \
		% [vitesse, (tr("  ·  GELÉE %d sem (événement)") % int(gel)) if gel > 0.0 else ""]
	_entete.tooltip_text = tr("Chercher AVANT l'état de l'art mondial (pari PIONNIER) coûte 4× plus cher et dure 2× plus longtemps, mais donne un brevet de 3 ans si vous êtes le premier. Après : coût ×0.6 (suiveur), pas de brevet possible. Cliquez une techno pour le détail.")
	_entete.mouse_filter = Control.MOUSE_FILTER_STOP
	for enfant: Node in _boite.get_children():
		enfant.queue_free()
	_maj_moteurs()
	var cr: Dictionary = data["constants"]["recherche"]
	var faites: Array = state["recherche"]["faites"]
	var en_cours: Dictionary = state["recherche"]["en_cours"]
	var paires: Array = []
	for id_t: String in Etat.cles_triees(data["technos"]):
		paires.append([float(data["technos"][id_t]["date_etat_art"]), id_t])
	paires.sort()
	for paire: Array in paires:
		var id_t: String = str(paire[1])
		var tn: Dictionary = data["technos"][id_t]
		var pionnier: bool = annee < float(tn["date_etat_art"])
		var cout: float = float(tn["cout_base"]) * (float(cr["mult_cout_pionnier"]) if pionnier else float(cr["mult_cout_suiveur"]))
		var duree: float = float(tn["duree_sem"]) * (float(cr["mult_duree_pionnier"]) if pionnier else 1.0)
		var rangee := HBoxContainer.new()
		rangee.add_theme_constant_override("separation", 4)
		# Le nom est un BOUTON : cliquer ouvre le volet de détail (tableau des effets).
		var nom := Button.new()
		nom.text = tr("%s — état de l'art %d") % [str(tn["nom"]), int(tn["date_etat_art"])]
		nom.alignment = HORIZONTAL_ALIGNMENT_LEFT
		nom.add_theme_font_size_override("font_size", 9)
		nom.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		nom.size_flags_stretch_ratio = 1.5
		var id_capture: String = id_t
		nom.pressed.connect(func() -> void: _montrer_detail(id_capture))
		rangee.add_child(nom)
		# Statut en colonne de droite façon registre : replié + aligné à droite, il ne
		# peut plus élargir la ligne (c'était LA cause du défilement horizontal du Labo).
		var det: String = Recherche.brevet_actif(state, id_t)
		var statut: Label
		if faites.has(id_t):
			var suffixe: String = tr("  ·  BREVET %d sem") \
				% int(float(state["brevets"][id_t]["expire"]) - float(state["tick"])) if det == "joueur" else ""
			statut = _etiquette(tr("✓ acquise") + suffixe, Palette.VERT_LAMPE)
		elif en_cours.has(id_t):
			statut = _etiquette(tr("en cours — %d sem restantes") % _semaines(float(en_cours[id_t])), Palette.BLEU_CYANOTYPE)
		else:
			# Brevet rival : la recherche directe traîne (contournement), la licence est le raccourci.
			if det != "" and det != "joueur":
				duree *= float(cr["mult_duree_contournement"])
			statut = _etiquette(tr("%s £ · %d sem · %s") % [MarcheEcran.francs(cout), _semaines(duree),
				(tr("breveté %s") % str(data["rivals"]["maisons"][det]["nom"])) if det != "" and det != "joueur"
				else ((tr("PIONNIER ×%d") % int(roundf(float(cr["mult_cout_pionnier"])))) if pionnier else tr("suiveur ×0.6"))],
				Palette.ROUGE_ALERTE if pionnier or (det != "" and det != "joueur") else Palette.GRIS_ACIER)
			if pionnier:
				statut.tooltip_text = tr("Pari pionnier : personne au monde ne maîtrise encore cette techno. Coût ×%d et durée ×%d, mais un brevet de 3 ans vous revient si vous terminez le premier — les rivaux paieront des royalties.") \
					% [int(roundf(float(cr["mult_cout_pionnier"]))), int(roundf(float(cr["mult_duree_pionnier"])))]
			elif det != "" and det != "joueur":
				statut.tooltip_text = tr("Un rival a breveté cette techno en premier. La rechercher directement contourne le brevet (durée ×%.1f) ; la licence achète le droit immédiatement, sans contournement.") % float(cr["mult_duree_contournement"])
		statut.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		statut.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		rangee.add_child(statut)
		# Lignée : le prérequis manquant grise la ligne, pas de boutons.
		if not faites.has(id_t) and not en_cours.has(id_t) \
				and not Recherche.prerequis_ok(faites, data, id_t):
			statut.text = tr("requiert %s") % str(data["technos"][str(tn["requiert"])]["nom"])
			statut.add_theme_color_override("font_color", Palette.GRIS_ACIER)
			_boite.add_child(rangee)
			continue
		if not faites.has(id_t) and not en_cours.has(id_t):
			if det != "" and det != "joueur":
				var licence := Button.new()
				licence.text = tr("Licence %s £") % MarcheEcran.francs(
					float(tn["cout_base"]) * float(cr["licence_achat_part"]))
				licence.tooltip_text = tr("Achète immédiatement le droit d'utiliser cette techno brevetée par un rival — pas de temps de recherche, cash contre délai.")
				licence.pressed.connect(func() -> void: _sur_licence(id_t))
				rangee.add_child(licence)
			var bouton := Button.new()
			bouton.text = "Lancer"
			bouton.pressed.connect(func() -> void: _sur_lancer(id_t))
			rangee.add_child(bouton)
		_boite.add_child(rangee)
	# Le détail chiffré vit dans le VOLET (clic sur la techno) — la liste reste lisible.
	if _tech_sel != "":
		_montrer_detail(_tech_sel)


# Delta d'une techno mesuré par Avion.specs sur un chasseur type de l'année ({} si sans
# effet mesurable — le delta exact dépend du design, le Bureau l'affiche sur LE VÔTRE).
func _delta_reference(id_t: String, annee: float) -> Dictionary:
	if id_t == "soufflerie_interne":
		return {}
	# Le rivetage ne lisse qu'une peau métal, la cabine pressurisée exige le monocoque :
	# leur chasseur de référence est en métal, sinon le delta mesuré serait nul.
	var structure: String = "metal" if ["rivetage_affleurant", "cabine_pressurisee"].has(id_t) else "bois"
	var reference: Dictionary = {
		"nom": "ref", "annee": annee,
		"formule": "monoplan" if annee >= 1930.0 else "biplan",
		"structure": structure,
		"moteur": Avion.meilleur_moteur(data, annee, "puissance"),
		"surface": 18.0, "carburant_kg": 350.0, "charge_utile_kg": 0.0,
		"armement": 1, "features": [],
	}
	if id_t == "monocoque_metal":
		var bois: Dictionary = Avion.specs(reference, data)
		reference["structure"] = "metal"
		var metal: Dictionary = Avion.specs(reference, data)
		var delta: Dictionary = {}
		for cle: String in Etat.cles_triees(metal):
			delta[cle] = float(metal[cle]) - float(bois[cle])
		return delta
	if not Avion.FEATURES_DESIGN.has(id_t):
		return {}
	return Avion.delta_feature(reference, data, id_t)


# Le volet de détail : statut, TABLEAU des effets (vert = mieux, rouge = moins bien),
# coût/durée effectifs, prérequis — et les actions, au même endroit que l'information.
func _montrer_detail(id_t: String) -> void:
	_tech_sel = id_t
	_panneau_detail.visible = true
	for enfant: Node in _boite_detail.get_children():
		enfant.queue_free()
	var tn: Dictionary = data["technos"][id_t]
	var annee: float = Marche.annee_de(state)
	var cr: Dictionary = data["constants"]["recherche"]
	var faites: Array = state["recherche"]["faites"]
	var en_cours: Dictionary = state["recherche"]["en_cours"]
	# En-tête : nom + fermeture.
	var entete := HBoxContainer.new()
	var titre := _etiquette(str(tn["nom"]), Palette.BOIS_MIEL)
	titre.add_theme_font_size_override("font_size", 10)
	titre.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	entete.add_child(titre)
	var fermer := Button.new()
	fermer.text = "✕"
	fermer.add_theme_font_size_override("font_size", 9)
	fermer.pressed.connect(func() -> void:
		_tech_sel = ""
		_panneau_detail.visible = false)
	entete.add_child(fermer)
	_boite_detail.add_child(entete)
	# Statut.
	var statut: String = tr("disponible")
	if faites.has(id_t):
		statut = tr("✓ acquise")
	elif en_cours.has(id_t):
		statut = tr("en cours — %d sem restantes") % _semaines(float(en_cours[id_t]))
	elif annee < float(tn["date_etat_art"]):
		statut = tr("pari pionnier (avant l'état de l'art)")
	_boite_detail.add_child(_etiquette(tr("État de l'art mondial : %d · %s") % [int(tn["date_etat_art"]), statut],
		Palette.GRIS_ACIER))
	_boite_detail.add_child(HSeparator.new())
	# Tableau des effets.
	_boite_detail.add_child(_etiquette(tr("Sur un chasseur type de l'année :"), Palette.ENCRE))
	var delta: Dictionary = _delta_reference(id_t, annee)
	if id_t == "soufflerie_interne":
		_boite_detail.add_child(_etiquette(tr("prestige du laboratoire — aucun effet direct sur les avions"), Palette.GRIS_ACIER))
	elif delta.is_empty():
		_boite_detail.add_child(_etiquette(tr("techno structurelle — l'effet dépend du design"), Palette.GRIS_ACIER))
	else:
		var grille := GridContainer.new()
		grille.columns = 2
		grille.add_theme_constant_override("h_separation", 12)
		grille.add_theme_constant_override("v_separation", 1)
		var n_lignes: int = 0
		for ligne: Array in LIGNES_DETAIL:
			var v: float = float(delta.get(str(ligne[0]), 0.0))
			var seuil: float = float(ligne[3])
			if str(ligne[0]) == "fiabilite":
				v *= 100.0
				seuil = 0.5
			if absf(v) < seuil:
				continue
			var mieux: bool = (v > 0.0) == bool(ligne[4])
			var g := _etiquette(tr(str(ligne[1])), Palette.ENCRE)
			g.autowrap_mode = TextServer.AUTOWRAP_OFF
			grille.add_child(g)
			var d := _etiquette(tr(str(ligne[2])) % int(roundf(v)), Palette.VERT_LAMPE if mieux else Palette.ROUGE_ALERTE)
			d.autowrap_mode = TextServer.AUTOWRAP_OFF
			d.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			grille.add_child(d)
			n_lignes += 1
		if n_lignes == 0:
			_boite_detail.add_child(_etiquette(tr("effet négligeable ici"), Palette.GRIS_ACIER))
		else:
			_boite_detail.add_child(grille)
	if id_t == "monocoque_metal":
		_boite_detail.add_child(_etiquette(tr("débloque la structure métal"), Palette.BLEU_CYANOTYPE))
	_boite_detail.add_child(HSeparator.new())
	# Coût, durée, prérequis, brevet — puis les actions.
	var det: String = Recherche.brevet_actif(state, id_t)
	if not faites.has(id_t) and not en_cours.has(id_t):
		var pionnier: bool = annee < float(tn["date_etat_art"])
		var cout: float = float(tn["cout_base"]) * (float(cr["mult_cout_pionnier"]) if pionnier else float(cr["mult_cout_suiveur"]))
		var duree: float = float(tn["duree_sem"]) * (float(cr["mult_duree_pionnier"]) if pionnier else 1.0)
		if det != "" and det != "joueur":
			duree *= float(cr["mult_duree_contournement"])
			_boite_detail.add_child(_etiquette(tr("breveté %s") % str(data["rivals"]["maisons"][det]["nom"]), Palette.ROUGE_ALERTE))
		_boite_detail.add_child(_etiquette(tr("Recherche : %s £ · %d sem") % [MarcheEcran.francs(cout), _semaines(duree)], Palette.ENCRE))
		if not Recherche.prerequis_ok(faites, data, id_t):
			_boite_detail.add_child(_etiquette(tr("requiert %s") % str(data["technos"][str(tn["requiert"])]["nom"]), Palette.GRIS_ACIER))
		else:
			var actions := HBoxContainer.new()
			actions.add_theme_constant_override("separation", 4)
			if det != "" and det != "joueur":
				var licence := Button.new()
				licence.text = tr("Licence %s £") % MarcheEcran.francs(float(tn["cout_base"]) * float(cr["licence_achat_part"]))
				licence.add_theme_font_size_override("font_size", 9)
				licence.pressed.connect(func() -> void: _sur_licence(id_t))
				actions.add_child(licence)
			var lancer := Button.new()
			lancer.text = "Lancer"
			lancer.add_theme_font_size_override("font_size", 9)
			lancer.pressed.connect(func() -> void: _sur_lancer(id_t))
			actions.add_child(lancer)
			_boite_detail.add_child(actions)
	elif det == "joueur":
		_boite_detail.add_child(_etiquette(tr("Votre brevet — %d sem d'exclusivité restantes") \
			% int(float(state["brevets"][id_t]["expire"]) - float(state["tick"])), Palette.VERT_LAMPE))


func _sur_licence(id_t: String) -> void:
	if not appliquer.is_null() and bool(appliquer.call({"type": "acheter_licence", "techno": id_t})):
		rafraichir()


func _sur_lancer(id_t: String) -> void:
	if not appliquer.is_null() and bool(appliquer.call({"type": "lancer_recherche", "techno": id_t})):
		rafraichir()


# Repli PAR DÉFAUT : un Label sans repli impose sa largeur de texte au conteneur
# parent et pousse l'écran hors du viewport (même règle que marche.gd).
func _etiquette(texte: String, couleur: Color) -> Label:
	var l := Label.new()
	l.text = texte
	l.add_theme_font_size_override("font_size", 9)
	l.add_theme_color_override("font_color", couleur)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


# --- bureau d'études moteurs : conception, banc d'essai, catalogue maison ---------------
# Vit au Labo (et non dans un 8e onglet) : c'est du développement, au même titre que les
# technos — et la barre du haut est déjà pleine à 768 px de large.
func _maj_moteurs() -> void:
	for enfant: Node in _boite_moteurs.get_children():
		enfant.queue_free()
	if not Moteurs.departement(state):
		return
	var annee: float = Marche.annee_de(state)
	_boite_moteurs.add_child(_etiquette(tr("BUREAU D'ÉTUDES MOTEURS"), Palette.BOIS_MIEL))
	# Banc occupé : un seul projet à la fois, on montre le compte à rebours.
	var banc: Dictionary = Moteurs.banc(state)
	if not banc.is_empty():
		_boite_moteurs.add_child(_etiquette(tr("Au banc : « %s » — %d semaines restantes.") \
			% [str((banc["projet"] as Dictionary).get("nom", "projet")), int(ceilf(float(banc["restant"])))],
			Palette.BLEU_CYANOTYPE))
	# Les moteurs déjà homologués : ils apparaissent au sélecteur du Bureau.
	var maison: Dictionary = Moteurs.moteurs(state)
	for id_m: String in Etat.cles_triees(maison):
		var m: Dictionary = maison[id_m]
		_boite_moteurs.add_child(_etiquette(tr("✓ %s — %d cv · %d kg · fiab %d %% · %s £") \
			% [str(m["nom"]), int(float(m["puissance_cv"])), int(float(m["masse_kg"])),
				int(roundf(float(m["fiabilite"]) * 100.0)), MarcheEcran.francs(float(m["cout"]))],
			Palette.VERT_LAMPE))
	if not banc.is_empty():
		return
	# Le projet en cours de dessin : 4 contrôles, les specs émergent en direct.
	var nom_champ := LineEdit.new()
	nom_champ.text = str(_projet["nom"])
	nom_champ.add_theme_font_size_override("font_size", 9)
	nom_champ.text_changed.connect(func(t: String) -> void: _projet["nom"] = t)
	_boite_moteurs.add_child(nom_champ)
	var apercu := _etiquette("", Palette.ENCRE)
	apercu.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var cout_l := _etiquette("", Palette.GRIS_ACIER)
	cout_l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var maj := func() -> void:
		var sp: Dictionary = Moteurs.specs(_projet, data, annee)
		apercu.text = tr("%d cv · %d kg · conso %d · fiabilité %d %% · %s £ pièce") \
			% [int(float(sp["puissance_cv"])), int(float(sp["masse_kg"])), int(float(sp["conso_kg_h"])),
				int(roundf(float(sp["fiabilite"]) * 100.0)), MarcheEcran.francs(float(sp["cout"]))]
		apercu.add_theme_color_override("font_color",
			Palette.ROUGE_ALERTE if float(sp["fiabilite"]) < float(data["constants"]["repu"]["pivot_fiab"])
			else Palette.ENCRE)
		cout_l.text = tr("Banc d'essai : %s £ · %d semaines") \
			% [MarcheEcran.francs(Moteurs.banc_cout(_projet, data)), int(Moteurs.banc_semaines(_projet, data))]
	# Cylindrée : le levier principal — puissance ET masse ET (au-delà de 24 L) fragilité.
	var rangee_c := HBoxContainer.new()
	var lib_c := _etiquette("", Palette.GRIS_ACIER)
	lib_c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rangee_c.add_child(lib_c)
	_boite_moteurs.add_child(rangee_c)
	var cyl := HSlider.new()
	cyl.min_value = 8.0
	cyl.max_value = 45.0
	cyl.step = 1.0
	cyl.value = float(_projet["cylindree_l"])
	cyl.custom_minimum_size = Vector2(0.0, 10.0)
	cyl.tooltip_text = tr("Cylindrée totale. La puissance et la masse y sont proportionnelles ; au-delà de %d litres la fiabilité chute (plus de cylindres, plus de vibrations — c'est l'histoire des grands moteurs ratés de la guerre).") \
		% int(data["constants"]["moteurs"]["cyl_saine"])
	cyl.value_changed.connect(func(v: float) -> void:
		_projet["cylindree_l"] = v
		lib_c.text = tr("Cylindrée %d L") % int(v)
		maj.call())
	_boite_moteurs.add_child(cyl)
	lib_c.text = tr("Cylindrée %d L") % int(float(_projet["cylindree_l"]))
	# Architecture et suralimentation.
	var rangee_a := HBoxContainer.new()
	rangee_a.add_theme_constant_override("separation", 4)
	var arch := OptionButton.new()
	arch.add_theme_font_size_override("font_size", 9)
	arch.add_item(tr("en ligne"))
	arch.add_item(tr("radial"))
	arch.select(1 if str(_projet["architecture"]) == "radial" else 0)
	arch.tooltip_text = tr("Le radial, refroidi par air, est plus léger et plus simple ; il traîne davantage (la traînée est calculée au Bureau, pas ici).")
	arch.item_selected.connect(func(i: int) -> void:
		_projet["architecture"] = "radial" if i == 1 else "ligne"
		maj.call())
	rangee_a.add_child(arch)
	var sur := CheckBox.new()
	sur.text = tr("suralimenté")
	sur.add_theme_font_size_override("font_size", 9)
	sur.button_pressed = bool(_projet["suralimente"])
	sur.tooltip_text = tr("Compresseur : +15 %% de puissance, mais plus lourd, plus cher et moins fiable. Indispensable en altitude.")
	sur.toggled.connect(func(p: bool) -> void:
		_projet["suralimente"] = p
		maj.call())
	rangee_a.add_child(sur)
	_boite_moteurs.add_child(rangee_a)
	# Soin de fabrication : le curseur qui rachète la fiabilité, au prix fort.
	var lib_s := _etiquette("", Palette.GRIS_ACIER)
	_boite_moteurs.add_child(lib_s)
	var soin := HSlider.new()
	soin.min_value = 0.0
	soin.max_value = 1.0
	soin.step = 0.05
	soin.value = float(_projet["soin"])
	soin.custom_minimum_size = Vector2(0.0, 10.0)
	soin.tooltip_text = tr("Du travail de série au travail d'orfèvre : chaque point de soin achète de la fiabilité et alourdit la facture, à l'unité comme au banc.")
	soin.value_changed.connect(func(v: float) -> void:
		_projet["soin"] = v
		lib_s.text = tr("Soin de fabrication %d %%") % int(roundf(v * 100.0))
		maj.call())
	_boite_moteurs.add_child(soin)
	lib_s.text = tr("Soin de fabrication %d %%") % int(roundf(float(_projet["soin"]) * 100.0))
	_boite_moteurs.add_child(apercu)
	_boite_moteurs.add_child(cout_l)
	var lancer := Button.new()
	lancer.text = tr("Mettre au banc d'essai")
	lancer.add_theme_font_size_override("font_size", 9)
	lancer.add_theme_color_override("font_color", Palette.ENCRE)
	lancer.disabled = float(state["tresorerie"]) < Moteurs.banc_cout(_projet, data)
	lancer.pressed.connect(func() -> void:
		if not appliquer.is_null() and bool(appliquer.call({"type": "lancer_moteur", "projet": _projet.duplicate(true)})):
			rafraichir())
	_boite_moteurs.add_child(lancer)
	maj.call()
