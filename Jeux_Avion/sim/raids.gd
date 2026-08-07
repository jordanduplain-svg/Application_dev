# Raison d'être : le glamour 1927-1938 — raids (autonomie + fiabilité + culot du pilote,
# météo seedée ; l'avion et le pilote peuvent y rester) et courses (duel public de Vmax).
# Les 2 pilotes nommés vivent ici : recrutables, mortels, célèbres. Chaque dénouement
# pousse une une de presse ; la réputation est le vrai prix.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Rng := preload("res://sim/rng.gd")
const Reputation := preload("res://sim/reputation.gd")
const Comptes := preload("res://sim/comptes.gd")


static func _annee(state: Dictionary) -> float:
	return Etat.AN0 + float(state["tick"]) / 52.0


static func ouvertes(state: Dictionary, data: Dictionary) -> Array:
	var annee: float = _annee(state)
	var liste: Array = []
	for id_e: String in Etat.cles_triees(data["raids"]["epreuves"]):
		var e: Dictionary = data["raids"]["epreuves"][id_e]
		if annee >= float(e["des"]) and annee < float(e["fin"]) \
				and not (state["epreuves_faites"] as Array).has(id_e):
			liste.append(id_e)
	return liste


static func pilotes_disponibles(state: Dictionary, data: Dictionary) -> Array:
	var libres: Array = []
	for p: Dictionary in data["raids"]["pilotes"]:
		var deja: bool = false
		for r: Dictionary in state["pilotes"]:
			if str(r["nom"]) == str(p["nom"]):
				deja = true
		if not deja:
			libres.append(p)
	return libres


static func recruter_pilote(state: Dictionary, data: Dictionary, nom: String) -> bool:
	for p: Dictionary in pilotes_disponibles(state, data):
		if str(p["nom"]) == nom:
			(state["pilotes"] as Array).append((p as Dictionary).duplicate(true))
			return true
	return false


static func tenter(state: Dictionary, data: Dictionary, id_e: String, uid_produit: String, indice_pilote: int) -> bool:
	if not ouvertes(state, data).has(id_e):
		return false
	if not (state["catalogue"] as Dictionary).has(uid_produit):
		return false
	var pilotes: Array = state["pilotes"]
	if indice_pilote < 0 or indice_pilote >= pilotes.size():
		return false
	var e: Dictionary = data["raids"]["epreuves"][id_e]
	if str(e["type"]) == "raid":
		_resoudre_raid(state, data, id_e, e, uid_produit, indice_pilote)
	else:
		_resoudre_course(state, data, id_e, e, uid_produit, indice_pilote)
	(state["epreuves_faites"] as Array).append(id_e)
	return true


# Raid de l'événement Atlantique Sud : le meilleur avion (autonomie) et le premier pilote.
static func raid_scripte(state: Dictionary, data: Dictionary, id_e: String) -> void:
	if (state["pilotes"] as Array).size() == 0:
		return
	var meilleur: String = ""
	var autonomie_max: float = -1.0
	for uid: String in Etat.cles_triees(state["catalogue"]):
		var a: float = float(state["catalogue"][uid]["specs"]["autonomie_km"])
		if a > autonomie_max:
			autonomie_max = a
			meilleur = uid
	if meilleur == "":
		return
	var e: Dictionary = data["raids"]["epreuves"][id_e]
	_resoudre_raid(state, data, id_e, e, meilleur, 0)
	if not (state["epreuves_faites"] as Array).has(id_e):
		(state["epreuves_faites"] as Array).append(id_e)


# Les courses non courues se disputent entre rivaux à la clôture — le monde vit sans vous.
static func tick_hebdo(state: Dictionary, data: Dictionary) -> void:
	var annee: float = _annee(state)
	for id_e: String in Etat.cles_triees(data["raids"]["epreuves"]):
		var e: Dictionary = data["raids"]["epreuves"][id_e]
		if str(e["type"]) != "course" or (state["epreuves_faites"] as Array).has(id_e):
			continue
		if annee >= float(e["fin"]):
			var vainqueur: String = _meilleur_rival(state, data)
			if vainqueur != "":
				# Gain modeste : une victoire par forfait ne vaut pas un duel public gagné.
				Reputation.bonus(state["rivaux"][vainqueur]["rep"], "militaire",
					float(e["repu_militaire"]) * float(data["raids"]["constantes"]["repu_forfait_mult"]))
				(state["presse"] as Array).append({"titre": str(e["nom"]),
					"corps": "Victoire de %s. Vos couleurs étaient absentes du départ." % str(data["rivals"]["maisons"][vainqueur]["nom"])})
			(state["epreuves_faites"] as Array).append(id_e)


# --- résolutions ------------------------------------------------------------------

static func _resoudre_raid(state: Dictionary, data: Dictionary, id_e: String, e: Dictionary, uid: String, ip: int) -> void:
	var c: Dictionary = data["raids"]["constantes"]
	var specs: Dictionary = state["catalogue"][uid]["specs"]
	var pilote: Dictionary = state["pilotes"][ip]
	var ratio: float = float(specs["autonomie_km"]) / float(e["distance_km"])
	var f_aut: float = clampf((ratio - 0.8) / 0.4, 0.0, 1.0)
	var p: float = clampf(f_aut * (float(c["base_reussite"]) + float(c["k_fiabilite"]) * float(specs["fiabilite"])
		+ float(c["k_culot"]) * float(pilote["culot"])), 0.0, 0.95)
	var succes: bool = Rng.reel(state) < p
	var ampli: float = 1.0 + float(pilote["celebrite"]) * float(c["repu_par_celebrite"])
	if succes:
		state["tresorerie"] = float(state["tresorerie"]) + float(e["prime"])
		Comptes.note(state, "epreuves", float(e["prime"]))
		state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) + float(e["prime"])
		Reputation.bonus(state["rep"], "civile", float(e["repu_civile"]) * ampli)
		Reputation.bonus(state["rep"], "militaire", float(e["repu_militaire"]) * ampli)
		pilote["celebrite"] = clampf(float(pilote["celebrite"]) + float(c["celebrite_gain"]), 0.0, 1.0)
		(state["presse"] as Array).append({"titre": "%s — VICTOIRE" % str(e["nom"]),
			"corps": "%s a réussi. La maison entre dans la légende ; les carnets de commandes s'en souviendront." % str(pilote["nom"])})
	else:
		# ponytail: pas de perte du produit marché — le risque du raid est le pilote et
		# la réputation, pas la ligne de vente (erase(uid) rayait aussi le carnet déjà
		# rempli sur ce modèle ; retour playtest n°4, jugé trop punitif).
		var perdu: bool = Rng.reel(state) < float(c["proba_pilote_perdu"])
		var corps: String = "L'appareil est perdu en mer. %s a été récupéré par un cargo." % str(pilote["nom"])
		if perdu:
			corps = "L'appareil et %s ont disparu. Le pays porte le deuil d'un brave." % str(pilote["nom"])
			(state["memorial"] as Array).append(str(pilote["nom"]))
			(state["pilotes"] as Array).remove_at(ip)
			Reputation.bonus(state["rep"], "civile", float(c["repu_deuil"]))
		(state["presse"] as Array).append({"titre": "%s — DISPARU" % str(e["nom"]), "corps": corps})
	(state["palmares"] as Array).append({"epreuve": str(e["nom"]), "annee": snappedf(_annee(state), 0.01),
		"succes": succes, "pilote": str(pilote["nom"])})


static func _resoudre_course(state: Dictionary, data: Dictionary, id_e: String, e: Dictionary, uid: String, ip: int) -> void:
	var c: Dictionary = data["raids"]["constantes"]
	var specs: Dictionary = state["catalogue"][uid]["specs"]
	var pilote: Dictionary = state["pilotes"][ip]
	var k: float = float(c["k_course_fiab"])
	var score: float = float(specs["vmax_kmh"]) * (1.0 - k + k * float(specs["fiabilite"]))
	var rival: String = _meilleur_rival(state, data)
	var score_rival: float = 0.0
	if rival != "":
		score_rival = _score_rival(state, data, rival) * float(c["bonus_racer_rival"])
	var succes: bool = score > score_rival
	if succes:
		state["tresorerie"] = float(state["tresorerie"]) + float(e["prime"])
		Comptes.note(state, "epreuves", float(e["prime"]))
		state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) + float(e["prime"])
		var ampli: float = 1.0 + float(pilote["celebrite"]) * float(c["repu_par_celebrite"])
		Reputation.bonus(state["rep"], "civile", float(e["repu_civile"]) * ampli)
		Reputation.bonus(state["rep"], "militaire", float(e["repu_militaire"]) * ampli)
		pilote["celebrite"] = clampf(float(pilote["celebrite"]) + float(c["celebrite_gain"]), 0.0, 1.0)
		(state["presse"] as Array).append({"titre": "%s — VICTOIRE" % str(e["nom"]),
			"corps": "%s l'emporte à %d km/h de moyenne. Le chronomètre ne ment pas." % [str(pilote["nom"]), int(score)]})
	else:
		Reputation.bonus(state["rivaux"][rival]["rep"], "militaire",
			float(e["repu_militaire"]) * float(c["repu_duel_rival_mult"]))
		(state["presse"] as Array).append({"titre": str(e["nom"]),
			"corps": "%s l'emporte. Votre racer termine derrière — la presse est cruelle." % str(data["rivals"]["maisons"][rival]["nom"])})
	(state["palmares"] as Array).append({"epreuve": str(e["nom"]), "annee": snappedf(_annee(state), 0.01),
		"succes": succes, "pilote": str(pilote["nom"])})


static func _meilleur_rival(state: Dictionary, data: Dictionary) -> String:
	var meilleur: String = ""
	var score_max: float = -1.0
	for maison: String in Etat.cles_triees(state["rivaux"]):
		var s: float = _score_rival(state, data, maison)
		if s > score_max:
			score_max = s
			meilleur = maison
	return meilleur


static func _score_rival(state: Dictionary, data: Dictionary, maison: String) -> float:
	var k: float = float(data["raids"]["constantes"]["k_course_fiab"])
	var rcat: Dictionary = state["rivaux"][maison]["catalogue"]
	var score_max: float = 0.0
	for uid: String in Etat.cles_triees(rcat):
		var sp: Dictionary = rcat[uid]["specs"]
		score_max = maxf(score_max, float(sp["vmax_kmh"]) * (1.0 - k + k * float(sp["fiabilite"])))
	return score_max
