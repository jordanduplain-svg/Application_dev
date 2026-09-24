# Raison d'être : LA MÉMOIRE DU HARNAIS. Deux constantes ont été débranchées par un commit
# et c'est un humain qui l'a remarqué en relisant une sortie ; rien, dans la CI, ne savait
# dire « ce levier était branché hier ». Ce fichier lit deux mesures — balance.csv ou
# levier.csv, produites par deux exécutions — et dit ce qui a changé.
#
# Ce n'est PAS une baseline versionnée, et la distinction est celle que §16 pose : « la
# baseline se remesure, elle ne se cite pas depuis une note ancienne. » Ici on ne cite
# rien : on rejoue le harnais sur deux commits et on compare DEUX MESURES FRAÎCHES. Les
# .csv sont gitignorés pour que personne ne soit tenté d'en figer un.
#
# Ce n'est pas un TEST — aucun verdict, il sort en 0 (sauf si un fichier est illisible,
# auquel cas il n'a rien compare et le dit en 1) — mais il EST dans le smoke de la CI,
# comme trace.gd et balayage.gd : un outil que rien n'execute pourrit jusqu'au jour ou on
# l'ouvre, c'est-a-dire le jour ou on en a besoin.
#
# Cette ligne affirmait l'inverse pendant des mois ALORS QUE LA CI LE LANCE DEUX FOIS. La
# meme phrase avait ete corrigee dans balayage.gd sans que personne aille voir ses deux
# freres. tests/run.gd (_test_ci_contradiction) refuse desormais qu'un script lance par un
# workflow ecrive le contraire : c'est une contradiction lisible par une machine, elle ne
# doit pas dependre d'une relecture.
#
# Ce controle cherche une CHAINE LITTERALE, donc ce commentaire ne la recopie pas — sinon il
# se denoncerait lui-meme. C'est le prix d'un controle simple, et il est assume : un test qui
# crie faux se fait desactiver.
#
#   -s res://tests/comparer.gd -- <avant.csv> <apres.csv>
#
#   git stash && godot -s res://tests/levier.gd && cp levier.csv avant.csv
#   git stash pop && godot -s res://tests/levier.gd
#   godot -s res://tests/comparer.gd -- avant.csv levier.csv
#
# (Le chemin etait `/tmp/avant.csv` : ce projet se developpe sous Windows, ou /tmp n'existe
#  pas. Le mode d'emploi principal de l'outil etait faux la ou il est lu. `avant.csv` est
#  couvert par .gitignore au meme titre que les deux mesures.)
extends SceneTree

# Un mouvement se juge contre L'ECHELLE DE SA COLONNE, jamais contre sa propre valeur de
# depart. Sinon une amplitude de 0.0003 qui double (+70 %) passe devant un levier a 0.77 qui
# gagne 16 points — c'est exactement ce que ce fichier imprimait, et c'est la faute que
# levier.gd avait deja corrigee de son cote avec ses echelles par colonne. Reintroduite ici
# sans y penser, dans le fichier ecrit juste apres.
const SEUIL_ECHELLE: float = 0.01
const MAX_LIGNES: int = 20
# Les colonnes d'ENTREE : ce qu'on a change soi-meme. Elles sortent a part et en premier —
# la cause d'un ecart n'a rien a faire au milieu de ses quarante-huit effets, ou elle
# apparaissait 12e, entre deux consequences d'elle-meme.
const COLONNES_CAUSE: PackedStringArray = ["valeur"]


func _initialize() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	if args.size() < 2:
		printerr("usage : -s res://tests/comparer.gd -- <avant.csv> <apres.csv>")
		quit(1)
		return
	var avant: Dictionary = _lire(str(args[0]))
	var apres: Dictionary = _lire(str(args[1]))
	if avant.is_empty() or apres.is_empty():
		quit(1)
		return
	if str(avant["entete"]) != str(apres["entete"]):
		printerr("ces deux fichiers n'ont pas les memes colonnes : ce ne sont pas deux mesures du meme genre")
		printerr("  avant : " + str(avant["entete"]))
		printerr("  apres : " + str(apres["entete"]))
		quit(1)
		return
	print("=== %s -> %s ===" % [str(args[0]), str(args[1])])
	_comparer(avant, apres)
	quit(0)


# Le CSV, ses colonnes, et LA CLÉ : ce qui identifie la même chose dans les deux fichiers.
# `constante` pour une mesure de levier, `bot`+`graine` pour une mesure d'équilibrage — et
# à défaut la première colonne, pour qu'un futur csv se compare sans toucher ici.
func _lire(chemin: String) -> Dictionary:
	var f: FileAccess = FileAccess.open(chemin, FileAccess.READ)
	if f == null:
		printerr("illisible : %s (%s)" % [chemin, error_string(FileAccess.get_open_error())])
		return {}
	var entete: PackedStringArray = f.get_csv_line()
	if entete.size() < 2:
		printerr("pas un csv de mesure : %s" % chemin)
		return {}
	var cles: Array = []
	if entete.has("constante"):
		cles = ["constante"]
	elif entete.has("bot") and entete.has("graine"):
		cles = ["bot", "graine"]
	else:
		cles = [entete[0]]
	var lignes: Dictionary = {}
	while not f.eof_reached():
		var l: PackedStringArray = f.get_csv_line()
		if l.size() != entete.size():
			continue
		var ligne: Dictionary = {}
		for i: int in range(entete.size()):
			ligne[entete[i]] = l[i]
		var cle: PackedStringArray = []
		for c: String in cles:
			cle.append(str(ligne[c]))
		lignes["|".join(cle)] = ligne
	f.close()
	return {"entete": ",".join(entete), "colonnes": entete, "lignes": lignes, "cles": cles}


func _comparer(avant: Dictionary, apres: Dictionary) -> void:
	var l_avant: Dictionary = avant["lignes"]
	var l_apres: Dictionary = apres["lignes"]
	var communes: Array = []
	var ajoutees: Array = []
	for cle: String in l_apres:
		if l_avant.has(cle):
			communes.append(cle)
		else:
			ajoutees.append(cle)
	var retirees: Array = []
	for cle: String in l_avant:
		if not l_apres.has(cle):
			retirees.append(cle)
	communes.sort()
	ajoutees.sort()
	retirees.sort()
	print("  %d ligne(s) commune(s), %d ajoutee(s), %d retiree(s)"
		% [communes.size(), ajoutees.size(), retirees.size()])
	for cle: String in ajoutees:
		print("  + %s" % cle)
	for cle: String in retirees:
		print("  - %s" % cle)

	var echelles: Dictionary = _echelles(avant, apres)
	var causes: Array = []
	var textes: Array = []
	var nombres: Array = []
	for cle: String in communes:
		var a: Dictionary = l_avant[cle]
		var b: Dictionary = l_apres[cle]
		for col: String in avant["colonnes"]:
			if (avant["cles"] as Array).has(col):
				continue
			var va: String = str(a[col])
			var vb: String = str(b[col])
			if va == vb:
				continue
			if not va.is_valid_float() or not vb.is_valid_float():
				# Une fin de partie ou un statut de levier qui change : ça ne se mesure pas
				# en pourcentage, ça se LIT, et ça passe toujours avant les chiffres.
				textes.append("%s | %s : %s -> %s" % [cle, col, va, vb])
				continue
			var fa: float = va.to_float()
			var fb: float = vb.to_float()
			var texte: String = "%s | %s : %s -> %s (%s)" % [cle, col, String.num(fa, 4),
				String.num(fb, 4), _relatif(fa, fb)]
			if COLONNES_CAUSE.has(col):
				causes.append(texte)
				continue
			if not echelles.has(col):
				continue
			var poids: float = absf(fb - fa) / float(echelles[col])
			if poids < SEUIL_ECHELLE:
				continue
			nombres.append({"texte": texte, "poids": poids})

	if causes.is_empty() and textes.is_empty() and nombres.is_empty():
		print("  AUCUN changement au-dela de %.0f %% de l'echelle des colonnes : les deux mesures racontent la meme chose"
			% (SEUIL_ECHELLE * 100.0))
		return
	if not causes.is_empty():
		print("  CE QUI A CHANGE EN ENTREE (%d) — la cause, avant ses effets :" % causes.size())
		for t: String in causes:
			print("    %s" % t)
	if not textes.is_empty():
		print("  CHANGEMENTS D'ETAT (%d) — statut de levier, fin de partie :" % textes.size())
		for t: String in textes:
			print("    %s" % t)
	if nombres.is_empty():
		return
	nombres.sort_custom(func(x: Dictionary, y: Dictionary) -> bool:
		return float(x["poids"]) > float(y["poids"]))
	var montres: int = mini(MAX_LIGNES, nombres.size())
	var suffixe: String = "" if montres == nombres.size() else ", les %d plus gros" % montres
	print("  MOUVEMENTS (%d au-dela de %.0f %% de l'echelle de leur colonne%s) :"
		% [nombres.size(), SEUIL_ECHELLE * 100.0, suffixe])
	for i: int in range(montres):
		print("    %s" % str((nombres[i] as Dictionary)["texte"]))


# L'echelle d'une colonne : la moyenne de ses valeurs absolues SUR LES DEUX fichiers. Une
# colonne nulle des deux cotes ne peut pas bouger, donc son echelle ne sert jamais — le
# plancher n'est la que pour proteger la division.
func _echelles(avant: Dictionary, apres: Dictionary) -> Dictionary:
	var sommes: Dictionary = {}
	var comptes: Dictionary = {}
	for source: Dictionary in [avant, apres]:
		var lignes: Dictionary = source["lignes"]
		for cle: String in lignes:
			var ligne: Dictionary = lignes[cle]
			for col: String in source["colonnes"]:
				var v: String = str(ligne[col])
				if not v.is_valid_float():
					continue
				sommes[col] = float(sommes.get(col, 0.0)) + absf(v.to_float())
				comptes[col] = int(comptes.get(col, 0)) + 1
	var echelles: Dictionary = {}
	for col: String in sommes:
		echelles[col] = maxf(float(sommes[col]) / maxf(float(comptes[col]), 1.0), 1e-12)
	return echelles


# Le pourcentage reste imprime parce que c'est ce qu'un humain lit — il ne sert simplement
# plus a CLASSER. « Depuis zero » n'est pas un pourcentage : c'est une apparition.
func _relatif(fa: float, fb: float) -> String:
	if absf(fa) < 1e-9:
		return "depuis zero"
	return "%+.0f %%" % ((fb / fa - 1.0) * 100.0)
