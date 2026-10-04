# Raison d'être : traceur de diagnostic pour l'équilibrage — UNE campagne, UNE ligne par
# semaine, pour voir une trajectoire au lieu d'itérer à l'aveugle sur des distributions.
# Porté de bureau-etudes/tests/trace.gd, resserré à la semaine (là-bas une ligne par an
# suffisait : 23 ans de jeu contre 5 ans ici, et une jauge qui se joue en un trimestre).
#
# Ce n'est PAS un test : il ne rend aucun verdict et sort toujours en 0. C'est l'outil qu'on
# ouvre quand balance.gd passe au rouge et qu'on veut savoir POURQUOI — sans lui, on lit un
# verdict sans pouvoir ouvrir le capot.
#
# Mais il EST dans le smoke de la CI, qui le lance deux fois. Cette ligne affirmait l'inverse
# — faux, et corrige dans balayage.gd sans que personne aille voir ici. tests/run.gd
# (_test_ci_contradiction) le verifie maintenant, sur une chaine litterale : c'est pourquoi
# ni cette phrase ni celle de comparer.gd ne la recopient.
#
#   -s res://tests/trace.gd -- <graine> <bot> <pas> [<constante> <facteur> [<graines>]]
#   -- 7 industriel            une ligne par semaine, graine 7
#   -- 7 tous 13               un trimestre sur l'autre, les deux bots
#   -- 7 discret 13 blanchiment.capacite_sem 0.7
#                              MODE DIFF : la meme campagne avec et sans la perturbation,
#                              cote a cote, et la semaine ou les deux se separent
#   -- 7 discret 13 blanchiment.capacite_sem 0.7 10
#                              le meme diff sur 10 graines : le detail pour la premiere,
#                              puis ce que les neuf autres en disent. Un diff sur UNE
#                              graine invite exactement l'erreur que §16 nomme — conclure
#                              sur n = 1 — et c'est l'erreur dans laquelle ce mode etait ne.
#
# Le mode diff est ce qu'on veut vraiment apres avoir touche une constante : levier.gd dit
# QUE ca bouge et DE COMBIEN, balance.gd dit si les cibles tiennent encore — ni l'un ni
# l'autre ne dit A QUELLE SEMAINE le jeu a pris un autre chemin.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Produit := preload("res://sim/produit.gd")
const Bots := preload("res://tests/bots.gd")
const Levier := preload("res://tests/levier.gd")

const GRAINE_DEFAUT: int = 42
# Un changement de regime se note ; un ajustement de restockage ne se note pas. Sans ce
# seuil, la colonne « note » se remplissait a presque chaque semaine (le bot rattrape son
# stock au kilo pres) et FORCAIT l'impression de la ligne : le `pas` ne servait plus a
# rien : la trace d'une campagne entiere faisait autant de lignes que de semaines, quoi
# qu'on demande.
const SAUT_PART: float = 0.25


func _initialize() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	var graine: int = int(args[0]) if args.size() > 0 and args[0].is_valid_int() else GRAINE_DEFAUT
	var vise: String = str(args[1]) if args.size() > 1 else "tous"
	var pas: int = maxi(int(args[2]), 1) if args.size() > 2 and args[2].is_valid_int() else 1
	var constante: String = str(args[3]) if args.size() > 3 else ""
	var facteur: float = float(args[4]) if args.size() > 4 and args[4].is_valid_float() else 0.7
	var graines: int = maxi(int(args[5]), 1) if args.size() > 5 and args[5].is_valid_int() else 1
	var data: Dictionary = Etat.charger_data()
	var strats: Dictionary = Bots.strategies()
	for nom: String in Etat.cles_triees(strats):
		if vise != "tous" and vise != nom:
			continue
		print("")
		if constante == "":
			print("=== %s | graine %d | une ligne toutes les %d semaine(s) ===" % [nom, graine, pas])
			_tracer(data, strats[nom], graine, pas)
		else:
			print("=== %s | graines %d..%d | DIFF %s x%.2f ==="
				% [nom, graine, graine + graines - 1, constante, facteur])
			_diff(data, strats[nom], graine, pas, constante, facteur, graines)
	quit(0)


# Le prix n'est plus un nombre mais un par segment (§19bis). Cette ligne de resume en donne
# la moyenne des segments servis ; le detail par segment se lit dans la colonne `parts` et
# dans data/segments.json — recopier trois prix ici ferait une ligne illisible.
func _prix_moyen(state: Dictionary) -> float:
	var somme: float = 0.0
	var n: int = 0
	for nom_seg: String in (state["prix"] as Dictionary):
		var p: float = float(state["prix"][nom_seg])
		if p > 0.0:
			somme += p
			n += 1
	return somme / maxf(float(n), 1.0)


# --- trace simple -------------------------------------------------------------

func _tracer(data: Dictionary, strat: Dictionary, graine: int, pas: int) -> void:
	var state: Dictionary = Sim.nouvelle_partie(graine, data)
	var echeance: int = int(data["constants"]["dette"]["echeance_sem"])
	var seuil: float = float(data["constants"]["visibilite"]["seuil_arrestation"])
	var semaines_max: int = int(data["constants"]["sim"]["semaines_max"])
	print(" sem |  part |  kg p |  kg v | stock |     propre |       sale | blanchi | visib | note")
	var kg_p_cum: float = 0.0
	var kg_v_cum: float = 0.0
	var blanchi_cum: float = 0.0
	var visib_max: float = 0.0
	var sem_dette: int = -1
	var sem_traque: int = -1
	for t: int in range(semaines_max + 1):
		var part_avant: float = float(state["part_capacite"])
		var dette_avant: float = float(state["dette"])
		var acquis_avant: Dictionary = (state["recherche"]["acquis"] as Dictionary).duplicate()
		Bots.agir(state, data, strat)
		Sim.tick(state, data)
		var sem: int = int(state["tick"])
		var kg_p: float = float(state["stats"]["kg_produits"]) - kg_p_cum
		var kg_v: float = float(state["stats"]["kg_vendus"]) - kg_v_cum
		var blanchi: float = float(state["stats"]["propre_blanchi"]) - blanchi_cum
		kg_p_cum = float(state["stats"]["kg_produits"])
		kg_v_cum = float(state["stats"]["kg_vendus"])
		blanchi_cum = float(state["stats"]["propre_blanchi"])
		var visib: float = float(state["visibilite"])
		visib_max = maxf(visib_max, visib)
		if dette_avant > 0.0 and float(state["dette"]) <= 0.0:
			sem_dette = sem
		if sem_traque < 0 and visib >= seuil:
			sem_traque = sem
		# Les semaines QUI COMPTENT s'impriment quel que soit le pas : rater la semaine où
		# la jauge passe le seuil parce qu'on affichait un trimestre sur deux, c'est rater
		# la seule ligne qu'on est venu lire.
		var notes: PackedStringArray = []
		if sem == echeance:
			notes.append("ECHEANCE DETTE")
		if sem == sem_dette:
			notes.append("dette remboursee")
		if sem == sem_traque:
			notes.append("SEUIL FRANCHI")
		var part: float = float(state["part_capacite"])
		if absf(part - part_avant) >= SAUT_PART or (part > 0.0) != (part_avant > 0.0):
			notes.append("part %.2f -> %.2f" % [part_avant, part])
		# LES CASES DE LA GRILLE (§2bis) : c'est ici qu'on lit a quelle semaine un profil
		# atteint sa recette cible, et combien de temps il la joue avant de mourir — le
		# critere des couts de data/procedes.json. `-- 7 industriel 13` suffit.
		for id: String in Etat.cles_triees(state["recherche"]["acquis"]):
			if not acquis_avant.has(id):
				notes.append("case " + id)
		if float(state["cash_propre"]) < 0.0:
			notes.append("ROUGE %d sem" % int(state["semaines_rouge"]))
		if str(state["fin"]) != "":
			notes.append("FIN : " + str(state["fin"]))
		if sem % pas == 0 or not notes.is_empty():
			print("%4d | %5.2f | %5.1f | %5.1f | %5.1f | %10.0f | %10.0f | %7.0f | %5.1f | %s"
				% [sem, part, kg_p, kg_v, float(state["stock_kg"]),
				float(state["cash_propre"]), float(state["cash_sale"]), blanchi, visib,
				" ".join(notes)])
		if str(state["fin"]) != "":
			break
	var recette: Dictionary = state["recette"]
	var purete: float = float(recette["purete"]) if not recette.is_empty() else 0.0
	var specs: Dictionary = Produit.specs(recette, data) if not recette.is_empty() else {}
	if not specs.is_empty():
		print("  %s purete %.2f -> puissance %.3f | cout %.0f $/kg | prix %.0f $/kg | debit %.1f kg/sem | INSTAB %.3f"
			% [str(recette["famille"]), purete, float(specs["puissance"]),
			float(specs["cout_unitaire"]), _prix_moyen(state),
			float(specs["debit_kg_sem"]), float(specs["instabilite_neuro"])])
		var parts: PackedStringArray = []
		for nom_seg: String in Etat.cles_triees(state["marche"]):
			parts.append("%s %.0f%%" % [nom_seg,
				100.0 * float((state["marche"][nom_seg]["parts"] as Dictionary).get("joueur", 0.0))])
		print("  parts finales : %s" % " | ".join(parts))
	print("  fin=%s sem=%d | kg vendus %.0f | visibilite max %.1f | dette %s"
		% [str(state["fin"]), int(state["tick"]), kg_v_cum, visib_max,
		("remboursee sem %d" % sem_dette) if sem_dette > 0 else "JAMAIS REMBOURSEE"])


# --- mode diff ----------------------------------------------------------------

func _diff(data: Dictionary, strat: Dictionary, graine: int, pas: int, constante: String,
		facteur: float, graines: int) -> void:
	var chemin: Array = Array(constante.split("."))
	var connus: Array = Levier.inventaire(data["constants"])["chemins"]
	var existe: bool = false
	for c: Array in connus:
		if ".".join(PackedStringArray(c)) == constante:
			existe = true
	if not existe:
		printerr("  %s n'existe pas dans data/constants.json" % constante)
		return
	var valeur: float = float(Levier.lire(data, chemin))
	var data_b: Dictionary = data.duplicate(true)
	Levier.ecrire(data_b, chemin, valeur * facteur)
	print("  %s : %s -> %s" % [constante, String.num(valeur, 4), String.num(valeur * facteur, 4)])
	var resultats: Array = []
	for g: int in range(graine, graine + graines):
		resultats.append(_diff_une(data, data_b, strat, g, pas, g == graine))
	if graines > 1:
		_resume_diff(resultats)


# Une graine : les deux campagnes en verrou, et le detail semaine par semaine si on le veut.
func _diff_une(data: Dictionary, data_b: Dictionary, strat: Dictionary, graine: int,
		pas: int, detail: bool) -> Dictionary:
	if detail:
		print(" sem |   propre A |  d propre |     sale A |    d sale | visib A | d visib | note")
	var a: Dictionary = Sim.nouvelle_partie(graine, data)
	var b: Dictionary = Sim.nouvelle_partie(graine, data_b)
	var semaines_max: int = int(data["constants"]["sim"]["semaines_max"])
	var divergence: int = -1
	for t: int in range(semaines_max + 1):
		# Les deux avancent en verrou. Celle qui a deja fini gele d'elle-meme (Sim.tick
		# sort immediatement quand `fin` est pose), donc on n'a pas a les desynchroniser.
		Bots.agir(a, data, strat)
		Sim.tick(a, data)
		Bots.agir(b, data_b, strat)
		Sim.tick(b, data_b)
		# Le numero de semaine est celui de la campagne QUI TOURNE ENCORE : quand A meurt
		# et que B continue, lire le tick de A fige la colonne et imprime six fois la
		# meme semaine pendant que les chiffres, eux, avancent.
		var sem: int = maxi(int(a["tick"]), int(b["tick"]))
		var d_propre: float = float(b["cash_propre"]) - float(a["cash_propre"])
		var d_sale: float = float(b["cash_sale"]) - float(a["cash_sale"])
		var d_visib: float = float(b["visibilite"]) - float(a["visibilite"])
		var notes: PackedStringArray = []
		if divergence < 0 and (absf(d_propre) > 1e-6 or absf(d_sale) > 1e-6
				or absf(d_visib) > 1e-9):
			divergence = sem
			notes.append("DIVERGENCE")
		if detail and (sem % pas == 0 or not notes.is_empty()
				or str(a["fin"]) != "" or str(b["fin"]) != ""):
			if str(a["fin"]) != "":
				notes.append("A fin=" + str(a["fin"]))
			if str(b["fin"]) != "":
				notes.append("B fin=" + str(b["fin"]))
			print("%4d | %10.0f | %+9.0f | %10.0f | %+9.0f | %7.1f | %+7.1f | %s"
				% [sem, float(a["cash_propre"]), d_propre, float(a["cash_sale"]), d_sale,
				float(a["visibilite"]), d_visib, " ".join(notes)])
		if str(a["fin"]) != "" and str(b["fin"]) != "":
			break
	if detail:
		print("  A : fin=%-13s sem=%3d propre=%10.0f | B : fin=%-13s sem=%3d propre=%10.0f"
			% [str(a["fin"]), int(a["tick"]), float(a["cash_propre"]),
			str(b["fin"]), int(b["tick"]), float(b["cash_propre"])])
		print("  divergence : %s" % (("semaine %d" % divergence) if divergence > 0
			else "AUCUNE — cette constante ne change rien pour ce bot et cette graine"))
	return {"graine": graine, "fin_a": str(a["fin"]), "fin_b": str(b["fin"]),
		"propre_a": float(a["cash_propre"]),
		"d_propre": float(b["cash_propre"]) - float(a["cash_propre"]),
		"divergence": divergence}


# CE QUE LES AUTRES GRAINES EN DISENT. Un diff sur une seule graine dit « 2,36 M de moins »
# et laisse croire que c'est LE chiffre ; §16 est explicite — n < 10 ne prouve rien, et deux
# resultats identiques ne sont pas une loi, c'est un echantillon de deux points.
func _resume_diff(resultats: Array) -> void:
	print("  --- les %d graines ---" % resultats.size())
	var fins_changees: int = 0
	var d_propres: Array = []
	var divergences: Array = []
	for r: Dictionary in resultats:
		if str(r["fin_a"]) != str(r["fin_b"]):
			fins_changees += 1
			print("    graine %d : fin %s -> %s" % [int(r["graine"]), str(r["fin_a"]),
				str(r["fin_b"])])
		d_propres.append(float(r["d_propre"]))
		if int(r["divergence"]) > 0:
			divergences.append(float(r["divergence"]))
	print("    issues changees   : %d/%d" % [fins_changees, resultats.size()])
	print("    graines qui divergent : %d/%d" % [divergences.size(), resultats.size()])
	if not d_propres.is_empty():
		d_propres.sort()
		print("    d propre          : min %+.0f | med %+.0f | max %+.0f"
			% [float(d_propres[0]), _mediane(d_propres),
			float(d_propres[d_propres.size() - 1])])
	if not divergences.is_empty():
		divergences.sort()
		print("    semaine de divergence : min %.0f | med %.0f | max %.0f"
			% [float(divergences[0]), _mediane(divergences),
			float(divergences[divergences.size() - 1])])


func _mediane(valeurs: Array) -> float:
	if valeurs.is_empty():
		return 0.0
	var tri: Array = valeurs.duplicate()
	tri.sort()
	return float(tri[floori(float(tri.size()) / 2.0)])
