# Raison d'être : les concours à cahier des charges — spécifications de l'Air Ministry ET
# commandes spéciales de clients civils nommés (même mécanique, `domaine` en data) : notation
# façon marché (ratios clampés pondérés × facteur réputation du domaine), winner-takes-most,
# acompte à la victoire puis série livrée en PRIORITÉ sur la capacité d'atelier. Zéro RNG.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Reputation := preload("res://sim/reputation.gd")
const Comptes := preload("res://sim/comptes.gd")


# Une ligne dupliquée depuis market.gd plutôt qu'un preload : market précharge ce module.
static func _annee(state: Dictionary) -> float:
	return Etat.AN0 + float(state["tick"]) / 52.0


static func ouverts(state: Dictionary, data: Dictionary) -> Array:
	var annee: float = _annee(state)
	var liste: Array = []
	for id_ao: String in Etat.cles_triees(data["contracts"]["programmes"]):
		var ao: Dictionary = data["contracts"]["programmes"][id_ao]
		if annee >= float(ao["ouverture"]) and annee < float(ao["cloture"]) \
				and not (state["ao"]["resolutions"] as Dictionary).has(id_ao):
			liste.append(id_ao)
	return liste


# Candidature (remplaçable jusqu'à la clôture) : un produit du catalogue, n'importe lequel —
# le cahier des charges se charge de ridiculiser un avion postal sur un programme de chasse.
static func candidater(state: Dictionary, data: Dictionary, id_ao: String, produit: String) -> bool:
	if not ouverts(state, data).has(id_ao):
		return false
	if not (state["catalogue"] as Dictionary).has(produit):
		return false
	state["ao"]["candidatures"][id_ao] = produit
	return true


static func tick_hebdo(state: Dictionary, data: Dictionary) -> void:
	var annee: float = _annee(state)
	for id_ao: String in Etat.cles_triees(data["contracts"]["programmes"]):
		var ao: Dictionary = data["contracts"]["programmes"][id_ao]
		if annee >= float(ao["cloture"]) and not (state["ao"]["resolutions"] as Dictionary).has(id_ao):
			_resoudre(state, data, id_ao, ao)


# Note publique de SPECS BRUTES sur un AO ouvert (estimation live) — sert autant à un
# produit du catalogue (note_produit) qu'à un design encore sur la planche à dessin
# (écran Bureau, comparaison AVANT de payer le prototype).
static func note_specs(state: Dictionary, data: Dictionary, id_ao: String, specs_p: Dictionary) -> Dictionary:
	var ao: Dictionary = data["contracts"]["programmes"][id_ao]
	var note: Dictionary = _noter(data, ao, specs_p, float(state["rep"][str(ao.get("domaine", "militaire"))]), 0.0)
	# La même pondération ministère que la résolution : l'estimation ne ment pas.
	if str(ao.get("domaine", "militaire")) == "militaire":
		note["score"] = float(note["score"]) * _f_ministere(state, data)
	return note


static func note_produit(state: Dictionary, data: Dictionary, id_ao: String, produit: String) -> Dictionary:
	return note_specs(state, data, id_ao, state["catalogue"][produit]["specs"])


# Facteur de faveur de Whitehall : 0.9 (brouillé) → 1.1 (chouchou), neutre à 0.5.
static func _f_ministere(state: Dictionary, data: Dictionary) -> float:
	var cao: Dictionary = data["constants"]["ao"]
	return float(cao["minist_base"]) + float(cao["minist_k"]) * float(state.get("ministere", 0.5))


# Part du prix versée en ACOMPTE à la signature ; le reste (le solde) tombe appareil par
# appareil à la livraison. PUBLIC et partagé avec l'écran Concours, pour que l'aperçu
# d'économie affiché avant de candidater ne puisse pas mentir sur ce que la sim versera.
static func part_acompte_de(state: Dictionary, data: Dictionary, id_ao: String) -> float:
	var cao: Dictionary = data["constants"]["ao"]
	var ao: Dictionary = data["contracts"]["programmes"][id_ao]
	var p: float = float(cao["acompte_part"])
	if str(ao.get("domaine", "militaire")) == "militaire" \
			and float(state.get("ministere", 0.5)) >= float(cao["seuil_faveur"]):
		p += float(cao["acompte_bonus"])
	return p


# La série militaire réquisitionne l'atelier AVANT l'allocation du marché civil
# (cap est le dictionnaire de capacités du trimestre construit par market.gd).
static func livrer_trimestre(state: Dictionary, data: Dictionary, cap: Dictionary) -> void:
	var restants: Array = []
	# Trace PAR PRODUIT des appareils sortis en série d'État ce trimestre. Sans elle, l'écran
	# Marché affichait « livré 0 » sur un produit qui venait de gagner un concours, et le total
	# d'atelier les excluait — alors qu'ils consomment bel et bien la capacité (retour joueur).
	# Écrite sur le state (et non sur le contrat) pour survivre au retrait d'un contrat achevé.
	var livrees_trim: Dictionary = {}
	for contrat: Dictionary in state["ao"]["contrats"]:
		var livrees: float = minf(float(contrat["restant"]), float(cap["joueur"]))
		if livrees > 0.0:
			cap["joueur"] = float(cap["joueur"]) - livrees
			var uid_p: String = str(contrat.get("produit", ""))
			if uid_p != "":
				livrees_trim[uid_p] = float(livrees_trim.get(uid_p, 0.0)) + livrees
			var ca: float = livrees * float(contrat["solde_unitaire"])
			var cout: float = livrees * float(contrat["cout_unitaire"])
			state["tresorerie"] = float(state["tresorerie"]) + ca - cout
			Comptes.note(state, "contrats", ca)
			Comptes.note(state, "production", -cout)
			state["stats"]["livraisons"] = float(state["stats"]["livraisons"]) + livrees
			state["stats"]["ca_cumule"] = float(state["stats"]["ca_cumule"]) + ca
			state["stats"]["marge_cumulee"] = float(state["stats"]["marge_cumulee"]) + ca - cout
			Reputation.livraisons(state, data, str(contrat.get("domaine", "militaire")), livrees, float(contrat["fiabilite"]))
			contrat["restant"] = float(contrat["restant"]) - livrees
		if float(contrat["restant"]) > 0.0:
			restants.append(contrat)
	state["ao"]["contrats"] = restants
	state["ao"]["livrees_trim"] = livrees_trim
	_patience(state, data, restants)


# Whitehall n'aime pas attendre : au-delà de `patience_trim` trimestres, une série encore en
# cours coûte de la réputation et de la faveur à CHAQUE trimestre de retard. C'est ce qui
# donne son prix à l'allocation d'atelier — sans pénalité, réserver toute la capacité au
# marché serait gratuit.
static func _patience(state: Dictionary, data: Dictionary, contrats: Array) -> void:
	var cao: Dictionary = data["constants"]["ao"]
	if not cao.has("patience_trim"):
		return
	for contrat: Dictionary in contrats:
		contrat["trim"] = float(contrat.get("trim", 0.0)) + 1.0
		if float(contrat["trim"]) <= float(cao["patience_trim"]):
			continue
		var domaine: String = str(contrat.get("domaine", "militaire"))
		Reputation.bonus(state["rep"], domaine, -float(cao["retard_rep"]))
		if domaine == "militaire":
			state["ministere"] = clampf(float(state.get("ministere", 0.5))
				- float(cao["retard_ministere"]), 0.0, 1.0)
		(state["presse"] as Array).append({"titre": "LE CLIENT S'IMPATIENTE",
			"corps": "Votre série accuse du retard : %d appareils toujours attendus. La commande n'était pas une option." 				% int(float(contrat["restant"]))})


# --- résolution ---------------------------------------------------------------------

static func _resoudre(state: Dictionary, data: Dictionary, id_ao: String, ao: Dictionary) -> void:
	# Commandes civiles (clients nommés) : même concours, réputation et rival du domaine.
	var domaine: String = str(ao.get("domaine", "militaire"))
	var seg_rival: String = str(ao.get("segment", "export_militaire"))
	var candidats: Array = []
	var cand: Dictionary = state["ao"]["candidatures"]
	if cand.has(id_ao) and (state["catalogue"] as Dictionary).has(str(cand[id_ao])):
		var uid: String = str(cand[id_ao])
		var produit: Dictionary = state["catalogue"][uid]
		var note: Dictionary = _noter(data, ao, produit["specs"], float(state["rep"][domaine]), 0.0)
		# Whitehall a la mémoire longue : la relation ministère pondère les Spécifications
		# (pas les clients civils). Neutre à 0.5 — c'est le joueur qui la fait bouger.
		if domaine == "militaire":
			note["score"] = float(note["score"]) * _f_ministere(state, data)
		var nom: String = uid
		if (state["designs"] as Dictionary).has(str(produit["design_uid"])):
			nom = str(state["designs"][str(produit["design_uid"])]["design"]["nom"])
		candidats.append({"maison": "joueur", "produit": uid, "nom": nom,
			"score": note["score"], "notes": note["notes"],
			"dossier": note["dossier"], "marque": note["marque"]})
	for maison: String in Etat.cles_triees(state["rivaux"]):
		var riv: Dictionary = state["rivaux"][maison]
		var drv: Dictionary = data["rivals"]["maisons"][maison]
		var uid_r: String = _produit_rival_segment(riv, seg_rival)
		if uid_r == "":
			continue
		var p: Dictionary = riv["catalogue"][uid_r]
		var note_r: Dictionary = _noter(data, ao, p["specs"],
			float(riv["rep"][domaine]), float(drv["biais_qualite"]))
		candidats.append({"maison": maison, "produit": uid_r,
			"nom": "%s %d" % [str(drv["nom"]), int(p["annee"])],
			"score": note_r["score"], "notes": note_r["notes"],
			"dossier": note_r["dossier"], "marque": note_r["marque"]})

	var vainqueur: String = ""
	var meilleur: float = float(ao["seuil"])
	for c: Dictionary in candidats:
		if float(c["score"]) > meilleur:
			meilleur = float(c["score"])
			vainqueur = str(c["maison"])
	state["ao"]["resolutions"][id_ao] = {
		"annee": snappedf(_annee(state), 0.01),
		"vainqueur": vainqueur,
		"candidats": candidats,
	}
	cand.erase(id_ao)
	if vainqueur == "":
		return
	var cao: Dictionary = data["constants"]["ao"]
	var total: float = float(ao["volume"]) * float(ao["prix_unitaire"])
	if vainqueur == "joueur":
		# Faveur du ministère : au-dessus du seuil, l'acompte est bonifié (prototype
		# « financé » de fait) ; chaque victoire militaire réchauffe la relation.
		var part_acompte: float = part_acompte_de(state, data, id_ao)
		if domaine == "militaire":
			state["ministere"] = clampf(float(state.get("ministere", 0.5)) + float(cao["minist_victoire"]), 0.0, 1.0)
		var acompte: float = part_acompte * total
		state["tresorerie"] = float(state["tresorerie"]) + acompte
		Comptes.note(state, "contrats", acompte)
		state["stats"]["ca_cumule"] = float(state["stats"]["ca_cumule"]) + acompte
		# Acompte encaissé avant toute production : pas de coût à déduire ici, il tombera
		# en entier sur le solde à la livraison de série (cout_unitaire × unités livrées).
		state["stats"]["marge_cumulee"] = float(state["stats"]["marge_cumulee"]) + acompte
		var uid_g: String = ""
		for c: Dictionary in candidats:
			if str(c["maison"]) == "joueur":
				uid_g = str(c["produit"])
		var specs_g: Dictionary = state["catalogue"][uid_g]["specs"]
		state["ao"]["contrats"].append({
			"ao": id_ao,
			"domaine": domaine,
			# Le produit vainqueur, pour attribuer les livraisons de série à SA ligne au Marché.
			"produit": uid_g,
			"restant": float(ao["volume"]),
			# Prix PLEIN mémorisé à la signature : le solde seul ne dit pas si la série est
			# rentable (il vaut 60-70 % du prix, l'acompte ayant déjà été encaissé), et
			# `part_acompte_de` recalculerait la jauge ministère d'AUJOURD'HUI, pas celle du
			# jour de la signature. Sans ce champ, toute alerte de marge compare les 70 %
			# restants au coût des 100 % — le faux avertissement déjà corrigé une fois.
			"prix_unitaire": float(ao["prix_unitaire"]),
			"solde_unitaire": float(ao["prix_unitaire"]) * (1.0 - part_acompte),
			"cout_unitaire": float(specs_g["cout_unitaire"]),
			"fiabilite": float(specs_g["fiabilite"]),
		})
		Reputation.bonus(state["rep"], domaine, float(cao["repu_victoire"]))
	else:
		# ponytail: CA rival crédité d'un bloc (trésorerie rivale « simulée en gros », GDD §2),
		# sans consommer leur capacité — l'étalement viendrait avec une éco rivale fine.
		var riv_g: Dictionary = state["rivaux"][vainqueur]
		riv_g["ca_trim"] = float(riv_g["ca_trim"]) + total
		# Gain réduit côté rival : à gain égal, chaque victoire nourrissait la suivante
		# et Marane raflait 7 AO sur 7 dans toutes les campagnes (vécu).
		Reputation.bonus(riv_g["rep"], domaine, float(cao["repu_victoire_rival"]))


# Même grammaire que l'attractivité du marché : ratios clampés pondérés × facteur réputation.
static func _noter(data: Dictionary, ao: Dictionary, specs: Dictionary, rep: float, biais: float) -> Dictionary:
	var cm: Dictionary = data["constants"]["marche"]
	var qualite: float = 0.0
	var penalite: float = 1.0
	var notes: Dictionary = {}
	for crit: Dictionary in ao["criteres"]:
		var val: float = float(specs[str(crit["spec"])])
		var ref: float = float(crit["ref"])
		var ratio: float = 0.0
		if bool(crit["inverse"]):
			ratio = ref / maxf(val, 0.0001)
		else:
			ratio = val / maxf(ref, 0.0001)
		ratio = clampf(ratio, 0.0, float(cm["clamp_qualite"]))
		notes[str(crit["nom"])] = snappedf(ratio, 0.01)
		qualite += float(crit["poids"]) * ratio
		# DÉFAILLANCE RÉDHIBITOIRE, même règle que le marché (`Marche.qualite_segment`) —
		# elle manquait ici : un cahier des charges est PLUS exigeant qu'un marché ouvert, or
		# un candidat pouvait emporter le concours en ratant de moitié une exigence chiffrée
		# et en banquant sur les critères faciles (vécu playtest n°7 : Imperial Airways gagné
		# avec capacité 0.44 sur un critère à 25 %, compensée par autonomie et coût plafonnés).
		if float(crit["poids"]) >= float(cm["critique_poids_min"]):
			penalite = minf(penalite, clampf(ratio / float(cm["critique_seuil"]),
				float(cm["critique_plancher"]), 1.0))
	qualite = maxf(qualite * penalite + biais, 0.0)
	# Pondération réputation propre aux AO, plus douce que celle du marché : un concours
	# juge le prototype plus que la marque — sinon le joueur (rep 0.05 au départ) ne peut
	# structurellement jamais gagner contre Marane (0.35).
	var cao: Dictionary = data["constants"]["ao"]
	var f_repu: float = float(cao["repu_base"]) + float(cao["repu_k"]) * rep
	# "dossier" et "marque" exposés pour l'écran Concours : sans eux, deux candidats aux
	# ratios IDENTIQUES affichaient des scores différents (biais de fabrication de la maison
	# + facteur de notoriété), et un joueur au meilleur dossier perdait sans comprendre
	# pourquoi (playtest n°7 : dossier 1.13 battu par 1.03 sur la seule réputation).
	return {"score": snappedf(qualite * f_repu, 0.0001), "notes": notes,
		"dossier": snappedf(qualite, 0.01), "marque": snappedf(f_repu, 0.001)}


static func _produit_rival_segment(riv: Dictionary, seg: String) -> String:
	var rcat: Dictionary = riv["catalogue"]
	for uid: String in Etat.cles_triees(rcat):
		if str(rcat[uid]["segment"]) == seg:
			return uid
	return ""
