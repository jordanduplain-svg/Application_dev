# Raison d'être : traceur de diagnostic pour l'équilibrage — une campagne par stratégie,
# une ligne par an (trésorerie, palier, catalogue, livraisons) pour voir les trajectoires
# au lieu d'itérer à l'aveugle sur les distributions.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Bots := preload("res://tests/bots.gd")

const GRAINE: int = 42


func _initialize() -> void:
	var data: Dictionary = Etat.charger_data()
	var strats: Dictionary = Bots.strategies()
	for nom: String in Etat.cles_triees(strats):
		print("\n=== %s (graine %d) ===" % [nom, GRAINE])
		_tracer(data, strats[nom])
	quit(0)


func _tracer(data: Dictionary, strat: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(GRAINE, data)
	var livraisons_prec: float = 0.0
	for t: int in range(1250):
		Bots.agir(state, data, strat)
		Sim.tick(state, data)
		var annee_t: float = Etat.AN0 + float(state["tick"]) / 52.0
		var fenetre: bool = annee_t >= 1930.0 and annee_t <= 1932.5 and int(state["tick"]) % 13 == 0
		if int(state["tick"]) % 52 == 0 or fenetre or str(state["fin"]) != "":
			var livr: float = float(state["stats"]["livraisons"])
			var cat: Dictionary = state["catalogue"]
			var desc: Array = []
			for uid: String in Etat.cles_triees(cat):
				desc.append("%s(%s)" % [str(cat[uid]["segment"]).substr(0, 4), uid])
			print("%d | treso %8.0f kF | palier %d | livr/an %3.0f | rep %.2f/%.2f | %s"
				% [int(Etat.AN0) + floori(float(state["tick"]) / 52.0), float(state["tresorerie"]) / 1000.0,
				int(state["atelier"]["palier"]), livr - livraisons_prec,
				float(state["rep"]["civile"]), float(state["rep"]["militaire"]),
				" ".join(desc)])
			livraisons_prec = livr
		if str(state["fin"]) != "":
			print("FIN : " + str(state["fin"]))
			return
