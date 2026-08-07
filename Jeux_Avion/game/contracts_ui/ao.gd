# Raison d'être : l'écran des appels d'offres — le bulletin du ministère : programmes datés
# avec cahier des charges chiffré, candidature d'un produit du catalogue avec note estimée
# en direct, palmarès des concours résolus (chaque défaite est explicable), séries en cours.
# N'écrit jamais dans le state : intentions via le Callable `appliquer` injecté par main.
extends Control

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Conseil := preload("res://sim/conseil.gd")
const Contrats := preload("res://sim/contracts.gd")
const Production := preload("res://sim/production.gd")
const Raids := preload("res://sim/raids.gd")
const Marche := preload("res://sim/market.gd")
const Palette := preload("res://game/ui/palette.gd")
const Cartes := preload("res://game/ui/cartes.gd")
const MarcheEcran := preload("res://game/market_ui/marche.gd")

var appliquer: Callable = Callable()  # func(intention: Dictionary) -> bool, injecté par main
var state: Dictionary = {}
var data: Dictionary = {}

var _boite_programmes: VBoxContainer
var _boite_series: VBoxContainer
var _boite_epreuves: VBoxContainer
var _boite_conseil: VBoxContainer
var _ministere: Label
var _choix_produits: Dictionary = {}  # id_ao -> OptionButton (exposé pour le smoke test)


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
	var defilement := ScrollContainer.new()
	defilement.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	# Vertical uniquement : le repli des libellés fait tenir la largeur, un défilement
	# horizontal cacherait du texte hors cadre (cf. marche.gd).
	defilement.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	rangee.add_child(defilement)
	_boite_programmes = VBoxContainer.new()
	_boite_programmes.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_boite_programmes.add_theme_constant_override("separation", 6)
	defilement.add_child(_boite_programmes)
	var carte_droite := Cartes.carte()
	carte_droite.custom_minimum_size = Vector2(190.0, 0.0)
	rangee.add_child(carte_droite)
	var defilement_droite := ScrollContainer.new()
	defilement_droite.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	carte_droite.add_child(defilement_droite)
	var droite := VBoxContainer.new()
	droite.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	droite.add_theme_constant_override("separation", 2)
	defilement_droite.add_child(droite)
	droite.add_child(_titre("AIR MINISTRY"))
	_ministere = _etiquette("", Palette.ENCRE)
	_ministere.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	droite.add_child(_ministere)
	droite.add_child(_titre("LE CONSEIL"))
	_boite_conseil = VBoxContainer.new()
	_boite_conseil.add_theme_constant_override("separation", 1)
	droite.add_child(_boite_conseil)
	droite.add_child(_titre("SÉRIES EN COURS"))
	_boite_series = VBoxContainer.new()
	_boite_series.add_theme_constant_override("separation", 1)
	droite.add_child(_boite_series)
	var note := _etiquette("La série militaire passe avant le marché à l'atelier.", Palette.GRIS_ACIER)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	droite.add_child(note)
	droite.add_child(_titre("RAIDS & COURSES"))
	_boite_epreuves = VBoxContainer.new()
	_boite_epreuves.add_theme_constant_override("separation", 1)
	droite.add_child(_boite_epreuves)
	rafraichir()


# ponytail: reconstruction des lignes à chaque rafraîchissement trimestriel — pooling
# seulement si le profiler le réclame (passe perf, étape 9).
func rafraichir() -> void:
	if state.is_empty() or _boite_programmes == null:
		return
	for enfant: Node in _boite_programmes.get_children():
		enfant.queue_free()
	_choix_produits.clear()
	var annee: float = Marche.annee_de(state)
	var programmes: Dictionary = data["contracts"]["programmes"]
	for id_ao: String in Etat.cles_triees(programmes):
		_boite_programmes.add_child(_bloc_programme(id_ao, programmes[id_ao], annee))
	_maj_series()
	_maj_epreuves()
	_maj_ministere()
	_maj_conseil()


# Le mandat en cours du conseil d'administration, avec sa progression mesurée.
func _maj_conseil() -> void:
	for enfant: Node in _boite_conseil.get_children():
		enfant.queue_free()
	var mandat: Dictionary = Conseil.actif(state, data)
	if mandat.is_empty():
		_boite_conseil.add_child(_etiquette(tr("Aucun mandat en cours — les actionnaires observent."), Palette.GRIS_ACIER))
	else:
		var fait: float = Conseil.progression(state, mandat)
		var cible: float = Conseil.cible(state, data, mandat)
		_boite_conseil.add_child(_etiquette(tr("Mandat : %s — échéance %d.") \
			% [str(mandat["titre"]), int(mandat["fin"])], Palette.ENCRE))
		_boite_conseil.add_child(_etiquette(tr("Progression : %d / %d · tenu = %s £, manqué = dividende forcé.") \
			% [int(fait), int(cible), MarcheEcran.francs(float(mandat["bonus"]))],
			Palette.VERT_LAMPE if fait >= cible else Palette.BOIS_MIEL))
	# Offres de production sous licence (guerre) : le cash sans la gloire.
	for offre: Dictionary in Sim.sous_licences_ouvertes(state, data):
		var rangee := HBoxContainer.new()
		rangee.add_theme_constant_override("separation", 4)
		var fiche := _etiquette(tr("%s — %d appareils × %s £ (réputation : aucune).") \
			% [str(offre["nom"]), int(offre["volume"]), MarcheEcran.francs(float(offre["fee"]))], Palette.BLEU_CYANOTYPE)
		fiche.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rangee.add_child(fiche)
		var bouton := Button.new()
		bouton.text = "Accepter"
		bouton.add_theme_font_size_override("font_size", 9)
		bouton.add_theme_color_override("font_color", Palette.ENCRE)
		var id_o: String = str(offre["id"])
		Cartes.armer(bouton, "Confirmer ?", func() -> void:
			if not appliquer.is_null() and bool(appliquer.call({"type": "accepter_sous_licence", "id": id_o})):
				rafraichir())
		rangee.add_child(bouton)
		_boite_conseil.add_child(rangee)


# La relation avec Whitehall : elle pondère la note des Spécifications (pas les clients
# civils) et, au-dessus du seuil de faveur, bonifie l'acompte des victoires.
func _maj_ministere() -> void:
	var jauge: float = float(state.get("ministere", 0.5))
	var cao: Dictionary = data["constants"]["ao"]
	var humeur: String = tr("vous êtes en froid")
	if jauge >= float(cao["seuil_faveur"]):
		humeur = tr("vous êtes en faveur (acompte +%d %%)") % int(float(cao["acompte_bonus"]) * 100.0)
	elif jauge >= 0.4:
		humeur = tr("relation correcte")
	_ministere.text = tr("Relation : %d %% — %s.") % [int(roundf(jauge * 100.0)), humeur]
	_ministere.add_theme_color_override("font_color",
		Palette.VERT_LAMPE if jauge >= float(cao["seuil_faveur"])
		else (Palette.ENCRE if jauge >= 0.4 else Palette.ROUGE_ALERTE))


func _bloc_programme(id_ao: String, ao: Dictionary, annee: float) -> Control:
	var carte := Cartes.carte(Palette.PAPIER_CREME, 7.0)
	var boite := VBoxContainer.new()
	boite.add_theme_constant_override("separation", 1)
	carte.add_child(boite)
	var resolutions: Dictionary = state["ao"]["resolutions"]
	var entete := _etiquette(str(ao["nom"]).to_upper(), Palette.BOIS_MIEL)
	entete.add_theme_font_size_override("font_size", 9)
	boite.add_child(entete)

	if resolutions.has(id_ao):
		_remplir_resolution(boite, resolutions[id_ao], ao, id_ao)
		return carte
	if annee < float(ao["ouverture"]):
		boite.add_child(_etiquette(tr("À venir — ouverture %d.") % int(ao["ouverture"]), Palette.GRIS_ACIER))
		return carte

	# Programme ouvert : conditions, cahier des charges, candidature.
	var cao: Dictionary = data["constants"]["ao"]
	var l_ouvert := _etiquette(tr("OUVERT — clôture %.1f · %d appareils × %s £ · acompte %d %%")
		% [float(ao["cloture"]), int(ao["volume"]), MarcheEcran.francs(float(ao["prix_unitaire"])),
		int(float(cao["acompte_part"]) * 100.0)], Palette.VERT_LAMPE)
	l_ouvert.tooltip_text = tr("Le vainqueur reçoit un acompte à la clôture, puis livre la série trimestre par trimestre EN PRIORITÉ sur l'atelier. Le prix par appareil est FIXE — un coût de production trop élevé rend la victoire ruineuse.")
	l_ouvert.mouse_filter = Control.MOUSE_FILTER_STOP
	boite.add_child(l_ouvert)
	for crit: Dictionary in ao["criteres"]:
		var l_crit := _etiquette(tr("    %s ×%.2f — réf %s%s") % [str(crit["nom"]), float(crit["poids"]),
			_format_ref(crit), tr(" (moins = mieux)") if bool(crit["inverse"]) else ""], Palette.ENCRE)
		l_crit.tooltip_text = tr("Poids de ce critère dans la note finale. Votre score sur ce point = votre valeur / la référence (inversé si « moins = mieux »), plafonné, puis multiplié par le poids.")
		l_crit.mouse_filter = Control.MOUSE_FILTER_STOP
		boite.add_child(l_crit)

	var cat: Dictionary = state["catalogue"]
	if cat.is_empty():
		boite.add_child(_etiquette("Aucun produit au catalogue à présenter.", Palette.GRIS_ACIER))
		return carte
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 4)
	var choix := OptionButton.new()
	choix.add_theme_font_size_override("font_size", 9)
	var uids: Array = []
	var designs: Dictionary = state["designs"]
	for uid: String in Etat.cles_triees(cat):
		var nom: String = uid
		if designs.has(str(cat[uid]["design_uid"])):
			nom = str(designs[str(cat[uid]["design_uid"])]["design"]["nom"])
		uids.append(uid)
		choix.add_item(nom)
	choix.set_meta("ids", uids)
	rangee.add_child(choix)
	var note := _etiquette("", Palette.BLEU_CYANOTYPE)
	note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	note.tooltip_text = tr("Estimation live selon les critères ci-dessus, pondérée par votre réputation du domaine. Le meilleur score au-dessus du seuil l'emporte — les rivaux candidatent aussi avec leur propre matériel.")
	note.mouse_filter = Control.MOUSE_FILTER_STOP
	# ÉCONOMIE du contrat : le prix unitaire est FIXE. Gagner avec un appareil qui coûte plus
	# cher que ce prix ruine en livrant — les bots ont une « discipline de coût » qui les en
	# empêche, le joueur n'avait AUCUN avertissement (vécu : B.9/32 gagné avec un bombardier
	# à 316 k£ pour un programme à 270 k£ → −46 k£ par appareil, trésorerie dans le rouge).
	var eco := _etiquette("", Palette.GRIS_ACIER)
	eco.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	eco.mouse_filter = Control.MOUSE_FILTER_STOP
	var maj_note := func() -> void:
		var uid_sel: String = str(uids[clampi(choix.selected, 0, uids.size() - 1)])
		var n: Dictionary = Contrats.note_produit(state, data, id_ao, uid_sel)
		note.text = tr("note estimée %.2f (seuil %.2f)") % [float(n["score"]), float(ao["seuil"])]
		var prix_u: float = float(ao["prix_unitaire"])
		var cout_u: float = float((cat[uid_sel]["specs"] as Dictionary)["cout_unitaire"])
		var marge_u: float = prix_u - cout_u
		var solde_u: float = prix_u * (1.0 - Contrats.part_acompte_de(state, data, id_ao))
		eco.text = tr("Économie : payé %s £/appareil · votre coût %s £ → %s%s £ par appareil (× %d).") \
			% [MarcheEcran.francs(prix_u), MarcheEcran.francs(cout_u),
			"+" if marge_u >= 0.0 else "−", MarcheEcran.francs(absf(marge_u)), int(ao["volume"])]
		if marge_u < 0.0:
			eco.text += tr(" ⚠ À PERTE — chaque livraison vous appauvrit.")
			eco.add_theme_color_override("font_color", Palette.ROUGE_ALERTE)
		elif solde_u < cout_u:
			# PAS un avertissement : le solde par appareil sous le coût est le cas NORMAL
			# d'un acompte de 30 %. Algèbre : acompte − avance cumulée
			# = vol×prix×p − vol×(coût − prix×(1−p)) = vol×(prix − coût) = la marge totale.
			# Autrement dit, dès que le contrat est rentable l'acompte couvre TOUJOURS
			# l'avance de fabrication — l'ancien « ⚠ Trésorerie » ne pouvait qu'affoler à
			# tort (playtest n°7 : « je serais en positif ?!? »). On explique le flux, point.
			var volume: float = float(ao["volume"])
			var acompte: float = prix_u * volume * Contrats.part_acompte_de(state, data, id_ao)
			eco.text += tr(" Acompte %s £ à la signature, puis %s £ encaissés par livraison contre %s £ de fabrication : l'acompte porte la série.") \
				% [MarcheEcran.francs(acompte), MarcheEcran.francs(solde_u), MarcheEcran.francs(cout_u)]
			eco.add_theme_color_override("font_color", Palette.GRIS_ACIER)
		else:
			eco.add_theme_color_override("font_color", Palette.GRIS_ACIER)
		# LE VRAI DANGER, invisible jusqu'ici : une série d'État passe AVANT le marché à
		# l'atelier. Pendant qu'elle sort, les ventes civiles s'arrêtent — et les charges
		# fixes, elles, continuent. Un contrat rentable sur le papier peut donc creuser un
		# trou de trésorerie mortel (playtest n°7 : faillite en 1936, série de 10 appareils
		# qui a confisqué 2 trimestres d'atelier et coupé toutes les ventes marché).
		var cap_t: float = maxf(Production.capacite(state, data), 1.0)
		var trimestres: float = ceilf(float(ao["volume"]) / cap_t)
		eco.text += tr("\nAtelier : %d appareils à %d/trim. = %d trimestre(s) réquisitionné(s) — vos ventes au marché s'arrêtent d'autant, les charges fixes non.") \
			% [int(ao["volume"]), int(cap_t), int(trimestres)]
	choix.item_selected.connect(func(_i: int) -> void: maj_note.call())
	maj_note.call()
	var bouton := Button.new()
	var cand: Dictionary = state["ao"]["candidatures"]
	bouton.text = "Candidater"
	bouton.add_theme_color_override("font_color", Palette.ENCRE)
	bouton.tooltip_text = tr("Dépose ce produit comme candidature — gratuit, remplaçable jusqu'à la clôture. Le vainqueur est déterminé automatiquement à la date de clôture.")
	bouton.pressed.connect(func() -> void:
		_sur_candidater(id_ao, str(uids[clampi(choix.selected, 0, uids.size() - 1)])))
	rangee.add_child(bouton)
	rangee.add_child(note)
	boite.add_child(rangee)
	boite.add_child(eco)
	if cand.has(id_ao):
		var uid_c: String = str(cand[id_ao])
		var nom_c: String = uid_c
		if cat.has(uid_c) and designs.has(str(cat[uid_c]["design_uid"])):
			nom_c = str(designs[str(cat[uid_c]["design_uid"])]["design"]["nom"])
		boite.add_child(_etiquette(tr("Candidature déposée : « %s » (remplaçable jusqu'à la clôture).") % nom_c, Palette.VERT_LAMPE))
	_choix_produits[id_ao] = choix
	return carte


func _remplir_resolution(boite: VBoxContainer, res: Dictionary, ao: Dictionary, id_ao: String) -> void:
	var vainqueur: String = str(res["vainqueur"])
	if vainqueur == "":
		boite.add_child(_etiquette(tr("%d — concours infructueux (aucun candidat au seuil).") % int(res["annee"]), Palette.ROUGE_ALERTE))
	elif vainqueur == "joueur":
		# Le gain de réputation d'une victoire était invisible (demande playtest) ; le VOLUME
		# et l'avancement de la série aussi — « acompte versé » tout court laissait croire que
		# la commande n'était jamais tombée, alors qu'elle se construit à l'atelier en priorité
		# et n'entre PAS dans le carnet du Marché (playtest n°7, vécu sur le B.9/32 à 14/18).
		boite.add_child(_etiquette(tr("Victoire : acompte versé · réputation %s +%d pts.") \
			% [tr(str(ao.get("domaine", "militaire"))),
			int(roundf(float(data["constants"]["ao"]["repu_victoire"]) * 100.0))], Palette.VERT_LAMPE))
		var volume: float = float(ao["volume"])
		var acompte: float = volume * float(ao["prix_unitaire"]) \
			* Contrats.part_acompte_de(state, data, id_ao)
		var restant: float = 0.0
		for contrat: Dictionary in state["ao"]["contrats"]:
			if str(contrat["ao"]) == id_ao:
				restant = float(contrat["restant"])
		var avancement: String = tr("série livrée en totalité")
		if restant > 0.0:
			avancement = tr("%d livrés sur %d — reste %d (voir SÉRIES EN COURS)") \
				% [int(volume - restant), int(volume), int(restant)]
		# La MARGE réalisée : un prix d'AO est FIXE, donc un avion trop cher à fabriquer fait
		# perdre de l'argent à chaque livraison malgré l'acompte — le joueur voyait alors « rien
		# n'est tombé » alors que la série était bien livrée, à perte (playtest n°7 : Imperial
		# Airways, 5 × 210 000 £ avec un A220 à 247 148 £ = −185 740 £ sur le contrat).
		var uid_g: String = ""
		for c: Dictionary in res["candidats"]:
			if str(c["maison"]) == "joueur":
				uid_g = str(c.get("produit", ""))
		var marge_txt: String = ""
		var couleur_s: Color = Palette.BLEU_CYANOTYPE
		if (state["catalogue"] as Dictionary).has(uid_g):
			var cout_u: float = float(state["catalogue"][uid_g]["specs"]["cout_unitaire"])
			var marge_u: float = float(ao["prix_unitaire"]) - cout_u
			marge_txt = tr(" · marge %s%s £/appareil (total %s%s £)") % [
				"+" if marge_u >= 0.0 else "−", MarcheEcran.francs(absf(marge_u)),
				"+" if marge_u >= 0.0 else "−", MarcheEcran.francs(absf(marge_u) * volume)]
			if marge_u < 0.0:
				couleur_s = Palette.ROUGE_ALERTE
		var l_serie := _etiquette(tr("    %d appareils × %s £ · acompte %s £%s · %s") \
			% [int(volume), MarcheEcran.francs(float(ao["prix_unitaire"])),
				MarcheEcran.francs(acompte), marge_txt, avancement], couleur_s)
		l_serie.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l_serie.tooltip_text = tr("La série d'État se construit trimestre par trimestre, EN PRIORITÉ sur la capacité de l'atelier. Elle n'entre pas dans le carnet de commandes du Marché : elle apparaît sur la ligne du produit (« dont N en série d'État ») et dans le total de l'atelier.")
		l_serie.mouse_filter = Control.MOUSE_FILTER_STOP
		boite.add_child(l_serie)
	# Une candidature = deux lignes : identité + note en tête (gros), détail des critères
	# replié en dessous (gris) — l'ancienne ligne unique concaténée était illisible (capture).
	for c: Dictionary in res["candidats"]:
		var gagnant: bool = str(c["maison"]) == vainqueur and vainqueur != ""
		var joueur: bool = str(c["maison"]) == "joueur"
		var couleur: Color = Palette.VERT_LAMPE if gagnant else Palette.ENCRE
		if joueur:
			couleur = Palette.LAITON if gagnant else Palette.ROUGE_ALERTE
		var tete := HBoxContainer.new()
		tete.add_theme_constant_override("separation", 4)
		var nom_l := _etiquette("%s%s" % ["★ " if gagnant else "", str(c["nom"])], couleur)
		nom_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		tete.add_child(nom_l)
		var score_l := _etiquette("%.2f" % float(c["score"]), couleur)
		score_l.autowrap_mode = TextServer.AUTOWRAP_OFF
		tete.add_child(score_l)
		boite.add_child(tete)
		var morceaux: Array = []
		var notes: Dictionary = c["notes"]
		for nom_crit: String in Etat.cles_triees(notes):
			morceaux.append("%s %.2f" % [nom_crit, float(notes[nom_crit])])
		if not morceaux.is_empty():
			# Le score n'est PAS la somme des ratios : deux candidats aux mêmes ratios peuvent
			# être départagés par la notoriété de leur maison. Sans cette ligne, le meilleur
			# dossier perdait sans explication visible (playtest n°7).
			if c.has("dossier"):
				morceaux.append(tr("→ dossier %.2f × marque %.2f") % [float(c["dossier"]), float(c["marque"])])
			var detail := _etiquette("    " + " · ".join(morceaux), Palette.GRIS_ACIER)
			detail.tooltip_text = tr("Note par critère : votre valeur rapportée à l'exigence du cahier des charges, plafonnée à 1.40 — et un critère rempli à moins de la moitié pénalise TOUTE la note. Le score final = dossier technique (les critères pondérés) × facteur de marque (la réputation de la maison dans ce domaine, 0.85 à 1.15). Un inconnu au meilleur avion peut donc perdre contre une maison installée : la réputation se gagne en livrant.")
			detail.mouse_filter = Control.MOUSE_FILTER_STOP
			boite.add_child(detail)


func _maj_series() -> void:
	for enfant: Node in _boite_series.get_children():
		enfant.queue_free()
	var contrats: Array = state["ao"]["contrats"]
	if contrats.is_empty():
		_boite_series.add_child(_etiquette("Aucune série militaire en cours.", Palette.GRIS_ACIER))
		return
	var programmes: Dictionary = data["contracts"]["programmes"]
	for contrat: Dictionary in contrats:
		# Une série peut venir d'un programme OU d'une production sous licence.
		var nom: String = str(contrat["ao"])
		if programmes.has(nom):
			nom = str(programmes[nom]["nom"])
		else:
			for offre: Dictionary in (data["contracts"] as Dictionary).get("sous_licence", []):
				if str(offre["id"]) == nom:
					nom = str(offre["nom"])
		_boite_series.add_child(_etiquette(nom, Palette.ENCRE))
		var l_serie := _etiquette(tr("    %d appareils restants · solde %s £/appareil")
			% [int(contrat["restant"]), MarcheEcran.francs(float(contrat["solde_unitaire"]))], Palette.BLEU_CYANOTYPE)
		l_serie.tooltip_text = tr("Cette série se construit trimestre par trimestre, en PRIORITÉ sur les créneaux d'atelier — visible aussi sur l'écran Marché, section Atelier.")
		l_serie.mouse_filter = Control.MOUSE_FILTER_STOP
		_boite_series.add_child(l_serie)


# Le glamour : pilotes recrutables, épreuves ouvertes, palmarès. La tentative d'un raid
# affiche ses risques via les données mêmes (distance vs autonomie du produit choisi).
func _maj_epreuves() -> void:
	for enfant: Node in _boite_epreuves.get_children():
		enfant.queue_free()
	for p: Dictionary in Raids.pilotes_disponibles(state, data):
		var rangee_p := HBoxContainer.new()
		rangee_p.add_theme_constant_override("separation", 4)
		var fiche_p := _etiquette(tr("%s — culot %d %% · %d £/sem") % [str(p["nom"]),
			int(float(p["culot"]) * 100.0), int(p["salaire_sem"])], Palette.ENCRE)
		fiche_p.tooltip_text = tr("Le culot augmente les chances de succès d'un raid. Un pilote embauché touche un salaire hebdomadaire et risque sa vie à chaque tentative.")
		fiche_p.mouse_filter = Control.MOUSE_FILTER_STOP
		fiche_p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		rangee_p.add_child(fiche_p)
		var bouton_p := Button.new()
		bouton_p.text = "Engager"
		bouton_p.add_theme_color_override("font_color", Palette.ENCRE)
		var nom_p: String = str(p["nom"])
		bouton_p.pressed.connect(func() -> void: _sur_recruter_pilote(nom_p))
		rangee_p.add_child(bouton_p)
		_boite_epreuves.add_child(rangee_p)
	var pilotes: Array = state["pilotes"]
	var cat: Dictionary = state["catalogue"]
	for id_e: String in Raids.ouvertes(state, data):
		var e: Dictionary = data["raids"]["epreuves"][id_e]
		var infos: String = tr("%s — prime %s £") % [str(e["nom"]), MarcheEcran.francs(float(e["prime"]))]
		if str(e["type"]) == "raid":
			infos += tr(" · %d km") % int(e["distance_km"])
		_boite_epreuves.add_child(_etiquette(infos, Palette.BLEU_CYANOTYPE))
		if pilotes.is_empty() or cat.is_empty():
			continue
		var rangee := HBoxContainer.new()
		rangee.add_theme_constant_override("separation", 4)
		var choix_p := OptionButton.new()
		choix_p.add_theme_font_size_override("font_size", 9)
		var uids: Array = []
		var designs: Dictionary = state["designs"]
		for uid: String in Etat.cles_triees(cat):
			uids.append(uid)
			var nom: String = uid
			if designs.has(str(cat[uid]["design_uid"])):
				nom = str(designs[str(cat[uid]["design_uid"])]["design"]["nom"])
			choix_p.add_item("%s (%d km)" % [nom, int(cat[uid]["specs"]["autonomie_km"])])
		rangee.add_child(choix_p)
		var choix_pil := OptionButton.new()
		choix_pil.add_theme_font_size_override("font_size", 9)
		for pil: Dictionary in pilotes:
			choix_pil.add_item(str(pil["nom"]))
		rangee.add_child(choix_pil)
		var bouton := Button.new()
		bouton.text = "Tenter" if str(e["type"]) == "raid" else "Courir"
		bouton.add_theme_color_override("font_color", Palette.ROUGE_ALERTE)
		bouton.tooltip_text = tr("Raid : succès selon l'autonomie de l'appareil, sa fiabilité et le culot du pilote — un échec peut coûter l'avion, voire le pilote. Course : votre vitesse (pondérée par la fiabilité) contre le meilleur rival, sans risque de perte.") \
			if str(e["type"]) == "raid" else tr("Course : votre vitesse (pondérée par la fiabilité) contre le meilleur appareil rival — sans risque de perte de l'appareil ou du pilote.")
		bouton.pressed.connect(func() -> void:
			_sur_tenter(id_e, str(uids[clampi(choix_p.selected, 0, uids.size() - 1)]), choix_pil.selected))
		rangee.add_child(bouton)
		_boite_epreuves.add_child(rangee)
	var palmares: Array = state["palmares"]
	for i: int in range(maxi(0, palmares.size() - 4), palmares.size()):
		var r: Dictionary = palmares[i]
		_boite_epreuves.add_child(_etiquette(tr("%d — %s : %s (%s)") % [int(r["annee"]), str(r["epreuve"]),
			tr("réussi") if bool(r["succes"]) else tr("perdu"), str(r["pilote"])],
			Palette.VERT_LAMPE if bool(r["succes"]) else Palette.ROUGE_ALERTE))


func _sur_recruter_pilote(nom: String) -> void:
	if not appliquer.is_null() and bool(appliquer.call({"type": "recruter_pilote", "nom": nom})):
		rafraichir()


func _sur_tenter(id_e: String, uid: String, pilote: int) -> void:
	if not appliquer.is_null() and bool(appliquer.call({"type": "tenter_epreuve", "epreuve": id_e,
			"produit": uid, "pilote": pilote})):
		rafraichir()


func _sur_candidater(id_ao: String, uid: String) -> void:
	if not appliquer.is_null() and bool(appliquer.call({"type": "candidater_ao", "ao": id_ao, "produit": uid})):
		rafraichir()


func _format_ref(crit: Dictionary) -> String:
	var ref: float = float(crit["ref"])
	match str(crit["spec"]):
		"fiabilite":
			return "%d %%" % int(ref * 100.0)
		"cout_unitaire":
			return MarcheEcran.francs(ref) + " £"
	return str(int(ref))


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
