# Raison d'être : LA fabrique des panneaux « carte » — coins arrondis, ombre douce, marges —
# pour que tous les écrans partagent le même langage visuel. Direction « rétro moderne »
# (retour propriétaire) : contenu 1925, habillage contemporain sur fond charbon.
extends RefCounted

const Palette := preload("res://game/ui/palette.gd")


static func style(fond: Color = Palette.PAPIER_CREME, marge: float = 8.0) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = fond
	s.set_corner_radius_all(4)
	s.set_content_margin_all(marge)
	s.shadow_color = Color(Palette.ENCRE, 0.45)
	s.shadow_size = 3
	s.shadow_offset = Vector2(0.0, 1.0)
	return s


static func carte(fond: Color = Palette.PAPIER_CREME, marge: float = 8.0) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", style(fond, marge))
	return p


# Bouton destructif : le premier clic ARME (le libellé devient l'avertissement), le second
# exécute. Se désarme seul après 4 s — un bouton armé pour l'éternité n'est plus une garde,
# c'est un piège (le clic d'après, une heure plus tard, détruit sans rien demander).
# Le tableau à une case sert de boîte mutable : une lambda ne capture pas une locale par référence.
static func armer(bouton: Button, texte_arme: String, action: Callable) -> void:
	var repos: String = bouton.text
	var arme: Array = [false]
	bouton.pressed.connect(func() -> void:
		if bool(arme[0]):
			arme[0] = false
			bouton.text = repos
			action.call()
			return
		arme[0] = true
		bouton.text = texte_arme
		# Minuteur ENFANT du bouton : il meurt avec lui si l'écran se rafraîchit avant
		# l'échéance. Un SceneTreeTimer lui survivrait et rejouerait sur une capture
		# libérée → « Lambda capture at index 0 was freed » dans le terminal.
		var minuteur := Timer.new()
		minuteur.wait_time = 4.0
		minuteur.one_shot = true
		minuteur.timeout.connect(func() -> void:
			if bool(arme[0]):
				arme[0] = false
				bouton.text = repos
			minuteur.queue_free())
		bouton.add_child(minuteur)
		minuteur.start())
