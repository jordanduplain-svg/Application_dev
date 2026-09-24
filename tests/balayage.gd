# Raison d'être : balayer UNE constante sur N valeurs et imprimer les cibles de §16 pour
# chacune. L'equilibrage du jalon 1 a ete fait a la main, avec trois boucles shell jetables
# — et c'est comme ca qu'on cueille la valeur qui arrange au lieu de regarder la FORME.
#
# CE QU'IL MONTRE et qu'une valeur isolee cache : la FORME. Une falaise (tout bascule d'une
# ligne a l'autre) ne se regle pas — il manque au jeu une source de risque, pas un chiffre.
# Une pente se regle. Un plateau dit que la constante ne decide de rien dans cette plage.
#
# AUCUN CHIFFRE MESURE DANS CET EN-TETE, et c'est une regle du projet, apprise ici meme.
# Il en portait trois, avec un avertissement disant qu'ils perimeraient. Ils ont perime en
# deux passes — `k_volume` est passe de 0.012 a 0.28 et la falaise est sortie de la plage
# citee — et l'en-tete affirmait encore « la jauge ne tue jamais » sur une valeur ou elle
# tue la moitie des campagnes. L'avertissement n'avait servi a rien : personne ne relit un
# commentaire, et aucun test ne le lit.
#
# La regle qui en sort : **un commentaire garde le RAISONNEMENT et nomme la COMMANDE**.
# Le chiffre, lui, s'obtient en la lancant — c'est la seule version qui ne ment jamais.
#
# Il n'invente aucun seuil : il appelle Balance.resume() et Balance.verdicts(), les memes
# que le harnais. Un outil qui redecrit les cibles de son cote finit par juger autre chose.
#
# Ce n'est pas un TEST — il ne rend aucun verdict et sort toujours en 0 — mais il EST dans
# le smoke de la CI, comme trace.gd et comparer.gd : un outil que rien n'execute pourrit
# jusqu'au jour ou on l'ouvre, c'est-a-dire le jour ou on en a besoin.
#
#   -s res://tests/balayage.gd -- <constante> <min> <max> [pas] [graines]
#   -- visibilite.k_cash_sale 0.6 1.2 7
#   -- marche.plafond_prix 1.0 1.6 7 40
#   -- precurseurs.familles.noctal.seuil_famille 0.1 0.3 5
#
# Le chemin porte le nom du fichier (`constants.marche.inertie`), mais la forme courte est
# acceptee tant qu'elle ne designe qu'une seule constante.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Bots := preload("res://tests/bots.gd")
const Balance := preload("res://tests/balance.gd")
const Levier := preload("res://tests/levier.gd")

const GRAINES_DEFAUT: int = 20
const PAS_DEFAUT: int = 7


func _initialize() -> void:
	create_timer(900.0).timeout.connect(func() -> void:
		printerr("ECHEC : chien de garde balayage.gd")
		quit(1))
	var args: PackedStringArray = OS.get_cmdline_user_args()
	if args.size() < 3:
		printerr("usage : -s res://tests/balayage.gd -- <constante> <min> <max> [pas] [graines]")
		quit(1)
		return
	var nom: String = str(args[0])
	var bas: float = args[1].to_float()
	var haut: float = args[2].to_float()
	var pas: int = maxi(int(args[3]), 2) if args.size() > 3 and args[3].is_valid_int() \
		else PAS_DEFAUT
	var graines: int = maxi(int(args[4]), 1) if args.size() > 4 and args[4].is_valid_int() \
		else GRAINES_DEFAUT

	var data: Dictionary = Etat.charger_data()
	# Le levier balaie desormais TOUS les fichiers de data/, donc les chemins portent le nom
	# du fichier : `constants.marche.inertie`. On accepte quand meme la forme courte
	# (`marche.inertie`) en la resolvant — imposer le prefixe aurait casse toutes les
	# commandes ecrites jusqu'ici, y compris celle du smoke de la CI, pour rien.
	var chemin: Array = []
	var candidats: PackedStringArray = []
	for c: Array in Levier.inventaire(data)["chemins"]:
		var plein: String = ".".join(PackedStringArray(c))
		if plein == nom or plein.ends_with("." + nom):
			chemin = c
			candidats.append(plein)
	if chemin.is_empty():
		printerr("%s n'existe dans aucun fichier de data/" % nom)
		quit(1)
		return
	if candidats.size() > 1:
		printerr("%s est ambigu : %s" % [nom, " ".join(candidats)])
		quit(1)
		return
	nom = str(candidats[0])

	var noms: Array = Etat.cles_triees(Bots.strategies())
	print("balayage : %s de %s a %s en %d valeurs, %d graines x %d bots"
		% [nom, String.num(bas, 4), String.num(haut, 4), pas, graines, noms.size()])
	print("  valeur actuelle : %s" % String.num(float(Levier.lire(data, chemin)), 4))
	print("")
	print("%-10s | %-9s | %-9s | %-9s | %-8s | cibles"
		% ["valeur", "mortalite", "precoce", "victoires", "ecart"])
	# On n'imprime le DETAIL des cibles ratees que quand l'ensemble des echecs CHANGE d'une
	# ligne a l'autre : c'est la transition qui interesse, pas la repetition. Et ca exerce
	# le champ `texte` de Balance.verdicts(), qui n'etait lu par personne — il a dormi une
	# manche entiere avec un `%%%%` mal echappe dedans.
	var precedent: String = ""
	for i: int in range(pas):
		var v: float = bas + (haut - bas) * float(i) / float(pas - 1)
		precedent = _une_valeur(data, chemin, v, noms, graines, precedent)
	print("")
	print("Une FALAISE (tout passe d'un coup d'une ligne a l'autre) veut dire qu'il n'y a pas")
	print("de reglage a trouver : il manque au jeu une source de risque, pas un chiffre.")
	quit(0)


func _une_valeur(data: Dictionary, chemin: Array, v: float, noms: Array, graines: int,
		precedent: String) -> String:
	var d: Dictionary = data.duplicate(true)
	Levier.ecrire(d, chemin, v)
	var resultats: Dictionary = Balance.campagnes(d, noms, graines)
	var r: Dictionary = Balance.resume(noms, resultats, graines)
	var etats: PackedStringArray = []
	var rates: PackedStringArray = []
	for verdict: Dictionary in Balance.verdicts(r):
		etats.append(("%s+" if bool(verdict["ok"]) else "%s-") % str(verdict["cle"]))
		if not bool(verdict["ok"]):
			rates.append(str(verdict["texte"]))
	var ecart_txt: String = "n/a"
	if bool(r["mesurable"]):
		ecart_txt = "%+.0f%%" % (float(r["ecart"]) * 100.0)
	# La semaine de mort mediane dit ce que les taux cachent : deux valeurs qui tuent
	# toutes les deux 100 % ne racontent pas la meme partie si l'une tue en 15 semaines et
	# l'autre en 257.
	var morts: Array = []
	for nom: String in noms:
		for res: Dictionary in resultats[nom]:
			if Balance.perdue(res):
				morts.append(float(res["fin_tick"]))
	var mort_txt: String = "" if morts.is_empty() \
		else " | mort med. sem %.0f" % Balance.mediane(morts)
	print("%-10s | %8.0f%% | %8.0f%% | %8.0f%% | %8s | %s%s"
		% [String.num(v, 4), float(r["mortalite"]) * 100.0, float(r["precoce"]) * 100.0,
		float(r["victoires_max"]) * 100.0, ecart_txt, " ".join(etats), mort_txt])
	# L'AVERTISSEMENT passe AVANT le filtre de transition, et pas apres : je l'avais range
	# avec les details de cibles ratees, donc il se taisait des que la signature ne bougeait
	# plus — c'est-a-dire sur toutes les lignes ou il aurait servi. Un garde-fou conditionne
	# a un changement d'affichage n'est pas un garde-fou.
	for nom: String in r["jalon_douteux"]:
		print("           ^ ATTENTION : %s meurt en mediane semaine %.0f, AVANT la semaine de comparaison — l'ecart de richesse ne mesure plus ce qu'il annonce"
			% [nom, float(r["morts_medianes"][nom])])
	var signature: String = " ".join(etats)
	if signature != precedent:
		for texte: String in rates:
			print("           ^ %s" % texte)
	return signature
