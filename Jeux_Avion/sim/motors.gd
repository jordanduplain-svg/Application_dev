# Raison d'être : le bureau d'études MOTEURS — concevoir ses propres moteurs au lieu de
# subir le catalogue daté du commerce. Deux gains : le prix (pas de marge de motoriste) et
# le sur-mesure (un moteur léger et sobre pour un postal, un moteur d'altitude avant que
# le marché en propose). Exclusif du partenariat motoriste : on intègre OU on sous-traite.
#
# Pur comme le reste de sim/ : aucune dépendance moteur, tout en float, mutation par sim.gd.
# Les bots n'en construisent pas — la mécanique est donc neutre au harnais par construction,
# comme les essais en vol.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Comptes := preload("res://sim/comptes.gd")


static func _annee(state: Dictionary) -> float:
	return Etat.AN0 + float(state["tick"]) / 52.0


# ponytail: migration à la volée (comme Essais.tous) — les vieux saves n'ont pas les clés.
static func moteurs(state: Dictionary) -> Dictionary:
	if not state.has("moteurs"):
		state["moteurs"] = {}
	return state["moteurs"]


static func banc(state: Dictionary) -> Dictionary:
	if not state.has("banc"):
		state["banc"] = {}
	return state["banc"]


static func departement(state: Dictionary) -> bool:
	return bool(state.get("dept_moteurs", false))


# Caractéristiques ÉMERGENTES d'un projet de moteur — mêmes champs qu'un moteur du commerce
# (engines.json), pour que tout le reste du jeu le traite à l'identique.
# Contrôles : cylindrée (litres), architecture (ligne/radial), suralimentation, soin de
# fabrication (0..1 — du travail de série au travail d'orfèvre).
static func specs(projet: Dictionary, data: Dictionary, annee: float) -> Dictionary:
	var cm: Dictionary = data["constants"]["moteurs"]
	var cyl: float = maxf(float(projet["cylindree_l"]), 1.0)
	var radial: bool = str(projet["architecture"]) == "radial"
	var suralim: bool = bool(projet.get("suralimente", false))
	var soin: float = clampf(float(projet.get("soin", 0.5)), 0.0, 1.0)
	# L'état de l'art de l'ANNÉE : la puissance par litre progresse avec l'industrie —
	# un 27 litres de 1922 et un de 1942 n'ont rien à voir. C'est ce qui fait qu'un
	# département moteur ne dispense pas d'être de son temps.
	var cv_l: float = _interp(cm["cv_par_litre"], annee)
	var puissance: float = cyl * cv_l
	if suralim:
		puissance *= float(cm["suralim_puissance"])
	if radial:
		puissance *= float(cm["radial_puissance"])
	# Le radial est plus léger (refroidi par air, pas de circuit d'eau) mais traîne plus —
	# la traînée est l'affaire de aircraft.gd, ici c'est la masse.
	var masse: float = cyl * float(cm["kg_par_litre"]) * (float(cm["radial_masse"]) if radial else 1.0)
	if suralim:
		masse += float(cm["suralim_masse"])
	# La fiabilité se paie : gaver un moteur (suralimentation, puissance spécifique élevée)
	# l'use, le soin de fabrication la rachète.
	var stress: float = maxf(cv_l - float(cm["cv_par_litre_sain"]), 0.0) * float(cm["k_stress"])
	# La cylindrée se paie en fiabilité au-delà d'une taille saine : plus de cylindres, plus
	# de vibrations, plus de choses qui cassent. C'est l'histoire du Vulture et du Sabre —
	# sans ça, un 36 L maison battait le Merlin sur TOUS les tableaux (mesuré).
	var demesure: float = maxf(cyl - float(cm["cyl_saine"]), 0.0) * float(cm["fiab_par_litre_au_dela"])
	var fiab: float = float(cm["fiab_base"]) + soin * float(cm["fiab_par_soin"]) - stress - demesure
	if suralim:
		fiab -= float(cm["suralim_fiab"])
	fiab = clampf(fiab, float(cm["fiab_min"]), float(cm["fiab_max"]))
	# Au CHEVAL : un moteur se paie à ce qu'il produit, pas à sa taille — sinon le prix
	# décroche de l'époque (la puissance par litre double entre 1922 et 1945).
	var cout: float = puissance * float(cm["cout_par_cv"]) * (1.0 + soin * float(cm["cout_par_soin"]))
	if suralim:
		cout *= float(cm["suralim_cout"])
	return {
		"nom": str(projet.get("nom", "moteur maison")),
		"type": "radial" if radial else "ligne",
		"puissance_cv": snappedf(puissance, 1.0),
		"masse_kg": snappedf(masse, 1.0),
		"conso_kg_h": snappedf(puissance * float(cm["conso_par_cv"]), 0.1),
		"fiabilite": snappedf(fiab, 0.001),
		"cout": snappedf(cout, 1.0),
		"annee": snappedf(annee, 0.01),
		"marque": "maison",
	}


# Coût et durée du banc d'essai : un gros moteur soigné se met au point longtemps.
static func banc_cout(projet: Dictionary, data: Dictionary) -> float:
	var cm: Dictionary = data["constants"]["moteurs"]
	return float(cm["banc_cout_base"]) + float(projet["cylindree_l"]) * float(cm["banc_cout_par_litre"]) \
		* (1.0 + clampf(float(projet.get("soin", 0.5)), 0.0, 1.0))


static func banc_semaines(projet: Dictionary, data: Dictionary) -> float:
	var cm: Dictionary = data["constants"]["moteurs"]
	var sem: float = float(cm["banc_sem_base"]) + float(projet["cylindree_l"]) * float(cm["banc_sem_par_litre"])
	if bool(projet.get("suralimente", false)):
		sem += float(cm["banc_sem_suralim"])
	return ceilf(sem)


# Fonder le département : irréversible, exclusif du partenariat motoriste (on ne peut pas
# être à la fois client privilégié de Rolls-Royce et son concurrent).
static func fonder(state: Dictionary, data: Dictionary) -> bool:
	if departement(state):
		return false
	if str(state.get("motoriste", "")) != "":
		return false
	var cout: float = float(data["constants"]["moteurs"]["cout_departement"])
	if float(state["tresorerie"]) < cout:
		return false
	state["tresorerie"] = float(state["tresorerie"]) - cout
	Comptes.note(state, "atelier", -cout)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout
	state["dept_moteurs"] = true
	(state["presse"] as Array).append({"titre": "VOUS FONDEZ VOTRE DÉPARTEMENT MOTEURS",
		"corps": "Bancs d'essai, fonderie, atelier de rodage : votre maison ne dépendra plus des motoristes pour ses cellules."})
	return true


# Mettre un projet au banc : payé maintenant, disponible au catalogue à la fin des essais.
static func lancer(state: Dictionary, data: Dictionary, projet: Dictionary) -> bool:
	if not departement(state):
		return false
	if not banc(state).is_empty():
		return false
	if float(projet.get("cylindree_l", 0.0)) <= 0.0:
		return false
	var cout: float = banc_cout(projet, data)
	if float(state["tresorerie"]) < cout:
		return false
	state["tresorerie"] = float(state["tresorerie"]) - cout
	Comptes.note(state, "recherche", -cout)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout
	state["banc"] = {
		"projet": projet.duplicate(true),
		"restant": banc_semaines(projet, data),
	}
	return true


static func tick_hebdo(state: Dictionary, data: Dictionary) -> void:
	var b: Dictionary = banc(state)
	if b.is_empty():
		return
	# Le banc tourne même études gelées : c'est un atelier d'essais, pas le bureau de dessin.
	b["restant"] = float(b["restant"]) - 1.0
	if float(b["restant"]) > 0.0:
		return
	var projet: Dictionary = b["projet"]
	var uid: String = "mm%d" % int(state["prochain_id"])
	state["prochain_id"] = float(state["prochain_id"]) + 1.0
	var fiche: Dictionary = specs(projet, data, _annee(state))
	# Le PROJET est conservé dans la fiche : sans lui, un moteur homologué garde à vie le prix
	# calculé au moment du banc, même après un correctif d'équilibrage (vécu playtest n°7 :
	# « il est super cher » — le moteur datait de la formule au litre, abandonnée depuis).
	fiche["projet"] = projet.duplicate(true)
	moteurs(state)[uid] = fiche
	state["banc"] = {}
	(state["presse"] as Array).append({"titre": "UN MOTEUR MAISON PASSE LE BANC",
		"corps": "« %s » — %d cv pour %d kg — est homologué. Vos bureaux peuvent l'installer dès le prochain projet." \
			% [str(moteurs(state)[uid]["nom"]), int(float(moteurs(state)[uid]["puissance_cv"])),
				int(float(moteurs(state)[uid]["masse_kg"]))]})


# Catalogue complet vu par le Bureau : moteurs du commerce disponibles à l'année + les vôtres.
# `moteur_interdit` (partenariat) est appliqué par sim.gd, qui possède cette règle.
static func catalogue(state: Dictionary, data: Dictionary, annee: float) -> Dictionary:
	var liste: Dictionary = {}
	for id_m: String in Etat.cles_triees(data["engines"]):
		if annee >= float(data["engines"][id_m]["annee"]):
			liste[id_m] = data["engines"][id_m]
	for id_m: String in Etat.cles_triees(moteurs(state)):
		liste[id_m] = moteurs(state)[id_m]
	return liste


static func _interp(points: Array, x: float) -> float:
	if x <= float(points[0][0]):
		return float(points[0][1])
	for i: int in range(1, points.size()):
		if x <= float(points[i][0]):
			var x0: float = float(points[i - 1][0])
			var y0: float = float(points[i - 1][1])
			var x1: float = float(points[i][0])
			var y1: float = float(points[i][1])
			return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
	return float(points[points.size() - 1][1])


# Réévalue le PRIX des moteurs déjà homologués avec les constantes courantes. Appelée à la
# reprise d'une sauvegarde : un correctif d'équilibrage doit valoir pour le moteur qu'on a
# déjà dans son hangar, sinon le joueur voit un tarif que plus aucune règle ne produit.
# Puissance, masse et fiabilité NE bougent pas — c'est un moteur qui existe, pas un nouveau.
static func reevaluer_prix(state: Dictionary, data: Dictionary) -> void:
	var cm: Dictionary = data["constants"]["moteurs"]
	for uid: String in Etat.cles_triees(moteurs(state)):
		var m: Dictionary = moteurs(state)[uid]
		var soin: float = 0.5
		if m.has("projet"):
			soin = clampf(float((m["projet"] as Dictionary).get("soin", 0.5)), 0.0, 1.0)
		else:
			# Fiche d'avant la mémorisation du projet : le soin se déduit de la fiabilité
			# (fiab = base + soin×pente − stress − démesure), les autres termes étant calculables.
			var cv_l: float = _interp(cm["cv_par_litre"], float(m["annee"]))
			var cyl: float = float(m["masse_kg"]) / maxf(float(cm["kg_par_litre"]), 0.001)
			var stress: float = maxf(cv_l - float(cm["cv_par_litre_sain"]), 0.0) * float(cm["k_stress"])
			var dem: float = maxf(cyl - float(cm["cyl_saine"]), 0.0) * float(cm["fiab_par_litre_au_dela"])
			soin = clampf((float(m["fiabilite"]) - float(cm["fiab_base"]) + stress + dem)
				/ maxf(float(cm["fiab_par_soin"]), 0.001), 0.0, 1.0)
		m["cout"] = snappedf(float(m["puissance_cv"]) * float(cm["cout_par_cv"])
			* (1.0 + soin * float(cm["cout_par_soin"])), 1.0)
