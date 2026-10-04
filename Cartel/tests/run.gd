# Raison d'être : porte d'entrée unique des tests headless (godot --headless -s
# res://tests/run.gd) — données, déterminisme seedé, save/load, règle du papier, horloge de
# la dette, jauge de visibilité, campagnes bot. Porté de bureau-etudes/tests/run.gd : même
# structure, même chien de garde, même convention de verdict ; contenu réduit à ce qui
# EXISTE au jalon 0.
#
# La calibration ±5 % de §2 est arrivée avec sim/produit.gd, comme annoncé, et
# `_test_calibration` la vérifie sur les références de data/calibration.json. Ce commentaire
# a dit le contraire pendant tout un jalon — il décrivait une absence qui n'existait plus,
# dans le fichier même dont un test surveille les commandes périmées.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Bots := preload("res://tests/bots.gd")
const Produit := preload("res://sim/produit.gd")
const Levier := preload("res://tests/levier.gd")
const Marche := preload("res://sim/marche.gd")
const Recherche := preload("res://sim/recherche.gd")

var echecs: Array[String] = []


func _initialize() -> void:
	# Chien de garde : une erreur runtime avorte les tests avant quit() — sans lui le
	# process tourne pour toujours et l'erreur reste coincée dans le buffer stdout.
	create_timer(240.0).timeout.connect(func() -> void:
		printerr("ECHEC : chien de garde run.gd — erreur runtime dans les tests (voir ci-dessus)")
		quit(1))
	var data: Dictionary = Etat.charger_data()
	_test_donnees(data)
	_test_commandes_citees(data)
	_test_ci()
	_test_conception(data)
	_test_recherche(data)
	_test_recherche_comportement(data)
	_test_savoir(data)
	_test_calibration(data)
	_test_determinisme(data)
	_test_save_load(data)
	_test_regle_du_papier(data)
	_test_dette(data)
	_test_visibilite(data)
	_test_campagnes_bot(data)
	if echecs.is_empty():
		print("TOUS LES TESTS SONT VERTS")
		quit(0)
	else:
		for e: String in echecs:
			printerr("ECHEC : " + e)
		quit(1)


# --- 1. données : tout charge, tout est fini ----------------------------------

func _test_donnees(data: Dictionary) -> void:
	for cle: String in Etat.CHEMINS_DATA:
		if not data.has(cle) or data[cle] == null:
			echecs.append("data manquante ou illisible : " + cle)
			return
	var n: int = _verifier_nombres(data["constants"], "constants")
	_test_forme_state(data)
	_test_ordre_service(data)
	print("donnees      | %d fichier(s), %d constantes finies" % [Etat.CHEMINS_DATA.size(), n])


# LA FORME DU STATE, verifiee apres une campagne complete de chaque bot : ses cles doivent
# etre EXACTEMENT celles que `Etat.nouvelle_partie` declare, ni plus ni moins.
#
# Ce test existe parce que `tests/bots.gd` — une FIXTURE — avait pris l'habitude de ranger
# un memo (`cout_pose`) dans le state du jeu. §13 dit que `sim/` est le seul a y ecrire ; le
# champ partait dans la serialisation, donc dans les sauvegardes, et l'empreinte de
# determinisme le hachait. Rien ne l'a vu pendant toute une manche parce que rien ne
# regardait la FORME de l'etat, seulement ses valeurs.
#
# La garde vaut pour tous les repertoires, pas seulement pour les tests : le jour ou `game/`
# existera, un ecran qui memorise un repli d'interface dans le state se fera attraper ici.
func _test_forme_state(data: Dictionary) -> void:
	var attendues: Array = Etat.cles_triees(Etat.nouvelle_partie(1, data))
	for nom: String in Etat.cles_triees(Bots.strategies()):
		var etat: Dictionary = _campagne_avec(3, data, 40, Bots.strategies()[nom])
		var trouvees: Array = Etat.cles_triees(etat)
		for cle: String in trouvees:
			if not attendues.has(cle):
				echecs.append("le state a gagne la cle `%s` pendant une campagne de %s : quelqu'un d'autre que sim/ ecrit dans l'etat du jeu (§13), et ce champ part dans les sauvegardes"
					% [cle, nom])
		for cle2: String in attendues:
			if not trouvees.has(cle2):
				echecs.append("le state a PERDU la cle `%s` pendant une campagne de %s"
					% [cle2, nom])
	print("forme state  | %d cles, stables sur une campagne de chaque bot" % attendues.size())


# L'ordre de service des segments (§4) est une REGLE DE JEU : les trois puisent dans le
# meme stock et le joueur est limite par son stock a tous les trimestres mesures, donc le
# dernier servi mange la penurie. C'etait `sort()` sur les cles — l'alphabet, qui valait
# 54 000 $ et deux points de l'ecart de la cible 3 quand on l'inversait.
#
# Une LISTE ne se balaie pas a +/-30 % : ce test est ce qui remplace le levier pour elle.
# Il attrape le cas qui arrivera vraiment — un quatrieme segment ajoute a segments.json et
# oublie dans la liste, qui se ferait alors servir en dernier sans que personne l'ait
# decide, par le meme silence que l'alphabet d'avant.
func _test_ordre_service(data: Dictionary) -> void:
	var segs: Dictionary = data["segments"]["segments"]
	var liste: Array = (data["segments"] as Dictionary).get("ordre_service", [])
	var vus: Dictionary = {}
	for nom: Variant in liste:
		var s_nom: String = str(nom)
		if not segs.has(s_nom):
			echecs.append("data/segments.json:ordre_service nomme `%s`, qui n'est pas un segment"
				% s_nom)
		if vus.has(s_nom):
			echecs.append("data/segments.json:ordre_service nomme `%s` deux fois" % s_nom)
		vus[s_nom] = true
	for nom: String in Etat.cles_triees(segs):
		if not vus.has(nom):
			echecs.append("le segment `%s` est absent de data/segments.json:ordre_service — il serait servi en dernier sans que personne l'ait decide"
				% nom)
	print("ordre marche | %d segments, servis dans l'ordre declare : %s"
		% [segs.size(), " > ".join(PackedStringArray(Marche.ordre_service(data)))])


func _verifier_nombres(d: Dictionary, chemin: String) -> int:
	var n: int = 0
	for cle: String in Etat.cles_triees(d):
		if cle.begins_with("_"):
			continue
		var v: Variant = d[cle]
		match typeof(v):
			TYPE_DICTIONARY:
				n += _verifier_nombres(v, chemin + "." + cle)
			TYPE_FLOAT, TYPE_INT:
				if is_nan(float(v)) or is_inf(float(v)):
					echecs.append("constante non finie : %s.%s" % [chemin, cle])
				n += 1
			_:
				echecs.append("constante qui n'est pas un nombre : %s.%s" % [chemin, cle])
	return n


# --- 1ter. les commandes citées dans les commentaires résolvent -----------------

# LA MOITIÉ DE TROU QUE J'AVAIS DÉCLARÉE INFERMABLE. La règle du projet est qu'un
# commentaire garde le raisonnement et NOMME LA COMMANDE qui régénère le chiffre, plutôt
# que de citer un résultat qui périme. J'en avais conclu que rien ne pouvait la vérifier —
# c'est vrai d'un chiffre périmé, c'est faux d'un chemin de constante.
#
# Ce test extrait tous les `balayage.gd -- <chemin>` des sources et des données, et vérifie
# que chaque chemin existe. Il n'attrape pas un chiffre qui a vieilli ; il attrape le
# renommage et la suppression, qui sont le cas le plus fréquent et le plus silencieux —
# une commande citée qui ne marche plus est pire qu'un chiffre faux, parce qu'elle promet
# au lecteur un moyen de vérifier et le lui refuse.
func _test_commandes_citees(data: Dictionary) -> void:
	var connus: Dictionary = {}
	for chemin: Array in Levier.inventaire(data)["chemins"]:
		connus[".".join(PackedStringArray(chemin))] = true
	var bots: Dictionary = Bots.strategies()
	# Un script cite dans un `res://...` : il doit exister. C'est la verification qui couvre
	# outils/cartel.bat et la CI, c'est-a-dire les seules lignes de commande que QUELQU'UN
	# LANCE vraiment. Un menu qui propose une option morte est pire qu'un commentaire faux.
	var re_res: RegEx = RegEx.new()
	re_res.compile("res://([a-z_.]+/[a-z_]+\\.gd)")
	# QUEL OUTIL parle. Le contexte est necessaire parce que les exemples des en-tetes sont
	# des lignes `--` NUES : `#   -- 7 discret 13 blanchiment.capacite_sem 0.7` ne contient
	# pas le mot `trace.gd`, il suit la ligne d'usage qui, elle, le nomme. Ma premiere
	# version cherchait `trace.gd --` sur la meme ligne et ne voyait donc AUCUN des exemples
	# des deux en-tetes — c'est-a-dire tout ce qu'elle pretendait couvrir.
	var re_outil: RegEx = RegEx.new()
	re_outil.compile("([a-z_]+)\\.gd")
	# `--` SUIVI D'UNE ESPACE : `--headless` et `--path` du .bat n'en sont pas.
	var re_args: RegEx = RegEx.new()
	re_args.compile("(?:^|\\s)--\\s+(\\S.*)$")
	var n: int = 0
	# Les casses se comptent sur la TAILLE de `echecs` avant/apres, pas en relisant les
	# messages : la premiere version recomptait en cherchant des sous-chaines dans les
	# textes d'echec, ce qui aurait donne un chiffre faux le jour ou quelqu'un reformule un
	# message — un compteur qui devine son propre resultat.
	var avant: int = echecs.size()
	var sources: PackedStringArray = _sources()
	for fichier: String in sources:
		var outil: String = ""
		for ligne: String in FileAccess.get_file_as_string(fichier).split("\n"):
			for m: RegExMatch in re_res.search_all(ligne):
				n += 1
				if not FileAccess.file_exists("res://" + m.get_string(1)):
					echecs.append("%s lance `res://%s`, qui n'existe pas"
						% [fichier, m.get_string(1)])
			var nomme: String = ""
			var mo: RegExMatch = re_outil.search(ligne)
			if mo != null:
				var g: String = mo.get_string(1)
				nomme = g if g == "balayage" or g == "trace" else ""
				outil = nomme
			var ma: RegExMatch = re_args.search(ligne)
			if ma == null:
				continue
			var nu: String = ligne.strip_edges()
			if nu.begins_with("#"):
				nu = nu.substr(1).strip_edges()
			# Le contexte ne sert qu'aux lignes qui SONT des exemples : `--` en tete une fois le
			# `#` retire. Sans cette seconde regle, `comparer.gd -- levier.csv` dans la CI et
			# `levier.gd -- 12` dans un commentaire se faisaient lire comme des commandes de trace
			# et de balayage, et le test criait sur trois lignes saines. Un test qui crie faux se
			# fait desactiver : il est pire qu'absent.
			if nomme == "" and not (nu.begins_with("--") and outil != ""):
				continue
			var args: PackedStringArray = ma.get_string(1).split(" ", false)
			# balayage : <constante> en 1er. trace : <bot> en 2e, <constante> en 4e.
			if outil == "balayage":
				n += _verifier_constante(fichier, args, 0, connus)
			else:
				n += _verifier_bot(fichier, args, 1, bots)
				n += _verifier_constante(fichier, args, 3, connus)
	var casses: int = echecs.size() - avant
	if casses > 0:
		print("commandes    | %d citees, %d CASSEE(S)" % [n, casses])
	else:
		print("commandes    | %d citees dans %d fichiers, toutes resolues" % [n, sources.size()])


# Les jokers d'une ligne d'usage (`<constante>`, `[graines]`) ne sont pas des valeurs : ils
# decrivent la commande au lieu de l'illustrer, et les verifier n'aurait aucun sens.
func _joker(a: String) -> bool:
	return a.begins_with("<") or a.begins_with("[") or a.begins_with("&")


func _verifier_constante(fichier: String, args: PackedStringArray, i: int,
		connus: Dictionary) -> int:
	if args.size() <= i or _joker(args[i]) or args[i].find(".") == -1:
		return 0
	var cite: String = args[i]
	# La forme courte (`marche.inertie`) est acceptee par balayage.gd, donc ici aussi.
	var trouve: bool = connus.has(cite)
	for c: String in connus:
		if c.ends_with("." + cite):
			trouve = true
	if not trouve:
		echecs.append("%s cite la constante `%s`, qui ne resout vers aucune constante"
			% [fichier, cite])
	return 1


func _verifier_bot(fichier: String, args: PackedStringArray, i: int,
		bots: Dictionary) -> int:
	if args.size() <= i or _joker(args[i]):
		return 0
	var bot: String = args[i]
	if bot != "tous" and not bots.has(bot):
		echecs.append("%s trace le bot `%s`, qui n'est pas dans Bots.strategies()"
			% [fichier, bot])
	return 1


# --- 1quinquies. la CI se surveille elle-meme ---------------------------------

# DEUX TROUS, ET LES DEUX SONT DU MEME GENRE : un fichier de configuration que personne ne
# relit, et rien qui le confronte au reste du depot.
#
#   1. UNE DEROGATION DATEE HORS DU MECANISME. `ci.yml` portait un `continue-on-error` avec
#      « a retirer au jalon 1, en meme temps que sim/produit.gd ». produit.gd existait
#      depuis longtemps : l'echeance etait depassee d'un jalon entier et rien ne le disait.
#      `tests/levier.gd` a exactement ce mecanisme pour ses dormantes — la seule derogation
#      qui vivait DEHORS n'en beneficiait pas. Elle porte desormais `jalon: N` et se fait
#      verifier ici contre `Levier.JALON_COURANT`, par le meme test que les autres.
#
#   2. UN TEST QUE RIEN NE LANCE. Ajouter `tests/nouveau.gd`, avec ses verdicts durs et son
#      `quit(1)` bien ecrit, et l'oublier dans ci.yml : il est vert pour toujours. C'est la
#      forme la plus silencieuse de test mort — pire qu'un test casse, qui au moins crie.
#      Tout ce qui etend SceneTree dans tests/ doit donc apparaitre dans le workflow.
const WORKFLOWS: String = "res://.github/workflows"


func _test_ci() -> void:
	var d: DirAccess = DirAccess.open(WORKFLOWS)
	if d == null:
		echecs.append("%s ne s'ouvre pas : la CI n'est plus surveillee" % WORKFLOWS)
		return
	var texte: String = ""
	for f: String in d.get_files():
		if f.ends_with(".yml") or f.ends_with(".yaml"):
			texte += FileAccess.get_file_as_string(WORKFLOWS + "/" + f)
	var re: RegEx = RegEx.new()
	re.compile("DEROGATION DATEE.*?jalon:\\s*([0-9]+)")
	var derogations: int = 0
	for m: RegExMatch in re.search_all(texte):
		derogations += 1
		var jalon: int = int(m.get_string(1))
		if jalon <= Levier.JALON_COURANT:
			echecs.append("ci.yml : une DEROGATION DATEE annonce le jalon %d, on est au jalon %d — perimee, a retirer ou a rejustifier"
				% [jalon, Levier.JALON_COURANT])
	var scripts: DirAccess = DirAccess.open("res://tests")
	var absents: PackedStringArray = []
	var couverts: int = 0
	for f2: String in scripts.get_files():
		if not f2.ends_with(".gd"):
			continue
		if not FileAccess.get_file_as_string("res://tests/" + f2).contains("extends SceneTree"):
			continue
		if texte.contains("res://tests/" + f2):
			couverts += 1
		else:
			absents.append(f2)
	for f3: String in absents:
		echecs.append("tests/%s rend des verdicts (il etend SceneTree) mais n'apparait dans aucun workflow : rien ne le lance, donc il est vert pour toujours"
			% f3)
	print("ci           | %d script(s) a verdict couvert(s), %d derogation(s) datee(s) encore valide(s)"
		% [couverts, derogations])
	_test_ci_contradiction(texte)



# LE SENS INVERSE : un script que la CI LANCE n'a pas le droit d'ecrire qu'elle ne le lance
# pas. `trace.gd` et `comparer.gd` l'ont affirme pendant des mois pendant que le workflow les
# executait deux fois chacun — et la phrase avait ete corrigee dans `balayage.gd`, leur
# troisieme frere, sans que personne aille voir les deux autres.
#
# C'est une contradiction entre deux fichiers du meme depot, donc lisible par une machine.
# Tant qu'elle dependait d'une relecture, elle a survecu a douze passes de critique.
func _test_ci_contradiction(workflows: String) -> void:
	var d: DirAccess = DirAccess.open("res://tests")
	for f: String in d.get_files():
		if not f.ends_with(".gd") or not workflows.contains("res://tests/" + f):
			continue
		for ligne: String in FileAccess.get_file_as_string("res://tests/" + f).split("\n"):
			if not ligne.begins_with("#"):
				continue
			if ligne.to_lower().contains("pas dans la ci"):
				echecs.append("tests/%s ecrit « %s » alors qu'un workflow le lance : la CI et le commentaire se contredisent"
					% [f, ligne.strip_edges()])


# Les dossiers fouilles. `outils/` et `.github/` en font partie depuis que le test regarde
# les commandes qu'on LANCE et plus seulement celles qu'on cite : le .bat est le fichier
# que l'on clique, et la CI est le seul lecteur qui ne pardonne rien.
#
# Un dossier declare mais introuvable ECHOUE au lieu d'etre saute en silence. Sauter aurait
# ete la pire issue possible : le test resterait vert en ayant cesse de regarder, ce qui est
# exactement le pourrissement qu'il existe pour attraper.
const DOSSIERS: Array[String] = ["res://sim", "res://tests", "res://data", "res://outils",
	"res://.github/workflows"]
const EXTENSIONS: Array[String] = [".gd", ".json", ".bat", ".yml"]


func _sources() -> PackedStringArray:
	var liste: PackedStringArray = []
	for dossier: String in DOSSIERS:
		var d: DirAccess = DirAccess.open(dossier)
		if d == null:
			echecs.append("%s est declare dans run.gd:DOSSIERS mais ne s'ouvre pas : le test des commandes a cesse de le regarder"
				% dossier)
			continue
		for f: String in d.get_files():
			for ext: String in EXTENSIONS:
				if f.ends_with(ext):
					liste.append(dossier + "/" + f)
					break
	return liste


# --- 1ter bis. l'espace de conception (§2) -----------------------------------

# LE PENDANT DU LEVIER, UN ETAGE PLUS HAUT. `levier.gd` garde les CONSTANTES : il les
# perturbe et demande « est-ce que ca bouge ? ». Ce test garde les CHOIX : il parcourt
# l'espace des six parametres de §2 et demande « ce curseur a-t-il une position dominante ? ».
#
# LA QUESTION QUE PERSONNE NE POSAIT. Un parametre dont une extremite est toujours la bonne
# n'est pas un arbitrage, c'est une reponse : le joueur l'apprend une fois et n'y revient
# jamais. Mesure du jour ou ce test est ne — `complexite` degradait QUATRE specs et n'en
# ameliorait aucune, `rendement` en ameliorait deux et n'en degradait aucune. Deux des six
# curseurs de l'ecran de conception n'avaient qu'une bonne position, et rien ne pouvait le
# voir : les constantes qui les portent bougent toutes des metriques, donc le levier les
# declarait vertes — a juste titre.
#
# LES SEPT DIRECTIONS sont celles de §2 et ne sont pas negociables : le cout et la signature
# se veulent BAS, le debit, la regularite, la puissance et la dependance se veulent HAUTS,
# `instabilite_neuro` se veut BASSE. Aucune fonction de score n'est inventee ici — c'est ce
# qui rend le verdict solide : on ne demande pas si un reglage est BON, on demande s'il
# existe une raison de bouger le curseur.
# LE SEUIL DE L'ARBITRAGE — et il n'est pas invente : c'est celui que comparer.gd utilise
# deja pour « un mouvement qui compte », 1 % de l'echelle de la colonne. La premiere version
# de ce test exigeait un gain > 1e-9 : elle attrapait un zero EXACT, et laissait passer un
# terme SYMBOLIQUE. Mesure : `k_variance_rendement` divise par 2500 (0.25 -> 0.0001) et le
# test restait vert, alors que baisser le rendement ne gagnait plus que 0.01 % de l'etendue
# de la regularite. Or c'est la regression realiste — quelqu'un qui baisse un coefficient pour
# regler un probleme d'equilibrage. Le seuil est pose APRES la mesure : la contrepartie la
# plus mince du jeu (baisser la stabilisation, qui ne fait qu'economiser) est a ~3 %, le terme
# symbolique a 0.01 % — deux ordres de grandeur d'ecart, et le seuil passe entre les deux.
const SEUIL_ARBITRAGE: float = 0.01
const DIRECTIONS: Dictionary = {
	"cout_unitaire": -1.0, "signature": -1.0, "instabilite_neuro": -1.0,
	"debit_kg_sem": 1.0, "regularite_lot": 1.0, "puissance": 1.0, "dependance": 1.0,
}


func _test_conception(data: Dictionary) -> void:
	var avant: int = echecs.size()
	var familles: Array = Etat.cles_triees(data["precurseurs"]["familles"])
	var axes: Dictionary = {
		"purete": [0.30, 0.50, 0.70, 0.85, 0.99],
		"rendement": [0.20, 0.45, 0.70, 0.95],
		"complexite": [1.0, 2.0, 3.0, 4.0, 5.0],
		"coupe": [0.0, 0.25, 0.45, 0.70],
		"stabilisation": [0.0, 1.0, 2.0, 3.0],
		"marquage": [0.0, 1.0, 2.0],
	}
	var contextes: Array = _contextes(familles, axes)
	var morts: PackedStringArray = []
	# L'ECHELLE DE CHAQUE SPEC, prise sur tout l'echantillon : un gain se juge contre l'etendue
	# de sa colonne, jamais contre sa propre valeur de depart (une instabilite qui passe de
	# 0.001 a 0 « gagnerait » 100 %). C'est la convention de comparer.gd et de levier.gd.
	var bas_spec: Dictionary = {}
	var haut_spec: Dictionary = {}
	for ctx0: Dictionary in contextes:
		var s0: Dictionary = Produit.specs(ctx0, data)
		for sp: String in DIRECTIONS:
			bas_spec[sp] = minf(float(bas_spec.get(sp, 1e30)), float(s0[sp]))
			haut_spec[sp] = maxf(float(haut_spec.get(sp, -1e30)), float(s0[sp]))
	var plus_faible: float = 1e30
	var ou_faible: String = ""
	for axe: String in Etat.cles_triees(axes):
		var valeurs: Array = axes[axe]
		# Deux sens, mesures separement : le MEILLEUR gain qu'on obtient en montant le curseur,
		# et le meilleur en le baissant, sur toutes les specs et tous les contextes.
		var gain_haut: float = 0.0
		var gain_bas: float = 0.0
		for ctx: Dictionary in contextes:
			for i: int in range(valeurs.size() - 1):
				var bas: Dictionary = ctx.duplicate()
				bas[axe] = valeurs[i]
				var haut: Dictionary = ctx.duplicate()
				haut[axe] = valeurs[i + 1]
				var sb: Dictionary = Produit.specs(bas, data)
				var sh: Dictionary = Produit.specs(haut, data)
				for spec: String in DIRECTIONS:
					var etendue: float = maxf(float(haut_spec[spec]) - float(bas_spec[spec]), 1e-9)
					var g: float = (float(sh[spec]) - float(sb[spec])) * float(DIRECTIONS[spec]) / etendue
					gain_haut = maxf(gain_haut, g)
					gain_bas = maxf(gain_bas, -g)
		for sens: String in ["monter", "baisser"]:
			var g2: float = gain_haut if sens == "monter" else gain_bas
			if g2 < plus_faible:
				plus_faible = g2
				ou_faible = "%s `%s`" % [sens, axe]
			if g2 < SEUIL_ARBITRAGE:
				echecs.append("§2 : %s `%s` n'ameliore aucune spec de plus de %.2f%% de son etendue (seuil %.0f%%) — la contrepartie existe peut-etre, mais elle est symbolique : ce curseur n'a qu'une bonne position"
					% [sens, axe, maxf(g2, 0.0) * 100.0, SEUIL_ARBITRAGE * 100.0])
	_test_familles(data, familles, contextes, morts)
	# LES TROIS CHOIX A OPTIONS (data/conception.json) : meme question que les familles —
	# aucune option ne doit etre dominee par une autre sur les sept specs dans tous les
	# contextes, sinon c'est un choix que personne n'a de raison de faire.
	for groupe: Array in [["forme", "formes"], ["agent", "agents"], ["cadence", "cadences"]]:
		_test_options(data, str(groupe[0]),
			Etat.cles_triees(data["conception"][str(groupe[1])]["options"]), contextes)
	# Le compte se prend sur la TAILLE de `echecs`, avec `avant` capture EN TETE de la
	# fonction. La version precedente le capturait apres la boucle des axes, puis rattrapait
	# les echecs manques en relisant les messages par prefixe (`_compte_axes`) — l'anti-pattern
	# exact que ce fichier documente plus haut, reintroduit 260 lignes plus bas. Le contourner
	# au lieu de deplacer une ligne : c'est ainsi que les lecons ecrites reviennent.
	var casses: int = echecs.size() - avant
	if casses > 0:
		print("conception   | %d contextes x %d axes : %d CURSEUR(S) SANS ARBITRAGE"
			% [contextes.size(), axes.size(), casses])
	else:
		print("conception   | %d contextes x %d axes, %d familles : aucun curseur sans arbitrage — le plus mince : %s, %.1f%% (seuil %.0f%%)"
			% [contextes.size(), axes.size(), familles.size(), ou_faible, plus_faible * 100.0,
			SEUIL_ARBITRAGE * 100.0])



# Les familles ne s'ordonnent pas : une famille est morte si une AUTRE fait aussi bien ou
# mieux sur les sept specs a la fois, dans tous les contextes. Elle serait alors un choix
# que personne n'a de raison de faire — meme defaut, autre forme.
func _test_familles(data: Dictionary, familles: Array, contextes: Array,
		morts: PackedStringArray) -> void:
	for a: String in familles:
		for b: String in familles:
			if a == b:
				continue
			var domine: bool = true
			for ctx: Dictionary in contextes:
				var ca: Dictionary = ctx.duplicate()
				ca["famille"] = a
				var cb: Dictionary = ctx.duplicate()
				cb["famille"] = b
				var sa: Dictionary = Produit.specs(ca, data)
				var sbb: Dictionary = Produit.specs(cb, data)
				for spec: String in DIRECTIONS:
					if (float(sbb[spec]) - float(sa[spec])) * float(DIRECTIONS[spec]) < -1e-9:
						domine = false
						break
				if not domine:
					break
			if domine:
				morts.append(a)
				echecs.append("§2 : la famille `%s` est dominee par `%s` sur les sept specs et dans tous les contextes : personne n'a de raison de la choisir"
					% [a, b])


func _test_options(data: Dictionary, cle: String, options: Array, contextes: Array) -> void:
	for a: String in options:
		for b: String in options:
			if a == b:
				continue
			var domine: bool = true
			for ctx: Dictionary in contextes:
				var ca: Dictionary = ctx.duplicate()
				ca[cle] = a
				var cb: Dictionary = ctx.duplicate()
				cb[cle] = b
				var sa: Dictionary = Produit.specs(ca, data)
				var sbb: Dictionary = Produit.specs(cb, data)
				for spec: String in DIRECTIONS:
					if (float(sbb[spec]) - float(sa[spec])) * float(DIRECTIONS[spec]) < -1e-9:
						domine = false
						break
				if not domine:
					break
			if domine:
				echecs.append("§2 : l'option `%s` de `%s` est dominee par `%s` sur les sept specs et dans tous les contextes : personne n'a de raison de la choisir"
					% [a, cle, b])


# Un echantillon de recettes completes, une par combinaison des AUTRES axes. On ne teste pas
# la grille entiere : on teste qu'un axe garde une raison d'etre bouge DANS DES CONTEXTES
# VARIES, ce qui est la question.
func _contextes(familles: Array, axes: Dictionary) -> Array:
	var liste: Array = []
	for fam: String in familles:
		for pu: float in [0.40, 0.75, 0.99]:
			for re: float in [0.30, 0.60, 0.95]:
				for co: int in [1, 3, 5]:
					for cp: float in [0.0, 0.35, 0.70]:
						for st: int in [0, 1, 3]:
							liste.append({"famille": fam, "purete": pu, "rendement": re,
								"complexite": co, "coupe": cp, "stabilisation": st})
	return liste


# --- 1quater. la recherche (§2bis) ------------------------------------------

# CE QUE CE TEST GARDE, et ce n'est pas l'arithmetique de sim/recherche.gd : ce sont les
# TROIS PROMESSES de §2bis, dont aucune ne se casse dans le code. Elles se cassent toutes
# les trois dans une ligne de data/procedes.json, en silence, et aucune cible ne le verrait.
#
#   1. « aucun bonus numerique direct » — la liste de ce qu'une case peut ouvrir est FERMEE.
#      Une cle `rendement_bonus` ajoutee un soir et la recherche cesse d'ouvrir des choix
#      pour distribuer des points. C'est la promesse la plus facile a trahir du document.
#   2. « une partie entiere est jouable sans rien rechercher » — le kit de depart doit
#      produire une recette qui SORT des kilos. Un plafond de purete mal pose et le jeu
#      devient injouable au tick 0, ce qu'aucun bot ne dirait puisqu'ils meurent tous.
#   3. la grille est UNE grille — cases lisibles, distinctes, hors du centre, et toutes
#      atteignables depuis le centre de proche en proche. Une case isolee ne plante pas :
#      elle reste invisible pour toujours, comme un cycle dans l'ancien arbre.
func _test_recherche(data: Dictionary) -> void:
	var noeuds: Dictionary = data["procedes"]["noeuds"]
	var familles: Dictionary = data["precurseurs"]["familles"]
	var centre: String = str(data["procedes"]["centre"])
	var occupees: Dictionary = {}
	for id: String in Etat.cles_triees(noeuds):
		var n: Dictionary = noeuds[id]
		if (n["ouvre"] as Dictionary).is_empty():
			echecs.append("la case `%s` n'ouvre rien" % id)
		for cle: String in (n["ouvre"] as Dictionary):
			if not Recherche.OUVERTURES.has(cle):
				echecs.append("la case `%s` ouvre `%s`, qui n'est pas dans la liste fermee de §2bis — la recherche donnerait un bonus numerique au lieu d'ouvrir un choix"
					% [id, cle])
			if cle == "famille" and not familles.has(str(n["ouvre"][cle])):
				echecs.append("la case `%s` ouvre la famille `%s`, absente de precurseurs.json"
					% [id, str(n["ouvre"][cle])])
			var groupe: String = {"forme": "formes", "agent": "agents",
				"cadence": "cadences"}.get(cle, "")
			if groupe != "" and not (data["conception"][groupe]["options"] as Dictionary) \
					.has(str(n["ouvre"][cle])):
				echecs.append("la case `%s` ouvre l'option `%s` de `%s`, absente de conception.json"
					% [id, str(n["ouvre"][cle]), groupe])
		var texte: String = str(n.get("case", ""))
		var morceaux: PackedStringArray = texte.split(",")
		if morceaux.size() != 2 or not morceaux[0].is_valid_int() \
				or not morceaux[1].is_valid_int():
			echecs.append("la case `%s` a une coordonnee illisible (`%s`) : attendu `q,r`"
				% [id, texte])
			continue
		var cle_case: String = "%d,%d" % [int(morceaux[0]), int(morceaux[1])]
		if cle_case == centre:
			echecs.append("la case `%s` est posee sur le centre de la grille" % id)
		if occupees.has(cle_case):
			echecs.append("les cases `%s` et `%s` occupent le meme hexagone %s"
				% [str(occupees[cle_case]), id, cle_case])
		occupees[cle_case] = id
		var bras_c: String = str(n.get("bras", ""))
		var bras_ok: Dictionary = data["procedes"]["savoir"]["bras"]
		if bras_c.begins_with("_") or not bras_ok.has(bras_c):
			echecs.append("la case `%s` appartient au bras `%s`, absent de procedes.savoir.bras" % [id, bras_c])
		if float(n.get("cout_savoir", -1.0)) < 0.0:
			echecs.append("la case `%s` n'a pas de `cout_savoir` valide" % id)
	# LA CONNEXITE, verifiee sur le code du jeu et pas recalculee ici : on prend tout ce
	# qui est disponible, sans regarder l'argent, jusqu'a ce que plus rien ne s'ouvre. Ce
	# qui reste hors d'atteinte est une case qu'aucun joueur ne verra jamais.
	var tout: Dictionary = Sim.nouvelle_partie(1, data)
	var ouvertes: Array = Recherche.disponibles(tout, data)
	while not ouvertes.is_empty():
		for id2: Variant in ouvertes:
			(tout["recherche"]["acquis"] as Dictionary)[str(id2)] = 1.0
		ouvertes = Recherche.disponibles(tout, data)
	for id3: String in Etat.cles_triees(noeuds):
		if not (tout["recherche"]["acquis"] as Dictionary).has(id3):
			echecs.append("la case `%s` n'est reliee au centre par aucun chemin : elle est inatteignable"
				% id3)
	var depart: Dictionary = data["procedes"]["ouvertures_depart"]
	for borne: String in Recherche.BORNES:
		if not depart.has(borne):
			echecs.append("ouvertures_depart n'a pas de `%s` : la borne de depart n'est pas declaree"
				% borne)
	for f: Variant in (depart["familles"] as Array):
		if not familles.has(str(f)):
			echecs.append("ouvertures_depart nomme la famille `%s`, absente de precurseurs.json"
				% str(f))
	# LA BUTEE DECLAREE doit etre OUVERTE AU DEPART. Une butee verrouillee donnerait au
	# joueur, par accident, exactement ce que la grille lui refuse — et c'est un accident
	# silencieux : la recette part normalisee sur une famille qu'il n'a pas cherchee.
	var defaut: String = str(depart["famille_defaut"])
	if not (depart["familles"] as Array).has(defaut):
		echecs.append("ouvertures_depart.famille_defaut vaut `%s`, qui n'est pas dans les familles ouvertes au depart : la butee donnerait une famille non cherchee"
			% defaut)
	# La promesse 2, verifiee sur le JEU et pas sur le JSON : on demande la meilleure recette
	# possible dans le kit de depart et on regarde si elle sort des kilos.
	var etat: Dictionary = Sim.nouvelle_partie(1, data)
	var limites: Dictionary = Recherche.ouvertures(etat, data)
	var au_max: Dictionary = {"famille": str((depart["familles"] as Array)[0]),
		"purete": 9.0, "rendement": 9.0, "complexite": 9, "coupe": 0.0, "stabilisation": 9}
	var debit: float = float(Produit.specs(Produit.normaliser(au_max, data, limites),
		data)["debit_kg_sem"])
	if debit <= 0.0:
		echecs.append("le kit de depart ne produit AUCUN kilo : §2bis promet qu'une partie entiere est jouable sans rien rechercher")
	# Le repli ne doit pas DERIVER quand on cherche : on demande une famille verrouillee
	# depuis plusieurs etats d'avancement differents et on exige la meme reponse. C'est la
	# regression exacte qui a existe — `ouvertes[0]` apres tri alphabetique.
	var verrouillee: Dictionary = {"famille": "___aucune___", "purete": 0.5, "rendement": 0.5,
		"complexite": 1, "coupe": 0.0, "stabilisation": 0}
	var replis: Dictionary = {}
	for id4: String in Etat.cles_triees(noeuds):
		(etat["recherche"]["acquis"] as Dictionary)[id4] = 1.0
		replis[str(Produit.normaliser(verrouillee, data,
			Recherche.ouvertures(etat, data))["famille"])] = true
	if replis.size() > 1 or not replis.has(defaut):
		echecs.append("la butee de famille DERIVE au fil de la recherche (%s) : elle doit rester `%s`"
			% [" ".join(PackedStringArray(Etat.cles_triees(replis))), defaut])
	print("recherche    | %d cases, grille connexe, kit de depart a %.1f kg/sem, butee `%s` stable"
		% [noeuds.size(), debit, defaut])


# L'ARITHMETIQUE DE sim/recherche.gd. Le test structurel ci-dessus garde les promesses de
# §2bis contre une ligne de JSON ; celui-ci garde le code contre lui-meme.
func _test_recherche_comportement(data: Dictionary) -> void:
	var noeuds: Dictionary = data["procedes"]["noeuds"]
	var libres: Array = Recherche.disponibles(Sim.nouvelle_partie(1, data), data)
	# UNE CASE DE CHAQUE GENRE D'OUVERTURE parmi celles qui touchent le centre, et pas « la
	# moins chere ». La premiere version de ce test prenait le noeud libre le moins cher :
	# c'etait toujours celui qui ouvre une FAMILLE, donc la branche des bornes ne tournait
	# JAMAIS. Les deux genres existaient, un seul etait exerce.
	var cibles: Dictionary = {}
	for id: Variant in libres:
		for genre: String in (noeuds[str(id)]["ouvre"] as Dictionary):
			if not cibles.has(genre):
				cibles[genre] = str(id)
	var verrou: String = ""
	for id2: String in Etat.cles_triees(noeuds):
		if not libres.has(id2):
			verrou = id2
			break
	if cibles.is_empty() or verrou == "":
		echecs.append("recherche : la grille n'a pas a la fois des cases libres et des cases verrouillees au depart, ce test ne mesure rien")
		return
	var vus: PackedStringArray = []
	for genre2: String in Etat.cles_triees(cibles):
		_eprouver_noeud(data, str(cibles[genre2]), verrou, genre2)
		vus.append("%s (%s)" % [str(cibles[genre2]), genre2])
	print("recherche+   | %d genres : cout debite une fois, achat instantane, borne reculee, voisines ouvertes, inflation"
		% vus.size())


# Une passe complete sur UNE case. `genre` dit quelle ouverture elle porte, donc laquelle
# des bornes doit avoir recule a la fin.
func _eprouver_noeud(data: Dictionary, cible: String, verrou: String, genre: String) -> void:
	var noeuds: Dictionary = data["procedes"]["noeuds"]
	var cout: float = float(noeuds[cible]["cout_propre"])
	var bras: String = str(noeuds[cible]["bras"])
	var exige: float = float(noeuds[cible]["cout_savoir"])

	# 1. UNE CASE QUI NE TOUCHE RIEN REFUSE, ET NE DEPENSE RIEN. La structure du JSON est
	# verifiee ailleurs ; ici c'est l'EXECUTION qui doit refuser. Le savoir-faire est mis
	# au plein dans les trois premiers cas : c'est l'ADJACENCE puis l'ARGENT qui doivent
	# refuser, pas lui.
	var e: Dictionary = Sim.nouvelle_partie(1, data)
	_remplir_savoir(e, 1e6)
	var avant: float = float(e["cash_propre"])
	if Sim.appliquer(e, data, {"type": "recherche", "noeud": verrou}):
		echecs.append("recherche : `%s` achete sans toucher ni le centre ni une case acquise" % verrou)
	if not is_equal_approx(float(e["cash_propre"]), avant):
		echecs.append("recherche : un achat REFUSE a quand meme debite le propre")

	# 2. UN ACHAT IMPAYABLE REFUSE, ET NE DEPENSE RIEN.
	e["cash_propre"] = cout - 1.0
	if Sim.appliquer(e, data, {"type": "recherche", "noeud": cible}):
		echecs.append("recherche : `%s` achete avec un dollar de moins que son cout" % cible)
	if not is_equal_approx(float(e["cash_propre"]), cout - 1.0):
		echecs.append("recherche : un achat impayable a quand meme debite le propre")

	# 2bis. LE SAVOIR-FAIRE MANQUANT REFUSE AUSSI, argent plein ou pas. Et celui des AUTRES
	# bras n'aide pas : c'est la promesse des reserves separees (§2bis).
	if exige > 0.0:
		e = Sim.nouvelle_partie(1, data)
		_remplir_savoir(e, 1e6)
		(e["recherche"]["savoir"] as Dictionary)[bras] = exige - 0.01
		avant = float(e["cash_propre"])
		if Sim.appliquer(e, data, {"type": "recherche", "noeud": cible}):
			echecs.append("recherche : `%s` achete sans le savoir-faire de son bras `%s`, avec celui des autres"
				% [cible, bras])
		if not is_equal_approx(float(e["cash_propre"]), avant):
			echecs.append("recherche : un achat refuse faute de savoir-faire a quand meme debite le propre")

	# 3. LE COUT EST DEBITE EXACTEMENT, ET UNE SEULE FOIS — la premiere case de la branche
	# paie son prix de base, sans inflation, et exactement son savoir-faire, dans son bras.
	e = Sim.nouvelle_partie(1, data)
	(e["recherche"]["savoir"] as Dictionary)[bras] = exige + 5.0
	avant = float(e["cash_propre"])
	var avant_lim: float = 0.0
	if not Recherche.LISTES.has(genre):
		avant_lim = float(Recherche.ouvertures(e, data).get(genre, 0.0))
	var avant_libres: Array = Recherche.disponibles(e, data)
	if not Sim.appliquer(e, data, {"type": "recherche", "noeud": cible}):
		echecs.append("recherche : `%s` refuse alors qu'il est libre et payable" % cible)
		return
	if not is_equal_approx(float(e["cash_propre"]), avant - cout):
		echecs.append("recherche : `%s` coute %s mais a debite %s"
			% [cible, String.num(cout, 2), String.num(avant - float(e["cash_propre"]), 2)])
	if not is_equal_approx(float(e["stats"]["propre_recherche"]), cout):
		echecs.append("recherche : la statistique `propre_recherche` ne suit pas le debit")
	if not is_equal_approx(float(e["recherche"]["savoir"][bras]), 5.0):
		echecs.append("recherche : `%s` exige %s de savoir-faire mais en a debite %s"
			% [cible, String.num(exige, 2), String.num(exige + 5.0 - float(e["recherche"]["savoir"][bras]), 2)])

	# 4. L'ACHAT EST INSTANTANE — acquis dans le meme appel, pas au tick suivant, et la
	# borne a deja recule.
	if not (e["recherche"]["acquis"] as Dictionary).has(cible):
		echecs.append("recherche : `%s` paye mais pas acquis sur-le-champ" % cible)
	var ouvre: Dictionary = noeuds[cible]["ouvre"]
	var apres: Dictionary = Recherche.ouvertures(e, data)
	if Recherche.LISTES.has(genre):
		if not (apres[str(Recherche.LISTES[genre])] as Array).has(str(ouvre[genre])):
			echecs.append("recherche : `%s` acquis mais l'option `%s` reste fermee"
				% [cible, str(ouvre[genre])])
	elif float(apres[genre]) <= avant_lim:
		echecs.append("recherche : `%s` acquis mais la borne `%s` n'a pas recule (%s)"
			% [cible, genre, String.num(float(apres[genre]), 3)])

	# 5. ON NE RACHETE PAS UNE CASE ACQUISE.
	var pendant: float = float(e["cash_propre"])
	if Sim.appliquer(e, data, {"type": "recherche", "noeud": cible}):
		echecs.append("recherche : `%s` achete deux fois" % cible)
	if not is_equal_approx(float(e["cash_propre"]), pendant):
		echecs.append("recherche : un rachat refuse a quand meme debite le propre")

	# 6. L'ADJACENCE OUVRE : une case voisine de celle qu'on vient de prendre, et qui ne
	# touchait rien avant, est devenue achetable. Sans ca la grille serait un catalogue.
	var ici: Array = Recherche.lire_case(str(noeuds[cible]["case"]))
	for id: String in Etat.cles_triees(noeuds):
		if avant_libres.has(id) or id == cible:
			continue
		if Recherche.voisines(ici, Recherche.lire_case(str(noeuds[id]["case"]))) \
				and not Recherche.disponibles(e, data).has(id):
			echecs.append("recherche : `%s` acquis mais sa voisine `%s` reste verrouillee"
				% [cible, id])

	# 7. L'INFLATION : toute autre case de la branche coute desormais sa base majoree d'UNE
	# case acquise. C'est elle qui remplace la duree comme frein de la montee (§2bis).
	var k: float = float(data["procedes"]["inflation_par_acquis"])
	var branche: String = str(noeuds[cible]["branche"])
	for id5: String in Etat.cles_triees(noeuds):
		if id5 == cible or str(noeuds[id5]["branche"]) != branche:
			continue
		var attendu: float = float(noeuds[id5]["cout_propre"]) * (1.0 + k)
		if not is_equal_approx(Recherche.cout(e, data, id5), attendu):
			echecs.append("recherche : apres une case, `%s` coute %s au lieu de %s"
				% [id5, String.num(Recherche.cout(e, data, id5), 2), String.num(attendu, 2)])


func _remplir_savoir(e: Dictionary, valeur: float) -> void:
	for b: String in (e["recherche"]["savoir"] as Dictionary):
		e["recherche"]["savoir"][b] = valeur


# LE SAVOIR-FAIRE (§2bis). Ce que ce test garde, ce sont les trois promesses qui le
# separent d'une monnaie de recherche deguisee :
#   1. chaque bras n'apprend QUE de ses curseurs — une recette en butee de coupe n'apprend
#      pas la purete. C'est ce qui empeche de farmer le curseur le moins cher ;
#   2. un plafond encore egal au minimum n'apprend rien (complexite 1 au depart) ;
#   3. il ne touche a aucune bourse, et un labo a l'arret n'apprend rien. La part de
#      production le pondere : produire un filet en butee rapporte moins qu'un labo plein.
func _test_savoir(data: Dictionary) -> void:
	var base: Dictionary = {"famille": "verdal", "purete": 0.40, "rendement": 0.40,
		"complexite": 1, "coupe": 0.0, "stabilisation": 0}
	var cas: Array = [
		["purete", 0.60, "purete_procede"],
		["coupe", 0.30, "volume"],
		["rendement", 0.75, "volume"],
	]
	for c: Array in cas:
		var e: Dictionary = Sim.nouvelle_partie(1, data)
		var r: Dictionary = base.duplicate()
		r[str(c[0])] = float(c[1])
		Sim.appliquer(e, data, {"type": "recette", "recette": r})
		e["part_capacite"] = 1.0
		var propre: float = float(e["cash_propre"])
		var sale: float = float(e["cash_sale"])
		Recherche.apprendre(e, data)
		var sv: Dictionary = e["recherche"]["savoir"]
		for b: String in Etat.cles_triees(sv):
			var attendu_positif: bool = b == str(c[2]) or b == "familles_stabilisation"
			if attendu_positif and float(sv[b]) <= 0.0:
				echecs.append("savoir : `%s` en butee n'apprend rien au bras `%s`" % [str(c[0]), b])
			if not attendu_positif and float(sv[b]) > 0.0:
				echecs.append("savoir : `%s` en butee fait apprendre le bras `%s`, qui n'est pas le sien — on pourrait farmer un curseur pour en acheter un autre"
					% [str(c[0]), b])
		if not is_equal_approx(float(e["cash_propre"]), propre) 				or not is_equal_approx(float(e["cash_sale"]), sale):
			echecs.append("savoir : apprendre a touche une bourse — le savoir-faire ne s'echange jamais contre de l'argent")
	# 2. la recette de base est sous tous les seuils : seul le bras Familles apprend (on
	# produit la famille la plus avancee), et la complexite 1 — plafond = minimum — non.
	var e2: Dictionary = Sim.nouvelle_partie(1, data)
	Sim.appliquer(e2, data, {"type": "recette", "recette": base})
	e2["part_capacite"] = 1.0
	Recherche.apprendre(e2, data)
	if float(e2["recherche"]["savoir"]["purete_procede"]) > 0.0:
		echecs.append("savoir : complexite 1 au depart (plafond = minimum) fait apprendre le bras Purete/Procede")
	if float(e2["recherche"]["savoir"]["familles_stabilisation"]) <= 0.0:
		echecs.append("savoir : produire la famille la plus avancee n'apprend rien au bras Familles")
	# 3. la part pondere, et un labo a l'arret n'apprend rien.
	var gains: Array = []
	for part: float in [0.0, 0.2, 1.0]:
		var e3: Dictionary = Sim.nouvelle_partie(1, data)
		Sim.appliquer(e3, data, {"type": "recette", "recette": base})
		e3["part_capacite"] = part
		Recherche.apprendre(e3, data)
		gains.append(float(e3["recherche"]["savoir"]["familles_stabilisation"]))
	if float(gains[0]) > 0.0 or not (float(gains[1]) < float(gains[2])):
		echecs.append("savoir : la part de production ne pondere pas le gain (%s)"
			% str(gains))
	print("savoir       | chaque bras n'apprend que de ses curseurs, aucune bourse touchee, pondere par la part")


# --- 1bis. calibration : 3 produits de référence, specs à ±5 % ----------------

# §2 : « Toute modification des formules casse ce test avant de casser l'équilibrage. »
# La substance est fictive, donc il n'existe aucune vérité extérieure à laquelle se caler —
# contrairement au vmax d'un avion réel, qui était la référence dans `bureau-etudes`. Les
# attendus de data/calibration.json sont donc une INTENTION DE DESIGN, et ce test vérifie
# que les sept formules la servent encore. Des attendus générés depuis le code ne seraient
# pas une calibration, seulement un détecteur de changement qui approuve tout.
func _test_calibration(data: Dictionary) -> void:
	var cal: Dictionary = data["calibration"]
	var tol: float = float(cal["tolerance"])
	for r: Dictionary in cal["references"]:
		var specs: Dictionary = Produit.specs(r["recette"], data)
		var morceaux: PackedStringArray = []
		for cle: String in Etat.cles_triees(r["attendu"]):
			var attendu: float = float(r["attendu"][cle])
			var obtenu: float = float(specs[cle])
			# Un attendu à zéro ne se compare pas en relatif : `instabilite_neuro` vaut
			# exactement 0 pour les deux premières références, et c'est l'affirmation
			# (« elles ne déclenchent rien »), pas un arrondi.
			var ecart: float = absf(obtenu - attendu) / attendu if absf(attendu) > 1e-9 				else absf(obtenu)
			morceaux.append("%s %.4f" % [cle, obtenu])
			if ecart > tol:
				echecs.append("calibration hors tolerance : %s / %s (attendu %.4f, obtenu %.4f, ecart %.1f%%)"
					% [str(r["nom"]), cle, attendu, obtenu, ecart * 100.0])
		print("calibration  | %-40s %s" % [str(r["nom"]), " | ".join(morceaux)])
	_test_calibration_ordres(data)


# --- 2. déterminisme : même graine, même hash ---------------------------------

# LES DEUX BOTS, et pas seulement `discret`. Ce test et save/load codaient tous les deux
# `discret` en dur — le seul profil qui ne cherche RIEN. Le seul etat mutable que §2bis a
# ajoute (`acquis`) ne passait donc jamais par une
# empreinte ni par un aller-retour JSON. `_campagne_avec` prenait deja une strategie en


# L'INTENTION, ET PAS LES CHIFFRES. Les `attendu` de data/calibration.json ont ete remesures
# le jour ou §2 a donne une contrepartie a ses curseurs domines : le modele de cout a change
# delibrement et l'echelle a baisse d'un tiers a deux tiers. Remesurer un attendu est
# DANGEREUX — une calibration qu'on realigne sur ce que le code produit ne peut plus jamais
# echouer, et c'est exactement le poteau qu'on deplace pour passer (§16).
#
# Ces ordres-la sont ce qu'une remesure ne satisfait pas toute seule. Ils disent ce que le
# document veut : les quatre familles se paient de plus en plus cher ET tapent de plus en
# plus fort ET chargent de plus en plus vite (§2, le piege), et un produit de rue coute
# moins qu'un haut de gamme, qui coute moins qu'une recette extreme. Une formule qui casse
# un de ces ordres a casse le jeu, quels que soient ses chiffres.
func _test_calibration_ordres(data: Dictionary) -> void:
	var par_id: Dictionary = {}
	for r: Dictionary in data["calibration"]["references"]:
		par_id[str(r.get("id", ""))] = r
	var n: int = 0
	for ordre: Dictionary in data["calibration"].get("ordres", []):
		var ids: Array = ordre["croissant"]
		for id: Variant in ids:
			if not par_id.has(str(id)):
				echecs.append("calibration.json:ordres cite `%s`, qui n'est l'id d'aucune reference" % str(id))
				return
		for spec: String in ordre["specs"]:
			var precedent: float = -1e30
			var nom_prec: String = ""
			for id2: Variant in ids:
				var v: float = float(Produit.specs(par_id[str(id2)]["recette"], data)[spec])
				if v <= precedent:
					echecs.append("§2 : l'ordre est casse sur `%s` — `%s` donne %s, pas au-dessus de `%s` (%s). calibration.json:ordres exige %s strictement croissant."
						% [spec, str(id2), String.num(v, 3), nom_prec, String.num(precedent, 3), " < ".join(PackedStringArray(ids))])
				precedent = v
				nom_prec = str(id2)
			n += 1
	print("calib. ordres | %d ordres tenus, lus dans calibration.json (aucune recette recopiee ici)" % n)
# argument ; il suffisait de s'en servir.
func _test_determinisme(data: Dictionary) -> void:
	for nom: String in Etat.cles_triees(Bots.strategies()):
		var strat: Dictionary = Bots.strategies()[nom]
		if Etat.hacher(_campagne_avec(42, data, 130, strat)) 				!= Etat.hacher(_campagne_avec(42, data, 130, strat)):
			echecs.append("determinisme : hashes differents pour la meme graine (%s)" % nom)
			return
	var h1: String = Etat.hacher(_campagne(42, data, 130))
	var h2: String = Etat.hacher(_campagne(42, data, 130))
	if h1 != h2:
		echecs.append("determinisme : hashes differents pour la meme graine")
		return
	# Ce que ce test PEUT prouver : que le flux aléatoire avance et qu'il diffère d'une
	# graine à l'autre. Ce qu'il ne peut plus prouver : que deux graines vivent des parties
	# différentes — au jalon 1 elles n'en vivent pas, et ce n'est pas un bug du RNG.
	#
	# La raison est mesurée et vit ailleurs : `eco.bruit_demande` est déclarée DORMANTE
	# dans levier.gd jusqu'au jalon 2, parce que la production du joueur reste très en
	# dessous de ce qu'un seul marché absorbe — un bruit sur un plafond qui ne mord jamais
	# ne mord pas. Le jour où cette dormance tombera, la divergence des issues reviendra
	# d'elle-même, et c'est balance.gd qui la mesure (« graines distinctes »), pas ici.
	#
	# Affirmer ici que deux graines DOIVENT diverger serait poser un verdict sur une
	# propriété que le jeu n'a pas encore — le poteau qu'on déplace ensuite pour passer.
	var strat: Dictionary = Bots.strategies()["industriel"]
	var a: Dictionary = _campagne_avec(42, data, 30, strat)
	var b: Dictionary = _campagne_avec(43, data, 30, strat)
	if is_equal_approx(float(a["rng"]), float(b["rng"])):
		echecs.append("determinisme : deux graines aboutissent au meme etat de RNG (flux debranche)")
		return
	if is_equal_approx(float(a["rng"]), float(a["graine"])):
		echecs.append("determinisme : le RNG n'a pas avance en 30 ticks (personne ne tire)")
		return
	print("determinisme | double run seede identique, graines distinctes (130 ticks)")
	# L'EMPREINTE, imprimee et pas seulement calculee. Elle ne sert a rien DANS cette
	# execution — les deux hashes viennent d'etre compares trois lignes plus haut. Elle sert
	# ENTRE deux plateformes : `pow()` passe par la libm, dont le dernier ULP peut differer
	# d'un systeme a l'autre, et sur 260 ticks avec des comparaisons a seuil un ULP suffit a
	# deplacer une semaine de mort. Si l'empreinte de la CI et celle d'un poste local
	# divergent, comparer leurs csv avec tests/comparer.gd ne mesure plus un changement de
	# code : ca mesure la difference entre deux machines.
	# A lire UNE FOIS dans un log de CI et a confronter au sien — SUR LE MEME COMMIT. Cette
	# empreinte est celle d'une campagne jouee par les bots d'aujourd'hui : toucher a
	# tests/bots.gd ou a sim/ la change, et c'est normal. Comparer le log d'hier a un run
	# d'aujourd'hui ferait conclure a une divergence de plateforme la ou il n'y a qu'un
	# changement de fixture.
	# Ce n'est pas une baseline qu'on cite (§16 l'interdit) : rien ici ne la stocke ni ne la
	# compare a une valeur ecrite.
	print("             > empreinte campagne de reference (graine 42, 130 ticks) : %s"
		% h1.substr(0, 16))


# --- 3. save/load : reprise sans divergence -----------------------------------

func _test_save_load(data: Dictionary) -> void:
	var en_montee: int = 0
	for nom: String in Etat.cles_triees(Bots.strategies()):
		var strat: Dictionary = Bots.strategies()[nom]
		# ON S'ARRETE EN PLEINE MONTEE, on ne l'espere pas : au moins une case acquise, pas
		# toute la liste. La version de l'arbre sauvegardait au tick 60 en dur et annoncait
		# « 0 en cours de chantier » — le bot etait entre deux noeuds, et le test restait
		# aveugle a l'etat meme qu'il venait d'etre elargi pour couvrir. L'achat est devenu
		# instantane (§2bis) : ce qui doit traverser le JSON est un `acquis` PARTIEL.
		var s1: Dictionary = Sim.nouvelle_partie(7, data)
		var voulu: int = (strat["recherche"] as Array).size()
		for t: int in range(140):
			var n_acq: int = (s1["recherche"]["acquis"] as Dictionary).size()
			if n_acq > 0 and n_acq < voulu and t >= 60:
				break
			Bots.agir(s1, data, strat)
			Sim.tick(s1, data)
		var n_fin: int = (s1["recherche"]["acquis"] as Dictionary).size()
		if n_fin > 0 and n_fin < voulu:
			en_montee += 1
		var s2: Dictionary = JSON.parse_string(Etat.serialiser(s1))
		if not Etat.equivalents(s1, s2):
			echecs.append("save/load (%s) : etat non equivalent des la sauvegarde" % nom)
			_imprimer_diff(s1, s2, "state", 5)
			return
		for i: int in range(60):
			Bots.agir(s1, data, strat)
			Sim.tick(s1, data)
			Bots.agir(s2, data, strat)
			Sim.tick(s2, data)
			if not Etat.equivalents(s1, s2):
				echecs.append("save/load (%s) : divergence au tick de reprise %d" % [nom, i + 1])
				_imprimer_diff(s1, s2, "state", 5)
				return
	# Le test doit AVOIR TROUVE une montee, sinon il ne dit rien de §2bis et il faut le
	# savoir. Zero ici veut dire soit que plus aucun bot ne cherche, soit que la fenetre de
	# 140 ticks ne croise plus la grille — dans les deux cas quelqu'un doit regarder.
	if en_montee == 0:
		echecs.append("save/load : aucun bot n'etait en pleine montee de la grille, donc un etat de recherche partiel (§2bis) n'a jamais traverse un aller-retour JSON")
	print("save/load    | roundtrip + 60 ticks sur %d bots, dont %d en pleine montee de la grille"
		% [Bots.strategies().size(), en_montee])


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
					printerr("  diff cle absente a droite : %s.%s" % [chemin, str(cle)])
					budget -= 1
				else:
					budget = _imprimer_diff(a[cle], b[cle], chemin + "." + str(cle), budget)
				if budget <= 0:
					return 0
			for cle2: Variant in b:
				if not (a as Dictionary).has(cle2):
					printerr("  diff cle absente a gauche : %s.%s" % [chemin, str(cle2)])
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


# --- 4. la règle du papier (§5) : deux bourses, un seul robinet ----------------

# L'invariant central de l'argent : le propre ne peut AUGMENTER que par le blanchiment, et
# le sale ne descend jamais sous zéro. Si un jour une recette de vente tombe en propre ou
# qu'un coût bascule de bourse en silence, c'est ici que ça crie — pas trois jalons plus
# tard, quand la double trésorerie sera devenue le cœur du jeu.
func _test_regle_du_papier(data: Dictionary) -> void:
	var state: Dictionary = Sim.nouvelle_partie(3, data)
	var strat: Dictionary = Bots.strategies()["industriel"]
	var hausse_max: float = 0.0
	for i: int in range(200):
		var propre_avant: float = float(state["cash_propre"])
		var blanchi_avant: float = float(state["stats"]["propre_blanchi"])
		Bots.agir(state, data, strat)
		Sim.tick(state, data)
		if float(state["cash_sale"]) < 0.0:
			echecs.append("regle du papier : cash_sale negatif au tick %d" % int(state["tick"]))
			return
		var hausse: float = float(state["cash_propre"]) - propre_avant
		var blanchi: float = float(state["stats"]["propre_blanchi"]) - blanchi_avant
		if hausse > blanchi + 1e-6:
			echecs.append("regle du papier : le propre monte de %.2f alors que le blanchiment n'a rendu que %.2f (tick %d)"
				% [hausse, blanchi, int(state["tick"])])
			return
		hausse_max = maxf(hausse_max, hausse)
		if str(state["fin"]) != "":
			break
	print("papier       | 1 seul robinet vers le propre (hausse hebdo max %.0f $), sale jamais negatif"
		% hausse_max)


# --- 5. la dette : l'horloge de l'acte I (§1bis) -------------------------------

func _test_dette(data: Dictionary) -> void:
	var montant: float = float(data["constants"]["dette"]["montant"])
	var echeance: float = float(data["constants"]["dette"]["echeance_sem"])
	var riche: Dictionary = _a_l_echeance(data, montant * 3.0, echeance)
	if str(riche["fin"]) == "saisie" or float(riche["dette"]) > 0.0:
		echecs.append("dette : le solvable n'a pas rembourse a l'echeance")
	elif not is_equal_approx(float(riche["cash_propre"]),
			montant * 3.0 - montant - float(data["constants"]["eco"]["cout_fixe_sem"])):
		echecs.append("dette : le remboursement n'a pas debite exactement le montant du")
	var pauvre: Dictionary = _a_l_echeance(data, montant * 0.5, echeance)
	if str(pauvre["fin"]) != "saisie":
		echecs.append("dette : l'insolvable n'a pas ete saisi a l'echeance (fin=%s)" % str(pauvre["fin"]))
	# Une semaine trop tôt, il ne se passe RIEN : une horloge qui sonne avant l'heure ne
	# serait pas une horloge, et le joueur perdrait sur un calendrier qu'il ne lit pas.
	var veille: Dictionary = _a_l_echeance(data, montant * 0.5, echeance - 1.0)
	if str(veille["fin"]) == "saisie":
		echecs.append("dette : saisie declenchee AVANT l'echeance")
	print("dette        | echeance semaine %.0f : solvable rembourse, insolvable saisi, veille calme"
		% echeance)


# Amène un state à la semaine de l'échéance avec le propre voulu, sans rien produire :
# le test porte sur l'horloge, pas sur l'économie qui l'alimente.
func _a_l_echeance(data: Dictionary, propre: float, tick_vise: float) -> Dictionary:
	var state: Dictionary = Sim.nouvelle_partie(1, data)
	state["tick"] = tick_vise - 1.0
	state["cash_propre"] = propre
	Sim.tick(state, data)
	return state


# --- 6. la visibilité : la jauge 1/3 (§7) -------------------------------------

func _test_visibilite(data: Dictionary) -> void:
	var cv: Dictionary = data["constants"]["visibilite"]
	# Un tas de sale ENORME et rien d'autre : la seule chose qui doit pouvoir arrêter le
	# joueur ici, c'est le tas lui-même (§5 — « payer chaque semaine la visibilite que ce
	# tas produit »).
	var state: Dictionary = Sim.nouvelle_partie(1, data)
	state["cash_sale"] = 1e9
	var semaines: int = 0
	while str(state["fin"]) == "" and semaines < 100:
		Sim.tick(state, data)
		semaines += 1
	if str(state["fin"]) != "arrestation":
		echecs.append("visibilite : un tas de sale enorme n'a pas mene a l'arrestation (fin=%s)"
			% str(state["fin"]))
	elif semaines != int(cv["semaines_arrestation"]):
		# La semaine qui fait passer la jauge au-dessus du seuil est DÉJÀ une semaine de
		# traque : le compte à rebours part à 1, pas à 0. C'est la mécanique, pas une
		# tolérance — et c'est elle que le HUD devra afficher (§12bis).
		echecs.append("visibilite : arrestation en %d semaines, attendu %d"
			% [semaines, int(cv["semaines_arrestation"])])
	# À l'inverse, une campagne au repos ne doit RIEN accumuler : la jauge a un plancher.
	var calme: Dictionary = Sim.nouvelle_partie(1, data)
	for i: int in range(10):
		Sim.tick(calme, data)
	if float(calme["visibilite"]) != 0.0:
		echecs.append("visibilite : la jauge bouge sans aucune activite (%.3f)" % float(calme["visibilite"]))
	print("visibilite   | arrestation en %d semaines au-dessus de %.0f, plancher tenu a 0"
		% [semaines, float(cv["seuil_arrestation"])])


# --- 7. campagnes bot : elles finissent, et elles ne finissent pas pareil ------

func _test_campagnes_bot(data: Dictionary) -> void:
	var strats: Dictionary = Bots.strategies()
	var fins: Dictionary = {}
	var profils: Dictionary = {}
	for nom: String in Etat.cles_triees(strats):
		for graine: int in [1, 7, 13]:
			var state: Dictionary = Sim.nouvelle_partie(graine, data)
			var semaines_max: int = int(data["constants"]["sim"]["semaines_max"])
			for t: int in range(semaines_max + 1):
				Bots.agir(state, data, strats[nom])
				Sim.tick(state, data)
				if str(state["fin"]) != "":
					break
			if str(state["fin"]) == "":
				echecs.append("campagne %s/%d : aucune fin atteinte" % [nom, graine])
			fins[str(state["fin"])] = int(fins.get(str(state["fin"]), 0)) + 1
			profils[nom] = {"fin": str(state["fin"]), "visibilite": float(state["visibilite"]),
				"cash_sale": float(state["cash_sale"])}
			print("campagne     | %-12s graine %2d | fin=%-13s sem=%3d propre=%9.0f sale=%11.0f visib=%5.1f"
				% [nom, graine, str(state["fin"]), int(state["tick"]),
				float(state["cash_propre"]), float(state["cash_sale"]),
				float(state["visibilite"])])
	# Deux profils opposés qui vivent la MÊME partie, c'est un jeu dont les choix ne
	# décident de rien. Le harnais doit le voir tout de suite, pas au playtest.
	#
	# Ce test comparait les ÉTIQUETTES de fin, et un équilibrage l'a rendu faux le jour où
	# les deux bots ont fini en `fin_campagne` alors qu'ils vivaient des parties opposées —
	# l'un invisible avec un tas plat, l'autre au bord de l'arrestation avec dix fois plus
	# de sale. Une étiquette commune ne veut pas dire la même partie.
	# On compare donc les SORTIES. Et ce commentaire ne cite aucun chiffre : ils changent à
	# chaque passe, et c'est `balance.gd` qui les imprime, pas lui.
	var signatures: Dictionary = {}
	for nom: String in Etat.cles_triees(strats):
		var s: Dictionary = profils[nom]
		signatures["%s|%d|%d" % [str(s["fin"]), int(float(s["visibilite"]) / 10.0),
			int(float(s["cash_sale"]) / 1e6)]] = true
	if signatures.size() < strats.size():
		echecs.append("campagnes : les %d bots vivent la meme partie — aucun choix ne decide"
			% strats.size())


# --- boucle de campagne partagée ----------------------------------------------

func _campagne(graine: int, data: Dictionary, n_ticks: int) -> Dictionary:
	return _campagne_avec(graine, data, n_ticks, Bots.strategies()["discret"])


func _campagne_avec(graine: int, data: Dictionary, n_ticks: int, strat: Dictionary) -> Dictionary:
	var state: Dictionary = Sim.nouvelle_partie(graine, data)
	for i: int in range(n_ticks):
		Bots.agir(state, data, strat)
		Sim.tick(state, data)
	return state
