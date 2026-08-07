# Raison d'être : l'écran de mai 1945 (ou de la faillite) — verdict en lettres capitales,
# fragments d'épilogue qui racontent VINGT-TROIS ANS (trajectoire, rivaux, pilotes), graine
# affichée, « Rejouer ce destin » (même graine) ou repartir sur un destin neuf.
extends Control

const Fin := preload("res://sim/end.gd")
const Palette := preload("res://game/ui/palette.gd")

var rejouer: Callable = Callable()  # func(graine: int) -> void, injecté par main

var _titre: Label
var _texte: Label
var _score: Label
var _boite: VBoxContainer
var _graine: int = 0


func _ready() -> void:
	var th := Theme.new()
	th.default_font_size = 9
	theme = th
	visible = false
	var fond := StyleBoxFlat.new()
	fond.bg_color = Palette.ENCRE
	var panneau := Panel.new()
	panneau.set_anchors_preset(Control.PRESET_FULL_RECT)
	panneau.add_theme_stylebox_override("panel", fond)
	add_child(panneau)
	var colonne := VBoxContainer.new()
	colonne.set_anchors_preset(Control.PRESET_FULL_RECT)
	colonne.add_theme_constant_override("separation", 4)
	add_child(colonne)
	var marge := Control.new()
	marge.custom_minimum_size = Vector2(0.0, 4.0)
	colonne.add_child(marge)
	_titre = Label.new()
	_titre.add_theme_font_size_override("font_size", 16)
	_titre.add_theme_color_override("font_color", Palette.LAITON)
	_titre.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	colonne.add_child(_titre)
	_texte = Label.new()
	_texte.add_theme_font_size_override("font_size", 9)
	_texte.add_theme_color_override("font_color", Palette.PAPIER_CREME)
	_texte.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_texte.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	colonne.add_child(_texte)
	_score = Label.new()
	_score.add_theme_font_size_override("font_size", 9)
	_score.add_theme_color_override("font_color", Palette.GRIS_ACIER)
	_score.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	colonne.add_child(_score)
	var defilement := ScrollContainer.new()
	defilement.size_flags_vertical = Control.SIZE_EXPAND_FILL
	colonne.add_child(defilement)
	_boite = VBoxContainer.new()
	_boite.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_boite.add_theme_constant_override("separation", 3)
	defilement.add_child(_boite)
	var rangee := HBoxContainer.new()
	rangee.alignment = BoxContainer.ALIGNMENT_CENTER
	rangee.add_theme_constant_override("separation", 8)
	colonne.add_child(rangee)
	for paire: Array in [["Rejouer ce destin", true], ["Nouveau destin", false]]:
		var bouton := Button.new()
		bouton.text = str(paire[0])
		var meme_graine: bool = bool(paire[1])
		bouton.pressed.connect(func() -> void: _sur_rejouer(meme_graine))
		rangee.add_child(bouton)


func afficher(state: Dictionary, data: Dictionary) -> void:
	_graine = int(state["graine"])
	var bilan: Dictionary = Fin.bilan(state, data)
	_titre.text = str(bilan["titre"])
	_texte.text = str(bilan["texte"])
	_score.text = tr("Note %d / 100 — graine %d") % [int(roundf(float(bilan["score"]) * 100.0)), _graine]
	for enfant: Node in _boite.get_children():
		enfant.queue_free()
	for f: Array in bilan["fragments"]:
		var l := Label.new()
		l.text = "— " + str(f[1])
		l.add_theme_font_size_override("font_size", 9)
		l.add_theme_color_override("font_color", Palette.PAPIER_CREME)
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_boite.add_child(l)
	visible = true


func _sur_rejouer(meme_graine: bool) -> void:
	if rejouer.is_null():
		return
	var graine: int = _graine if meme_graine \
		else int(Time.get_unix_time_from_system()) & 0xFFFFFFFF
	rejouer.call(graine)
