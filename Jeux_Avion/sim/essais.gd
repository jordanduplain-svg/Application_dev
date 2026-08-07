# Raison d'être : la campagne d'essais en vol — entre la planche à dessin et le catalogue,
# le prototype vole `delai_semaines` et révèle des défauts (tirage SEEDÉ À L'ACTION joueur,
# comme les raids : le flux RNG du marché ne bouge pas, les bots ne prototypent pas).
# Corriger coûte temps et argent ; mettre en service sans corriger tare les specs à vie.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Rng := preload("res://sim/rng.gd")
const Avion := preload("res://sim/aircraft.gd")
const Comptes := preload("res://sim/comptes.gd")


# ponytail: migration à la volée des saves d'avant les essais.
static func tous(state: Dictionary) -> Dictionary:
	if not state.has("essais"):
		state["essais"] = {}
	return state["essais"]


# Paie le prototype et ouvre la campagne : les défauts sont tirés MAINTENANT (seedés),
# mais restent cachés du joueur jusqu'à la fin des vols (l'UI ne les montre pas avant).
static func prototyper(state: Dictionary, data: Dictionary, uid_design: String, remise: float) -> bool:
	if not (state["designs"] as Dictionary).has(uid_design):
		return false
	if tous(state).has(uid_design):
		return false
	var specs: Dictionary = state["designs"][uid_design]["specs"]
	var cout: float = float(specs["cout_proto"]) * (1.0 - remise)
	if float(state["tresorerie"]) < cout:
		return false
	state["tresorerie"] = float(state["tresorerie"]) - cout
	Comptes.note(state, "prototypes", -cout)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout
	tous(state)[uid_design] = {
		"restant": float(specs["delai_semaines"]),
		"defauts": _tirer_defauts(state, data, uid_design),
		"correction": {},
	}
	return true


# Un avion complexe ou surchargé casse plus : la proba suit les équipements et la surcharge.
static func _tirer_defauts(state: Dictionary, data: Dictionary, uid_design: String) -> Array:
	var de: Dictionary = data["essais"]
	var design: Dictionary = state["designs"][uid_design]["design"]
	var specs: Dictionary = state["designs"][uid_design]["specs"]
	var c: Dictionary = data["constants"]["avion"]
	var surcharge: float = maxf(float(specs["charge_alaire"]) - float(c["ca_limite"][str(design["structure"])]), 0.0)
	var n_feats: int = (design.get("features", []) as Array).size()
	var p1: float = clampf(float(de["proba_defaut"]) + float(de["k_features"]) * float(n_feats)
		+ float(de["k_surcharge"]) * surcharge, 0.0, 0.9)
	var ids: Array = Etat.cles_triees(de["defauts"])
	var defauts: Array = []
	if Rng.reel(state) < p1:
		defauts.append({"id": str(ids[int(floorf(Rng.reel(state) * float(ids.size())))]), "corrige": false})
	if Rng.reel(state) < float(de["proba_second"]):
		var id2: String = str(ids[int(floorf(Rng.reel(state) * float(ids.size())))])
		if defauts.is_empty() or str(defauts[0]["id"]) != id2:
			defauts.append({"id": id2, "corrige": false})
	return defauts


static func tick_hebdo(state: Dictionary) -> void:
	var e_tous: Dictionary = tous(state)
	for uid: String in Etat.cles_triees(e_tous):
		var essai: Dictionary = e_tous[uid]
		if float(essai["restant"]) > 0.0:
			essai["restant"] = maxf(float(essai["restant"]) - 1.0, 0.0)
		elif not (essai["correction"] as Dictionary).is_empty():
			var corr: Dictionary = essai["correction"]
			corr["restant"] = float(corr["restant"]) - 1.0
			if float(corr["restant"]) <= 0.0:
				for d: Dictionary in essai["defauts"]:
					if str(d["id"]) == str(corr["id"]):
						d["corrige"] = true
				essai["correction"] = {}


static func corriger(state: Dictionary, data: Dictionary, uid_design: String, id_defaut: String) -> bool:
	var e_tous: Dictionary = tous(state)
	if not e_tous.has(uid_design):
		return false
	var essai: Dictionary = e_tous[uid_design]
	if float(essai["restant"]) > 0.0 or not (essai["correction"] as Dictionary).is_empty():
		return false
	var vise: Dictionary = {}
	for d: Dictionary in essai["defauts"]:
		if str(d["id"]) == id_defaut and not bool(d["corrige"]):
			vise = d
	if vise.is_empty():
		return false
	var fiche: Dictionary = data["essais"]["defauts"][id_defaut]
	if float(state["tresorerie"]) < float(fiche["cout"]):
		return false
	state["tresorerie"] = float(state["tresorerie"]) - float(fiche["cout"])
	Comptes.note(state, "prototypes", -float(fiche["cout"]))
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - float(fiche["cout"])
	essai["correction"] = {"id": id_defaut, "restant": float(fiche["sem"])}
	return true


static func abandonner(state: Dictionary, uid_design: String) -> bool:
	return tous(state).erase(uid_design)


# Specs de service : celles du papier, tarées par chaque défaut non corrigé.
static func specs_de_service(state: Dictionary, data: Dictionary, uid_design: String) -> Dictionary:
	var specs: Dictionary = (state["designs"][uid_design]["specs"] as Dictionary).duplicate(true)
	var essai: Dictionary = tous(state)[uid_design]
	var c: Dictionary = data["constants"]["avion"]
	for d: Dictionary in essai["defauts"]:
		if bool(d["corrige"]):
			continue
		var effets: Dictionary = data["essais"]["defauts"][str(d["id"])]["effet"]
		for cle: String in Etat.cles_triees(effets):
			specs[cle] = float(specs[cle]) + float(effets[cle])
	specs["fiabilite"] = clampf(float(specs["fiabilite"]), float(c["fiab_min"]), float(c["fiab_max"]))
	for cle: String in ["vmax_kmh", "maniabilite", "autonomie_km"]:
		specs[cle] = maxf(float(specs[cle]), 0.0)
	return specs


# La campagne est finie et rien n'est en cours de correction : bon pour le service.
static func prete(state: Dictionary, uid_design: String) -> bool:
	var e_tous: Dictionary = tous(state)
	if not e_tous.has(uid_design):
		return false
	var essai: Dictionary = e_tous[uid_design]
	return float(essai["restant"]) <= 0.0 and (essai["correction"] as Dictionary).is_empty()
