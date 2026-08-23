# Raison d'être : le cœur marchand — allocation trimestrielle des ventes (formules du GDD §2),
# maisons rivales vivantes incluses ; toute itération de Dictionary passe par des clés triées
# pour rester déterministe après save/load (l'ordre d'insertion change à la relecture JSON).
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Rng := preload("res://sim/rng.gd")
const Avion := preload("res://sim/aircraft.gd")
const Reputation := preload("res://sim/reputation.gd")
const Production := preload("res://sim/production.gd")
const Contrats := preload("res://sim/contracts.gd")
const Recherche := preload("res://sim/research.gd")
const Comptes := preload("res://sim/comptes.gd")


static func annee_de(state: Dictionary) -> float:
	return Etat.AN0 + float(state["tick"]) / 52.0


# Interpolation linéaire sur une courbe [[x, y], ...] triée, plate aux extrémités.
static func interp(points: Array, x: float) -> float:
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


static func init_rivaux(state: Dictionary, data: Dictionary) -> void:
	_rivaux_renouveler(state, data, Etat.AN0)


static func trimestre(state: Dictionary, data: Dictionary) -> void:
	var annee: float = annee_de(state)
	_rivaux_renouveler(state, data, annee)
	# Capacité partagée du trimestre, consommée segment par segment (ordre trié, assumé).
	var cap: Dictionary = {"joueur": Production.capacite(state, data)}
	for maison: String in Etat.cles_triees(state["rivaux"]):
		# .get : les sauvegardes d'avant l'étape ⑤ n'ont pas de capacité vivante.
		cap[maison] = float((state["rivaux"][maison] as Dictionary).get("capacite",
			data["rivals"]["maisons"][maison]["capacite_trim"]))
	# Grèves, motoriste en retard : les semaines gelées du trimestre rognent la capacité.
	var gels: Dictionary = state["gels"]
	if float(gels["gele_trim"]) > 0.0:
		cap["joueur"] = floorf(float(cap["joueur"]) * (1.0 - float(gels["gele_trim"]) / 13.0))
		gels["gele_trim"] = 0.0
	# Capacité de référence du trimestre : figée APRÈS le gel, AVANT toute consommation.
	# C'est elle que voit le facteur délai du marché — sinon, pendant une grève, les clients
	# jugeaient le carnet du joueur à l'aune d'une capacité qu'il n'a plus.
	var cap_ref: Dictionary = cap.duplicate()
	# ALLOCATION D'ATELIER (retour playtest n°7 : « la fin de partie n'a plus de décision »).
	# La part réservée au marché est mise de côté AVANT les séries d'État — la priorité d'État
	# n'est plus absolue, c'est vous qui arbitrez. Défaut 0 : comportement historique intact,
	# donc les bots (qui n'y touchent pas) sont neutres au harnais.
	var reserve: float = floorf(float(cap["joueur"])
		* clampf(float(state.get("alloc_marche", 0.0)), 0.0, 1.0))
	cap["joueur"] = float(cap["joueur"]) - reserve
	Contrats.livrer_trimestre(state, data, cap)
	cap["joueur"] = float(cap["joueur"]) + reserve
	_produire_stock(state, data, cap)
	_filiale_commandes(state, data)
	for nom_seg: String in Etat.cles_triees(data["segments"]):
		_allouer(state, data, nom_seg, annee, cap, cap_ref)
	_entretien_flotte(state, data)
	_rivaux_reagir(state, data)
	_rivaux_rd(state, data, annee)
	_fusion(state, data, annee)


# FUSION DES RIVAUX (playtest n°7 : « le milieu de partie est plat, je domine facilement ») —
# deux maisons moyennes qui perdent le marché face au même adversaire finissent par se
# rapprocher : Hawker Siddeley 1935, Vickers-Armstrongs 1927. Au-delà de `seuil_part` de part
# joueur moyenne sur les segments tenus, pendant `trimestres` consécutifs, Bristow et Marlowe
# n'en font plus qu'une : capacités, caisses de R&D, technos et réputations CUMULÉES.
# Déterministe, zéro RNG. Dormant au harnais (un bot ne domine jamais assez longtemps).
static func _fusion(state: Dictionary, data: Dictionary, annee: float) -> void:
	var regles: Dictionary = data["rivals"]["regles"]
	if not regles.has("fusion"):
		return
	var cf: Dictionary = regles["fusion"]
	var rivaux: Dictionary = state["rivaux"]
	# Une seule maison : la fusion a déjà eu lieu (ou la partie n'en a qu'une).
	if rivaux.size() < 2 or annee < float(cf["annee_min"]):
		return
	if _part_joueur_globale(state) > float(cf["seuil_part"]):
		state["fusion_compteur"] = float(state.get("fusion_compteur", 0.0)) + 1.0
	else:
		state["fusion_compteur"] = 0.0
	if float(state["fusion_compteur"]) < float(cf["trimestres"]):
		return
	# Maison d'accueil : celle dont la clé porte le préfixe d'uid attendu par l'histogramme.
	var cible: String = ""
	for maison: String in Etat.cles_triees(data["rivals"]["maisons"]):
		if bool((data["rivals"]["maisons"][maison] as Dictionary).get("fusion_only", false)):
			cible = maison
	if cible == "" or rivaux.has(cible):
		return
	var absorbees: Array = Etat.cles_triees(rivaux)
	var neuf: Dictionary = {
		"rd_pool": 0.0, "ca_trim": 0.0, "nb_produits": 0.0, "capacite": 0.0,
		"technos": [], "catalogue": {}, "rep": {"civile": 0.0, "militaire": 0.0},
	}
	for maison_v: Variant in absorbees:
		var riv: Dictionary = rivaux[str(maison_v)]
		neuf["rd_pool"] = float(neuf["rd_pool"]) + float(riv["rd_pool"])
		neuf["nb_produits"] = float(neuf["nb_produits"]) + float(riv["nb_produits"])
		neuf["capacite"] = float(neuf["capacite"]) + float(riv["capacite"])
		for t_v: Variant in riv["technos"]:
			if not (neuf["technos"] as Array).has(str(t_v)):
				(neuf["technos"] as Array).append(str(t_v))
		for domaine: String in ["civile", "militaire"]:
			neuf["rep"][domaine] = maxf(float(neuf["rep"][domaine]), float(riv["rep"][domaine]))
	neuf["capacite"] = minf(float(neuf["capacite"]), float(cf["capacite_max"]))
	(neuf["technos"] as Array).sort()
	# LES DEUX GAMMES SONT CONSERVÉES, entières. Première version : on ne gardait que le
	# meilleur appareil par segment — ça RETIRAIT un concurrent du marché (la part se calcule
	# au carré PAR PRODUIT puis se somme par maison : deux avions moyens pèsent plus que le
	# meilleur des deux seul), et le harnais l'a vu tout de suite — le bot pionnier passait de
	# 41 % à 61 % de victoires. Une fusion doit RENFORCER l'adversaire, pas l'amputer.
	# Bonus : les uid ne bougent pas, donc la table des parts n'a rien à rattraper.
	for maison_v: Variant in absorbees:
		var rcat: Dictionary = rivaux[str(maison_v)]["catalogue"]
		for uid_r: String in Etat.cles_triees(rcat):
			neuf["catalogue"][uid_r] = rcat[uid_r]
	for maison_v: Variant in absorbees:
		rivaux.erase(str(maison_v))
	rivaux[cible] = neuf
	var noms: Array = []
	for maison_v: Variant in absorbees:
		noms.append(str(data["rivals"]["maisons"][str(maison_v)]["nom"]))
	(state["presse"] as Array).append({"titre": "LES DEUX MAISONS N'EN FONT PLUS QU'UNE",
		"corps": "%s annoncent leur rapprochement sous le nom de %s. Bureaux d'études réunis, chaînes mises en commun : la City parle d'une réponse à votre domination." \
			% [" et ".join(noms), str(data["rivals"]["maisons"][cible]["nom"])]})


# Production pour stock : la commande d'atelier passe APRÈS les séries d'État et AVANT le
# marché — payée à la construction (coût unitaire), les appareils dorment au hangar.
static func _produire_stock(state: Dictionary, data: Dictionary, cap: Dictionary) -> void:
	var commandes: Dictionary = state.get("stock_commande", {})
	# Trace du trimestre : ces appareils consomment la capacité d'atelier et sont PAYÉS ici,
	# mais n'apparaissaient dans aucun compteur — d'où l'impression qu'ils sortaient de nulle
	# part, gratuits et hors file de production (retour joueur).
	var produit_trim: Dictionary = {}
	for uid: String in Etat.cles_triees(commandes):
		if not (state["catalogue"] as Dictionary).has(uid):
			commandes.erase(uid)
			continue
		var construire: float = minf(float(commandes[uid]), float(cap["joueur"]))
		# On construit CE QU'ON PEUT PAYER, pas tout ou rien : la commande était sinon
		# abandonnée en bloc dès qu'il manquait de quoi payer le dernier appareil, et
		# restait « en atelier » pour toujours sans un mot (retour playtest n°7 :
		# « +5 au hangar les met en atelier sans rien faire d'autre »).
		var pu: float = maxf(float(state["catalogue"][uid]["specs"]["cout_unitaire"]), 1.0)
		construire = minf(construire, floorf(maxf(float(state["tresorerie"]), 0.0) / pu))
		if construire <= 0.0:
			continue
		var cout: float = construire * pu
		cap["joueur"] = float(cap["joueur"]) - construire
		state["tresorerie"] = float(state["tresorerie"]) - cout
		Comptes.note(state, "production", -cout)
		state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout
		var stock: Dictionary = state["stock"]
		stock[uid] = float(stock.get(uid, 0.0)) + construire
		produit_trim[uid] = float(produit_trim.get(uid, 0.0)) + construire
		commandes[uid] = float(commandes[uid]) - construire
		if float(commandes[uid]) <= 0.0:
			commandes.erase(uid)
	state["stock_produit_trim"] = produit_trim


# Filiale coloniale : quelques commandes captives par trimestre sur le produit civil
# le plus récent — le débouché qui justifie l'investissement.
static func _filiale_commandes(state: Dictionary, data: Dictionary) -> void:
	if not bool(state.get("filiale", false)):
		return
	var recent: String = ""
	var annee_max: float = -1.0
	for uid: String in Etat.cles_triees(state["catalogue"]):
		var seg_p: String = str(state["catalogue"][uid]["segment"])
		if seg_p != "export_militaire" and float(state["catalogue"][uid]["annee"]) > annee_max:
			annee_max = float(state["catalogue"][uid]["annee"])
			recent = uid
	if recent != "":
		state["catalogue"][recent]["carnet"] = float(state["catalogue"][recent]["carnet"]) \
			+ float(data["constants"]["filiale"]["commandes_trim"])


# Contrats d'entretien : revenu par appareil encore en service (livraisons des N derniers
# trimestres), proportionnel à la fiabilité — la fiabilité paie une seconde fois.
static func _entretien_flotte(state: Dictionary, data: Dictionary) -> void:
	if not bool(state.get("entretien_flotte", false)):
		return
	var ce: Dictionary = data["constants"]["entretien_flotte"]
	var revenu: float = 0.0
	for uid: String in Etat.cles_triees(state["catalogue"]):
		var produit: Dictionary = state["catalogue"][uid]
		revenu += flotte_en_service(state, uid, str(produit["segment"]), int(ce["trimestres_service"])) \
			* float(ce["fee_trim_par_appareil"]) * float(produit["specs"]["fiabilite"])
	if revenu > 0.0:
		state["tresorerie"] = float(state["tresorerie"]) + revenu
		Comptes.note(state, "entretien", revenu)
		state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) + revenu


# Appareils du produit encore en service : livraisons des N derniers trimestres (publique,
# l'UI affiche l'assiette du contrat d'entretien).
static func flotte_en_service(state: Dictionary, uid: String, nom_seg: String, n_trim: int) -> float:
	var marche: Dictionary = state["marche"]
	if not marche.has(nom_seg):
		return 0.0
	var hist: Array = marche[nom_seg]["historique"]
	var total: float = 0.0
	for i: int in range(maxi(0, hist.size() - n_trim), hist.size()):
		total += float((hist[i]["ventes"] as Dictionary).get(uid, 0.0))
	return total


# --- allocation d'un segment -------------------------------------------------

static func _allouer(state: Dictionary, data: Dictionary, nom_seg: String, annee: float, cap: Dictionary, cap_ref: Dictionary) -> void:
	var seg: Dictionary = data["segments"][nom_seg]
	var marche: Dictionary = state["marche"]
	if not marche.has(nom_seg):
		marche[nom_seg] = {"parts": {}, "historique": []}
	var etat_seg: Dictionary = marche[nom_seg]
	var parts: Dictionary = etat_seg["parts"]
	# Aléa de conjoncture (seedé) : tiré AVANT toute sortie anticipée pour garder
	# le flux RNG identique quel que soit l'état des catalogues.
	var amp: float = float(data["constants"]["marche"]["alea_demande"])
	var alea: float = 1.0 + amp * (2.0 * Rng.reel(state) - 1.0)
	var lice: Array = produits_du_segment(state, nom_seg)
	if lice.is_empty():
		etat_seg["parts"] = {}
		return

	# Prix médian du segment, UNE VOIX PAR MAISON : chaque maison pèse pour la médiane de SES
	# prix, puis on prend la médiane des maisons. Sur la liste brute, une maison qui aligne
	# 3 produits sur 5 FIXAIT la médiane (playtest n°11 : elle valait exactement le prix du
	# joueur) et étranglait le `f_prix` de ses concurrents, tombé à 0.43 — inonder un segment
	# de modèles bon marché n'avantageait pas son auteur, ça affamait les autres.
	var prix_par_maison: Dictionary = {}
	for e: Dictionary in lice:
		var m: String = str(e["maison"])
		if not prix_par_maison.has(m):
			prix_par_maison[m] = []
		(prix_par_maison[m] as Array).append(float(e["produit"]["prix"]))
	var prix_tous: Array = []
	for m: String in Etat.cles_triees(prix_par_maison):
		prix_tous.append(_mediane(prix_par_maison[m]))
	var prix_median: float = _mediane(prix_tous)

	# Attractivités → parts cibles (k = 2 accentue les écarts).
	# EMPILEMENT : la part se prend au carré PAR PRODUIT puis se somme par maison, donc deux
	# modèles jumeaux valent √2 fois un seul — mesuré à 13 points de part sur le save d'un
	# joueur qui n'en alignait que DEUX. `empilement_maison` (1.0 = comportement historique)
	# applique un rendement décroissant au n-ième modèle d'une même maison sur un segment.
	# ⚠ MINE DOCUMENTÉE (étape 11) : les bots empilent aussi, et un correctif antérieur qui
	# leur forçait le renouvellement avait envoyé le glouton de 50 % à 100 % de faillites.
	# D'où le cadran en data : on mesure à 1.0 (témoin) avant de le bouger.
	var empil: float = float((data["constants"]["marche"] as Dictionary).get("empilement_maison", 1.0))
	var n_maison: Dictionary = {}
	for e: Dictionary in lice:
		var mm: String = str(e["maison"])
		n_maison[mm] = int(n_maison.get(mm, 0)) + 1
	var rang: Dictionary = {}
	var poids: Dictionary = {}
	var somme_a2: float = 0.0
	for e: Dictionary in lice:
		var a: float = _attractivite(state, data, seg, e, annee, prix_median, cap_ref)
		var mm2: String = str(e["maison"])
		var k: int = int(rang.get(mm2, 0))
		rang[mm2] = k + 1
		poids[str(e["uid"])] = a * a * pow(empil, float(k))
		somme_a2 += float(poids[str(e["uid"])])

	# Produits disparus : on retire leurs parts (renormalisées ensuite).
	var uids_en_lice: Array = []
	for e: Dictionary in lice:
		uids_en_lice.append(str(e["uid"]))
	for uid: String in Etat.cles_triees(parts):
		if not uids_en_lice.has(uid):
			parts.erase(uid)

	# Inertie : les clients sont fidèles, 20 % de rattrapage par trimestre.
	var inertie: float = float(data["constants"]["marche"]["inertie"])
	for e: Dictionary in lice:
		var uid_p: String = str(e["uid"])
		var cible: float = float(poids[uid_p]) / somme_a2 if somme_a2 > 0.0 else 1.0 / float(lice.size())
		var actuelle: float = float(parts.get(uid_p, 0.0))
		parts[uid_p] = actuelle + (cible - actuelle) * inertie
	var somme_p: float = 0.0
	for uid: String in Etat.cles_triees(parts):
		somme_p += float(parts[uid])
	if somme_p > 0.0:
		for uid: String in Etat.cles_triees(parts):
			parts[uid] = float(parts[uid]) / somme_p

	# Commandes, livraisons plafonnées par capacité, carnet (annulé au-delà de 4 trimestres).
	var demande_trim: float = interp(seg["demande"], annee) / 4.0 * alea
	# Événements : Lindbergh, Munich, mobilisation... modulent la demande du segment.
	for m: Dictionary in state["modificateurs"]:
		if str(m["segment"]) == nom_seg:
			demande_trim *= float(m["mult"])
	var carnet_max_mult: float = float(data["constants"]["marche"]["carnet_max_trim"])
	var ventes_hist: Dictionary = {}
	for e: Dictionary in lice:
		var uid_p: String = str(e["uid"])
		var produit: Dictionary = e["produit"]
		var maison: String = str(e["maison"])
		var commandes: float = roundf(demande_trim * float(parts[uid_p]))
		var carnet: float = float(produit["carnet"]) + commandes
		var dispo: float = float(cap.get(maison, 0.0))
		# Le hangar livre D'ABORD (immédiat, sans consommer la capacité) — c'est tout
		# l'intérêt de produire pour stock ; le reste passe par l'atelier.
		var du_stock: float = 0.0
		if maison == "joueur":
			var stock: Dictionary = state.get("stock", {})
			du_stock = minf(carnet, float(stock.get(uid_p, 0.0)))
			if du_stock > 0.0:
				stock[uid_p] = float(stock[uid_p]) - du_stock
				if float(stock[uid_p]) <= 0.0:
					stock.erase(uid_p)
		var via_atelier: float = minf(carnet - du_stock, dispo)
		var livrees: float = du_stock + via_atelier
		cap[maison] = dispo - via_atelier
		carnet -= livrees
		var carnet_max: float = carnet_max_mult * maxf(livrees, 1.0)
		if carnet > carnet_max:
			carnet = carnet_max
		produit["carnet"] = carnet
		if float(parts[uid_p]) > float(produit["pic_part"]):
			produit["pic_part"] = float(parts[uid_p])
		ventes_hist[uid_p] = livrees
		var ca: float = livrees * float(produit["prix"])
		var fiab: float = float(produit["specs"]["fiabilite"])
		if maison == "joueur":
			# Marge = prix − coût_unitaire ; les appareils sortis du hangar ont DÉJÀ été
			# payés à la construction — seule la part atelier supporte un coût ici.
			var cout_prod: float = via_atelier * float(produit["specs"]["cout_unitaire"])
			var marge: float = ca - cout_prod
			state["tresorerie"] = float(state["tresorerie"]) + marge
			Comptes.note(state, "ventes", ca)
			Comptes.note(state, "production", -cout_prod)
			state["stats"]["livraisons"] = float(state["stats"]["livraisons"]) + livrees
			state["stats"]["ca_cumule"] = float(state["stats"]["ca_cumule"]) + ca
			state["stats"]["marge_cumulee"] = float(state["stats"]["marge_cumulee"]) + marge
			Reputation.livraisons(state, data, str(seg["domaine_repu"]), livrees, fiab)
		else:
			var riv: Dictionary = state["rivaux"][maison]
			riv["ca_trim"] = float(riv["ca_trim"]) + ca
			Reputation.livraisons_rival(riv, data, str(seg["domaine_repu"]), livrees, fiab)

	var hist: Array = etat_seg["historique"]
	hist.append({"annee": snappedf(annee, 0.01), "ventes": ventes_hist})
	if hist.size() > 80:
		hist.pop_front()


# Qualité d'un jeu de specs sur un segment — PUBLIQUE : l'écran blueprint l'affiche en
# direct pour que le joueur sache si son avion se vendra AVANT de payer le prototype.
static func qualite_segment(data: Dictionary, nom_seg: String, specs_p: Dictionary, annee: float, rep: float) -> float:
	var seg: Dictionary = data["segments"][nom_seg]
	var cm: Dictionary = data["constants"]["marche"]
	var qualite: float = 0.0
	var penalite: float = 1.0
	for crit: Dictionary in seg["criteres"]:
		var val: float = 0.0
		if str(crit["spec"]) == "reputation":
			val = rep
		else:
			val = float(specs_p[str(crit["spec"])])
		var ref: float = interp(crit["ref"], annee)
		var ratio: float = 0.0
		if bool(crit["inverse"]):
			ratio = ref / maxf(val, 0.0001)
		else:
			ratio = val / maxf(ref, 0.0001)
		# Plafond PAR CRITÈRE, `clamp_qualite` à défaut : le coût d'un chasseur est plafonné à 1.0
		# (playtest n°9), sinon le prix bas est compté DEUX FOIS — une fois ici en banquant
		# jusqu'à 1.4, une seconde en `f_prix`. C'est ce double dividende qui faisait qu'un
		# chasseur de 1941 à 346 km/h notait MIEUX (1.04) qu'un rival de 1944 à 566 (0.99) :
		# il perdait 0.09 sur la vitesse et se refaisait 0.19 sur le coût. Être moins cher que
		# la référence cesse donc de RAPPORTER au-delà de la référence. Ni les poids ni `f_prix`
		# ne bougent — les deux avaient été essayés et enrichissaient les bots (cf. CLAUDE.md).
		qualite += float(crit["poids"]) * clampf(ratio, 0.0,
			float(crit.get("clamp", cm["clamp_qualite"])))
		# DÉFAILLANCE RÉDHIBITOIRE : un critère de conception effondré ne se rachète pas sur
		# les autres. Sans ça, un avion de 1922 qui n'emporte que 3 passagers là où le marché
		# en veut 18 (ratio 0.17) se refaisait sur son coût d'exploitation dérisoire (plafonné
		# à 1.4) et gardait 74 % de l'attrait d'un modèle NEUF dix-sept ans plus tard — le jeu
		# n'incitait donc jamais à renouveler sa gamme (retour joueur). La réputation est
		# exclue : elle juge la MAISON, pas l'avion, et serait au plancher en début de partie.
		# `hors_penalite` en data exclut aussi le COÛT (playtest n°10) : la pénalité dit « un
		# critère de CONCEPTION effondré ne se rachète pas », et un prix n'est pas une
		# conception — un avion cher fait quand même le travail. Sans ce garde-fou le seul
		# chasseur MODERNE du joueur (653 km/h, 6 armes) était puni à 0.851 pour son coût,
		# alors que son coucou de 1930 gardait une pénalité de 1.0 : l'asymétrie jouait à
		# l'envers de l'intention, et l'avion cher était puni DEUX fois (ici et par `f_prix`).
		if str(crit["spec"]) != "reputation" and not bool(crit.get("hors_penalite", false)) \
				and float(crit["poids"]) >= float(cm["critique_poids_min"]):
			penalite = minf(penalite, clampf(ratio / float(cm["critique_seuil"]),
				float(cm["critique_plancher"]), 1.0))
	return qualite * penalite


# Diagnostic d'obsolescence pour l'écran Marché (hors chemin chaud de l'allocation, qui
# n'alloue pas) : la note du segment + le critère le PLUS en retard sur les attentes de
# l'année. La note décroît quand les réf. montent et que les specs restent figées → obsolète.
static func diagnostic_segment(data: Dictionary, nom_seg: String, specs_p: Dictionary, annee: float, _rep: float) -> Dictionary:
	var seg: Dictionary = data["segments"][nom_seg]
	var cm: Dictionary = data["constants"]["marche"]
	var note: float = 0.0
	var poids_total: float = 0.0
	var faible_nom: String = ""
	var faible_ratio: float = 1e18
	for crit: Dictionary in seg["criteres"]:
		# La RÉPUTATION est exclue : c'est la notoriété de la MAISON, pas l'âge de l'avion. En
		# début de partie elle est au plancher et faisait afficher « vieillissant » sur un
		# appareil flambant neuf (retour joueur) — et seulement dans les segments qui la notent.
		if str(crit["spec"]) == "reputation":
			continue
		var ref: float = interp(crit["ref"], annee)
		var val: float = float(specs_p[str(crit["spec"])])
		var ratio: float = (ref / maxf(val, 0.0001)) if bool(crit["inverse"]) else (val / maxf(ref, 0.0001))
		# Même plafond par critère que `qualite_segment` : l'étiquette d'obsolescence du Marché
		# doit juger sur la règle qui décide réellement des parts, sinon elle ment.
		note += float(crit["poids"]) * clampf(ratio, 0.0,
			float(crit.get("clamp", cm["clamp_qualite"])))
		poids_total += float(crit["poids"])
		if ratio < faible_ratio:
			faible_ratio = ratio
			faible_nom = str(crit["nom"])
	# Renormalisé sur les seuls critères de CONCEPTION : 1.0 = pile les attentes de l'année,
	# quel que soit le nombre de critères du segment.
	return {"note": note / maxf(poids_total, 0.0001), "faible_nom": faible_nom, "faible_ratio": faible_ratio}


static func _mediane(valeurs: Array) -> float:
	var v: Array = valeurs.duplicate()
	v.sort()
	var n: int = v.size()
	if n == 0:
		return 0.0
	var milieu: int = floori(float(n) / 2.0)
	if n % 2 == 0:
		return (float(v[milieu - 1]) + float(v[milieu])) / 2.0
	return float(v[milieu])


static func _attractivite(state: Dictionary, data: Dictionary, seg: Dictionary, e: Dictionary, annee: float, prix_median: float, cap_ref: Dictionary) -> float:
	var produit: Dictionary = e["produit"]
	var maison: String = str(e["maison"])
	var cm: Dictionary = data["constants"]["marche"]
	var rep: float = _rep_maison(state, maison, str(seg["domaine_repu"]))
	var qualite: float = qualite_segment(data, str(produit["segment"]), produit["specs"], annee, rep)
	if maison != "joueur":
		qualite += float(data["rivals"]["maisons"][maison]["biais_qualite"])

	var prix: float = float(produit["prix"])
	# Le rabais de prix est BORNÉ : sans ça un appareil vendu 3× moins cher que la médiane
	# valait ×3.9 d'attrait, donc ×15 de part (elle se calcule au carré) — et comme la
	# pénalité d'obsolescence est bornée (critique_plancher) alors que le rabais ne l'était
	# pas, vendre du dépassé pas cher devenait la stratégie dominante : un transport de 1931
	# tenait encore 92 % de son segment en 1945 (playtest n°8). Le prix reste un levier, il
	# cesse d'être LE levier.
	# ... et le plafond est CONDITIONNEL AU RESPECT DU CAHIER DES CHARGES : casser les prix ne
	# paie à plein que si l'appareil tient les attentes de l'époque (qualité ≥ 1). Sans ça, un
	# chasseur de 1930 à 348 km/h (qualité 0.77 contre 1.00 au rival) tenait 26 % de l'export
	# en 1945 uniquement parce qu'il coûtait le tiers du prix — ×2 d'attrait, ×4 de part, et la
	# mécanique de qualité disait pourtant correctement que c'était un mauvais avion. Baisser
	# `clamp_prix` pour tous avait été mesuré CONTRE-PRODUCTIF (il désarme la guerre des prix
	# des rivaux, qui sont conformes) : le plafond doit dépendre de la conformité, pas du camp.
	# `clamp_prix_conformite` dose la conditionnalité (0 = plafond plat pour tous, 1 = plafond
	# entièrement indexé sur la conformité) — en data, c'est un réglage d'équilibrage.
	var conformite: float = lerpf(1.0, clampf(qualite, 0.0, 1.0),
		float(cm["clamp_prix_conformite"]))
	var plafond_prix: float = 1.0 + (float(cm["clamp_prix"]) - 1.0) * conformite
	var f_prix: float = minf(pow(prix_median / maxf(prix, 1.0), float(cm["elasticite_prix"])),
		plafond_prix)
	var f_repu: float = float(cm["repu_base"]) + float(cm["repu_k"]) * rep
	var cap_trim: float = float(cap_ref.get(maison, 1.0))
	# Le hangar rassure les clients : un carnet couvert par du stock livre immédiatement.
	var carnet_eff: float = float(produit["carnet"])
	if maison == "joueur":
		carnet_eff = maxf(carnet_eff - float((state.get("stock", {}) as Dictionary).get(str(e["uid"]), 0.0)), 0.0)
	var trim_carnet: float = carnet_eff / maxf(cap_trim, 1.0)
	var f_delai: float = 1.0 / (1.0 + float(cm["delai_k"]) * trim_carnet)
	return maxf(qualite, 0.0) * f_prix * f_repu * f_delai


static func _rep_maison(state: Dictionary, maison: String, domaine: String) -> float:
	if maison == "joueur":
		return float(state["rep"][domaine])
	return float(state["rivaux"][maison]["rep"][domaine])


# Public : l'écran marché s'en sert pour le prix médian sans redupliquer le recensement.
static func produits_du_segment(state: Dictionary, nom_seg: String) -> Array:
	var liste: Array = []
	var cat: Dictionary = state["catalogue"]
	for uid: String in Etat.cles_triees(cat):
		if str(cat[uid]["segment"]) == nom_seg:
			liste.append({"uid": uid, "maison": "joueur", "produit": cat[uid]})
	var rivaux: Dictionary = state["rivaux"]
	for maison: String in Etat.cles_triees(rivaux):
		var rcat: Dictionary = rivaux[maison]["catalogue"]
		for uid: String in Etat.cles_triees(rcat):
			if str(rcat[uid]["segment"]) == nom_seg:
				liste.append({"uid": uid, "maison": maison, "produit": rcat[uid]})
	return liste


# --- maisons rivales ----------------------------------------------------------

# Rivaux réactifs (étape ⑤, retour playtest n°4 « ils ne concurrencent pas ») —
# déterministe, zéro RNG : après l'allocation du trimestre, chaque maison ajuste
# (1) sa capacité si son carnet déborde, (2) ses prix produit par produit : rabot
# quand le joueur fait mieux qu'elle sur le segment, remontée vers sa marge cible
# sinon — bornés entre marge_min et la marge d'affichage de la maison.
static func _rivaux_reagir(state: Dictionary, data: Dictionary) -> void:
	var regles: Dictionary = data["rivals"]["regles"]
	for maison: String in Etat.cles_triees(state["rivaux"]):
		var riv: Dictionary = state["rivaux"][maison]
		var drv: Dictionary = data["rivals"]["maisons"][maison]
		var capa: float = float(riv.get("capacite", drv["capacite_trim"]))
		var carnet_total: float = 0.0
		for uid: String in Etat.cles_triees(riv["catalogue"]):
			carnet_total += float(riv["catalogue"][uid]["carnet"])
		if carnet_total > float(regles["exp_carnet_mult"]) * capa and capa < float(regles["capacite_max"]):
			capa += 1.0
		riv["capacite"] = capa
		for uid: String in Etat.cles_triees(riv["catalogue"]):
			var p: Dictionary = riv["catalogue"][uid]
			var nom_seg: String = str(p["segment"])
			if not (state["marche"] as Dictionary).has(nom_seg):
				continue
			var parts: Dictionary = state["marche"][nom_seg]["parts"]
			var part_joueur: float = 0.0
			for u2: String in Etat.cles_triees(parts):
				if u2.begins_with("p"):
					part_joueur += float(parts[u2])
			var prix: float = float(p["prix"])
			if part_joueur > float(parts.get(uid, 0.0)):
				prix *= 1.0 - float(regles["prix_pas"])
			else:
				prix *= 1.0 + float(regles["prix_pas"])
			var cout: float = float(p["specs"]["cout_unitaire"])
			p["prix"] = clampf(prix, cout * (1.0 + float(regles["marge_min"])),
				cout * (1.0 + float(drv["marge_prix"])))


static func _rivaux_renouveler(state: Dictionary, data: Dictionary, annee: float) -> void:
	var cm: Dictionary = data["constants"]["marche"]
	for maison: String in Etat.cles_triees(state["rivaux"]):
		var riv: Dictionary = state["rivaux"][maison]
		var drv: Dictionary = data["rivals"]["maisons"][maison]
		for nom_seg_v: Variant in drv["segments"]:
			var nom_seg: String = str(nom_seg_v)
			# TOUS les appareils du segment, pas seulement le premier : une maison issue d'une
			# fusion en aligne deux, et sans cette boucle le second ne serait jamais renouvelé
			# (il vieillirait à vie pendant que l'autre se modernise).
			var actifs: Array = []
			for uid_c: String in Etat.cles_triees(riv["catalogue"]):
				if str(riv["catalogue"][uid_c]["segment"]) == nom_seg:
					actifs.append(uid_c)
			if actifs.is_empty():
				# MESURÉ puis ABANDONNÉ (playtest n°7 « ils lancent partout et moi un seul ») :
				# facturer l'ouverture d'un segment au rd_pool rival, même à 12 000 £, fait
				# passer la trésorerie du joueur de 191 k£ à ~800 k£ dès 1923 (part de marché
				# AU CARRÉ : un trimestre de marché dégarni se capitalise) et inflate toute
				# l'économie jusqu'en 1932. La couverture rivale dès 1922 est PORTEUSE : c'est
				# elle qui tient les premières années. Ne pas la retirer sans re-calibrer §15.2.
				_rival_lancer_produit(state, data, maison, nom_seg, annee)
				continue
			for actif_v: Variant in actifs:
				var actif: String = str(actif_v)
				var p: Dictionary = riv["catalogue"][actif]
				var part: float = 0.0
				var part_joueur: float = 0.0
				if state["marche"].has(nom_seg):
					var parts: Dictionary = state["marche"][nom_seg]["parts"]
					part = float(parts.get(actif, 0.0))
					for u2: String in Etat.cles_triees(parts):
						if u2.begins_with("p"):
							part_joueur += float(parts[u2])
				var pic: float = float(p["pic_part"])
				var age: float = annee - float(p["annee"])
				var declasse: bool = pic > 0.02 and part < float(cm["seuil_renouvellement"]) * pic \
						and age > float(cm["age_min_renouvellement"])
				# Riposte (étape ⑤) : laisser le joueur dominer le segment déclenche un
				# renouvellement anticipé — le rival ne regarde plus que son propre déclin.
				var regles_r: Dictionary = data["rivals"]["regles"]
				var riposte: bool = part_joueur > float(regles_r["riposte_part"]) \
						and age > float(regles_r["riposte_age"])
				if declasse or riposte or age > float(cm["age_max_produit_rival"]):
					# LA PART SUIT LA MAISON, PAS L'UID. Sans ce report, le remplacement
					# effaçait l'ancien produit de `parts` et le neuf repartait de zéro : la
					# part du rival était redistribuée aux survivants, donc au JOUEUR, qui
					# bondissait à 76 % puis redescendait sur 4 ans (inertie 20 %/trim).
					# Une maison qui SE MODERNISE offrait le marché à son concurrent — c'est
					# l'essentiel de la « domination » du playtest n°7, mesurée sur le save.
					# Report PARTIEL (`part_reprise_renouv`) : un modèle neuf perd une partie
					# de sa clientèle (il n'a pas fait ses preuves), mais pas toute. À 1.0 le
					# glouton passait de 33 % à 79 % de faillites — les bots vivaient de cette
					# aubaine ; à 0.0 c'est le bug d'origine. La fraction est le seul levier.
					var part_reprise: float = 0.0
					if (state["marche"] as Dictionary).has(nom_seg):
						part_reprise = float((state["marche"][nom_seg]["parts"] as Dictionary).get(actif, 0.0)) \
							* float(regles_r["part_reprise_renouv"])
					riv["catalogue"].erase(actif)
					var neuf: String = _rival_lancer_produit(state, data, maison, nom_seg, annee)
					if part_reprise > 0.0:
						state["marche"][nom_seg]["parts"][neuf] = part_reprise


static func _produit_rival_du_segment(riv: Dictionary, nom_seg: String) -> String:
	var rcat: Dictionary = riv["catalogue"]
	for uid: String in Etat.cles_triees(rcat):
		if str(rcat[uid]["segment"]) == nom_seg:
			return uid
	return ""


static func _rival_lancer_produit(state: Dictionary, data: Dictionary, maison: String, nom_seg: String, annee: float) -> String:
	var riv: Dictionary = state["rivaux"][maison]
	var drv: Dictionary = data["rivals"]["maisons"][maison]
	var design: Dictionary = _design_rival(data, riv["technos"], nom_seg, annee, drv)
	var specs_p: Dictionary = Avion.specs(design, data)
	var prix: float = float(specs_p["cout_unitaire"]) * (1.0 + float(drv["marge_prix"]))
	var uid: String = "%s%d" % [maison.substr(0, 1), int(state["prochain_id"])]
	state["prochain_id"] = float(state["prochain_id"]) + 1.0
	riv["catalogue"][uid] = {
		"segment": nom_seg,
		"annee": annee,
		"prix": prix,
		"specs": specs_p,
		"carnet": 0.0,
		"pic_part": 0.0,
	}
	riv["nb_produits"] = float(riv["nb_produits"]) + 1.0
	return uid


# Les rivaux conçoivent avec LES MÊMES formules avion que le joueur, à partir
# d'archétypes par segment qui suivent les besoins de référence de l'année.
static func _design_rival(data: Dictionary, technos: Array, nom_seg: String, annee: float, drv: Dictionary) -> Dictionary:
	var arch: Dictionary = data["rivals"]["archetypes"][nom_seg]
	var regles: Dictionary = data["rivals"]["regles"]
	var seg: Dictionary = data["segments"][nom_seg]
	var features: Array = []
	for f_v: Variant in Avion.FEATURES_DESIGN:
		var f: String = str(f_v)
		if technos.has(f):
			if nom_seg != "export_militaire" and (f == "canon_moteur" or f == "reservoirs_largables"):
				continue
			features.append(f)
	var structure: String = "bois"
	if technos.has("monocoque_metal"):
		structure = "metal"
	elif annee >= float(regles["an_mixte"]):
		structure = "mixte"
	var formule: String = "monoplan" if annee >= float(regles["an_monoplan"]) else "biplan"
	var charge: float = float(arch["charge_utile"])
	if charge < 0.0:
		for crit: Dictionary in seg["criteres"]:
			if str(crit["nom"]) == "capacite":
				charge = interp(crit["ref"], annee) * float(data["constants"]["avion"]["kg_par_passager"])
	var armement: int = int(arch["armement"])
	if armement < 0:
		for crit: Dictionary in seg["criteres"]:
			if str(crit["nom"]) == "armement":
				armement = int(roundf(interp(crit["ref"], annee)))
	var design: Dictionary = {
		"nom": "%s %s %d" % [str(drv["nom"]), nom_seg, int(annee)],
		"annee": annee,
		"formule": formule,
		"structure": structure,
		"moteur": Avion.meilleur_moteur(data, annee, str(drv["moteur_pref"])),
		"surface": float(arch["surface"]),
		"carburant_kg": float(arch["carburant_base"]) + float(arch["carburant_par_an"]) * (annee - Etat.AN0),
		"charge_utile_kg": charge,
		"armement": armement,
		"features": features,
	}
	design["surface"] = meilleure_surface(data, nom_seg, design)
	# DISCIPLINE D'ÉQUIPEMENT : le rival montait TOUT ce qu'il avait débloqué, sans jamais se
	# demander si ça valait son prix — or le coût pèse lourd dans la note (23 % à l'export).
	# Résultat : des avions bardés d'avionique, chers, incapables de suivre un joueur qui casse
	# les prix (leur rabot bute sur `coût × marge_min`). On retire donc, en boucle et de façon
	# déterministe, tout équipement dont l'ABSENCE améliore la note du segment. Les bots, eux,
	# ont toujours eu des listes curatées : c'est un rattrapage de parité, pas un buff.
	var feats_r: Array = design["features"]
	var change: bool = true
	while change and not feats_r.is_empty():
		change = false
		var note_ref: float = qualite_segment(data, nom_seg, Avion.specs(design, data), annee, 0.0)
		for f_v: Variant in feats_r.duplicate():
			var sans: Array = feats_r.duplicate()
			sans.erase(f_v)
			design["features"] = sans
			if qualite_segment(data, nom_seg, Avion.specs(design, data), annee, 0.0) > note_ref:
				feats_r = sans
				change = true
				break
			design["features"] = feats_r
	design["features"] = feats_r
	return design


# Taille de voilure qui MAXIMISE la note du segment — recherche déterministe (zéro RNG).
# PARTAGÉ par les rivaux ET les bots : c'est le point clé. Donner le sur-mesure aux seuls
# rivaux avait fait exploser le glouton de 34 % à 54 % de faillites — ça ne mesurait pas sa
# fragilité mais le handicap mécanique qu'on venait de lui créer (les bots ont des surfaces
# codées en dur). Un vrai joueur choisit sa voilure : les deux camps doivent pouvoir le faire.
# La réputation est CONSTANTE entre candidats (elle ne dépend pas de la voilure) → sans effet
# sur l'argmax, on peut la passer à 0 pour ce seul choix.
static func meilleure_surface(data: Dictionary, nom_seg: String, design: Dictionary) -> float:
	var base_s: float = float(design["surface"])
	var annee: float = float(design["annee"])
	var essai: Dictionary = design.duplicate(true)
	var meilleure: float = base_s
	var meilleure_note: float = -1.0
	for f_v: Variant in data["rivals"]["regles"]["surmesure_facteurs"]:
		var s: float = base_s * float(f_v)
		essai["surface"] = s
		var note: float = qualite_segment(data, nom_seg, Avion.specs(essai, data), annee, 0.0)
		if note > meilleure_note:
			meilleure_note = note
			meilleure = s
	return meilleure


# Part de marché MOYENNE du joueur sur les segments où il est PRÉSENT — c'est elle qui arme
# le sursaut. Les uid de produits joueur commencent par "p" (convention déjà utilisée par le
# rabot de prix rival). Un bot ne domine jamais : le sursaut reste dormant au harnais.
# Moyenner sur TOUS les segments diluait la domination avec les marchés désertés : un joueur
# à 75 % du postal et 73 % du transport, absent de l'export, tombait à 49 % — sous le seuil
# de 55 %, donc le garde-fou ne s'armait jamais (vécu 1928, playtest n°7).
static func _part_joueur_globale(state: Dictionary) -> float:
	var total: float = 0.0
	var n: float = 0.0
	for nom_seg: String in Etat.cles_triees(state["marche"]):
		var parts: Dictionary = state["marche"][nom_seg]["parts"]
		if parts.is_empty():
			continue
		var pj: float = 0.0
		for u: String in Etat.cles_triees(parts):
			if u.begins_with("p"):
				pj += float(parts[u])
		if pj <= 0.0:
			continue
		total += pj
		n += 1.0
	return total / maxf(n, 1.0)


static func _rivaux_rd(state: Dictionary, data: Dictionary, annee: float) -> void:
	var cr: Dictionary = data["constants"]["recherche"]
	var regles: Dictionary = data["rivals"]["regles"]
	var part_j: float = _part_joueur_globale(state)
	for maison: String in Etat.cles_triees(state["rivaux"]):
		var riv: Dictionary = state["rivaux"][maison]
		var drv: Dictionary = data["rivals"]["maisons"][maison]
		var revenus: float = float(riv["ca_trim"]) * float(drv["marge"])
		riv["ca_trim"] = 0.0
		var apport: float = revenus * float(cr["rd_part_rivale"])
		# PLANCHER : une maison d'aviation ne cesse pas de chercher parce qu'elle a perdu un
		# marché (contrats d'État, autres activités). Sans lui, un rival décroché ne remonte
		# JAMAIS — son CA finance sa R&D qui finance son CA : spirale de la mort, et le joueur
		# qui prend la tête une fois ne revoit plus personne (vécu en playtest, 1937).
		apport = maxf(apport, float(regles["rd_plancher_trim"]))
		# SURSAUT : l'Air Ministry refuse de dépendre d'un fournisseur unique (logique du
		# shadow scheme) et finance les concurrents quand une maison rafle le marché.
		if part_j > float(regles["sursaut_seuil"]):
			apport *= float(regles["sursaut_mult"])
		riv["rd_pool"] = float(riv["rd_pool"]) + apport
		var prochaine: String = _prochaine_techno(data, riv["technos"])
		if prochaine == "":
			continue
		var tn: Dictionary = data["technos"][prochaine]
		if annee >= float(tn["date_etat_art"]):
			var cout: float = float(tn["cout_base"]) * float(cr["mult_rival_suiveur"])
			if float(riv["rd_pool"]) >= cout:
				riv["rd_pool"] = float(riv["rd_pool"]) - cout
				(riv["technos"] as Array).append(prochaine)
				_royalties_brevet(state, data, maison, prochaine)
		else:
			# Pari pionnier : rare, seedé — parfois Marane sort le pas variable avant tout le monde.
			# TRÉSOR DE GUERRE (playtest n°7, « je domine toujours autant ») : un rival est un
			# SUIVEUR PUR, il n'achète qu'une fois l'état de l'art atteint. Face à un joueur
			# qui paie des paris pionniers, il prend deux ans de retard DÉFINITIFS pendant que
			# sa caisse gonfle sans emploi (vécu : 1.13 M£ dormants, 2 technos contre 7 en
			# 1928 — et le sursaut anti-snowball ne faisait qu'y ajouter). Au-delà de
			# `pionnier_tresor_mult` fois le prix du pari, il finance la recherche en avance.
			# Le tirage RNG est conservé À L'IDENTIQUE (même nombre d'appels, même flux) :
			# seule la DÉCISION change, les campagnes du harnais restent comparables.
			# RATTRAPAGE (playtest n°7, « le milieu de partie est plat ») : le trésor de guerre
			# ne suffit pas — un rival dont la caisse est maigre reste suiveur à vie pendant que
			# le joueur enchaîne les paris pionniers. Passé `retard_pionnier` technos de retard
			# SUR LE JOUEUR, la maison arrête d'attendre l'état de l'art et paie le pari. Ne
			# s'arme QUE si le joueur mène : un joueur qui ne cherche pas ne le voit jamais.
			var cout_p: float = float(tn["cout_base"]) * float(cr["mult_rival_pionnier"])
			var assez: bool = float(riv["rd_pool"]) >= cout_p
			var ose: bool = assez and Rng.reel(state) < float(drv["proba_pionnier"])
			var tresor: bool = assez and float(riv["rd_pool"]) >= cout_p * float(regles["pionnier_tresor_mult"])
			var retard: float = float((state["recherche"]["faites"] as Array).size()) \
					- float((riv["technos"] as Array).size())
			var rattrapage: bool = assez and retard >= float(regles["retard_pionnier"])
			if ose or tresor or rattrapage:
				riv["rd_pool"] = float(riv["rd_pool"]) - cout_p
				(riv["technos"] as Array).append(prochaine)
				if Recherche.brevet_actif(state, prochaine) == "":
					Recherche.deposer_brevet(state, data, prochaine, maison)
					(state["presse"] as Array).append({"titre": "BREVET RIVAL",
						"corps": "%s brevette « %s ». Licence ou contournement — à vous de choisir." \
						% [str(drv["nom"]), str(data["technos"][prochaine]["nom"])]})
				else:
					_royalties_brevet(state, data, maison, prochaine)


# Un rival adopte une techno que VOUS avez brevetée : il verse des royalties.
static func _royalties_brevet(state: Dictionary, data: Dictionary, maison: String, id_t: String) -> void:
	if Recherche.brevet_actif(state, id_t) != "joueur":
		return
	var montant: float = float(data["technos"][id_t]["cout_base"]) \
			* float(data["constants"]["recherche"]["royalties_part"])
	state["tresorerie"] = float(state["tresorerie"]) + montant
	Comptes.note(state, "brevets", montant)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) + montant
	(state["presse"] as Array).append({"titre": "ROYALTIES",
		"corps": "%s adopte « %s » sous votre brevet : %d F de royalties." \
		% [str(data["rivals"]["maisons"][maison]["nom"]), str(data["technos"][id_t]["nom"]), int(montant)]})


# Prochaine techno par date d'état de l'art. `rivaux_ignorent` (data) écarte la soufflerie
# (méta) et les options d'armement spécial : l'arsenal sur-mesure est l'arme du JOUEUR —
# et surtout, y toucher re-déséquilibrerait les rivaux (leur réactivité = étape ⑤).
static func _prochaine_techno(data: Dictionary, possedees: Array) -> String:
	var candidates: Array = []
	for id_t: String in Etat.cles_triees(data["technos"]):
		if bool((data["technos"][id_t] as Dictionary).get("rivaux_ignorent", false)) or possedees.has(id_t):
			continue
		if not Recherche.prerequis_ok(possedees, data, id_t):
			continue
		candidates.append([float(data["technos"][id_t]["date_etat_art"]), id_t])
	candidates.sort()
	if candidates.is_empty():
		return ""
	return str(candidates[0][1])
