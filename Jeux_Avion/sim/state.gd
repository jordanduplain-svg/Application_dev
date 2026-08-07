# Raison d'être : construction du state initial (100 % JSON), sérialisation canonique
# (clés triées, pleine précision) et garde-fous de fin de tick (NaN, bornes, parts).
extends RefCounted

# Année du tick 0 — LA seule ancre temporelle du jeu (Angleterre, 1922-1945).
const AN0: float = 1922.0

const CHEMINS_DATA: Dictionary = {
	"constants": "res://data/constants.json",
	"engines": "res://data/engines.json",
	"segments": "res://data/segments.json",
	"technos": "res://data/technos.json",
	"rivals": "res://data/rivals.json",
	"contracts": "res://data/contracts.json",
	"engineers": "res://data/engineers.json",
	"events": "res://data/events.json",
	"raids": "res://data/raids.json",
	"start": "res://data/start.json",
	"calibration": "res://data/calibration.json",
	"archetypes": "res://data/archetypes.json",
	"essais": "res://data/essais.json",
}


static func charger_data() -> Dictionary:
	var data: Dictionary = {}
	for cle: String in CHEMINS_DATA:
		var texte: String = FileAccess.get_file_as_string(str(CHEMINS_DATA[cle]))
		assert(texte != "", "data manquante : " + str(CHEMINS_DATA[cle]))
		data[cle] = JSON.parse_string(texte)
		assert(data[cle] != null, "JSON invalide : " + str(CHEMINS_DATA[cle]))
	return data


static func nouvelle_partie(graine: int, data: Dictionary) -> Dictionary:
	var eco: Dictionary = data["constants"]["eco"]
	var depart: Dictionary = data["start"]
	var rivaux: Dictionary = {}
	for maison: String in cles_triees(data["rivals"]["maisons"]):
		var drv: Dictionary = data["rivals"]["maisons"][maison]
		# La maison issue d'une fusion n'existe qu'après le rapprochement (Marche._fusion).
		if bool(drv.get("fusion_only", false)):
			continue
		rivaux[maison] = {
			"rd_pool": 0.0,
			"ca_trim": 0.0,
			"nb_produits": 0.0,
			# Capacité vivante (étape ⑤) : part de capacite_trim, grandit si le carnet déborde.
			"capacite": float(drv["capacite_trim"]),
			"technos": [],
			"catalogue": {},
			"rep": (drv["rep_depart"] as Dictionary).duplicate(true),
		}
	return {
		"rng": graine & 0xFFFFFFFF,
		"graine": graine & 0xFFFFFFFF,
		"tick": 0,
		"fin": "",
		"tresorerie": float(eco["tresorerie_depart"]),
		"semaines_rouge": 0.0,
		"rep": {"civile": float(depart["rep_civile"]), "militaire": float(depart["rep_militaire"])},
		# Relation avec l'Air Ministry (0..1, départ neutre) : pondère les Spécifications,
		# ouvre l'acompte bonifié au-dessus du seuil de faveur.
		"ministere": 0.5,
		"atelier": {"palier": 1.0, "chantier_sem": 0.0},
		"ingenieurs": (depart["ingenieurs"] as Array).duplicate(true),
		"recrutement": {"candidats": []},
		"prochain_id": 1.0,
		"designs": {},
		"catalogue": {},
		"recherche": {"faites": [], "en_cours": {}, "paris_pionniers": [], "annees": {}},
		# Archétypes débloqués (combos de technos) : préréglages chargeables au Bureau.
		"archetypes": [],
		# Campagnes d'essais en vol en cours (uid_design → restant/défauts/correction).
		"essais": {},
		# Brevets : id_techno -> {detenteur ("joueur" ou maison rivale), expire (tick)}.
		"brevets": {},
		"rivaux": rivaux,
		"ao": {"candidatures": {}, "resolutions": {}, "contrats": []},
		"evenements": {"faits": [], "en_attente": "", "dernier_tick": -99.0},
		"modificateurs": [],
		"gels": {"production": 0.0, "etudes": 0.0, "gele_trim": 0.0},
		"plafond_atelier": false,
		"plafond_atelier_fin": 0.0,
		"revelation": false,
		"pilotes": [],
		"memorial": [],
		"epreuves_faites": [],
		"palmares": [],
		"presse": [],
		# Licences de cellule déjà vendues ("maison:segment"), à VIE — même après que le
		# rival ait renouvelé son clone, empêche de refaire la même vente (le renouvellement
		# libérait le slot, ce qui rendait la rente infiniment répétable).
		# Partenariat motoriste exclusif ("" = libre ; sinon la marque signée, à vie).
		"motoriste": "",
		# Offres de production sous licence acceptées (guerre) — ids, à vie.
		"sous_licences": [],
		# Génies déjà annoncés par la presse (l'apparition ne se re-toaste pas).
		"genies_annonces": [],
		# Mandats du conseil d'administration : annoncés / résolus (id → true si tenu).
		"conseil": {"annonces": [], "resolus": {}},
		# Assurance-flotte : prime hebdo par produit, dégâts d'accident amortis.
		"assurance": false,
		# Grèves internes : semaines consécutives de moral d'équipe au fond, et cooldown.
		"moral_bas_sem": 0.0,
		"greve_dernier_tick": -999.0,
		# Hangar (uid produit → appareils en stock, payés à la construction) et commandes
		# d'atelier en attente (produites au trimestre sur la capacité restante).
		"stock": {},
		"stock_commande": {},
		# Contrats d'entretien de flotte : revenu récurrent, accidents à double réputation.
		"entretien_flotte": false,
		# Dette bancaire (intérêts hebdo ; le plafond suit la réputation).
		"emprunt": 0.0,
		# Filiale coloniale : 5e emplacement de catalogue + commandes captives.
		"filiale": false,
		# Dernier tick d'une campagne de publicité (levier de réputation civile du début,
		# quand les livraisons ne la bougent pas encore) : sert le cooldown. -999 = jamais.
		"pub_dernier_tick": -999.0,
		"marche": {},
		# Trésorerie relevée à chaque trimestre (5 ans glissants) : la courbe du livret
		# comptable. Dans le state, donc sauvegardée — sinon elle repart vide à la reprise.
		"tresorerie_hist": [],
		# Le livret comptable (écran marché) dérive ses lignes de ces 3 compteurs cumulés :
		# marge = ventes marché + séries/acomptes AO ; charges = salaires/frais fixes/entretien
		# (le drain hebdo régulier) ; autres = investissements ponctuels (protos, recherche,
		# agrandissement, licenciement) et imprévus (primes de raids, événements chiffrés).
		"stats": {"livraisons": 0.0, "ca_cumule": 0.0, "marge_cumulee": 0.0,
			"charges_cumulees": 0.0, "autres_cumules": 0.0},
		# Journal comptable : annee -> {poste: montant}. Alimenté par Comptes.note.
		"comptes": {},
		# Trimestres consécutifs de domination du joueur : arme la fusion des rivaux.
		"fusion_compteur": 0.0,
		# Bureau d'études moteurs : département fondé, moteurs maison, banc d'essai en cours.
		# Chaînes dispersées (parade aux raids) et semaines de production perdues en cours.
		# Part de l'atelier réservée au marché AVANT les séries d'État (0 = priorité d'État).
		"alloc_marche": 0.0,
		"dispersion": false,
		"degats_sem": 0.0,
		"dept_moteurs": false,
		"moteurs": {},
		"banc": {},
	}


static func cles_triees(d: Dictionary) -> Array:
	var cles: Array = d.keys()
	cles.sort()
	return cles


static func serialiser(state: Dictionary) -> String:
	return JSON.stringify(state, "", true, true)


static func canonique(state: Dictionary) -> Dictionary:
	return JSON.parse_string(serialiser(state))


static func hacher(state: Dictionary) -> String:
	return serialiser(state).sha256_text()


# Équivalence à epsilon près : le round-trip texte JSON de Godot n'est pas bit-exact
# sur les doubles (dernier ULP), donc le contrat save/load est « même campagne à 1e-9
# relatif » — le déterminisme bit-exact, lui, se teste en mémoire sans round-trip.
static func equivalents(a: Variant, b: Variant) -> bool:
	if typeof(a) != typeof(b):
		return false
	match typeof(a):
		TYPE_FLOAT:
			return absf(a - b) <= maxf(1e-6, 1e-9 * maxf(absf(a), absf(b)))
		TYPE_DICTIONARY:
			if (a as Dictionary).size() != (b as Dictionary).size():
				return false
			for cle: Variant in a:
				if not (b as Dictionary).has(cle) or not equivalents(a[cle], b[cle]):
					return false
			return true
		TYPE_ARRAY:
			if (a as Array).size() != (b as Array).size():
				return false
			for i: int in range((a as Array).size()):
				if not equivalents(a[i], b[i]):
					return false
			return true
	return a == b


static func valider(state: Dictionary) -> void:
	# assert() est retiré des builds exportés : sans ce garde, _sain parcourrait tout le
	# state à chaque tick pour ne rien vérifier (coût pur, filet nul). En debug (éditeur,
	# tests headless) tout tourne — c'est là qu'un NaN/hors-borne doit crier.
	if not OS.is_debug_build():
		return
	_sain(state, "state")
	assert(float(state["tresorerie"]) > -1e9, "trésorerie absurde")
	var rep: Dictionary = state["rep"]
	assert(float(rep["civile"]) >= 0.0 and float(rep["civile"]) <= 1.0, "rep civile hors bornes")
	assert(float(rep["militaire"]) >= 0.0 and float(rep["militaire"]) <= 1.0, "rep militaire hors bornes")
	var marche: Dictionary = state["marche"]
	for nom_seg: String in marche:
		var parts: Dictionary = marche[nom_seg]["parts"]
		if parts.size() > 0:
			var somme: float = 0.0
			for uid: String in parts:
				somme += float(parts[uid])
			assert(absf(somme - 1.0) < 0.001, "somme des parts != 1 dans " + nom_seg)
	var cat: Dictionary = state["catalogue"]
	for uid2: String in cat:
		assert(float(cat[uid2]["carnet"]) >= 0.0, "carnet négatif : " + uid2)
	for contrat: Dictionary in state["ao"]["contrats"]:
		assert(float(contrat["restant"]) >= 0.0, "contrat AO négatif : " + str(contrat["ao"]))
	for ing: Dictionary in state["ingenieurs"]:
		assert(float(ing["moral"]) >= 0.0 and float(ing["moral"]) <= 1.0, "moral hors bornes : " + str(ing["nom"]))


static func _sain(valeur: Variant, chemin: String) -> void:
	match typeof(valeur):
		TYPE_FLOAT:
			assert(not is_nan(valeur), "NaN : " + chemin)
			assert(not is_inf(valeur), "Inf : " + chemin)
		TYPE_DICTIONARY:
			for cle: Variant in valeur:
				_sain(valeur[cle], chemin + "." + str(cle))
		TYPE_ARRAY:
			for i: int in range((valeur as Array).size()):
				_sain(valeur[i], chemin + "[%d]" % i)
