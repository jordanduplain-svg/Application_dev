# Raison d'être : i18n par le système NATIF de Godot (tr / TranslationServer). Le français est
# la LANGUE SOURCE — les msgid SONT le texte français, donc locale "fr" = identité, zéro risque
# et aucune chaîne à perdre. Une autre langue vit dans narrative/ui_<lang>.json (msgid→msgstr),
# chargée à la volée dans un objet Translation. Les libellés statiques des Control s'auto-
# traduisent ; le code n'a qu'à wrapper les chaînes FORMATÉES (tr("%d km/h") % v) et draw_string.
extends RefCounted

const LANGUES: Array = ["fr", "en"]
const NOMS: Dictionary = {"fr": "Français", "en": "English"}


static func appliquer(langue: String) -> void:
	# Purge d'abord : sans elle, un aller-retour EN→FR dans le même process (le jeu recharge
	# la SCÈNE, pas le process) laisserait la table EN active sous la locale « fr ».
	TranslationServer.clear()
	if langue == "fr" or not LANGUES.has(langue):
		TranslationServer.set_locale("fr")
		return
	var chemin: String = "res://narrative/ui_%s.json" % langue
	if not FileAccess.file_exists(chemin):
		TranslationServer.set_locale("fr")
		return
	var table: Variant = JSON.parse_string(FileAccess.get_file_as_string(chemin))
	if not table is Dictionary:
		TranslationServer.set_locale("fr")
		return
	var trad := Translation.new()
	trad.locale = langue
	for msgid: String in table:
		trad.add_message(msgid, str(table[msgid]))
	# add_translation s'accumule sur les rechargements de scène : même contenu, idempotent.
	# ponytail: pas de dédoublonnage — TranslationServer.clear() effacerait tout.
	TranslationServer.add_translation(trad)
	TranslationServer.set_locale(langue)
