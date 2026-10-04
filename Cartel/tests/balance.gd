# Raison d'être : harnais d'équilibrage de §16 — N graines × les bots disponibles,
# distribution des fins et verdicts chiffrés contre les cibles du GDD. On ajuste data/,
# jamais le code. Porté de bureau-etudes/tests/balance.gd : mêmes conventions (nombre de
# graines en argument, mortalité de démarrage distincte, écart de richesse en plus du taux
# de victoire), cibles réécrites sur celles de Cartel.
#
# LA RÈGLE DES CIBLES, et pas leur liste : **une cible s'écrit le jour où son axe naît**,
# jamais rétro-ajoutée (§15). Un axe non mesuré à sa naissance devient un levier qu'on
# découvre mort deux ans plus tard, et c'est la faute qui a coûté `bureau-etudes`. Celles
# qui manquent encore attendent leur sous-système : 8/9/15 avec le parc, 10/11/16/17/18 avec
# l'argent sale, 12 avec les hommes, 13/14 avec l'épidémie.
#
# LA LISTE DE CE QUI EST ARMÉ ICI N'EST PAS RECOPIÉE : `verdicts()` la produit et le rapport
# l'imprime à chaque exécution. Elle a dit « 1, 2 et 3 » pendant que le fichier en tenait
# cinq — deux étaient arrivées le jour de leur axe, exactement comme la règle l'exige, et
# l'en-tête ne les avait pas vues passer. Une énumération dans un commentaire pourrit par
# construction : c'est la même règle que les chiffres mesurés, appliquée aux listes.
extends SceneTree

const Etat := preload("res://sim/state.gd")
const Sim := preload("res://sim/sim.gd")
const Bots := preload("res://tests/bots.gd")
const Produit := preload("res://sim/produit.gd")
const Recherche := preload("res://sim/recherche.gd")

# Cible 3 : le OU est délibéré (§16) — gagner souvent en finissant à peine plus riche est
# une égalité, pas une domination.
const VICTOIRES_MAX: float = 0.60
const ECART_DOMINATION: float = 0.15
# Cible 1 : la fourchette de mortalité lisible.
const MORTALITE_MIN: float = 0.15
const MORTALITE_MAX: float = 0.35
# Cible 2 : une mort avant `SEMAINE_DEMARRAGE` n'est pas une mort de partie, c'est une mort au
# démarrage — le bot coule avant d'avoir vendu. Garde-fou anti-régression, PAS une cible à
# atteindre : on ajoute la MESURE avant d'en faire une contrainte.
# Cible 3 : la richesse se compare a une DATE COMMUNE, pas en fin de campagne. En fin de
# campagne, un bot mort n'a pas de richesse mediane et l'ecart devient « n/a » — la cible
# s'eteignait pour une raison technique alors que son intention (« aucune strategie n'en
# ecrase une autre ») reste parfaitement mesurable tant que les deux sont en vie.
# La date est choisie APRES que les trajectoires se soient separees et AVANT la premiere
# mort. Cette derniere bouge a chaque passe d'equilibrage, donc ce commentaire ne la cite
# pas : c'est la garde `jalon_douteux` qui surveille l'invariant, et elle crie dans le
# rapport comme dans le balayage si un bot meurt avant cette date.
#
# Elle a crie pour de bon quand §19bis a donne un prix par segment : les morts sont
# remontees d'une quarantaine de semaines, la date s'est retrouvee APRES la premiere, et
# l'ecart de richesse comparait l'instantane d'un mort. La garde a fait exactement ce pour
# quoi elle existe, et la date a ete remesuree plutot que relue.
# Cible 3, TROISIEME terme : la SURVIE. Les deux premiers forment un OU delibere (gagner
# souvent en finissant a peine plus riche est une egalite) — et ce OU avalait le vrai
# rouge autant que le faux. Mesure du jour : `discret` survit a 100 %, `industriel` est
# arrete dans 100 % des campagnes, et la cible imprimait « aucune domination : victoires
# max 100 % » parce que l'ecart de richesse, pris semaine 200, tombe vingt-sept semaines
# avant que le perdant meure.
#
# Aucun ecart de richesse ne rachete 0 % contre 100 % de survie : c'est un jeu a une seule
# strategie viable, et c'est exactement ce que la cible 3 nomme. Le terme est donc un ET,
# pas un troisieme OU.
#
# CE N'EST PAS UN DOUBLON DE LA CIBLE 1. La cible 1 regarde la mortalite MOYENNE : un jeu
# regle pour que `industriel` meure une fois sur deux et `discret` jamais afficherait 25 %
# — dans la fourchette, au vert — en n'ayant toujours qu'un seul chemin jouable. L'ecart de
# survie est ce qui voit cette partie-la.
const SURVIE_DOMINATION: float = 0.80
const SEMAINE_COMPARAISON: int = 95
const SEMAINE_DEMARRAGE: int = 104
const SEUIL_PRECOCE: float = 0.10
# Cible 7 : l'écart sur `instabilite_neuro`, par bot, sur la médiane des graines (§16).
# Les bornes sont celles du GDD, mot pour mot : industriel >= 0.50, discret <= 0.25.
const CIBLE_7: Dictionary = {
	"discret": {"min": 0.0, "max": 0.25},
	"industriel": {"min": 0.50, "max": 1.0},
}
# CIBLE 23 (§2bis, §16) — ECRITE LE JOUR OU LA RECHERCHE EST NEE, jamais retro-ajoutee.
# §2bis promet : « elle n'est JAMAIS un prerequis de survie. Une partie entiere est jouable
# sans rien rechercher — plus pauvre, plus discrete, parfaitement viable. C'est la
# trajectoire du bot `discret`. » C'est la seule phrase de §2bis qui puisse etre fausse en
# silence : un arbre qui devient obligatoire ne se voit nulle part ailleurs: les cibles 1 et 3
# resteraient vertes pendant que le jeu cesse d'avoir une voie pauvre.
# La cible ne s'applique qu'aux bots qui ne cherchent RIEN : c'est eux qui la testent.
const SURVIE_SANS_RECHERCHE: float = 0.80

# Au-dela de cette part, une seule cause de mort fait toute la mortalite : 30 % de morts
# dont 100 % d'arrestations passe la cible 1 avec la meme arithmetique qu'un melange sain,
# alors que le jeu n'a qu'une porte de sortie. C'est une ALERTE et pas un verdict, et la
# distinction est celle de §16 : on ajoute la MESURE avant d'en faire une CONTRAINTE — un
# verdict pose sur une intuition non mesuree devient un poteau qu'on deplace ensuite pour
# passer. Elle deviendra un verdict au jalon 3, quand les trois morts existeront vraiment.
const CAUSE_DOMINANTE: float = 0.80

# Réglable : `-s res://tests/balance.gd -- 20` pour une boucle courte. 100 pour valider un
# jalon, 20 pour itérer — à 10 minutes la boucle, on se met à deviner au lieu de mesurer.
const CHEMIN_CSV: String = "res://balance.csv"

var n_graines: int = 100


func _initialize() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	if args.size() > 0 and args[0].is_valid_int():
		n_graines = maxi(int(args[0]), 1)
	var data: Dictionary = Etat.charger_data()
	var strats: Dictionary = Bots.strategies()
	var noms: Array = Etat.cles_triees(strats)
	print("harnais : %d graines × %d bots" % [n_graines, noms.size()])
	var resultats: Dictionary = campagnes(data, noms, n_graines)
	_exporter(noms, resultats)
	_rapport(noms, resultats)


# Toutes les campagnes de tous les bots, dans un ordre fixe. Derniere duplication connue
# entre ce fichier et balayage.gd : ils montaient le meme dict avec la meme double boucle.
static func campagnes(data: Dictionary, noms: Array, n: int) -> Dictionary:
	var strats: Dictionary = Bots.strategies()
	var resultats: Dictionary = {}
	for nom: String in noms:
		var liste: Array = []
		for graine: int in range(1, n + 1):
			liste.append(campagne(graine, data, strats[nom]))
		resultats[nom] = liste
	return resultats


# Une campagne complète, jusqu'à la fin ou jusqu'au plafond de semaines. Publique : run.gd
# et levier.gd rejouent exactement la même boucle, sinon les trois tests ne parlent pas du
# même jeu.
static func campagne(graine: int, data: Dictionary, strat: Dictionary) -> Dictionary:
	var state: Dictionary = Sim.nouvelle_partie(graine, data)
	var semaines_max: int = int(data["constants"]["sim"]["semaines_max"])
	var propre_cumule: float = 0.0
	for t: int in range(semaines_max + 1):
		Bots.agir(state, data, strat)
		Sim.tick(state, data)
		if int(state["tick"]) <= SEMAINE_COMPARAISON:
			propre_cumule += float(state["cash_propre"])
		if str(state["fin"]) != "":
			break
	return {
		"fin": str(state["fin"]),
		"fin_tick": int(state["tick"]),
		# LES DEUX BOURSES, séparées jusque dans le rapport (§5) : « le jeu ne les additionne
		# jamais, nulle part » — y compris pour classer les bots. La richesse d'une fin de
		# partie, c'est le propre ; le sale est un encombrement qu'on décrit à côté.
		"cash_propre": float(state["cash_propre"]),
		"cash_sale": float(state["cash_sale"]),
		"visibilite": float(state["visibilite"]),
		"kg": float(state["stats"]["kg_vendus"]),
		# La richesse a la date commune (cible 3). Si la campagne s'arrete avant, c'est sa
		# derniere valeur — un mort ne s'enrichit plus, et le comparer a cette date reste
		# honnete tant qu'on dit qu'il est mort.
		# LA RICHESSE EN INTEGRALE : le propre MOYEN tenu jusqu'a la date, et non sa valeur
		# ce jour-la. Un instantane repond « avait-il paye un chantier cette semaine-la »,
		# une integrale repond « a-t-il ete riche ».
		#
		# MESURE QUI A TRANCHE, balayage de `colonne_seche.cout_propre` a six valeurs :
		#   instantane  +376 +463 +587 +782 +1133 +181 %   (6x d'amplitude, et il repart)
		#   integrale   +109 +109 +107 +105 +102   +99 %   (monotone)
		# Depuis §2bis le bot sort 280 000 $ d'un coup pour un noeud : l'instantane mesurait
		# la semaine du paiement et plus la trajectoire.
		"propre_moyen": propre_cumule / float(maxi(SEMAINE_COMPARAISON, 1)),
		# L'axe de la cible 7. Au jalon 1 il ne fait RIEN — aucune formule ne le lit, aucune
		# fin n'en dépend. C'est précisément pour ça qu'il faut le mesurer maintenant.
		"instabilite": float(Produit.specs(state["recette"], data)["instabilite_neuro"]) 			if not (state["recette"] as Dictionary).is_empty() else 0.0,
		# §2bis : combien de noeuds ce profil a-t-il pu poser. Zero est une valeur
		# parfaitement valide et c'est meme celle qu'on surveille (cible 23).
		"noeuds": float((state["recherche"]["acquis"] as Dictionary).size()),
	}


# Une partie PERDUE, ce n'est pas seulement la faillite : la saisie du créancier (§1bis) et
# l'arrestation (§7) sont trois portes sur la même défaite. Ne compter que la faillite
# rendrait le harnais aveugle au bot qui meurt riche.
static func perdue(r: Dictionary) -> bool:
	var fin: String = str(r["fin"])
	return fin == "faillite" or fin == "saisie" or fin == "arrestation"


# LES CIBLES, EN UN SEUL ENDROIT. `_rapport` imprime, `resume` mesure, `verdicts` juge —
# et tests/balayage.gd appelle les deux derniers. Sans cette separation, le balayage aurait
# redecrit les seuils de son cote et aurait fini par juger autre chose que ce fichier :
# c'est exactement la faute que perf.gd avait faite en modelisant les boucles de levier.gd.
static func resume(noms: Array, resultats: Dictionary, n: int) -> Dictionary:
	var perdues: int = 0
	var precoces: int = 0
	var medianes: Dictionary = {}
	var instabilites: Dictionary = {}
	var moyens: Dictionary = {}
	var morts_med: Dictionary = {}
	var mortalites: Dictionary = {}
	var noeuds: Dictionary = {}
	var jalon_douteux: Array = []
	var causes: Dictionary = {}
	for nom: String in noms:
		var propres: Array = []
		var insta: Array = []
		var perdues_bot: int = 0
		for r: Dictionary in resultats[nom]:
			insta.append(float(r["instabilite"]))
			if perdue(r):
				perdues_bot += 1
				perdues += 1
				causes[str(r["fin"])] = int(causes.get(str(r["fin"]), 0)) + 1
				if int(r["fin_tick"]) < SEMAINE_DEMARRAGE:
					precoces += 1
			else:
				propres.append(float(r["cash_propre"]))
		medianes[nom] = mediane(propres)
		instabilites[nom] = mediane(insta)
		moyens[nom] = mediane(_col(resultats[nom], "propre_moyen"))
		# La date de comparaison n'a de sens que si tout le monde est encore en vie. Si un
		# bot meurt avant, l'instantane est sa derniere valeur et la cible 3 change de sens
		# EN SILENCE. Meme vecteur de pourrissement que les dormantes orphelines de
		# levier.gd, et meme reponse : on le dit.
		var morts: Array = []
		for res: Dictionary in resultats[nom]:
			if perdue(res):
				morts.append(float(res["fin_tick"]))
		mortalites[nom] = float(perdues_bot) / float(maxi(n, 1))
		noeuds[nom] = mediane(_col(resultats[nom], "noeuds"))
		morts_med[nom] = mediane(morts) if not morts.is_empty() else -1.0
		if not morts.is_empty() and mediane(morts) < float(SEMAINE_COMPARAISON):
			jalon_douteux.append(nom)
	var gagnants: Dictionary = {}
	for i: int in range(n):
		var meilleur: String = ""
		var score: float = -1e30
		for nom: String in noms:
			var r2: Dictionary = resultats[nom][i]
			var sc: float = -1e20 if perdue(r2) else float(r2["cash_propre"])
			if sc > score:
				score = sc
				meilleur = nom
		gagnants[meilleur] = int(gagnants.get(meilleur, 0)) + 1
	var victoires_max: float = 0.0
	var champion: String = ""
	for nom: String in noms:
		var taux: float = float(gagnants.get(nom, 0)) / float(n)
		if taux > victoires_max:
			champion = nom
		victoires_max = maxf(victoires_max, taux)
	var med_second: float = 0.0
	for nom: String in noms:
		if nom != champion:
			med_second = maxf(med_second, float(medianes.get(nom, 0.0)))
	# L'ECART se mesure a la date commune et sur TOUTES les campagnes, mortes comprises :
	# c'est ce qui le rend evaluable quand un bot ne finit pas la partie.
	var haut: float = 0.0
	var bas: float = 1e30
	for nom: String in noms:
		haut = maxf(haut, float(moyens[nom]))
		bas = minf(bas, float(moyens[nom]))
	var mesurable: bool = bas > 0.0
	var total: float = float(noms.size() * n)
	return {
		"mortalite": float(perdues) / total,
		"precoce": float(precoces) / total,
		"victoires_max": victoires_max,
		"champion": champion,
		"survivants": med_second > 0.0,
		"mesurable": mesurable,
		"ecart": (haut / bas - 1.0) if mesurable else INF,
		"medianes": medianes, "instabilites": instabilites, "jalons": moyens,
		"mortalites": mortalites, "noeuds": noeuds,
		"morts_medianes": morts_med, "jalon_douteux": jalon_douteux,
		"causes": causes, "gagnants": gagnants,
	}


static func _col(liste: Array, cle: String) -> Array:
	var v: Array = []
	for r: Dictionary in liste:
		v.append(float(r[cle]))
	return v


static func verdicts(r: Dictionary) -> Array:
	var v: Array = []
	var m: float = float(r["mortalite"])
	v.append({"cle": "1", "ok": m >= MORTALITE_MIN and m <= MORTALITE_MAX,
		"texte": "mortalite globale lisible : %.0f%% (cible %.0f-%.0f%%)"
			% [m * 100.0, MORTALITE_MIN * 100.0, MORTALITE_MAX * 100.0]})
	v.append({"cle": "2", "ok": float(r["precoce"]) < SEUIL_PRECOCE,
		"texte": "mortalite de demarrage : %.0f%% avant la semaine %d (seuil %.0f%%)"
			% [float(r["precoce"]) * 100.0, SEMAINE_DEMARRAGE, SEUIL_PRECOCE * 100.0]})
	var ec: float = float(r["ecart"])
	var survie: float = ecart_survie(r)
	v.append({"cle": "3", "ok": (float(r["victoires_max"]) <= VICTOIRES_MAX
			or (bool(r["mesurable"]) and ec <= ECART_DOMINATION))
			and survie < SURVIE_DOMINATION,
		"texte": "aucune domination : victoires max %.0f%% - ecart sem %d %s - ecart de survie %.0f%% (seuils %.0f%% / %.0f%% / %.0f%%)"
			% [float(r["victoires_max"]) * 100.0, SEMAINE_COMPARAISON,
			("%+.0f %%" % (ec * 100.0)) if bool(r["mesurable"]) else "n/a",
			survie * 100.0, VICTOIRES_MAX * 100.0, ECART_DOMINATION * 100.0,
			SURVIE_DOMINATION * 100.0]})
	# Cible 23 : uniquement sur les profils qui ne cherchent rien.
	for nom: String in Etat.cles_triees(r["noeuds"]):
		if float(r["noeuds"][nom]) > 0.0:
			continue
		var mort: float = float(r["mortalites"][nom])
		v.append({"cle": "23", "ok": mort <= 1.0 - SURVIE_SANS_RECHERCHE,
			"texte": "la recherche n'est pas un peage : %s ne cherche rien et survit a %.0f%% (seuil %.0f%%)"
				% [nom, (1.0 - mort) * 100.0, SURVIE_SANS_RECHERCHE * 100.0]})
	for nom: String in Etat.cles_triees(CIBLE_7):
		if not (r["instabilites"] as Dictionary).has(nom):
			continue
		var b: Dictionary = CIBLE_7[nom]
		var x: float = float(r["instabilites"][nom])
		v.append({"cle": "7", "ok": x >= float(b["min"]) and x <= float(b["max"]),
			"texte": "instabilite_neuro %s : %.3f (cible %.2f-%.2f)"
				% [nom, x, float(b["min"]), float(b["max"])]})
	return v


# L'ecart entre le bot qui survit le mieux et celui qui survit le moins bien. Un seul bot
# donne 0 : on ne domine personne tout seul.
static func ecart_survie(r: Dictionary) -> float:
	var m: Dictionary = r["mortalites"]
	if m.size() < 2:
		return 0.0
	var haut: float = 0.0
	var bas: float = 1.0
	for nom: String in Etat.cles_triees(m):
		haut = maxf(haut, float(m[nom]))
		bas = minf(bas, float(m[nom]))
	return haut - bas


static func mediane(valeurs: Array) -> float:
	if valeurs.is_empty():
		return 0.0
	var tri: Array = valeurs.duplicate()
	tri.sort()
	return float(tri[floori(float(tri.size()) / 2.0)])


func _rapport(noms: Array, resultats: Dictionary) -> void:
	var echecs: Array[String] = []
	var alertes: Array[String] = []
	var causes: Dictionary = {}
	var medianes: Dictionary = {}
	var instabilites: Dictionary = {}
	for nom: String in noms:
		var liste: Array = resultats[nom]
		var n_p: int = 0
		var propres: Array = []
		var fins: Dictionary = {}
		var semaines_mortes: Array = []
		var signatures: Dictionary = {}
		for r: Dictionary in liste:
			fins[str(r["fin"])] = int(fins.get(str(r["fin"]), 0)) + 1
			# La signature d'une campagne : ce qui la distingue d'une autre graine. Deux
			# graines qui la partagent ont raconte la meme partie. Les SIX colonnes, pas
			# trois : deux campagnes qui ne differeraient que par la visibilite ou par le
			# tas de sale auraient ete declarees jumelles, et l'alerte aurait crie a tort
			# exactement sur le bot dont on surveille la variance.
			signatures["%s|%d|%.0f|%.0f|%.3f|%.1f" % [str(r["fin"]), int(r["fin_tick"]),
				float(r["cash_propre"]), float(r["cash_sale"]), float(r["visibilite"]),
				float(r["kg"])]] = true
			if perdue(r):
				n_p += 1
				causes[str(r["fin"])] = int(causes.get(str(r["fin"]), 0)) + 1
				semaines_mortes.append(float(r["fin_tick"]))
			else:
				propres.append(float(r["cash_propre"]))
		medianes[nom] = mediane(propres)
		instabilites[nom] = mediane(_colonne(liste, "instabilite"))
		# « propre median 0 $ » pour un bot qui ne finit jamais etait un chiffre faux a trois
		# lignes de l'instantane qui, lui, vaut 3.3 M. Un bot mort n'a pas de richesse de
		# fin : on le dit au lieu d'imprimer un zero qui ressemble a une mesure.
		var propre_txt: String = ("%9.0f $" % mediane(propres)) if not propres.is_empty() 			else "      n/a  "
		print("%-12s | perdues %3.0f%% | propre fin %s | sale median %10.0f $ | visibilite med. %5.1f"
			% [nom, 100.0 * float(n_p) / float(liste.size()), propre_txt,
			mediane(_colonne(liste, "cash_sale")), mediane(_colonne(liste, "visibilite"))])
		print("             > instabilite_neuro mediane : %.3f"
			% mediane(_colonne(liste, "instabilite")))
		if not semaines_mortes.is_empty():
			semaines_mortes.sort()
			print("             > morts : semaines %.0f / %.0f / %.0f (min/med/max)"
				% [float(semaines_mortes[0]), mediane(semaines_mortes),
				float(semaines_mortes[semaines_mortes.size() - 1])])
		print("             > fins : %s" % _fins_texte(fins))
		# Un bot sans variance rend ses N graines decoratives : le harnais croit mesurer
		# une distribution et mesure un point. Sans cette ligne, la faiblesse reste
		# invisible parce que rien dans le rapport ne montre que les lignes sont jumelles.
		print("             > graines distinctes : %d/%d" % [signatures.size(), liste.size()])
		if signatures.size() == 1 and liste.size() > 1:
			alertes.append("%s : les %d graines donnent LA MEME campagne — pour ce bot, le harnais mesure un point, pas une distribution"
				% [nom, liste.size()])
	# UNE SEULE VERITE. Ce bloc recalculait victoires, ecart et verdicts de son cote pendant
	# que resume()/verdicts() faisaient la meme chose pour balayage.gd — deux implementations
	# de la meme regle dans le meme fichier, d'accord seulement parce que l'une etait la copie
	# de l'autre. Troisieme fois de ce projet que deux endroits decrivent la meme regle (le
	# budget de perf.gd, le smoke de comparer.gd) ; les deux precedentes ont fini par mentir.
	var r: Dictionary = resume(noms, resultats, n_graines)
	for nom: String in noms:
		print("victoires %-12s : %3.0f%%"
			% [nom, float((r["gagnants"] as Dictionary).get(nom, 0)) / float(n_graines) * 100.0])
	var ecart_txt: String = ("%+.0f %%" % (float(r["ecart"]) * 100.0)) if bool(r["mesurable"]) 		else "n/a (un bot a zero a la semaine %d)" % SEMAINE_COMPARAISON
	print("richesse MOYENNE jusqu'a la semaine %d : %s | ecart %s"
		% [SEMAINE_COMPARAISON, _jalons_texte(noms, r["jalons"]), ecart_txt])
	for nom: String in r["jalon_douteux"]:
		alertes.append("%s meurt en mediane semaine %.0f, AVANT la semaine %d de comparaison : son instantane de richesse est celui d'un mort, et la cible 3 ne mesure plus ce qu'elle annonce"
			% [nom, float(r["morts_medianes"][nom]), SEMAINE_COMPARAISON])
	if not bool(r["survivants"]):
		print("             > un bot ne finit aucune campagne : sa richesse de FIN n'existe pas,")
		print("               d'ou la comparaison a date commune plutot qu'un verdict muet.")

	var perdues_n: float = float(r["mortalite"]) * float(noms.size() * n_graines)
	for verdict: Dictionary in verdicts(r):
		var texte: String = "%s. %s" % [str(verdict["cle"]), str(verdict["texte"])]
		if str(verdict["cle"]) == "1" and perdues_n > 0.0:
			texte += " | morts par %s" % _fins_texte(r["causes"])
		_verdict(echecs, texte, bool(verdict["ok"]))
	# La cible 1 porte sur un TAUX, mais un taux tenu par une seule porte de sortie n'est pas
	# la mortalite que §16 decrit : l'alerte le dit quand le verdict ne peut pas.
	var cause_part: float = 0.0
	var cause_top: String = ""
	for c: String in Etat.cles_triees(r["causes"]):
		var part: float = float((r["causes"] as Dictionary)[c]) / maxf(perdues_n, 1.0)
		if part > cause_part:
			cause_part = part
			cause_top = c
	if perdues_n > 0.0 and cause_part > CAUSE_DOMINANTE:
		alertes.append("%.0f%% des morts sont des %s : le jeu n'a qu'une porte de sortie, et la cible 1 ne le verrait pas"
			% [cause_part * 100.0, cause_top])

	# Les alertes ne font pas echouer : elles disent ce que les cibles ne savent pas voir.
	# Une alerte qu'on laisse trainer trois jalons est une cible qu'on aurait du ecrire.
	for a: String in alertes:
		print("ALERTE %s" % a)
	if echecs.is_empty():
		print("EQUILIBRAGE : TOUTES LES CIBLES ACTIVES SONT ATTEINTES (%d alerte(s))"
			% alertes.size())
		quit(0)
	else:
		for e: String in echecs:
			printerr("CIBLE RATEE : " + e)
		quit(1)


# Une ligne par campagne, sur le disque. Ce n'est PAS une baseline qu'on citera plus tard —
# §16 l'interdit explicitement, « la baseline se remesure, elle ne se cite pas depuis une
# note ancienne ». C'est de quoi DIFFUSER deux mesures fraiches : on relance le harnais sur
# deux commits et on compare les deux fichiers, au lieu de comparer un rapport d'aujourd'hui
# a un souvenir d'il y a trois semaines. La CI le publie en artefact.
func _exporter(noms: Array, resultats: Dictionary) -> void:
	var f: FileAccess = FileAccess.open(CHEMIN_CSV, FileAccess.WRITE)
	if f == null:
		print("(csv non ecrit : %s)" % error_string(FileAccess.get_open_error()))
		return
	f.store_line("bot,graine,fin,fin_sem,cash_propre,cash_sale,visibilite,kg")
	for nom: String in noms:
		var liste: Array = resultats[nom]
		for i: int in range(liste.size()):
			var r: Dictionary = liste[i]
			f.store_line("%s,%d,%s,%d,%.2f,%.2f,%.4f,%.4f"
				% [nom, i + 1, str(r["fin"]), int(r["fin_tick"]), float(r["cash_propre"]),
				float(r["cash_sale"]), float(r["visibilite"]), float(r["kg"])])
	f.close()
	print("csv : %d lignes dans %s" % [noms.size() * n_graines, CHEMIN_CSV])


func _verdict(echecs: Array[String], texte: String, ok: bool) -> void:
	print("%s %s" % ["  OK " if ok else "RATE ", texte])
	if not ok:
		echecs.append(texte)


func _jalons_texte(noms: Array, jalons: Dictionary) -> String:
	var m: PackedStringArray = []
	for nom: String in noms:
		m.append("%s %.0f $" % [nom, float(jalons[nom])])
	return " | ".join(m)


func _fins_texte(fins: Dictionary) -> String:
	var morceaux: PackedStringArray = []
	for cle: String in Etat.cles_triees(fins):
		morceaux.append("%s x%d" % [cle, int(fins[cle])])
	return " ".join(morceaux)


func _colonne(liste: Array, cle: String) -> Array:
	var valeurs: Array = []
	for r: Dictionary in liste:
		valeurs.append(float(r[cle]))
	return valeurs

