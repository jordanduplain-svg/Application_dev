# Raison d'être : LE point d'entrée unique de mutation du state — tick hebdomadaire
# et intentions de l'UI (appliquer) ; personne d'autre n'écrit dans le state.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Avion := preload("res://sim/aircraft.gd")
const Marche := preload("res://sim/market.gd")
const Production := preload("res://sim/production.gd")
const Economie := preload("res://sim/economy.gd")
const Recherche := preload("res://sim/research.gd")
const Contrats := preload("res://sim/contracts.gd")
const Ingenieurs := preload("res://sim/engineers.gd")
const Evenements := preload("res://sim/events.gd")
const Raids := preload("res://sim/raids.gd")
const Essais := preload("res://sim/essais.gd")
const Accidents := preload("res://sim/accidents.gd")
const Conseil := preload("res://sim/conseil.gd")
const Moteurs := preload("res://sim/motors.gd")
const Impots := preload("res://sim/impots.gd")
const Bombardements := preload("res://sim/bombardements.gd")
const Reputation := preload("res://sim/reputation.gd")
const Comptes := preload("res://sim/comptes.gd")


static func nouvelle_partie(graine: int, data: Dictionary) -> Dictionary:
	var state: Dictionary = Etat.nouvelle_partie(graine, data)
	Marche.init_rivaux(state, data)
	Ingenieurs.regenerer_candidats(state, data)
	# Canonisation JSON immédiate : tous les nombres deviennent des float, comme
	# après un save/load — le run « frais » et le run « rechargé » vivent pareil.
	return Etat.canonique(state)


static func tick(state: Dictionary, data: Dictionary) -> void:
	if str(state["fin"]) != "":
		return
	state["tick"] = float(state["tick"]) + 1.0
	Economie.tick_hebdo(state, data)
	Ingenieurs.tick_hebdo(state, data)
	Evenements.tick_hebdo(state, data)
	Recherche.tick_hebdo(state, data)
	Production.tick_hebdo(state)
	Contrats.tick_hebdo(state, data)
	Raids.tick_hebdo(state, data)
	Essais.tick_hebdo(state)
	Conseil.tick_hebdo(state, data)
	Moteurs.tick_hebdo(state, data)
	# Exercice clos : l'impôt sur les bénéfices de guerre tombe au passage d'année.
	if int(state["tick"]) % 52 == 0:
		Impots.tick_annuel(state, data)
	if int(state["tick"]) % 13 == 0:
		Marche.trimestre(state, data)
		Accidents.trimestre(state, data)
		Bombardements.trimestre(state, data)
		_noter_tresorerie(state)
	if float(state["tick"]) >= float(data["constants"]["fin"]["tick"]) and str(state["fin"]) == "":
		state["fin"] = "mai_1945"
	Etat.valider(state)


# 5 ans de trimestres glissants : au-delà, la courbe du livret n'est plus lisible.
static func _noter_tresorerie(state: Dictionary) -> void:
	var hist: Array = state["tresorerie_hist"]
	hist.append(float(state["tresorerie"]))
	if hist.size() > 20:
		hist.pop_front()


static func appliquer(state: Dictionary, data: Dictionary, intention: Dictionary) -> bool:
	if str(state["fin"]) != "":
		return false
	match str(intention["type"]):
		"nouveau_design":
			return _nouveau_design(state, data, intention)
		"lancer_produit":
			return _lancer_produit(state, data, intention)
		"prototyper":
			return Essais.prototyper(state, data, str(intention["design"]),
				Ingenieurs.bonus(state, data, "etudes"))
		"corriger_defaut":
			return Essais.corriger(state, data, str(intention["design"]), str(intention["defaut"]))
		"abandonner_essais":
			return Essais.abandonner(state, str(intention["design"]))
		"mettre_en_service":
			return _mettre_en_service(state, data, intention)
		"prix":
			return _prix(state, intention)
		"campagne_publicite":
			return _campagne_publicite(state, data)
		"retirer_produit":
			return _retirer_produit(state, data, str(intention["produit"]))
		"supprimer_design":
			return _supprimer_design(state, str(intention["design"]))
		"agrandir_atelier":
			return Production.agrandir(state, data)
		"lancer_recherche":
			return Recherche.lancer(state, data, str(intention["techno"]))
		"acheter_licence":
			return Recherche.acheter_licence(state, data, str(intention["techno"]))
		"candidater_ao":
			return Contrats.candidater(state, data, str(intention["ao"]), str(intention["produit"]))
		"recruter":
			return Ingenieurs.recruter(state, data, int(intention["indice"]))
		"licencier":
			return Ingenieurs.licencier(state, data, int(intention["indice"]))
		"affecter":
			return Ingenieurs.affecter(state, int(intention["indice"]), str(intention["poste"]))
		"choisir_evenement":
			return Evenements.choisir(state, data, str(intention["id"]), str(intention["choix"]))
		"recruter_pilote":
			return Raids.recruter_pilote(state, data, str(intention["nom"]))
		"tenter_epreuve":
			return Raids.tenter(state, data, str(intention["epreuve"]), str(intention["produit"]), int(intention["pilote"]))
		"alloc_marche":
			state["alloc_marche"] = clampf(float(intention["part"]), 0.0, 1.0)
			return true
		"disperser_chaines":
			return _disperser(state, data)
		"fonder_moteurs":
			return Moteurs.fonder(state, data)
		"lancer_moteur":
			return Moteurs.lancer(state, data, intention["projet"])
		"signer_motoriste":
			return _signer_motoriste(state, data, str(intention["marque"]))
		"assurance":
			state["assurance"] = bool(intention["actif"])
			return true
		"entretien_flotte":
			state["entretien_flotte"] = bool(intention["actif"])
			return true
		"brader_flotte":
			return _brader_flotte(state, data, str(intention["produit"]))
		"produire_stock":
			return _produire_stock_intention(state, str(intention["produit"]), float(intention["nombre"]))
		"emprunter":
			return _emprunter(state, data, float(intention["montant"]))
		"rembourser":
			return _rembourser(state, float(intention["montant"]))
		"fonder_filiale":
			return _fonder_filiale(state, data)
		"accepter_sous_licence":
			return _accepter_sous_licence(state, data, str(intention["id"]))
		"lire_presse":
			if (state["presse"] as Array).size() == 0:
				return false
			(state["presse"] as Array).pop_front()
			return true
	return false


# Rabais variante DÉGRESSIF : plein (variante_proto/delai_mult) quand la cellule est
# identique au parent, remonte vers le tarif NEUF (×1.0) à mesure que la surface ou la
# structure s'en écartent. Partagé par la sim (autorité) et l'écran Bureau (aperçu).
static func variante_mults(design: Dictionary, parent: Dictionary, data: Dictionary) -> Dictionary:
	var c: Dictionary = data["constants"]["avion"]
	var surf_p: float = maxf(float(parent["surface"]), 1.0)
	var d: float = clampf(absf(float(design["surface"]) - surf_p) / surf_p, 0.0, 1.0)
	if str(design["structure"]) != str(parent["structure"]):
		d = clampf(d + float(c["variante_structure_devi"]), 0.0, 1.0)
	return {
		"proto": lerpf(float(c["variante_proto_mult"]), 1.0, d),
		"delai": lerpf(float(c["variante_delai_mult"]), 1.0, d),
	}


static func _nouveau_design(state: Dictionary, data: Dictionary, intention: Dictionary) -> bool:
	# Canonisation : l'intention vient de l'extérieur et peut contenir des int,
	# qui divergeraient du float au save/load.
	var design: Dictionary = Etat.canonique(intention["design"])
	var faites: Array = state["recherche"]["faites"]
	for f_v: Variant in design.get("features", []):
		if not faites.has(str(f_v)):
			return false
	if str(design["structure"]) == "metal" and not faites.has("monocoque_metal"):
		return false
	# Le moteur vient du commerce OU de votre propre département (Moteurs.fonder).
	if not (data["engines"] as Dictionary).has(str(design["moteur"])) \
			and not Moteurs.moteurs(state).has(str(design["moteur"])):
		return false
	# Partenariat motoriste : la marque concurrente est interdite, la remise est
	# TAMPONNÉE ici (autorité sim — l'écran ne peut ni tricher ni se désynchroniser).
	if moteur_interdit(state, data, str(design["moteur"])):
		return false
	design["remise_moteur"] = remise_moteur(state, data, str(design["moteur"]))
	# Variante « Mk II » : même CELLULE qu'un design existant (formule, structure, surface) →
	# proto et études au rabais. Moteur et équipements LIBRES — re-motoriser un chasseur,
	# c'est l'histoire même des lignées (le flag est posé ici, autorité sim).
	if design.has("variante_de"):
		var parent_uid: String = str(design["variante_de"])
		if not (state["designs"] as Dictionary).has(parent_uid):
			return false
		var parent: Dictionary = state["designs"][parent_uid]["design"]
		# Seule la FORMULE (biplan/monoplan) reste rédhibitoire : changer ça, c'est un AUTRE
		# avion. Structure et surface PEUVENT évoluer (re-motoriser un vieux chasseur exige
		# souvent de le passer au métal ou d'agrandir l'aile) — mais le rabais est DÉGRESSIF :
		# tu paies proto/études au prorata de ce que tu re-conçois (variante_mults).
		if str(design["formule"]) != str(parent["formule"]):
			return false
		design["variante"] = true
		var vm: Dictionary = variante_mults(design, parent, data)
		design["variante_proto_mult"] = vm["proto"]
		design["variante_delai_mult"] = vm["delai"]
	# Maturité de fiabilité TAMPONNÉE (modèle C) : ans écoulés entre TA recherche de chaque
	# équipement et l'année du design. Figé ici → specs reste pur (ne relit pas le state), et
	# la maturité d'un design ne bouge plus après sa sortie (comme le reste des specs).
	var annees_r: Dictionary = state["recherche"].get("annees", {})
	var annee_d: float = float(design.get("annee", Etat.AN0))
	var mat: Dictionary = {}
	for f_v: Variant in design.get("features", []):
		var f: String = str(f_v)
		mat[f] = maxf(0.0, annee_d - float(annees_r.get(f, annee_d)))
	design["mat_features"] = mat
	# Moteur MAISON : ses caractéristiques sont figées dans le design (le catalogue du
	# commerce, lui, vit dans data et n'a pas besoin d'être recopié).
	if Moteurs.moteurs(state).has(str(design["moteur"])):
		design["moteur_specs"] = (Moteurs.moteurs(state)[str(design["moteur"])] as Dictionary).duplicate(true)
	var specs_d: Dictionary = Avion.specs(design, data)
	var uid: String = "d%d" % int(state["prochain_id"])
	state["prochain_id"] = float(state["prochain_id"]) + 1.0
	state["designs"][uid] = {"design": design, "specs": specs_d}
	return true


# Lancement direct au catalogue — désormais le chemin des BOTS et des fixtures seulement :
# le joueur passe par prototyper → essais → mettre_en_service (l'économie bot reste intacte).
static func _lancer_produit(state: Dictionary, data: Dictionary, intention: Dictionary) -> bool:
	var uid_design: String = str(intention["design"])
	if not (state["designs"] as Dictionary).has(uid_design):
		return false
	if (state["catalogue"] as Dictionary).size() >= max_produits(state, data):
		return false
	if not (data["segments"] as Dictionary).has(str(intention["segment"])):
		return false
	var d: Dictionary = state["designs"][uid_design]
	# Le bureau d'études rôdé grappille sur le prototype (remise plafonnée en data).
	var cout_proto: float = float(d["specs"]["cout_proto"]) \
			* (1.0 - Ingenieurs.bonus(state, data, "etudes"))
	if float(state["tresorerie"]) < cout_proto:
		return false
	state["tresorerie"] = float(state["tresorerie"]) - cout_proto
	Comptes.note(state, "prototypes", -cout_proto)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout_proto
	var uid: String = "p%d" % int(state["prochain_id"])
	state["prochain_id"] = float(state["prochain_id"]) + 1.0
	state["catalogue"][uid] = {
		"design_uid": uid_design,
		"segment": str(intention["segment"]),
		"annee": Marche.annee_de(state),
		"prix": maxf(float(intention["prix"]), 1.0),
		"specs": (d["specs"] as Dictionary).duplicate(true),
		"carnet": 0.0,
		"pic_part": 0.0,
	}
	return true


# Sortie d'essais : le proto est déjà payé, les specs de SERVICE (tarées par les défauts
# non corrigés) entrent au catalogue — le chemin joueur ; les bots gardent lancer_produit.
static func _mettre_en_service(state: Dictionary, data: Dictionary, intention: Dictionary) -> bool:
	var uid_design: String = str(intention["design"])
	if not Essais.prete(state, uid_design):
		return false
	if (state["catalogue"] as Dictionary).size() >= max_produits(state, data):
		return false
	if not (data["segments"] as Dictionary).has(str(intention["segment"])):
		return false
	var specs_serv: Dictionary = Essais.specs_de_service(state, data, uid_design)
	Essais.abandonner(state, uid_design)
	var uid: String = "p%d" % int(state["prochain_id"])
	state["prochain_id"] = float(state["prochain_id"]) + 1.0
	state["catalogue"][uid] = {
		"design_uid": uid_design,
		"segment": str(intention["segment"]),
		"annee": Marche.annee_de(state),
		"prix": maxf(float(intention["prix"]), 1.0),
		"specs": specs_serv,
		"carnet": 0.0,
		"pic_part": 0.0,
	}
	return true


# Levier de réputation civile du début (quand les livraisons ne la bougent pas encore) :
# payer une campagne de presse/démonstration. Rendements décroissants par la marge au
# plafond — efficace en partant de bas, dérisoire près du plafond (les AO/courses restent
# la seule voie au-delà). Cooldown pour que ce ne soit pas un bouton à spammer.
static func _campagne_publicite(state: Dictionary, data: Dictionary) -> bool:
	if not publicite_dispo(state, data):
		return false
	var pub: Dictionary = data["constants"]["publicite"]
	state["tresorerie"] = float(state["tresorerie"]) - float(pub["cout"])
	Comptes.note(state, "publicite", -float(pub["cout"]))
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - float(pub["cout"])
	Reputation.bonus(state["rep"], "civile", publicite_gain(state, data))
	state["pub_dernier_tick"] = float(state["tick"])
	return true


# Exposés pour que l'écran affiche coût, gain à venir et disponibilité sans redupliquer la règle.
static func publicite_gain(state: Dictionary, data: Dictionary) -> float:
	var pub: Dictionary = data["constants"]["publicite"]
	return float(pub["gain_base"]) * maxf(float(pub["plafond"]) - float(state["rep"]["civile"]), 0.0)


static func publicite_dispo(state: Dictionary, data: Dictionary) -> bool:
	var pub: Dictionary = data["constants"]["publicite"]
	# .get : sauvegardes d'avant le levier de publicité (migrées à 0.5 neutre côté main).
	var dernier: float = float(state.get("pub_dernier_tick", -999.0))
	return float(state["tick"]) - dernier >= float(pub["cooldown_sem"]) \
			and float(state["tresorerie"]) >= float(pub["cout"])


# Un brouillon référencé par un produit du catalogue reste : c'est lui qui porte le nom
# affiché sur l'écran marché. Sans cette porte, les designs s'entassent à vie dans le save.
static func _supprimer_design(state: Dictionary, uid: String) -> bool:
	if not (state["designs"] as Dictionary).has(uid):
		return false
	var cat: Dictionary = state["catalogue"]
	for uid_p: String in Etat.cles_triees(cat):
		if str(cat[uid_p]["design_uid"]) == uid:
			return false
	return (state["designs"] as Dictionary).erase(uid)


# --- partenariat motoriste exclusif (Rolls-Royce OU Bristol, à vie) --------------------

# Remise sur le coût du moteur si sa marque est le partenaire signé (1.0 sinon).
static func remise_moteur(state: Dictionary, data: Dictionary, id_moteur: String) -> float:
	var partenaire: String = str(state.get("motoriste", ""))
	if partenaire == "" or not (data["engines"] as Dictionary).has(id_moteur):
		return 1.0
	if str(data["engines"][id_moteur].get("marque", "")) == partenaire:
		return float(data["constants"]["motoriste"]["remise_cout"])
	return 1.0


# Signer chez l'un ferme la porte de l'autre grande maison (Napier et les autres restent libres).
static func moteur_interdit(state: Dictionary, data: Dictionary, id_moteur: String) -> bool:
	var partenaire: String = str(state.get("motoriste", ""))
	if partenaire == "" or not (data["engines"] as Dictionary).has(id_moteur):
		return false
	var marque: String = str(data["engines"][id_moteur].get("marque", ""))
	for m_v: Variant in data["constants"]["motoriste"]["marques"]:
		if str(m_v) == marque and marque != partenaire:
			return true
	return false


static func _signer_motoriste(state: Dictionary, data: Dictionary, marque: String) -> bool:
	if str(state.get("motoriste", "")) != "":
		return false
	# Intégrer OU sous-traiter : on ne signe pas l'exclusivité d'un motoriste quand on est
	# devenu son concurrent (règle miroir de Moteurs.fonder).
	if Moteurs.departement(state):
		return false
	if not (data["constants"]["motoriste"]["marques"] as Array).has(marque):
		return false
	state["motoriste"] = marque
	(state["presse"] as Array).append({"titre": "PARTENARIAT MOTORISTE",
		"corps": "Votre bureau signe l'exclusivité %s : leurs moteurs à prix d'ami, ceux du concurrent interdits — pour toujours." % marque})
	return true


# --- production sous licence (guerre) : construire l'avion d'un autre, cash sans gloire ---

static func sous_licences_ouvertes(state: Dictionary, data: Dictionary) -> Array:
	var annee: float = Marche.annee_de(state)
	var liste: Array = []
	for offre: Dictionary in (data["contracts"] as Dictionary).get("sous_licence", []):
		if annee >= float(offre["des"]) and annee < float(offre["fin"]) \
				and not (state.get("sous_licences", []) as Array).has(str(offre["id"])):
			liste.append(offre)
	return liste


static func _accepter_sous_licence(state: Dictionary, data: Dictionary, id_o: String) -> bool:
	for offre: Dictionary in sous_licences_ouvertes(state, data):
		if str(offre["id"]) != id_o:
			continue
		(state["sous_licences"] as Array).append(id_o)
		# La série entre dans la file d'État existante : prioritaire à l'atelier, payée à
		# l'appareil, coût fourni par le ministère — et fiabilité posée AU pivot : la
		# réputation ne bouge pas d'un point (on construit l'avion d'un autre, sans gloire).
		(state["ao"]["contrats"] as Array).append({
			"ao": id_o,
			"domaine": "militaire",
			"restant": float(offre["volume"]),
			"solde_unitaire": float(offre["fee"]),
			"cout_unitaire": 0.0,
			"fiabilite": float(data["constants"]["repu"]["pivot_fiab"]),
		})
		(state["presse"] as Array).append({"titre": "PRODUCTION SOUS LICENCE",
			"corps": "%s : votre atelier construira la machine d'un rival. L'argent rentre, le prestige non." % str(offre["nom"])})
		return true
	return false


# Commande d'atelier pour le hangar : produite au prochain trimestre sur la capacité
# restante (après les séries d'État), payée à la construction.
static func _produire_stock_intention(state: Dictionary, uid: String, nombre: float) -> bool:
	if not (state["catalogue"] as Dictionary).has(uid) or nombre <= 0.0:
		return false
	var commandes: Dictionary = state["stock_commande"]
	commandes[uid] = float(commandes.get(uid, 0.0)) + floorf(nombre)
	return true


# --- banque : la dette a un plafond de réputation et un loyer hebdomadaire ---------------

static func plafond_banque(state: Dictionary, data: Dictionary) -> float:
	var b: Dictionary = data["constants"]["banque"]
	var rep: float = maxf(float(state["rep"]["civile"]), float(state["rep"]["militaire"]))
	return float(b["plafond_base"]) + float(b["plafond_par_rep"]) * rep


static func _emprunter(state: Dictionary, data: Dictionary, montant: float) -> bool:
	if montant <= 0.0:
		return false
	if float(state.get("emprunt", 0.0)) + montant > plafond_banque(state, data):
		return false
	state["emprunt"] = float(state.get("emprunt", 0.0)) + montant
	state["tresorerie"] = float(state["tresorerie"]) + montant
	Comptes.note(state, "banque", montant)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) + montant
	return true


static func _rembourser(state: Dictionary, montant: float) -> bool:
	var du: float = float(state.get("emprunt", 0.0))
	if montant <= 0.0 or du <= 0.0:
		return false
	var verse: float = minf(minf(montant, du), maxf(float(state["tresorerie"]), 0.0))
	if verse <= 0.0:
		return false
	state["emprunt"] = du - verse
	state["tresorerie"] = float(state["tresorerie"]) - verse
	Comptes.note(state, "banque", -verse)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - verse
	return true


# Filiale coloniale : un 5e emplacement de catalogue + un débouché captif — le puits à
# argent de fin de partie. Une seule, à vie.
static func _fonder_filiale(state: Dictionary, data: Dictionary) -> bool:
	if bool(state.get("filiale", false)):
		return false
	var cout: float = float(data["constants"]["filiale"]["cout"])
	if float(state["tresorerie"]) < cout:
		return false
	state["tresorerie"] = float(state["tresorerie"]) - cout
	Comptes.note(state, "atelier", -cout)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout
	state["filiale"] = true
	(state["presse"] as Array).append({"titre": "UNE FILIALE AUX COLONIES",
		"corps": "Votre maison ouvre un comptoir outre-mer : une gamme élargie, des commandes captives — et un gouffre d'investissement assumé."})
	return true


# Plafond de catalogue effectif (la filiale ouvre un 5e emplacement).
static func max_produits(state: Dictionary, data: Dictionary) -> int:
	return int(data["constants"]["eco"]["max_produits"]) + (1 if bool(state.get("filiale", false)) else 0)


# Bradage colonial : retirer un produit ET solder son carnet aux compagnies coloniales —
# la moitié du prix en cash immédiat, mais casser les prix se paie en réputation.
# Retrait simple : le stock restant est liquidé discrètement au tarif de l'occasion
# (sans malus de réputation — le bradage public, lui, en a un).
static func _retirer_produit(state: Dictionary, data: Dictionary, uid: String) -> bool:
	if not (state["catalogue"] as Dictionary).has(uid):
		return false
	var stock: Dictionary = state.get("stock", {})
	var en_stock: float = float(stock.get(uid, 0.0))
	if en_stock > 0.0:
		var recette_s: float = en_stock * float(state["catalogue"][uid]["prix"]) \
			* float(data["constants"]["occasion"]["mult"])
		state["tresorerie"] = float(state["tresorerie"]) + recette_s
		Comptes.note(state, "occasion", recette_s)
		state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) + recette_s
		stock.erase(uid)
	(state.get("stock_commande", {}) as Dictionary).erase(uid)
	return (state["catalogue"] as Dictionary).erase(uid)


# Recette d'un bradage, PARTAGÉE avec l'écran Marché : sans ce point unique, le bouton peut
# annoncer un montant que la sim ne verse pas.
# Le STOCK existe et a déjà été payé à la construction → il part au tarif de l'occasion.
# Le CARNET, lui, n'a JAMAIS été construit : on ne vend pas des appareils qui n'existent pas,
# on CÈDE les commandes à un opérateur colonial — on ne touche donc que la MARGE qu'on aurait
# faite, amputée d'autant. Avant, le carnet était payé PLEIN PRIX sans qu'aucun coût de
# production ne soit déduit : du profit pur pour rien, et un exploit (gonfler le carnet puis
# brader) — retour joueur : « il en reste 3 à livrer et on les brade alors qu'on les a pas
# produits ? ».
static func recette_bradage(state: Dictionary, data: Dictionary, uid: String) -> float:
	if not (state["catalogue"] as Dictionary).has(uid):
		return 0.0
	var produit: Dictionary = state["catalogue"][uid]
	var mult: float = float(data["constants"]["occasion"]["mult"])
	var stock_u: float = float((state.get("stock", {}) as Dictionary).get(uid, 0.0))
	var marge_u: float = maxf(float(produit["prix"])
		- float((produit["specs"] as Dictionary)["cout_unitaire"]), 0.0)
	return stock_u * float(produit["prix"]) * mult + float(produit["carnet"]) * marge_u * mult


static func _brader_flotte(state: Dictionary, data: Dictionary, uid: String) -> bool:
	if not (state["catalogue"] as Dictionary).has(uid):
		return false
	var produit: Dictionary = state["catalogue"][uid]
	var oc: Dictionary = data["constants"]["occasion"]
	var stock: Dictionary = state.get("stock", {})
	var recette: float = recette_bradage(state, data, uid)
	stock.erase(uid)
	(state.get("stock_commande", {}) as Dictionary).erase(uid)
	state["tresorerie"] = float(state["tresorerie"]) + recette
	Comptes.note(state, "occasion", recette)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) + recette
	var domaine: String = str(data["segments"][str(produit["segment"])]["domaine_repu"])
	Reputation.bonus(state["rep"], domaine, -float(oc["rep_malus"]))
	(state["catalogue"] as Dictionary).erase(uid)
	(state["presse"] as Array).append({"titre": "SOLDES COLONIAUX",
		"corps": "Votre gamme part au rabais vers les colonies : %d £ encaissés, la marque en sort écornée." % int(recette)})
	return true


static func _prix(state: Dictionary, intention: Dictionary) -> bool:
	var uid: String = str(intention["produit"])
	if not (state["catalogue"] as Dictionary).has(uid):
		return false
	state["catalogue"][uid]["prix"] = maxf(float(intention["prix"]), 1.0)
	return true


# Disperser les chaînes en province : l'assurance anti-raid, chère et irréversible. Elle
# n'efface pas les dégâts déjà subis — c'est une précaution, pas une réparation.
static func _disperser(state: Dictionary, data: Dictionary) -> bool:
	if bool(state.get("dispersion", false)):
		return false
	var cout: float = Bombardements.cout_dispersion(data)
	if float(state["tresorerie"]) < cout:
		return false
	state["tresorerie"] = float(state["tresorerie"]) - cout
	Comptes.note(state, "atelier", -cout)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout
	state["dispersion"] = true
	(state["presse"] as Array).append({"titre": "VOS CHAÎNES PARTENT EN PROVINCE",
		"corps": "Garages, filatures désaffectées, hangars de campagne : la production est éclatée sur des dizaines de sites. Un raid ne peut plus vous arrêter net."})
	return true
