# Raison d'être : le bureau vivant — diorama en coupe (Atelier → Bureau → Institut, les
# étages s'ouvrent avec l'effectif), pastilles animées des ingénieurs à leur poste, et le
# panneau de gestion : affectations, moral, marché du recrutement, licenciements (12 postes).
# N'écrit jamais dans le state : intentions via le Callable `appliquer` injecté par main.
extends Control

const Etat := preload("res://sim/state.gd")
const Ingenieurs := preload("res://sim/engineers.gd")
const Production := preload("res://sim/production.gd")
const Palette := preload("res://game/ui/palette.gd")
const Cartes := preload("res://game/ui/cartes.gd")

const POSTES_UI: Array = [["", "—"], ["etudes", "Études"], ["recherche", "Recherche"], ["atelier", "Atelier"]]

var appliquer: Callable = Callable()  # func(intention: Dictionary) -> bool, injecté par main
var animations_actives: bool = true  # mode économie : main coupe le bob des pastilles
var state: Dictionary = {}
var data: Dictionary = {}

var _diorama: Diorama
var _effets: Label
var _boite_equipe: VBoxContainer
var _boite_candidats: VBoxContainer


# Coupe du bâtiment : 3 niveaux (atelier / bureau d'études / institut), ouverts par
# l'effectif ou par une affectation ; une pastille par ingénieur, bob de 1 px par phase.
class Diorama:
	extends Control
	# Preload local : une classe interne ne voit pas les constantes du script englobant.
	const Palette := preload("res://game/ui/palette.gd")
	var ingenieurs: Array = []
	var phase: int = 0

	func _draw() -> void:
		var police: Font = get_theme_default_font()
		# Bâtiment compact et centré (les étages pleine largeur « flottaient » dans le vide).
		var largeur: float = minf(size.x * 0.9, 420.0)
		var x0: float = (size.x - largeur) / 2.0
		var h_etage: float = clampf(size.y / 4.5, 46.0, 64.0)
		var y_bas: float = minf(size.y - 14.0, (size.y + 3.0 * h_etage + 20.0) / 2.0)
		var n: int = ingenieurs.size()
		var noms_etages: Array = ["ATELIER", "BUREAU D'ÉTUDES", "INSTITUT"]
		var postes_etages: Array = ["atelier", "etudes", "recherche"]
		# Sol et toit : le diorama est une maison, pas trois barres.
		draw_line(Vector2(x0 - 16.0, y_bas), Vector2(x0 + largeur + 16.0, y_bas), Palette.GRIS_ACIER, 1.0)
		var y_toit: float = y_bas - 3.0 * h_etage - 1.0
		var toit := PackedVector2Array([Vector2(x0 - 10.0, y_toit),
			Vector2(x0 + largeur / 2.0, y_toit - 14.0), Vector2(x0 + largeur + 10.0, y_toit)])
		draw_polyline(toit, Palette.BOIS_MIEL, 2.0)
		for etage: int in range(3):
			var occupants: Array = []
			for ing: Dictionary in ingenieurs:
				if str(ing["poste"]) == str(postes_etages[etage]):
					occupants.append(ing)
			var ouvert: bool = n > etage * 4 or not occupants.is_empty()
			var mur := Rect2(x0, y_bas - h_etage * float(etage + 1), largeur, h_etage - 4.0)
			draw_rect(mur, Palette.BOIS_MIEL if ouvert else Palette.GRIS_ACIER)
			var interieur := mur.grow(-3.0)
			draw_rect(interieur, Palette.PAPIER_CREME if ouvert else Palette.ENCRE)
			draw_string(police, interieur.position + Vector2(6.0, 12.0),
				tr(str(noms_etages[etage])) if ouvert else tr("— fermé —"), HORIZONTAL_ALIGNMENT_LEFT,
				-1.0, 9, Palette.BOIS_MIEL if ouvert else Palette.GRIS_ACIER)
			if not ouvert:
				continue
			draw_string(police, interieur.position + Vector2(0.0, 12.0),
				tr("%d à l'œuvre") % occupants.size(), HORIZONTAL_ALIGNMENT_RIGHT,
				interieur.size.x - 6.0, 9, Palette.GRIS_ACIER)
			# 4 postes de travail meublés ; un ingénieur debout derrière chaque poste occupé.
			for i: int in range(4):
				var px: float = interieur.position.x + 24.0 + float(i) * (interieur.size.x - 48.0) / 3.0
				var py: float = interieur.end.y - 5.0
				draw_rect(Rect2(px - 9.0, py - 5.0, 18.0, 2.0), Palette.BOIS_MIEL)
				draw_rect(Rect2(px - 8.0, py - 3.0, 2.0, 3.0), Palette.BOIS_MIEL)
				draw_rect(Rect2(px + 6.0, py - 3.0, 2.0, 3.0), Palette.BOIS_MIEL)
				if i < occupants.size():
					_silhouette_ing(px, py - 6.0 - float((i + phase) % 2), float(occupants[i]["moral"]))
		# Les non-affectés attendent dehors, à droite de la porte.
		var j: int = 0
		for ing: Dictionary in ingenieurs:
			if str(ing["poste"]) == "":
				_silhouette_ing(x0 + largeur + 20.0 + float(j) * 14.0,
					y_bas - float((j + phase) % 2), float(ing["moral"]))
				j += 1

	func _silhouette_ing(x: float, y_pieds: float, moral: float) -> void:
		# Le moral se voit : corps encre, tête laiton qui vire au rouge sous 0.5.
		draw_rect(Rect2(x - 3.0, y_pieds - 9.0, 6.0, 9.0), Palette.ENCRE)
		draw_rect(Rect2(x - 2.0, y_pieds - 13.0, 4.0, 4.0),
			Palette.LAITON if moral >= 0.5 else Palette.ROUGE_ALERTE)


func _ready() -> void:
	# Fond charbon : c'est le canevas de main qui sert de décor au diorama.
	var th := Theme.new()
	th.default_font_size = 9
	theme = th
	# L'unique animation de l'écran : bob des pastilles, 2 images par seconde, si visible.
	var horloge := Timer.new()
	horloge.wait_time = 0.5
	horloge.autostart = true
	horloge.timeout.connect(func() -> void:
		if visible and animations_actives and _diorama != null:
			_diorama.phase = 1 - _diorama.phase
			_diorama.queue_redraw())
	add_child(horloge)


func configurer(state_: Dictionary, data_: Dictionary) -> void:
	state = state_
	data = data_
	var marge := MarginContainer.new()
	marge.set_anchors_preset(Control.PRESET_FULL_RECT)
	for cote: String in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		marge.add_theme_constant_override(cote, 8)
	add_child(marge)
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 8)
	marge.add_child(rangee)
	_diorama = Diorama.new()
	_diorama.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_diorama.size_flags_vertical = Control.SIZE_EXPAND_FILL
	rangee.add_child(_diorama)

	# Registre du personnel sur carte papier (comme les autres écrans), défilement
	# vertical uniquement : le repli des libellés fait tenir la largeur, un slider
	# horizontal cacherait du texte hors cadre.
	var carte := Cartes.carte()
	carte.custom_minimum_size = Vector2(300.0, 0.0)
	rangee.add_child(carte)
	var defilement := ScrollContainer.new()
	defilement.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	carte.add_child(defilement)
	var droite := VBoxContainer.new()
	droite.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	droite.add_theme_constant_override("separation", 2)
	defilement.add_child(droite)
	_effets = _etiquette("", Palette.BOIS_MIEL)
	droite.add_child(_effets)
	droite.add_child(_titre("ÉQUIPE"))
	# Légende des puces de compétences : É/R/A sont cryptiques sans clé (retour playtest).
	var legende := HBoxContainer.new()
	legende.add_theme_constant_override("separation", 6)
	var l_leg := _etiquette(tr("Compétences :"), Palette.GRIS_ACIER)
	l_leg.autowrap_mode = TextServer.AUTOWRAP_OFF
	legende.add_child(l_leg)
	for c: Array in COMPETENCES:
		var item := HBoxContainer.new()
		item.add_theme_constant_override("separation", 2)
		item.add_child(_puce(tr(str(c[0])), c[3]))
		var nom := _etiquette("= " + tr(str(c[2])), Palette.GRIS_ACIER)
		nom.autowrap_mode = TextServer.AUTOWRAP_OFF
		item.add_child(nom)
		legende.add_child(item)
	droite.add_child(legende)
	droite.add_child(HSeparator.new())
	_boite_equipe = VBoxContainer.new()
	_boite_equipe.add_theme_constant_override("separation", 1)
	droite.add_child(_boite_equipe)
	droite.add_child(_titre("CANDIDATS"))
	droite.add_child(HSeparator.new())
	_boite_candidats = VBoxContainer.new()
	_boite_candidats.add_theme_constant_override("separation", 1)
	droite.add_child(_boite_candidats)
	rafraichir()


# ponytail: reconstruction des lignes à chaque rafraîchissement trimestriel — pooling
# seulement si le profiler le réclame (passe perf, étape 9).
func rafraichir() -> void:
	if state.is_empty() or _boite_equipe == null:
		return
	_diorama.ingenieurs = state["ingenieurs"]
	_diorama.queue_redraw()
	var ce: Dictionary = data["constants"]["equipe"]
	# L'atelier est le seul bonus PLANCHÉ (`production.capacite` fait un floor : on ne livre
	# pas des fractions d'avion). À palier 1 le plafond du bonus (15 %) est SOUS le seuil du
	# premier appareil (1/6 = 16.7 %) : le poste ne peut rien rapporter, et l'afficher en %
	# laissait croire le contraire (playtest n°7). On montre donc la capacité EFFECTIVE.
	var base_pal: float = float((data["constants"]["eco"]["paliers_atelier"] as Array)[int(state["atelier"]["palier"]) - 1])
	var cap: float = Production.capacite(state, data)
	_effets.text = tr("Recherche +%d %% · Prototype −%d %% · Atelier %d→%d appareils/trim. · %d/%d postes") % [
		int(roundf(Ingenieurs.bonus(state, data, "recherche") * 100.0)),
		int(roundf(Ingenieurs.bonus(state, data, "etudes") * 100.0)),
		int(base_pal), int(cap),
		(state["ingenieurs"] as Array).size(), int(ce["max_postes"])]
	_effets.tooltip_text = tr("Bonus cumulés de l'équipe : compétence + trait assorti, × moral de chaque affecté. Recherche : le Labo va d'autant plus vite (chaque point compte). Prototype : remise sur le coût de prototypage (chaque point compte). Atelier : +1 %% de capacité par point, plafonné à 15 %% — mais la capacité s'arrondit à l'appareil INFÉRIEUR, donc au palier 1 (6/trim) le bonus ne peut jamais atteindre le 7e appareil : mieux vaut affecter ailleurs tant que l'atelier n'est pas agrandi.")
	_effets.mouse_filter = Control.MOUSE_FILTER_STOP
	_maj_equipe()
	_maj_candidats()


func _maj_equipe() -> void:
	for enfant: Node in _boite_equipe.get_children():
		enfant.queue_free()
	var ings: Array = state["ingenieurs"]
	for i: int in range(ings.size()):
		var ing: Dictionary = ings[i]
		_boite_equipe.add_child(_ligne_nom(ing))
		# Puces + moral + contrôles sur la seconde ligne.
		var rangee := HBoxContainer.new()
		rangee.add_theme_constant_override("separation", 4)
		_ajouter_puces(rangee, ing)
		var espace := Control.new()
		espace.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rangee.add_child(espace)
		var choix := OptionButton.new()
		choix.add_theme_font_size_override("font_size", 9)
		choix.tooltip_text = tr("Affecte cet ingénieur à un poste : Études (accélère et remise le prototype), Recherche (accélère le Labo), Atelier (augmente la capacité de production). Non affecté = ne contribue à rien.")
		for paire: Array in POSTES_UI:
			choix.add_item(str(paire[1]))
			if str(paire[0]) == str(ing["poste"]):
				choix.select(choix.item_count - 1)
		choix.item_selected.connect(func(idx: int) -> void: _sur_affecter(i, str((POSTES_UI[idx] as Array)[0])))
		rangee.add_child(choix)
		# Destructif et payant (indemnité) : deux clics, comme le retrait d'un produit.
		var bouton := Button.new()
		bouton.text = "Licencier"
		bouton.tooltip_text = tr("Renvoie cet ingénieur — coûte une indemnité de plusieurs semaines de salaire.")
		Cartes.armer(bouton, "Confirmer ?", func() -> void: _sur_licencier(i))
		rangee.add_child(bouton)
		_boite_equipe.add_child(rangee)
		if i < ings.size() - 1:
			_boite_equipe.add_child(HSeparator.new())


func _maj_candidats() -> void:
	for enfant: Node in _boite_candidats.get_children():
		enfant.queue_free()
	var candidats: Array = state["recrutement"]["candidats"]
	if candidats.is_empty():
		_boite_candidats.add_child(_etiquette("Personne sur le marché — prochaine fournée bientôt.", Palette.GRIS_ACIER))
		return
	for i: int in range(candidats.size()):
		var c: Dictionary = candidats[i]
		_boite_candidats.add_child(_ligne_nom(c))
		var rangee := HBoxContainer.new()
		rangee.add_theme_constant_override("separation", 4)
		_ajouter_puces(rangee, c)
		var espace := Control.new()
		espace.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rangee.add_child(espace)
		var bouton := Button.new()
		bouton.text = "Recruter"
		bouton.tooltip_text = tr("Embauche ce candidat — salaire hebdomadaire dû dès l'affectation à un poste. Le vivier se renouvelle périodiquement et s'améliore avec les années.")
		bouton.pressed.connect(func() -> void: _sur_recruter(i))
		rangee.add_child(bouton)
		_boite_candidats.add_child(rangee)
		if i < candidats.size() - 1:
			_boite_candidats.add_child(HSeparator.new())


# Ligne d'identité : nom + trait à gauche, salaire à droite.
func _ligne_nom(ing: Dictionary) -> Control:
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 4)
	var nom_trait: String = ""
	if str(ing["trait"]) != "":
		nom_trait = " — " + str(data["engineers"]["traits"][str(ing["trait"])]["nom"])
	var nom := _etiquette("%s%s" % [str(ing["nom"]), nom_trait], Palette.ENCRE)
	nom.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rangee.add_child(nom)
	var salaire := _etiquette(tr("%d £/sem") % int(ing["salaire_sem"]), Palette.GRIS_ACIER)
	salaire.autowrap_mode = TextServer.AUTOWRAP_OFF
	rangee.add_child(salaire)
	return rangee


# Trois puces de compétences (couleur du poste assorti au diorama) + la barre de moral.
# Les 3 compétences, avec leur nom complet en infobulle (É=Études, R=Recherche, A=Atelier).
const COMPETENCES: Array = [
	["É", "etudes", "Études", Palette.BLEU_CYANOTYPE],
	["R", "recherche", "Recherche", Palette.BORDEAUX],
	["A", "atelier", "Atelier", Palette.VERT_LAMPE],
]


func _ajouter_puces(rangee: HBoxContainer, ing: Dictionary) -> void:
	var comp: Dictionary = ing["comp"]
	for c: Array in COMPETENCES:
		var niveau: int = int(comp[str(c[1])])
		rangee.add_child(_puce("%s%d" % [tr(str(c[0])), niveau], c[3],
			tr("%s : niveau %d / 5") % [tr(str(c[2])), niveau]))
	rangee.add_child(_barre_moral(float(ing["moral"])))


func _puce(texte: String, teinte: Color, infobulle: String = "") -> Control:
	var p := PanelContainer.new()
	var s := StyleBoxFlat.new()
	s.bg_color = Color(teinte, 0.16)
	s.set_corner_radius_all(3)
	s.content_margin_left = 4.0
	s.content_margin_right = 4.0
	s.content_margin_top = 0.0
	s.content_margin_bottom = 0.0
	p.add_theme_stylebox_override("panel", s)
	p.size_flags_vertical = Control.SIZE_SHRINK_CENTER  # sinon la puce s'étire sur la hauteur de la rangée
	if infobulle != "":
		p.tooltip_text = infobulle
	var l := Label.new()
	l.text = texte
	l.add_theme_font_size_override("font_size", 9)
	l.add_theme_color_override("font_color", teinte.darkened(0.25))
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE  # sinon le label avale l'infobulle du parent
	p.add_child(l)
	return p


# Le moral en barre (vert / miel / rouge) : « moral 100 % » en texte partout était du bruit.
func _barre_moral(moral: float) -> Control:
	var fond := ColorRect.new()
	fond.color = Color(Palette.ENCRE, 0.12)
	fond.custom_minimum_size = Vector2(40.0, 5.0)
	fond.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	fond.tooltip_text = tr("moral %d %%") % int(roundf(moral * 100.0))
	var rempli := ColorRect.new()
	rempli.color = Palette.VERT_LAMPE if moral >= 0.75 else (Palette.BOIS_MIEL if moral >= 0.5 else Palette.ROUGE_ALERTE)
	fond.add_child(rempli)
	rempli.position = Vector2.ZERO
	rempli.size = Vector2(40.0 * clampf(moral, 0.0, 1.0), 5.0)
	return fond


# --- intentions -------------------------------------------------------------------

func _sur_affecter(indice: int, poste: String) -> void:
	# On rafraîchit MÊME EN CAS DE REFUS : Godot déplace la sélection de l'OptionButton dès le
	# clic, donc sans ce retour il affiche un poste que la sim n'a pas accepté et il diverge du
	# diorama, qui lit le state (playtest n°10 : trois « Études » affichés face à un Institut
	# qui comptait toujours son chercheur). Le refus doit se voir, pas se deviner.
	if not appliquer.is_null():
		appliquer.call({"type": "affecter", "indice": indice, "poste": poste})
	rafraichir()


func _sur_recruter(indice: int) -> void:
	if not appliquer.is_null() and bool(appliquer.call({"type": "recruter", "indice": indice})):
		rafraichir()


func _sur_licencier(indice: int) -> void:
	if not appliquer.is_null() and bool(appliquer.call({"type": "licencier", "indice": indice})):
		rafraichir()


# --- petits constructeurs ----------------------------------------------------------

# Repli PAR DÉFAUT : un Label sans repli impose sa largeur de texte au conteneur
# parent et pousse l'écran hors du viewport (même règle que marche.gd).
func _etiquette(texte: String, couleur: Color) -> Label:
	var l := Label.new()
	l.text = texte
	l.add_theme_font_size_override("font_size", 9)
	l.add_theme_color_override("font_color", couleur)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _titre(texte: String) -> Label:
	var l := _etiquette(texte, Palette.BOIS_MIEL)
	l.add_theme_font_size_override("font_size", 9)
	return l
