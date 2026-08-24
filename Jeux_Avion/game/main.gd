# Raison d'être : la coquille du jeu — horloge sim sur Timer (aucun _process nulle part),
# barre du haut (date, trésorerie, vitesse), routage des écrans, raccourcis clavier,
# auto-save/reprise sur 3 emplacements. Seul endroit qui appelle Sim.tick / Sim.appliquer.
extends Control

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Contrats := preload("res://sim/contracts.gd")
const Raids := preload("res://sim/raids.gd")
const Essais := preload("res://sim/essais.gd")
const Moteurs := preload("res://sim/motors.gd")
const Palette := preload("res://game/ui/palette.gd")
const Cartes := preload("res://game/ui/cartes.gd")
const BlueprintScript := preload("res://game/design/blueprint.gd")
const MarcheScript := preload("res://game/market_ui/marche.gd")
const AoScript := preload("res://game/contracts_ui/ao.gd")
const EquipeScript := preload("res://game/office/equipe.gd")
const RechercheScript := preload("res://game/research_ui/recherche.gd")
const DirectionScript := preload("res://game/direction/direction.gd")
const ComptesScript := preload("res://game/comptes/comptes.gd")
const Courbe := preload("res://game/ui/courbe.gd")
const FinScript := preload("res://game/end/fin.gd")
const Sons := preload("res://game/ui/sons.gd")
const I18n := preload("res://game/ui/i18n.gd")

# Fichier unique d'avant les emplacements : récupéré comme emplacement 1 à la première reprise.
const CHEMIN_SAUVEGARDE_ANCIEN: String = "user://sauvegarde.json"
const CHEMIN_OPTIONS: String = "user://options.json"
const NB_EMPLACEMENTS: int = 3

var state: Dictionary = {}
var data: Dictionary = {}
var horloge: Timer
var blueprint: Control
var marche: Control
var ao: Control
var equipe: Control
var recherche: Control
var direction: Control
var comptes: Control
var _ecrans: Array = []
var _boutons_ecran: Array = []
var _voile: Panel
var _ev_titre: Label
var _ev_texte: Label
var _ev_boutons: Array = []
var _date: Label
var _tresorerie: Label
var _bilan_trim: Label
var _livraisons_prec: float = 0.0
var _marge_prec: float = 0.0
var fin_ecran: Control
var options: Dictionary = {}
var _slot: int = 1
var _panneau_options: PanelContainer
var _boutons_vitesse: Array = []
var _barre_temps: ProgressBar
var _tween_temps: Tween
var _ecran_actif: int = 0
# Dernière vitesse NON nulle : une pause auto (événement, presse) doit rendre au joueur
# la vitesse qu'il avait choisie, pas le laisser recliquer ×4 seize fois par campagne.
var _vitesse_prec: int = 0
var _rouge_prec: bool = false
var _son_clic: AudioStreamPlayer
var _son_alerte: AudioStreamPlayer
# Toasts d'ouverture (concours, courses) : petites cartes en bas à droite, sans pause —
# retour playtest n°4, la une plein écran est réservée aux événements à choix.
var _toasts: VBoxContainer
var _annonces_vues: Array = []


# La pente avant la faillite : 5 ans de trésorerie trimestrielle, zéro souligné en rouge.
func _ready() -> void:
	var th := Theme.new()
	# Direction « rétro moderne » (retour propriétaire : la police pixel faisait « vieux ») :
	# fonte lisse par défaut du moteur, antialiasée — le stretch canvas_items la re-rend
	# nette à la résolution réelle de la fenêtre, quelle que soit l'échelle.
	# Les thèmes des écrans enfants ne définissent ni police ni styles : tout remonte ici.
	th.default_font_size = 9
	_styler(th)
	theme = th
	data = Etat.charger_data()
	# Les options avant l'état : c'est elles qui portent l'emplacement de sauvegarde actif.
	options = _charger_options()
	# Langue avant toute construction d'UI : les libellés statiques s'auto-traduisent à leur
	# création selon la locale courante (le français est la langue source, identité).
	I18n.appliquer(str(options.get("langue", "fr")))
	_slot = clampi(int(options.get("slot", 1)), 1, NB_EMPLACEMENTS)
	state = _charger_ou_creer()
	_rouge_prec = float(state["tresorerie"]) < 0.0
	_son_clic = AudioStreamPlayer.new()
	_son_clic.stream = Sons.clic()
	add_child(_son_clic)
	_son_alerte = AudioStreamPlayer.new()
	_son_alerte.stream = Sons.alerte()
	add_child(_son_alerte)
	var fond := StyleBoxFlat.new()
	fond.bg_color = Palette.ENCRE
	var panneau := Panel.new()
	panneau.set_anchors_preset(Control.PRESET_FULL_RECT)
	panneau.add_theme_stylebox_override("panel", fond)
	add_child(panneau)

	var colonne := VBoxContainer.new()
	colonne.set_anchors_preset(Control.PRESET_FULL_RECT)
	colonne.add_theme_constant_override("separation", 0)
	add_child(colonne)
	colonne.add_child(_construire_barre())
	colonne.add_child(_construire_barre_temps())

	var appliquer := func(intention: Dictionary) -> bool:
		# Partie terminée : `Sim.appliquer` refuse TOUTE intention (première ligne de sim.gd).
		# Sans ce mot, chaque bouton de chaque écran devient un clic silencieux sans effet et
		# le joueur conclut à un bug d'interface (playtest n°10 : « le menu est complètement
		# buggé, le recrutement ne marche pas » — la partie était finie depuis mai 1945).
		# Point de passage UNIQUE des 7 écrans : une seule branche les couvre tous.
		if str(state["fin"]) != "":
			_toast(tr("Partie terminée — plus aucune action possible. « Nouvelle partie » dans ⚙."))
			return false
		var ok: bool = Sim.appliquer(state, data, intention)
		_maj_barre()
		return ok
	blueprint = BlueprintScript.new()
	blueprint.size_flags_vertical = Control.SIZE_EXPAND_FILL
	colonne.add_child(blueprint)
	blueprint.appliquer = appliquer
	blueprint.configurer(state, data)
	marche = MarcheScript.new()
	marche.size_flags_vertical = Control.SIZE_EXPAND_FILL
	marche.visible = false
	colonne.add_child(marche)
	marche.appliquer = appliquer
	marche.configurer(state, data)
	ao = AoScript.new()
	ao.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ao.visible = false
	colonne.add_child(ao)
	ao.appliquer = appliquer
	ao.configurer(state, data)
	equipe = EquipeScript.new()
	equipe.size_flags_vertical = Control.SIZE_EXPAND_FILL
	equipe.visible = false
	colonne.add_child(equipe)
	equipe.appliquer = appliquer
	equipe.configurer(state, data)
	recherche = RechercheScript.new()
	recherche.size_flags_vertical = Control.SIZE_EXPAND_FILL
	recherche.visible = false
	colonne.add_child(recherche)
	recherche.appliquer = appliquer
	recherche.configurer(state, data)
	direction = DirectionScript.new()
	direction.size_flags_vertical = Control.SIZE_EXPAND_FILL
	direction.visible = false
	colonne.add_child(direction)
	direction.appliquer = appliquer
	direction.configurer(state, data)
	comptes = ComptesScript.new()
	comptes.size_flags_vertical = Control.SIZE_EXPAND_FILL
	comptes.visible = false
	colonne.add_child(comptes)
	comptes.configurer(state, data)
	_ecrans = [blueprint, marche, ao, equipe, recherche, direction, comptes]
	# Filet de sécurité universel : un écran ne peut jamais repeindre hors de son
	# rectangle (par-dessus la barre du haut, hors fenêtre). Si un libellé futur
	# débordait malgré tout, il est coupé net à la bordure au lieu de baver sur l'UI.
	for ecran: Control in _ecrans:
		ecran.clip_contents = true
	_construire_overlays()
	_construire_options()
	_appliquer_options()

	_toasts = VBoxContainer.new()
	_toasts.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_toasts.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_toasts.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_toasts.offset_right = -8.0
	# -70 et non -8 : dégage le cartouche (fiche avion, bas-droite de la silhouette au
	# Bureau) — collision vécue en capture quand la presse s'est mise à toaster (avant,
	# les toasts n'étaient que les rares ouvertures de concours/courses).
	_toasts.offset_bottom = -70.0
	_toasts.add_theme_constant_override("separation", 4)
	_toasts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_toasts)
	# Les concours/épreuves déjà ouverts au chargement ne re-toastent pas.
	_annonces_vues = Contrats.ouverts(state, data) + Raids.ouvertes(state, data)
	for uid: String in Etat.cles_triees(Essais.tous(state)):
		# Le « début » est aussi marqué vu : sinon un prototype encore en vol re-toaste
		# « en essais en vol… » après chaque reprise de sauvegarde.
		_annonces_vues.append("essai_debut_" + uid)
		if Essais.prete(state, uid):
			_annonces_vues.append("essai_" + uid)

	fin_ecran = FinScript.new()
	fin_ecran.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(fin_ecran)
	fin_ecran.rejouer = func(graine: int) -> void:
		# Nouveau state écrit puis scène rechargée : tous les écrans repartent proprement.
		state = Sim.nouvelle_partie(graine, data)
		sauvegarder()
		get_tree().reload_current_scene()

	horloge = Timer.new()
	horloge.one_shot = false
	horloge.timeout.connect(_sur_tick)
	add_child(horloge)
	_maj_barre()
	# La une d'accueil (nouvelle partie) doit sortir tout de suite, pas au premier tick.
	_verifier_overlays()


# Raccourcis : Espace bascule la pause, 1/2/3 les vitesses, Tab fait tourner les écrans,
# Échap referme les panneaux. Dans `_input` et non `_unhandled_key_input` : le système de
# focus du Viewport avale Tab avant la couche « non gérée ». D'où le garde-fou de saisie —
# tant qu'un champ a le focus, chiffres et Tab lui appartiennent.
func _input(evenement: InputEvent) -> void:
	var touche := evenement as InputEventKey
	if touche == null or not touche.pressed or touche.echo:
		return
	if get_viewport().gui_get_focus_owner() is LineEdit:
		return
	if _voile.visible or fin_ecran.visible:
		return
	match touche.keycode:
		KEY_SPACE:
			_regler_vitesse(0 if not horloge.is_stopped() else maxi(_vitesse_prec, 1))
		KEY_1:
			_regler_vitesse(1)
		KEY_2:
			_regler_vitesse(2)
		KEY_3, KEY_4:
			_regler_vitesse(3)
		KEY_TAB:
			_montrer_ecran((_ecran_actif + 1) % _ecrans.size())
		KEY_ESCAPE:
			_panneau_options.visible = false
		_:
			return
	get_viewport().set_input_as_handled()


func _jouer(lecteur: AudioStreamPlayer) -> void:
	if bool(options.get("son", true)):
		lecteur.play()


func _sur_tick() -> void:
	Sim.tick(state, data)
	_maj_barre()
	_verifier_overlays()
	_verifier_annonces()
	# Le compte à rebours des essais en vol est hebdomadaire — léger, écran visible seulement.
	if blueprint.visible:
		blueprint.maj_essais()
	# Le voile d'événement coupe déjà la vitesse à 0 (_verifier_overlays → _regler_vitesse) ;
	# ne relance la barre que si l'horloge tourne encore réellement et que la partie continue.
	if not horloge.is_stopped() and str(state["fin"]) == "":
		_demarrer_barre_temps()
	if int(state["tick"]) % 13 == 0:
		_alerter_series_deficitaires()
		var livrees: float = float(state["stats"]["livraisons"]) - _livraisons_prec
		# Marge (prix − coût de production), pas le CA brut : c'est ce qui bouge
		# réellement la trésorerie, sans quoi le joueur voit "420 000 £" au bilan
		# et ne comprend pas pourquoi son solde n'a presque pas bougé.
		var marge: float = float(state["stats"]["marge_cumulee"]) - _marge_prec
		_livraisons_prec = float(state["stats"]["livraisons"])
		_marge_prec = float(state["stats"]["marge_cumulee"])
		_bilan_trim.text = tr("Trim. : %d livrés · marge %s £") % [int(livrees), _format_francs(marge)]
		_bilan_trim.add_theme_color_override("font_color",
			Palette.VERT_LAMPE if marge > 0.0 else Palette.ROUGE_ALERTE)
		sauvegarder()
		# Seul l'écran visible se reconstruit au trimestre — les autres le font
		# à l'affichage (_montrer_ecran) ; le blueprint garde son rafraîchissement
		# léger (moteurs/technos de l'année) même caché.
		blueprint.rafraichir()
		for ecran: Control in [marche, ao, equipe, recherche, direction, comptes]:
			if ecran.visible:
				ecran.rafraichir()
	if str(state["fin"]) != "" and not fin_ecran.visible:
		horloge.stop()
		if _tween_temps != null:
			_tween_temps.kill()
		_barre_temps.value = 0.0
		sauvegarder()
		fin_ecran.afficher(state, data)


# --- overlays : événement (pause auto, effets chiffrés avant choix) et une de presse ---

func _construire_overlays() -> void:
	_voile = Panel.new()
	_voile.set_anchors_preset(Control.PRESET_FULL_RECT)
	var style_voile := StyleBoxFlat.new()
	style_voile.bg_color = Color(Palette.ENCRE, 0.85)
	_voile.add_theme_stylebox_override("panel", style_voile)
	_voile.visible = false
	add_child(_voile)
	var carte := PanelContainer.new()
	carte.set_anchors_preset(Control.PRESET_CENTER)
	carte.custom_minimum_size = Vector2(420.0, 0.0)
	# Croissance CENTRÉE : par défaut un contrôle ancré au centre grandit vers la
	# droite/le bas — la carte partait du milieu et sortait de l'écran à droite.
	carte.grow_horizontal = Control.GROW_DIRECTION_BOTH
	carte.grow_vertical = Control.GROW_DIRECTION_BOTH
	carte.add_theme_stylebox_override("panel", Cartes.style(Palette.PAPIER_CREME, 12.0))
	_voile.add_child(carte)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 6)
	carte.add_child(col)
	_ev_titre = Label.new()
	_ev_titre.add_theme_font_size_override("font_size", 16)
	_ev_titre.add_theme_color_override("font_color", Palette.BOIS_MIEL)
	# Sans repli, un titre long (« Lindbergh a traversé l'Atlantique ») élargit la
	# carte au-delà des 420 px et donc du viewport.
	_ev_titre.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_ev_titre)
	_ev_texte = Label.new()
	_ev_texte.add_theme_font_size_override("font_size", 9)
	_ev_texte.add_theme_color_override("font_color", Palette.ENCRE)
	_ev_texte.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_ev_texte)
	for i: int in range(2):
		var bouton := Button.new()
		bouton.add_theme_font_size_override("font_size", 9)
		bouton.add_theme_color_override("font_color", Palette.ENCRE)
		var choix: String = ["a", "b"][i]
		bouton.pressed.connect(func() -> void: _sur_choix_evenement(choix))
		col.add_child(bouton)
		_ev_boutons.append(bouton)


func _verifier_overlays() -> void:
	var en_attente: String = str(state["evenements"]["en_attente"])
	if en_attente != "" and not _voile.visible:
		_regler_vitesse(0)
		_jouer(_son_alerte)
		var e: Dictionary = data["events"]["liste"][en_attente]
		_ev_titre.text = "%d — %s" % [int(Etat.AN0) + floori(float(state["tick"]) / 52.0), str(e["titre"])]
		_ev_texte.text = str(e["texte"])
		for i: int in range(2):
			var branche: Variant = e[["a", "b"][i]]
			(_ev_boutons[i] as Button).visible = branche != null
			if branche != null:
				(_ev_boutons[i] as Button).text = str((branche as Dictionary)["libelle"])
		_voile.visible = true
		return
	# Presse : brèves narratives → toasts, sans pause ni plein écran (retour playtest n°4 :
	# « prend toute la page » — l'ancien Panel THE AEROPLANE plein écran est retiré).
	while (state["presse"] as Array).size() > 0:
		var une: Dictionary = state["presse"][0]
		_toast("%s — %s" % [str(une["titre"]), str(une["corps"])])
		Sim.appliquer(state, data, {"type": "lire_presse"})


# Série d'État livrée SOUS son coût de fabrication : un rappel par trimestre, tant qu'il
# reste des appareils à sortir. L'avertissement « ⚠ À PERTE » de l'écran Concours ne se voit
# qu'AU MOMENT DE CANDIDATER, or une série de 120 appareils se livre sur deux ans — le joueur
# ne découvrait la saignée qu'au bilan annuel (playtest n°13 : −21 M£ sur un seul programme,
# vus douze mois trop tard). Lecture seule, zéro clé de state, zéro impact sim.
func _alerter_series_deficitaires() -> void:
	for c_v: Variant in (state["ao"] as Dictionary).get("contrats", []):
		var c: Dictionary = c_v
		var marge: float = float(c.get("solde_unitaire", 0.0)) - float(c.get("cout_unitaire", 0.0))
		if marge >= 0.0 or float(c.get("restant", 0.0)) <= 0.0:
			continue
		var nom: String = str(c.get("ao", ""))
		if (data["contracts"]["programmes"] as Dictionary).has(nom):
			nom = str(data["contracts"]["programmes"][nom]["nom"])
		# `-marge` : « à perte » porte déjà le signe, « à perte : -208 838 £ » serait un
		# double négatif. On annonce aussi le total restant à saigner, c'est lui qui décide.
		_toast(tr("⚠ %s livré à perte : %s £ par appareil, %d restants (soit %s £ à venir).")
			% [nom, _format_francs(-marge), int(float(c["restant"])),
			_format_francs(-marge * float(c["restant"]))])


# Nouvelles ouvertures (concours, courses, raids) → toast discret en bas à droite.
# Détection côté UI sur les listes publiques de la sim : zéro clé de state, zéro migration.
func _verifier_annonces() -> void:
	for id_ao: String in Contrats.ouverts(state, data):
		if not _annonces_vues.has(id_ao):
			_annonces_vues.append(id_ao)
			var ao_d: Dictionary = data["contracts"]["programmes"][id_ao]
			_toast(tr("Concours ouvert — %s · %d appareils (écran Concours)")
				% [str(ao_d["nom"]), int(ao_d["volume"])])
	for id_e: String in Raids.ouvertes(state, data):
		if not _annonces_vues.has(id_e):
			_annonces_vues.append(id_e)
			var e: Dictionary = data["raids"]["epreuves"][id_e]
			var genre: String = tr("Course ouverte") if str(e["type"]) == "course" else tr("Défi lancé")
			_toast(tr("%s — %s · prime %s £") % [genre, str(e["nom"]), _format_francs(float(e["prime"]))])
	# Essais en vol : au départ (l'avion n'est PAS en vente — LE malentendu du playtest)
	# puis à la fin de campagne (rappel qu'il faut le mettre en service).
	for uid: String in Etat.cles_triees(Essais.tous(state)):
		if not _annonces_vues.has("essai_debut_" + uid):
			_annonces_vues.append("essai_debut_" + uid)
			var essai_d: Dictionary = Essais.tous(state)[uid]
			if float(essai_d["restant"]) > 0.0:
				_toast(tr("%s en essais en vol — %d sem. Pas encore en vente : suivez-le au Bureau.")
					% [str(state["designs"][uid]["design"]["nom"]), int(essai_d["restant"])])
		if Essais.prete(state, uid) and not _annonces_vues.has("essai_" + uid):
			_annonces_vues.append("essai_" + uid)
			var nom_d: String = str(state["designs"][uid]["design"]["nom"])
			var n_def: int = 0
			for d: Dictionary in (Essais.tous(state)[uid]["defauts"] as Array):
				if not bool(d["corrige"]):
					n_def += 1
			var suite: String = tr("aucun défaut") if n_def == 0 else tr("%d défaut(s) révélé(s)") % n_def
			_toast(tr("Essais terminés — %s · %s. Mettre en service au Bureau pour vendre.") % [nom_d, suite])


func _toast(texte: String) -> void:
	var carte := PanelContainer.new()
	var fond := StyleBoxFlat.new()
	fond.bg_color = Palette.PAPIER_CREME
	fond.set_corner_radius_all(4)
	fond.set_content_margin_all(6.0)
	carte.add_theme_stylebox_override("panel", fond)
	# La carte doit maintenant intercepter le clic sur la croix — seul le texte reste
	# transparent, pour ne pas gêner le clic ailleurs (rangée MOUSE_FILTER_PASS).
	carte.mouse_filter = Control.MOUSE_FILTER_PASS
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 4)
	carte.add_child(rangee)
	var l := Label.new()
	l.text = texte
	l.add_theme_font_size_override("font_size", 9)
	l.add_theme_color_override("font_color", Palette.ENCRE)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(178.0, 0.0)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rangee.add_child(l)
	var fermer := Button.new()
	fermer.text = "✕"
	fermer.add_theme_font_size_override("font_size", 9)
	fermer.add_theme_color_override("font_color", Palette.GRIS_ACIER)
	fermer.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	fermer.tooltip_text = tr("Fermer")
	fermer.pressed.connect(carte.queue_free)
	rangee.add_child(fermer)
	_toasts.add_child(carte)
	if _toasts.get_child_count() > 3:
		_toasts.get_child(0).queue_free()
	# Minuteur ENFANT de la carte : il meurt avec elle (prune > 3, ✕, fin de partie).
	# Un SceneTreeTimer (create_timer) survivrait à la carte et rejouerait sur une capture
	# libérée → « Lambda capture at index 0 was freed » en boucle dans le terminal.
	var minuteur := Timer.new()
	minuteur.wait_time = 8.0
	minuteur.one_shot = true
	minuteur.timeout.connect(carte.queue_free)
	carte.add_child(minuteur)
	minuteur.start()


func _sur_choix_evenement(choix: String) -> void:
	var en_attente: String = str(state["evenements"]["en_attente"])
	if bool(Sim.appliquer(state, data, {"type": "choisir_evenement", "id": en_attente, "choix": choix})):
		_voile.visible = false
		_maj_barre()
		_verifier_overlays()
		_reprendre()


# Le dernier overlay refermé rend la vitesse au joueur. Rien à reprendre s'il était en
# pause avant l'interruption (`_vitesse_prec` = 0), ni si la partie est terminée.
func _reprendre() -> void:
	if _voile.visible or str(state["fin"]) != "" or _vitesse_prec == 0:
		return
	_regler_vitesse(_vitesse_prec)


func _montrer_ecran(indice: int) -> void:
	# 0 = bureau, 1 = marché, 2 = concours (AO), 3 = équipe, 4 = labo (recherche) —
	# rafraîchi à l'affichage pour ne pas montrer un rapport périmé.
	_ecran_actif = indice
	_jouer(_son_clic)
	for i: int in range(_boutons_ecran.size()):
		(_boutons_ecran[i] as Button).set_pressed_no_signal(i == indice)
	for i: int in range(_ecrans.size()):
		(_ecrans[i] as Control).visible = i == indice
	if indice == 0:
		# Le Bureau aussi : sans ça, un archétype débloqué en pause (ou une techno tout
		# juste acquise) n'apparaissait qu'au trimestre suivant — vécu comme « il faut
		# recharger la partie » (retour playtest).
		blueprint.rafraichir()
	elif indice == 1:
		marche.rafraichir()
	elif indice == 2:
		ao.rafraichir()
	elif indice == 3:
		equipe.rafraichir()
	elif indice == 4:
		recherche.rafraichir()
	elif indice == 5:
		direction.rafraichir()
	elif indice == 6:
		comptes.rafraichir()


func _regler_vitesse(indice: int) -> void:
	# indice 0 = pause, 1..3 = ×1 ×2 ×4 (durées en data, pas en dur).
	var temps: Dictionary = data["constants"]["temps"]
	if indice > 0:
		_vitesse_prec = indice
	for i: int in range(_boutons_vitesse.size()):
		(_boutons_vitesse[i] as Button).set_pressed_no_signal(i == indice)
	if indice == 0 or str(state["fin"]) != "":
		horloge.stop()
		if _tween_temps != null:
			_tween_temps.kill()
		_barre_temps.value = 0.0
		return
	horloge.wait_time = float(temps["sec_par_tick"]) / float(temps["vitesses"][indice - 1])
	horloge.start()
	_demarrer_barre_temps()


# Habillage global « rétro moderne » : boutons pastilles plats et arrondis (l'actif ressort
# en laiton), champs clairs, menus sur carte ombrée, curseurs laiton, scrollbars discrètes.
# Posé sur le thème de MAIN : les thèmes des écrans enfants ne définissent pas ces clés,
# la résolution remonte donc jusqu'ici (même mécanisme que la police).
# Statique : tests/capture.gd l'applique à son porteur (écrans capturés hors main).
static func _styler(th: Theme) -> void:
	var normal := StyleBoxFlat.new()
	normal.bg_color = Palette.ENCRE.lerp(Palette.PAPIER_CREME, 0.80)
	normal.set_corner_radius_all(3)
	normal.content_margin_left = 8.0
	normal.content_margin_right = 8.0
	normal.content_margin_top = 2.0
	normal.content_margin_bottom = 2.0
	var survol: StyleBoxFlat = normal.duplicate()
	survol.bg_color = Palette.ENCRE.lerp(Palette.PAPIER_CREME, 0.65)
	var presse: StyleBoxFlat = normal.duplicate()
	presse.bg_color = Palette.LAITON
	for type_b: String in ["Button", "OptionButton"]:
		th.set_stylebox("normal", type_b, normal)
		th.set_stylebox("hover", type_b, survol)
		th.set_stylebox("pressed", type_b, presse)
		th.set_stylebox("hover_pressed", type_b, presse)
		th.set_stylebox("disabled", type_b, normal)
		th.set_stylebox("focus", type_b, StyleBoxEmpty.new())
		for etat: String in ["font_color", "font_hover_color", "font_pressed_color",
				"font_hover_pressed_color", "font_focus_color"]:
			th.set_color(etat, type_b, Palette.ENCRE)
	# Les cases à cocher restent des lignes de liste nues (pas des pastilles).
	for etat_c: String in ["normal", "hover", "pressed", "hover_pressed", "disabled", "focus"]:
		th.set_stylebox(etat_c, "CheckBox", StyleBoxEmpty.new())
	var champ := StyleBoxFlat.new()
	champ.bg_color = Palette.PAPIER_CREME.lightened(0.45)
	champ.border_color = Color(Palette.ENCRE, 0.25)
	champ.set_border_width_all(1)
	champ.set_corner_radius_all(3)
	champ.content_margin_left = 5.0
	champ.content_margin_right = 5.0
	var champ_focus: StyleBoxFlat = champ.duplicate()
	champ_focus.border_color = Palette.LAITON
	th.set_stylebox("normal", "LineEdit", champ)
	th.set_stylebox("focus", "LineEdit", champ_focus)
	th.set_color("font_color", "LineEdit", Palette.ENCRE)
	th.set_color("caret_color", "LineEdit", Palette.ENCRE)
	var menu := StyleBoxFlat.new()
	menu.bg_color = Palette.PAPIER_CREME
	menu.set_corner_radius_all(4)
	menu.set_content_margin_all(5.0)
	menu.shadow_color = Color(Palette.ENCRE, 0.45)
	menu.shadow_size = 4
	th.set_stylebox("panel", "PopupMenu", menu)
	th.set_stylebox("hover", "PopupMenu", presse)
	th.set_color("font_color", "PopupMenu", Palette.ENCRE)
	th.set_color("font_hover_color", "PopupMenu", Palette.ENCRE)
	var ligne := StyleBoxLine.new()
	ligne.color = Color(Palette.ENCRE, 0.18)
	th.set_stylebox("separator", "HSeparator", ligne)
	var piste := StyleBoxFlat.new()
	piste.bg_color = Color(Palette.ENCRE, 0.15)
	piste.set_corner_radius_all(2)
	# Les marges donnent son épaisseur à la piste — sans elles, elle est invisible.
	piste.set_content_margin_all(2.0)
	th.set_stylebox("slider", "HSlider", piste)
	var rempli := StyleBoxFlat.new()
	rempli.bg_color = Palette.LAITON
	rempli.set_corner_radius_all(2)
	th.set_stylebox("grabber_area", "HSlider", rempli)
	th.set_stylebox("grabber_area_highlight", "HSlider", rempli)
	var poignee := StyleBoxFlat.new()
	poignee.bg_color = Color(Palette.GRIS_ACIER, 0.7)
	poignee.set_corner_radius_all(3)
	for type_s: String in ["VScrollBar", "HScrollBar"]:
		th.set_stylebox("grabber", type_s, poignee)
		th.set_stylebox("grabber_highlight", type_s, poignee)
		th.set_stylebox("grabber_pressed", type_s, poignee)
		th.set_stylebox("scroll", type_s, StyleBoxEmpty.new())


func _construire_barre() -> Control:
	var style := StyleBoxFlat.new()
	style.bg_color = Palette.BLEU_CYANOTYPE
	style.set_content_margin_all(3.0)
	var barre := PanelContainer.new()
	barre.add_theme_stylebox_override("panel", style)
	# Deux lignes : la min-width d'un container REMONTE jusqu'à la colonne racine —
	# un texte trop long ici élargissait TOUS les écrans au-delà du viewport 640
	# (tout « sautait » à la première vente). La navigation (largeur fixe) reste en
	# ligne 1, le bilan (largeur variable) descend en ligne 2 avec coupe ellipse.
	var lignes := VBoxContainer.new()
	lignes.add_theme_constant_override("separation", 1)
	barre.add_child(lignes)
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 10)
	lignes.add_child(rangee)
	for etiquette_e: Variant in ["Bureau", "Marché", "Concours", "Équipe", "Labo", "Direction", "Comptes"]:
		var bouton_e := Button.new()
		bouton_e.text = str(etiquette_e)
		bouton_e.toggle_mode = true
		bouton_e.add_theme_font_size_override("font_size", 9)
		_style_onglet(bouton_e)
		var indice_e: int = _boutons_ecran.size()
		bouton_e.pressed.connect(func() -> void: _montrer_ecran(indice_e))
		rangee.add_child(bouton_e)
		_boutons_ecran.append(bouton_e)
	(_boutons_ecran[0] as Button).set_pressed_no_signal(true)
	_date = Label.new()
	_date.add_theme_font_size_override("font_size", 9)
	_date.add_theme_color_override("font_color", Palette.LIGNE_BLUEPRINT)
	rangee.add_child(_date)
	_tresorerie = Label.new()
	_tresorerie.add_theme_font_size_override("font_size", 9)
	rangee.add_child(_tresorerie)
	var espace := Control.new()
	espace.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rangee.add_child(espace)
	for etiquette_v: Variant in ["II", "1", "2", "4"]:
		var bouton := Button.new()
		bouton.text = str(etiquette_v)
		bouton.toggle_mode = true
		bouton.add_theme_font_size_override("font_size", 9)
		_style_onglet(bouton)
		var indice: int = _boutons_vitesse.size()
		bouton.pressed.connect(func() -> void:
			_jouer(_son_clic)
			_regler_vitesse(indice))
		rangee.add_child(bouton)
		_boutons_vitesse.append(bouton)
	(_boutons_vitesse[0] as Button).set_pressed_no_signal(true)
	var bouton_opt := Button.new()
	bouton_opt.text = "⚙"
	bouton_opt.add_theme_font_size_override("font_size", 9)
	_style_onglet(bouton_opt)
	bouton_opt.pressed.connect(func() -> void: _panneau_options.visible = not _panneau_options.visible)
	rangee.add_child(bouton_opt)
	# Le pouls du commerce : livraisons et marge du dernier trimestre, sinon le joueur
	# ne voit JAMAIS ses avions se vendre (l'allocation est trimestrielle). Ellipse +
	# hauteur fixe : quoi qu'affiche ce label, il ne peut ni élargir la barre ni la
	# faire changer de hauteur quand le texte apparaît.
	_bilan_trim = Label.new()
	_bilan_trim.add_theme_font_size_override("font_size", 9)
	_bilan_trim.add_theme_color_override("font_color", Palette.VERT_LAMPE)
	_bilan_trim.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_bilan_trim.custom_minimum_size = Vector2(0.0, 10.0)
	lignes.add_child(_bilan_trim)
	return barre


# Onglet de la barre du haut : fantôme au repos (léger voile au survol), laiton quand actif.
func _style_onglet(bouton: Button) -> void:
	var repos := StyleBoxFlat.new()
	repos.bg_color = Color(Palette.LIGNE_BLUEPRINT, 0.07)
	repos.set_corner_radius_all(3)
	repos.content_margin_left = 8.0
	repos.content_margin_right = 8.0
	repos.content_margin_top = 3.0
	repos.content_margin_bottom = 3.0
	var survol: StyleBoxFlat = repos.duplicate()
	survol.bg_color = Color(Palette.LIGNE_BLUEPRINT, 0.20)
	var actif: StyleBoxFlat = repos.duplicate()
	actif.bg_color = Palette.LAITON
	bouton.add_theme_stylebox_override("normal", repos)
	bouton.add_theme_stylebox_override("hover", survol)
	bouton.add_theme_stylebox_override("pressed", actif)
	bouton.add_theme_stylebox_override("hover_pressed", actif)
	bouton.add_theme_color_override("font_color", Palette.PAPIER_CREME)
	bouton.add_theme_color_override("font_hover_color", Palette.PAPIER_CREME)
	bouton.add_theme_color_override("font_pressed_color", Palette.ENCRE)
	bouton.add_theme_color_override("font_hover_pressed_color", Palette.ENCRE)


# Liseré fin sous la barre du haut : se remplit vers le prochain tick (Tween, pas de
# _process — le jeu vise 0 partout). Se fige en pause, repart de zéro à chaque tick.
func _construire_barre_temps() -> Control:
	var fond := StyleBoxFlat.new()
	fond.bg_color = Palette.ENCRE
	var enveloppe := PanelContainer.new()
	enveloppe.add_theme_stylebox_override("panel", fond)
	enveloppe.custom_minimum_size = Vector2(0.0, 3.0)
	_barre_temps = ProgressBar.new()
	_barre_temps.show_percentage = false
	_barre_temps.max_value = 100.0
	_barre_temps.custom_minimum_size = Vector2(0.0, 3.0)
	var rempli := StyleBoxFlat.new()
	rempli.bg_color = Palette.LAITON
	_barre_temps.add_theme_stylebox_override("fill", rempli)
	var vide := StyleBoxFlat.new()
	vide.bg_color = Palette.ENCRE
	_barre_temps.add_theme_stylebox_override("background", vide)
	enveloppe.add_child(_barre_temps)
	return enveloppe


func _demarrer_barre_temps() -> void:
	if _tween_temps != null:
		_tween_temps.kill()
	_barre_temps.value = 0.0
	_tween_temps = create_tween()
	_tween_temps.tween_property(_barre_temps, "value", 100.0, horloge.wait_time)


# --- options : cap FPS, VSync, mode économie — user://options.json, hors sauvegarde ---

func _construire_options() -> void:
	_panneau_options = PanelContainer.new()
	_panneau_options.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_panneau_options.position.y = 30.0
	_panneau_options.add_theme_stylebox_override("panel", Cartes.style(Palette.PAPIER_CREME, 10.0))
	_panneau_options.visible = false
	add_child(_panneau_options)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 3)
	_panneau_options.add_child(col)
	var titre_o := Label.new()
	titre_o.text = "OPTIONS"
	titre_o.add_theme_font_size_override("font_size", 9)
	titre_o.add_theme_color_override("font_color", Palette.BOIS_MIEL)
	col.add_child(titre_o)
	var rangee_langue := HBoxContainer.new()
	rangee_langue.add_theme_constant_override("separation", 4)
	var l_langue := Label.new()
	l_langue.text = "Langue"
	l_langue.add_theme_color_override("font_color", Palette.ENCRE)
	rangee_langue.add_child(l_langue)
	var choix_langue := OptionButton.new()
	choix_langue.add_theme_font_size_override("font_size", 9)
	# Auto-traduction OFF sur le sélecteur : « Français »/« English » sont des exonymes fixes.
	choix_langue.set_auto_translate_mode(Node.AUTO_TRANSLATE_MODE_DISABLED)
	for lg: Variant in I18n.LANGUES:
		choix_langue.add_item(str(I18n.NOMS[str(lg)]))
	choix_langue.select(clampi((I18n.LANGUES as Array).find(str(options.get("langue", "fr"))), 0, 9))
	choix_langue.item_selected.connect(func(i: int) -> void: _changer_langue(str(I18n.LANGUES[i])))
	rangee_langue.add_child(choix_langue)
	col.add_child(rangee_langue)
	var rangee_fps := HBoxContainer.new()
	rangee_fps.add_theme_constant_override("separation", 4)
	var l_fps := Label.new()
	l_fps.text = "Images/s"
	l_fps.add_theme_color_override("font_color", Palette.ENCRE)
	rangee_fps.add_child(l_fps)
	var choix_fps := OptionButton.new()
	choix_fps.add_theme_font_size_override("font_size", 9)
	for c: Variant in ["30", "60", "Sans limite"]:
		choix_fps.add_item(str(c))
	choix_fps.select(int(options.get("fps", 1)))
	choix_fps.item_selected.connect(func(i: int) -> void:
		options["fps"] = i
		_appliquer_options())
	rangee_fps.add_child(choix_fps)
	col.add_child(rangee_fps)
	var case_vsync := CheckBox.new()
	case_vsync.text = "VSync"
	case_vsync.add_theme_color_override("font_color", Palette.ENCRE)
	case_vsync.set_pressed_no_signal(bool(options.get("vsync", true)))
	case_vsync.toggled.connect(func(actif: bool) -> void:
		options["vsync"] = actif
		_appliquer_options())
	col.add_child(case_vsync)
	var case_eco := CheckBox.new()
	case_eco.text = "Mode économie (coupe les animations)"
	case_eco.add_theme_color_override("font_color", Palette.ENCRE)
	case_eco.set_pressed_no_signal(bool(options.get("eco", false)))
	case_eco.toggled.connect(func(actif: bool) -> void:
		options["eco"] = actif
		_appliquer_options())
	col.add_child(case_eco)
	var case_son := CheckBox.new()
	case_son.text = "Son (clics, alerte trésorerie)"
	case_son.add_theme_color_override("font_color", Palette.ENCRE)
	case_son.set_pressed_no_signal(bool(options.get("son", true)))
	case_son.toggled.connect(func(actif: bool) -> void:
		options["son"] = actif
		_appliquer_options())
	col.add_child(case_son)
	var case_plein := CheckBox.new()
	case_plein.text = "Plein écran"
	case_plein.add_theme_color_override("font_color", Palette.ENCRE)
	case_plein.set_pressed_no_signal(bool(options.get("plein_ecran", false)))
	case_plein.toggled.connect(func(actif: bool) -> void:
		options["plein_ecran"] = actif
		_appliquer_options())
	col.add_child(case_plein)
	var rangee_vol := HBoxContainer.new()
	rangee_vol.add_theme_constant_override("separation", 4)
	var l_vol := Label.new()
	l_vol.text = "Volume"
	l_vol.add_theme_color_override("font_color", Palette.ENCRE)
	rangee_vol.add_child(l_vol)
	var curseur_vol := HSlider.new()
	curseur_vol.min_value = 0.0
	curseur_vol.max_value = 1.0
	curseur_vol.step = 0.05
	curseur_vol.custom_minimum_size = Vector2(120.0, 0.0)
	curseur_vol.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	curseur_vol.set_value_no_signal(float(options.get("volume", 0.8)))
	curseur_vol.value_changed.connect(func(v: float) -> void:
		options["volume"] = v
		_appliquer_options())
	rangee_vol.add_child(curseur_vol)
	col.add_child(rangee_vol)

	# Emplacements : la partie en cours part sur son fichier avant le changement, et la
	# scène redémarre pour que TOUS les écrans repartent sur le state du nouvel emplacement.
	col.add_child(HSeparator.new())
	var rangee_slots := HBoxContainer.new()
	rangee_slots.add_theme_constant_override("separation", 4)
	var l_slot := Label.new()
	l_slot.text = "Emplacement"
	l_slot.add_theme_color_override("font_color", Palette.ENCRE)
	rangee_slots.add_child(l_slot)
	for n: int in range(1, NB_EMPLACEMENTS + 1):
		var bouton_slot := Button.new()
		bouton_slot.text = str(n)
		bouton_slot.toggle_mode = true
		bouton_slot.set_pressed_no_signal(n == _slot)
		bouton_slot.add_theme_color_override("font_color", Palette.ENCRE)
		bouton_slot.pressed.connect(func() -> void: _changer_emplacement(n))
		rangee_slots.add_child(bouton_slot)
	col.add_child(rangee_slots)
	var aide_slot := Label.new()
	aide_slot.text = "Sauvegarde auto à chaque trimestre, sur l'emplacement actif."
	aide_slot.add_theme_font_size_override("font_size", 9)
	aide_slot.add_theme_color_override("font_color", Palette.GRIS_ACIER)
	aide_slot.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	aide_slot.custom_minimum_size = Vector2(220.0, 0.0)
	col.add_child(aide_slot)

	col.add_child(HSeparator.new())
	# Nouvelle partie sans attendre la fin — armée en deux clics contre la fausse manœuvre,
	# et DÉSARMÉE toute seule (cf. Cartes.armer) : un bouton armé à vie n'est plus une garde.
	var bouton_neuf := Button.new()
	bouton_neuf.text = "Nouvelle partie"
	bouton_neuf.add_theme_color_override("font_color", Palette.ROUGE_ALERTE)
	Cartes.armer(bouton_neuf, "Sûr ? La partie en cours sera perdue", func() -> void:
		state = Sim.nouvelle_partie(int(Time.get_unix_time_from_system()) & 0xFFFFFFFF, data)
		sauvegarder()
		get_tree().reload_current_scene())
	col.add_child(bouton_neuf)


# Bascule de langue : on écrit l'option puis on recharge la scène pour que TOUS les écrans
# soient reconstruits sous la nouvelle locale (les chaînes formatées sont figées à la création).
func _changer_langue(langue: String) -> void:
	if langue == str(options.get("langue", "fr")):
		return
	options["langue"] = langue
	sauvegarder()
	_appliquer_options()
	I18n.appliquer(langue)
	get_tree().reload_current_scene()


func _changer_emplacement(n: int) -> void:
	if n == _slot:
		return
	sauvegarder()
	options["slot"] = n
	_appliquer_options()
	get_tree().reload_current_scene()


func _appliquer_options() -> void:
	Engine.max_fps = [30, 60, 0][clampi(int(options.get("fps", 1)), 0, 2)]
	DisplayServer.window_set_vsync_mode(
		DisplayServer.VSYNC_ENABLED if bool(options.get("vsync", true)) else DisplayServer.VSYNC_DISABLED)
	DisplayServer.window_set_mode(
		DisplayServer.WINDOW_MODE_FULLSCREEN if bool(options.get("plein_ecran", false))
		else DisplayServer.WINDOW_MODE_WINDOWED)
	# Volume maître : la case Son coupe/rétablit, le curseur règle le niveau.
	var vol: float = clampf(float(options.get("volume", 0.8)), 0.0, 1.0)
	AudioServer.set_bus_volume_db(0, linear_to_db(maxf(vol, 0.0001)))
	AudioServer.set_bus_mute(0, vol <= 0.0)
	equipe.animations_actives = not bool(options.get("eco", false))
	var fichier: FileAccess = FileAccess.open(CHEMIN_OPTIONS, FileAccess.WRITE)
	if fichier != null:
		fichier.store_string(JSON.stringify(options))
		fichier.close()


func _charger_options() -> Dictionary:
	if FileAccess.file_exists(CHEMIN_OPTIONS):
		var charge: Variant = JSON.parse_string(FileAccess.get_file_as_string(CHEMIN_OPTIONS))
		if charge is Dictionary:
			return charge
	return {"fps": 1, "vsync": true, "eco": false, "son": true, "slot": 1,
		"plein_ecran": false, "volume": 0.8, "langue": "fr"}


func _maj_barre() -> void:
	var tick: int = int(state["tick"])
	var annee: int = int(Etat.AN0) + floori(float(tick) / 52.0)
	var semaine: int = tick % 52 + 1
	_date.text = tr("S%02d %d") % [semaine, annee]
	var tresorerie: float = float(state["tresorerie"])
	_tresorerie.text = "%s £" % _format_francs(tresorerie)
	_tresorerie.add_theme_color_override("font_color",
		Palette.ROUGE_ALERTE if tresorerie < 0.0 else Palette.PAPIER_CREME)
	# Le basculement dans le rouge ouvre le compte à rebours de la faillite (8 semaines) :
	# il sonne, sinon un joueur en ×4 qui regarde ailleurs ne le voit jamais venir.
	var rouge: bool = tresorerie < 0.0
	if rouge and not _rouge_prec:
		_jouer(_son_alerte)
	_rouge_prec = rouge


func _format_francs(valeur: float) -> String:
	return MarcheScript.francs(valeur)


func _chemin_sauvegarde() -> String:
	return "user://sauvegarde_%d.json" % _slot


func _charger_ou_creer() -> Dictionary:
	var chemin: String = _chemin_sauvegarde()
	# Les parties d'avant les emplacements vivaient dans un fichier unique : il devient
	# l'emplacement 1 (lu ici, réécrit au premier trimestre sous son nouveau nom).
	if _slot == 1 and not FileAccess.file_exists(chemin) and FileAccess.file_exists(CHEMIN_SAUVEGARDE_ANCIEN):
		chemin = CHEMIN_SAUVEGARDE_ANCIEN
	if FileAccess.file_exists(chemin):
		var texte: String = FileAccess.get_file_as_string(chemin)
		var charge: Variant = JSON.parse_string(texte)
		if charge is Dictionary and (charge as Dictionary).has("tick"):
			# Migration des sauvegardes d'avant les étapes 5-6 (clés "ao"/"recrutement",
			# ingénieurs sans compétences → équipe de départ actuelle, mêmes noms).
			if not (charge as Dictionary).has("ao"):
				charge["ao"] = {"candidatures": {}, "resolutions": {}, "contrats": []}
			if not (charge as Dictionary).has("recrutement"):
				charge["recrutement"] = {"candidats": []}
			var ings_charge: Array = charge["ingenieurs"]
			if ings_charge.is_empty() or not (ings_charge[0] as Dictionary).has("comp"):
				charge["ingenieurs"] = (data["start"]["ingenieurs"] as Array).duplicate(true)
			# Étape 7 : événements, gels, pilotes, presse. Puis brevets, graine (l'écran de
			# fin la lit pour « Rejouer ce destin » — 0 vaut « destin non rejouable ») et
			# l'historique de trésorerie de la courbe du livret.
			var defauts: Dictionary = {
				"evenements": {"faits": [], "en_attente": "", "dernier_tick": -99.0},
				"modificateurs": [], "gels": {"production": 0.0, "etudes": 0.0, "gele_trim": 0.0},
				"plafond_atelier": false, "plafond_atelier_fin": 0.0, "revelation": false, "pilotes": [], "memorial": [],
				"epreuves_faites": [], "palmares": [], "presse": [],
				"brevets": {}, "graine": 0.0, "tresorerie_hist": [],
				"archetypes": [], "essais": {}, "ministere": 0.5,
				"pub_dernier_tick": -999.0,
				"motoriste": "", "sous_licences": [], "genies_annonces": [],
				"conseil": {"annonces": [], "resolus": {}},
				"assurance": false, "moral_bas_sem": 0.0, "greve_dernier_tick": -999.0,
				"stock": {}, "stock_commande": {}, "entretien_flotte": false,
				"emprunt": 0.0, "filiale": false,
					"comptes": {}, "fusion_compteur": 0.0,
					"dept_moteurs": false, "moteurs": {}, "banc": {},
					"dispersion": false, "degats_sem": 0.0, "alloc_marche": 0.0,
			}
			for cle: String in defauts:
				if not (charge as Dictionary).has(cle):
					charge[cle] = defauts[cle]
			for cle_stat: String in ["marge_cumulee", "charges_cumulees", "autres_cumules"]:
				if not (charge["stats"] as Dictionary).has(cle_stat):
					charge["stats"][cle_stat] = 0.0
			# Modèle C (maturité fiab depuis TA recherche) : les vieux saves n'ont pas les dates
			# de recherche → on suppose « recherchée à sa disponibilité » (date_etat_art), faute
			# de pouvoir reconstruire quand le joueur l'a réellement obtenue.
			if not (charge["recherche"] as Dictionary).has("annees"):
				var an_r: Dictionary = {}
				for f_v: Variant in charge["recherche"]["faites"]:
					an_r[str(f_v)] = float(data["technos"][str(f_v)]["date_etat_art"])
				charge["recherche"]["annees"] = an_r
			# Prix des moteurs maison réévalués aux constantes courantes : un correctif
			# d'équilibrage doit valoir aussi pour ce qu'on a déjà homologué, sinon le joueur
			# lit un tarif que plus aucune règle du jeu ne produit (playtest n°7).
			# Plafond d'atelier : le booléen « à vie » devient une échéance de 5 ans (playtest
			# n°7 — 800 000 £ ne valaient pas la fin de tout développement industriel). Pour un
			# save existant on la reconstitue depuis la DATE de l'événement, pas depuis
			# maintenant : le joueur récupère exactement le délai promis, ni plus ni moins.
			if bool(charge.get("plafond_atelier", false)) and not charge.has("plafond_atelier_fin"):
				var des_ev: float = 1936.7
				for id_e: String in (data["events"]["liste"] as Dictionary):
					var e_def: Dictionary = data["events"]["liste"][id_e]
					for br: String in ["a", "b"]:
						if e_def.get(br) != null and bool((e_def[br]["effets"] as Dictionary).get("capacite_plafonnee", false)):
							des_ev = float(e_def["des"])
				charge["plafond_atelier_fin"] = (des_ev - Etat.AN0) * 52.0 					+ float(data["constants"]["eco"]["plafond_atelier_sem"])
			Moteurs.reevaluer_prix(charge, data)
			return charge
	var graine: int = int(Time.get_unix_time_from_system()) & 0xFFFFFFFF
	var neuf: Dictionary = Sim.nouvelle_partie(graine, data)
	# Première partie : le mode d'emploi passe par la une de journal (pause auto au tick 1).
	(neuf["presse"] as Array).append({"titre": tr("Votre bureau d'études ouvre"),
		"corps": tr("La boucle : concevoir un avion au Bureau (la NOTE MARCHÉ dit s'il se vendra), payer le prototype et le suivre en ESSAIS EN VOL (des défauts peuvent apparaître — corrigez-les ou assumez-les), puis le mettre en service sur un segment : le marché achète CHAQUE TRIMESTRE (bilan dans la barre du haut). Surveillez le Marché (demande, rivaux — ils ripostent), les Concours, l'Équipe et le Labo. Le prototype coûte cher : gardez de quoi tenir. Trésorerie ROUGE pendant 8 semaines = faillite. Passez en ×4 pour commencer.")})
	return neuf


func sauvegarder() -> void:
	var fichier: FileAccess = FileAccess.open(_chemin_sauvegarde(), FileAccess.WRITE)
	if fichier != null:
		fichier.store_string(Etat.serialiser(state))
		fichier.close()
	else:
		# Disque plein, user:// en lecture seule : ne pas laisser croire à une sauvegarde.
		push_warning("Échec d'écriture de la sauvegarde : " + _chemin_sauvegarde())
		if _toasts != null:
			_toast("⚠ Sauvegarde impossible — vérifiez l'espace disque.")


func _notification(quoi: int) -> void:
	if quoi == NOTIFICATION_WM_CLOSE_REQUEST and not state.is_empty():
		sauvegarder()
