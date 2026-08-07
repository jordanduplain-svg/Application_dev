# Raison d'être : le bureau vivant — compétences, traits et moral des ingénieurs, affectation
# par poste (études, recherche, atelier) qui module les systèmes existants, et marché du
# recrutement seedé à budget fermé (12 postes). Les pilotes nommés arrivent avec les
# records/raids (étape 7).
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Rng := preload("res://sim/rng.gd")
const Comptes := preload("res://sim/comptes.gd")

const POSTES: Array = ["etudes", "recherche", "atelier"]


# Points effectifs d'un poste : Σ (compétence + 1 si trait assorti) × moral des affectés.
static func points(state: Dictionary, data: Dictionary, poste: String) -> float:
	var total: float = 0.0
	for ing: Dictionary in state["ingenieurs"]:
		if str(ing["poste"]) != poste:
			continue
		var comp: float = float(ing["comp"][poste])
		var trait_id: String = str(ing["trait"])
		if trait_id != "" and str(data["engineers"]["traits"][trait_id]["comp"]) == poste:
			# Bonus du trait (défaut +1 ; un Visionnaire vaut +2).
			comp += float((data["engineers"]["traits"][trait_id] as Dictionary).get("bonus", 1.0))
		total += comp * float(ing["moral"])
	return total


# Bonus consolidé d'un poste (aussi affiché par l'écran Équipe) : recherche = accélération,
# etudes = remise sur le prototype (plafonnée), atelier = capacité en plus (plafonnée).
static func bonus(state: Dictionary, data: Dictionary, poste: String) -> float:
	var ce: Dictionary = data["constants"]["equipe"]
	var pts: float = points(state, data, poste)
	match poste:
		"recherche":
			return pts * float(ce["bonus_recherche_par_point"])
		"etudes":
			return minf(pts * float(ce["bonus_etudes_par_point"]), float(ce["bonus_etudes_max"]))
		"atelier":
			return minf(pts * float(ce["bonus_atelier_par_point"]), float(ce["bonus_atelier_max"]))
	return 0.0


static func tick_hebdo(state: Dictionary, data: Dictionary) -> void:
	var ce: Dictionary = data["constants"]["equipe"]
	# Moral : l'asphyxie financière mine l'équipe, les semaines saines la retapent.
	var delta: float = float(ce["moral_hausse"])
	if float(state["semaines_rouge"]) > 0.0:
		delta = -float(ce["moral_baisse_rouge"])
	for ing: Dictionary in state["ingenieurs"]:
		ing["moral"] = clampf(float(ing["moral"]) + delta, float(ce["moral_min"]), 1.0)
	# Grève interne : un moral d'équipe durablement au fond finit par fermer l'atelier —
	# le moral cesse d'être un simple multiplicateur de bonus, il devient une menace.
	var total_moral: float = 0.0
	for ing: Dictionary in state["ingenieurs"]:
		total_moral += float(ing["moral"])
	var moral_moyen: float = total_moral / maxf(float((state["ingenieurs"] as Array).size()), 1.0)
	if moral_moyen < float(ce["greve_moral_seuil"]):
		state["moral_bas_sem"] = float(state.get("moral_bas_sem", 0.0)) + 1.0
	else:
		state["moral_bas_sem"] = 0.0
	# Trésorerie POSITIVE exigée : on fait grève pour sa part du gâteau, pas dans une
	# boîte qui coule (et achever les mourants n'est pas du gameplay, c'est de l'acharnement).
	if float(state.get("moral_bas_sem", 0.0)) >= float(ce["greve_sem_seuil"]) \
			and float(state["tresorerie"]) > 0.0 \
			and float(state["tick"]) - float(state.get("greve_dernier_tick", -999.0)) >= float(ce["greve_cooldown_sem"]):
		state["greve_dernier_tick"] = float(state["tick"])
		state["moral_bas_sem"] = 0.0
		state["gels"]["production"] = float(state["gels"]["production"]) + float(ce["greve_duree_sem"])
		(state["presse"] as Array).append({"titre": "GRÈVE À L'ATELIER",
			"corps": "Les équipes posent les outils : %d semaines de production perdues. Le moral ne se décrète pas — il se paie." % int(ce["greve_duree_sem"])})
	# Marché du recrutement renouvelé à date fixe : cadence rigide = flux RNG stable.
	if int(state["tick"]) % int(ce["regen_sem"]) == 0:
		regenerer_candidats(state, data)


static func regenerer_candidats(state: Dictionary, data: Dictionary) -> void:
	var ce: Dictionary = data["constants"]["equipe"]
	var de: Dictionary = data["engineers"]
	var noms: Array = de["noms"]
	var traits: Array = [""]
	traits.append_array(Etat.cles_triees(de["traits"]))
	# Le vivier s'améliore avec les années : plafond de compétence 2 (1922) → 5 (1934+).
	var annee: float = Etat.AN0 + float(state["tick"]) / 52.0
	var plafond: float = clampf(2.0 + (annee - Etat.AN0) / 4.0, 2.0, 5.0)
	var candidats: Array = []
	for i: int in range(int(ce["candidats_par_regen"])):
		var comp: Dictionary = {}
		var total: float = 0.0
		for poste_v: Variant in POSTES:
			var c: float = 1.0 + floorf(Rng.reel(state) * plafond)
			comp[str(poste_v)] = c
			total += c
		var trait_id: String = str(traits[int(floorf(Rng.reel(state) * float(traits.size())))])
		var nom: String = str(noms[int(floorf(Rng.reel(state) * float(noms.size())))])
		var salaire: float = float(ce["salaire_base"]) + float(ce["salaire_par_comp"]) * total
		if trait_id != "":
			salaire += float(ce["salaire_par_comp"])
		candidats.append({"nom": nom, "salaire_sem": salaire, "comp": comp,
			"trait": trait_id, "moral": float(ce["moral_candidat"]), "poste": ""})
	# Génies datés (Mitchell, Camm) : présents dans le vivier pendant leur fenêtre tant
	# qu'ils ne sont pas embauchés — la fenêtre passée, ils sont partis chez un rival.
	for genie_v: Variant in (de as Dictionary).get("genies", []):
		var genie: Dictionary = genie_v
		var deja: bool = false
		for ing: Dictionary in state["ingenieurs"]:
			if str(ing["nom"]) == str(genie["nom"]):
				deja = true
		if deja or annee < float(genie["des"]) or annee >= float(genie["fin"]):
			continue
		candidats.push_front({"nom": str(genie["nom"]), "salaire_sem": float(genie["salaire_sem"]),
			"comp": (genie["comp"] as Dictionary).duplicate(true), "trait": str(genie["trait"]),
			"moral": float(ce["moral_candidat"]), "poste": ""})
		var annonces: Array = state.get("genies_annonces", [])
		if not annonces.has(str(genie["nom"])):
			annonces.append(str(genie["nom"]))
			state["genies_annonces"] = annonces
			(state["presse"] as Array).append({"titre": "UN GÉNIE SUR LE MARCHÉ",
				"corps": "%s cherche un bureau à sa mesure. Un Visionnaire pareil ne repassera pas — la fenêtre se referme en %d." \
				% [str(genie["nom"]), int(genie["fin"])]})
	state["recrutement"]["candidats"] = candidats


static func recruter(state: Dictionary, data: Dictionary, indice: int) -> bool:
	var candidats: Array = state["recrutement"]["candidats"]
	if indice < 0 or indice >= candidats.size():
		return false
	if (state["ingenieurs"] as Array).size() >= int(data["constants"]["equipe"]["max_postes"]):
		return false
	(state["ingenieurs"] as Array).append(candidats[indice])
	candidats.remove_at(indice)
	return true


# Licenciement : indemnité de quelques semaines de salaire, et jamais moins d'un ingénieur.
static func licencier(state: Dictionary, data: Dictionary, indice: int) -> bool:
	var ings: Array = state["ingenieurs"]
	if indice < 0 or indice >= ings.size() or ings.size() <= 1:
		return false
	var indemnite: float = float(data["constants"]["equipe"]["indemnite_sem"]) \
			* float(ings[indice]["salaire_sem"])
	state["tresorerie"] = float(state["tresorerie"]) - indemnite
	Comptes.note(state, "equipe", -indemnite)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - indemnite
	ings.remove_at(indice)
	return true


static func affecter(state: Dictionary, indice: int, poste: String) -> bool:
	var ings: Array = state["ingenieurs"]
	if indice < 0 or indice >= ings.size():
		return false
	if poste != "" and not POSTES.has(poste):
		return false
	ings[indice]["poste"] = poste
	return true
