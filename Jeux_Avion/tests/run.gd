# Raison d'être : porte d'entrée unique des tests headless (godot --headless -s res://tests/run.gd)
# — calibration ±5 %, déterminisme seedé, save/load, conservation du marché, campagnes bot.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Avion := preload("res://sim/aircraft.gd")
const Marche := preload("res://sim/market.gd")
const Contrats := preload("res://sim/contracts.gd")

var echecs: Array[String] = []


func _initialize() -> void:
	# Chien de garde : une erreur runtime avorte les tests avant quit() — sans lui le
	# process tourne pour toujours et l'erreur reste coincée dans le buffer stdout.
	create_timer(240.0).timeout.connect(func() -> void:
		printerr("ECHEC : chien de garde run.gd — erreur runtime dans les tests (voir ci-dessus)")
		quit(1))
	var data: Dictionary = Etat.charger_data()
	_test_calibration(data)
	_test_determinisme(data)
	_test_save_load(data)
	_test_conservation_marche(data)
	_test_ao(data)
	_test_rivaux_reactifs(data)
	_test_clamp_prix(data)
	_test_horizon_recherche(data)
	_test_rd_plancher_sursaut(data)
	_test_essais(data)
	_test_accidents(data)
	_test_conseil_motoriste_genie_licence(data)
	_test_variante_assurance_greve_bradage(data)
	_test_stock_entretien_banque_filiale(data)
	_test_fin_de_partie(data)
	_test_moteurs(data)
	_test_fusion(data)
	_test_ministere(data)
	_test_publicite(data)
	_test_equipe(data)
	_test_designs(data)
	_test_brevets(data)
	_test_archetypes(data)
	_test_evenements(data)
	_test_raids(data)
	_test_fin(data)
	_test_campagnes_bot(data)
	if echecs.is_empty():
		print("TOUS LES TESTS SONT VERTS")
		quit(0)
	else:
		for e: String in echecs:
			printerr("ECHEC : " + e)
		quit(1)


# --- 1. calibration : 3 avions de référence, Vmax ±5 % ------------------------

func _test_calibration(data: Dictionary) -> void:
	var cal: Dictionary = data["calibration"]
	var tol: float = float(cal["tolerance"])
	for r: Dictionary in cal["references"]:
		var specs_r: Dictionary = Avion.specs(r["design"], data)
		var attendu: float = float(r["vmax_attendu"])
		var obtenu: float = float(specs_r["vmax_kmh"])
		var ecart: float = absf(obtenu - attendu) / attendu
		print("calibration | %-28s %6.1f km/h (attendu %3.0f, ecart %4.1f%%)"
			% [str(r["design"]["nom"]), obtenu, attendu, ecart * 100.0])
		if ecart > tol:
			echecs.append("calibration hors tolérance : " + str(r["design"]["nom"]))


# --- 2. déterminisme : même graine, même hash ---------------------------------

func _test_determinisme(data: Dictionary) -> void:
	var h1: String = Etat.hacher(_campagne(42, data, 260))
	var h2: String = Etat.hacher(_campagne(42, data, 260))
	if h1 == h2:
		print("déterminisme | double run seedé identique (260 ticks)")
	else:
		echecs.append("déterminisme : hashes différents pour la même graine")


# --- 3. save/load : reprise sans divergence -----------------------------------

func _test_save_load(data: Dictionary) -> void:
	var s1: Dictionary = _campagne(7, data, 130)
	var texte: String = Etat.serialiser(s1)
	var s2: Dictionary = JSON.parse_string(texte)
	if not Etat.equivalents(s1, s2):
		echecs.append("save/load : état non équivalent dès la sauvegarde")
		_imprimer_diff(s1, s2, "state", 5)
		return
	for i: int in range(60):
		_bot(s1, data)
		Sim.tick(s1, data)
		_bot(s2, data)
		Sim.tick(s2, data)
		if not Etat.equivalents(s1, s2):
			echecs.append("save/load : divergence au tick de reprise %d" % (i + 1))
			_imprimer_diff(s1, s2, "state", 5)
			return
	print("save/load | roundtrip puis 60 ticks : aucune divergence")


# Diff récursif : imprime les premiers chemins qui diffèrent entre deux states.
func _imprimer_diff(a: Variant, b: Variant, chemin: String, budget: int) -> int:
	if budget <= 0:
		return 0
	if typeof(a) != typeof(b):
		printerr("  diff type %s : %s vs %s" % [chemin, type_string(typeof(a)), type_string(typeof(b))])
		return budget - 1
	match typeof(a):
		TYPE_DICTIONARY:
			for cle: Variant in a:
				if not (b as Dictionary).has(cle):
					printerr("  diff clé absente à droite : %s.%s" % [chemin, str(cle)])
					budget -= 1
				else:
					budget = _imprimer_diff(a[cle], b[cle], chemin + "." + str(cle), budget)
				if budget <= 0:
					return 0
			for cle: Variant in b:
				if not (a as Dictionary).has(cle):
					printerr("  diff clé absente à gauche : %s.%s" % [chemin, str(cle)])
					budget -= 1
					if budget <= 0:
						return 0
		TYPE_ARRAY:
			if (a as Array).size() != (b as Array).size():
				printerr("  diff taille %s : %d vs %d" % [chemin, (a as Array).size(), (b as Array).size()])
				return budget - 1
			for i: int in range((a as Array).size()):
				budget = _imprimer_diff(a[i], b[i], chemin + "[%d]" % i, budget)
				if budget <= 0:
					return 0
		_:
			if not Etat.equivalents(a, b):
				printerr("  diff valeur %s : %s vs %s" % [chemin, str(a), str(b)])
				return budget - 1
	return budget


# --- 4. marché : Σ parts = 1, ventes ≥ 0, les rivaux vendent -------------------

func _test_conservation_marche(data: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(3, data)
	var pire_ecart: float = 0.0
	for i: int in range(520):
		_bot(state, data)
		Sim.tick(state, data)
		if int(state["tick"]) % 13 == 0:
			for nom_seg: String in Etat.cles_triees(state["marche"]):
				var parts: Dictionary = state["marche"][nom_seg]["parts"]
				if parts.size() == 0:
					continue
				var somme: float = 0.0
				for uid: String in parts:
					somme += float(parts[uid])
				pire_ecart = maxf(pire_ecart, absf(somme - 1.0))
	if pire_ecart > 0.001:
		echecs.append("conservation : somme des parts dérive (%.6f)" % pire_ecart)
	var ventes_rivales: float = 0.0
	var ventes_joueur: float = 0.0
	for nom_seg: String in Etat.cles_triees(state["marche"]):
		for h: Dictionary in state["marche"][nom_seg]["historique"]:
			for uid: String in h["ventes"]:
				if uid.begins_with("p"):
					ventes_joueur += float(h["ventes"][uid])
				else:
					ventes_rivales += float(h["ventes"][uid])
	print("marché | pire écart Σparts %.6f, ventes joueur %.0f, ventes rivales %.0f (10 ans)"
		% [pire_ecart, ventes_joueur, ventes_rivales])
	if ventes_rivales <= 0.0:
		echecs.append("marché : les rivaux ne vendent rien")
	if ventes_joueur <= 0.0:
		echecs.append("marché : le joueur (bot) ne vend rien")


# --- 5. AO militaires : fenêtre, résolution 3 candidats, acompte, série prioritaire ----

func _test_ao(data: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(5, data)
	state["tresorerie"] = 3000000.0  # fixture : on teste la mécanique AO, pas la survie
	if Sim.appliquer(state, data, {"type": "candidater_ao", "ao": "1927_jockey", "produit": "px"}):
		echecs.append("AO : candidature acceptée avant l'ouverture")
	while Marche.annee_de(state) < 1932.1:
		Sim.tick(state, data)
	# Sans candidature du joueur, les AO se résolvent entre rivaux (Jockey 1927, C1 1930).
	var resolutions: Dictionary = state["ao"]["resolutions"]
	if not resolutions.has("1927_jockey") or not resolutions.has("1930_c1"):
		echecs.append("AO : Jockey 1927 / C1 1930 non résolus sans le joueur")
		return
	if str(resolutions["1927_jockey"]["vainqueur"]) == "joueur":
		echecs.append("AO : le joueur gagne un AO sans candidater")
	# Re-provision : dix ans d'attente à vide (base 1922) ont mangé la fixture initiale.
	state["tresorerie"] = 3000000.0
	# Un bombardier taillé pour le cahier du BN3 (autonomie, capacité, fiabilité) : les rivaux
	# n'alignent que leur chasseur d'export générique — la victoire par sur-mesure, LE gameplay AO.
	var design: Dictionary = {
		"nom": "Pélican", "annee": Marche.annee_de(state), "formule": "monoplan", "structure": "mixte",
		"moteur": Avion.meilleur_moteur(data, Marche.annee_de(state), "eco"),
		"surface": 42.0, "carburant_kg": 1300.0, "charge_utile_kg": 540.0,
		"armement": 0, "features": [],
	}
	Sim.appliquer(state, data, {"type": "nouveau_design", "design": design})
	var uid_d: String = str(Etat.cles_triees(state["designs"])[0])
	Sim.appliquer(state, data, {"type": "lancer_produit", "design": uid_d,
		"segment": "export_militaire", "prix": 300000.0})
	var uid_p: String = str(Etat.cles_triees(state["catalogue"])[0])
	if not Sim.appliquer(state, data, {"type": "candidater_ao", "ao": "1932_bn3", "produit": uid_p}):
		echecs.append("AO : candidature refusée pendant la fenêtre")
	# Jusqu'au tick JUSTE avant la clôture, puis un tick mesuré : acompte + première
	# livraison de série tombent ce tick-là (résolution puis trimestre, même semaine).
	while not resolutions.has("1932_bn3") and int(state["tick"]) < 620:
		var treso_avant: float = float(state["tresorerie"])
		var livraisons_avant: float = float(state["stats"]["livraisons"])
		Sim.tick(state, data)
		if not resolutions.has("1932_bn3"):
			continue
		var res: Dictionary = resolutions["1932_bn3"]
		if (res["candidats"] as Array).size() != 3:
			echecs.append("AO : %d candidats au lieu de 3 (joueur + 2 rivaux)" % (res["candidats"] as Array).size())
		print("AO | Jockey 1927 : vainqueur=%s (sans le joueur) | BN3 1932 : vainqueur=%s, scores=%s"
			% [str(resolutions["1927_jockey"]["vainqueur"]), str(res["vainqueur"]), str(_scores_de(res))])
		if str(res["vainqueur"]) != "joueur":
			echecs.append("AO : le bombardier sur mesure devrait battre les chasseurs rivaux au BN3")
			return
		if (state["ao"]["contrats"] as Array).size() != 1:
			echecs.append("AO : pas de contrat de série après la victoire")
			return
		var contrat: Dictionary = state["ao"]["contrats"][0]
		var cao: Dictionary = data["constants"]["ao"]
		var acompte: float = float(cao["acompte_part"]) * 18.0 * 270000.0
		var capacite: float = 6.0  # palier 1
		if absf(float(contrat["restant"]) - (18.0 - capacite)) > 0.01:
			echecs.append("AO : la série ne réquisitionne pas la capacité du trimestre (restant %.0f)" % float(contrat["restant"]))
		if not float(state["stats"]["livraisons"]) >= livraisons_avant + capacite:
			echecs.append("AO : les livraisons de série ne comptent pas dans les stats")
		var marge_serie: float = capacite * (float(contrat["solde_unitaire"]) - float(contrat["cout_unitaire"]))
		var attendu_min: float = treso_avant + acompte + marge_serie - 20000.0  # frais hebdo + arrondis
		if not float(state["tresorerie"]) > attendu_min:
			echecs.append("AO : acompte ou solde de série non versés (treso %.0f < %.0f)"
				% [float(state["tresorerie"]), attendu_min])
	if not resolutions.has("1932_bn3"):
		echecs.append("AO : pas de résolution après la clôture")


func _scores_de(res: Dictionary) -> String:
	var morceaux: Array = []
	for c: Dictionary in res["candidats"]:
		morceaux.append("%s %.2f" % [str(c["maison"]), float(c["score"])])
	return " / ".join(morceaux)


# --- 6. équipe : bonus réels, recrutement, licenciement, moral -------------------

func _test_equipe(data: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(11, data)
	state["tresorerie"] = 3000000.0  # fixture : mécanique d'équipe, pas survie
	if (state["recrutement"]["candidats"] as Array).size() != 3:
		echecs.append("équipe : pas de candidats au démarrage")
	# La recherche va plus vite avec toute l'équipe au labo : durée pionnier ×2 raccourcie.
	for i: int in range(3):
		Sim.appliquer(state, data, {"type": "affecter", "indice": i, "poste": "recherche"})
	Sim.appliquer(state, data, {"type": "lancer_recherche", "techno": "capot_naca"})
	var duree_data: float = float(data["technos"]["capot_naca"]["duree_sem"]) \
			* float(data["constants"]["recherche"]["mult_duree_pionnier"])
	var semaines: int = 0
	while not (state["recherche"]["faites"] as Array).has("capot_naca") and semaines < 200:
		Sim.tick(state, data)
		semaines += 1
	print("équipe | capot NACA pionnier : %d sem (brut %d) — l'équipe au labo accélère" % [semaines, int(duree_data)])
	if not float(semaines) < duree_data:
		echecs.append("équipe : la recherche n'est pas accélérée par les ingénieurs (%d ≥ %d)" % [semaines, int(duree_data)])
	# Recrutement : effectif +1, retiré du vivier ; licenciement : indemnité débitée.
	var effectif: int = (state["ingenieurs"] as Array).size()
	if not Sim.appliquer(state, data, {"type": "recruter", "indice": 0}):
		echecs.append("équipe : recrutement refusé avec un vivier plein")
	if (state["ingenieurs"] as Array).size() != effectif + 1 \
			or (state["recrutement"]["candidats"] as Array).size() != 2:
		echecs.append("équipe : le recrutement ne déplace pas le candidat")
	var salaire: float = float(state["ingenieurs"][effectif]["salaire_sem"])
	var treso_avant: float = float(state["tresorerie"])
	if not Sim.appliquer(state, data, {"type": "licencier", "indice": effectif}):
		echecs.append("équipe : licenciement refusé")
	var attendu: float = treso_avant - float(data["constants"]["equipe"]["indemnite_sem"]) * salaire
	if absf(float(state["tresorerie"]) - attendu) > 0.01:
		echecs.append("équipe : indemnité de licenciement incorrecte")
	if Sim.appliquer(state, data, {"type": "affecter", "indice": 0, "poste": "cuisine"}):
		echecs.append("équipe : poste inconnu accepté")
	# Moral : des semaines dans le rouge minent l'équipe.
	var moral_avant: float = float(state["ingenieurs"][0]["moral"])
	state["tresorerie"] = -1000.0
	for i: int in range(3):
		Sim.tick(state, data)
	if not float(state["ingenieurs"][0]["moral"]) < moral_avant:
		echecs.append("équipe : le moral ne baisse pas dans le rouge")


# --- 6ter. brouillons : un design libre se jette, un design en production non -------

func _test_designs(data: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(29, data)
	state["tresorerie"] = 3000000.0
	var design: Dictionary = {
		"nom": "Brouillon", "annee": 1925.0, "formule": "biplan", "structure": "bois",
		"moteur": str(Etat.cles_triees(data["engines"])[0]), "surface": 30.0,
		"carburant_kg": 600.0, "charge_utile_kg": 300.0, "armement": 0, "features": [],
	}
	var uid_libre: String = "d%d" % int(state["prochain_id"])
	Sim.appliquer(state, data, {"type": "nouveau_design", "design": design})
	var uid_produit: String = "d%d" % int(state["prochain_id"])
	Sim.appliquer(state, data, {"type": "nouveau_design", "design": design})
	Sim.appliquer(state, data, {"type": "lancer_produit", "design": uid_produit,
		"segment": "ligne_postale", "prix": 200000.0})
	if not Sim.appliquer(state, data, {"type": "supprimer_design", "design": uid_libre}):
		echecs.append("brouillons : un design sans produit devrait se supprimer")
	if (state["designs"] as Dictionary).has(uid_libre):
		echecs.append("brouillons : le design libre est encore là")
	if Sim.appliquer(state, data, {"type": "supprimer_design", "design": uid_produit}):
		echecs.append("brouillons : un design en production a été supprimé")
	if Sim.appliquer(state, data, {"type": "supprimer_design", "design": "d999"}):
		echecs.append("brouillons : un design inexistant a été « supprimé »")
	# La courbe du livret comptable se remplit d'un point par trimestre.
	for i: int in range(26):
		Sim.tick(state, data)
	if (state["tresorerie_hist"] as Array).size() != 2:
		echecs.append("courbe : %d relevés de trésorerie après 2 trimestres" % (state["tresorerie_hist"] as Array).size())
	print("brouillons | design libre jeté, design en production protégé, courbe alimentée")


# --- 6bis. brevets : dépôt pionnier, royalties rivales, licence, contournement ------

func _test_brevets(data: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(13, data)
	state["tresorerie"] = 5000000.0  # fixture : mécanique des brevets, pas survie
	var cr: Dictionary = data["constants"]["recherche"]
	# Pari pionnier tenu → brevet joueur déposé à la fin de la recherche.
	Sim.appliquer(state, data, {"type": "lancer_recherche", "techno": "capot_naca"})
	var semaines: int = 0
	while not (state["recherche"]["faites"] as Array).has("capot_naca") and semaines < 400:
		Sim.tick(state, data)
		semaines += 1
	var Recherche := preload("res://sim/research.gd")
	if Recherche.brevet_actif(state, "capot_naca") != "joueur":
		echecs.append("brevets : le pari pionnier ne dépose pas de brevet")
	# Un rival suiveur adopte la techno brevetée → royalties versées au joueur.
	state["rivaux"]["blochard"]["technos"] = ["helice_metallique", "radio_embarquee"]
	state["rivaux"]["blochard"]["rd_pool"] = 1e9
	var treso_avant: float = float(state["tresorerie"])
	Marche._rivaux_rd(state, data, 1930.0)
	var royalties: float = float(data["technos"]["capot_naca"]["cout_base"]) * float(cr["royalties_part"])
	if absf(float(state["tresorerie"]) - treso_avant - royalties) > 0.01:
		echecs.append("brevets : royalties non versées à l'adoption rivale (%f attendu)" % royalties)
	print("brevets | capot NACA breveté en %d sem, royalties %d F encaissées" % [semaines, int(royalties)])
	# Brevet rival : licence = techno immédiate au prix data ; contournement = durée ×1.3.
	state["brevets"]["train_rentrant"] = {"detenteur": "marane", "expire": float(state["tick"]) + 208.0}
	treso_avant = float(state["tresorerie"])
	if not Sim.appliquer(state, data, {"type": "acheter_licence", "techno": "train_rentrant"}):
		echecs.append("brevets : achat de licence refusé")
	if not (state["recherche"]["faites"] as Array).has("train_rentrant"):
		echecs.append("brevets : la licence ne débloque pas la techno")
	var prix_licence: float = float(data["technos"]["train_rentrant"]["cout_base"]) * float(cr["licence_achat_part"])
	if absf(treso_avant - float(state["tresorerie"]) - prix_licence) > 0.01:
		echecs.append("brevets : prix de licence incorrect")
	# On avance l'horloge AVANT de poser le brevet : le cockpit fermé (1931) est hors de
	# l'HORIZON de recherche depuis 1922, et ce test mesure le contournement de brevet, pas la
	# disponibilité de la techno. (Poser le brevet d'abord le faisait expirer avec l'avance.)
	state["tick"] = float(state["tick"]) + 52.0 * 4.0
	state["brevets"]["cockpit_ferme"] = {"detenteur": "marane", "expire": float(state["tick"]) + 208.0}
	Sim.appliquer(state, data, {"type": "lancer_recherche", "techno": "cockpit_ferme"})
	var attendu_c: float = float(data["technos"]["cockpit_ferme"]["duree_sem"]) \
			* float(cr["mult_duree_pionnier"]) * float(cr["mult_duree_contournement"])
	if absf(float(state["recherche"]["en_cours"]["cockpit_ferme"]) - attendu_c) > 0.01:
		echecs.append("brevets : le contournement n'allonge pas la durée")
	# Lignées : le turbo exige la suralimentation, recherche comme licence.
	if Sim.appliquer(state, data, {"type": "lancer_recherche", "techno": "turbocompresseur"}):
		echecs.append("lignées : turbo accepté sans suralimentation")
	state["brevets"]["turbocompresseur"] = {"detenteur": "marane", "expire": float(state["tick"]) + 208.0}
	if Sim.appliquer(state, data, {"type": "acheter_licence", "techno": "turbocompresseur"}):
		echecs.append("lignées : licence turbo acceptée sans suralimentation")


# --- 7. événements : chaque événement × chaque choix sur fixture (anti-bugs §14) ---

func _fixture_evenements(data: Dictionary) -> Dictionary:
	# Fixture riche : produits postal + export + transport, pilote recruté, cash large —
	# toutes les conditions d'événement sont remplissables.
	var state: Dictionary = Sim.nouvelle_partie(17, data)
	state["tresorerie"] = 5000000.0
	for seg: String in ["ligne_postale", "export_militaire", "transport_civil"]:
		var uid_d: String = "d%d" % int(state["prochain_id"])
		Sim.appliquer(state, data, {"type": "nouveau_design", "design": {
			"nom": "Fix " + seg, "annee": 1925.0, "formule": "biplan", "structure": "bois",
			"moteur": str(Etat.cles_triees(data["engines"])[0]), "surface": 30.0,
			"carburant_kg": 600.0, "charge_utile_kg": 300.0, "armement": 0, "features": []}})
		# Prix margé sur le coût réel : un prix en dur sous le coût fait vendre à perte
		# et la fixture finit en faillite avant 1930 (vécu).
		var prix_f: float = float(state["designs"][uid_d]["specs"]["cout_unitaire"]) * 1.3
		Sim.appliquer(state, data, {"type": "lancer_produit", "design": uid_d, "segment": seg, "prix": prix_f})
	Sim.appliquer(state, data, {"type": "recruter_pilote", "nom": "Tremayne"})
	return state


# --- fin de partie : impôt sur les surprofits, raids, allocation d'atelier -------------

func _test_fin_de_partie(data: Dictionary) -> void:
	var Impots: GDScript = load("res://sim/impots.gd")
	var Bombardements: GDScript = load("res://sim/bombardements.gd")
	var Marche2: GDScript = load("res://sim/market.gd")
	var ci: Dictionary = data["constants"]["impots"]
	# IMPÔT : au-delà de la franchise, l'État prend `taux` du bénéfice de l'exercice CLOS.
	var s: Dictionary = Sim.nouvelle_partie(81, data)
	s["tick"] = float(int((float(ci["annee_debut"]) + 1.0 - Etat.AN0) * 52.0))
	s["comptes"] = {"%d" % int(ci["annee_debut"]): {"ventes": 10000000.0}}
	s["tresorerie"] = 12000000.0
	Impots.tick_annuel(s, data)
	var attendu: float = (10000000.0 - float(ci["franchise"])) * float(ci["taux"])
	if absf(12000000.0 - float(s["tresorerie"]) - attendu) > 1.0:
		echecs.append("impôt : %d prélevé au lieu de %d" % [int(12000000.0 - float(s["tresorerie"])), int(attendu)])
	# Hors période de guerre : rien.
	var s2: Dictionary = Sim.nouvelle_partie(83, data)
	s2["tick"] = float(int((1930.0 - Etat.AN0) * 52.0))
	s2["comptes"] = {"1929": {"ventes": 10000000.0}}
	var t2: float = float(s2["tresorerie"])
	Impots.tick_annuel(s2, data)
	if not is_equal_approx(float(s2["tresorerie"]), t2):
		echecs.append("impôt : prélevé hors de la période de guerre")
	# RAIDS : risque nul avant 1940, non nul après ; la dispersion le réduit fortement.
	var s3: Dictionary = Sim.nouvelle_partie(85, data)
	s3["atelier"]["palier"] = 3.0
	s3["tick"] = float(int((1935.0 - Etat.AN0) * 52.0))
	if Bombardements.risque(s3, data) != 0.0:
		echecs.append("raids : risque non nul avant la guerre")
	s3["tick"] = float(int((1941.0 - Etat.AN0) * 52.0))
	var r_nu: float = Bombardements.risque(s3, data)
	s3["dispersion"] = true
	var r_disperse: float = Bombardements.risque(s3, data)
	if not (r_nu > 0.0 and r_disperse < r_nu):
		echecs.append("raids : la dispersion ne réduit pas le risque (%.3f → %.3f)" % [r_nu, r_disperse])
	# Une usine plus grosse est une cible plus visible.
	var s4: Dictionary = Sim.nouvelle_partie(87, data)
	s4["tick"] = float(int((1941.0 - Etat.AN0) * 52.0))
	s4["atelier"]["palier"] = 2.0
	var r_petit: float = Bombardements.risque(s4, data)
	s4["atelier"]["palier"] = 4.0
	if not Bombardements.risque(s4, data) > r_petit:
		echecs.append("raids : la taille de l'usine ne change pas le risque")
	# Les dégâts amputent la capacité, puis se résorbent.
	var Production2: GDScript = load("res://sim/production.gd")
	var s5: Dictionary = Sim.nouvelle_partie(89, data)
	s5["atelier"]["palier"] = 3.0
	var cap_saine: float = Production2.capacite(s5, data)
	s5["degats_sem"] = 6.5
	if not Production2.capacite(s5, data) < cap_saine:
		echecs.append("raids : les dégâts n'amputent pas la capacité")
	# ALLOCATION : la part réservée au marché échappe aux séries d'État.
	var s6: Dictionary = Sim.nouvelle_partie(91, data)
	s6["atelier"]["palier"] = 3.0
	s6["catalogue"]["p1"] = {"design_uid": "d0", "segment": "ligne_postale", "annee": 1940.0,
		# Specs COMPLÈTES pour les 4 critères de ligne_postale : un produit au catalogue passe
		# par `qualite_segment`, qui indexe `specs[crit]` sans filet (et doit rester ainsi —
		# un .get() défensif masquerait un vrai design incomplet).
		"prix": 100000.0, "carnet": 0.0, "pic_part": 0.0,
		"specs": {"fiabilite": 0.8, "cout_unitaire": 10000.0, "autonomie_km": 1200.0,
			"cout_exploitation": 300.0, "vmax_kmh": 350.0}}
	s6["ao"]["contrats"] = [{"ao": "x", "domaine": "militaire", "produit": "p1", "restant": 100.0,
		"solde_unitaire": 50000.0, "cout_unitaire": 10000.0, "fiabilite": 0.8}]
	s6["alloc_marche"] = 0.5
	Marche2.trimestre(s6, data)
	var livrees_etat: float = 0.0
	for u: String in Etat.cles_triees(s6["ao"]["livrees_trim"]):
		livrees_etat += float(s6["ao"]["livrees_trim"][u])
	if livrees_etat > 17.0:
		echecs.append("allocation : l'État a pris %d appareils malgré 50 %% réservés" % int(livrees_etat))
	print("fin de partie | impôt %d £, raids %.0f→%.0f %% dispersé, allocation %d appareils à l'État OK"
		% [int(attendu), r_nu * 100.0, r_disperse * 100.0, int(livrees_etat)])


# --- bureau d'études moteurs : fonder, concevoir, homologuer, motoriser ---------------

func _test_moteurs(data: Dictionary) -> void:
	var Moteurs: GDScript = load("res://sim/motors.gd")
	var state: Dictionary = Sim.nouvelle_partie(51, data)
	state["tresorerie"] = 4000000.0
	if not Sim.appliquer(state, data, {"type": "fonder_moteurs"}):
		echecs.append("moteurs : fondation du département refusée")
		return
	# Exclusivité dans les DEUX sens : on intègre ou on sous-traite, jamais les deux.
	if Sim.appliquer(state, data, {"type": "signer_motoriste", "marque": "Rolls-Royce"}):
		echecs.append("moteurs : partenariat motoriste accepté malgré le département")
	var s2: Dictionary = Sim.nouvelle_partie(53, data)
	s2["tresorerie"] = 4000000.0
	Sim.appliquer(s2, data, {"type": "signer_motoriste", "marque": "Rolls-Royce"})
	if Sim.appliquer(s2, data, {"type": "fonder_moteurs"}):
		echecs.append("moteurs : département fondé malgré un partenariat signé")
	# Un moteur démesuré est PLUS puissant mais moins fiable que le même en taille saine :
	# sans cette pente, un 36 L maison battait le meilleur moteur du commerce sur tout.
	var petit: Dictionary = {"nom": "sain", "cylindree_l": 21.0, "architecture": "ligne",
		"suralimente": true, "soin": 0.5}
	var gros: Dictionary = petit.duplicate(true)
	gros["cylindree_l"] = 40.0
	var sp: Dictionary = Moteurs.specs(petit, data, 1936.0)
	var sg: Dictionary = Moteurs.specs(gros, data, 1936.0)
	if not (float(sg["puissance_cv"]) > float(sp["puissance_cv"]) 			and float(sg["fiabilite"]) < float(sp["fiabilite"])):
		echecs.append("moteurs : la démesure ne coûte pas de fiabilité")
	# Cycle complet : banc payé, compte à rebours, homologation, design accepté.
	var treso: float = float(state["tresorerie"])
	if not Sim.appliquer(state, data, {"type": "lancer_moteur", "projet": petit}):
		echecs.append("moteurs : mise au banc refusée")
		return
	if not float(state["tresorerie"]) < treso:
		echecs.append("moteurs : le banc d'essai n'est pas payé")
	if Sim.appliquer(state, data, {"type": "lancer_moteur", "projet": gros}):
		echecs.append("moteurs : deux projets au banc en même temps")
	for i: int in range(80):
		Sim.tick(state, data)
		if not Moteurs.moteurs(state).is_empty():
			break
	if Moteurs.moteurs(state).is_empty():
		echecs.append("moteurs : aucun moteur homologué après le banc")
		return
	var uid_m: String = str(Etat.cles_triees(Moteurs.moteurs(state))[0])
	if not Sim.appliquer(state, data, {"type": "nouveau_design", "design": {
			"nom": "essai maison", "annee": Marche.annee_de(state), "formule": "monoplan",
			"structure": "bois", "surface": 20.0, "carburant_kg": 400.0, "charge_utile_kg": 100.0,
			"armement": 2, "features": [], "moteur": uid_m}}):
		echecs.append("moteurs : design au moteur maison refusé")
		return
	# Les specs du moteur maison sont TAMPONNÉES dans le design (aircraft.gd reste pur).
	var uid_d: String = str(Etat.cles_triees(state["designs"])[(state["designs"] as Dictionary).size() - 1])
	if not (state["designs"][uid_d]["design"] as Dictionary).has("moteur_specs"):
		echecs.append("moteurs : specs du moteur maison non tamponnées dans le design")
	print("moteurs | département, banc %d sem, homologation, design motorisé maison OK"
		% int(Moteurs.banc_semaines(petit, data)))


# --- fusion des rivaux : deux maisons dominées n'en font plus qu'une ------------------

func _test_fusion(data_src: Dictionary) -> void:
	# data DUPLIQUÉ : on abaisse le seuil pour tester la MÉCANIQUE, pas le déclencheur
	# (celui-ci reste dormant en campagne bot — vérifié par le harnais, compteur à 0).
	var data: Dictionary = data_src.duplicate(true)
	# Seuil négatif : sans produit joueur la part vaut 0, un seuil à 0 ne déclencherait rien.
	data["rivals"]["regles"]["fusion"]["seuil_part"] = -1.0
	data["rivals"]["regles"]["fusion"]["trimestres"] = 1
	data["rivals"]["regles"]["fusion"]["annee_min"] = 1922
	var state: Dictionary = Etat.nouvelle_partie(3, data)
	for i: int in range(52 * 3):
		Sim.tick(state, data)
	var avant: Dictionary = {}
	for seg: String in Etat.cles_triees(state["marche"]):
		var somme: float = 0.0
		for u: String in Etat.cles_triees(state["marche"][seg]["parts"]):
			somme += float(state["marche"][seg]["parts"][u])
		avant[seg] = somme
	var cap_avant: float = 0.0
	for m: String in Etat.cles_triees(state["rivaux"]):
		cap_avant += float(state["rivaux"][m]["capacite"])
	for i: int in range(14):
		Sim.tick(state, data)
	if (state["rivaux"] as Dictionary).size() != 1:
		echecs.append("fusion : %d maison(s) après le rapprochement au lieu d'1"
			% (state["rivaux"] as Dictionary).size())
		return
	var fusionnee: Dictionary = state["rivaux"][str(Etat.cles_triees(state["rivaux"])[0])]
	if not is_equal_approx(float(fusionnee["capacite"]), cap_avant):
		echecs.append("fusion : capacité %d au lieu de la somme %d"
			% [int(float(fusionnee["capacite"])), int(cap_avant)])
	# Invariant clé : la clientèle des deux maisons est REPORTÉE, pas offerte au joueur.
	for seg: String in Etat.cles_triees(state["marche"]):
		var somme2: float = 0.0
		for u: String in Etat.cles_triees(state["marche"][seg]["parts"]):
			somme2 += float(state["marche"][seg]["parts"][u])
		if absf(somme2 - 1.0) > 0.01 and somme2 > 0.0:
			echecs.append("fusion : parts de %s = %.3f (doit rester 1)" % [seg, somme2])
	# La partie continue : la maison fusionnée renouvelle, cherche et vend.
	for i: int in range(52 * 3):
		Sim.tick(state, data)
	if (fusionnee["catalogue"] as Dictionary).is_empty():
		echecs.append("fusion : la maison fusionnée n'a plus de catalogue")
	print("fusion | 2 maisons → 1 (capacité %d, %d technos, %d produits), parts conservées"
		% [int(float(fusionnee["capacite"])), (fusionnee["technos"] as Array).size(),
			(fusionnee["catalogue"] as Dictionary).size()])


# --- jauge ministère --------------------------------------------

func _test_ministere(data: Dictionary) -> void:
	var state: Dictionary = _fixture_evenements(data)
	var uid_m: String = ""
	for uid: String in Etat.cles_triees(state["catalogue"]):
		if str(state["catalogue"][uid]["segment"]) == "export_militaire":
			uid_m = uid
	# Ministère : la jauge pondère la note des Spécifications (pas neutre entre 0.2 et 0.9).
	state["ministere"] = 0.2
	var note_basse: float = float(Contrats.note_produit(state, data, "1927_jockey", uid_m)["score"])
	state["ministere"] = 0.9
	var note_haute: float = float(Contrats.note_produit(state, data, "1927_jockey", uid_m)["score"])
	if not note_haute > note_basse:
		echecs.append("ministère : la jauge ne pondère pas la note des Spécifications")
	# Refuser le shadow scheme refroidit Whitehall (effet générique des événements).
	var s2: Dictionary = _fixture_evenements(data)
	s2["evenements"]["en_attente"] = "1936_nationalisations"
	Sim.appliquer(s2, data, {"type": "choisir_evenement", "id": "1936_nationalisations", "choix": "b"})
	if not float(s2["ministere"]) < 0.5:
		echecs.append("ministère : le refus du shadow scheme ne refroidit pas la relation")
	print("ministère | note %.2f→%.2f selon la jauge" % [note_basse, note_haute])


# --- campagne de publicité : coût, gain décroissant, cooldown ----------------------

func _test_publicite(data: Dictionary) -> void:
	var pub: Dictionary = data["constants"]["publicite"]
	var state: Dictionary = Sim.nouvelle_partie(31, data)
	var rep_avant: float = float(state["rep"]["civile"])
	var treso_avant: float = float(state["tresorerie"])
	var gain_attendu: float = Sim.publicite_gain(state, data)
	if not Sim.appliquer(state, data, {"type": "campagne_publicite"}):
		echecs.append("publicité : première campagne refusée")
		return
	if absf((float(state["tresorerie"]) - treso_avant) + float(pub["cout"])) > 0.5:
		echecs.append("publicité : coût mal débité")
	if absf((float(state["rep"]["civile"]) - rep_avant) - gain_attendu) > 1e-9:
		echecs.append("publicité : gain de réputation ≠ formule annoncée")
	# Cooldown : refus immédiat d'une deuxième campagne.
	if Sim.appliquer(state, data, {"type": "campagne_publicite"}):
		echecs.append("publicité : deuxième campagne acceptée pendant le cooldown")
	# Rendements décroissants : plus la réputation est haute, plus le gain fond.
	state["rep"]["civile"] = 0.44
	var gain_haut: float = Sim.publicite_gain(state, data)
	if not gain_haut < gain_attendu:
		echecs.append("publicité : pas de rendements décroissants")
	if not float(state["rep"]["civile"]) + gain_haut <= float(pub["plafond"]) + 1e-9:
		echecs.append("publicité : le gain dépasse le plafond")
	print("publicité | +%.1f pts à rép %.0f%% → +%.2f pts à rép 44%% (cooldown OK)"
		% [gain_attendu * 100.0, rep_avant * 100.0, gain_haut * 100.0])


# --- essais en vol : prototyper → défauts → corriger → mise en service --------------

func _test_essais(data: Dictionary) -> void:
	var Essais: GDScript = load("res://sim/essais.gd")
	var state: Dictionary = Sim.nouvelle_partie(29, data)
	state["tresorerie"] = 2000000.0
	Sim.appliquer(state, data, {"type": "nouveau_design", "design": {
		"nom": "Essai I", "annee": 1925.0, "formule": "biplan", "structure": "bois",
		"moteur": "lorraine_12eb", "surface": 26.0, "carburant_kg": 500.0,
		"charge_utile_kg": 250.0, "armement": 0, "features": []}})
	var uid_d: String = str(Etat.cles_triees(state["designs"])[0])
	var treso_avant: float = float(state["tresorerie"])
	if not Sim.appliquer(state, data, {"type": "prototyper", "design": uid_d}):
		echecs.append("essais : prototyper refusé")
		return
	if not float(state["tresorerie"]) < treso_avant:
		echecs.append("essais : le prototype n'a rien coûté")
	# La mise en service est verrouillée tant que la campagne vole.
	if Sim.appliquer(state, data, {"type": "mettre_en_service", "design": uid_d,
			"segment": "ligne_postale", "prix": 250000.0}):
		echecs.append("essais : mise en service acceptée en plein vol")
	var garde: int = 0
	while not Essais.prete(state, uid_d) and garde < 40:
		Sim.tick(state, data)
		garde += 1
	# Corrections : chaque défaut se répare (temps + argent), puis bon pour le service.
	var n_defauts: int = ((state["essais"][uid_d]["defauts"]) as Array).size()
	for d: Dictionary in (state["essais"][uid_d]["defauts"] as Array).duplicate():
		Sim.appliquer(state, data, {"type": "corriger_defaut", "design": uid_d, "defaut": str(d["id"])})
		var garde2: int = 0
		while not Essais.prete(state, uid_d) and garde2 < 20:
			Sim.tick(state, data)
			garde2 += 1
	var papier: float = float(state["designs"][uid_d]["specs"]["fiabilite"])
	if not Sim.appliquer(state, data, {"type": "mettre_en_service", "design": uid_d,
			"segment": "ligne_postale", "prix": 250000.0}):
		echecs.append("essais : mise en service refusée après la campagne")
		return
	var uid_p: String = str(Etat.cles_triees(state["catalogue"])[0])
	# Tout corrigé → les specs de service valent le papier ; l'essai est refermé.
	if absf(float(state["catalogue"][uid_p]["specs"]["fiabilite"]) - papier) > 1e-9:
		echecs.append("essais : specs de service ≠ papier alors que tout est corrigé")
	if (state["essais"] as Dictionary).has(uid_d):
		echecs.append("essais : la campagne ne se referme pas à la mise en service")
	print("essais | proto payé, %d défaut(s) corrigé(s), mise en service au papier" % n_defauts)


# --- conseil, motoriste, génie, sous-licence (les 4 ajouts de gameplay) --------------

func _test_conseil_motoriste_genie_licence(data: Dictionary) -> void:
	var Conseil: GDScript = load("res://sim/conseil.gd")
	# CONSEIL : mandat tenu → bonus versé ; mandat manqué → dividende + réputation.
	# La progression se compte PENDANT le mandat : on ouvre d'abord (base relevée), on livre
	# ensuite, puis on laisse tomber l'échéance. Poser les livraisons avant l'annonce ne
	# compterait pas — c'était le bug du playtest n°7 (mandat déjà rempli à son ouverture).
	var s: Dictionary = Sim.nouvelle_partie(41, data)
	s["tick"] = float(int((1935.05 - Etat.AN0) * 52.0))
	Conseil.tick_hebdo(s, data)  # annonce du mandat m1935 : base = livraisons du moment
	s["stats"]["livraisons"] = 400.0
	s["tick"] = float(int((1938.05 - Etat.AN0) * 52.0))
	var treso_avant: float = float(s["tresorerie"])
	Conseil.tick_hebdo(s, data)
	if not bool((s["conseil"]["resolus"] as Dictionary).get("m1935", false)):
		echecs.append("conseil : mandat tenu non résolu")
	if not float(s["tresorerie"]) > treso_avant:
		echecs.append("conseil : bonus du mandat tenu non versé")
	var s2: Dictionary = Sim.nouvelle_partie(43, data)
	s2["tick"] = float(int((1935.05 - Etat.AN0) * 52.0))
	Conseil.tick_hebdo(s2, data)
	s2["stats"]["livraisons"] = 10.0
	s2["tick"] = float(int((1938.05 - Etat.AN0) * 52.0))
	var rep_avant: float = float(s2["rep"]["civile"])
	Conseil.tick_hebdo(s2, data)
	if bool((s2["conseil"]["resolus"] as Dictionary).get("m1935", true)):
		echecs.append("conseil : mandat manqué compté comme tenu")
	if not float(s2["rep"]["civile"]) < rep_avant:
		echecs.append("conseil : pas de malus de réputation au mandat manqué")
	# Cible ADAPTATIVE : une maison qui a déjà 1000 livraisons se voit demander bien plus
	# que le socle de 120 inscrit en data (sinon le mandat est acquis d'avance).
	var s_gros: Dictionary = Sim.nouvelle_partie(47, data)
	s_gros["tick"] = float(int((1935.05 - Etat.AN0) * 52.0))
	s_gros["stats"]["livraisons"] = 1000.0
	Conseil.tick_hebdo(s_gros, data)
	var mandat_gros: Dictionary = Conseil.actif(s_gros, data)
	if mandat_gros.is_empty() or Conseil.cible(s_gros, data, mandat_gros) <= float(mandat_gros["cible"]):
		echecs.append("conseil : la cible ne s'adapte pas à la taille de la maison")
	if Conseil.progression(s_gros, mandat_gros) > 0.0:
		echecs.append("conseil : la progression compte les livraisons d'AVANT le mandat")
	# MOTORISTE : signer Rolls-Royce → remise sur leurs moteurs, Bristol interdit.
	var s3: Dictionary = Sim.nouvelle_partie(45, data)
	s3["tresorerie"] = 3000000.0
	if not Sim.appliquer(s3, data, {"type": "signer_motoriste", "marque": "Rolls-Royce"}):
		echecs.append("motoriste : signature refusée")
	if Sim.appliquer(s3, data, {"type": "signer_motoriste", "marque": "Bristol"}):
		echecs.append("motoriste : double signature acceptée")
	var d_rr: Dictionary = {"nom": "RR", "annee": 1925.0, "formule": "biplan", "structure": "bois",
		"moteur": "rr_eagle", "surface": 30.0, "carburant_kg": 500.0, "charge_utile_kg": 200.0,
		"armement": 0, "features": []}
	var uid_rr: String = "d%d" % int(s3["prochain_id"])
	Sim.appliquer(s3, data, {"type": "nouveau_design", "design": d_rr})
	var attendu: float = float(data["engines"]["rr_eagle"]["cout"]) \
		* (1.0 - float(data["constants"]["motoriste"]["remise_cout"]))
	var s_libre: Dictionary = Sim.nouvelle_partie(45, data)
	var uid_libre: String = "d%d" % int(s_libre["prochain_id"])
	Sim.appliquer(s_libre, data, {"type": "nouveau_design", "design": d_rr})
	var ecart: float = float(s_libre["designs"][uid_libre]["specs"]["cout_unitaire"]) \
		- float(s3["designs"][uid_rr]["specs"]["cout_unitaire"])
	if absf(ecart - attendu) > 1.0:
		echecs.append("motoriste : remise moteur incorrecte (%.0f au lieu de %.0f)" % [ecart, attendu])
	var d_bristol: Dictionary = d_rr.duplicate(true)
	d_bristol["moteur"] = "gr_jupiter"
	d_bristol["annee"] = 1927.0
	if Sim.appliquer(s3, data, {"type": "nouveau_design", "design": d_bristol}):
		echecs.append("motoriste : moteur Bristol accepté malgré l'exclusivité Rolls-Royce")
	# GÉNIE : dans sa fenêtre, Mitchell est en tête du vivier et son trait vaut +2.
	var s4: Dictionary = Sim.nouvelle_partie(47, data)
	s4["tick"] = float(int(1930.0 - Etat.AN0) * 52)
	var Ingenieurs: GDScript = load("res://sim/engineers.gd")
	Ingenieurs.regenerer_candidats(s4, data)
	if str((s4["recrutement"]["candidats"] as Array)[0]["nom"]) != "R. J. Mitchell":
		echecs.append("génie : Mitchell absent du vivier dans sa fenêtre")
	elif not Sim.appliquer(s4, data, {"type": "recruter", "indice": 0}):
		echecs.append("génie : recrutement refusé")
	else:
		var idx: int = (s4["ingenieurs"] as Array).size() - 1
		Sim.appliquer(s4, data, {"type": "affecter", "indice": idx, "poste": "etudes"})
		# points = Σ (comp + bonus trait) × moral ; le Visionnaire seul pèse (6+2)×0.8.
		var pts: float = Ingenieurs.points(s4, data, "etudes")
		if pts < (6.0 + 2.0) * 0.8 - 0.01:
			echecs.append("génie : le trait Visionnaire ne vaut pas +2 (points %.1f)" % pts)
	# SOUS-LICENCE : accepter en fenêtre → série d'État sans réputation.
	var s5: Dictionary = Sim.nouvelle_partie(49, data)
	s5["tick"] = float(int((1940.5 - Etat.AN0) * 52.0))
	if not Sim.appliquer(s5, data, {"type": "accepter_sous_licence", "id": "sl_1940"}):
		echecs.append("sous-licence : acceptation refusée en fenêtre")
	if Sim.appliquer(s5, data, {"type": "accepter_sous_licence", "id": "sl_1940"}):
		echecs.append("sous-licence : double acceptation")
	if (s5["ao"]["contrats"] as Array).size() != 1:
		echecs.append("sous-licence : pas de série d'État créée")
	else:
		var rep_mil: float = float(s5["rep"]["militaire"])
		var treso5: float = float(s5["tresorerie"])
		var Contrats2: GDScript = load("res://sim/contracts.gd")
		var cap: Dictionary = {"joueur": 6.0}
		Contrats2.livrer_trimestre(s5, data, cap)
		if absf(float(s5["tresorerie"]) - treso5 - 6.0 * 52000.0) > 0.01:
			echecs.append("sous-licence : la série ne paie pas au tarif")
		if absf(float(s5["rep"]["militaire"]) - rep_mil) > 1e-9:
			echecs.append("sous-licence : la réputation a bougé (elle ne doit pas)")
	print("conseil/motoriste/génie/sous-licence | mandat ±, remise %.0f £, Mitchell +2, série sans gloire OK" % attendu)


# --- hangar/stock, contrats d'entretien, emprunt bancaire, filiale coloniale ---------

func _test_stock_entretien_banque_filiale(data: Dictionary) -> void:
	var Marche2: GDScript = load("res://sim/market.gd")
	# STOCK : commande d'atelier → hangar payé à la construction → livré en premier.
	var s: Dictionary = Sim.nouvelle_partie(61, data)
	s["tresorerie"] = 3000000.0
	var design: Dictionary = {"nom": "Stock", "annee": 1925.0, "formule": "biplan", "structure": "bois",
		"moteur": "rr_eagle", "surface": 30.0, "carburant_kg": 600.0, "charge_utile_kg": 250.0,
		"armement": 0, "features": []}
	var uid_d: String = "d%d" % int(s["prochain_id"])
	Sim.appliquer(s, data, {"type": "nouveau_design", "design": design})
	Sim.appliquer(s, data, {"type": "lancer_produit", "design": uid_d, "segment": "ligne_postale", "prix": 200000.0})
	var uid_p: String = str(Etat.cles_triees(s["catalogue"])[0])
	if not Sim.appliquer(s, data, {"type": "produire_stock", "produit": uid_p, "nombre": 5.0}):
		echecs.append("stock : commande refusée")
	var treso_avant: float = float(s["tresorerie"])
	# Un trimestre : l'atelier construit le stock (capacité palier 1 = 6).
	for i: int in range(13):
		Sim.tick(s, data)
	if int((s["stock"] as Dictionary).get(uid_p, 0.0)) < 1:
		echecs.append("stock : rien produit au hangar après un trimestre")
	if not float(s["tresorerie"]) < treso_avant:
		echecs.append("stock : le hangar n'a rien coûté")
	# ENTRETIEN : revenu positif quand une flotte fiable est en service.
	var s2: Dictionary = Sim.nouvelle_partie(63, data)
	s2["entretien_flotte"] = true
	s2["catalogue"]["p1"] = {"design_uid": "d0", "segment": "ligne_postale", "annee": 1925.0,
		"prix": 100000.0, "specs": {"fiabilite": 0.85, "cout_unitaire": 50000.0}, "carnet": 0.0, "pic_part": 0.0}
	s2["marche"]["ligne_postale"] = {"parts": {}, "historique": [{"annee": 1925.0, "ventes": {"p1": 10.0}}]}
	var treso2: float = float(s2["tresorerie"])
	Marche2._entretien_flotte(s2, data)
	var attendu_ent: float = 10.0 * float(data["constants"]["entretien_flotte"]["fee_trim_par_appareil"]) * 0.85
	if absf(float(s2["tresorerie"]) - treso2 - attendu_ent) > 1.0:
		echecs.append("entretien : revenu incorrect (%.0f attendu)" % attendu_ent)
	# Accident sous contrat → double malus de réputation.
	var Accidents: GDScript = load("res://sim/accidents.gd")
	var s2b: Dictionary = Sim.nouvelle_partie(64, data)
	s2b["catalogue"]["p1"] = {"design_uid": "d0", "segment": "ligne_postale", "annee": 1925.0,
		"prix": 100000.0, "specs": {"fiabilite": 0.30, "cout_unitaire": 50000.0}, "carnet": 200.0, "pic_part": 0.0}
	s2b["marche"]["ligne_postale"] = {"parts": {}, "historique": [{"annee": 1925.0, "ventes": {"p1": 40.0}}]}
	var rep_simple: float = _accident_rep(s2b.duplicate(true), data, Accidents, false)
	var rep_double: float = _accident_rep(s2b.duplicate(true), data, Accidents, true)
	if not rep_double > rep_simple + 1e-6:
		echecs.append("entretien : l'accident sous contrat ne double pas le malus rep")
	# BANQUE : emprunt borné par le plafond, intérêts hebdo, rappel de prêt.
	var s3: Dictionary = Sim.nouvelle_partie(65, data)
	var plafond: float = Sim.plafond_banque(s3, data)
	if Sim.appliquer(s3, data, {"type": "emprunter", "montant": plafond + 100000.0}):
		echecs.append("banque : emprunt au-dessus du plafond accepté")
	if not Sim.appliquer(s3, data, {"type": "emprunter", "montant": 100000.0}):
		echecs.append("banque : emprunt refusé sous le plafond")
	if absf(float(s3["emprunt"]) - 100000.0) > 0.01:
		echecs.append("banque : dette non enregistrée")
	var Economie: GDScript = load("res://sim/economy.gd")
	var treso3: float = float(s3["tresorerie"])
	Economie.tick_hebdo(s3, data)
	var interet: float = 100000.0 * float(data["constants"]["banque"]["taux_hebdo"])
	if not float(s3["tresorerie"]) < treso3 - interet + 0.01:
		echecs.append("banque : intérêts hebdo non prélevés")
	s3["evenements"]["en_attente"] = "1931_rappel_pret"
	Sim.appliquer(s3, data, {"type": "choisir_evenement", "id": "1931_rappel_pret", "choix": "b"})
	if float(s3["emprunt"]) != 0.0:
		echecs.append("banque : le rappel de prêt n'efface pas la dette")
	# FILIALE : 5e emplacement + commandes captives.
	var s4: Dictionary = Sim.nouvelle_partie(67, data)
	s4["tresorerie"] = 2000000.0
	if not Sim.appliquer(s4, data, {"type": "fonder_filiale"}):
		echecs.append("filiale : fondation refusée avec le cash")
	if Sim.max_produits(s4, data) != int(data["constants"]["eco"]["max_produits"]) + 1:
		echecs.append("filiale : pas de 5e emplacement")
	s4["catalogue"]["p1"] = {"design_uid": "d0", "segment": "ligne_postale", "annee": 1930.0,
		"prix": 100000.0, "specs": {"fiabilite": 0.8, "cout_unitaire": 50000.0}, "carnet": 0.0, "pic_part": 0.0}
	Marche2._filiale_commandes(s4, data)
	if float(s4["catalogue"]["p1"]["carnet"]) < float(data["constants"]["filiale"]["commandes_trim"]):
		echecs.append("filiale : pas de commande captive")
	# HANGAR à trésorerie courte : on construit CE QU'ON PEUT PAYER, pas tout ou rien —
	# sinon la commande reste « en atelier » à vie sans un mot (playtest n°7).
	var s5: Dictionary = Sim.nouvelle_partie(71, data)
	s5["catalogue"]["p1"] = {"design_uid": "d0", "segment": "ligne_postale", "annee": 1930.0,
		"prix": 100000.0, "specs": {"fiabilite": 0.8, "cout_unitaire": 50000.0}, "carnet": 0.0, "pic_part": 0.0}
	s5["stock_commande"] = {"p1": 5.0}
	s5["tresorerie"] = 120000.0  # de quoi en payer 2 sur les 5 commandés
	var cap5: Dictionary = {"joueur": 6.0}
	Marche2._produire_stock(s5, data, cap5)
	if int(float((s5["stock"] as Dictionary).get("p1", 0.0))) != 2:
		echecs.append("hangar : %d construits au lieu des 2 payables"
			% int(float((s5["stock"] as Dictionary).get("p1", 0.0))))
	if int(float((s5["stock_commande"] as Dictionary).get("p1", 0.0))) != 3:
		echecs.append("hangar : la commande restante n'est pas décomptée")
	print("stock/entretien/banque/filiale | hangar produit, entretien %.0f £, emprunt borné + rappel, 5e slot OK" % attendu_ent)


func _accident_rep(s: Dictionary, data: Dictionary, Accidents: GDScript, contrat: bool) -> float:
	s["entretien_flotte"] = contrat
	s["rep"]["civile"] = 0.5  # marge pour que le double malus ne soit pas absorbé par le clamp à 0
	var rep_avant: float = float(s["rep"]["civile"])
	for i: int in range(200):
		s["presse"] = []
		Accidents.trimestre(s, data)
		# Le carnet fond à chaque accident : on le maintient pour garantir un tirage.
		s["catalogue"]["p1"]["carnet"] = 200.0
		if (s["presse"] as Array).size() > 0:
			break
	return rep_avant - float(s["rep"]["civile"])


# --- variante Mk II, assurance, grève interne, bradage colonial ----------------------

func _test_variante_assurance_greve_bradage(data: Dictionary) -> void:
	var c_avion: Dictionary = data["constants"]["avion"]
	# VARIANTE : même cellule → proto/études au rabais ; cellule différente → refus.
	var s: Dictionary = Sim.nouvelle_partie(51, data)
	s["tresorerie"] = 3000000.0
	var parent: Dictionary = {"nom": "Base", "annee": 1925.0, "formule": "biplan", "structure": "bois",
		"moteur": "rr_eagle", "surface": 30.0, "carburant_kg": 500.0, "charge_utile_kg": 200.0,
		"armement": 0, "features": []}
	var uid_parent: String = "d%d" % int(s["prochain_id"])
	Sim.appliquer(s, data, {"type": "nouveau_design", "design": parent})
	var mk2: Dictionary = parent.duplicate(true)
	mk2["nom"] = "Base Mk II"
	mk2["carburant_kg"] = 700.0
	mk2["variante_de"] = uid_parent
	var uid_mk2: String = "d%d" % int(s["prochain_id"])
	if not Sim.appliquer(s, data, {"type": "nouveau_design", "design": mk2}):
		echecs.append("variante : refusée avec la même cellule")
		return
	var proto_parent: float = float(s["designs"][uid_parent]["specs"]["cout_proto"])
	var proto_mk2: float = float(s["designs"][uid_mk2]["specs"]["cout_proto"])
	if not proto_mk2 < proto_parent * (float(c_avion["variante_proto_mult"]) + 0.15):
		echecs.append("variante : le prototype n'est pas au rabais (%.0f vs %.0f)" % [proto_mk2, proto_parent])
	# Formule différente → refus (c'est un autre avion).
	var autre_formule: Dictionary = parent.duplicate(true)
	autre_formule["formule"] = "monoplan"
	autre_formule["variante_de"] = uid_parent
	if Sim.appliquer(s, data, {"type": "nouveau_design", "design": autre_formule}):
		echecs.append("variante : formule différente acceptée")
	# Structure/surface différentes → ACCEPTÉES, mais rabais DÉGRESSIF : le multiplicateur
	# proto tamponné remonte au-dessus du plancher (variante_proto_mult) sans dépasser 1.0.
	var modifiee: Dictionary = parent.duplicate(true)
	modifiee["surface"] = 36.0
	modifiee["variante_de"] = uid_parent
	var uid_modif: String = "d%d" % int(s["prochain_id"])
	if not Sim.appliquer(s, data, {"type": "nouveau_design", "design": modifiee}):
		echecs.append("variante : structure/surface différente refusée (dégressif attendu)")
	else:
		var mult_id: float = float(s["designs"][uid_mk2]["design"]["variante_proto_mult"])
		var mult_mod: float = float(s["designs"][uid_modif]["design"]["variante_proto_mult"])
		if not is_equal_approx(mult_id, float(c_avion["variante_proto_mult"])):
			echecs.append("variante : cellule identique devrait garder le rabais plein (%.2f)" % mult_id)
		if not (mult_mod > mult_id + 0.01 and mult_mod <= 1.0):
			echecs.append("variante : rabais NON dégressif (identique %.2f, modifiée %.2f)" % [mult_id, mult_mod])
	# ASSURANCE : prime débitée chaque semaine, dégâts d'accident amortis.
	var s2: Dictionary = Sim.nouvelle_partie(53, data)
	s2["catalogue"]["p1"] = {"design_uid": "d0", "segment": "ligne_postale", "annee": 1925.0,
		"prix": 100000.0, "specs": {"fiabilite": 0.40, "cout_unitaire": 50000.0},
		"carnet": 10.0, "pic_part": 0.0}
	s2["assurance"] = true
	var Economie: GDScript = load("res://sim/economy.gd")
	var treso_avant: float = float(s2["tresorerie"])
	Economie.tick_hebdo(s2, data)
	var drain: float = treso_avant - float(s2["tresorerie"])
	s2["assurance"] = false
	treso_avant = float(s2["tresorerie"])
	Economie.tick_hebdo(s2, data)
	var prime: float = drain - (treso_avant - float(s2["tresorerie"]))
	if absf(prime - float(data["constants"]["accidents"]["assurance_prime_sem_par_produit"])) > 0.01:
		echecs.append("assurance : prime incorrecte (%.0f)" % prime)
	s2["assurance"] = true
	s2["marche"]["ligne_postale"] = {"parts": {}, "historique": [{"annee": 1925.0, "ventes": {"p1": 8.0}}]}
	var Accidents: GDScript = load("res://sim/accidents.gd")
	var survenu2: bool = false
	for i: int in range(60):
		s2["presse"] = []
		Accidents.trimestre(s2, data)
		if (s2["presse"] as Array).size() > 0:
			survenu2 = true
			break
	if survenu2 and float(s2["catalogue"]["p1"]["carnet"]) < 7.0:
		echecs.append("assurance : le carnet n'est pas amorti (%.0f)" % float(s2["catalogue"]["p1"]["carnet"]))
	# GRÈVE : moral au fond 8 semaines → production gelée + une de presse.
	var s3: Dictionary = Sim.nouvelle_partie(55, data)
	var Ingenieurs: GDScript = load("res://sim/engineers.gd")
	for ing: Dictionary in s3["ingenieurs"]:
		ing["moral"] = 0.3
	var greve: bool = false
	for i: int in range(int(data["constants"]["equipe"]["greve_sem_seuil"]) + 1):
		s3["tick"] = float(s3["tick"]) + 1.0
		s3["presse"] = []
		Ingenieurs.tick_hebdo(s3, data)
		for ing: Dictionary in s3["ingenieurs"]:
			ing["moral"] = 0.3
		if float(s3["gels"]["production"]) > 0.0:
			greve = true
			break
	if not greve:
		echecs.append("grève : jamais déclenchée malgré 8 semaines de moral au fond")
	# BRADAGE : le HANGAR (déjà construit) part au prix d'occasion, le CARNET (jamais construit)
	# ne rapporte que la moitié de la MARGE — pas son prix de vente. Réputation écornée.
	var s4: Dictionary = Sim.nouvelle_partie(57, data)
	s4["catalogue"]["p1"] = {"design_uid": "d0", "segment": "ligne_postale", "annee": 1925.0,
		"prix": 100000.0, "specs": {"fiabilite": 0.80, "cout_unitaire": 50000.0},
		"carnet": 10.0, "pic_part": 0.0}
	s4["stock"] = {"p1": 4.0}
	var mult4: float = float(data["constants"]["occasion"]["mult"])
	var attendu4: float = 4.0 * 100000.0 * mult4 + 10.0 * (100000.0 - 50000.0) * mult4
	var rep4: float = float(s4["rep"]["civile"])
	var treso4: float = float(s4["tresorerie"])
	if not Sim.appliquer(s4, data, {"type": "brader_flotte", "produit": "p1"}):
		echecs.append("bradage : refusé")
	elif absf(float(s4["tresorerie"]) - treso4 - attendu4) > 0.01:
		echecs.append("bradage : recette incorrecte (%.0f, attendu %.0f — le carnet non produit ne doit PAS être payé plein prix)"
			% [float(s4["tresorerie"]) - treso4, attendu4])
	elif (s4["catalogue"] as Dictionary).has("p1"):
		echecs.append("bradage : le produit reste au catalogue")
	elif not float(s4["rep"]["civile"]) < rep4:
		echecs.append("bradage : la réputation ne bouge pas")
	print("variante/assurance/grève/bradage | proto %.0f→%.0f £, prime %.0f £, gel %d sem, solde OK"
		% [proto_parent, proto_mk2, prime, int(data["constants"]["equipe"]["greve_duree_sem"])])


# --- accidents en service : un avion peu fiable finit par tomber, un avion sain jamais ---

func _test_accidents(data: Dictionary) -> void:
	var Accidents: GDScript = load("res://sim/accidents.gd")
	var state: Dictionary = Sim.nouvelle_partie(37, data)
	# Fixture : produit pourri (fiab 0.30) qui livre en gros volume — accident quasi certain.
	state["catalogue"]["p1"] = {"design_uid": "d0", "segment": "ligne_postale", "annee": 1925.0,
		"prix": 100000.0, "specs": {"fiabilite": 0.30, "cout_unitaire": 50000.0},
		"carnet": 100.0, "pic_part": 0.0}
	state["marche"]["ligne_postale"] = {"parts": {},
		"historique": [{"annee": 1925.0, "ventes": {"p1": 40.0}}]}
	var rep_avant: float = float(state["rep"]["civile"])
	var trimestres: int = 0
	var survenu: bool = false
	for i: int in range(40):
		state["presse"] = []
		Accidents.trimestre(state, data)
		trimestres = i + 1
		if (state["presse"] as Array).size() > 0:
			survenu = true
			break
	if not survenu:
		echecs.append("accidents : aucun accident en 40 trimestres à fiab 0.40")
		return
	if not float(state["rep"]["civile"]) < rep_avant:
		echecs.append("accidents : la réputation ne tombe pas")
	if float(state["catalogue"]["p1"]["carnet"]) >= 100.0:
		echecs.append("accidents : le carnet ne fond pas")
	# Flotte SAINE (fiab au-dessus du pivot) : aucun tirage — le flux RNG reste intact.
	state["catalogue"]["p1"]["specs"]["fiabilite"] = 0.90
	var rng_avant: float = float(state["rng"])
	Accidents.trimestre(state, data)
	if float(state["rng"]) != rng_avant:
		echecs.append("accidents : tirage RNG malgré une flotte saine")
	print("accidents | fiab 40%% : accident au trimestre %d (rep et carnet frappés) ; fiab 90%% : zéro tirage" % trimestres)


# --- rivaux réactifs (étape ⑤) : rabot de prix borné, capacité qui suit le carnet ---

# Anti-snowball : sans plancher, un rival décroché ne finance plus sa R&D avec son CA et ne
# remonte JAMAIS (spirale de la mort vue en playtest 1937). Les technos sont toutes données au
# rival pour qu'il n'ACHÈTE rien : on mesure l'apport pur, pas le solde après dépense.
func _test_rd_plancher_sursaut(data: Dictionary) -> void:
	var regles: Dictionary = data["rivals"]["regles"]
	var plancher: float = float(regles["rd_plancher_trim"])
	var mult: float = float(regles["sursaut_mult"])
	var toutes: Array = []
	for id_t: String in Etat.cles_triees(data["technos"]):
		toutes.append(id_t)
	# Rival à ZÉRO vente, joueur discret : le PLANCHER le garde en recherche.
	var s1: Dictionary = Sim.nouvelle_partie(23, data)
	var r1: Dictionary = s1["rivaux"]["blochard"]
	r1["technos"] = toutes.duplicate()
	r1["ca_trim"] = 0.0
	r1["rd_pool"] = 0.0
	s1["marche"] = {"export_militaire": {"parts": {"p1": 0.2, "b1": 0.8}, "historique": []}}
	Marche._rivaux_rd(s1, data, 1930.0)
	if absf(float(r1["rd_pool"]) - plancher) > 1.0:
		echecs.append("R&D rivale : plancher absent à zéro vente (%.0f, attendu %.0f)"
			% [float(r1["rd_pool"]), plancher])
	# Même rival ruiné, mais le JOUEUR rafle le marché : sursaut de l'Air Ministry.
	var s2: Dictionary = Sim.nouvelle_partie(23, data)
	var r2: Dictionary = s2["rivaux"]["blochard"]
	r2["technos"] = toutes.duplicate()
	r2["ca_trim"] = 0.0
	r2["rd_pool"] = 0.0
	s2["marche"] = {"export_militaire": {"parts": {"p1": 0.9, "b1": 0.1}, "historique": []}}
	Marche._rivaux_rd(s2, data, 1930.0)
	if absf(float(r2["rd_pool"]) - plancher * mult) > 1.0:
		echecs.append("R&D rivale : sursaut absent alors que le joueur domine (%.0f, attendu %.0f)"
			% [float(r2["rd_pool"]), plancher * mult])
	print("R&D rivale | plancher %.0f £/trim à zéro vente ; sursaut ×%.1f si le joueur domine → %.0f"
		% [plancher, mult, float(r2["rd_pool"])])


func _test_rivaux_reactifs(data: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(19, data)
	var riv: Dictionary = state["rivaux"]["blochard"]
	var uid_r: String = ""
	for uid: String in Etat.cles_triees(riv["catalogue"]):
		if str(riv["catalogue"][uid]["segment"]) == "transport_civil":
			uid_r = uid
	if uid_r == "":
		echecs.append("rivaux réactifs : pas de produit transport chez Bristow")
		return
	# Fixture : le joueur écrase le segment, le carnet du rival déborde.
	var p: Dictionary = riv["catalogue"][uid_r]
	var prix_avant: float = float(p["prix"])
	p["carnet"] = 40.0
	state["marche"]["transport_civil"] = {"parts": {"p1": 0.8, uid_r: 0.1}, "historique": []}
	Marche._rivaux_reagir(state, data)
	if not float(p["prix"]) < prix_avant:
		echecs.append("rivaux réactifs : pas de rabot de prix quand le joueur domine")
	if not float(riv["capacite"]) > float(data["rivals"]["maisons"]["blochard"]["capacite_trim"]):
		echecs.append("rivaux réactifs : la capacité ne suit pas le carnet")
	# Le rabot répété bute sur le plancher de marge, jamais en dessous.
	for i: int in range(60):
		Marche._rivaux_reagir(state, data)
	var plancher: float = float(p["specs"]["cout_unitaire"]) \
		* (1.0 + float(data["rivals"]["regles"]["marge_min"]))
	if float(p["prix"]) < plancher - 0.01:
		echecs.append("rivaux réactifs : prix sous le plancher de marge")
	print("rivaux réactifs | prix %.0f → %.0f (plancher %.0f) ; capacité %d → %d (carnet plein)"
		% [prix_avant, float(p["prix"]), plancher,
		int(data["rivals"]["maisons"]["blochard"]["capacite_trim"]), int(riv["capacite"])])


func _test_clamp_prix(data: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(19, data)
	var seg: Dictionary = data["segments"]["transport_civil"]
	var liste: Array = Marche.produits_du_segment(state, "transport_civil")
	if liste.is_empty():
		echecs.append("clamp prix : aucun produit au transport")
		return
	var e: Dictionary = liste[0]
	var prix: float = float(e["produit"]["prix"])
	var plafond: float = float(data["constants"]["marche"]["clamp_prix"])
	# Même produit, deux médianes : à ×1.2 le rabais joue encore (1.2^1.2 = 1.25 < plafond),
	# à ×20 il est buté. Garder la 1re en dessous du plafond, sinon le test ne distingue plus
	# « rabais partiel » de « rabais buté » et ne vérifie plus que le clamp.
	var a1: float = Marche._attractivite(state, data, seg, e, 1930.0, prix * 1.2, {})
	var a2: float = Marche._attractivite(state, data, seg, e, 1930.0, prix * 20.0, {})
	var a3: float = Marche._attractivite(state, data, seg, e, 1930.0, prix * 200.0, {})
	var a0: float = Marche._attractivite(state, data, seg, e, 1930.0, prix, {})
	# On teste la PROPRIÉTÉ du plafond, pas sa valeur : celle-ci dépend désormais de la qualité
	# de l'appareil (plafond conditionnel), donc l'écrire en dur dans le test rendrait le test
	# solidaire du réglage d'équilibrage au lieu de la règle.
	if not a1 > a0:
		echecs.append("clamp prix : un prix sous la médiane n'avantage plus")
	if absf(a3 - a2) > 0.001:
		echecs.append("clamp prix : aucun plafond, ×200 rapporte encore plus que ×20")
	if a2 / maxf(a0, 0.0001) > plafond + 0.01:
		echecs.append("clamp prix : le plafond absolu ×%.1f est dépassé (×%.2f)"
			% [plafond, a2 / maxf(a0, 0.0001)])
	print("clamp prix | médiane ×1 → %.3f · ×1.2 → %.3f · ×20 → %.3f = ×200 (plafond abs. ×%.1f)"
		% [a0, a1, a2, plafond])

	# Plafond PAR CRITÈRE : sur l'export le coût est plafonné à 1.0, donc descendre SOUS la
	# référence cesse de rapporter — c'est ce qui empêche un vieux chasseur bon marché de se
	# refaire sur le prix ce qu'il perd en vitesse. Les autres critères gardent clamp_qualite.
	var ref_cout: float = Marche.interp(
		(data["segments"]["export_militaire"]["criteres"] as Array)[3]["ref"], 1945.0)
	var specs: Dictionary = {"vmax_kmh": 500.0, "maniabilite": 50.0, "armement": 4.0,
		"cout_unitaire": ref_cout}
	var q_ref: float = Marche.qualite_segment(data, "export_militaire", specs, 1945.0, 0.5)
	specs["cout_unitaire"] = ref_cout * 0.5      # deux fois moins cher que la référence
	var q_bas: float = Marche.qualite_segment(data, "export_militaire", specs, 1945.0, 0.5)
	specs["cout_unitaire"] = ref_cout * 2.0      # deux fois plus cher : là ça doit coûter
	var q_haut: float = Marche.qualite_segment(data, "export_militaire", specs, 1945.0, 0.5)
	if absf(q_bas - q_ref) > 0.001:
		echecs.append("clamp critère : être moins cher que la réf rapporte encore (%.3f vs %.3f)"
			% [q_bas, q_ref])
	if not q_haut < q_ref - 0.01:
		echecs.append("clamp critère : le plafond a aussi supprimé le MALUS de cherté")
	print("clamp critère | coût ×0.5 → %.3f · réf → %.3f · ×2 → %.3f (plafond 1.0, malus intact)"
		% [q_bas, q_ref, q_haut])

	# Le coût est HORS pénalité rédhibitoire : un avion très cher garde une pénalité de 1.0
	# (il fait le travail), là où un critère de CONCEPTION effondré la fait mordre.
	specs["cout_unitaire"] = ref_cout * 8.0        # ratio 0.125, très loin sous le seuil
	var q_cher: float = Marche.qualite_segment(data, "export_militaire", specs, 1945.0, 0.5)
	var attendu_cher: float = q_haut - 0.23 * (0.5 - 0.125)   # perte du seul terme de coût
	if absf(q_cher - attendu_cher) > 0.01:
		echecs.append("hors_penalite : le coût fait encore mordre la pénalité (%.3f, attendu %.3f)"
			% [q_cher, attendu_cher])
	specs["cout_unitaire"] = ref_cout
	specs["armement"] = 0.5                        # 1/8 de la réf : LÀ ça doit mordre
	var q_nul: float = Marche.qualite_segment(data, "export_militaire", specs, 1945.0, 0.5)
	if not q_nul < q_ref * 0.8:
		echecs.append("hors_penalite : un critère de conception effondré ne mord plus")
	print("hors pénalité | coût ×8 → %.3f (pénalité 1.0) · armement ÷8 → %.3f (pénalité active)"
		% [q_cher, q_nul])

	# Plafond de prix CONDITIONNEL : à `clamp_prix_conformite` 1, un appareil médiocre ne peut
	# plus se refaire entièrement sur le prix ; à 0 le plafond redevient plat pour tous. On
	# passe par `_attractivite` (le vrai chemin) et non par l'arithmétique du plafond, sinon le
	# test ne vérifie plus que sa propre formule.
	var d2: Dictionary = data.duplicate(true)
	var pr2: Dictionary = e["produit"].duplicate(true)
	var e2: Dictionary = {"uid": "x", "maison": e["maison"], "produit": pr2}
	pr2["specs"] = (pr2["specs"] as Dictionary).duplicate()
	pr2["specs"]["fiabilite"] = 0.2                      # appareil franchement médiocre
	pr2["specs"]["cout_exploitation"] = 9000.0
	var med: float = prix * 20.0
	d2["constants"]["marche"]["clamp_prix_conformite"] = 0.0
	var plat: float = Marche._attractivite(state, d2, seg, e2, 1930.0, med, {})
	d2["constants"]["marche"]["clamp_prix_conformite"] = 1.0
	var cond: float = Marche._attractivite(state, d2, seg, e2, 1930.0, med, {})
	if not cond < plat - 0.001:
		echecs.append("plafond conditionnel : un appareil médiocre garde le plafond plein")
	print("plafond conditionnel | médiocre buté : plat %.3f → conditionnel %.3f" % [plat, cond])


# --- archétypes + options d'armement (étape ③ du pivot Angleterre) ---------------

func _test_archetypes(data: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(11, data)
	var Recherche: GDScript = load("res://sim/research.gd")
	# Combo incomplet : rien ne se débloque.
	state["recherche"]["faites"] = ["monocoque_metal", "helice_pas_variable"]
	Recherche.verifier_archetypes(state, data)
	if (state["archetypes"] as Array).size() != 0:
		echecs.append("archétypes : débloqué avec un combo incomplet")
	# Combo complet : archétype + une de presse, UNE seule fois même si revérifié.
	(state["recherche"]["faites"] as Array).append("train_rentrant")
	state["presse"] = []
	Recherche.verifier_archetypes(state, data)
	Recherche.verifier_archetypes(state, data)
	if not (state["archetypes"] as Array).has("chasseur_moderne"):
		echecs.append("archétypes : chasseur moderne non débloqué par son combo")
	if (state["presse"] as Array).size() != 1:
		echecs.append("archétypes : %d unes au lieu d'1" % (state["presse"] as Array).size())
	# Les nouvelles options pèsent dans les specs.
	var base: Dictionary = {"nom": "t", "annee": 1936.0, "formule": "monoplan", "structure": "bois",
		"moteur": "hs_12y", "surface": 30.0, "carburant_kg": 500.0, "charge_utile_kg": 600.0,
		"armement": 1, "features": []}
	var d_armes: Dictionary = Avion.delta_feature(base, data, "armes_ailes")
	if absf(float(d_armes["armement"]) - 2.0) > 0.01:
		echecs.append("options : armes en ailes ≠ +2 armement")
	var d_tourelle: Dictionary = Avion.delta_feature(base, data, "tourelle_defensive")
	if not (float(d_tourelle["armement"]) > 0.5 and float(d_tourelle["vmax_kmh"]) < 0.0):
		echecs.append("options : la tourelle devrait armer ET ralentir")
	var d_soute: Dictionary = Avion.delta_feature(base, data, "soute_bombes")
	if not float(d_soute["vmax_kmh"]) > 0.0:
		echecs.append("options : la soute ne carène pas l'emport (vmax)")
	print("archétypes | combo → préréglage + une ; armes ailes %+.0f armes, tourelle %+.0f km/h, soute %+.0f km/h"
		% [float(d_armes["armement"]), float(d_tourelle["vmax_kmh"]), float(d_soute["vmax_kmh"])])


func _test_evenements(data: Dictionary) -> void:
	var liste: Dictionary = data["events"]["liste"]
	for id_ev: String in Etat.cles_triees(liste):
		for choix: String in ["a", "b"]:
			if liste[id_ev][choix] == null:
				continue
			var state: Dictionary = _fixture_evenements(data)
			state["evenements"]["en_attente"] = id_ev
			if not Sim.appliquer(state, data, {"type": "choisir_evenement", "id": id_ev, "choix": choix}):
				echecs.append("événement %s/%s : choix refusé" % [id_ev, choix])
				continue
			for i: int in range(15):
				Sim.tick(state, data)  # Etat.valider crie si un effet a cassé le state
			if str(state["evenements"]["en_attente"]) == id_ev:
				echecs.append("événement %s : reste en attente après le choix" % id_ev)
	# Effets ponctuels vérifiés : Lindbergh module la demande, la mobilisation retire un ingénieur.
	var s2: Dictionary = _fixture_evenements(data)
	s2["evenements"]["en_attente"] = "1927_lindbergh"
	Sim.appliquer(s2, data, {"type": "choisir_evenement", "id": "1927_lindbergh", "choix": "a"})
	if (s2["modificateurs"] as Array).size() != 1:
		echecs.append("événement : Lindbergh ne pose pas de modificateur de demande")
	if (s2["presse"] as Array).size() != 1:
		echecs.append("événement : Lindbergh ne fait pas la une")
	var s3: Dictionary = _fixture_evenements(data)
	var effectif: int = (s3["ingenieurs"] as Array).size()
	s3["evenements"]["en_attente"] = "1939_mobilisation"
	Sim.appliquer(s3, data, {"type": "choisir_evenement", "id": "1939_mobilisation", "choix": "a"})
	if (s3["ingenieurs"] as Array).size() != effectif - 1:
		echecs.append("événement : la mobilisation ne retire pas d'ingénieur")
	# Une campagne bot complète SOLVABLE déclenche l'essentiel du calendrier (les événements
	# sont datés : encore faut-il que la campagne atteigne 1945 sans faire faillite avant).
	var s4: Dictionary = _campagne_solvable(3, data, 1250)
	var faits: int = (s4["evenements"]["faits"] as Array).size()
	var total_ev: int = (data["events"]["liste"] as Dictionary).size()
	print("événements | %d/%d résolus sur la campagne graine 3" % [faits, total_ev])
	if faits < 15:
		echecs.append("événements : seulement %d/20 résolus en campagne complète" % faits)


# --- 8. raids & courses : succès, échec, auto-résolution rivale -------------------

func _test_raids(data: Dictionary) -> void:
	# Succès : gros porteur d'autonomie sur l'Atlantique Sud (3 100 km), graine favorable.
	var state: Dictionary = _fixture_evenements(data)
	while Marche.annee_de(state) < 1928.1:
		Sim.tick(state, data)
	var d_gros: Dictionary = {
		"nom": "Trans", "annee": Marche.annee_de(state), "formule": "biplan", "structure": "bois",
		"moteur": Avion.meilleur_moteur(data, Marche.annee_de(state), "eco"),
		"surface": 60.0, "carburant_kg": 2600.0, "charge_utile_kg": 0.0, "armement": 0, "features": []}
	var uid_dd: String = "d%d" % int(state["prochain_id"])
	Sim.appliquer(state, data, {"type": "nouveau_design", "design": d_gros})
	Sim.appliquer(state, data, {"type": "lancer_produit", "design": uid_dd, "segment": "ligne_postale", "prix": 200000.0})
	# Sélection par NOM de design : le tri de chaînes des uids ment dès p10 ("p10" < "p8").
	var uid_raid: String = ""
	for uid: String in Etat.cles_triees(state["catalogue"]):
		if str(state["designs"][str(state["catalogue"][uid]["design_uid"])]["design"]["nom"]) == "Trans":
			uid_raid = uid
	if uid_raid == "":
		echecs.append("raids : le gros porteur n'est pas entré au catalogue")
		return
	var autonomie: float = float(state["catalogue"][uid_raid]["specs"]["autonomie_km"])
	if autonomie < 3100.0 * 0.8:
		echecs.append("raids : la fixture ne vole pas assez loin (%.0f km)" % autonomie)
	var avant: int = (state["palmares"] as Array).size()
	if not Sim.appliquer(state, data, {"type": "tenter_epreuve", "epreuve": "1928_atlantique_sud",
			"produit": uid_raid, "pilote": 0}):
		echecs.append("raids : tentative refusée pendant la fenêtre")
	if (state["palmares"] as Array).size() != avant + 1:
		echecs.append("raids : pas d'entrée au palmarès")
	if (state["presse"] as Array).size() == 0:
		echecs.append("raids : aucun dénouement en une de presse")
	print("raids | Atlantique Sud (autonomie %.0f/3100 km) : %s" % [autonomie,
		"succès" if bool(state["palmares"][avant]["succes"]) else "échec (avion perdu)"])
	# Échec certain : autonomie ridicule → p = 0. Le produit reste en vente malgré l'échec
	# (retour playtest n°4 : rayer le catalogue effaçait aussi le carnet déjà rempli).
	var s2: Dictionary = _fixture_evenements(data)
	var garde2: int = 0
	while Marche.annee_de(s2) < 1930.1 and garde2 < 600:
		Sim.tick(s2, data)
		garde2 += 1
	if (s2["pilotes"] as Array).size() == 0:
		Sim.appliquer(s2, data, {"type": "recruter_pilote", "nom": "Whitfield"})
	var uid_court: String = str(Etat.cles_triees(s2["catalogue"])[0])
	var nb_avant: int = (s2["catalogue"] as Dictionary).size()
	Sim.appliquer(s2, data, {"type": "tenter_epreuve", "epreuve": "1930_croisiere_noire",
		"produit": uid_court, "pilote": 0})
	if bool(s2["palmares"][(s2["palmares"] as Array).size() - 1]["succes"]):
		if float(s2["catalogue"][uid_court]["specs"]["autonomie_km"]) < 2400.0 * 0.8:
			echecs.append("raids : succès impossible avec une autonomie insuffisante")
	if (s2["catalogue"] as Dictionary).size() != nb_avant:
		echecs.append("raids : le produit a disparu du catalogue après un raid raté")
	# Courses non courues : résolues entre rivaux à la clôture.
	var s3: Dictionary = Sim.nouvelle_partie(23, data)
	s3["tresorerie"] = 5000000.0
	var garde3: int = 0
	while Marche.annee_de(s3) < 1933.6 and garde3 < 800:
		garde3 += 1
		if str(s3["evenements"]["en_attente"]) != "":
			Sim.appliquer(s3, data, {"type": "choisir_evenement", "id": str(s3["evenements"]["en_attente"]),
				"choix": str(data["events"]["liste"][str(s3["evenements"]["en_attente"])]["choix_bot"])})
		Sim.tick(s3, data)
	if not (s3["epreuves_faites"] as Array).has("1933_deutsch"):
		echecs.append("raids : la Coupe Deutsch 1933 ne se court pas sans le joueur")


# --- 9. fin 1940 : verdict, fragments formatés, faillite, mémorial garanti -------

func _test_fin(data: Dictionary) -> void:
	var Fin: GDScript = load("res://sim/end.gd")
	# Campagne complète SOLVABLE : on teste la logique de verdict (4 niveaux) et le formatage
	# des fragments, pas la survie — d'où la campagne garantie jusqu'en 1945.
	var state: Dictionary = _campagne_solvable(1, data, 1250)
	state["memorial"] = ["Tremayne"]  # fixture : la ligne du pilote disparu est GARANTIE
	var bilan: Dictionary = Fin.bilan(state, data)
	print("fin | verdict=%s note=%.2f fragments=%d" % [str(bilan["verdict"]), float(bilan["score"]),
		(bilan["fragments"] as Array).size()])
	if not ["oubliee", "sous_traitant", "pilier", "legende"].has(str(bilan["verdict"])):
		echecs.append("fin : verdict inconnu " + str(bilan["verdict"]))
	if (bilan["fragments"] as Array).size() < 6:
		echecs.append("fin : épilogue trop maigre (%d fragments)" % (bilan["fragments"] as Array).size())
	var memorial_vu: bool = false
	for f: Array in bilan["fragments"]:
		var texte: String = str(f[1])
		if texte.contains("%s") or texte.contains("%d"):
			echecs.append("fin : fragment non formaté : " + str(f[0]))
		if str(f[0]) == "memorial" and texte.contains("Tremayne"):
			memorial_vu = true
	if not memorial_vu:
		echecs.append("fin : la ligne du pilote disparu n'est pas garantie")
	# Faillite : verdict dédié.
	var s2: Dictionary = Sim.nouvelle_partie(9, data)
	s2["tresorerie"] = -1000.0
	for i: int in range(10):
		Sim.tick(s2, data)
	if str(s2["fin"]) != "faillite":
		echecs.append("fin : la faillite fixture n'aboutit pas")
	elif str(Fin.bilan(s2, data)["verdict"]) != "faillite":
		echecs.append("fin : verdict faillite manquant")


# --- 10. campagnes bot complètes : pas de NaN, une fin, des rivaux vivants ------

func _test_campagnes_bot(data: Dictionary) -> void:
	var renouvellements_max: float = 0.0
	for graine: int in [1, 7, 13]:
		var state: Dictionary = _campagne(graine, data, 1250)
		if str(state["fin"]) == "":
			echecs.append("campagne %d : pas de fin en mai 1945" % graine)
		var nb_total: float = 0.0
		for maison: String in Etat.cles_triees(state["rivaux"]):
			nb_total += float(state["rivaux"][maison]["nb_produits"])
		renouvellements_max = maxf(renouvellements_max, nb_total - 6.0)
		print("campagne %2d | fin=%-9s trésorerie=%9.0f F, livraisons=%3.0f, produits rivaux=%d"
			% [graine, str(state["fin"]), float(state["tresorerie"]),
			float(state["stats"]["livraisons"]), int(nb_total)])
	if renouvellements_max < 1.0:
		echecs.append("rivaux : aucun renouvellement de produit sur 15 ans")


# --- bot déterministe (fonction pure du state) ---------------------------------

func _campagne(graine: int, data: Dictionary, n_ticks: int) -> Dictionary:
	var state: Dictionary = Sim.nouvelle_partie(graine, data)
	for i: int in range(n_ticks):
		_bot(state, data)
		Sim.tick(state, data)
	return state


# Campagne GARANTIE solvable jusqu'en 1945 : la trésorerie est maintenue positive à chaque
# tick. Sert aux tests qui vérifient une LOGIQUE de fin de partie (verdict, calendrier des
# événements) et non la survie économique — sinon ils dépendent d'un seed naïf qui survit,
# fragilité qui casse au moindre rééquilibrage (les cibles de faillite vivent dans balance.gd).
func _campagne_solvable(graine: int, data: Dictionary, n_ticks: int) -> Dictionary:
	var state: Dictionary = Sim.nouvelle_partie(graine, data)
	for i: int in range(n_ticks):
		_bot(state, data)
		Sim.tick(state, data)
		if float(state["tresorerie"]) < 100000.0:
			state["tresorerie"] = 100000.0
	return state


func _bot(state: Dictionary, data: Dictionary) -> void:
	var tick: int = int(state["tick"])
	var annee: float = Marche.annee_de(state)
	var en_attente: String = str(state["evenements"]["en_attente"])
	if en_attente != "":
		Sim.appliquer(state, data, {"type": "choisir_evenement", "id": en_attente,
			"choix": str(data["events"]["liste"][en_attente]["choix_bot"])})
	state["presse"] = []
	if tick == 0:
		_bot_produit(state, data, "ligne_postale")
	if tick >= 60 and tick % 26 == 8 and not _a_produit_segment(state, "transport_civil"):
		_bot_produit(state, data, "transport_civil")
	if tick > 0 and tick % 156 == 0:
		var seg: String = "export_militaire" if annee >= 1934.0 else "transport_civil"
		if (state["catalogue"] as Dictionary).size() >= int(data["constants"]["eco"]["max_produits"]):
			Sim.appliquer(state, data, {"type": "retirer_produit", "produit": _plus_vieux_produit(state)})
		_bot_produit(state, data, seg)
	if (state["recherche"]["en_cours"] as Dictionary).is_empty() and float(state["tresorerie"]) > 250000.0:
		for paire: Array in _technos_par_date(data):
			var id_t: String = str(paire[1])
			if not (state["recherche"]["faites"] as Array).has(id_t) \
					and annee >= float(data["technos"][id_t]["date_etat_art"]):
				Sim.appliquer(state, data, {"type": "lancer_recherche", "techno": id_t})
				break
	var carnet_total: float = 0.0
	for uid: String in Etat.cles_triees(state["catalogue"]):
		carnet_total += float(state["catalogue"][uid]["carnet"])
	var palier: int = int(state["atelier"]["palier"])
	var paliers: Array = data["constants"]["eco"]["paliers_atelier"]
	if palier < paliers.size() and carnet_total > 2.0 * float(paliers[palier - 1]) \
			and float(state["tresorerie"]) > float(data["constants"]["eco"]["cout_palier"][palier]) * 1.3:
		Sim.appliquer(state, data, {"type": "agrandir_atelier"})
	# Candidature systématique aux AO ouverts avec le dernier produit militaire.
	var uid_mil: String = _plus_recent_produit(state, "export_militaire")
	if uid_mil != "":
		for id_ao: String in Contrats.ouverts(state, data):
			if not (state["ao"]["candidatures"] as Dictionary).has(id_ao):
				Sim.appliquer(state, data, {"type": "candidater_ao", "ao": id_ao, "produit": uid_mil})


func _bot_produit(state: Dictionary, data: Dictionary, seg: String) -> void:
	var annee: float = Marche.annee_de(state)
	var faites: Array = state["recherche"]["faites"]
	var candidates: Array = ["capot_naca", "helice_pas_variable", "train_rentrant",
		"cockpit_ferme", "volets_atterrissage"]
	if seg == "export_militaire":
		candidates.append_array(["suralimentation", "canon_moteur", "reservoirs_largables"])
	var features: Array = []
	for f: String in candidates:
		if faites.has(f):
			features.append(f)
	var structure: String = "bois"
	if faites.has("monocoque_metal"):
		structure = "metal"
	elif annee >= 1931.0:
		structure = "mixte"
	var design: Dictionary = {
		"nom": "Bot " + seg,
		"annee": annee,
		"formule": "monoplan" if annee >= 1930.0 else "biplan",
		"structure": structure,
		"moteur": Avion.meilleur_moteur(data, annee, "puissance" if seg == "export_militaire" else "eco"),
		"armement": 0,
		"features": features,
	}
	var kg_pax: float = float(data["constants"]["avion"]["kg_par_passager"])
	match seg:
		"ligne_postale":
			design["surface"] = 30.0
			design["carburant_kg"] = 900.0
			design["charge_utile_kg"] = 250.0
		"transport_civil":
			design["surface"] = 45.0
			design["carburant_kg"] = 500.0
			design["charge_utile_kg"] = kg_pax * (3.0 + (annee - Etat.AN0))
		"export_militaire":
			design["surface"] = 18.0
			design["carburant_kg"] = 350.0
			design["charge_utile_kg"] = 0.0
			design["armement"] = int(roundf(Marche.interp(_ref_critere(data, seg, "armement"), annee)))
	var uid_design: String = "d%d" % int(state["prochain_id"])
	if not Sim.appliquer(state, data, {"type": "nouveau_design", "design": design}):
		return
	var prix: float = float(state["designs"][uid_design]["specs"]["cout_unitaire"]) * 1.25
	Sim.appliquer(state, data, {"type": "lancer_produit", "design": uid_design, "segment": seg, "prix": prix})


func _plus_recent_produit(state: Dictionary, seg: String) -> String:
	var cat: Dictionary = state["catalogue"]
	var recent: String = ""
	var annee_max: float = -1.0
	for uid: String in Etat.cles_triees(cat):
		if str(cat[uid]["segment"]) == seg and float(cat[uid]["annee"]) > annee_max:
			annee_max = float(cat[uid]["annee"])
			recent = uid
	return recent


func _a_produit_segment(state: Dictionary, seg: String) -> bool:
	var cat: Dictionary = state["catalogue"]
	for uid: String in cat:
		if str(cat[uid]["segment"]) == seg:
			return true
	return false


func _plus_vieux_produit(state: Dictionary) -> String:
	var cat: Dictionary = state["catalogue"]
	var vieux: String = ""
	var annee_min: float = 1e18
	for uid: String in Etat.cles_triees(cat):
		if float(cat[uid]["annee"]) < annee_min:
			annee_min = float(cat[uid]["annee"])
			vieux = uid
	return vieux


func _technos_par_date(data: Dictionary) -> Array:
	var liste: Array = []
	for id_t: String in Etat.cles_triees(data["technos"]):
		if id_t == "soufflerie_interne":
			continue
		liste.append([float(data["technos"][id_t]["date_etat_art"]), id_t])
	liste.sort()
	return liste


func _ref_critere(data: Dictionary, seg: String, nom: String) -> Array:
	for crit: Dictionary in data["segments"][seg]["criteres"]:
		if str(crit["nom"]) == nom:
			return crit["ref"]
	return [[1925.0, 1.0]]


# Horizon de recherche : on ne lance pas une techno trop en avance sur l'état de l'art.
func _test_horizon_recherche(data: Dictionary) -> void:
	var h: float = float((data["constants"]["recherche"] as Dictionary).get("pionnier_horizon_ans", 0.0))
	if h <= 0.0:
		return
	var Rech2: GDScript = load("res://sim/research.gd")
	var state: Dictionary = Sim.nouvelle_partie(5, data)
	state["tresorerie"] = 9e9   # l'argent ne doit JAMAIS être ce qui bloque dans ce test
	var loin: String = ""
	var proche: String = ""
	for id_t: String in Etat.cles_triees(data["technos"]):
		var d: float = float(data["technos"][id_t]["date_etat_art"]) - Etat.AN0
		if d > h and loin == "" and Rech2.prerequis_ok([], data, id_t):
			loin = id_t
		if d <= h and proche == "" and Rech2.prerequis_ok([], data, id_t):
			proche = id_t
	if loin != "" and Rech2.lancer(state, data, loin):
		echecs.append("horizon : %s (%.0f) lançable en %.0f malgré l'horizon de %.0f ans"
			% [loin, float(data["technos"][loin]["date_etat_art"]), Etat.AN0, h])
	if proche != "" and not Rech2.lancer(state, data, proche):
		echecs.append("horizon : %s est DANS l'horizon et reste bloqué" % proche)
	print("horizon recherche | %.0f ans : %s refusé, %s accepté" % [h, loin, proche])
