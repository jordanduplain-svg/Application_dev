# Raison d'être : LA porte du jalon 0 (§15) — « casser volontairement une constante de 30 %
# dans constants.json et vérifier qu'un verdict passe au rouge. Si rien ne bouge, le levier
# est débranché et l'équilibrage se fera dans le vide pendant six mois. »
#
# Ce test fait le tour COMPLET du fichier : chaque constante, une par une, ±30 %, et au
# moins une métrique doit bouger. C'est la règle de méthode de §16 (« un résultat
# bit-identique après un changement de 20 % n'est pas une confirmation, c'est un levier
# débranché ») appliquée au harnais lui-même, avant qu'il ne mesure quoi que ce soit.
#
# Ce qu'il ne dit PAS : qu'une constante est bien câblée, ou câblée au bon endroit. Il dit
# qu'elle est câblée quelque part, et DE COMBIEN elle pèse. Un levier branché à l'envers
# passe ce test — c'est balance.gd qui le rattrape, et le playtest (§15 phase 7) le reste.
#
# Rien n'est écrit sur le disque : les constantes sont perturbées dans une COPIE du dict.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Bots := preload("res://tests/bots.gd")
const Balance := preload("res://tests/balance.gd")
const Produit := preload("res://sim/produit.gd")

const PERTURBATION: float = 0.30
# Une constante à zéro ne bouge pas de ±30 % : le ratio est un no-op sur zéro, et un levier
# mort passerait pour vert au seul motif que sa valeur de départ est nulle. On la perturbe
# donc d'un delta ABSOLU, dans le seul sens qui ait un sens (vers le haut : une bourse
# négative au départ ne veut rien dire), et le rapport le dit explicitement.
const DELTA_NUL: float = 1000.0

# LE CANARI : une constante que RIEN ne lit, perturbée exactement comme les autres, et qui
# doit ressortir MORTE. C'est la seule preuve que ce fichier sache encore dire non — si le
# comparateur bruitait (campagnes non reproductibles, epsilon trop serré, ordre des bots
# instable), TOUT bougerait et les 23 constantes passeraient sans que rien ne soit mesuré.
# Un test qui ne peut plus échouer n'est pas une porte, et son vert ne vaudrait rien.
const CLE_CANARI: String = "canari_levier"

# Les six sorties observables d'une campagne. `issue` (perdue / pas perdue) est traitée à
# part : c'est un booléen, son amplitude relative n'a pas de sens, mais son basculement est
# le signal le plus fort qu'une constante puisse produire.
const METRIQUES: PackedStringArray = ["issue", "fin_sem", "propre", "sale", "visibilite", "kg"]

# LES SEPT SPECS DES TROIS PRODUITS DE REFERENCE, mesurees en plus des campagnes.
# Sans elles, la moitie de data/constants.json ressortait debranchee pour une raison qui
# n'avait rien a voir avec le cablage : les deux bots n'utilisent qu'UNE recette chacun, ils
# ne stabilisent jamais, et `instabilite_neuro` ne fait rien avant l'acte III — donc aucune
# campagne ne pouvait bouger. Les references de data/calibration.json, elles, couvrent
# exprès le domaine (rue / haut de gamme / extreme), et c'est la que ces constantes vivent.
#
# C'est aussi la seule facon de mesurer `instabilite_neuro` au levier : §2 exige qu'il
# existe au jalon 1 PRECISEMENT parce qu'il ne fait rien — un axe qui ne fait rien ne
# deplace aucune campagne, et serait donc declare mort par un harnais qui ne regarde que
# les campagnes. Il serait mort pour de vrai deux ans plus tard.
const SPECS: PackedStringArray = ["cout_unitaire", "debit_kg_sem", "dependance",
	"regularite_lot", "instabilite_neuro", "puissance", "signature"]

# LA LISTE DORMANTE — et le seul endroit de ce fichier où une constante a le droit de ne
# rien bouger. Une constante y entre quand son SOUS-SYSTÈME n'est pas né, jamais parce
# qu'elle gêne : chaque ligne nomme le jalon qui la retirera.
#
# Ce qui empêche cette liste de devenir le poteau qu'on déplace pour passer (§16) : elle
# est vérifiée DANS LES DEUX SENS. Une dormante qui se met à bouger fait ÉCHOUER le test
# tant qu'on ne l'a pas retirée d'ici. Une exemption ne peut donc pas survivre à sa raison
# d'être — c'est ce qui la distingue d'un contournement.
# LE JALON EN COURS. Une dormante annonce le jalon qui la reveillera ; passe cette date,
# l'exemption est PERIMEE et le test echoue tant qu'on ne l'a pas retiree. Sans ce chiffre,
# DORMANTES n'expirait que sur le comportement (une dormante qui se remet a mordre) — donc
# une constante endormie « jusqu'au jalon 1 » pouvait dormir jusqu'au jalon 5 sans que rien
# ne le signale. Une derogation sans date n'est pas une derogation, c'est une suppression.
#
# IL EST RESTE A 0 PENDANT TOUT LE JALON 1, c'est-a-dire que le mecanisme anti-peremption
# etait lui-meme perime. Deux erreurs s'annulaient : ce nombre etait trop bas, et le jalon
# declare d'`empilement_maison` etait trop tot. La premiere fois qu'on l'a mis a jour, la
# porte a refuse — ce qui est la seule preuve qu'elle savait refuser.
const JALON_COURANT: int = 1

# LES SATUREES — une categorie a part, et la distinction n'est pas cosmetique. Une
# DORMANTE attend un sous-systeme : elle a un jalon, et ce jalon la reveillera. Une SATUREE
# est branchee et le restera, mais une borne deliberee absorbe ses deux sens : aucun jalon
# ne la debloquera, et lui en inventer un serait mentir sur ce qu'on attend.
#
# Verifiee dans les deux sens comme les dormantes : si une saturee se remet a bouger, la
# borne a change et l'entree doit partir.
# `los_hermanos.marge` A FAIT TROIS ALLERS-RETOURS, et c'est le mecanisme qui l'a conduite
# a chaque fois. Le rival le moins cher n'etait jamais la mediane de trois maisons : sourde,
# entree ici, ressortie quand §19.6 a bouge les medianes, revenue quand §2 a fait baisser
# les couts. Elle est sortie pour de bon le jour ou `grossiste` est entre dans le harnais :
# un temoin qui casse les prix de la rue rend enfin la marge du rival le moins cher
# decisive. Ce qu'un balayage a facteur quatre ne voyait pas, un PROFIL l'a reveille.
#
# LE SAVOIR-FAIRE DES PREMIERES CASES DE LA VEINE DEFENSIVE, sature comme l'etait celui de
# l'Azurite (qui en est ressorti avec `orfevre`). `orfevre` apprend le bras Familles /
# Stabilisation en produisant sa famille la plus avancee depuis la semaine 1 ; quand son
# propre lui permet le Liant ambre, il a deja bien plus d'experience que la case n'en
# demande. Le monter pour le faire mordre serait tourner un nombre pour passer le levier.
# Le retrouver : `trace.gd -- 7 orfevre 13`, colonne note.
const SATUREES: Dictionary = {
	"procedes.noeuds.liant_ambre.cout_savoir":
		"saturee par l'argent : quand `orfevre` peut payer le Liant ambre, il a deja l'experience",
}

const DORMANTES: Dictionary = {
	# TROIS ENTREES, ET TROIS RAISONS DIFFERENTES. Les precedentes ont toutes ete retirees
	# par le mecanisme lui-meme : `capacite_labo_kg_sem` et `dette.echeance_sem` se sont
	# reveillees quand sim/produit.gd a fait passer le debit et les couts par elles,
	# `semaines_faillite` quand le marche trimestriel a cree un trou de tresorerie de treize
	# semaines, et `k_elasticite` / `bruit_demande` ont ete supprimees de constants.json —
	# l'entree orpheline qu'elles ont laissee a fait echouer le test jusqu'a ce qu'on la
	# retire. Aucune n'a ete oubliee, et c'etait le pari du mecanisme.

	# LA FAILLITE EST UNE PORTE FERMEE, ET C'EST LA SEULE. Elle demande plusieurs semaines
	# consecutives de propre negatif, or le debit de blanchiment couvre toujours les charges
	# fixes du jalon 1 : le propre ne passe jamais sous zero, donc le compteur ne demarre
	# jamais. (`semaines_arrestation` etait endormie ici aussi et en est sortie toute seule
	# le jour ou la jauge s'est remise a tuer — l'arrestation est desormais la seule mort
	# du jalon 1.)
	#
	# Ce qui rouvrira la faillite est le MEME systeme que ce qui manque a la cible 1 : les
	# saisies et les descentes (§3bis, §7 — sim/raids.gd et accidents.gd, jalon 2). Il
	# manque au jeu un risque GRUMELEUX. Tout ce qui existe aujourd'hui est lisse : le tas
	# de sale est une integrale, le bruit de marche s'y moyenne, et la date de mort est
	# identique a la semaine pres sur cent graines. La mort est donc une falaise
	# deterministe et jamais une distribution.
	# Le revoir : `balayage.gd -- visibilite.k_cash_sale 0.25 0.55 7`, colonne mortalite.
	"constants.eco.semaines_faillite": {"jalon": 2,
		"pourquoi": "les saisies (§3bis) : sans risque grumeleux, personne ne passe dans le rouge"},

	# LES CASES QUE PERSONNE NE PREND (§2bis). Ici le sous-systeme existe et tourne : il
	# manque un JOUEUR qui s'en serve. C'est l'aveu imprime en tete de ce fichier — « un
	# levier que personne ne pousse ressort debranche sans que le jeu l'ignore pour autant ».
	#
	# LA LISTE A RETRECI, et c'est la porte qui l'a fait. La grille a jonctions laissait
	# vingt cases sur vingt-sept a aucun temoin ; `grossiste` et `orfevre` sont nes pour ca,
	# et le levier a fait echouer chaque exemption qu'ils ont reveillee — veine Volume,
	# Liant gris et ambre, Cristallisation, Gros lots, et les planchers de coupe, de
	# marquage et de stabilisation. Treize cases dorment encore, chacune datee du profil qui
	# la reveillera :
	#
	#   - le NOCTAL, la MATRICE FROIDE et le haut de la veine PROCEDE (complexite 3 a 5) :
	#     la recette extreme de data/calibration.json — `accelerateur` (jalon 5).
	#   - le bout de la veine Volume et les AGENTS : `grossiste` est arrete avant de les
	#     atteindre. C'est son temoignage, pas un defaut a corriger dans sa liste.
	#   - les PETITS LOTS et le MARQUAGE : `orfevre` n'en a jamais les moyens. Meme raison.
	#   - le GEL et les GALETS : aucun profil n'en a l'intention aujourd'hui.
	# Pour ces deux dernieres familles de raisons, le profil qui les reveillera est
	# `opportuniste` (jalon 3) ; s'il ne le fait pas, ces dates mentent et la porte le dira.
	#
	# Ce qui dort n'est pas la mecanique : les effets de toutes ces options vivent dans les
	# references de data/calibration.json, donc dans la colonne « specs » de ce fichier.
	"procedes.noeuds.matrice_froide": {"jalon": 5, "couvre": 3,
		"pourquoi": "le bout de la veine defensive : aucun temoin ne stabilise a 3 avant `accelerateur` (§8)"},
	"procedes.noeuds.culture_noctal": {"jalon": 5, "couvre": 2,
		"pourquoi": "le sommet des familles : aucun temoin ne monte au Noctal avant `accelerateur`"},
	"procedes.noeuds.reflux": {"jalon": 5, "couvre": 3,
		"pourquoi": "complexite 3 : aucun temoin ne depasse 2 avant `accelerateur`"},
	"procedes.noeuds.cascade": {"jalon": 5, "couvre": 3,
		"pourquoi": "complexite 4 : aucun temoin ne depasse 2 avant `accelerateur`"},
	"procedes.noeuds.synthese_continue": {"jalon": 5, "couvre": 3,
		"pourquoi": "complexite 5 : aucun temoin ne depasse 2 avant `accelerateur`"},
	"procedes.noeuds.cuves_en_serie": {"jalon": 3, "couvre": 3,
		"pourquoi": "le bout de la veine volume : `grossiste` est arrete avant, `opportuniste` le reveillera"},
	"procedes.noeuds.agent_enrobant": {"jalon": 3, "couvre": 2,
		"pourquoi": "les agents : `grossiste` est arrete avant, `opportuniste` les reveillera"},
	"procedes.noeuds.agent_exaltant": {"jalon": 3, "couvre": 2,
		"pourquoi": "les agents : `grossiste` est arrete avant, `opportuniste` les reveillera"},
	"procedes.noeuds.petits_lots": {"jalon": 3, "couvre": 2,
		"pourquoi": "`orfevre` n'en a jamais les moyens, `opportuniste` le reveillera"},
	"procedes.noeuds.tampon_de_maison": {"jalon": 3, "couvre": 3,
		"pourquoi": "`orfevre` n'en a jamais les moyens, `opportuniste` le reveillera"},
	"procedes.noeuds.marque_deposee": {"jalon": 3, "couvre": 3,
		"pourquoi": "aucun temoin ne va jusqu'a la marque, `opportuniste` le reveillera"},
	"procedes.noeuds.galets": {"jalon": 3, "couvre": 2,
		"pourquoi": "aucun profil ne vise les galets aujourd'hui"},
	"procedes.noeuds.gelification": {"jalon": 3, "couvre": 2,
		"pourquoi": "aucun profil ne vise le gel aujourd'hui"},
	# LE PLAFOND DE FIDELITE, endormi PAR EFFET DE BORD et c'est ce qui le rend interessant.
	# Il etait branche avant §2bis, a 3 % d'amplitude sur le seul `industriel` : il ne mordait
	# que sur des campagnes longues, ou `demande_fidele` a le temps de s'accumuler jusqu'au
	# plafond. Depuis que la recherche fait passer `industriel` par soixante semaines de
	# precurseur surveille, il meurt semaine 109 au lieu de 187 et n'y arrive plus.
	# `discret`, lui, vend un produit trop coupe pour etre addictif.
	# Il faut donc un profil A LA FOIS durable ET addictif pour l'atteindre : c'est
	# `opportuniste` (jalon 3). Aucune mecanique n'a ete debranchee — c'est la duree de vie
	# des temoins qui a change, et la baseline se remesure au lieu de se citer (§16).
	"constants.marche.plafond_fidelite": {"jalon": 3,
		"pourquoi": "il faut un profil durable ET addictif pour saturer la fidelite : `opportuniste`"},


	# L'EMPLACEMENT DU TRAITRE, endormi par PREFIXE : ses neuf nombres n'existent pas encore
	# dans la partie. `fusion_only` sort la maison de init_rivaux, et elle n'y entrera qu'a
	# la premiere trahison (§6, jalon 4) — avec la recette du joueur FIGEE a cet instant,
	# ce qui rendra d'ailleurs la moitie de ces nombres inutiles.
	# `couvre` PINCE le nombre de constantes endormies par ce prefixe. Sans lui, une dixieme
	# constante ajoutee sous `le_traitre` serait endormie sans que personne ne l'ait decide,
	# et le recapitulatif afficherait 10 au lieu de 9 sans que rien ne casse — un nombre
	# imprime que personne ne surveille n'est pas une garde.
	"rivaux.maisons.le_traitre": {"jalon": 4, "couvre": 9,
		"pourquoi": "§6 : la maison du traitre n'existe qu'apres la premiere trahison"},

	# Un seul produit par maison : `pow(empilement, 0)` vaut 1 quoi qu'on mette dedans. Le
	# rendement decroissant ne peut mordre qu'avec le CATALOGUE de §2.
	#
	# RE-DATEE PAR LA PORTE. Elle annoncait le jalon 1 ; quand `JALON_COURANT` est enfin
	# passe a 1, l'exemption a expire et a fait echouer le test. Et elle avait tort : le
	# catalogue n'etait date NULLE PART dans §15 — trois recettes simultanees demandent
	# trois lignes de production, donc le parc du jalon 2. La date est desormais ecrite
	# dans les deux endroits, ici et dans le tableau de §15.
	"constants.marche.empilement_maison": {"jalon": 2,
		"pourquoi": "le catalogue de 3 recettes (§2) : il demande les lignes de production du jalon 2"},

	# `f_delai = 1 / (1 + k x ruptures)`, et personne n'a de rupture : un seul noeud, aucun
	# voyage. Le terme est ecrit AUJOURD'HUI pour ne pas etre ajoute apres coup dans un
	# systeme deja calibre (§2) — il attend le graphe.
	"constants.marche.k_delai": {"jalon": 2,
		"pourquoi": "le graphe (§3) : pas de rupture d'approvisionnement sans routes"},



}

# Réglable comme balance.gd : `-s res://tests/levier.gd -- 12`. 6 suffit à voir un zéro
# franc (ce test cherche « rien n'a bougé », pas une statistique) ; on monte le jour où les
# bots divergent assez pour qu'une compensation entre eux devienne possible.
const CHEMIN_CSV: String = "res://levier.csv"

# 4 ET NON PLUS 6, et ce n'est pas la precision qu'on a echangee contre du temps. La
# puissance de ce test est le nombre de CAMPAGNES par mesure, bots x graines : il etait de
# 2 x 6 = 12, il est de 4 x 4 = 16 depuis l'arrivee de `grossiste` et `orfevre`. Garder 6
# graines a quatre bots faisait passer le levier au-dessus du budget de perf.gd pour en
# voir PLUS qu'avant. Lu aussi par perf.gd : une seule source pour ce chiffre.
const N_GRAINES_DEFAUT: int = 4

var n_graines: int = N_GRAINES_DEFAUT

var echecs: Array[String] = []
# Rempli une seule fois, sur la mesure de BASE : les bots dont toutes les graines racontent
# la meme campagne. Mesure, jamais suppose.
var _sans_variance: Dictionary = {}


func _initialize() -> void:
	# Chien de garde : une erreur runtime avorte les tests avant quit() — sans lui le
	# process tourne pour toujours et l'erreur reste coincée dans le buffer stdout.
	create_timer(600.0).timeout.connect(func() -> void:
		printerr("ECHEC : chien de garde levier.gd — erreur runtime dans les tests (voir ci-dessus)")
		quit(1))
	var args: PackedStringArray = OS.get_cmdline_user_args()
	if args.size() > 0 and args[0].is_valid_int():
		n_graines = maxi(int(args[0]), 1)
	var data: Dictionary = Etat.charger_data()
	var inv: Dictionary = inventaire(data)
	var chemins: Array = inv["chemins"]
	for probleme: String in inv["problemes"]:
		echecs.append(probleme)
	_verifier_dormantes(chemins)
	print("levier : %d constantes x +/-%.0f%% x %d graines x %d bots = %d metriques par mesure"
		% [chemins.size(), PERTURBATION * 100.0, n_graines, Bots.strategies().size(),
		_taille_vecteur()])
	# L'AVEU, imprime et pas enterre dans un commentaire que personne n'ouvre : ce fichier
	# ne mesure pas le jeu, il mesure le couple (jeu, bots). Une constante peut ressortir
	# debranchee parce que les bots ne l'atteignent jamais — c'est arrive a
	# eco.capacite_labo_kg_sem le jour ou les bots ont cesse de produire pour l'entrepot,
	# et elle s'est rallumee toute seule le jour ou sim/produit.gd a fait passer le debit
	# par elle. Elle aura donc ete declaree dormante, puis reveillee par le mecanisme meme
	# qui la surveillait, sans que personne ait eu a y penser : c'est le cas nominal.
	# Le verdict reste vrai ; ce qu'il decrit n'est pas ce qu'on croit lire.
	print("        ces verdicts valent pour CES bots (%s) : un levier que personne ne pousse"
		% ", ".join(PackedStringArray(Etat.cles_triees(Bots.strategies()))))
	print("        ressort debranche sans que le jeu l'ignore pour autant.")
	_detecter_variance(data)
	var base: Array = _metriques(data)
	var base_specs: Array = _specs(data)
	var ref: Dictionary = {
		"campagnes": base, "echelles": _echelles(base, METRIQUES.size()),
		"specs": base_specs, "echelles_specs": _echelles(base_specs, SPECS.size()),
	}
	print("        + %d specs de reference (%d produits x %d specs) : c'est la que vivent les"
		% [base_specs.size(), (data["calibration"]["references"] as Array).size(), SPECS.size()])
	print("        constantes de conception, qu'aucune campagne ne peut bouger.")
	# LE CANARI D'ABORD : si le comparateur bruite, le reste du rapport est sans valeur, et
	# l'imprimer quand même ne ferait que donner l'illusion d'une mesure.
	if not _canari(data, ref):
		printerr("ECHEC : " + echecs[0])
		quit(1)
		return
	var classement: Array = []
	var issues_total: int = 0
	for chemin: Array in chemins:
		var r: Dictionary = _eprouver(data, chemin, ref)
		issues_total += int(r["issues"])
		classement.append(r)
	_classement(classement)
	_portee(classement)
	_recap_exemptions(chemins)
	_exporter(classement)
	# LA PHRASE QUE CE FICHIER DEVAIT SAVOIR DIRE. `issues` était calculé par constante et
	# personne ne l'additionnait : il a fallu greper la sortie à la main pour découvrir
	# qu'aucune perturbation ne changeait la fin d'aucune partie. C'est pourtant l'énoncé
	# le plus dur qu'on puisse produire ici — bien plus dur que « tel levier est branché ».
	#
	# ALERTE et pas verdict, pour la même raison que dans balance.gd : c'est un constat sur
	# l'ÉTAT DU JEU, pas sur l'intégrité du harnais, et la porte du jalon 0 ne juge que la
	# seconde. Elle devient un verdict au jalon 1, avec sim/produit.gd.
	print("")
	print("issues de campagne basculees, toutes constantes confondues : %d" % issues_total)
	if issues_total == 0:
		print("ALERTE aucune fin de partie ne change : sur %d constantes a +/-%.0f%%, les %d campagnes gardent toutes leur issue. Les constantes deplacent les CHIFFRES du jeu, pas ses ISSUES."
			% [chemins.size(), PERTURBATION * 100.0, n_graines * Bots.strategies().size()])
	if echecs.is_empty():
		print("LEVIER : %d constantes branchees, %d dormante(s) declaree(s) sur %d, canari mort"
			% [chemins.size() - DORMANTES.size(), DORMANTES.size(), chemins.size()])
		quit(0)
	else:
		for e: String in echecs:
			printerr("ECHEC : " + e)
		quit(1)


# --- le canari ----------------------------------------------------------------

func _canari(data: Dictionary, ref: Dictionary) -> bool:
	var avec: Dictionary = data.duplicate(true)
	(avec["constants"] as Dictionary)[CLE_CANARI] = 1.0
	var r: Dictionary = _mesurer(avec, ["constants", CLE_CANARI], 1.0, ref)
	if int(r["bouges"]) == 0:
		print("CANA  %-30s %-11s | %s" % [CLE_CANARI, "1.0", str(r["details"])])
		print("       ^ une constante que rien ne lit ne bouge rien : le comparateur sait dire non")
		return true
	print("RATE  %-30s %-11s | %s" % [CLE_CANARI, "1.0", str(r["details"])])
	echecs.append("le CANARI bouge (%d metriques) : le comparateur est bruite, et tout ce que ce fichier pourrait dire d'autre est sans valeur"
		% int(r["bouges"]))
	return false


# --- une constante ------------------------------------------------------------

func _eprouver(data: Dictionary, chemin: Array, ref: Dictionary) -> Dictionary:
	var nom: String = ".".join(PackedStringArray(chemin))
	var valeur: float = float(lire(data, chemin))
	var r: Dictionary = _mesurer(data, chemin, valeur, ref)
	var cle_dormante: String = _couvre(DORMANTES, nom)
	var cle_saturee: String = _couvre(SATUREES, nom)
	var dormante: bool = cle_dormante != "" or cle_saturee != ""
	var ok: bool = (int(r["bouges"]) > 0) != dormante
	var etat: String = "RATE "
	if ok:
		etat = ("SATU " if cle_saturee != "" else "DORM ") if dormante else "  OK "
	print("%s %-30s %-11s | %s" % [etat, nom, String.num(valeur, 4), str(r["details"])])
	if cle_saturee != "":
		print("       ^ %s" % str(SATUREES[cle_saturee]))
	elif cle_dormante != "":
		var d: Dictionary = DORMANTES[cle_dormante]
		print("       ^ dormante jusqu'au jalon %d : %s" % [int(d["jalon"]), str(d["pourquoi"])])
	if not ok:
		if cle_saturee != "":
			echecs.append("%s : declaree SATUREE mais elle bouge desormais — la borne a change, retire-la de SATUREES"
				% nom)
		elif dormante:
			# Le sens qui garde la liste honnête : le sous-systeme est arrive, la constante
			# mord, l'exemption n'a plus lieu d'etre.
			echecs.append("%s : declaree dormante jusqu'au jalon %d mais elle BOUGE desormais — retire-la de DORMANTES"
				% [nom, int(DORMANTES[cle_dormante]["jalon"])])
		else:
			echecs.append("%s = %s : levier DEBRANCHE, aucune metrique ne bouge a +/-%.0f%%"
				% [nom, String.num(valeur, 4), PERTURBATION * 100.0])
	var statut: String = "branchee"
	if dormante:
		statut = "dormante"
	elif int(r["bouges"]) == 0:
		statut = "DEBRANCHEE"
	return {"nom": nom, "valeur": valeur, "statut": statut, "amplitude": float(r["amplitude"]),
		"bouges": int(r["bouges"]), "issues": int(r["issues"]), "par_bot": r["par_bot"],
		"bouges_bot": r["bouges_bot"], "dormante": dormante}


# Les deux sens, agrégés sur le plus fort : une constante branchée dans un seul sens (un
# plafond qu'on ne peut que baisser, par exemple) est branchée.
func _mesurer(data: Dictionary, chemin: Array, valeur: float, ref: Dictionary) -> Dictionary:
	var base: Array = ref["campagnes"]
	var echelles: Array = ref["echelles"]
	var essais: Array = []
	if absf(valeur) < 1e-12:
		essais.append(["+%.0f abs." % DELTA_NUL, DELTA_NUL])
	elif is_equal_approx(valeur, floorf(valeur)) and absf(valeur) * PERTURBATION < 1.0:
		# ANGLE MORT DES ENTIERS : `complexite = 1` perturbee de ±30 % donne 1.3 et 0.7, que
		# le consommateur ramene a 1 par int()+clamp. Les deux essais etaient donc des
		# no-op, et la constante ressortait DEBRANCHEE alors qu'elle pilote une spec entiere.
		# Sous un ecart de 1, on perturbe donc d'un cran entier — la plus petite variation
		# qui existe reellement pour ce levier.
		essais.append(["+1 (entier)", valeur + 1.0])
		essais.append(["-1 (entier)", valeur - 1.0])
	else:
		essais.append(["+%.0f%%" % (PERTURBATION * 100.0), valeur * (1.0 + PERTURBATION)])
		essais.append(["-%.0f%%" % (PERTURBATION * 100.0), valeur * (1.0 - PERTURBATION)])
	var bouges: int = 0
	var issues: int = 0
	var amplitude: float = 0.0
	var par_bot: Array = []
	var bouges_bot: Array = []
	for j: int in range(Bots.strategies().size()):
		par_bot.append(0.0)
		bouges_bot.append(0)
	var details: PackedStringArray = []
	for essai: Array in essais:
		var perturbe: Dictionary = data.duplicate(true)
		ecrire(perturbe, chemin, float(essai[1]))
		var c: Dictionary = _comparer(base, _metriques(perturbe), echelles, METRIQUES.size(),
			true)
		var cs: Dictionary = _comparer(ref["specs"], _specs(perturbe),
			ref["echelles_specs"], SPECS.size())
		bouges = maxi(bouges, int(c["bouges"]) + int(cs["bouges"]))
		issues = maxi(issues, int(c["issues"]))
		amplitude = maxf(amplitude, maxf(float(c["amplitude"]), float(cs["amplitude"])))
		for j: int in range(par_bot.size()):
			par_bot[j] = maxf(float(par_bot[j]), float((c["par_bot"] as Array)[j]))
			bouges_bot[j] = maxi(int(bouges_bot[j]), int((c["bouges_bot"] as Array)[j]))
		details.append("%s %3d camp. + %d specs" % [str(essai[0]), int(c["bouges"]),
			int(cs["bouges"])])
	details.append("ampl. %s" % _pourcent(amplitude))
	if issues > 0:
		details.append("%d issue(s)" % issues)
	return {"bouges": bouges, "issues": issues, "amplitude": amplitude, "par_bot": par_bot,
		"bouges_bot": bouges_bot, "details": " | ".join(details)}


# --- métriques : UNE LIGNE PAR CAMPAGNE, jamais une somme ----------------------

# Sommer les campagnes serait le défaut classique : une constante qui enrichit un bot et
# appauvrit l'autre d'autant ne bougerait pas le total et sortirait « débranchée » alors
# qu'elle pilote les deux. On compare donc campagne par campagne — l'ordre (bots triés,
# puis graines croissantes) est fixe, sinon deux mesures ne sont pas comparables.
func _metriques(data: Dictionary) -> Array:
	var m: Array = []
	var strats: Dictionary = Bots.strategies()
	for nom: String in Etat.cles_triees(strats):
		# BOT SANS VARIANCE : ses N graines donnent la MEME campagne (balance.gd l'alerte
		# deja). Les simuler toutes revient a payer N fois le meme calcul — ~40 % du temps
		# de ce fichier. On en simule une et on la replique.
		#
		# CE QUE CA COUTE, dit franchement : si une perturbation RENDAIT ce bot variable, on
		# ne verrait le mouvement que sur la premiere graine. La porte tient quand meme
		# (elle demande « au moins une metrique bouge »), mais le compte `bouges` et
		# l'amplitude seraient sous-estimes pour ce bot. C'est un echange de precision
		# contre du temps, pas une approximation gratuite.
		var seules: bool = _sans_variance.has(nom)
		for graine: int in range(1, n_graines + 1):
			var r: Dictionary = Balance.campagne(1 if seules else graine, data, strats[nom])
			m.append(1.0 if Balance.perdue(r) else 0.0)
			m.append(float(r["fin_tick"]))
			m.append(float(r["cash_propre"]))
			m.append(float(r["cash_sale"]))
			m.append(float(r["visibilite"]))
			m.append(float(r["kg"]))
	return m


# Les sept specs de chaque produit de reference, dans l'ordre du fichier puis l'ordre de
# SPECS : deux mesures ne sont comparables que si leurs colonnes sont aux memes places.
func _specs(data: Dictionary) -> Array:
	var v: Array = []
	for r: Dictionary in data["calibration"]["references"]:
		var s: Dictionary = Produit.specs(r["recette"], data)
		for cle: String in SPECS:
			v.append(float(s[cle]))
	return v


# On le MESURE au lieu de le supposer : une graine contre une autre, sur la base.
func _detecter_variance(data: Dictionary) -> void:
	var strats: Dictionary = Bots.strategies()
	var figes: PackedStringArray = []
	for nom: String in Etat.cles_triees(strats):
		var a: Dictionary = Balance.campagne(1, data, strats[nom])
		var b: Dictionary = Balance.campagne(2, data, strats[nom])
		if str(a["fin"]) == str(b["fin"]) and is_equal_approx(float(a["cash_propre"]),
				float(b["cash_propre"])) and is_equal_approx(float(a["kg"]), float(b["kg"])):
			_sans_variance[nom] = true
			figes.append(nom)
	if not figes.is_empty():
		print("        %s : graines identiques sur la base, une seule sera simulee (%s)"
			% [" ".join(figes), "precision echangee contre du temps, voir _metriques"])


func _taille_vecteur() -> int:
	return n_graines * Bots.strategies().size() * METRIQUES.size()


# L'échelle d'une métrique, c'est sa moyenne absolue sur la base — pas sa valeur campagne
# par campagne. Sans ça, une visibilité qui passe de 0 à 5 pèserait « l'infini » et une
# trésorerie qui bouge de 200 000 $ pèserait 4 % : le classement de sensibilité ne dirait
# plus rien. Le plancher à 1.0 protège la division quand une colonne est nulle partout.
func _echelles(base: Array, n: int) -> Array:
	var echelles: Array = []
	for j: int in range(n):
		var somme: float = 0.0
		var compte: int = 0
		for i: int in range(j, base.size(), n):
			somme += absf(float(base[i]))
			compte += 1
		echelles.append(maxf(somme / maxf(float(compte), 1.0), 1.0))
	return echelles


# `ventiler` dit si le vecteur compare est RANGE PAR BOT. Il l'est pour les campagnes et il
# ne l'est pas pour les specs de reference, qui sont des produits du catalogue et
# n'appartiennent a personne. C'etait jusqu'ici une convention tacite — `par_bot` etait
# rempli dans les deux cas et le seul appelant savait n'en lire qu'un. Une valeur juste
# pour une raison que le code ne dit pas finit par etre lue par quelqu'un d'autre.
func _comparer(base: Array, autre: Array, echelles: Array, n: int,
		ventiler: bool = false) -> Dictionary:
	var par_campagne: int = n_graines * n
	var bouges: int = 0
	var issues: int = 0
	var amplitude: float = 0.0
	var par_bot: Array = []
	var bouges_bot: Array = []
	for j: int in range(Bots.strategies().size()):
		par_bot.append(0.0)
		bouges_bot.append(0)
	for i: int in range(base.size()):
		var x: float = float(base[i])
		var y: float = float(autre[i])
		var d: float = absf(x - y)
		if d <= maxf(1e-6, 1e-9 * maxf(absf(x), absf(y))):
			continue
		bouges += 1
		# Le vecteur est range par bot (tries) puis par graine : l'index dit donc de quel
		# profil vient le mouvement. Sans cette ventilation, le classement melange un
		# levier qui secoue le temoin prudent et un levier qui secoue l'industriel, alors
		# que ce ne sont pas les memes boutons ni les memes decisions.
		var bot: int = floori(float(i) / float(par_campagne)) if ventiler else -1
		# Le COMPTAGE inclut la colonne d'issue, que l'amplitude saute : une constante qui
		# ne ferait que basculer la fin d'une campagne aurait une amplitude nulle pour ce
		# bot et serait comptee « hors de portee » alors qu'elle decide de sa vie.
		if ventiler and bot >= 0 and bot < bouges_bot.size():
			bouges_bot[bot] = int(bouges_bot[bot]) + 1
		if i % n == 0:
			issues += 1
			continue
		var a: float = d / float(echelles[i % n])
		amplitude = maxf(amplitude, a)
		if ventiler and bot >= 0 and bot < par_bot.size():
			par_bot[bot] = maxf(float(par_bot[bot]), a)
	return {"bouges": bouges, "issues": issues, "amplitude": amplitude, "par_bot": par_bot,
		"bouges_bot": bouges_bot}


# --- le classement : la carte des boutons qui comptent -------------------------

# Le vrai livrable de ce fichier pour l'équilibrage. Savoir QU'UNE constante est branchée
# ne dit pas par où commencer ; savoir qu'elle pèse 300 % là où sa voisine pèse 2 %, si.
func _classement(classement: Array) -> void:
	classement.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return float(a["amplitude"]) > float(b["amplitude"]))
	print("")
	print("--- sensibilite : de combien chaque constante deplace le jeu a +/-%.0f%% ---"
		% (PERTURBATION * 100.0))
	var noms_bots: Array = Etat.cles_triees(Bots.strategies())
	for i: int in range(classement.size()):
		var c: Dictionary = classement[i]
		print("%3d. %-30s ampl. %-7s [%s] %3d/%d metriques%s"
			% [i + 1, str(c["nom"]), _pourcent(float(c["amplitude"])),
			_par_bot_texte(noms_bots, c["par_bot"]), int(c["bouges"]),
			_taille_vecteur(), "  [dormante]" if bool(c["dormante"]) else ""])


# --- la portee : qui SENT chaque levier ----------------------------------------

# LE REFUGE, deuxieme edition. La porte de ce fichier demande « au moins une metrique
# bouge » en mettant les bots en commun : une constante qui secoue un seul profil passe au
# vert, et l'autre profil joue a un jeu dont ce levier n'existe pas. J'avais ferme ce
# refuge sur la jauge de visibilite en changeant les bots ; il etait reste grand ouvert un
# etage plus haut, et la colonne `ampl_discret` de levier.csv affichait `0.000000` sur des
# dizaines de lignes d'affilee sans que rien ne la lise comme un constat.
#
# TROIS categories, et la distinction compte :
#   - levier de campagne     : il bouge les campagnes d'au moins un bot.
#   - hors de portee POUR X  : il en bouge au moins un, mais pas celles de X.
#   - specs seulement        : il ne bouge les campagnes de PERSONNE, seulement les specs
#                              des produits de reference. Ce n'est pas un angle mort des
#                              bots, c'est une constante de conception (§2) qu'aucune
#                              partie ne peut deplacer — la confondre avec un angle mort
#                              accuserait les bots d'une chose dont ils ne peuvent rien.
#
# MESURE ET PAS VERDICT, comme `issues` et comme la cause dominante de balance.gd : §16 dit
# « on ajoute la MESURE avant d'en faire une CONTRAINTE ». Un verdict pose aujourd'hui
# echouerait sur des dizaines de lignes, et la seule issue serait de deplacer le poteau
# dans la semaine. Il deviendra un verdict au jalon 2, quand on saura si le marche doit
# atteindre le profil prudent ou rester hors de sa portee par dessein.
func _portee(classement: Array) -> void:
	var noms_bots: Array = Etat.cles_triees(Bots.strategies())
	var atteints: Array = []
	for j: int in range(noms_bots.size()):
		atteints.append(0)
	var campagne: int = 0
	var specs_seules: int = 0
	for c: Dictionary in classement:
		if bool(c["dormante"]):
			continue
		var total: int = 0
		for j: int in range(noms_bots.size()):
			var b: int = int((c["bouges_bot"] as Array)[j])
			total += b
			if b > 0:
				atteints[j] = int(atteints[j]) + 1
		if total > 0:
			campagne += 1
		elif int(c["bouges"]) > 0:
			specs_seules += 1
	print("")
	print("--- portee : combien des %d leviers de campagne chaque profil peut SENTIR ---"
		% campagne)
	var pire: int = campagne
	for j: int in range(noms_bots.size()):
		var a: int = int(atteints[j])
		pire = mini(pire, a)
		print("  %-12s %3d sentis | %3d hors de portee (%.0f%%)"
			% [str(noms_bots[j]), a, campagne - a,
			100.0 * float(campagne - a) / maxf(float(campagne), 1.0)])
	print("  %-12s %3d constantes ne bougent que les specs de reference : conception (§2),"
		% ["(personne)", specs_seules])
	print("               aucune campagne ne les atteint, et ce n'est pas un angle mort.")
	if pire * 2 < campagne:
		print("ALERTE un profil ne sent que %d des %d leviers de campagne : pour lui, la majorite du jeu n'a pas de boutons. La porte est verte parce qu'elle met les bots en commun."
			% [pire, campagne])


# Une ligne par constante, sur le disque : de quoi voir, d'un commit a l'autre, qu'un
# levier a change de statut ou perdu les trois quarts de son amplitude. C'est le pendant du
# balance.csv, et c'est tests/comparer.gd qui lit les deux — sans lui, il faut que quelqu'un
# remarque la difference a l'oeil dans 23 lignes, ce qui revient a ne pas la remarquer.
func _exporter(classement: Array) -> void:
	var f: FileAccess = FileAccess.open(CHEMIN_CSV, FileAccess.WRITE)
	if f == null:
		print("(csv non ecrit : %s)" % error_string(FileAccess.get_open_error()))
		return
	var noms_bots: Array = Etat.cles_triees(Bots.strategies())
	var entete: PackedStringArray = ["constante", "valeur", "statut", "bouges", "metriques",
		"amplitude", "issues"]
	for nom_bot: String in noms_bots:
		entete.append("ampl_" + nom_bot)
	f.store_line(",".join(entete))
	for c: Dictionary in classement:
		var ligne: PackedStringArray = [str(c["nom"]), "%.6f" % float(c["valeur"]),
			str(c["statut"]), str(int(c["bouges"])), str(_taille_vecteur()),
			"%.6f" % float(c["amplitude"]), str(int(c["issues"]))]
		for j: int in range(noms_bots.size()):
			ligne.append("%.6f" % float((c["par_bot"] as Array)[j]))
		f.store_line(",".join(ligne))
	f.close()
	print("csv : %d lignes dans %s" % [classement.size(), CHEMIN_CSV])


func _par_bot_texte(noms_bots: Array, par_bot: Array) -> String:
	var morceaux: PackedStringArray = []
	for j: int in range(noms_bots.size()):
		morceaux.append("%s %s" % [str(noms_bots[j]), _pourcent(float(par_bot[j]))])
	return " | ".join(morceaux)


func _pourcent(v: float) -> String:
	if v > 9.99:
		return ">999%"
	# « 0 % » alors que des metriques bougent serait la pire ligne du rapport : elle dirait
	# « debranche » d'une constante branchee mais negligeable. Les deux cas sont distincts
	# et c'est tout l'interet de cette colonne.
	if v > 0.0 and v < 0.005:
		return "<1%"
	return "%.0f%%" % (v * 100.0)


# --- parcours de data/constants.json ------------------------------------------

# UN SEUL parcours de data/, et il est STATIQUE. perf.gd a besoin du cout de ce fichier ;
# le lui faire redeviner de son cote etait exactement la duplication qui rendait son budget
# faux. Une garde calculee par un fichier qui devine les boucles d'un autre n'est pas une
# garde, c'est une supposition versionnee.
#
# IL BALAIE TOUS LES FICHIERS DE DONNEES, pas seulement constants.json — decouvert en
# auditant les rivaux : `purete_plafond` valait 0.95, n'etait jamais approche en cinq ans
# de jeu, et RIEN ne le testait : seul constants.json etait balaye, alors que les trois
# quarts des nombres d'equilibrage vivent dans les autres fichiers. Le compte exact est
# imprime a chaque execution, il n'est pas recopie ici.
#
# `calibration.json` est le seul exclu, et pour une raison : ses nombres ne sont pas des
# leviers, ce sont des ASSERTIONS. Les perturber ne mesurerait rien — c'est run.gd qui les
# possede, et lui les compare aux formules.
const FICHIERS_EXCLUS: PackedStringArray = ["calibration"]

# `constants.json` ne contient QUE de l'equilibrage : un non-nombre y est une faute. Les
# autres fichiers melangent identifiants, noms et nombres — un `"famille": "verdal"` y est
# normal et se saute en silence.
const FICHIERS_STRICTS: PackedStringArray = ["constants"]


static func inventaire(data: Dictionary) -> Dictionary:
	var chemins: Array = []
	var problemes: Array = []
	for fichier: String in Etat.cles_triees(data):
		if FICHIERS_EXCLUS.has(fichier):
			continue
		_parcourir(data[fichier], [fichier], chemins, problemes,
			FICHIERS_STRICTS.has(fichier))
	return {"chemins": chemins, "problemes": problemes}


static func _parcourir(noeud: Variant, prefixe: Array, chemins: Array, problemes: Array,
		strict: bool) -> void:
	match typeof(noeud):
		TYPE_DICTIONARY:
			for cle: String in Etat.cles_triees(noeud):
				if cle.begins_with("_"):
					continue
				_parcourir((noeud as Dictionary)[cle], prefixe + [cle], chemins, problemes, strict)
		TYPE_ARRAY:
			# Les criteres de segments.json vivent dans un tableau : sans cette branche, un
			# quart du modele de marche restait invisible au levier.
			for k: int in range((noeud as Array).size()):
				_parcourir((noeud as Array)[k], prefixe + [str(k)], chemins, problemes, strict)
		TYPE_FLOAT, TYPE_INT:
			chemins.append(prefixe)
		_:
			if strict:
				problemes.append("%s : ni un nombre ni une section (%s)"
					% [".".join(PackedStringArray(prefixe)), type_string(typeof(noeud))])


# Le cout d'une execution complete, en campagnes-passes, calcule par CELUI QUI LE DEPENSE :
# la base, le canari (valeur non nulle, donc deux sens), puis chaque constante — un seul
# sens si elle est nulle (±30 % sur zero est un no-op), deux sinon.
static func passes(data: Dictionary) -> int:
	var chemins: Array = inventaire(data)["chemins"]
	var n: int = 1 + 2
	for chemin: Array in chemins:
		n += 1 if absf(float(lire(data, chemin))) < 1e-12 else 2
	return n


# Le premier element du chemin est le FICHIER. Les suivants sont des cles de dictionnaire
# ou des index de tableau, selon ce qu'on traverse.
static func lire(data: Dictionary, chemin: Array) -> Variant:
	var noeud: Variant = data
	for cle: String in chemin:
		noeud = (noeud as Array)[int(cle)] if typeof(noeud) == TYPE_ARRAY 			else (noeud as Dictionary)[cle]
	return noeud


static func ecrire(data: Dictionary, chemin: Array, valeur: float) -> void:
	var noeud: Variant = data
	for i: int in range(chemin.size() - 1):
		noeud = (noeud as Array)[int(chemin[i])] if typeof(noeud) == TYPE_ARRAY 			else (noeud as Dictionary)[str(chemin[i])]
	var derniere: String = str(chemin[chemin.size() - 1])
	if typeof(noeud) == TYPE_ARRAY:
		(noeud as Array)[int(derniere)] = valeur
	else:
		(noeud as Dictionary)[derniere] = valeur


# Une exemption dont la constante a été renommée ou supprimée resterait ici pour toujours :
# le mécanisme d'expiration de DORMANTES ne couvrait que le cas où la constante se met à
# mordre, pas celui où elle disparaît. Une liste de dérogations qui survit à son objet est
# la forme la plus discrète du poteau qu'on déplace pour passer.
# Une entree de DORMANTES couvre une constante OU un prefixe : `rivaux.maisons.le_traitre`
# endort les neuf nombres de l'emplacement reserve au traitre en une ligne, au lieu de neuf
# lignes qui diraient la meme chose. Une liste de derogations illisible ne se relit pas.
func _couvre(liste: Dictionary, nom: String) -> String:
	if liste.has(nom):
		return nom
	for cle: String in liste:
		if nom.begins_with(cle + "."):
			return cle
	return ""


# POINT 4 : un prefixe doit EXISTER, et on doit voir ce qu'il couvre. Une entree qui
# endort neuf constantes en une ligne est lisible ; elle devient un trou le jour ou
# quelqu'un ajoute une dixieme constante sous ce prefixe sans le decider. Le recapitulatif
# imprime la couverture, donc l'ajout se voit.
func _recap_exemptions(chemins: Array) -> void:
	var couverture: Dictionary = {}
	for liste: Dictionary in [DORMANTES, SATUREES]:
		for cle: String in liste:
			couverture[cle] = 0
	for chemin: Array in chemins:
		var nom: String = ".".join(PackedStringArray(chemin))
		for cle: String in couverture:
			if nom == cle or nom.begins_with(cle + "."):
				couverture[cle] = int(couverture[cle]) + 1
	print("")
	print("--- exemptions et ce qu'elles couvrent ---")
	for cle: String in Etat.cles_triees(couverture):
		var n: int = int(couverture[cle])
		var genre: String = "saturee" if SATUREES.has(cle) else ("dormante jusqu'au jalon %d"
			% int((DORMANTES[cle] as Dictionary)["jalon"]))
		# Le nombre annonce fait foi : s'il ne colle plus, quelqu'un a ajoute ou retire une
		# constante sous ce prefixe, et l'exemption couvre autre chose que ce qu'on a decide.
		var attendu: int = 1
		if DORMANTES.has(cle):
			attendu = int((DORMANTES[cle] as Dictionary).get("couvre", 1))
		var verdict: String = ""
		if n != attendu:
			verdict = "  <-- ANNONCE %d" % attendu
			echecs.append("%s endort %d constante(s) alors que son entree en annonce %d : ajoute, retire ou corrige `couvre`"
				% [cle, n, attendu])
		print("  %-42s %2d constante(s) | %s%s%s"
			% [cle, n, genre, "  [PREFIXE]" if n > 1 else "", verdict])


func _verifier_dormantes(chemins: Array) -> void:
	var connus: Dictionary = {}
	for chemin: Array in chemins:
		connus[".".join(PackedStringArray(chemin))] = true
	var toutes: Array = []
	for cle: String in DORMANTES:
		toutes.append(cle)
	for cle: String in SATUREES:
		toutes.append(cle)
	for nom: String in toutes:
		var couvre: bool = connus.has(nom)
		for c: String in connus:
			if c.begins_with(nom + "."):
				couvre = true
		if not couvre:
			echecs.append("DORMANTES contient %s, qui n'existe plus dans constants.json : entree orpheline a retirer"
				% nom)
		elif DORMANTES.has(nom) and int(DORMANTES[nom]["jalon"]) <= JALON_COURANT:
			echecs.append("DORMANTES : %s etait endormie jusqu'au jalon %d, on est au jalon %d — exemption PERIMEE, a retirer ou a rejustifier"
				% [nom, int(DORMANTES[nom]["jalon"]), JALON_COURANT])
