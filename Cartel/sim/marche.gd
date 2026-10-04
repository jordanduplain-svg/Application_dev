# Raison d'être : §4 — qui achète, à qui, et combien. PORT AU SCALPEL de
# `bureau-etudes/sim/market.gd` (§13) : les formules sont inchangées, ~590 lignes gardées
# sur 989, et tout ce qui pensait en avions est resté là-bas (concours, brevets, fusion,
# filiale, contrats d'entretien, dimensionnement de voilure).
#
# DEUX correctifs MESURÉS viennent avec, et ce sont eux qui justifient le port — personne
# ne les réinvente en écrivant un marché tout neuf :
#
#   1. LE PRIX MÉDIAN SE PREND UNE VOIX PAR MAISON. Sur la liste brute des produits, une
#      maison qui en aligne trois sur cinq FIXE la médiane et étrangle le `f_prix` de ses
#      concurrents. Inonder un segment de produits bon marché n'avantageait pas son auteur,
#      ça affamait les autres.
#   2. L'EMPILEMENT A UN RENDEMENT DÉCROISSANT. La part se prend au carré PAR PRODUIT puis
#      se somme par maison : deux produits jumeaux valent √2 fois un seul, mesuré à 13
#      points de part. `empilement_maison` = 1.0 reproduit le comportement historique, et
#      c'est le témoin — on mesure avant de le bouger.
#
# CADENCE : la résolution est TRIMESTRIELLE alors que tout le reste de Cartel bat à la
# semaine. C'est délibéré et c'est ce que §4 écrit (`demande_trim`). L'inertie de 20 %
# n'a de sens qu'à cette cadence : appliquée chaque semaine sur une campagne entière, les
# parts convergeraient en quelques mois et la fidélité des clients deviendrait décorative.
# (Le nombre de semaines d'une campagne est `sim.semaines_max` ; il n'est pas recopié ici.) La production, elle, reste hebdomadaire — on fabrique toutes les semaines,
# on vend tous les trimestres, et le stock fait le tampon.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Rng := preload("res://sim/rng.gd")
const Produit := preload("res://sim/produit.gd")

const JOUEUR: String = "joueur"


static func init_rivaux(state: Dictionary, data: Dictionary) -> void:
	var rivaux: Dictionary = {}
	for id: String in Etat.cles_triees(data["rivaux"]["maisons"]):
		var d: Dictionary = data["rivaux"]["maisons"][id]
		# La maison du traître n'existe qu'après la trahison (§6) : elle a son emplacement
		# dans les données, pas encore dans la partie.
		if bool(d.get("fusion_only", false)):
			continue
		rivaux[id] = {
			"recette": (d["recette"] as Dictionary).duplicate(true),
			"marge": float(d["marge"]),
			"trim_depuis_renouv": 0.0,
		}
	state["rivaux"] = rivaux


# --- le trimestre -------------------------------------------------------------

# `specs` arrive de sim/sim.gd, qui les calcule UNE fois par tick. Ce fichier les
# recalculait pour son compte — a la vente, et une fois par maison dans chaque segment.
# sim.gd ecrit noir sur blanc que les recalculer ailleurs « donnerait deux verites pour une
# recette le jour ou une formule bouge » : la propriete etait affirmee et pas tenue.
static func trimestre(state: Dictionary, data: Dictionary, specs: Dictionary) -> void:
	_renouveler(state, data)
	# LES RIVAUX sont les memes pour les trois segments : leur prix est une marge sur leur
	# cout, et ils vendent la meme chose partout. Leurs specs se calculent donc UNE fois par
	# trimestre. Le JOUEUR, lui, pose un prix par segment (§19bis) : sa ligne de lice change
	# d'un segment a l'autre, et le prix median avec elle.
	var rivaux: Array = _lice_rivaux(state, data)
	for nom_seg: String in ordre_service(data):
		_allouer(state, data, nom_seg, rivaux, specs)


# §4 : les trois segments puisent dans le MEME stock, donc l'ordre de service decide qui
# mange la penurie — et le joueur est limite par son stock a tous les trimestres mesures.
# Cet ordre etait celui de `sort()` sur les cles : une regle de jeu portee par l'alphabet.
# Il est maintenant DECLARE dans data/segments.json, sous forme de LISTE.
#
# Pas sous forme de trois nombres : un rang n'est pas une grandeur, et le levier l'a dit
# tout seul. `priorite_service: 1/2/3` perturbe d'un cran entier donnait 2/2/3 ou 1/1/3 —
# des egalites que le nom tranchait, donc jamais un ordre different, donc trois constantes
# DEBRANCHEES. La porte du jalon 0 a refuse ma propre addition en trois lignes.
#
# Ce qui garde cette liste honnete n'est donc pas un balayage mais un test de couverture
# (tests/run.gd) : elle doit nommer exactement les segments, sans oubli ni doublon.
static func ordre_service(data: Dictionary) -> Array:
	var segs: Dictionary = data["segments"]["segments"]
	var noms: Array = []
	for nom: Variant in (data["segments"] as Dictionary).get("ordre_service", []):
		if segs.has(str(nom)) and not noms.has(str(nom)):
			noms.append(str(nom))
	# Filet, pas comportement nominal : un segment absent de la liste est servi en dernier
	# plutot que de disparaitre du marche. Le test de couverture, lui, echoue.
	for nom: String in Etat.cles_triees(segs):
		if not noms.has(nom):
			noms.append(nom)
	return noms


# Une voix par maison (voir l'en-tete) : sur la liste brute des produits, une maison qui en
# aligne trois sur cinq FIXE la mediane et etrangle le `f_prix` de ses concurrents.
static func _prix_median(lice: Array) -> float:
	var prix_par_maison: Dictionary = {}
	for e: Dictionary in lice:
		var m: String = str(e["maison"])
		if not prix_par_maison.has(m):
			prix_par_maison[m] = []
		(prix_par_maison[m] as Array).append(float(e["prix"]))
	var prix_tous: Array = []
	for m2: String in Etat.cles_triees(prix_par_maison):
		prix_tous.append(_mediane(prix_par_maison[m2]))
	return _mediane(prix_tous)


# La R&D simulée des rivaux (§4). Un rival qui ne renouvelle pas devient décoratif en dix
# trimestres, et le joueur gagne par forfait sans avoir rien fait.
static func _renouveler(state: Dictionary, data: Dictionary) -> void:
	for id: String in Etat.cles_triees(state["rivaux"]):
		var riv: Dictionary = state["rivaux"][id]
		var d: Dictionary = data["rivaux"]["maisons"][id]
		riv["trim_depuis_renouv"] = float(riv["trim_depuis_renouv"]) + 1.0
		if float(riv["trim_depuis_renouv"]) < float(d["renouvellement_trim"]):
			continue
		riv["trim_depuis_renouv"] = 0.0
		var recette: Dictionary = riv["recette"]
		recette["purete"] = minf(float(recette["purete"]) + float(d["purete_pas"]),
			float(d["purete_plafond"]))
		# La montée en gamme suit la pureté : au-delà d'un palier, la famille précédente ne
		# porte plus la recette. Les paliers sont dans les données, pas ici.
		var montee: Array = d["familles_montee"]
		var rang: int = mini(int(floorf(float(recette["purete"]) / 0.34)), montee.size() - 1)
		recette["famille"] = str(montee[rang])


# --- un segment ---------------------------------------------------------------

static func _allouer(state: Dictionary, data: Dictionary, nom_seg: String, rivaux: Array,
		specs: Dictionary) -> void:
	var cm: Dictionary = data["constants"]["marche"]
	var seg: Dictionary = data["segments"]["segments"][nom_seg]
	var marche: Dictionary = state["marche"]
	if not marche.has(nom_seg):
		marche[nom_seg] = {"parts": {}, "demande_fidele": 0.0, "ventes_joueur": 0.0}
	var etat_seg: Dictionary = marche[nom_seg]
	var parts: Dictionary = etat_seg["parts"]
	# Aléa de conjoncture (seedé) : tiré AVANT toute sortie anticipée, pour garder le flux
	# RNG identique quel que soit l'état des catalogues.
	var amp: float = float(cm["alea_demande"])
	var alea: float = 1.0 + amp * (2.0 * Rng.reel(state) - 1.0)
	var lice: Array = _en_lice(state, data, specs, nom_seg, rivaux)
	var prix_median: float = _prix_median(lice)
	if lice.is_empty():
		etat_seg["parts"] = {}
		return

	# 2. ATTRACTIVITÉS → parts cibles, au carré (k = 2 accentue les écarts), avec le
	# rendement décroissant de l'empilement.
	var empil: float = float(cm["empilement_maison"])
	var rang: Dictionary = {}
	var poids: Dictionary = {}
	var somme_a2: float = 0.0
	for e: Dictionary in lice:
		var a: float = attractivite(data, seg, e, prix_median)
		var mm: String = str(e["maison"])
		var k: int = int(rang.get(mm, 0))
		rang[mm] = k + 1
		poids[str(e["uid"])] = a * a * pow(empil, float(k))
		somme_a2 += float(poids[str(e["uid"])])

	# 3. Produits disparus : on retire leurs parts.
	var uids: Array = []
	for e: Dictionary in lice:
		uids.append(str(e["uid"]))
	for uid: String in Etat.cles_triees(parts):
		if not uids.has(uid):
			parts.erase(uid)

	# 4. INERTIE — les clients sont fidèles, 20 % de rattrapage par trimestre.
	var inertie: float = float(cm["inertie"])
	for e: Dictionary in lice:
		var uid_p: String = str(e["uid"])
		var cible: float = float(poids[uid_p]) / somme_a2 if somme_a2 > 0.0 \
			else 1.0 / float(lice.size())
		parts[uid_p] = float(parts.get(uid_p, 0.0)) \
			+ (cible - float(parts.get(uid_p, 0.0))) * inertie
	# RENORMALISATION — oubliee au premier port, rattrapee par l'assert de state.gd.
	# L'inertie rapproche chaque part de sa cible SEPAREMENT : partant de zero, la somme
	# vaut 0.20 au premier trimestre, 0.36 au deuxieme, et ne vaut 1 qu'a convergence.
	# Sans cette boucle, 80 % du marche n'appartenait a personne pendant un an de jeu.
	var somme_p: float = 0.0
	for uid: String in Etat.cles_triees(parts):
		somme_p += float(parts[uid])
	if somme_p > 0.0:
		for uid: String in Etat.cles_triees(parts):
			parts[uid] = float(parts[uid]) / somme_p

	# 5. VENTES. La demande du trimestre porte la DÉPENDANCE accumulée (§4) : un produit
	# addictif fait grandir son propre marché — jusqu'à ce qu'il le tue, ce qui est l'acte
	# III et pas ce fichier.
	var demande: float = (float(seg["demande_base_trim"]) + float(etat_seg["demande_fidele"])) * alea
	var part_joueur: float = float(parts.get(JOUEUR, 0.0))
	var voulu: float = demande * part_joueur
	# Plafonné par le stock : on ne vend que ce qu'on a livré sur place.
	var vendu: float = minf(voulu, float(state["stock_kg"]))
	state["stock_kg"] = float(state["stock_kg"]) - vendu
	etat_seg["ventes_joueur"] = vendu
	if vendu > 0.0:
		var recette_vente: float = vendu * float((state["prix"] as Dictionary).get(nom_seg, 0.0))
		# La vente rentre en SALE, toujours : personne ne vire de l'argent pour ça (§5).
		state["cash_sale"] = float(state["cash_sale"]) + recette_vente
		state["stats"]["kg_vendus"] = float(state["stats"]["kg_vendus"]) + vendu
		state["stats"]["sale_encaisse"] = float(state["stats"]["sale_encaisse"]) + recette_vente
		# La boucle de fidélité, plafonnée. Sans plafond c'est une rétroaction positive nue,
		# et elle diverge.
		var bonus: float = float(specs["dependance"]) * vendu * float(cm["k_fidelite"])
		etat_seg["demande_fidele"] = minf(float(etat_seg["demande_fidele"]) + bonus,
			float(seg["demande_base_trim"]) * float(cm["plafond_fidelite"]))


# --- l'attractivité (§4) ------------------------------------------------------

# attractivite = qualite_s × f_prix × f_confiance × f_delai. Publique : l'écran marché
# (§12bis) en aura besoin pour expliquer au joueur POURQUOI il perd, et un diagnostic qui
# recalcule la formule de son côté finit par diverger de celle qui décide.
static func attractivite(data: Dictionary, seg: Dictionary, e: Dictionary,
		prix_median: float) -> float:
	var cm: Dictionary = data["constants"]["marche"]
	var q: float = qualite(data, seg, e["profil"])
	# L'exposant est celui du SEGMENT (§4) et le facteur est BORNE, comme l'est la qualite.
	var f_prix: float = minf(pow(prix_median / maxf(float(e["prix"]), 1.0),
		float(seg["exposant_prix"])), float(cm["plafond_prix"]))
	# `f_confiance` remplace la réputation de `bureau-etudes` : ici ce qui rassure le
	# client, c'est que les lots se ressemblent.
	var f_confiance: float = float(cm["confiance_base"]) \
		+ float(cm["confiance_amplitude"]) * float(e["profil"]["regularite_lot"])
	# `f_delai` : la rupture d'approvisionnement. Le graphe (§3) la remplira vraiment au
	# jalon 2 ; ici elle vaut 1 pour tout le monde, et le terme est déjà là pour qu'il n'ait
	# pas à être ajouté après coup dans un système calibré (§2).
	var f_delai: float = 1.0 / (1.0 + float(cm["k_delai"]) * float(e.get("ruptures", 0.0)))
	return maxf(q * f_prix * f_confiance * f_delai, 0.0)


# qualite_s = Σ poids_i × clamp(spec_i / besoin_ref_i, 0, plafond), avec un SEUIL optionnel.
#
# LE SEUIL (§4) : sans lui le ratio est linéaire, donc un produit à la moitié de la
# référence obtient la moitié du crédit — et un produit de rue à pureté 0.45 tenait 30 %
# du segment `haut_de_gamme`, à parité avec un produit à 0.95 sur trois maisons. Un segment
# exclusif ne peut pas naître d'un ratio linéaire : il lui faut une porte.
#
# C'est une RAMPE et pas une falaise. Sous le seuil, le critère vaut zéro ; entre le seuil
# et la référence, le crédit monte progressivement ; au-dessus, rien ne change. Une coupure
# nette aurait fait basculer un produit entier sur un millième de pureté, et ce projet a
# passé assez de temps à dire qu'une falaise n'est pas un réglage.
#
#     ratio <= seuil     ->  0
#     seuil < ratio < 1  ->  ratio × (ratio − seuil) / (1 − seuil)
#     ratio >= 1         ->  ratio (inchangé, borné par le plafond)
#
# `seuil` absent ou 0 = comportement d'avant : la valeur par défaut est la neutralité, et
# seuls les critères qui ont besoin
# d'être exclusifs en portent un.
static func qualite(data: Dictionary, seg: Dictionary, prof: Dictionary) -> float:
	var plafond: float = float(data["constants"]["marche"]["plafond_critere"])
	var q: float = 0.0
	for crit: Dictionary in seg["criteres"]:
		var v: float = float(prof[str(crit["nom"])])
		var ref: float = float(crit["ref"])
		var ratio: float = ref / maxf(v, 1e-6) if str(crit["sens"]) == "bas" \
			else v / maxf(ref, 1e-6)
		var seuil: float = float(crit.get("seuil", 0.0))
		if seuil > 0.0 and ratio < 1.0:
			ratio *= clampf((ratio - seuil) / maxf(1.0 - seuil, 1e-6), 0.0, 1.0)
		q += float(crit["poids"]) * clampf(ratio, 0.0, plafond)
	return q


# --- qui est en lice ----------------------------------------------------------

# Les specs du JOUEUR arrivent deja calculees ; celles des rivaux se calculent ici, parce
# que ce sont d'autres recettes. Ce n'est pas la meme chose que de recalculer deux fois la
# meme. Les rivaux ne dependent d'aucun segment : une seule fois par trimestre.
static func _lice_rivaux(state: Dictionary, data: Dictionary) -> Array:
	var lice: Array = []
	for id: String in Etat.cles_triees(state["rivaux"]):
		var riv: Dictionary = state["rivaux"][id]
		var specs_riv: Dictionary = Produit.specs(riv["recette"], data)
		lice.append({"maison": id, "uid": id,
			"prix": float(specs_riv["cout_unitaire"]) * float(riv["marge"]),
			"profil": profil(riv["recette"], data, specs_riv)})
	return lice


# Le joueur entre dans la lice d'un segment s'il a une recette ET un prix > 0 POUR CE
# SEGMENT. Un prix nul l'en sort : se retirer d'un marche est une decision qui se prend
# avec le meme curseur que d'y entrer, et non un cas degenere a rattraper ailleurs.
# `ponytail:` les rivaux gardent un prix unique — leur marge est leur strategie entiere, et
# trois marges par cartel serait un systeme de pilotage de rival que personne ne demande.
static func _en_lice(state: Dictionary, data: Dictionary, specs: Dictionary,
		nom_seg: String, rivaux: Array) -> Array:
	var lice: Array = rivaux.duplicate()
	var prix: float = float((state["prix"] as Dictionary).get(nom_seg, 0.0))
	if not (state["recette"] as Dictionary).is_empty() and prix > 0.0:
		lice.push_front({"maison": JOUEUR, "uid": JOUEUR, "prix": prix,
			"profil": profil(state["recette"], data, specs)})
	return lice


# Ce que le marché sait lire d'un produit : les sept specs de §2, plus la pureté (un
# paramètre brut, mais le client la juge) et la discrétion que le marché dérive de la
# signature. Un critère de segments.json ne peut nommer que ces clés-là.
static func profil(recette: Dictionary, data: Dictionary,
		specs: Dictionary = {}) -> Dictionary:
	var p: Dictionary = (specs if not specs.is_empty()
		else Produit.specs(recette, data)).duplicate()
	var r: Dictionary = Produit.normaliser(recette, data)
	p["purete"] = float(r["purete"])
	p["discretion"] = 1.0 / (1.0 + float(p["signature"]))
	return p


static func _mediane(valeurs: Array) -> float:
	if valeurs.is_empty():
		return 0.0
	var tri: Array = valeurs.duplicate()
	tri.sort()
	return float(tri[floori(float(tri.size()) / 2.0)])
