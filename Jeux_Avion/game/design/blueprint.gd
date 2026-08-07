# Raison d'être : l'écran blueprint — LE hook. Les choix d'ingénierie à gauche, les specs
# qui émergent EN DIRECT à droite, la silhouette procédurale au centre. L'écran n'écrit
# jamais dans le state : il émet des intentions via le Callable `appliquer` injecté par main.
extends Control

const Etat := preload("res://sim/state.gd")
const Avion := preload("res://sim/aircraft.gd")
const Marche := preload("res://sim/market.gd")
const Sim := preload("res://sim/sim.gd")
const Contrats := preload("res://sim/contracts.gd")
const Ingenieurs := preload("res://sim/engineers.gd")
const Moteurs := preload("res://sim/motors.gd")
const Palette := preload("res://game/ui/palette.gd")
const Cartes := preload("res://game/ui/cartes.gd")
const Criteres := preload("res://game/ui/criteres_ui.gd")
const SilhouetteScript := preload("res://game/design/silhouette.gd")

var appliquer: Callable = Callable()  # func(intention: Dictionary) -> bool, injecté par main
var state: Dictionary = {}
var data: Dictionary = {}
var design: Dictionary = {}
var specs: Dictionary = {}
var _pret: bool = false
var _prix_touche: bool = false

var _nom: LineEdit
var _archetype: OptionButton
var _variante: OptionButton
var _formule: OptionButton
var _structure: OptionButton
var _moteur: OptionButton
var _surface: HSlider
var _carburant: HSlider
var _charge: HSlider
var _armement: HSlider
var _cases_features: Dictionary = {}
var _bouton_equip: Button
var _panneau_equip: PanelContainer
var _boite_equip: VBoxContainer
var _bouton_ao: Button
var _panneau_ao: PanelContainer
var _boite_ao: VBoxContainer
var _choix_ao: OptionButton
var _segment: OptionButton
var _criteres: VBoxContainer
var _note_marche: Label
var _prix: SpinBox
var _bouton_lancer: Button
var _retour: Label
var _catalogue: Label
var _purge: Button
var _silhouette: Control
var _lignes_specs: Dictionary = {}
var _etiquettes_curseurs: Dictionary = {}
var _deltas_features: Dictionary = {}
var _fiab_detail: Label
var _boite_essais: VBoxContainer

const SPECS_AFFICHEES: Array = [
	["vmax_kmh", "Vitesse max", "%d km/h", "Vitesse en palier au régime de croisière."],
	["plafond_m", "Plafond", "%d m", "Altitude maximale atteignable — au-delà, l'air se raréfie trop pour tenir le vol."],
	["autonomie_km", "Autonomie", "%d km", "Distance franchissable avec le plein de carburant."],
	["charge_alaire", "Charge alaire", "%d kg/m²", "Masse totale divisée par la surface alaire. Plus elle est basse, plus l'avion vire serré ; trop haute, elle mine la fiabilité (surcharge structurelle)."],
	["maniabilite", "Maniabilité", "%d / 100", "Agilité en vol — monte quand la charge alaire baisse (aile plus grande, avion plus léger). Comptée par l'export militaire et par les concours de chasse de l'entre-deux-guerres ; les intercepteurs tardifs ne jugent que la vitesse et le plafond."],
	["fiabilite", "Fiabilité", "%d %%", "Chance de tenir en service sans incident. Sous 65 %, un accident devient possible à chaque trimestre livré ; au-dessus de 72 %, chaque livraison bâtit la réputation."],
	["capacite", "Passagers", "%d", "Nombre de sièges — dérivé de la charge utile, pertinent pour les segments civils."],
	["masse_totale", "Masse totale", "%d kg", "Cellule + moteur + équipements + carburant + charge utile, au décollage."],
	["cout_unitaire", "Coût unitaire", "%d £", "Ce que coûte à construire UN exemplaire — la marge au marché, c'est prix de vente moins cette valeur."],
	["cout_exploitation", "Coût d'exploitation", "%d", "Coût d'usage estimé (carburant, entretien courant) — pèse dans la note des segments civils, où les compagnies comptent leurs sous."],
	["cout_proto", "Prototype", "%d £", "Prix à payer pour lancer la campagne d'essais en vol de ce design."],
	["delai_semaines", "Études", "%d sem", "Durée de la campagne d'essais en vol avant de pouvoir mettre l'avion en service."],
]


func _ready() -> void:
	# Thème compact : à 640×360, la police 16 par défaut fait déborder les panneaux
	# sous le viewport. Fond charbon : le canevas de main se voit entre les cartes.
	var th := Theme.new()
	th.default_font_size = 9
	theme = th
	var marge := MarginContainer.new()
	marge.set_anchors_preset(Control.PRESET_FULL_RECT)
	for cote: String in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		marge.add_theme_constant_override(cote, 8)
	add_child(marge)
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 8)
	marge.add_child(rangee)
	rangee.add_child(_construire_panneau_gauche())
	_silhouette = SilhouetteScript.new()
	_silhouette.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_silhouette.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_silhouette.clip_contents = true  # sinon le cartouche déborde sur le panneau gauche à petite taille
	rangee.add_child(_silhouette)
	rangee.add_child(_construire_panneau_droit())
	# Volet des équipements : s'ouvre À DROITE de la colonne, par-dessus la silhouette
	# (demande playtest : la liste complète grisée aux trois quarts était illisible —
	# le volet ne montre QUE les équipements dont la techno est acquise).
	_panneau_equip = Cartes.carte(Palette.PAPIER_CREME, 7.0)
	_panneau_equip.visible = false
	_panneau_equip.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	_panneau_equip.offset_left = 216.0
	_panneau_equip.offset_right = 490.0
	_panneau_equip.offset_top = 16.0
	_panneau_equip.offset_bottom = -16.0
	add_child(_panneau_equip)
	var col_e := VBoxContainer.new()
	col_e.add_theme_constant_override("separation", 1)
	_panneau_equip.add_child(col_e)
	var entete_e := HBoxContainer.new()
	var titre_e := _titre("ÉQUIPEMENTS RECHERCHÉS")
	titre_e.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	entete_e.add_child(titre_e)
	var fermer_e := Button.new()
	fermer_e.text = "✕"
	fermer_e.add_theme_font_size_override("font_size", 9)
	fermer_e.pressed.connect(func() -> void: _panneau_equip.visible = false)
	entete_e.add_child(fermer_e)
	col_e.add_child(entete_e)
	var defilement_e := ScrollContainer.new()
	defilement_e.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	defilement_e.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col_e.add_child(defilement_e)
	_boite_equip = VBoxContainer.new()
	_boite_equip.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_boite_equip.add_theme_constant_override("separation", 0)
	defilement_e.add_child(_boite_equip)

	# Volet de comparaison AO : même géométrie que le volet équipements (l'un ferme
	# l'autre visuellement en se recouvrant, mais rien n'empêche techniquement les deux
	# — l'usage normal n'ouvre qu'un volet à la fois).
	_panneau_ao = Cartes.carte(Palette.PAPIER_CREME, 7.0)
	_panneau_ao.visible = false
	_panneau_ao.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	_panneau_ao.offset_left = 216.0
	_panneau_ao.offset_right = 490.0
	_panneau_ao.offset_top = 16.0
	_panneau_ao.offset_bottom = -16.0
	add_child(_panneau_ao)
	var col_a := VBoxContainer.new()
	col_a.add_theme_constant_override("separation", 1)
	_panneau_ao.add_child(col_a)
	var entete_a := HBoxContainer.new()
	var titre_a := _titre("COMPARER À UN APPEL D'OFFRES")
	titre_a.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	titre_a.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	entete_a.add_child(titre_a)
	var fermer_a := Button.new()
	fermer_a.text = "✕"
	fermer_a.add_theme_font_size_override("font_size", 9)
	fermer_a.pressed.connect(func() -> void: _panneau_ao.visible = false)
	entete_a.add_child(fermer_a)
	col_a.add_child(entete_a)
	_choix_ao = OptionButton.new()
	_choix_ao.add_theme_font_size_override("font_size", 9)
	_choix_ao.item_selected.connect(func(_i: int) -> void: _maj_comparaison_ao())
	col_a.add_child(_choix_ao)
	col_a.add_child(HSeparator.new())
	var defilement_a := ScrollContainer.new()
	defilement_a.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	defilement_a.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col_a.add_child(defilement_a)
	_boite_ao = VBoxContainer.new()
	_boite_ao.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_boite_ao.add_theme_constant_override("separation", 1)
	defilement_a.add_child(_boite_ao)


func configurer(state_: Dictionary, data_: Dictionary) -> void:
	state = state_
	data = data_
	_silhouette.data = data
	design = {
		"nom": "Prototype 1",
		"annee": Marche.annee_de(state),
		"formule": "biplan",
		"structure": "bois",
		"moteur": Avion.meilleur_moteur(data, Marche.annee_de(state), "puissance"),
		"surface": 25.0,
		"carburant_kg": 300.0,
		"charge_utile_kg": 200.0,
		"armement": 0,
		"features": [],
	}
	_nom.text = str(design["nom"])
	rafraichir()
	_pret = true
	_recalculer()


# Appelé par main à chaque trimestre : moteurs disponibles, technos débloquées, année.
func rafraichir() -> void:
	var annee: float = Marche.annee_de(state)
	design["annee"] = annee
	var faites: Array = state["recherche"]["faites"]
	# Moteurs de l'année.
	var selection: String = str(design["moteur"])
	_moteur.clear()
	var ids: Array = []
	# Catalogue du commerce DISPONIBLE à l'année + vos moteurs maison (Moteurs.catalogue).
	var dispo: Dictionary = Moteurs.catalogue(state, data, annee)
	for id_m: String in Etat.cles_triees(dispo):
		var m: Dictionary = dispo[id_m]
		# La marque concurrente du partenariat motoriste n'apparaît plus au catalogue.
		if Sim.moteur_interdit(state, data, id_m):
			continue
		ids.append(id_m)
		var maison_m: String = tr("  ·  MAISON") if str(m.get("marque", "")) == "maison" else ""
		_moteur.add_item(tr("%s — %d cv%s") % [str(m["nom"]), int(m["puissance_cv"]), maison_m])
		if id_m == selection:
			_moteur.select(ids.size() - 1)
	_moteur.set_meta("ids", ids)
	# Structure métal gated par la techno monocoque.
	_structure.set_item_disabled(2, not faites.has("monocoque_metal"))
	# Archétypes débloqués : la liste suit l'état de la recherche.
	var ids_a: Array = (state.get("archetypes", []) as Array).duplicate()
	_archetype.clear()
	_archetype.add_item("— libre —")
	for id_a_v: Variant in ids_a:
		_archetype.add_item(str(data["archetypes"][str(id_a_v)]["nom"]))
	_archetype.set_meta("ids", ids_a)
	# Variantes : la liste des designs existants (cellules réutilisables).
	var ids_v: Array = []
	var sel_v: String = str(design.get("variante_de", ""))
	_variante.clear()
	_variante.add_item("— nouveau —")
	for uid_d: String in Etat.cles_triees(state["designs"]):
		ids_v.append(uid_d)
		_variante.add_item(str(state["designs"][uid_d]["design"]["nom"]))
		if uid_d == sel_v:
			_variante.select(ids_v.size())
	_variante.set_meta("ids", ids_v)
	# Volet des équipements : reconstruit sur les technos acquises du moment.
	_construire_cases_features()
	_maj_bouton_equip()
	maj_essais()
	_maj_catalogue()
	# Les deltas fiab varient avec l'ANNÉE du design (avionique : malus→0→bonus). Sans ce
	# recalcul, un trimestre écoulé sur l'écran laisserait des deltas vides/périmés (année
	# avancée mais texte figé) → chiffres trompeurs au moment de choisir l'équipement.
	if _pret:
		_recalculer()


func specs_actuelles() -> Dictionary:
	return specs


# --- construction des panneaux ------------------------------------------------

func _construire_panneau_gauche() -> Control:
	var panneau := Cartes.carte(Palette.PAPIER_CREME, 7.0)
	panneau.custom_minimum_size = Vector2(196.0, 0.0)
	# Défilement vertical : la colonne est plus haute que le viewport sur les petites
	# fenêtres — sans lui, le bas (équipements) devient inaccessible.
	var defilement_col := ScrollContainer.new()
	defilement_col.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panneau.add_child(defilement_col)
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 2)
	defilement_col.add_child(col)

	col.add_child(_titre("CONCEPTION"))
	_nom = LineEdit.new()
	_nom.max_length = 24
	_nom.text_changed.connect(func(t: String) -> void: _changer("nom", t))
	col.add_child(_nom)

	# Préréglages débloqués par combos de technos (étape ③) : partir d'une formule
	# maîtrisée puis la modifier — « votre » Spitfire, découvert, pas acheté.
	_archetype = _options(col, "Archétype", ["— libre —"], func(i: int) -> void:
		_sur_archetype(i),
		tr("Un archétype débloqué (combo de technos maîtrisées) charge un préréglage complet de cellule — formule, structure, équipements — que vous pouvez ensuite ajuster librement."))
	# Variante « Mk II » : repartir de la CELLULE d'un design existant (verrouillée) —
	# proto et études au rabais, moteur et équipements libres.
	_variante = _options(col, "Variante de", ["— nouveau —"], func(i: int) -> void:
		_sur_variante(i),
		tr("Repart de la cellule d'un design existant (formule/structure/surface verrouillées, moteur et équipements libres) : prototype et études au rabais — la vraie histoire des lignées d'avions."))

	_formule = _options(col, "Formule", ["biplan", "monoplan"], func(i: int) -> void:
		_changer("formule", ["biplan", "monoplan"][i]),
		tr("Biplan : deux ailes plus petites, plus de traînée mais cellule plus légère et meilleure maniabilité. Monoplan : plus rapide, formule moderne à partir de 1930."))
	_structure = _options(col, "Structure", ["bois", "mixte", "métal"], func(i: int) -> void:
		_changer("structure", ["bois", "mixte", "metal"][i]),
		tr("Bois : léger et bon marché. Mixte : compromis. Métal (monocoque, requiert la techno) : cellule plus lourde et chère mais plus solide et fiable — la voie de l'avenir."))
	_moteur = _options(col, "Moteur", [], func(i: int) -> void:
		_changer("moteur", str((_moteur.get_meta("ids") as Array)[i])),
		tr("Détermine puissance, masse, consommation et fiabilité de base. Seuls les moteurs disponibles à l'année courante (et de la marque partenaire, le cas échéant) apparaissent."))

	_surface = _curseur(col, "surface", "Surface alaire", 12.0, 60.0, 1.0, 25.0, "%d m²",
		tr("Plus grande, elle porte davantage (plafond, charge utile) mais traîne plus (vitesse) — le compromis central de la conception."))
	_carburant = _curseur(col, "carburant_kg", "Carburant", 100.0, 1600.0, 20.0, 300.0, "%d kg",
		tr("Détermine l'autonomie. Alourdit l'appareil : plus de carburant coûte de la vitesse et de la maniabilité."))
	_charge = _curseur(col, "charge_utile_kg", "Charge utile", 0.0, 2200.0, 45.0, 200.0, "%d kg",
		tr("Passagers ou fret transportable (90 kg = 1 passager). Pèse sur la masse totale comme le carburant."))
	_armement = _curseur(col, "armement", "Armement", 0.0, 3.0, 1.0, 0.0, "%d",
		tr("Nombre d'armes fixes montées. Alourdit et alentit l'appareil, mais compte dans les critères militaires et les Spécifications."))

	col.add_child(_titre("ÉQUIPEMENTS"))
	_bouton_equip = Button.new()
	_bouton_equip.add_theme_font_size_override("font_size", 9)
	_bouton_equip.add_theme_color_override("font_color", Palette.ENCRE)
	_bouton_equip.pressed.connect(func() -> void:
		_panneau_equip.visible = not _panneau_equip.visible)
	col.add_child(_bouton_equip)
	return panneau


# Reconstruit le volet à partir des technos ACQUISES seulement — appelé par rafraichir()
# (la liste ne fait que grandir avec la recherche, les cases suivent le design courant).
func _construire_cases_features() -> void:
	for enfant: Node in _boite_equip.get_children():
		enfant.queue_free()
	_cases_features.clear()
	_deltas_features.clear()
	var faites: Array = state["recherche"]["faites"]
	var montees: Array = design.get("features", [])
	for f_v: Variant in Avion.FEATURES_DESIGN:
		var f: String = str(f_v)
		if not faites.has(f):
			continue
		var case_f := CheckBox.new()
		case_f.text = str(data["technos"][f]["nom"])
		case_f.add_theme_font_size_override("font_size", 9)
		case_f.add_theme_color_override("font_color", Palette.ENCRE)
		case_f.set_pressed_no_signal(montees.has(f))
		case_f.toggled.connect(func(actif: bool) -> void: _basculer_feature(f, actif))
		_boite_equip.add_child(case_f)
		_cases_features[f] = case_f
		# L'effet CHIFFRÉ de l'équipement sur CE design (retour playtest n°4 : « il
		# faudrait des chiffres ») — recalculé à chaque changement, formules réelles.
		var delta_l := Label.new()
		delta_l.add_theme_font_size_override("font_size", 9)
		delta_l.add_theme_color_override("font_color", Palette.GRIS_ACIER)
		delta_l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_boite_equip.add_child(delta_l)
		_deltas_features[f] = delta_l
	if _cases_features.is_empty():
		var vide := Label.new()
		vide.text = "rien encore — le Labo débloque les équipements"
		vide.add_theme_font_size_override("font_size", 9)
		vide.add_theme_color_override("font_color", Palette.GRIS_ACIER)
		vide.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_boite_equip.add_child(vide)


func _construire_panneau_droit() -> Control:
	var panneau := Cartes.carte(Palette.PAPIER_CREME, 7.0)
	panneau.custom_minimum_size = Vector2(168.0, 0.0)
	# Défilement vertical : specs + lancement dépassent le viewport (cf. panneau gauche).
	var defilement_col := ScrollContainer.new()
	defilement_col.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panneau.add_child(defilement_col)
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 1)
	defilement_col.add_child(col)

	col.add_child(_titre("SPECS ÉMERGENTES"))
	for ligne: Array in SPECS_AFFICHEES:
		var rangee := HBoxContainer.new()
		rangee.tooltip_text = tr(str(ligne[3]))
		rangee.mouse_filter = Control.MOUSE_FILTER_STOP
		var gauche := Label.new()
		gauche.text = str(ligne[1])
		gauche.add_theme_font_size_override("font_size", 9)
		gauche.add_theme_color_override("font_color", Palette.ENCRE)
		gauche.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		gauche.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var droite := Label.new()
		droite.add_theme_font_size_override("font_size", 9)
		droite.add_theme_color_override("font_color", Palette.BLEU_CYANOTYPE)
		droite.mouse_filter = Control.MOUSE_FILTER_IGNORE
		rangee.add_child(gauche)
		rangee.add_child(droite)
		col.add_child(rangee)
		_lignes_specs[str(ligne[0])] = droite
	_fiab_detail = Label.new()
	_fiab_detail.add_theme_font_size_override("font_size", 9)
	_fiab_detail.add_theme_color_override("font_color", Palette.GRIS_ACIER)
	_fiab_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_fiab_detail)

	col.add_child(HSeparator.new())
	col.add_child(_titre("ESSAIS EN VOL"))
	_boite_essais = VBoxContainer.new()
	_boite_essais.add_theme_constant_override("separation", 1)
	col.add_child(_boite_essais)

	col.add_child(HSeparator.new())
	col.add_child(_titre("LANCEMENT"))
	_segment = _options(col, "Segment", ["ligne_postale", "transport_civil", "export_militaire"], func(_i: int) -> void: _recalculer(),
		tr("Le marché sur lequel ce design sera vendu — chaque segment juge des critères différents (voir la NOTE MARCHÉ ci-dessous)."))
	# Ce que le segment attend, et ce que vaut l'avion : le joueur voit s'il vendra
	# AVANT de payer le prototype (la note reprend la formule exacte du marché).
	# Une ligne par critère (pas un label qui wrap) : nom à gauche, étoiles+flèche à droite.
	_criteres = VBoxContainer.new()
	_criteres.add_theme_constant_override("separation", 0)
	col.add_child(_criteres)
	_note_marche = Label.new()
	_note_marche.add_theme_font_size_override("font_size", 9)
	col.add_child(_note_marche)
	# Comparer aux Spécifications/commandes ouvertes : même besoin que la note marché,
	# mais pour les AO — cahier des charges différent, pas de segment à choisir.
	_bouton_ao = Button.new()
	_bouton_ao.text = tr("Comparer à un appel d'offres")
	_bouton_ao.add_theme_font_size_override("font_size", 9)
	_bouton_ao.add_theme_color_override("font_color", Palette.ENCRE)
	_bouton_ao.tooltip_text = tr("Voir comment ce design noterait sur les Spécifications ou commandes actuellement ouvertes, AVANT de payer le prototype.")
	_bouton_ao.pressed.connect(func() -> void:
		_panneau_ao.visible = not _panneau_ao.visible
		if _panneau_ao.visible:
			_maj_liste_ao()
			_maj_comparaison_ao())
	col.add_child(_bouton_ao)
	_prix = SpinBox.new()
	_prix.min_value = 0.0
	_prix.max_value = 5000000.0
	_prix.step = 1000.0
	_prix.custom_minimum_size = Vector2(84.0, 0.0)
	_prix.tooltip_text = tr("Prix de vente unitaire au segment choisi. Pré-rempli à coût × 1.25 ; modifiable une fois lancé, depuis l'écran Marché.")
	_prix.value_changed.connect(func(_v: float) -> void: _prix_touche = true)
	col.add_child(_prix)
	_bouton_lancer = Button.new()
	_bouton_lancer.text = "Prototyper et essayer"
	_bouton_lancer.add_theme_color_override("font_color", Palette.ENCRE)
	_bouton_lancer.tooltip_text = tr("Paie le coût du prototype et ouvre une campagne d'essais en vol. Des défauts peuvent être révélés à la fin — corrigez-les ou mettez l'avion en service tel quel avant de le vendre.")
	_bouton_lancer.pressed.connect(_sur_lancer)
	col.add_child(_bouton_lancer)
	_retour = Label.new()
	_retour.add_theme_font_size_override("font_size", 9)
	_retour.add_theme_color_override("font_color", Palette.VERT_LAMPE)
	_retour.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_retour)
	_catalogue = Label.new()
	_catalogue.add_theme_font_size_override("font_size", 9)
	_catalogue.add_theme_color_override("font_color", Palette.ENCRE)
	col.add_child(_catalogue)
	# Chaque lancement refusé (trésorerie, catalogue plein) laisse un design orphelin :
	# sans purge ils s'entassent à vie dans la sauvegarde.
	_purge = Button.new()
	_purge.add_theme_color_override("font_color", Palette.ENCRE)
	_purge.tooltip_text = tr("Jette les brouillons de conception qu'aucun produit en vente ne réclame — ils s'accumuleraient sinon indéfiniment dans la sauvegarde.")
	_purge.pressed.connect(_sur_purger)
	col.add_child(_purge)
	return panneau


# --- réactions -----------------------------------------------------------------

func _changer(cle: String, valeur: Variant) -> void:
	if not _pret:
		return
	design[cle] = valeur
	_recalculer()


# Charge le préréglage de l'archétype choisi puis resynchronise tous les contrôles.
# Le moteur reste le meilleur de l'année : l'archétype est une cellule, pas un moteur.
func _sur_archetype(i: int) -> void:
	if not _pret or i <= 0:
		return
	# Un archétype repart d'une cellule NEUVE : toute variante en cours est abandonnée.
	design.erase("variante_de")
	design.erase("variante")
	_variante.select(0)
	_formule.disabled = false
	_structure.disabled = false
	_surface.editable = true
	var ids_a: Array = _archetype.get_meta("ids") as Array
	if i - 1 >= ids_a.size():
		return
	var id_a: String = str(ids_a[i - 1])
	var pre: Dictionary = data["archetypes"][id_a]["design"]
	design["nom"] = str(data["archetypes"][id_a]["nom"])
	design["formule"] = str(pre["formule"])
	design["structure"] = str(pre["structure"])
	design["surface"] = float(pre["surface"])
	design["carburant_kg"] = float(pre["carburant_kg"])
	design["charge_utile_kg"] = float(pre["charge_utile_kg"])
	design["armement"] = int(pre["armement"])
	design["features"] = (pre["features"] as Array).duplicate()
	design["moteur"] = Avion.meilleur_moteur(data, Marche.annee_de(state), "puissance")
	_nom.text = str(design["nom"])
	_formule.select(0 if str(design["formule"]) == "biplan" else 1)
	_structure.select({"bois": 0, "mixte": 1, "metal": 2}[str(design["structure"])])
	for cle: String in ["surface", "carburant_kg", "charge_utile_kg", "armement"]:
		((_etiquettes_curseurs[cle] as Array)[1] as HSlider).set_value_no_signal(float(design[cle]))
	for f: String in _cases_features:
		(_cases_features[f] as CheckBox).set_pressed_no_signal((design["features"] as Array).has(f))
	rafraichir()
	_recalculer()


# Choix d'une cellule parente : charge le design, VERROUILLE formule/structure/surface
# (la cellule est la cellule), libère moteur/équipements. « — nouveau — » déverrouille tout.
func _sur_variante(i: int) -> void:
	if not _pret:
		return
	var ids_v: Array = _variante.get_meta("ids") as Array
	if i <= 0 or i - 1 >= ids_v.size():
		design.erase("variante_de")
		design.erase("variante")
		_formule.disabled = false
		_structure.disabled = false
		_surface.editable = true
		_recalculer()
		return
	var uid_p: String = str(ids_v[i - 1])
	var parent: Dictionary = state["designs"][uid_p]["design"]
	design = parent.duplicate(true)
	design["variante_de"] = uid_p
	design["variante"] = true
	design["nom"] = str(parent["nom"]) + " Mk II"
	design["annee"] = Marche.annee_de(state)
	_nom.text = str(design["nom"])
	_formule.select(0 if str(design["formule"]) == "biplan" else 1)
	_structure.select({"bois": 0, "mixte": 1, "metal": 2}[str(design["structure"])])
	for cle: String in ["surface", "carburant_kg", "charge_utile_kg", "armement"]:
		((_etiquettes_curseurs[cle] as Array)[1] as HSlider).set_value_no_signal(float(design[cle]))
	# Seule la formule reste verrouillée : structure et surface sont modifiables (rabais
	# proto/études dégressif selon l'écart au parent — cf. Sim.variante_mults).
	_formule.disabled = true
	_structure.disabled = false
	_surface.editable = true
	rafraichir()
	_recalculer()


func _basculer_feature(f: String, actif: bool) -> void:
	if not _pret:
		return
	var feats: Array = design["features"]
	if actif and not feats.has(f):
		feats.append(f)
	elif not actif:
		feats.erase(f)
	_maj_bouton_equip()
	_recalculer()


# Le bouton du volet dit combien d'équipements sont montés sans avoir à l'ouvrir.
func _maj_bouton_equip() -> void:
	if _bouton_equip == null:
		return
	_bouton_equip.text = tr("Choisir… (%d monté(s) / %d recherchés)") \
		% [(design.get("features", []) as Array).size(), _cases_features.size()]


func _recalculer() -> void:
	if design.is_empty():
		return
	# Même remise motoriste que la sim posera au lancement : le coût affiché ne ment pas.
	design["remise_moteur"] = Sim.remise_moteur(state, data, str(design["moteur"]))
	# Maturité de fiabilité (modèle C) pour la PRÉVISUALISATION : ans depuis TA recherche de
	# chaque techno déjà acquise (pas seulement montée, sinon le delta d'un équipement à
	# cocher partirait sur le fallback calendrier). La sim re-tamponne l'autorité au lancement.
	var annees_r: Dictionary = state["recherche"].get("annees", {})
	var annee_d: float = Marche.annee_de(state)
	var mat: Dictionary = {}
	for f_v: Variant in state["recherche"]["faites"]:
		var f: String = str(f_v)
		mat[f] = maxf(0.0, annee_d - float(annees_r.get(f, annee_d)))
	design["mat_features"] = mat
	# Moteur MAISON : même tampon que la sim (`sim._nouveau_design`). Sans lui, `Avion.specs`
	# cherchait le moteur dans `data["engines"]`, ne le trouvait pas, et le calcul avortait —
	# les specs affichées restaient figées sur leur dernière valeur, quel que soit le curseur
	# qu'on bougeait (playtest n°7 : « avec mon moteur maison les stats ne bougent pas »).
	var maison_m: Dictionary = Moteurs.moteurs(state)
	if maison_m.has(str(design["moteur"])):
		design["moteur_specs"] = (maison_m[str(design["moteur"])] as Dictionary).duplicate(true)
	else:
		design.erase("moteur_specs")
	# Rabais variante dégressif pour l'aperçu du coût proto (la sim re-tamponne l'autorité
	# au lancement) : dépend de l'écart structure/surface au parent, qui changent en live.
	if design.has("variante_de") and (state["designs"] as Dictionary).has(str(design["variante_de"])):
		var parent_v: Dictionary = state["designs"][str(design["variante_de"])]["design"]
		var vm: Dictionary = Sim.variante_mults(design, parent_v, data)
		design["variante_proto_mult"] = vm["proto"]
		design["variante_delai_mult"] = vm["delai"]
	else:
		design.erase("variante_proto_mult")
		design.erase("variante_delai_mult")
	specs = Avion.specs(design, data)
	for cle: String in _lignes_specs:
		var valeur: float = float(specs[cle])
		if cle == "fiabilite":
			valeur *= 100.0
		elif cle == "cout_proto":
			# Le PRIX RÉELLEMENT DÉBITÉ : `sim.prototyper` applique la remise du bureau
			# d'études (`Ingenieurs.bonus etudes`). Sans ça, l'écran Équipe annonçait
			# « Prototype −8 % » et le Bureau affichait le tarif plein — l'embauche
			# paraissait sans effet (playtest n°7).
			valeur *= 1.0 - Ingenieurs.bonus(state, data, "etudes")
		var gabarit: String = ""
		for ligne: Array in SPECS_AFFICHEES:
			if str(ligne[0]) == cle:
				gabarit = str(ligne[2])
		(_lignes_specs[cle] as Label).text = tr(gabarit) % int(valeur)
	if not _prix_touche:
		_prix.set_value_no_signal(roundf(float(specs["cout_unitaire"]) * 1.25))
	# Le « pourquoi » de la fiabilité, en points (retour playtest n°4 : facteurs opaques).
	var comp: Dictionary = Avion.fiab_composantes(design, data, float(specs["charge_alaire"]))
	_fiab_detail.text = tr("fiab = moteur %d · équip. %+d · cellule %+d · surcharge %+d") % [
		int(roundf(float(comp["moteur"]) * 100.0)), int(roundf(float(comp["equipements"]) * 100.0)),
		int(roundf(float(comp["cellule"]) * 100.0)), int(roundf(float(comp["surcharge"]) * 100.0))]
	# Delta chiffré de chaque équipement sur le design courant.
	for f: String in _deltas_features:
		var resume: String = Criteres.resume_delta(Avion.delta_feature(design, data, f))
		(_deltas_features[f] as Label).text = "    " + (resume if resume != "" else tr("effet négligeable ici"))
	for cle_c: String in _etiquettes_curseurs:
		var paire: Array = _etiquettes_curseurs[cle_c]
		(paire[0] as Label).text = tr(str(paire[2])) % int(float(design[cle_c]))
	_silhouette.design = design
	_silhouette.specs_vue = specs
	_silhouette.queue_redraw()
	_maj_note_marche()
	if _panneau_ao != null and _panneau_ao.visible:
		_maj_comparaison_ao()


# Attentes du segment + verdict — en INDICES seulement : des étoiles pour l'importance,
# des flèches pour situer l'avion. Les poids, réfs et la note chiffrée restent secrets,
# c'est au joueur de sentir le marché (la formule exacte tourne toujours en dessous).
func _maj_note_marche() -> void:
	if state.is_empty():
		return
	var nom_seg: String = _segment_choisi()
	var seg: Dictionary = data["segments"][nom_seg]
	var annee: float = Marche.annee_de(state)
	var rep: float = float(state["rep"][str(seg["domaine_repu"])])
	for enfant: Node in _criteres.get_children():
		enfant.queue_free()
	for crit: Dictionary in Criteres.tries(seg):
		var etoiles: String = Criteres.etoiles(float(crit["poids"]))
		var val: float = rep if str(crit["spec"]) == "reputation" else float(specs[str(crit["spec"])])
		var ref: float = Marche.interp(crit["ref"], annee)
		var ratio: float = (ref / maxf(val, 0.0001)) if bool(crit["inverse"]) else (val / maxf(ref, 0.0001))
		var fleche: String = "▲" if ratio >= 1.1 else ("≈" if ratio >= 0.85 else "▼")
		var couleur: Color = Palette.VERT_LAMPE if fleche == "▲" else (Palette.GRIS_ACIER if fleche == "≈" else Palette.ROUGE_ALERTE)
		var rangee_c := HBoxContainer.new()
		var gauche_c := Label.new()
		gauche_c.text = Criteres.nom(str(crit["nom"]))
		gauche_c.add_theme_font_size_override("font_size", 9)
		gauche_c.add_theme_color_override("font_color", Palette.GRIS_ACIER)
		gauche_c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var droite_c := Label.new()
		droite_c.text = "%s %s" % [etoiles, fleche]
		droite_c.add_theme_font_size_override("font_size", 9)
		droite_c.add_theme_color_override("font_color", couleur)
		rangee_c.add_child(gauche_c)
		rangee_c.add_child(droite_c)
		_criteres.add_child(rangee_c)
	var note: float = Marche.qualite_segment(data, nom_seg, specs, annee, rep)
	var avis: String = tr("les clients fuiront")
	var couleur: Color = Palette.ROUGE_ALERTE
	if note >= 1.0:
		avis = tr("les compagnies en parlent déjà")
		couleur = Palette.VERT_LAMPE
	elif note >= 0.8:
		avis = tr("il trouvera preneur")
		couleur = Palette.ENCRE
	elif note >= 0.6:
		avis = tr("les acheteurs hésitent")
		couleur = Palette.BOIS_MIEL
	_note_marche.text = tr("Note marché : %s") % avis
	_note_marche.add_theme_color_override("font_color", couleur)


# Liste des AO/commandes actuellement ouverts — reconstruite à l'ouverture du volet
# (la fenêtre change peu, inutile de la refaire à chaque frappe de curseur).
func _maj_liste_ao() -> void:
	var ouverts: Array = Contrats.ouverts(state, data)
	_choix_ao.clear()
	if ouverts.is_empty():
		_choix_ao.add_item(tr("— aucun appel d'offres ouvert —"))
		_choix_ao.disabled = true
	else:
		_choix_ao.disabled = false
		for id_ao: String in ouverts:
			_choix_ao.add_item(str(data["contracts"]["programmes"][id_ao]["nom"]))
	_choix_ao.set_meta("ids", ouverts)


# Cahier des charges chiffré de l'AO choisi vs les specs du design COURANT — même
# principe que la note marché, mais l'AO affiche déjà les réfs en clair ailleurs
# dans le jeu (écran Concours), donc pas de raison de les cacher ici non plus.
func _maj_comparaison_ao() -> void:
	for enfant: Node in _boite_ao.get_children():
		enfant.queue_free()
	var ids: Array = _choix_ao.get_meta("ids", []) as Array
	if ids.is_empty():
		_boite_ao.add_child(_l(tr("Aucun appel d'offres ouvert actuellement — revenez plus tard."), Palette.GRIS_ACIER, true))
		return
	var id_ao: String = str(ids[clampi(_choix_ao.selected, 0, ids.size() - 1)])
	var ao: Dictionary = data["contracts"]["programmes"][id_ao]
	var n: Dictionary = Contrats.note_specs(state, data, id_ao, specs)
	var notes: Dictionary = n["notes"]
	for crit: Dictionary in ao["criteres"]:
		var nom_c: String = str(crit["nom"])
		var ratio: float = float(notes.get(nom_c, 0.0))
		var couleur_c: Color = Palette.VERT_LAMPE if ratio >= 1.0 else (Palette.BOIS_MIEL if ratio >= 0.85 else Palette.ROUGE_ALERTE)
		var rangee_c := HBoxContainer.new()
		var gauche_c := _l(tr("%s ×%.2f") % [nom_c, float(crit["poids"])], Palette.GRIS_ACIER, false)
		gauche_c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rangee_c.add_child(gauche_c)
		rangee_c.add_child(_l("%.2f" % ratio, couleur_c, false))
		_boite_ao.add_child(rangee_c)
	_boite_ao.add_child(HSeparator.new())
	var score: float = float(n["score"])
	var seuil: float = float(ao["seuil"])
	var l_score := _l(tr("note %.2f — seuil %.2f") % [score, seuil],
		Palette.VERT_LAMPE if score >= seuil else Palette.ROUGE_ALERTE, true)
	l_score.tooltip_text = tr("Estimation live : votre score doit dépasser le seuil ET battre les rivaux pour l'emporter — ce chiffre ne dit que si vous êtes dans la course.")
	l_score.mouse_filter = Control.MOUSE_FILTER_STOP
	_boite_ao.add_child(l_score)


func _l(texte: String, couleur: Color, wrap: bool) -> Label:
	var l := Label.new()
	l.text = texte
	l.add_theme_font_size_override("font_size", 9)
	l.add_theme_color_override("font_color", couleur)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART if wrap else TextServer.AUTOWRAP_OFF
	return l


# Le chemin joueur passe par les ESSAIS : payer le proto ouvre une campagne en vol,
# la mise en service (segment + prix du panneau) se décide quand elle est finie.
func _sur_lancer() -> void:
	if appliquer.is_null():
		return
	var uid: String = "d%d" % int(state["prochain_id"])
	# Segment et prix FIGÉS au lancement : la campagne d'essais dure des mois pendant
	# lesquels le joueur dessine autre chose — les relire au panneau à la sortie donnait
	# le segment du design SUIVANT (playtest : un postal mis en service en transport).
	var payload: Dictionary = design.duplicate(true)
	payload["segment"] = _segment_choisi()
	payload["prix"] = float(_prix.value)
	if not bool(appliquer.call({"type": "nouveau_design", "design": payload})):
		_signaler(tr("Design refusé : techno manquante ou moteur indisponible."), true)
		return
	if bool(appliquer.call({"type": "prototyper", "design": uid})):
		_signaler(tr("Prototype payé (%d £) — campagne d'essais de %d semaines ouverte.")
			% [int(float(specs["cout_proto"]) * (1.0 - Ingenieurs.bonus(state, data, "etudes"))),
				int(specs["delai_semaines"])], false)
	else:
		_signaler(tr("Refusé : trésorerie insuffisante ou déjà en essais."), true)
	maj_essais()
	_maj_catalogue()


func _sur_servir(uid_design: String) -> void:
	if appliquer.is_null():
		return
	var d: Dictionary = (state["designs"] as Dictionary).get(uid_design, {}).get("design", {})
	var seg: String = str(d.get("segment", _segment_choisi()))  # vieux saves : repli sur le panneau
	if bool(appliquer.call({"type": "mettre_en_service", "design": uid_design,
			"segment": seg, "prix": float(d.get("prix", _prix.value))})):
		_signaler(tr("« %s » entre en service (%s).") % [_nom_design(uid_design), seg], false)
	else:
		_signaler(tr("Refusé : essais inachevés ou catalogue plein (4 max)."), true)
	maj_essais()
	_maj_catalogue()


func _segment_choisi() -> String:
	return ["ligne_postale", "transport_civil", "export_militaire"][clampi(_segment.selected, 0, 2)]


# Le segment figé au lancement — affiché sur la fiche d'essais pour qu'il ne soit pas
# une surprise à la mise en service.
func _segment_design(uid_design: String) -> String:
	var d: Dictionary = (state["designs"] as Dictionary).get(uid_design, {}).get("design", {})
	return str(d.get("segment", ""))


func _nom_design(uid_design: String) -> String:
	if (state["designs"] as Dictionary).has(uid_design):
		return str(state["designs"][uid_design]["design"]["nom"])
	return uid_design


# Reconstruit la carte des campagnes d'essais — appelée par main à chaque tick si
# l'écran est visible (le compte à rebours est hebdomadaire).
func maj_essais() -> void:
	if state.is_empty() or _boite_essais == null:
		return
	for enfant: Node in _boite_essais.get_children():
		enfant.queue_free()
	var essais: Dictionary = state.get("essais", {})
	if essais.is_empty():
		var vide := Label.new()
		vide.text = "aucun prototype en essais"
		vide.add_theme_font_size_override("font_size", 9)
		vide.add_theme_color_override("font_color", Palette.GRIS_ACIER)
		_boite_essais.add_child(vide)
		return
	for uid_d: String in Etat.cles_triees(essais):
		var essai: Dictionary = essais[uid_d]
		var titre := Label.new()
		titre.add_theme_font_size_override("font_size", 9)
		titre.add_theme_color_override("font_color", Palette.ENCRE)
		_boite_essais.add_child(titre)
		var seg_d: String = _segment_design(uid_d)
		titre.tooltip_text = tr("Sera mis en service sur : %s (figé au lancement du prototype).") % seg_d
		if float(essai["restant"]) > 0.0:
			titre.text = tr("« %s » [%s] — en vol, %d sem") % [_nom_design(uid_d), seg_d, int(ceilf(float(essai["restant"])))]
			continue
		if not (essai["correction"] as Dictionary).is_empty():
			var corr: Dictionary = essai["correction"]
			titre.text = tr("« %s » — correction : %s (%d sem)") % [_nom_design(uid_d),
				str(data["essais"]["defauts"][str(corr["id"])]["nom"]), int(ceilf(float(corr["restant"])))]
			continue
		titre.text = tr("« %s » [%s] — campagne terminée") % [_nom_design(uid_d), seg_d]
		for d: Dictionary in essai["defauts"]:
			var fiche: Dictionary = data["essais"]["defauts"][str(d["id"])]
			if bool(d["corrige"]):
				var ok := Label.new()
				ok.text = tr("  corrigé : %s") % str(fiche["nom"])
				ok.add_theme_font_size_override("font_size", 9)
				ok.add_theme_color_override("font_color", Palette.VERT_LAMPE)
				_boite_essais.add_child(ok)
				continue
			var ligne := HBoxContainer.new()
			var texte := Label.new()
			texte.text = "  %s (%s)" % [str(fiche["nom"]), Criteres.resume_delta(fiche["effet"])]
			texte.add_theme_font_size_override("font_size", 9)
			texte.add_theme_color_override("font_color", Palette.ROUGE_ALERTE)
			texte.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			texte.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			ligne.add_child(texte)
			var bouton := Button.new()
			bouton.text = tr("Corriger %d £ · %d sem") % [int(fiche["cout"]), int(fiche["sem"])]
			bouton.add_theme_font_size_override("font_size", 9)
			var id_d: String = str(d["id"])
			bouton.pressed.connect(func() -> void:
				if bool(appliquer.call({"type": "corriger_defaut", "design": uid_d, "defaut": id_d})):
					maj_essais())
			ligne.add_child(bouton)
			_boite_essais.add_child(ligne)
		var actions := HBoxContainer.new()
		var servir := Button.new()
		servir.text = "Mettre en service"
		servir.add_theme_font_size_override("font_size", 9)
		servir.pressed.connect(func() -> void: _sur_servir(uid_d))
		actions.add_child(servir)
		var jeter := Button.new()
		jeter.text = "Abandonner"
		jeter.add_theme_font_size_override("font_size", 9)
		jeter.pressed.connect(func() -> void:
			if bool(appliquer.call({"type": "abandonner_essais", "design": uid_d})):
				maj_essais())
		actions.add_child(jeter)
		_boite_essais.add_child(actions)


func _signaler(texte: String, erreur: bool) -> void:
	_retour.text = texte
	_retour.add_theme_color_override("font_color", Palette.ROUGE_ALERTE if erreur else Palette.VERT_LAMPE)


func _maj_catalogue() -> void:
	if state.is_empty():
		return
	_catalogue.text = tr("Catalogue : %d / %d") % [(state["catalogue"] as Dictionary).size(), Sim.max_produits(state, data)]
	var orphelins: int = _brouillons().size()
	_purge.text = tr("Brouillons : %d — purger") % orphelins
	_purge.disabled = orphelins == 0


# Les designs qu'aucun produit du catalogue ne réclame : la sim refuse de supprimer les autres.
func _brouillons() -> Array:
	var utilises: Array = []
	for uid_p: String in Etat.cles_triees(state["catalogue"]):
		utilises.append(str(state["catalogue"][uid_p]["design_uid"]))
	var libres: Array = []
	for uid_d: String in Etat.cles_triees(state["designs"]):
		if not utilises.has(uid_d):
			libres.append(uid_d)
	return libres


func _sur_purger() -> void:
	if appliquer.is_null():
		return
	var n: int = 0
	for uid_d: String in _brouillons():
		if bool(appliquer.call({"type": "supprimer_design", "design": uid_d})):
			n += 1
	_signaler(tr("%d brouillon(s) jeté(s) à la corbeille.") % n, false)
	_maj_catalogue()


# --- petits constructeurs ------------------------------------------------------

func _titre(texte: String) -> Label:
	var l := Label.new()
	l.text = texte
	l.add_theme_font_size_override("font_size", 9)
	l.add_theme_color_override("font_color", Palette.BOIS_MIEL)
	return l


func _options(col: VBoxContainer, titre: String, choix: Array, sur_choix: Callable, infobulle: String = "") -> OptionButton:
	var l := Label.new()
	l.text = titre
	l.add_theme_font_size_override("font_size", 9)
	l.add_theme_color_override("font_color", Palette.GRIS_ACIER)
	col.add_child(l)
	var ob := OptionButton.new()
	ob.add_theme_font_size_override("font_size", 9)
	if infobulle != "":
		ob.tooltip_text = infobulle
	for c: Variant in choix:
		ob.add_item(str(c))
	ob.item_selected.connect(sur_choix)
	col.add_child(ob)
	return ob


func _curseur(col: VBoxContainer, cle: String, titre: String, minimum: float, maximum: float, pas: float, defaut: float, gabarit: String, infobulle: String = "") -> HSlider:
	var rangee := HBoxContainer.new()
	if infobulle != "":
		rangee.tooltip_text = infobulle
		rangee.mouse_filter = Control.MOUSE_FILTER_STOP
	var l := Label.new()
	l.text = titre
	l.add_theme_font_size_override("font_size", 9)
	l.add_theme_color_override("font_color", Palette.GRIS_ACIER)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var v := Label.new()
	v.add_theme_font_size_override("font_size", 9)
	v.add_theme_color_override("font_color", Palette.ENCRE)
	v.text = gabarit % int(defaut)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rangee.add_child(l)
	rangee.add_child(v)
	col.add_child(rangee)
	var curseur := HSlider.new()
	curseur.min_value = minimum
	curseur.max_value = maximum
	curseur.step = pas
	curseur.value = defaut
	if infobulle != "":
		curseur.tooltip_text = infobulle
	curseur.value_changed.connect(func(valeur: float) -> void:
		_changer(cle, valeur if cle != "armement" else int(valeur)))
	col.add_child(curseur)
	_etiquettes_curseurs[cle] = [v, curseur, gabarit]
	return curseur
