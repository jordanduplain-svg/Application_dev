# VALIDATION DU PORTAGE — exporte, depuis la VRAIE simulation Godot, des campagnes completes
# semaine par semaine (chaque bot, trois graines). src/tests/valider_portage.ts les rejoue en
# TypeScript et dit a quelle semaine, et sur quelle grandeur, les deux divergent.
#
#   ./tools/Godot_v4.7-stable_win64_console.exe --headless --path . -s res://essai-web/export_campagnes.gd
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Bots := preload("res://tests/bots.gd")

const SORTIE: String = "res://essai-web/sortie/campagnes.json"
const GRAINES: Array = [1, 7, 13]


func _initialize() -> void:
	var data: Dictionary = Etat.charger_data()
	var campagnes: Array = []
	for nom: String in Etat.cles_triees(Bots.strategies()):
		var strat: Dictionary = Bots.strategies()[nom]
		for g: int in GRAINES:
			var s: Dictionary = Sim.nouvelle_partie(g, data)
			var semaines: Array = []
			var max_sem: int = int(data["constants"]["sim"]["semaines_max"])
			for t: int in range(max_sem + 1):
				if str(s["fin"]) != "":
					break
				Bots.agir(s, data, strat)
				Sim.tick(s, data)
				semaines.append(_releve(s))
			campagnes.append({"bot": nom, "graine": g, "semaines": semaines,
				"final": JSON.parse_string(Etat.serialiser(s))})
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://essai-web/sortie"))
	var f := FileAccess.open(SORTIE, FileAccess.WRITE)
	f.store_string(JSON.stringify({"campagnes": campagnes}, "", false, true))
	f.close()
	print("godot | %d campagnes exportees" % campagnes.size())
	quit(0)


# Ce qu'on compare chaque semaine : les deux bourses, la jauge, le stock, la dette, la
# production, le flux aleatoire, la recherche (cases et savoir-faire) et les parts du joueur.
func _releve(s: Dictionary) -> Dictionary:
	var parts: Dictionary = {}
	for seg: String in Etat.cles_triees(s["marche"]):
		parts[seg] = float((s["marche"][seg]["parts"] as Dictionary).get("joueur", 0.0))
	return {
		"tick": float(s["tick"]), "fin": str(s["fin"]),
		"cash_propre": float(s["cash_propre"]), "cash_sale": float(s["cash_sale"]),
		"visibilite": float(s["visibilite"]), "stock_kg": float(s["stock_kg"]),
		"dette": float(s["dette"]), "part_capacite": float(s["part_capacite"]),
		"rng": float(s["rng"]), "acquis": Etat.cles_triees(s["recherche"]["acquis"]),
		"savoir": (s["recherche"]["savoir"] as Dictionary).duplicate(), "parts": parts,
	}
