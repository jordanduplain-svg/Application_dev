# Raison d'être : l'écran Direction — les leviers stratégiques et financiers de la maison,
# jadis entassés dans la colonne COMMERCE du Marché : marque & réputation, publicité, banque,
# assurance, contrats d'entretien, partenariat motoriste, filiale coloniale. N'écrit jamais
# dans le state : intentions via le Callable `appliquer` injecté par main.
extends Control

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Moteurs := preload("res://sim/motors.gd")
const Bombardements := preload("res://sim/bombardements.gd")
const Production := preload("res://sim/production.gd")
const Palette := preload("res://game/ui/palette.gd")
const Cartes := preload("res://game/ui/cartes.gd")
const MarcheEcran := preload("res://game/market_ui/marche.gd")

var appliquer: Callable = Callable()  # func(intention: Dictionary) -> bool, injecté par main
var state: Dictionary = {}
var data: Dictionary = {}

var _boite_marque: VBoxContainer
var _boite_finances: VBoxContainer
var _boite_risque: VBoxContainer
var _boite_strategie: VBoxContainer


func _ready() -> void:
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
	var defilement := ScrollContainer.new()
	defilement.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	marge.add_child(defilement)
	# Deux colonnes de cartes : marque/risque à gauche, finances/stratégie à droite.
	var rangee := HBoxContainer.new()
	rangee.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rangee.add_theme_constant_override("separation", 8)
	defilement.add_child(rangee)
	var gauche := _colonne(rangee)
	var droite := _colonne(rangee)
	_boite_marque = _carte_titree(gauche, "MARQUE & RÉPUTATION")
	_boite_risque = _carte_titree(gauche, "ASSURANCE & ENTRETIEN")
	_boite_finances = _carte_titree(droite, "BANQUE")
	_boite_strategie = _carte_titree(droite, "ENGAGEMENTS À VIE")
	rafraichir()


func _colonne(rangee: HBoxContainer) -> VBoxContainer:
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 8)
	rangee.add_child(col)
	return col


func _carte_titree(col: VBoxContainer, titre: String) -> VBoxContainer:
	var carte := Cartes.carte(Palette.PAPIER_CREME, 7.0)
	var boite := VBoxContainer.new()
	boite.add_theme_constant_override("separation", 2)
	carte.add_child(boite)
	boite.add_child(_titre(titre))
	boite.add_child(HSeparator.new())
	var contenu := VBoxContainer.new()
	contenu.add_theme_constant_override("separation", 2)
	boite.add_child(contenu)
	col.add_child(carte)
	return contenu


func rafraichir() -> void:
	if state.is_empty() or _boite_marque == null:
		return
	_maj_marque()
	_maj_risque()
	_maj_finances()
	_maj_strategie()


# --- marque & réputation + publicité -------------------------------------------------

func _maj_marque() -> void:
	for enfant: Node in _boite_marque.get_children():
		enfant.queue_free()
	var cr: Dictionary = data["constants"]["repu"]
	var pub: Dictionary = data["constants"]["publicite"]
	# Tendance par domaine : la vraie formule (fiab − pivot) × livraisons du dernier trimestre.
	var tendance: Dictionary = {"civile": 0.0, "militaire": 0.0}
	for uid: String in Etat.cles_triees(state["catalogue"]):
		var produit: Dictionary = state["catalogue"][uid]
		var seg_p: String = str(produit["segment"])
		var livrees_p: float = _livre_dernier_trim(seg_p, uid)
		if livrees_p <= 0.0:
			continue
		var domaine: String = str(data["segments"][seg_p]["domaine_repu"])
		tendance[domaine] = float(tendance[domaine]) + clampf(
			(float(produit["specs"]["fiabilite"]) - float(cr["pivot_fiab"])) * float(cr["par_livraison"]) * livrees_p,
			-float(cr["delta_max"]), float(cr["delta_max"]))
	for domaine: String in ["civile", "militaire"]:
		var pts: float = float(tendance[domaine]) * 100.0
		var couleur: Color = Palette.VERT_LAMPE if pts > 0.05 else (Palette.ROUGE_ALERTE if pts < -0.05 else Palette.GRIS_ACIER)
		_boite_marque.add_child(_etiquette(tr("Réputation %s %d %% · flotte %+.1f pt/trim") \
			% [tr(domaine), int(roundf(float(state["rep"][domaine]) * 100.0)), pts], couleur))
	_boite_marque.add_child(_etiquette(tr("Pivot %d %% de fiabilité : au-dessus, chaque livraison bâtit la marque ; en dessous, elle l'érode (et risque l'accident). Concours gagnés, raids et courses donnent des points d'un coup.") \
		% int(roundf(float(cr["pivot_fiab"]) * 100.0)), Palette.GRIS_ACIER))
	if Sim.publicite_dispo(state, data):
		var gain_pts: int = int(roundf(Sim.publicite_gain(state, data) * 100.0))
		var bouton := Button.new()
		bouton.text = tr("Campagne de presse %s £ (+%d pts)") % [MarcheEcran.francs(float(pub["cout"])), gain_pts]
		bouton.add_theme_font_size_override("font_size", 9)
		bouton.add_theme_color_override("font_color", Palette.ENCRE)
		bouton.pressed.connect(func() -> void:
			if not appliquer.is_null() and bool(appliquer.call({"type": "campagne_publicite"})):
				rafraichir())
		_boite_marque.add_child(bouton)
	else:
		var reste: int = int(ceilf(float(pub["cooldown_sem"])
			- (float(state["tick"]) - float(state.get("pub_dernier_tick", -999.0)))))
		var motif: String = tr("trésorerie insuffisante") if float(state["tresorerie"]) < float(pub["cout"]) \
			else tr("revient dans %d sem") % maxi(reste, 0)
		_boite_marque.add_child(_etiquette(tr("Campagne : %s") % motif, Palette.GRIS_ACIER))


# --- assurance & contrats d'entretien -------------------------------------------------

func _maj_risque() -> void:
	for enfant: Node in _boite_risque.get_children():
		enfant.queue_free()
	var prime: float = float(data["constants"]["accidents"]["assurance_prime_sem_par_produit"])
	_boite_risque.add_child(_case(tr("Assurance flotte (%d £/sem par appareil)") % int(prime),
		bool(state.get("assurance", false)), "assurance",
		tr("Prime hebdomadaire par produit au catalogue. En échange, un accident coûte deux fois moins cher : carnet ×0.75 au lieu de ×0.5, réputation −2 pts au lieu de −4.")))
	_boite_risque.add_child(_etiquette(tr("Un accident sur produit fragile amortit réputation et carnet."), Palette.GRIS_ACIER))
	var ce: Dictionary = data["constants"]["entretien_flotte"]
	_boite_risque.add_child(_case(tr("Contrats d'entretien (%d £/trim × fiab par appareil en service)") % int(ce["fee_trim_par_appareil"]),
		bool(state.get("entretien_flotte", false)), "entretien_flotte",
		tr("Revenu chaque trimestre pour chaque appareil encore en service (livré dans les 3 dernières années), proportionnel à sa fiabilité. Un avion fiable rapporte deux fois : à la vente, puis à l'entretien.")))
	if bool(state.get("entretien_flotte", false)):
		_boite_risque.add_child(_etiquette(tr("⚠ un accident sur flotte entretenue coûte DOUBLE réputation."), Palette.ROUGE_ALERTE))
	else:
		_boite_risque.add_child(_etiquette(tr("La fiabilité paie deux fois — en revenu comme en risque."), Palette.GRIS_ACIER))


func _case(texte: String, actif: bool, type_intention: String, infobulle: String = "") -> CheckBox:
	var c := CheckBox.new()
	c.text = texte
	c.add_theme_font_size_override("font_size", 9)
	c.add_theme_color_override("font_color", Palette.ENCRE)
	c.set_pressed_no_signal(actif)
	if infobulle != "":
		c.tooltip_text = infobulle
	c.toggled.connect(func(a: bool) -> void:
		if not appliquer.is_null():
			appliquer.call({"type": type_intention, "actif": a})
			rafraichir())
	return c


# --- banque --------------------------------------------------------------------------

func _maj_finances() -> void:
	for enfant: Node in _boite_finances.get_children():
		enfant.queue_free()
	var dette: float = float(state.get("emprunt", 0.0))
	var plafond: float = Sim.plafond_banque(state, data)
	var l_dette := _etiquette(tr("Dette %s £ / plafond %s £ (taux %.2f %%/sem)") \
		% [MarcheEcran.francs(dette), MarcheEcran.francs(plafond), float(data["constants"]["banque"]["taux_hebdo"]) * 100.0],
		Palette.ROUGE_ALERTE if dette > 0.0 else Palette.ENCRE)
	l_dette.tooltip_text = tr("Des intérêts sont prélevés chaque semaine sur la dette restante. Le plafond que la banque accepte de prêter suit votre réputation (civile ou militaire, la plus haute des deux).")
	l_dette.mouse_filter = Control.MOUSE_FILTER_STOP
	_boite_finances.add_child(l_dette)
	_boite_finances.add_child(_etiquette(tr("Le plafond suit votre réputation. En crise, la banque peut rappeler son dû."), Palette.GRIS_ACIER))
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 3)
	if dette < plafond:
		var emp := Button.new()
		emp.text = tr("Emprunter 100 000 £")
		emp.add_theme_font_size_override("font_size", 9)
		emp.add_theme_color_override("font_color", Palette.ENCRE)
		emp.tooltip_text = tr("Ajoute 100 000 £ (ou le reste du plafond si moindre) à la trésorerie immédiatement, contre des intérêts hebdomadaires sur la dette.")
		emp.pressed.connect(func() -> void:
			if not appliquer.is_null() and bool(appliquer.call({"type": "emprunter", "montant": minf(100000.0, plafond - dette)})):
				rafraichir())
		rangee.add_child(emp)
	if dette > 0.0:
		var remb := Button.new()
		remb.text = tr("Rembourser 100 000 £")
		remb.add_theme_font_size_override("font_size", 9)
		remb.add_theme_color_override("font_color", Palette.ENCRE)
		remb.tooltip_text = tr("Rembourse jusqu'à 100 000 £ de dette (limité à la trésorerie disponible), réduisant les intérêts hebdomadaires.")
		remb.pressed.connect(func() -> void:
			if not appliquer.is_null() and bool(appliquer.call({"type": "rembourser", "montant": 100000.0})):
				rafraichir())
		rangee.add_child(remb)
	if rangee.get_child_count() > 0:
		_boite_finances.add_child(rangee)


# --- engagements à vie : motoriste + filiale -----------------------------------------

func _maj_strategie() -> void:
	for enfant: Node in _boite_strategie.get_children():
		enfant.queue_free()
	var remise_pct: int = int(roundf((1.0 - float(data["constants"]["motoriste"]["remise_cout"])) * 100.0))
	var partenaire: String = str(state.get("motoriste", ""))
	if partenaire != "":
		_boite_strategie.add_child(_etiquette(tr("Motoriste : exclusivité %s (−%d %% sur leurs moteurs).") \
			% [partenaire, remise_pct], Palette.VERT_LAMPE))
	elif Moteurs.departement(state):
		_boite_strategie.add_child(_etiquette(tr("Motoriste : plus de partenariat possible — vous êtes devenu leur concurrent."), Palette.GRIS_ACIER))
	else:
		_boite_strategie.add_child(_etiquette(tr("Partenariat motoriste (à vie) : leurs moteurs −%d %%, l'autre maison interdite. Exclusif de votre propre département moteurs.") \
			% remise_pct, Palette.GRIS_ACIER))
		var rangee_m := HBoxContainer.new()
		rangee_m.add_theme_constant_override("separation", 3)
		for marque_v: Variant in data["constants"]["motoriste"]["marques"]:
			var marque: String = str(marque_v)
			var bouton_m := Button.new()
			bouton_m.text = "→ " + marque
			bouton_m.add_theme_font_size_override("font_size", 9)
			bouton_m.add_theme_color_override("font_color", Palette.ENCRE)
			bouton_m.tooltip_text = tr("Engagement À VIE, irréversible. Tous les moteurs %s coûtent −%d %% ; les moteurs de l'autre maison disparaissent de votre catalogue.") % [marque, remise_pct]
			Cartes.armer(bouton_m, "Confirmer ?", func() -> void:
				if not appliquer.is_null() and bool(appliquer.call({"type": "signer_motoriste", "marque": marque})):
					rafraichir())
			rangee_m.add_child(bouton_m)
		_boite_strategie.add_child(rangee_m)
	# Plafond d'atelier accepté en 1936 : c'est un engagement à vie comme les autres, il doit
	# se voir ici — sinon le joueur redécouvre deux ans plus tard qu'il ne peut plus agrandir.
	if Production.plafond_actif(state):
		var l_pl := _etiquette(tr("Shadow scheme en cours : atelier gelé encore %d semaines, aucun agrandissement.") 			% int(ceilf(Production.plafond_reste_sem(state))), Palette.ROUGE_ALERTE)
		l_pl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_boite_strategie.add_child(l_pl)
		_boite_strategie.add_child(HSeparator.new())
	_boite_strategie.add_child(HSeparator.new())
	# DISPERSION DES CHAÎNES : l'assurance anti-raid, à acheter AVANT le premier bombardement.
	var risque: float = Bombardements.risque(state, data)
	var degats: float = Bombardements.degats_sem(state)
	if degats > 0.0:
		_boite_strategie.add_child(_etiquette(tr("Usine touchée : %d semaines de production perdues.") 			% int(degats), Palette.ROUGE_ALERTE))
	if Bombardements.dispersion(state):
		_boite_strategie.add_child(_etiquette(tr("Chaînes dispersées en province — risque de raid %d %% par trimestre.") 			% int(roundf(risque * 100.0)), Palette.VERT_LAMPE))
	else:
		var cout_d: float = Bombardements.cout_dispersion(data)
		var l_r := _etiquette(tr("Raids aériens : %d %% de risque par trimestre sur votre atelier — plus il est grand, plus il se voit.") 			% int(roundf(risque * 100.0)), Palette.BOIS_MIEL if risque > 0.0 else Palette.GRIS_ACIER)
		l_r.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_boite_strategie.add_child(l_r)
		var bouton_d := Button.new()
		bouton_d.text = tr("Disperser les chaînes (%s £)") % MarcheEcran.francs(cout_d)
		bouton_d.add_theme_font_size_override("font_size", 9)
		bouton_d.add_theme_color_override("font_color", Palette.ENCRE)
		bouton_d.disabled = float(state["tresorerie"]) < cout_d
		bouton_d.tooltip_text = tr("Éclate la production sur des dizaines de petits sites, comme Supermarine après la destruction de Woolston en 1940. Le risque de raid chute fortement et les dégâts sont bien moindres. À VIE, et à décider AVANT le premier bombardement : une usine en ruines ne se disperse plus.")
		Cartes.armer(bouton_d, "Confirmer ?", func() -> void:
			if not appliquer.is_null() and bool(appliquer.call({"type": "disperser_chaines"})):
				rafraichir())
		_boite_strategie.add_child(bouton_d)
	_boite_strategie.add_child(HSeparator.new())
	# Bureau d'études moteurs : l'autre branche de l'alternative « intégrer ou sous-traiter ».
	if Moteurs.departement(state):
		_boite_strategie.add_child(_etiquette(tr("Département moteurs : vous concevez vos moteurs (écran Labo)."), Palette.VERT_LAMPE))
	else:
		var cout_m: float = float(data["constants"]["moteurs"]["cout_departement"])
		_boite_strategie.add_child(_etiquette(tr("Concevoir vos propres moteurs : au prix coûtant et taillés pour vos cellules, au lieu du catalogue du commerce."), Palette.GRIS_ACIER))
		var fonder_m := Button.new()
		fonder_m.text = tr("Fonder le département moteurs (%s £)") % MarcheEcran.francs(cout_m)
		fonder_m.add_theme_font_size_override("font_size", 9)
		fonder_m.add_theme_color_override("font_color", Palette.ENCRE)
		fonder_m.disabled = float(state["tresorerie"]) < cout_m or str(state.get("motoriste", "")) != ""
		fonder_m.tooltip_text = tr("Engagement à vie : bancs d'essai, fonderie, atelier de rodage. Vous concevez alors vos moteurs au Labo — cylindrée, architecture, suralimentation, soin de fabrication — et les payez au prix coûtant. Ferme définitivement la porte d'un partenariat motoriste.")
		Cartes.armer(fonder_m, "Confirmer ?", func() -> void:
			if not appliquer.is_null() and bool(appliquer.call({"type": "fonder_moteurs"})):
				rafraichir())
		_boite_strategie.add_child(fonder_m)
	_boite_strategie.add_child(HSeparator.new())
	if bool(state.get("filiale", false)):
		_boite_strategie.add_child(_etiquette(tr("Filiale coloniale : gamme élargie + %d commandes captives/trim.") \
			% int(data["constants"]["filiale"]["commandes_trim"]), Palette.VERT_LAMPE))
	else:
		var cout_f: float = float(data["constants"]["filiale"]["cout"])
		_boite_strategie.add_child(_etiquette(tr("Un 5e emplacement de catalogue + un débouché captif — le puits à argent de fin de partie."), Palette.GRIS_ACIER))
		var fonder := Button.new()
		fonder.text = tr("Fonder une filiale coloniale (%s £)") % MarcheEcran.francs(cout_f)
		fonder.add_theme_font_size_override("font_size", 9)
		fonder.add_theme_color_override("font_color", Palette.ENCRE)
		fonder.disabled = float(state["tresorerie"]) < cout_f
		Cartes.armer(fonder, "Confirmer ?", func() -> void:
			if not appliquer.is_null() and bool(appliquer.call({"type": "fonder_filiale"})):
				rafraichir())
		_boite_strategie.add_child(fonder)


# --- petits helpers -------------------------------------------------------------------

func _livre_dernier_trim(nom_seg: String, uid: String) -> float:
	var marche: Dictionary = state["marche"]
	if not marche.has(nom_seg):
		return 0.0
	var hist: Array = marche[nom_seg]["historique"]
	if hist.is_empty():
		return 0.0
	return float((hist[hist.size() - 1]["ventes"] as Dictionary).get(uid, 0.0))


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
