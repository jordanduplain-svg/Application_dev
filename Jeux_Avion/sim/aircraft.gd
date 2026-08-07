# Raison d'être : les performances ÉMERGENT du design — une seule fonction transforme
# des choix d'ingénierie (structure, formule, moteur, surface, équipements) en specs,
# via un modèle physique simplifié (traînée parasite, cube de la vitesse).
extends RefCounted

const Etat := preload("res://sim/state.gd")

# Équipements posables sur un design (les autres technos sont structurelles ou méta).
const FEATURES_DESIGN: Array = [
	"capot_naca", "helice_pas_variable", "train_rentrant", "cockpit_ferme",
	"suralimentation", "volets_atterrissage", "radio_embarquee", "canon_moteur",
	"reservoirs_largables", "instruments_vol",
	"helice_metallique", "roues_carenees", "demarreur_electrique", "pilote_automatique",
	"radio_gonio", "rivetage_affleurant", "helice_tripale", "verriere_goutte",
	"blindage_pilote", "turbocompresseur", "cabine_pressurisee",
	"soute_bombes", "tourelle_defensive", "armes_ailes",
	"reservoir_autoetanche", "helice_contrarotative",
]


static func specs(design: Dictionary, data: Dictionary) -> Dictionary:
	var c: Dictionary = data["constants"]["avion"]
	var fc_toutes: Dictionary = data["constants"]["features_avion"]
	# `moteur_specs` : moteur MAISON tamponné dans le design (sim._nouveau_design), comme
	# `mat_features` — aircraft.gd reste pur et ne connaît pas le state.
	var moteur: Dictionary = design.get("moteur_specs", (data["engines"] as Dictionary).get(str(design["moteur"]), {}))
	var feats: Array = design.get("features", [])
	var structure: String = str(design["structure"])
	var surface: float = float(design["surface"])
	var armement: float = float(design.get("armement", 0))
	if feats.has("canon_moteur"):
		armement += 1.0
	# Batteries d'ailes : deux armes de plus, qui pèsent/coûtent/traînent comme les autres.
	if feats.has("armes_ailes"):
		armement += 2.0
	# La tourelle arme (les concours de bombardiers la valorisent), mais traîne et alourdit.
	if feats.has("tourelle_defensive"):
		armement += 1.0

	# Traînée parasite : base de la formule + contributions des choix.
	var cd0: float = float(c["cd0_base"][str(design["formule"])])
	if not feats.has("train_rentrant"):
		cd0 += float(c["cd0_train_fixe"])
		# Les carénages de roues ne servent que sur un train fixe.
		if feats.has("roues_carenees"):
			cd0 += float(c["cd0_roues_carenees"])
	if feats.has("capot_naca"):
		cd0 += float(c["cd0_capot_naca"])
	if feats.has("cockpit_ferme"):
		cd0 += float(c["cd0_cockpit_ferme"])
	if feats.has("verriere_goutte"):
		cd0 += float(c["cd0_verriere"])
	if structure == "metal":
		cd0 += float(c["cd0_monocoque"])
		# Le rivetage affleurant ne lisse que la peau métallique.
		if feats.has("rivetage_affleurant"):
			cd0 += float(c["cd0_rivetage"])
	cd0 += float(c["cd0_par_armement"]) * armement
	if feats.has("tourelle_defensive"):
		cd0 += float(c["cd0_tourelle"])
	# La soute carène l'emport : elle ne sert que si l'avion emporte quelque chose.
	if feats.has("soute_bombes") and float(design["charge_utile_kg"]) > 0.0:
		cd0 += float(c["cd0_soute"])

	# Masses (avant la vitesse : la traînée induite dépend de la masse).
	# COÛT d'équipement DÉGRESSIF avec la COMMUNALITÉ (production de série qui se banalise) :
	# calendrier depuis `date_etat_art` de la techno — un équipement répandu depuis longtemps
	# est produit en masse, donc bon marché ; le bleeding-edge coûte plein pot. (C'est l'INDUSTRIE
	# qui banalise = calendrier ; distinct de la FIABILITÉ, liée à TA recherche — modèle C.)
	var annee_design: float = float(design.get("annee", Etat.AN0))
	var cmp: float = float(c["cout_maturite_plancher"])
	var cms: float = float(c["cout_maturite_span"])
	var masse_features: float = 0.0
	var cout_features: float = 0.0
	for f: String in feats:
		masse_features += float(fc_toutes[f]["masse"])
		var age_dispo: float = annee_design - float((data["technos"][f] as Dictionary)["date_etat_art"])
		var cout_mult: float = lerpf(1.0, cmp, clampf(age_dispo / cms, 0.0, 1.0))
		cout_features += float(fc_toutes[f]["cout"]) * cout_mult
	var carburant: float = float(design["carburant_kg"])
	var charge_utile: float = float(design["charge_utile_kg"])
	var biplan: bool = str(design["formule"]) == "biplan"
	# Biplan : deux ailes plus petites entretoisées par mâts/haubans, moins de matière
	# de longeron qu'un monoplan cantilever — cellule plus légère, en échange de la traînée.
	var mult_cellule: float = float(c["mult_masse_cellule_biplan"]) if biplan else 1.0
	var masse_vide: float = float(moteur["masse_kg"]) + surface * float(c["dens_aile"][structure]) \
		+ float(c["base_cellule"][structure]) * mult_cellule + masse_features + armement * float(c["masse_par_armement"])
	var masse_totale: float = masse_vide + carburant + charge_utile

	var charge_alaire: float = masse_totale / surface

	# Vitesse : parasite + induite (un avion lourd sur petite aile traîne sa portance).
	# Point fixe sur v — converge en quelques itérations, pas besoin de Newton.
	var eta: float = float(c["eta_pas_variable"]) if feats.has("helice_pas_variable") else float(c["eta_helice_fixe"])
	if feats.has("helice_metallique"):
		eta += float(c["eta_bonus_metallique"])
	if feats.has("helice_tripale"):
		eta += float(c["eta_bonus_tripale"])
	if feats.has("helice_contrarotative"):
		eta += float(c["eta_bonus_contrarotative"])
	var p_w: float = float(moteur["puissance_cv"]) * float(c["cv_to_w"])
	var k_ind: float = float(c["k_induit"])
	# Aire de traînée = profil d'AILE (∝ surface) + un terme FIXE fuselage/moteur/train, qui ne
	# dépend PAS de l'aile (retour joueur : la surface pesait trop sur la vitesse). Avant, toute
	# la traînée parasite était proportionnelle à la surface — comme si le fuselage n'existait
	# pas : rétrécir l'aile donnait de la vitesse presque gratuite. Plus juste ET plus jouable.
	var f_fixe: float = float(c["aire_parasite_fixe"])
	var v_ms: float = pow(2.0 * p_w * eta / (float(c["rho"]) * (cd0 * surface + f_fixe)), 1.0 / 3.0)
	for _i: int in range(8):
		var cl: float = masse_totale * 9.81 / (0.5 * float(c["rho"]) * v_ms * v_ms * surface)
		v_ms = pow(2.0 * p_w * eta / (float(c["rho"]) \
			* (cd0 * surface + f_fixe + k_ind * cl * cl * surface)), 1.0 / 3.0)
	var vmax: float = v_ms * 3.6
	if feats.has("suralimentation"):
		vmax *= float(c["bonus_vmax_surales"])
	if feats.has("turbocompresseur"):
		vmax *= float(c["bonus_vmax_turbo"])
	var mania: float = float(c["mania_base"]) - float(c["mania_pente_ca"]) * charge_alaire
	if biplan:
		mania += float(c["mania_bonus_biplan"])
	if feats.has("volets_atterrissage"):
		mania += float(c["mania_bonus_volets"])
	if feats.has("pilote_automatique"):
		mania += float(c["mania_bonus_pa"])
	if feats.has("verriere_goutte"):
		mania += float(c["mania_bonus_verriere"])
	if feats.has("tourelle_defensive"):
		mania -= float(c["mania_malus_tourelle"])
	mania = clampf(mania, 5.0, 100.0)

	var p_kw: float = p_w * eta / 1000.0
	var plafond: float = float(c["plafond_base"]) + float(c["plafond_k"]) * (p_kw / masse_totale)
	if feats.has("suralimentation"):
		plafond += float(c["plafond_bonus_surales"])
	if feats.has("turbocompresseur"):
		plafond += float(c["plafond_bonus_turbo"])
	if feats.has("cabine_pressurisee"):
		plafond += float(c["plafond_bonus_pressu"])

	var carburant_eff: float = carburant
	if feats.has("reservoirs_largables"):
		carburant_eff *= float(c["bonus_autonomie_reservoirs"])
	var croisiere: float = vmax * float(c["croisiere_ratio"])
	var autonomie: float = carburant_eff / float(moteur["conso_kg_h"]) * croisiere
	# Le gonio permet la route directe au lieu du suivi de repères au sol.
	if feats.has("radio_gonio"):
		autonomie *= float(c["bonus_autonomie_gonio"])

	# Fiabilité : somme des composantes nommées (partagées avec l'écran de conception,
	# qui affiche le « pourquoi » du pourcentage) — clampée ici seulement.
	var comp: Dictionary = fiab_composantes(design, data, charge_alaire)
	var fiab: float = float(comp["moteur"]) + float(comp["equipements"]) \
		+ float(comp["cellule"]) + float(comp["surcharge"])
	fiab = clampf(fiab, float(c["fiab_min"]), float(c["fiab_max"]))

	var capacite: float = floorf(charge_utile / float(c["kg_par_passager"]))
	# Remise motoriste (partenariat exclusif) : posée sur le DESIGN par la sim/l'écran —
	# specs reste pure, et tout recalcul (UI, deltas, service) voit le même prix.
	var cout_moteur: float = float(moteur["cout"]) * float(design.get("remise_moteur", 1.0))
	# La CHARGE UTILE coûte de la cellule renforcée (retour joueur : porter plus doit se payer).
	# Coût seul, pas de masse ajoutée — la charge pèse déjà via masse_totale (perf). Le carburant
	# reste hors prix (assimilé à de l'exploitation).
	var cout_unitaire: float = masse_vide * float(c["prix_kg"][structure]) + cout_moteur \
		+ cout_features + armement * float(c["cout_par_armement"]) \
		+ charge_utile * float(c["cout_par_kg_charge"])
	var cout_exploitation: float = float(moteur["conso_kg_h"]) * float(c["exploit_k_conso"]) \
		+ (1.0 - fiab) * float(c["exploit_k_fiab"]) + masse_totale * float(c["exploit_k_masse"])
	# Variante « Mk II » : rabais proto/études TAMPONNÉ par la sim (variante_mults, dégressif
	# selon l'écart de cellule au parent). Défaut 1.0 = design neuf, plein tarif.
	var cout_proto: float = (cout_unitaire * float(c["proto_mult"]) + float(c["proto_fixe"])) \
		* float(design.get("variante_proto_mult", 1.0))
	var delai: float = (float(c["delai_base_sem"]) + float(c["delai_par_feature"]) * float(feats.size())) \
		* float(design.get("variante_delai_mult", 1.0))

	return {
		"vmax_kmh": vmax,
		"charge_alaire": charge_alaire,
		"maniabilite": mania,
		"plafond_m": plafond,
		"autonomie_km": autonomie,
		"fiabilite": fiab,
		"capacite": capacite,
		"armement": armement,
		"masse_vide": masse_vide,
		"masse_totale": masse_totale,
		"cout_unitaire": cout_unitaire,
		"cout_exploitation": cout_exploitation,
		"cout_proto": cout_proto,
		"delai_semaines": delai,
	}


# Composantes de la fiabilité, nommées — moteur, équipements (complexité − bonus dédiés),
# cellule (structure + biplan entretoisé), surcharge structurelle (une cellule chargée
# au-delà de sa limite casse en service). specs() les somme puis clampe ; l'écran de
# conception les affiche telles quelles pour rendre le pourcentage explicable.
static func fiab_composantes(design: Dictionary, data: Dictionary, charge_alaire: float) -> Dictionary:
	var c: Dictionary = data["constants"]["avion"]
	# `moteur_specs` : moteur MAISON tamponné dans le design (sim._nouveau_design), comme
	# `mat_features` — aircraft.gd reste pur et ne connaît pas le state.
	var moteur: Dictionary = design.get("moteur_specs", (data["engines"] as Dictionary).get(str(design["moteur"]), {}))
	var feats: Array = design.get("features", [])
	var structure: String = str(design["structure"])
	# Effet d'équipement MATURÉ DEPUIS TA RECHERCHE (modèle C) : `mat_features[f]` = ans écoulés
	# entre le moment où TU as recherché f et l'année du design — TAMPONNÉ à la création (sim pur :
	# specs ne lit pas le state, la maturité est figée dans le design). Récompense de chercher TÔT :
	# une techno maîtrisée de longue date est fiable ; le bleeding-edge fraîchement recherché coûte
	# plein pot. DEUX familles d'équipement :
	#  • AVIONIQUE (fiab_bonus_max en data : radio, instruments, gonio, PA, cockpit) — pénalité de
	#    JEUNESSE (système capricieux, poids halvé) qui remonte à 0 PUIS devient un BONUS (une aide
	#    éprouvée rend le vol plus sûr) : −malus à la recherche, ~0 à mi-parcours, +fiab_bonus_max
	#    au bout de `fiab_bonus_span` ans. Un radio maîtrisé AMÉLIORE la fiabilité.
	#  • MÉCANIQUE LOURDE (train, turbo, suralim…) : malus qui décroît vers un plancher PROPRE mais
	#    ne devient JAMAIS positif — un train rentrant reste un risque mécanique à vie.
	# FALLBACK (design non tamponné : rivaux, fixtures) : le calendrier depuis `fiab_maturite_epoque`
	# 1936 — les rivaux restent sur ce modèle simple (invisible au joueur, une migration en moins).
	var annee_av: float = float(design.get("annee", Etat.AN0))
	var mat_ans: float = float(c["fiab_maturite_ans"])
	var epoque: float = float(c["fiab_maturite_epoque"])
	var bonus_span: float = float(c["fiab_bonus_span"])
	var plancher_defaut: float = float(c["fiab_malus_plancher"])
	var mats: Dictionary = design.get("mat_features", {})
	var progres_defaut: float = maxf(0.0, annee_av - epoque)
	var equipements: float = 0.0
	for f: String in feats:
		var fc_f: Dictionary = data["constants"]["features_avion"][f]
		# Poids de malus propre à l'équipement (défaut 1.0) : l'avionique légère ne tare pas la CELLULE.
		var poids_f: float = float(fc_f.get("fiab", 1.0))
		var malus_plein: float = float(moteur["fiabilite"]) * float(c["fiab_malus_par_feature"]) * poids_f
		var progres: float = float(mats.get(f, progres_defaut))
		if fc_f.has("fiab_bonus_max"):
			var t: float = clampf(progres / bonus_span, 0.0, 1.0)
			equipements += lerpf(-malus_plein, float(fc_f["fiab_bonus_max"]), t)
		else:
			var plancher_f: float = float(fc_f.get("fiab_plancher", plancher_defaut))
			var maturite: float = clampf(1.0 - progres / mat_ans, plancher_f, 1.0)
			equipements -= malus_plein * maturite
	if feats.has("demarreur_electrique"):
		equipements += float(c["fiab_bonus_demarreur"])
	if feats.has("blindage_pilote"):
		equipements += float(c["fiab_bonus_blindage"])
	if feats.has("reservoir_autoetanche"):
		equipements += float(c["fiab_bonus_autoetanche"])
	var cellule: float = float(c["fiab_bonus_structure"][structure])
	if str(design["formule"]) == "biplan":
		cellule += float(c["fiab_bonus_biplan"])
	var surcharge: float = maxf(charge_alaire - float(c["ca_limite"][structure]), 0.0)
	return {
		"moteur": float(moteur["fiabilite"]),
		"equipements": equipements,
		"cellule": cellule,
		"surcharge": -float(c["fiab_malus_surcharge"]) * surcharge,
	}


# Delta chiffré d'un équipement sur UN design donné : specs(avec f) − specs(sans f).
# Recalculé par les vraies formules — l'affichage ne peut pas se désynchroniser du modèle.
static func delta_feature(design: Dictionary, data: Dictionary, f: String) -> Dictionary:
	var sans: Dictionary = design.duplicate(true)
	(sans["features"] as Array).erase(f)
	var avec: Dictionary = sans.duplicate(true)
	(avec["features"] as Array).append(f)
	var s_sans: Dictionary = specs(sans, data)
	var s_avec: Dictionary = specs(avec, data)
	var delta: Dictionary = {}
	for cle: String in Etat.cles_triees(s_avec):
		delta[cle] = float(s_avec[cle]) - float(s_sans[cle])
	return delta


# Meilleur moteur disponible à une date donnée, selon la préférence de la maison.
# `bots_ignorent` (data) écarte les moteurs-pièges (Vulture, Sabre : puissants, infiables) —
# la naïveté « puissance brute » des automates les choisirait ; le piège est pour le joueur.
static func meilleur_moteur(data: Dictionary, annee: float, pref: String) -> String:
	var meilleur: String = ""
	var score: float = -1e18
	for id_m: String in Etat.cles_triees(data["engines"]):
		var m: Dictionary = data["engines"][id_m]
		if float(m["annee"]) > annee or bool(m.get("bots_ignorent", false)):
			continue
		var s: float = 0.0
		if pref == "eco":
			s = float(m["puissance_cv"]) / maxf(float(m["cout"]), 1.0) * 1000.0
		else:
			s = float(m["puissance_cv"])
		if s > score:
			score = s
			meilleur = id_m
	return meilleur
