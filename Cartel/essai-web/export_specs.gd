# ESSAI WEB — exporte, depuis la VRAIE simulation Godot, un jeu de recettes et ce que
# sim/produit.gd en calcule. Le portage TypeScript relit ce fichier et doit retrouver les
# memes nombres. Les recettes sont generees ICI et seulement ici : les generer des deux
# cotes aurait compare deux generateurs, pas deux simulations.
#
#   ./tools/Godot_v4.7-stable_win64_console.exe --headless --path . -s res://essai-web/export_specs.gd
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Produit := preload("res://sim/produit.gd")
const Recherche := preload("res://sim/recherche.gd")

const SORTIE: String = "res://essai-web/sortie/godot.json"


func _initialize() -> void:
	var data: Dictionary = Etat.charger_data()
	var recettes: Array = _recettes(data)
	var specs: Array = []
	for r: Dictionary in recettes:
		specs.append(Produit.specs(r, data))
	# normaliser AVEC limites de recherche : trois etats d'avancement de la grille.
	var limites: Array = _limites(data)
	var cas_norm: Array = []
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i: int in range(600):
		var r2: Dictionary = _aleatoire(rng, data)
		for li: int in range(limites.size()):
			cas_norm.append({"recette": r2, "limites": li,
				"normalisee": Produit.normaliser(r2, data, limites[li])})
	# LA VITESSE : le meme travail que le TypeScript mesurera — un passage complet sur
	# toutes les recettes, repete.
	var tours: int = 3
	var t0: int = Time.get_ticks_usec()
	for t: int in range(tours):
		for r3: Dictionary in recettes:
			Produit.specs(r3, data)
	var us: float = float(Time.get_ticks_usec() - t0) / float(tours * recettes.size())
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://essai-web/sortie"))
	var f := FileAccess.open(SORTIE, FileAccess.WRITE)
	f.store_string(JSON.stringify({"recettes": recettes, "specs": specs, "limites": limites,
		"normaliser": cas_norm, "us_par_specs": us}, "", false, true))
	f.close()
	print("godot | %d recettes, %d cas de normaliser, %.2f us par appel de specs"
		% [recettes.size(), cas_norm.size(), us])
	quit(0)


# 1. les contextes du test de conception (972), croises avec chaque option une a une ;
# 2. les references de calibration ;
# 3. des recettes aleatoires HORS des plages, avec des options inconnues : les clamps et
#    les replis doivent tomber pareil des deux cotes.
func _recettes(data: Dictionary) -> Array:
	var liste: Array = []
	var variantes: Array = [{}, {"marquage": 1}, {"marquage": 2}, {"forme": "cristaux"},
		{"forme": "gel"}, {"forme": "galets"}, {"agent": "enrobant"}, {"agent": "exaltant"},
		{"cadence": "petits_lots"}, {"cadence": "gros_lots"}]
	for fam: String in Etat.cles_triees(data["precurseurs"]["familles"]):
		for pu: float in [0.40, 0.75, 0.99]:
			for re: float in [0.30, 0.60, 0.95]:
				for co: int in [1, 3, 5]:
					for cp: float in [0.0, 0.35, 0.70]:
						for st: int in [0, 1, 3]:
							for v: Dictionary in variantes:
								var r: Dictionary = {"famille": fam, "purete": pu,
									"rendement": re, "complexite": co, "coupe": cp,
									"stabilisation": st}
								r.merge(v, true)
								liste.append(r)
	for ref: Dictionary in data["calibration"]["references"]:
		liste.append(ref["recette"])
	var rng := RandomNumberGenerator.new()
	rng.seed = 42
	for i: int in range(2000):
		liste.append(_aleatoire(rng, data))
	return liste


func _aleatoire(rng: RandomNumberGenerator, data: Dictionary) -> Dictionary:
	var familles: Array = Etat.cles_triees(data["precurseurs"]["familles"]) + ["inconnue"]
	var formes: Array = Etat.cles_triees(data["conception"]["formes"]["options"]) + ["???"]
	var agents: Array = Etat.cles_triees(data["conception"]["agents"]["options"]) + ["???"]
	var cadences: Array = Etat.cles_triees(data["conception"]["cadences"]["options"]) + ["???"]
	return {
		"famille": familles[rng.randi_range(0, familles.size() - 1)],
		"purete": rng.randf_range(0.0, 1.2),
		"rendement": rng.randf_range(0.0, 1.2),
		"complexite": rng.randf_range(-1.0, 7.0),
		"coupe": rng.randf_range(-0.2, 1.0),
		"stabilisation": rng.randf_range(-1.0, 5.0),
		"marquage": rng.randf_range(-1.0, 4.0),
		"forme": formes[rng.randi_range(0, formes.size() - 1)],
		"agent": agents[rng.randi_range(0, agents.size() - 1)],
		"cadence": cadences[rng.randi_range(0, cadences.size() - 1)],
	}


# Trois etats de la grille : le kit de depart, la moitie des cases, toutes les cases.
func _limites(data: Dictionary) -> Array:
	var ids: Array = Etat.cles_triees(data["procedes"]["noeuds"])
	var sortie: Array = []
	for n: int in [0, floori(ids.size() / 2.0), ids.size()]:
		var e: Dictionary = Sim.nouvelle_partie(1, data)
		for i: int in range(n):
			(e["recherche"]["acquis"] as Dictionary)[str(ids[i])] = 1.0
		sortie.append(Recherche.ouvertures(e, data))
	return sortie
