# Raison d'être : deux jauges (civile, militaire) nourries par les livraisons —
# livrer fiable construit lentement, livrer fragile érode ; records/courses viendront s'y brancher.
extends RefCounted


static func livraisons(state: Dictionary, data: Dictionary, domaine: String, livrees: float, fiab: float) -> void:
	var rep: Dictionary = state["rep"]
	rep[domaine] = _maj(float(rep[domaine]), data, livrees, fiab)


static func livraisons_rival(riv: Dictionary, data: Dictionary, domaine: String, livrees: float, fiab: float) -> void:
	var rep: Dictionary = riv["rep"]
	rep[domaine] = _maj(float(rep[domaine]), data, livrees, fiab)


# Coup de réputation ponctuel (victoire d'AO ; records/courses s'y brancheront).
static func bonus(rep: Dictionary, domaine: String, delta: float) -> void:
	rep[domaine] = clampf(float(rep[domaine]) + delta, 0.0, 1.0)


static func _maj(valeur: float, data: Dictionary, livrees: float, fiab: float) -> float:
	if livrees <= 0.0:
		return valeur
	var cr: Dictionary = data["constants"]["repu"]
	var delta: float = clampf(
		(fiab - float(cr["pivot_fiab"])) * float(cr["par_livraison"]) * livrees,
		-float(cr["delta_max"]), float(cr["delta_max"]))
	return clampf(valeur + delta, 0.0, 1.0)
