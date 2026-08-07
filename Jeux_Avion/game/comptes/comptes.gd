# Raison d'être : le LIVRE DES COMPTES — chaque livre sterling entré ou sorti, classé par
# poste et par exercice. Le pop-up d'avant ne gardait que 8 trimestres, n'était pas sauvegardé
# et noyait prototypes, atelier et primes de course dans un seul « autres » : impossible de
# répondre à « où est passé mon argent ? » après une faillite (playtest n°7).
# N'écrit jamais dans le state : lecture pure de `state["comptes"]`, alimenté par Comptes.note.
extends Control

const Etat := preload("res://sim/state.gd")
const Comptes := preload("res://sim/comptes.gd")
const Marche := preload("res://sim/market.gd")
const Palette := preload("res://game/ui/palette.gd")
const Cartes := preload("res://game/ui/cartes.gd")
const MarcheEcran := preload("res://game/market_ui/marche.gd")
const Courbe := preload("res://game/ui/courbe.gd")

var state: Dictionary = {}
var data: Dictionary = {}

var _boite: VBoxContainer
var _entete: Label
var _courbe: Control
var _annee_sel: String = ""

# Libellé et famille de chaque poste : sim/ ne connaît pas la langue, l'UI oui.
const LIBELLES: Dictionary = {
	"ventes": "Ventes au marché",
	"contrats": "Concours & commandes d'État",
	"entretien": "Contrats d'entretien",
	"epreuves": "Raids & courses",
	"brevets": "Royalties de brevets",
	"occasion": "Ventes d'occasion",
	"banque": "Banque (emprunt / remboursement)",
	"conseil": "Conseil d'administration",
	"production": "Fabrication des appareils",
	"charges": "Charges fixes (salaires, atelier, frais)",
	"prototypes": "Prototypes & essais en vol",
	"recherche": "Recherche & licences",
	"atelier": "Investissements (atelier, filiale)",
	"equipe": "Indemnités de licenciement",
	"publicite": "Campagnes de presse",
	"evenements": "Événements exceptionnels",
	"impots": "Impôt sur les bénéfices de guerre",
}


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
	var carte := Cartes.carte()
	marge.add_child(carte)
	var defilement := ScrollContainer.new()
	defilement.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	carte.add_child(defilement)
	var colonne := VBoxContainer.new()
	colonne.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	colonne.add_theme_constant_override("separation", 3)
	defilement.add_child(colonne)
	_entete = _etiquette("", Palette.BOIS_MIEL)
	colonne.add_child(_entete)
	# La pente avant les chiffres : voir la trésorerie plonger reste la lecture n°1.
	_courbe = Courbe.new()
	_courbe.custom_minimum_size = Vector2(0.0, 46.0)
	_courbe.points = state["tresorerie_hist"]
	colonne.add_child(_courbe)
	colonne.add_child(HSeparator.new())
	_boite = VBoxContainer.new()
	_boite.add_theme_constant_override("separation", 1)
	colonne.add_child(_boite)
	rafraichir()


func rafraichir() -> void:
	if state.is_empty() or _boite == null:
		return
	_courbe.points = state["tresorerie_hist"]
	_courbe.queue_redraw()
	for enfant: Node in _boite.get_children():
		enfant.queue_free()
	var journal: Dictionary = Comptes.journal(state)
	var annees: Array = Etat.cles_triees(journal)
	_entete.text = tr("LIVRE DES COMPTES — %d exercice(s) · trésorerie %s £") \
		% [annees.size(), MarcheEcran.francs(float(state["tresorerie"]))]
	if annees.is_empty():
		_boite.add_child(_etiquette(tr("Aucun mouvement enregistré — le premier trimestre n'est pas clos."), Palette.GRIS_ACIER))
		return
	# Exercice affiché en détail : le plus récent par défaut, changeable en cliquant une année.
	if _annee_sel == "" or not journal.has(_annee_sel):
		_annee_sel = str(annees[annees.size() - 1])
	_boite.add_child(_ligne_titre(tr("EXERCICE %s — le détail") % _annee_sel))
	var exercice: Dictionary = journal[_annee_sel]
	var t: Dictionary = Comptes.totaux(exercice)
	_bloc_postes(exercice, true, tr("RECETTES"))
	_bloc_postes(exercice, false, tr("DÉPENSES"))
	_boite.add_child(HSeparator.new())
	_ligne(tr("RÉSULTAT DE L'EXERCICE"), float(t["resultat"]),
		Palette.VERT_LAMPE if float(t["resultat"]) >= 0.0 else Palette.ROUGE_ALERTE, true)
	# Le tableau de bord pluriannuel : une ligne par exercice, cliquable.
	_boite.add_child(HSeparator.new())
	_boite.add_child(_ligne_titre(tr("TOUS LES EXERCICES (cliquez une année pour son détail)")))
	for a_v: Variant in annees:
		var a: String = str(a_v)
		var ta: Dictionary = Comptes.totaux(journal[a])
		var bouton := Button.new()
		bouton.alignment = HORIZONTAL_ALIGNMENT_LEFT
		bouton.add_theme_font_size_override("font_size", 9)
		bouton.add_theme_color_override("font_color",
			Palette.LAITON if a == _annee_sel else (Palette.VERT_LAMPE if float(ta["resultat"]) >= 0.0 else Palette.ROUGE_ALERTE))
		bouton.text = tr("%s   recettes %s £   dépenses %s £   résultat %s%s £") % [a,
			MarcheEcran.francs(float(ta["recettes"])), MarcheEcran.francs(absf(float(ta["depenses"]))),
			"+" if float(ta["resultat"]) >= 0.0 else "−", MarcheEcran.francs(absf(float(ta["resultat"])))]
		var capture: String = a
		bouton.pressed.connect(func() -> void:
			_annee_sel = capture
			rafraichir())
		_boite.add_child(bouton)


# Un bloc RECETTES ou DÉPENSES : les postes du signe demandé, triés du plus gros au plus
# petit — c'est le premier poste qui répond à « où est passé l'argent ? ».
func _bloc_postes(exercice: Dictionary, recettes: bool, titre: String) -> void:
	var lignes: Array = []
	for poste: String in Etat.cles_triees(exercice):
		var v: float = float(exercice[poste])
		if (v >= 0.0) == recettes and v != 0.0:
			lignes.append([absf(v), poste, v])
	lignes.sort()
	lignes.reverse()
	_boite.add_child(_ligne_titre(titre))
	if lignes.is_empty():
		_boite.add_child(_etiquette(tr("    aucun mouvement"), Palette.GRIS_ACIER))
		return
	var total: float = 0.0
	for l: Array in lignes:
		total += float(l[2])
		_ligne("    " + tr(str(LIBELLES.get(str(l[1]), str(l[1])))), float(l[2]),
			Palette.VERT_LAMPE if recettes else Palette.ROUGE_ALERTE, false)
	_ligne(tr("    total"), total, Palette.ENCRE, false)


func _ligne(libelle: String, montant: float, couleur: Color, gras: bool) -> void:
	var rangee := HBoxContainer.new()
	rangee.add_theme_constant_override("separation", 6)
	var gauche := _etiquette(libelle, couleur)
	gauche.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rangee.add_child(gauche)
	var droite := _etiquette("%s%s £" % ["+" if montant >= 0.0 else "−",
		MarcheEcran.francs(absf(montant))], couleur)
	droite.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	if gras:
		droite.add_theme_font_size_override("font_size", 10)
		gauche.add_theme_font_size_override("font_size", 10)
	rangee.add_child(droite)
	_boite.add_child(rangee)


func _ligne_titre(texte: String) -> Label:
	var l := _etiquette(texte, Palette.BOIS_MIEL)
	return l


func _etiquette(texte: String, couleur: Color) -> Label:
	var l := Label.new()
	l.text = texte
	l.add_theme_font_size_override("font_size", 9)
	l.add_theme_color_override("font_color", couleur)
	return l
