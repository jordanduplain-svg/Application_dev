# Raison d'être : le conseil d'administration — des mandats datés (livraisons, trésorerie,
# victoire de concours) qui mettent l'entreprise sous échéance même quand elle est riche.
# Tenu : rallonge de capital. Manqué : dividende forcé + réputation écornée. Déterministe,
# zéro RNG ; annonces et verdicts passent par la presse.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Reputation := preload("res://sim/reputation.gd")
const Comptes := preload("res://sim/comptes.gd")


static func _annee(state: Dictionary) -> float:
	return Etat.AN0 + float(state["tick"]) / 52.0


# Le mandat en cours ("" si aucun) — l'UI l'affiche avec sa progression.
static func actif(state: Dictionary, data: Dictionary) -> Dictionary:
	var annee: float = _annee(state)
	for m: Dictionary in data["constants"]["conseil"]["mandats"]:
		if annee >= float(m["des"]) and annee < float(m["fin"]) \
				and not (state["conseil"]["resolus"] as Dictionary).has(str(m["id"])):
			return m
	return {}


# Compteur BRUT depuis le début de la partie (livraisons, victoires) ou niveau courant.
static func _compteur(state: Dictionary, mandat: Dictionary) -> float:
	match str(mandat["type"]):
		"livraisons":
			return float(state["stats"]["livraisons"])
		"tresorerie":
			return float(state["tresorerie"])
		"victoire_ao":
			var n: float = 0.0
			for id_ao: String in Etat.cles_triees(state["ao"]["resolutions"]):
				if str(state["ao"]["resolutions"][id_ao]["vainqueur"]) == "joueur":
					n += 1.0
			return n
	return 0.0


# Progression PENDANT le mandat — partagée avec l'UI. Elle lisait les compteurs BRUTS, donc
# un mandat « 120 appareils avant 1938 » était déjà rempli à son annonce par les treize années
# précédentes (vécu playtest n°7 : 313/120). On mesure désormais l'écart à la base relevée à
# l'ouverture ; la trésorerie, elle, est un NIVEAU et se lit telle quelle.
static func progression(state: Dictionary, mandat: Dictionary) -> float:
	var courant: float = _compteur(state, mandat)
	if str(mandat["type"]) == "tresorerie":
		return courant
	var bases: Dictionary = (state["conseil"] as Dictionary).get("bases", {})
	return maxf(courant - float(bases.get(str(mandat["id"]), 0.0)), 0.0)


# Cible EFFECTIVE : le chiffre de data est un plancher, le conseil demande en réalité une
# fraction de ce que la maison a déjà produit (`exigence`). Un objectif absolu ne veut rien
# dire — dérisoire pour une grande maison, hors d'atteinte pour un bureau qui démarre.
static func cible(state: Dictionary, data: Dictionary, mandat: Dictionary) -> float:
	var socle: float = float(mandat["cible"])
	if str(mandat["type"]) != "livraisons":
		return socle
	var cc: Dictionary = data["constants"]["conseil"]
	var bases: Dictionary = (state["conseil"] as Dictionary).get("bases", {})
	var acquis: float = float(bases.get(str(mandat["id"]), _compteur(state, mandat)))
	# CADENCE, pas stock : le conseil demande de TENIR le rythme de la maison pendant la
	# durée du mandat. Mesurer une fraction du cumul de treize ans sur une fenêtre de trois
	# était mécaniquement intenable — glouton 46 % → 74 % de faillites au harnais.
	var annees: float = maxf(float(mandat["des"]) - Etat.AN0, 1.0)
	var fenetre: float = maxf(float(mandat["fin"]) - float(mandat["des"]), 1.0)
	return maxf(socle, acquis / annees * fenetre * float(cc["exigence"]))


static func tick_hebdo(state: Dictionary, data: Dictionary) -> void:
	var annee: float = _annee(state)
	var cc: Dictionary = data["constants"]["conseil"]
	var etat_c: Dictionary = state["conseil"]
	for m: Dictionary in cc["mandats"]:
		var id_m: String = str(m["id"])
		if (etat_c["resolus"] as Dictionary).has(id_m):
			continue
		# Annonce à l'ouverture du mandat (une seule fois).
		if annee >= float(m["des"]) and not (etat_c["annonces"] as Array).has(id_m):
			(etat_c["annonces"] as Array).append(id_m)
			# Base de départ : tout ce qui suit devra être livré PENDANT le mandat.
			if not etat_c.has("bases"):
				etat_c["bases"] = {}
			etat_c["bases"][id_m] = _compteur(state, m)
			(state["presse"] as Array).append({"titre": "LE CONSEIL FIXE SON CAP",
				"corps": "Mandat des actionnaires : %s (%d à livrer d'ici là). Échéance %d." 					% [str(m["titre"]), int(cible(state, data, m)), int(m["fin"])]})
		# Verdict à l'échéance.
		if annee >= float(m["fin"]):
			var tenu: bool = progression(state, m) >= cible(state, data, m)
			etat_c["resolus"][id_m] = tenu
			if tenu:
				state["tresorerie"] = float(state["tresorerie"]) + float(m["bonus"])
				Comptes.note(state, "conseil", float(m["bonus"]))
				state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) + float(m["bonus"])
				(state["presse"] as Array).append({"titre": "LE CONSEIL APPLAUDIT",
					"corps": "Mandat tenu (%s) : les actionnaires remettent %d £ au capital." \
					% [str(m["titre"]), int(m["bonus"])]})
			elif float(state["tresorerie"]) <= 0.0:
				# Maison déjà dans le rouge : les actionnaires constatent, ils ne saignent pas
				# un mourant (même principe que la grève interne, qui s'abstient elle aussi).
				(state["presse"] as Array).append({"titre": "LE CONSEIL CONSTATE",
					"corps": "Mandat manqué (%s) : les actionnaires renoncent au dividende — il n'y a rien à prendre." \
					% str(m["titre"])})
			else:
				# Dividende forcé : les actionnaires se paient sur la bête, la place doute.
				var ponction: float = maxf(float(state["tresorerie"]), 0.0) * float(cc["dividende_part"])
				state["tresorerie"] = float(state["tresorerie"]) - ponction
				Comptes.note(state, "conseil", -ponction)
				state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - ponction
				Reputation.bonus(state["rep"], "civile", -float(cc["malus_rep"]))
				Reputation.bonus(state["rep"], "militaire", -float(cc["malus_rep"]))
				(state["presse"] as Array).append({"titre": "LE CONSEIL S'IMPATIENTE",
					"corps": "Mandat manqué (%s) : dividende forcé de %d £, la confiance s'effrite." \
					% [str(m["titre"]), int(ponction)]})
