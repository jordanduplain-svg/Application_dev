# Raison d'être : l'écran marché — un rapport commercial d'époque sur papier crème :
# parts de marché en barres empilées par maison (vous = laiton), demande et contexte,
# gamme du joueur (prix modifiable, retrait), atelier, catalogue rival. L'écran n'écrit
# jamais dans le state : il émet des intentions via le Callable `appliquer` injecté par main.
extends Control

const Etat := preload("res://sim/state.gd")
const Marche := preload("res://sim/market.gd")
const Sim := preload("res://sim/sim.gd")
const Production := preload("res://sim/production.gd")
const Bombardements := preload("res://sim/bombardements.gd")
const Palette := preload("res://game/ui/palette.gd")
const Cartes := preload("res://game/ui/cartes.gd")
const Criteres := preload("res://game/ui/criteres_ui.gd")

var appliquer: Callable = Callable()  # func(intention: Dictionary) -> bool, injecté par main
var state: Dictionary = {}
var data: Dictionary = {}

var _panneaux: Dictionary = {}     # nom_seg -> {"entete", "contexte", "barres", "volume"}
var _prix_boxes: Dictionary = {}   # uid produit -> SpinBox (aussi utilisé par le smoke test)
var _boite_gamme: VBoxContainer
var _boite_atelier: VBoxContainer
var _boite_rivaux: VBoxContainer
var _retour: Label


# Barres empilées pleines : une colonne par trimestre (les récents à droite), découpée
# par maison selon la part des livraisons — le seul dessin custom de l'écran.
class Barres:
	extends Control
	var trimestres: Array = []  # par trimestre : [part_joueur, part_blochard, part_marane]
	var couleurs: Array = []
	var max_colonnes: int = 12

	func _draw() -> void:
		var pas: float = size.x / float(max_colonnes)
		for i: int in range(trimestres.size()):
			var x: float = size.x - pas * float(trimestres.size() - i)
			var y: float = size.y
			var parts: Array = trimestres[i]
			for j: int in range(parts.size()):
				var h: float = size.y * float(parts[j])
				y -= h
				draw_rect(Rect2(x, y, pas - 1.0, h), couleurs[j])


func _ready() -> void:
	# Fond charbon : c'est le canevas de main qui se voit entre les cartes papier.
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
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 8)
	marge.add_child(rangee)

	var gauche := VBoxContainer.new()
	gauche.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	gauche.add_theme_constant_override("separation", 6)
	rangee.add_child(gauche)
	gauche.add_child(_legende())
	for nom_seg: String in Etat.cles_triees(data["segments"]):
		gauche.add_child(_panneau_segment(nom_seg))

	var carte_droite := Cartes.carte()
	carte_droite.custom_minimum_size = Vector2(262.0, 0.0)
	rangee.add_child(carte_droite)
	var defilement := ScrollContainer.new()
	# Défilement vertical UNIQUEMENT : sans ça, un libellé large fait défiler à
	# l'horizontale et cache du texte hors cadre. Désactivé, la colonne contraint
	# sa largeur et les libellés (qui replient) s'ajustent à la carte.
	defilement.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	carte_droite.add_child(defilement)
	var droite := VBoxContainer.new()
	droite.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	droite.add_theme_constant_override("separation", 2)
	defilement.add_child(droite)
	droite.add_child(_titre("MA GAMME"))
	_boite_gamme = VBoxContainer.new()
	_boite_gamme.add_theme_constant_override("separation", 1)
	droite.add_child(_boite_gamme)
	droite.add_child(_titre("ATELIER"))
	_boite_atelier = VBoxContainer.new()
	_boite_atelier.add_theme_constant_override("separation", 1)
	droite.add_child(_boite_atelier)
	droite.add_child(_titre("CONCURRENCE"))
	_boite_rivaux = VBoxContainer.new()
	_boite_rivaux.add_theme_constant_override("separation", 1)
	droite.add_child(_boite_rivaux)
	_retour = _etiquette("", Palette.ROUGE_ALERTE)
	_retour.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	droite.add_child(_retour)
	rafraichir()


# Appelé par main à chaque trimestre (et à l'affichage de l'écran).
# ponytail: reconstruction des lignes à chaque rafraîchissement trimestriel — pooling
# de nœuds seulement si le profiler le réclame (passe perf, étape 9).
func rafraichir() -> void:
	if state.is_empty() or _boite_gamme == null:
		return
	var annee: float = Marche.annee_de(state)
	for nom_seg: String in Etat.cles_triees(data["segments"]):
		var seg: Dictionary = data["segments"][nom_seg]
		var refs: Dictionary = _panneaux[nom_seg]
		var d_now: float = Marche.interp(seg["demande"], annee)
		var d_next: float = Marche.interp(seg["demande"], annee + 1.0)
		var fleche: String = "→"
		if d_next > d_now * 1.05:
			fleche = "↗"
		elif d_next < d_now * 0.95:
			fleche = "↘"
		(refs["entete"] as Label).text = "%s  %s" % [_nom_segment(nom_seg).to_upper(), fleche]
		(refs["contexte"] as Label).text = _contexte(seg, annee)
		(refs["volume"] as Label).text = tr("Demande ~%d appareils/an · prix médian %s £") \
			% [int(roundf(d_now)), francs(_prix_median(nom_seg))]
		# Ce que les acheteurs jugent — en étoiles d'importance, pas les poids/réfs bruts
		# (même code que le bureau ; ici pas de design précis, donc pas de flèche).
		var morceaux: Array = []
		for crit: Dictionary in Criteres.tries(seg):
			morceaux.append("%s %s" % [Criteres.nom(str(crit["nom"])), Criteres.etoiles(float(crit["poids"]))])
		(refs["attentes"] as Label).text = tr("Jugé sur : ") + " · ".join(morceaux)
		(refs["ventes"] as Label).text = _ventes_dernier_trim(nom_seg)
		var barres: Barres = refs["barres"]
		barres.trimestres = _series(nom_seg)
		barres.queue_redraw()
	_maj_gamme()
	_maj_atelier()
	_maj_rivaux()


# --- panneaux de gauche ---------------------------------------------------------

func _legende() -> Control:
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 4)
	# Lue depuis l'ÉTAT : après une fusion il ne reste qu'une maison rivale, la légende
	# doit suivre (elle était écrite en dur, avec les deux noms de 1922).
	var maisons: Array = [["Vous", Palette.LAITON]]
	var couleurs_r: Array = [Palette.GRIS_ACIER, Palette.BORDEAUX]
	for maison_l: String in Etat.cles_triees(state["rivaux"]):
		maisons.append([str(data["rivals"]["maisons"][maison_l]["nom"]),
			couleurs_r[mini(maisons.size() - 1, couleurs_r.size() - 1)]])
	for paire: Array in maisons:
		var carre := ColorRect.new()
		carre.color = paire[1]
		carre.custom_minimum_size = Vector2(7.0, 7.0)
		carre.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		rangee.add_child(carre)
		# Sur le canevas charbon (hors carte) : texte clair.
		var nom_l := _etiquette(str(paire[0]), Palette.PAPIER_CREME)
		# Seul cas de labels-texte en RANGÉE : le repli par défaut les effondrerait
		# lettre par lettre. Ligne fixe ici, à contre-courant du défaut (colonnes).
		nom_l.autowrap_mode = TextServer.AUTOWRAP_OFF
		rangee.add_child(nom_l)
	return rangee


func _panneau_segment(nom_seg: String) -> Control:
	var carte := Cartes.carte(Palette.PAPIER_CREME, 7.0)
	carte.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var boite := VBoxContainer.new()
	boite.add_theme_constant_override("separation", 1)
	carte.add_child(boite)
	var entete := _etiquette("", Palette.BOIS_MIEL)
	entete.add_theme_font_size_override("font_size", 9)
	boite.add_child(entete)
	var contexte := _etiquette("", Palette.GRIS_ACIER)
	boite.add_child(contexte)
	var barres := Barres.new()
	barres.couleurs = [Palette.LAITON, Palette.GRIS_ACIER, Palette.BORDEAUX]
	barres.custom_minimum_size = Vector2(0.0, 36.0)
	barres.size_flags_vertical = Control.SIZE_EXPAND_FILL
	boite.add_child(barres)
	var volume := _etiquette("", Palette.BLEU_CYANOTYPE)
	boite.add_child(volume)
	var ventes := _etiquette("", Palette.ENCRE)
	boite.add_child(ventes)
	var attentes := _etiquette("", Palette.GRIS_ACIER)
	attentes.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	boite.add_child(attentes)
	_panneaux[nom_seg] = {"entete": entete, "contexte": contexte, "barres": barres,
		"volume": volume, "ventes": ventes, "attentes": attentes}
	return carte


# Part des livraisons par maison sur les derniers trimestres (uid : p = joueur,
# première lettre de la maison pour les rivaux — convention de sim.gd/market.gd).
func _series(nom_seg: String) -> Array:
	var marche: Dictionary = state["marche"]
	if not marche.has(nom_seg):
		return []
	var hist: Array = marche[nom_seg]["historique"]
	var series: Array = []
	var debut: int = maxi(0, hist.size() - 12)
	for i: int in range(debut, hist.size()):
		var ventes: Dictionary = hist[i]["ventes"]
		var totaux: Array = [0.0, 0.0, 0.0]
		var total: float = 0.0
		for uid: String in Etat.cles_triees(ventes):
			var v: float = float(ventes[uid])
			totaux[_indice_maison(uid)] = float(totaux[_indice_maison(uid)]) + v
			total += v
		var parts: Array = [0.0, 0.0, 0.0]
		if total > 0.0:
			for j: int in range(3):
				parts[j] = float(totaux[j]) / total
		series.append(parts)
	return series


# Unités vendues par maison sur le dernier trimestre résolu, sous l'histogramme
# (les parts en % ne disent pas les volumes — demande playtest n°4).
func _ventes_dernier_trim(nom_seg: String) -> String:
	var marche: Dictionary = state["marche"]
	if not marche.has(nom_seg) or (marche[nom_seg]["historique"] as Array).is_empty():
		return ""
	var hist: Array = marche[nom_seg]["historique"]
	var ventes: Dictionary = hist[hist.size() - 1]["ventes"]
	var totaux: Array = [0.0, 0.0, 0.0]
	for uid: String in Etat.cles_triees(ventes):
		totaux[_indice_maison(uid)] = float(totaux[_indice_maison(uid)]) + float(ventes[uid])
	# Noms lus dans l'ÉTAT : écrits en dur, ils survivaient à une fusion en affichant la
	# maison unique sous l'ancien nom de la première, plus un second nom à zéro (fantôme).
	var morceaux: Array = [tr("Vous %d") % int(roundf(float(totaux[0])))]
	var i_m: int = 1
	for maison_v: String in Etat.cles_triees(state["rivaux"]):
		morceaux.append("%s %d" % [str(data["rivals"]["maisons"][maison_v]["nom"]),
			int(roundf(float(totaux[mini(i_m, totaux.size() - 1)])))])
		i_m += 1
	return tr("Trim. : ") + " · ".join(morceaux)


func _indice_maison(uid: String) -> int:
	if uid.begins_with("p"):
		return 0
	# Après la fusion il n'y a plus qu'une maison : ses appareils hérités gardent leur ancien
	# préfixe d'uid ("m…"), mais ils sont désormais LE MÊME concurrent — une seule couleur.
	if (state["rivaux"] as Dictionary).size() < 2:
		return 1
	match uid.substr(0, 1):
		"b":
			return 1
		"m":
			return 2
	return 0


func _contexte(seg: Dictionary, annee: float) -> String:
	var texte: String = ""
	for point: Array in seg.get("contexte", []):
		if annee >= float(point[0]):
			texte = str(point[1])
	return texte


# Unités livrées au joueur pour un produit sur le dernier trimestre résolu
# (le carnet ne dit que ce qui RESTE à livrer, pas ce qui l'a été).
func _livre_dernier_trim(nom_seg: String, uid: String) -> int:
	var marche: Dictionary = state["marche"]
	if not marche.has(nom_seg):
		return 0
	var hist: Array = marche[nom_seg]["historique"]
	if hist.is_empty():
		return 0
	return int(roundf(float((hist[hist.size() - 1]["ventes"] as Dictionary).get(uid, 0.0))))


func _livrees_dernier_trim_toutes() -> int:
	var total: float = 0.0
	for nom_seg: String in Etat.cles_triees(state["marche"]):
		var hist: Array = state["marche"][nom_seg]["historique"]
		if hist.is_empty():
			continue
		var ventes: Dictionary = hist[hist.size() - 1]["ventes"]
		for uid: String in ventes:
			if uid.begins_with("p"):
				total += float(ventes[uid])
	return int(roundf(total))


func _prix_median(nom_seg: String) -> float:
	# Réutilise le recensement public de la sim plutôt que le dupliquer.
	var lice: Array = Marche.produits_du_segment(state, nom_seg)
	if lice.is_empty():
		return 0.0
	var prix: Array = []
	for e: Dictionary in lice:
		prix.append(float(e["produit"]["prix"]))
	prix.sort()
	var milieu: int = floori(float(prix.size()) / 2.0)
	if prix.size() % 2 == 0:
		return (float(prix[milieu - 1]) + float(prix[milieu])) / 2.0
	return float(prix[milieu])


# --- colonne de droite ------------------------------------------------------------

func _maj_gamme() -> void:
	for enfant: Node in _boite_gamme.get_children():
		enfant.queue_free()
	_prix_boxes.clear()
	var cat: Dictionary = state["catalogue"]
	if cat.is_empty():
		_boite_gamme.add_child(_etiquette("Aucun produit — concevez au bureau d'études.", Palette.GRIS_ACIER))
		return
	var designs: Dictionary = state["designs"]
	var marche: Dictionary = state["marche"]
	# Ordre d'affichage = ordre de CRÉATION. `cles_triees` trie en TEXTE (« p10 » avant
	# « p8 ») : le 4e produit s'insérait AU-DESSUS du 1er et prenait sa place à l'écran,
	# poussant l'ancien sous le pli de la colonne — vécu comme une disparition (playtest
	# n°7 : « j'ai mis un transport en service et mon postal a disparu »). La sim garde
	# `cles_triees` partout, c'est l'AFFICHAGE qui doit suivre le temps.
	var uids: Array = Etat.cles_triees(cat)
	uids.sort_custom(func(a: String, b: String) -> bool: return int(a.substr(1)) < int(b.substr(1)))
	for uid: String in uids:
		var produit: Dictionary = cat[uid]
		var nom: String = uid
		if designs.has(str(produit["design_uid"])):
			nom = str(designs[str(produit["design_uid"])]["design"]["nom"])
		var seg_p: String = str(produit["segment"])
		var part: float = 0.0
		if marche.has(seg_p):
			part = float((marche[seg_p]["parts"] as Dictionary).get(uid, 0.0))
		_boite_gamme.add_child(_etiquette("%s — %s" % [nom, _nom_segment(seg_p)], Palette.ENCRE))
		# Étiquette d'OBSOLESCENCE : la note marché décroît quand les attentes du segment
		# montent et que les specs restent figées → l'avion se vend de moins en moins.
		var cm: Dictionary = data["constants"]["marche"]
		var rep_p: float = float(state["rep"][str(data["segments"][seg_p]["domaine_repu"])])
		var diag: Dictionary = Marche.diagnostic_segment(data, seg_p, produit["specs"], Marche.annee_de(state), rep_p)
		var note: float = float(diag["note"])
		var badge_txt: String = ""
		var badge_col: Color = Palette.VERT_LAMPE
		# Une note basse a DEUX causes distinctes qu'il ne faut pas confondre : l'avion a
		# vieilli pendant que les attentes montaient, OU il est neuf mais mal ajusté au
		# segment (un transport sans armement vendu à l'export marque 0 sur 22 % du poids).
		# Sans ce partage, un appareil sorti d'usine s'affichait « vieillissant » (playtest).
		var age_p: float = Marche.annee_de(state) - float(produit["annee"])
		if note >= float(cm["note_pointe"]):
			badge_txt = tr("● à la pointe")
			badge_col = Palette.VERT_LAMPE
		elif age_p < float(cm["age_recent_ans"]):
			badge_txt = tr("● inadapté au segment")
			badge_col = Palette.BOIS_MIEL
		elif note >= float(cm["note_obsolete"]):
			badge_txt = tr("● vieillissant")
			badge_col = Palette.BOIS_MIEL
		else:
			badge_txt = tr("● OBSOLÈTE")
			badge_col = Palette.ROUGE_ALERTE
		var badge := _etiquette(badge_txt, badge_col)
		# L'étiquette est ABSOLUE (vs les attentes de l'époque) alors que la part de marché est
		# RELATIVE : on peut être dépassé par son temps et rester premier d'un marché où tout
		# le monde l'est. Sans ce repère, « vieillissant » sans baisse des ventes déroute.
		var meilleur_rival: float = -1.0
		for e_v: Variant in Marche.produits_du_segment(state, seg_p):
			var e: Dictionary = e_v
			if str(e["maison"]) == "joueur":
				continue
			var nr: float = float(Marche.diagnostic_segment(data, seg_p,
				(e["produit"] as Dictionary)["specs"], Marche.annee_de(state), 0.0)["note"])
			meilleur_rival = maxf(meilleur_rival, nr)
		var txt_riv: String = tr(" Meilleur rival du segment : %d %% — vous êtes %s.") \
			% [int(roundf(meilleur_rival * 100.0)),
			tr("devant") if note >= meilleur_rival else tr("derrière")] if meilleur_rival >= 0.0 \
			else tr(" Aucun rival sur ce segment.")
		badge.tooltip_text = tr("Conception à %d %% des attentes techniques du segment cette année (hors réputation, qui juge votre MAISON et non l'avion). Le critère le plus en retard : %s (%d %%).") \
			% [int(roundf(note * 100.0)), Criteres.nom(str(diag["faible_nom"])), int(roundf(float(diag["faible_ratio"]) * 100.0))] \
			+ txt_riv + tr(" Attention : cette note se compare à l'ÉPOQUE, vos ventes se comparent aux RIVAUX — un modèle dépassé continue de bien se vendre tant que la concurrence l'est autant.")
		_boite_gamme.add_child(badge)
		# Prix + retrait sur leur propre ligne, le détail (livré/part/carnet) sur la
		# suivante : tout sur une seule ligne dépassait la largeur de la colonne, forçant
		# un défilement horizontal qui se réinitialise (donc "saute") à chaque reconstruction.
		var rangee := HBoxContainer.new()
		rangee.add_theme_constant_override("separation", 4)
		var boite_prix := SpinBox.new()
		# min 0 : avec min 1 le pas de 1000 snappe tout prix à 1 + k×1000 ; la sim borne déjà à ≥ 1 F.
		boite_prix.min_value = 0.0
		boite_prix.max_value = 5000000.0
		boite_prix.step = 1000.0
		# Sans largeur minimale, le champ défile sur les 7 chiffres et ne montre plus
		# que la queue à zéros (le prix "196000" affichait "6000", puis "0000").
		boite_prix.custom_minimum_size = Vector2(84.0, 0.0)
		boite_prix.set_value_no_signal(float(produit["prix"]))
		boite_prix.value_changed.connect(func(v: float) -> void: _sur_prix(uid, v))
		rangee.add_child(boite_prix)
		_prix_boxes[uid] = boite_prix
		# Retirer un produit le raye du marché sans retour : deux clics.
		var retirer := Button.new()
		retirer.text = "Retirer"
		retirer.add_theme_color_override("font_color", Palette.ENCRE)
		retirer.tooltip_text = tr("Raye ce modèle de la vente. Le stock au hangar est liquidé discrètement au tarif de l'occasion (½ prix), sans effet sur la réputation.")
		Cartes.armer(retirer, "Confirmer ?", func() -> void: _sur_retirer(uid))
		rangee.add_child(retirer)
		# Bradage colonial : céder le carnet + liquider le hangar, contre de la réputation.
		# Montant calculé par la SIM (Sim.recette_bradage) : le bouton ne peut pas annoncer
		# un chiffre différent de ce qui sera réellement versé.
		var stock_u: float = float((state.get("stock", {}) as Dictionary).get(uid, 0.0))
		if float(produit["carnet"]) > 0.0 or stock_u > 0.0:
			var oc: Dictionary = data["constants"]["occasion"]
			var brader := Button.new()
			brader.text = tr("Brader %s £") % francs(Sim.recette_bradage(state, data, uid))
			brader.add_theme_font_size_override("font_size", 9)
			brader.add_theme_color_override("font_color", Palette.BOIS_MIEL)
			brader.tooltip_text = tr("Cède les %d commande(s) en attente à un opérateur colonial et liquide les %d appareil(s) du hangar, puis retire le modèle. Les commandes NON produites ne rapportent que la moitié de la marge que vous auriez faite (on ne vend pas un avion qui n'existe pas) ; le hangar part à moitié prix. Coûte %d pt de réputation.") \
				% [int(produit["carnet"]), int(stock_u), int(roundf(float(oc["rep_malus"]) * 100.0))]
			Cartes.armer(brader, "Confirmer ?", func() -> void: _sur_brader(uid))
			rangee.add_child(brader)
		_boite_gamme.add_child(rangee)
		var livre: int = _livre_dernier_trim(seg_p, uid)
		# Les appareils sortis en SÉRIE D'ÉTAT ce trimestre comptent aussi : sans eux, un
		# produit qui vient de gagner un concours affichait « livré 0 » (retour joueur).
		var serie: int = int(roundf(float(
			(state["ao"].get("livrees_trim", {}) as Dictionary).get(uid, 0.0))))
		var txt_dpc: String = tr("livré %d · part %d %% · carnet %d") \
			% [livre + serie, int(roundf(part * 100.0)), int(produit["carnet"])]
		if serie > 0:
			txt_dpc += tr(" · dont %d en série d'État") % serie
		var l_dpc := _etiquette(txt_dpc, Palette.BLEU_CYANOTYPE)
		l_dpc.tooltip_text = tr("Livré : unités remises aux clients le dernier trimestre, séries d'État comprises (un concours gagné se construit trimestre par trimestre, en priorité sur l'atelier). Part : %% du segment que vous captez sur le MARCHÉ. Carnet : commandes en attente de production.")
		l_dpc.mouse_filter = Control.MOUSE_FILTER_STOP  # sinon l'autowrap fait ignorer les survols
		_boite_gamme.add_child(l_dpc)
		# Hangar : stock (livré en premier, sans atelier) + commande d'atelier en attente.
		var en_stock: int = int((state.get("stock", {}) as Dictionary).get(uid, 0.0))
		var commande: int = int((state.get("stock_commande", {}) as Dictionary).get(uid, 0.0))
		var rangee_st := HBoxContainer.new()
		rangee_st.add_theme_constant_override("separation", 4)
		var construits: int = int(roundf(float(
			(state.get("stock_produit_trim", {}) as Dictionary).get(uid, 0.0))))
		var txt_st: String = tr("hangar %d · en atelier %d") % [en_stock, commande]
		if construits > 0:
			txt_st += tr(" · %d construits ce trim.") % construits
		elif commande > 0:
			# Une commande qui ne sort pas doit DIRE pourquoi : sans ça, « en atelier 5 »
			# reste affiché trimestre après trimestre sans que rien ne se passe (playtest n°7).
			var pu_st: float = float(produit["specs"]["cout_unitaire"])
			if float(state["tresorerie"]) < pu_st:
				txt_st += tr(" · rien construit : trésorerie < %s £ l'unité") % francs(pu_st)
			else:
				txt_st += tr(" · %s £ l'unité à la construction") % francs(pu_st)
		var l_st := _etiquette(txt_st, Palette.GRIS_ACIER)
		l_st.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		l_st.tooltip_text = tr("Hangar : appareils DÉJÀ construits et payés, en attente d'acheteur. Ils sont livrés IMMÉDIATEMENT dès qu'une commande tombe, SANS consommer la capacité d'atelier du trimestre — vous livrez donc plus que votre palier sur un bon trimestre, et les clients (qui détestent attendre) vous jugent mieux, ce qui améliore votre part de marché. En atelier : commande passée, construite au trimestre suivant sur la capacité RESTANTE et payée à ce moment-là.")
		l_st.mouse_filter = Control.MOUSE_FILTER_STOP
		rangee_st.add_child(l_st)
		var prod := Button.new()
		prod.text = tr("+5 au hangar")
		prod.add_theme_font_size_override("font_size", 9)
		prod.add_theme_color_override("font_color", Palette.ENCRE)
		prod.tooltip_text = tr("Commande 5 appareils supplémentaires pour le hangar — construits sur la capacité d'atelier restante, payés à la construction. Un carnet couvert par du stock se livre instantanément, ce qui améliore vos parts de marché.")
		prod.pressed.connect(func() -> void:
			if not appliquer.is_null() and bool(appliquer.call({"type": "produire_stock", "produit": uid, "nombre": 5.0})):
				rafraichir())
		rangee_st.add_child(prod)
		_boite_gamme.add_child(rangee_st)



func _maj_atelier() -> void:
	for enfant: Node in _boite_atelier.get_children():
		enfant.queue_free()
	var at: Dictionary = state["atelier"]
	var eco: Dictionary = data["constants"]["eco"]
	var palier: int = int(at["palier"])
	var capacite: int = int(Production.capacite(state, data))
	_boite_atelier.add_child(_etiquette(tr("Palier %d — %d appareils/trimestre") \
		% [palier, capacite], Palette.ENCRE))
	# Usine bombardée : dire pourquoi la capacité a fondu, sinon le joueur croit à un bug.
	var degats: float = Bombardements.degats_sem(state)
	if degats > 0.0:
		var l_d := _etiquette(tr("⚠ usine touchée : %d semaines de production perdues") \
			% int(degats), Palette.ROUGE_ALERTE)
		l_d.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_boite_atelier.add_child(l_d)
	# ALLOCATION : quelle part de l'atelier échappe aux séries d'État. C'est LA décision
	# récurrente qui manquait — livrer l'Air Ministry en retard coûte réputation et faveur.
	if not (state["ao"]["contrats"] as Array).is_empty() or float(state.get("alloc_marche", 0.0)) > 0.0:
		var part: float = clampf(float(state.get("alloc_marche", 0.0)), 0.0, 1.0)
		var lib_a := _etiquette(tr("Réservé au marché : %d %% (%d appareils) — le reste aux séries d'État") \
			% [int(roundf(part * 100.0)), int(floorf(float(capacite) * part))], Palette.BOIS_MIEL)
		lib_a.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_boite_atelier.add_child(lib_a)
		var curseur := HSlider.new()
		curseur.min_value = 0.0
		curseur.max_value = 1.0
		curseur.step = 0.05
		curseur.value = part
		curseur.custom_minimum_size = Vector2(0.0, 10.0)
		curseur.tooltip_text = tr("Part de la capacité mise de côté pour vos clients AVANT les séries d'État. À 0 %%, l'État passe d'abord ; au-delà, vous protégez vos parts de marché mais la série prend du retard — et après %d trimestres le client s'impatiente : réputation et faveur du ministère baissent à chaque trimestre de retard.") \
			% int(data["constants"]["ao"]["patience_trim"])
		curseur.value_changed.connect(func(v: float) -> void:
			if not appliquer.is_null():
				appliquer.call({"type": "alloc_marche", "part": v})
				rafraichir())
		_boite_atelier.add_child(curseur)
	# Combien l'atelier a réellement produit le dernier trimestre : la capacité
	# affichée ci-dessus est un plafond théorique, invisible sans ce chiffre réel.
	var livrees: int = _livrees_dernier_trim_toutes()
	# Les séries d'État consomment la MÊME capacité : les exclure du total faisait afficher
	# « 0 / 6 » à un joueur dont l'atelier tournait à plein sur un concours gagné.
	var series_trim: int = 0
	for v: Variant in (state["ao"].get("livrees_trim", {}) as Dictionary).values():
		series_trim += int(roundf(float(v)))
	var hangar_trim: int = 0
	for v2: Variant in (state.get("stock_produit_trim", {}) as Dictionary).values():
		hangar_trim += int(roundf(float(v2)))
	var total_trim: int = livrees + series_trim + hangar_trim
	var txt_prod: String = tr("Produit ce trim. : %d / %d appareils") % [total_trim, capacite]
	if series_trim > 0:
		txt_prod += tr(" · dont %d en série d'État") % series_trim
	if hangar_trim > 0:
		txt_prod += tr(" · dont %d pour le hangar") % hangar_trim
	var l_prod := _etiquette(txt_prod, Palette.VERT_LAMPE if total_trim >= capacite else Palette.BOIS_MIEL)
	l_prod.tooltip_text = tr("Appareils réellement sortis de l'atelier le dernier trimestre, sur la capacité du palier. Les séries d'État (concours gagnés) sont construites EN PRIORITÉ et consomment la même capacité que les ventes du marché.")
	_boite_atelier.add_child(l_prod)
	# La série d'un concours gagné se construit ICI, trimestre par trimestre, en PRIORITÉ
	# sur le marché — invisible avant, le joueur croyait la série « instantanée » (playtest).
	var restant_series: float = 0.0
	for contrat: Dictionary in state["ao"]["contrats"]:
		restant_series += float(contrat["restant"])
	if restant_series > 0.0:
		_boite_atelier.add_child(_etiquette(tr("Série d'État : %d appareils en fabrication — prioritaires sur les créneaux de l'atelier, %d/trim maxi.")
			% [int(restant_series), capacite], Palette.BLEU_CYANOTYPE))
	if float(at["chantier_sem"]) > 0.0:
		_boite_atelier.add_child(_etiquette(tr("Chantier en cours : %d semaines") % int(at["chantier_sem"]), Palette.VERT_LAMPE))
	elif Production.plafond_actif(state):
		# Nationalisations de 1936 acceptées : l'atelier est plafonné À VIE. Le bouton
		# s'affichait quand même et ne faisait rien — le joueur avait l'argent et cliquait
		# dans le vide sans savoir pourquoi (playtest n°7).
		var l_plaf := _etiquette(tr("Agrandissement gelé encore %d semaines — vos halls sont dans le « shadow scheme » accepté en 1936.") 			% int(ceilf(Production.plafond_reste_sem(state))), Palette.ROUGE_ALERTE)
		l_plaf.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l_plaf.tooltip_text = tr("Ce choix d'événement échangeait 800 000 £ et la faveur du ministère contre le gel de votre outil industriel le temps du plan. À son terme, vous redevenez libre d'agrandir.")
		l_plaf.mouse_filter = Control.MOUSE_FILTER_STOP
		_boite_atelier.add_child(l_plaf)
	elif palier < (eco["paliers_atelier"] as Array).size():
		var cout_ag: float = float(eco["cout_palier"][palier])
		var bouton := Button.new()
		bouton.text = tr("Agrandir %s £ · %d sem") \
			% [francs(cout_ag), int(eco["delai_palier_sem"][palier])]
		bouton.add_theme_color_override("font_color", Palette.ENCRE)
		# Un bouton actif qui ne fait rien est pire que pas de bouton : on grise et on dit
		# pourquoi (même principe que « rien construit : trésorerie < … » du hangar).
		bouton.disabled = float(state["tresorerie"]) < cout_ag
		if bouton.disabled:
			bouton.tooltip_text = tr("Trésorerie insuffisante : il manque %s £.") \
				% francs(cout_ag - float(state["tresorerie"]))
		bouton.pressed.connect(_sur_agrandir)
		_boite_atelier.add_child(bouton)
	else:
		_boite_atelier.add_child(_etiquette("Atelier au maximum.", Palette.GRIS_ACIER))


# ponytail: specs rivales toujours « rumeurs » — la révélation (Salon, courses, presse)
# arrive avec les événements, étape 7.
func _maj_rivaux() -> void:
	for enfant: Node in _boite_rivaux.get_children():
		enfant.queue_free()
	var rivaux: Dictionary = state["rivaux"]
	for maison: String in Etat.cles_triees(rivaux):
		var drv: Dictionary = data["rivals"]["maisons"][maison]
		var couleur: Color = Palette.GRIS_ACIER if Etat.cles_triees(rivaux)[0] == maison else Palette.BORDEAUX
		var entete := _etiquette(str(drv["nom"]).to_upper(), couleur)
		entete.add_theme_font_size_override("font_size", 9)
		_boite_rivaux.add_child(entete)
		var rcat: Dictionary = rivaux[maison]["catalogue"]
		for uid: String in Etat.cles_triees(rcat):
			var p: Dictionary = rcat[uid]
			# Avant le Salon du Bourget (événement 1937, choix vitrine) : rumeurs seulement.
			var detail: String = tr("rumeurs")
			if bool(state["revelation"]):
				detail = tr("%d km/h · fiab %d %%") % [int(p["specs"]["vmax_kmh"]),
					int(float(p["specs"]["fiabilite"]) * 100.0)]
			_boite_rivaux.add_child(_etiquette("%s %d — %s £ — %s" \
				% [_nom_segment(str(p["segment"])), int(p["annee"]), francs(float(p["prix"])), detail], Palette.ENCRE))


# --- intentions -------------------------------------------------------------------

func _sur_prix(uid: String, prix: float) -> void:
	if not appliquer.is_null():
		appliquer.call({"type": "prix", "produit": uid, "prix": prix})


func _sur_retirer(uid: String) -> void:
	if not appliquer.is_null() and bool(appliquer.call({"type": "retirer_produit", "produit": uid})):
		rafraichir()


func _sur_brader(uid: String) -> void:
	if not appliquer.is_null() and bool(appliquer.call({"type": "brader_flotte", "produit": uid})):
		rafraichir()


func _sur_agrandir() -> void:
	if appliquer.is_null():
		return
	if bool(appliquer.call({"type": "agrandir_atelier"})):
		_retour.text = ""
		rafraichir()
	else:
		_retour.text = "Agrandissement refusé : trésorerie insuffisante ou chantier en cours."


# --- petits constructeurs ----------------------------------------------------------

# Repli PAR DÉFAUT : un Label sans repli impose sa largeur de texte au conteneur
# parent, ce qui poussait la colonne hors de l'écran (le « débordement récurrent »).
# En repliant d'office, aucun libellé — présent ou futur — ne peut plus déborder ;
# dans un VBox il s'ajuste à la largeur de la colonne, dans un HBox à son mot le plus long.
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


func _nom_segment(nom_seg: String) -> String:
	# Noms courts : la chasse de la police pixel fait déborder les libellés longs.
	match nom_seg:
		"ligne_postale":
			return tr("Postal")
		"transport_civil":
			return tr("Transport")
		"export_militaire":
			return tr("Export")
	return nom_seg.capitalize()


static func francs(valeur: float) -> String:
	var entier: int = int(absf(valeur))
	var texte: String = str(entier)
	var resultat: String = ""
	while texte.length() > 3:
		resultat = " " + texte.substr(texte.length() - 3) + resultat
		texte = texte.substr(0, texte.length() - 3)
	resultat = texte + resultat
	return ("-" + resultat) if valeur < 0.0 else resultat
