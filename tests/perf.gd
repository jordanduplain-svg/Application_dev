# Raison d'être : la garde de « Vitesse du harnais » (§16) — le coût d'un tick de
# simulation, et ce qu'il coûtera aux deux boucles qu'on lance vraiment. §16 pose la règle
# en une phrase : « à 10 minutes la boucle, l'équilibrage devient impraticable et on se met
# à deviner au lieu de mesurer. » Un harnais qui ralentit d'un facteur 50 ne casse rien —
# il rend juste l'équilibrage impossible, en silence, et c'est le pire des deux.
#
# Ce n'est PAS le perf.gd de bureau-etudes : là-bas il mesurait des FPS sur une scène
# rendue, fenêtre ouverte, et comptait les `_process` actifs. Celui-là revient tel quel le
# jour où `game/` existe (§12bis, jalon 1) — il n'y a pas encore un seul écran à fumer.
#
# Les budgets sont VOLONTAIREMENT larges : ce test attrape un ordre de grandeur perdu, pas
# une machine lente. Un seuil serré sur un runner CI partagé ne mesure que la météo du
# runner, et un test qui clignote finit désarmé.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Bots := preload("res://tests/bots.gd")
const Levier := preload("res://tests/levier.gd")

# Le nombre de graines des vraies boucles : balance.gd pour valider un jalon, levier.gd
# pour la porte du jalon 0. On extrapole leur coût au lieu de les relancer ici — les
# relancer doublerait le temps de CI pour mesurer ce qu'on vient de mesurer.
const GRAINES_BALANCE: int = 100
const GRAINES_LEVIER: int = Levier.N_GRAINES_DEFAUT
const BUDGET_BALANCE_SEC: float = 300.0
const BUDGET_LEVIER_SEC: float = 300.0
# Le budget attrape la catastrophe ; l'ALERTE attrape la derive. §16 ne dit pas « 5 minutes
# c'est la limite », il dit « 20 graines ~2 min pour iterer, 100 pour valider » — donc la
# vraie frontiere d'usage est bien en dessous du budget, et c'est elle qu'on veut voir
# approcher. Une boucle qui passe de 6 s a 2 min reste verte et a pourtant deja change de
# nature : on n'itere plus, on lance et on va faire autre chose.
# Alerte et pas verdict, comme dans balance.gd : c'est un constat sur la trajectoire, pas
# une regression a faire echouer. Au jalon 3, elle previent ; au jalon 6, il serait tard.
const SEUIL_ALERTE_SEC: float = 120.0
# Ce que l'humain attend EN PLUS de la simulation : lancement du moteur, chargement des
# scripts. Mesurer la boucle nue et appeler ça « le temps de la boucle » serait deja un
# demi-mensonge, et c'est le temps percu qui decide si on itere ou si on devine.
const DEMARRAGE_SEC: float = 2.0
# Échauffement : les premières campagnes paient le JIT du moteur et les allocations
# initiales. Les compter fausserait la mesure vers le haut, donc vers un faux rouge.
const GRAINES_CHAUFFE: int = 3
const GRAINES_MESURE: int = 20


func _initialize() -> void:
	create_timer(120.0).timeout.connect(func() -> void:
		printerr("ECHEC PERF : chien de garde")
		quit(1))
	var data: Dictionary = Etat.charger_data()
	var strats: Dictionary = Bots.strategies()
	var noms: Array = Etat.cles_triees(strats)
	for graine: int in range(1, GRAINES_CHAUFFE + 1):
		for nom: String in noms:
			_campagne(graine, data, strats[nom])
	var debut: int = Time.get_ticks_usec()
	var ticks: int = 0
	for graine: int in range(1, GRAINES_MESURE + 1):
		for nom: String in noms:
			ticks += _campagne(graine, data, strats[nom])
	var duree_us: float = float(Time.get_ticks_usec() - debut)
	var us_par_tick: float = duree_us / maxf(float(ticks), 1.0)
	# Le coût d'UNE graine, c'est la somme des campagnes de tous les bots : c'est l'unité
	# dans laquelle les deux boucles se comptent, et elle bougera quand un bot naîtra.
	var ticks_par_graine: float = float(ticks) / float(GRAINES_MESURE)
	print("perf | %d ticks en %.0f ms -> %.1f us/tick | %.0f ticks par graine (%d bots)"
		% [ticks, duree_us / 1000.0, us_par_tick, ticks_par_graine, noms.size()])

	var echecs: Array[String] = []
	var sec_balance: float = DEMARRAGE_SEC + _secondes(ticks_par_graine, GRAINES_BALANCE, 1.0, us_par_tick)
	_verdict(echecs, "balance.gd a %d graines : %.1f s (budget %.0f s)"
		% [GRAINES_BALANCE, sec_balance, BUDGET_BALANCE_SEC], sec_balance < BUDGET_BALANCE_SEC)
	# levier.gd relance le jeu entier une fois par sens et par constante, plus la base et le
	# canari : c'est lui qui explosera en premier quand data/ grandira. Le nombre de passes
	# lui est DEMANDE, pas modelise ici — quand il changera ses boucles, ce budget suivra
	# tout seul au lieu de mentir en silence.
	#
	# CE CHIFFRE EST UNE BORNE HAUTE, et c'est voulu. Il suppose que chaque passe simule
	# toutes les graines de tous les bots ; levier.gd en saute une partie quand un bot n'a
	# aucune variance, donc il tourne plus vite que l'estimation. Un garde de budget doit
	# se tromper dans ce sens-la : une borne haute ne peut produire qu'un faux rouge, jamais
	# un faux vert. Refaire ici le modele fin des boucles d'un autre fichier serait la
	# troisieme version de la faute que ce commentaire decrit deux lignes plus haut.
	var n_constantes: int = (Levier.inventaire(data)["chemins"] as Array).size()
	var passes: float = float(Levier.passes(data))
	var sec_levier: float = DEMARRAGE_SEC + _secondes(ticks_par_graine, GRAINES_LEVIER, passes, us_par_tick)
	_verdict(echecs, "levier.gd a %d graines x %d constantes (%d passes) : %.1f s max (budget %.0f s)"
		% [GRAINES_LEVIER, n_constantes, int(passes), sec_levier, BUDGET_LEVIER_SEC],
		sec_levier < BUDGET_LEVIER_SEC)
	_canari(echecs, sec_balance)
	_alerter("balance.gd", sec_balance)
	_alerter("levier.gd", sec_levier)
	if echecs.is_empty():
		print("PERF : LES DEUX BOUCLES RESTENT PRATICABLES")
		quit(0)
	else:
		for e: String in echecs:
			printerr("ECHEC PERF : " + e)
		quit(1)


func _alerter(quoi: String, sec: float) -> void:
	if sec <= SEUIL_ALERTE_SEC:
		return
	print("ALERTE %s prend %.0f s (seuil d'usage %.0f s) : la boucle est encore verte mais on ne l'itere plus, on la lance et on va faire autre chose"
		% [quoi, sec, SEUIL_ALERTE_SEC])


func _secondes(ticks_par_graine: float, graines: int, passes: float, us_par_tick: float) -> float:
	return ticks_par_graine * float(graines) * passes * us_par_tick / 1e6


# LE CHEMIN D'ECHEC, exerce a chaque execution. Les deux budgets sont larges expres : ils
# ne sont jamais franchis, donc le code qui les fait rougir n'avait jamais tourne une seule
# fois. Un verdict qu'on n'a jamais vu echouer est un verdict dont on ignore s'il sait
# echouer — c'est ce que le canari prouve pour levier.gd, et ca manquait ici.
#
# On juge la MESURE REELLE contre deux budgets absurdes, un impossible et un infini : le
# premier doit rougir, le second passer. Le chemin exerce est celui de la vraie comparaison
# et du vrai message, pas un booleen de laboratoire.
func _canari(echecs: Array[String], sec_mesure: float) -> void:
	var faux: Array[String] = []
	_juger(faux, "budget impossible", sec_mesure < 0.0, false)
	_juger(faux, "budget infini", sec_mesure < 1e9, false)
	var ok: bool = faux.size() == 1
	print("%s canari : le verdict sait rougir (1 echec attendu sur 2 jugements, %d obtenu)"
		% ["CANA " if ok else "RATE ", faux.size()])
	if not ok:
		echecs.append("le chemin d'echec de perf.gd est casse : il ne sait plus rougir, donc ses deux OK ne valent rien")


func _verdict(echecs: Array[String], texte: String, ok: bool) -> void:
	_juger(echecs, texte, ok, true)


func _juger(echecs: Array[String], texte: String, ok: bool, bavard: bool) -> void:
	if bavard:
		print("%s %s" % ["  OK " if ok else "RATE ", texte])
	if not ok:
		echecs.append(texte)


# Retourne le nombre de ticks réellement simulés : une campagne qui s'arrête à la semaine
# 35 ne coûte pas ce qu'elle coûterait à 260, et diviser par un nombre de campagnes au lieu
# d'un nombre de ticks donnerait un us/tick qui bouge quand l'équilibrage bouge.
func _campagne(graine: int, data: Dictionary, strat: Dictionary) -> int:
	var state: Dictionary = Sim.nouvelle_partie(graine, data)
	var semaines_max: int = int(data["constants"]["sim"]["semaines_max"])
	var n: int = 0
	for t: int in range(semaines_max + 1):
		Bots.agir(state, data, strat)
		Sim.tick(state, data)
		n += 1
		if str(state["fin"]) != "":
			break
	return n

