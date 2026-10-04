# Raison d'être : les bots stratégiques de §16 — fonctions pures et déterministes du state,
# paramétrées par un dict de stratégie ; ne servent qu'à l'équilibrage par simulation.
# Porté de bureau-etudes/tests/bots.gd (§16 : « ce harnais est mûr, le porter, pas le
# réinventer ») : mêmes conventions, contenu réécrit sur les leviers de Cartel.
#
# DEUX bots ici, pas quatre. `opportuniste` (jalon 3) et `accelerateur` (jalon 5) restent
# dehors jusqu'à leurs jalons : lancer un bot avant que son système existe produit du bruit
# qu'on prendra pour un signal.
#
# RÈGLE DE FIXTURE, apprise en lisant une trace : un bot a le droit de jouer mal, jamais de
# jouer BÊTE. Une stratégie qui perd est un témoin qui fait son travail (§16) ; une qui
# achète des précurseurs pour produire ce que personne n'achètera ne mesure pas le jeu,
# elle mesure la faute de celui qui l'a écrite — et le harnais prend alors cette faute pour
# de l'équilibrage. Les trois gardes ci-dessous (écoulable, soutenable, payable) sont là
# pour ça, et aucune ne lit quoi que ce soit qu'un joueur ne verrait pas sur son écran.
extends RefCounted

const Sim := preload("res://sim/sim.gd")
const Produit := preload("res://sim/produit.gd")
const Etat := preload("res://sim/state.gd")
const Recherche := preload("res://sim/recherche.gd")


# Les nombres de ce fichier ne sont PAS de l'équilibrage : ce sont des fixtures. Un bot est
# un profil-témoin, et un témoin qui perd fait son travail (§16). Les constantes du jeu,
# elles, vivent toutes dans data/constants.json et data/precurseurs.json.
#
# Chaque bot pose maintenant une RECETTE COMPLÈTE : les six paramètres de §2. C'est là que
# les deux profils se séparent pour de bon — pas sur un curseur de volume, mais sur ce
# qu'ils fabriquent.
static func strategies() -> Dictionary:
	return {
		# « petit volume, produit propre, jamais d'épidémie » (§16). Famille banale et
		# surveillée, pureté basse, coupe généreuse : un produit de rue. Sa puissance est
		# faible, donc son `instabilite_neuro` est écrasé par le seuil élevé du Verdal — il
		# ne déclenchera jamais rien, et c'est exactement son rôle de témoin.
		# Il rembourse la dette et lève le pied (§1bis), et ne produit jamais plus qu'il ne
		# peut blanchir : son tas reste plat, donc invisible (§5, §7).
		"discret": {
			"recette": {
				"famille": "verdal",
				"purete": 0.45,
				"rendement": 0.75,
				"complexite": 1,
				# COUPE RAMENEE A ZERO le jour ou couper a rapporte des KILOS (§2). Ce 0.35
				# avait ete choisi sous un modele ou la coupe etait un handicap pur : elle
				# diluait la puissance et ne donnait rien, donc elle disait « produit de rue
				# bon marche » et rien d'autre. Depuis, elle multiplie le volume vendable et
				# divise le cout par kilo — c'est devenu un levier de VOLUME, exactement le
				# contraire de ce que ce temoin represente (« petit volume, produit propre »).
				# Mesure : a 0.35 il produisait 54 % de kilos en plus, sa jauge montait a 103
				# et il se faisait arreter semaine 150. Un temoin qui se contredit lui-meme ne
				# temoigne de rien. La cible 23 qui repasse au vert est la CONSEQUENCE, pas
				# la raison : c'est l'intention ecrite de ce bot qui a ete restauree.
				"coupe": 0.0,
				"stabilisation": 0,
			},
			# MARGE GELEE — ne pas tourner pour faire passer une cible.
			# Elle a d'abord valu 1.45, reconduite aveuglement de `bureau-etudes` ou un avion
			# se vend pres de son cout : les deux bots vendaient A PERTE. Puis 3.90, choisie
			# parce que +13 % passait sous le seuil de 15 % de la cible 3 — c'est-a-dire en
			# reglant la fixture QUE LA CIBLE MESURE, ce qui rend la cible circulaire.
			# 4.0 est un nombre rond, tenu pour ce qu'il est : un marchand de rue prend x4
			# sur un produit coupe. Si la cible 3 rougit, c'est le JEU qu'on ajuste.
			"marge": 4.00,
			"part_capacite": 0.60,
			"part_apres_dette": 0.30,
			"plafonne_sur_blanchiment": true,
			# IL NE CHERCHE RIEN, et ce n'est pas un oubli : §2bis promet qu'une partie
			# entiere est jouable sans rien chercher — « plus pauvre, plus discrete,
			# parfaitement viable » — et dit que c'est SA trajectoire. Une liste vide est
			# donc la fixture qui met cette phrase a l'epreuve (cible 23 de §16). Sa
			# recette tient entierement dans `ouvertures_depart` : verdal, purete 0.45
			# sous le plafond de 0.60, complexite 1, aucune stabilisation.
			"recherche": [],
			# Un trimestre de charges fixes en reserve. Le marche paie tous les 13 semaines
			# (§4) et les precurseurs se paient toutes les semaines : sans ce coussin, le
			# temoin mourait semaine 28 — d'un probleme de TRESORERIE, pas d'economie, et
			# le harnais aurait mesure mon imprudence au lieu du jeu.
			"reserve_propre": 60000.0,
		},
		# « gros volume, produit puissant » (§16). Famille rare, pureté haute, presque pas
		# de coupe, aucune stabilisation : la recette qui se vend le plus cher ET qui charge
		# le plus vite (§8). C'est le profil qui découvre que tout ce qui rapporte rend
		# visible (§1) — et il ne regarde ni son tas ni sa jauge.
		"industriel": {
			# Corymbe et pas Noctal, complexite 2 et pas 3 : la premiere version de cette
			# recette visait la cible 7 sans regarder ce qu'elle laissait comme DEBIT —
			# 7 kg/sem, soit un « gros volume » incapable de produire quoi que ce soit. Le
			# levier l'a dit sans detour : la jauge de visibilite ENTIERE ressortait
			# debranchee, parce que le seul bot cense se faire remarquer n'avait plus de
			# quoi se faire remarquer.
			"recette": {
				"famille": "corymbe",
				"purete": 0.95,
				"rendement": 0.60,
				"complexite": 2,
				"coupe": 0.05,
				"stabilisation": 0,
			},
			# MARGE GELEE, meme regle. x2 sur un produit haut de gamme dont le cout est deja
			# cinq fois celui de la rue : il vend moins cher en MULTIPLE et bien plus cher
			# en valeur, ce qui est exactement ce que `haut_de_gamme` recompense.
			"marge": 2.00,
			"part_capacite": 1.0,
			"part_apres_dette": 1.0,
			"plafonne_sur_blanchiment": false,
			# L'ORDRE EST LA STRATEGIE. Sa recette cible (corymbe, purete 0.95,
			# complexite 2) est INTERDITE au depart : il commence donc en verdal a 0.60,
			# c'est-a-dire tout pres du temoin prudent, et grimpe. C'est ce que §2bis
			# decrit — la recherche ouvre des choix, elle ne donne pas de bonus — et c'est
			# la premiere fois que les deux profils partent du meme produit.
			# IL QUITTE LE PRECURSEUR SURVEILLE D'ABORD, et c'est la mesure qui a impose
			# cet ordre contre mon premier choix. J'avais mis la purete en tete en me
			# disant que le plafond de 0.60 bridait plus fort. Mesure : il restait 50
			# semaines sur du Verdal a plein regime — `tracabilite` 0.55 contre 0.28 au
			# Corymbe, et `disponibilite` 1.0 contre 0.78, donc PLUS de traces sur PLUS de
			# kilos — et se faisait arreter semaine 62 sur 260. En prenant la famille
			# d'abord, sa signature tombe de moitie des la semaine 18.
			# Ce n'est pas un reglage pour faire passer une cible : c'est la difference
			# entre un temoin qui joue mal (son droit) et un temoin qui joue bete (jamais).
			# DANS LA GRILLE (§2bis), le meme ordre devient un CHEMIN : chaque case doit
			# toucher le centre ou une case deja prise. Le plus court vers purete 0.99 passe
			# par les quatre cases de la veine Purete — Filtration et Recristallisation
			# sont les deux paliers que l'arbre n'avait pas.
			"recherche": ["extraction_azurite", "synthese_corymbe", "filtration",
				"raffinage_court", "procede_deux_etapes", "recristallisation",
				"colonne_seche"],
			"reserve_propre": 60000.0,
		},
		# LES DEUX TEMOINS DES CHOIX DE CONCEPTION (data/conception.json). Ils sont nes le
		# jour ou la grille a gagne ses cases de jonction : vingt cases sur vingt-sept ne
		# servaient a aucun temoin, donc le harnais ne voyait plus que le tiers de la
		# recherche. Leur INTENTION est ecrite ici avant toute mesure, et c'est elle qui
		# fixe leurs nombres — pas les cibles. Un temoin qui perd fait son travail (§16).
		#
		# « La rue en gros : coupe, fidelise, vendu pas cher. » Il pousse tout ce qui fait du
		# kilo — rendement, coupe, gros lots — et prend l'agent exaltant pour que la coupe
		# fidelise au lieu de diluer. Il ne regarde ni son tas ni sa jauge.
		"grossiste": {
			"recette": {
				"famille": "verdal",
				"purete": 0.45,
				"rendement": 0.95,
				"complexite": 1,
				"coupe": 0.70,
				"stabilisation": 0,
				"cadence": "gros_lots",
				"agent": "exaltant",
			},
			# MARGE GELEE, meme regle que les deux autres. x3 : il casse les prix de la rue,
			# le multiple d'un grossiste qui vit de son volume.
			"marge": 3.00,
			"part_capacite": 1.0,
			"part_apres_dette": 1.0,
			"plafonne_sur_blanchiment": false,
			# Le CHEMIN de la veine Volume, puis les deux jonctions qui la touchent. L'agent
			# enrobant n'est pas son choix : c'est la case par laquelle on atteint l'exaltant
			# depuis son bras, et il la paie comme un joueur la paierait.
			"recherche": ["cuves_larges", "charges_neutres", "gros_lots", "charges_lourdes",
				"cuves_en_serie", "agent_enrobant", "agent_exaltant"],
			"reserve_propre": 60000.0,
		},
		# « Petit volume haut de gamme, qui se protege de tout. » Le contraire
		# d'`industriel` sur le seul axe qui les separe : il stabilise, il signe peu
		# (cristaux), il dose regulierement (petits lots) et il tamponne ses lots pour
		# fideliser une clientele rare. Il va moins haut en purete parce qu'il paie sa
		# protection avant sa puissance.
		"orfevre": {
			"recette": {
				"famille": "corymbe",
				"purete": 0.90,
				"rendement": 0.45,
				"complexite": 2,
				"coupe": 0.0,
				"stabilisation": 2,
				"forme": "cristaux",
				"cadence": "petits_lots",
				"marquage": 1,
			},
			# MARGE GELEE. x2.5 : entre l'industriel (x2, haut de gamme en volume) et la rue
			# (x4) — un artisan qui vend peu et cher.
			"marge": 2.50,
			"part_capacite": 0.50,
			"part_apres_dette": 0.50,
			"plafonne_sur_blanchiment": true,
			# LA PROTECTION D'ABORD, toute la protection : le Liant gris (instabilite) puis la
			# Cristallisation (signature), atteinte par le procede en deux etapes. La
			# premiere version mettait les cristaux en fin de liste, contre l'intention ecrite
			# deux lignes plus haut — et la mesure a montre qu'il ne les atteignait jamais.
			# Puis la famille, la purete, et ce qui fidelise.
			"recherche": ["liant_gris", "procede_deux_etapes", "cristallisation",
				"extraction_azurite", "synthese_corymbe", "filtration", "raffinage_court",
				"recristallisation", "liant_ambre", "petits_lots", "tampon_de_maison"],
			"reserve_propre": 60000.0,
		},
	}


static func agir(state: Dictionary, data: Dictionary, strat: Dictionary) -> void:
	# LA RECETTE CIBLE EST REPOSEE A CHAQUE SEMAINE, et plus seulement au tick 0. Depuis
	# §2bis elle est RAMENEE EN BUTEE par ce que la recherche a ouvert : la reposer est la
	# seule facon qu'un noeud livre serve a quelque chose. Tant que rien ne bouge dans
	# l'arbre, elle se renormalise a l'identique — c'est ce qui a permis de verifier que
	# `discret`, qui ne cherche rien, n'a pas bouge d'un dollar.
	Sim.appliquer(state, data, {"type": "recette",
		"recette": _recette_jouable(state, data, strat)})
	_chercher(state, data, strat)
	var recette: Dictionary = state["recette"]
	if recette.is_empty():
		return
	var specs: Dictionary = Produit.specs(recette, data)
	# Le prix est au joueur depuis §4, et un bot le pose comme un joueur prudent : une marge
	# fixe sur son cout, multipliee par le niveau du segment (§19.6). REPOSE quand le cout
	# change : une recette qui monte en gamme et garde son ancien prix vendrait a perte, ce
	# qui mesurerait ma faute et pas le jeu.
	#
	# LA COMPARAISON SE FAIT SUR LE PRIX DEJA POSE, et pas sur un champ memo. La premiere
	# version rangeait `cout_pose` DANS LE STATE : une fixture de test qui ecrit dans l'etat
	# du jeu (§13 : `sim/` est le seul a y ecrire), qui part dans la sauvegarde et que
	# l'empreinte de determinisme hache. L'information etait deja la — `state["prix"]` EST
	# le memo, il suffisait de le relire.
	if not _prix_a_jour(state, data, strat, specs):
		_poser_prix(state, data, strat, specs)
	# Le plafond n'est plus la capacité du labo mais le DÉBIT de la recette (§2) : un
	# procédé complexe sur une famille rare ne remplit pas un labo, et le bot le sait parce
	# que le joueur le lirait sur son écran de conception.
	var debit: float = float(specs["debit_kg_sem"])
	var part: float = float(strat["part_capacite"])
	# L'échéance passée, le témoin lève le pied : il a payé, il ne cherche pas la suite.
	if float(state["dette"]) <= 0.0:
		part = float(strat["part_apres_dette"])
	var kg: float = debit * part
	kg = minf(kg, _ecoulable(state, data, specs))
	if bool(strat["plafonne_sur_blanchiment"]):
		kg = minf(kg, _soutenable(state, data, specs))
	kg = minf(kg, _payable(state, data, strat, specs))
	Sim.appliquer(state, data, {"type": "production", "part": kg / maxf(debit, 1e-6)})


# LA RECETTE QU'IL PEUT REELLEMENT FABRIQUER. Il vise toujours sa famille cible, mais tant
# qu'elle est fermee il prend LA DERNIERE QU'IL A OUVERTE SUR SON PROPRE CHEMIN — sa liste
# de recherche est sa preference, lue a l'envers.
#
# Pourquoi ce n'est pas au clamp de `sim/produit.gd` de le faire : la butee est un filet de
# securite, pas un chemin de jeu. Elle etait `ouvertes[0]` apres tri alphabetique, donc
# `industriel` recevait Azurite entre ses semaines 56 et 70 — par chance, parce que « a »
# vient avant « v ». En declarant la butee (Verdal, stable), il repartait sur le precurseur
# le plus tracable et mourait dix semaines plus tot. Les deux comportements etaient des
# accidents : l'un heureux, l'autre non. Un joueur, lui, choisit — et son ecran ne lui
# propose que ce qu'il a ouvert (§12bis).
static func _recette_jouable(state: Dictionary, data: Dictionary,
		strat: Dictionary) -> Dictionary:
	var recette: Dictionary = (strat["recette"] as Dictionary).duplicate()
	var ouvertes: Array = Recherche.ouvertures(state, data)["familles"]
	if ouvertes.has(str(recette["famille"])):
		return recette
	var acquis: Dictionary = state["recherche"]["acquis"]
	var noeuds: Dictionary = data["procedes"]["noeuds"]
	var liste: Array = strat["recherche"]
	for i: int in range(liste.size() - 1, -1, -1):
		var id: String = str(liste[i])
		if not acquis.has(id):
			continue
		var ouvre: Dictionary = noeuds[id]["ouvre"]
		if ouvre.has("famille") and ouvertes.has(str(ouvre["famille"])):
			recette["famille"] = str(ouvre["famille"])
			return recette
	# Rien d'ouvert sur son chemin : le filet declare s'en occupe.
	return recette


# Le prix affiche correspond-il encore au cout courant ? On recalcule ce qu'on POSERAIT et
# on le compare a ce qui est pose. Un dictionnaire vide (rien n'a jamais ete pose) repond
# non, ce qui est le cas du premier tick.
static func _prix_a_jour(state: Dictionary, data: Dictionary, strat: Dictionary,
		specs: Dictionary) -> bool:
	var prix: Dictionary = state["prix"]
	if prix.is_empty():
		return false
	var base: float = float(specs["cout_unitaire"]) * float(strat["marge"])
	var segments: Dictionary = data["segments"]["segments"]
	for nom_seg: String in Etat.cles_triees(segments):
		var niveau: float = float((segments[nom_seg] as Dictionary).get("niveau_prix", 1.0))
		if not is_equal_approx(float(prix.get(nom_seg, -1.0)), base * niveau):
			return false
	return true


# LA RECHERCHE (§2bis) : les prochaines cases de la liste, achetees des qu'elles sont
# payables.
#
# LA DETTE N'EST JAMAIS DEPENSEE. C'est la meme regle que `_payable` pour les precurseurs,
# appliquee a la seule autre depense en propre qui existe : on ne lance pas un chantier
# avec l'argent qu'on doit. Consequence mesuree et assumee : `industriel` ne cherche rien
# avant la semaine 60, parce que le jeu ne lui en laisse pas les moyens.
#
# TROIS VERSIONS, ET LES DEUX PREMIERES ONT ETE REFUTEES PAR LA MESURE.
#   1. « la dette est immobilisee des la semaine 1 » : le bot ne cherchait rien avant la
#      semaine 60, restait a plein regime sur le precurseur le plus tracable, arrete sem 79.
#   2. « on projette le blanchiment d'ici l'echeance » : projection depuis la semaine 1,
#      donc treize semaines de lavage comptees alors que rien n'etait encore vendu. Saisi
#      semaine 60, 54 000 $ court.
#   3. « on projette depuis la PREMIERE RENTREE » : saisi semaine 60 lui aussi. La
#      projection ignorait la sortie de propre du desert — treize semaines de precurseurs
#      payes sans une vente — qui est du meme ordre que la dette elle-meme.
# RETOUR A LA VERSION 1, et l'aveu qui va avec : j'ai tourne trois fois un nombre de
# FIXTURE, ce que ce fichier interdit en toutes lettres. La version 1 est la seule qui ne
# suppose rien. Sa consequence — `industriel` ne cherche rien avant la semaine 60 — n'est
# pas un defaut de ce garde, c'est un CONSTAT SUR LE JEU : la dette de l'acte I (§1bis)
# mange tout le budget de recherche de la premiere annee. C'est une phrase sur §1bis contre
# §2bis, et elle appartient au GDD, pas a un reglage de temoin.
#
# L'ACHAT EST INSTANTANE depuis la grille (§2bis) : le bot prend dans l'ordre de sa liste
# autant de cases qu'il peut en payer cette semaine, et s'arrete a la premiere qu'il ne
# peut pas s'offrir. Il ne saute pas une case trop chere pour prendre la suivante : sa
# liste est un chemin, et la case suivante ne touche peut-etre rien de ce qu'il possede.
static func _chercher(state: Dictionary, data: Dictionary, strat: Dictionary) -> void:
	var acquis: Dictionary = state["recherche"]["acquis"]
	for id: Variant in (strat["recherche"] as Array):
		if acquis.has(str(id)):
			continue
		var cout: float = Recherche.cout(state, data, str(id))
		var garde: float = float(strat["reserve_propre"]) + float(state["dette"])
		if float(state["cash_propre"]) - cout < garde:
			return
		if not Sim.appliquer(state, data, {"type": "recherche", "noeud": str(id)}):
			return


# LE PRIX, un par segment (§19bis) : cout x marge GELEE du bot x niveau_prix du segment.
#
# AUCUN NOUVEAU NOMBRE DE FIXTURE ICI, et c'est delibere. Ecrire trois marges par bot
# m'aurait fait inventer six chiffres dans le fichier meme qui interdit de tourner ses
# nombres pour faire passer une cible. Le facteur vient de data/segments.json, ou il est la
# declaration du tableau de §4 (« rue : bas, haut de gamme : tres eleve ») — donc un datum
# de jeu, balaye par le levier comme les autres, et non un reglage de temoin.
#
# Ce que le bot fait la, un joueur le ferait en regardant son ecran : il demande plus cher
# ou le client regarde moins le prix. Un bot a le droit de jouer mal, jamais de jouer bete.
static func _poser_prix(state: Dictionary, data: Dictionary, strat: Dictionary,
		specs: Dictionary) -> void:
	var base: float = float(specs["cout_unitaire"]) * float(strat["marge"])
	var segments: Dictionary = data["segments"]["segments"]
	for nom_seg: String in Etat.cles_triees(segments):
		var niveau: float = float((segments[nom_seg] as Dictionary).get("niveau_prix", 1.0))
		Sim.appliquer(state, data, {"type": "prix", "segment": nom_seg,
			"prix": base * niveau})


# Ce qui partira au prochain trimestre, ramené à la semaine : la demande des trois
# segments pondérée par la part que le bot y détient, moins ce qui dort déjà en stock.
# Sans ce garde, `industriel` produisait à plein débit contre une demande deux fois plus
# petite et empilait des centaines de kilos d'invendus — des précurseurs payés pour rien,
# et un harnais qui mesurait cette dépense-là au lieu de l'économie du jeu.
#
# Au tout premier trimestre le bot n'a encore aucune part : il suppose la part égale entre
# maisons, ce qu'un joueur suppose aussi faute de mieux. Sans ce plancher il ne produirait
# rien, donc ne vendrait rien, donc n'aurait jamais de part — un blocage de démarrage que
# le marché ne peut pas dénouer tout seul.
static func _ecoulable(state: Dictionary, data: Dictionary, _specs: Dictionary) -> float:
	var sem: float = float(data["constants"]["sim"]["semaines_par_trimestre"])
	return maxf(float(_attendu(state, data)["kg"]) - float(state["stock_kg"]), 0.0) / sem


# CE QUE LE PROCHAIN TRIMESTRE VA PRENDRE, et a quel prix : la demande de chaque segment
# ponderee par la part qu'on y detient. Les deux gardes ci-dessous lisent la meme chose, et
# c'est important qu'ils lisent la MEME — `_ecoulable` en tire un volume, `_soutenable` un
# prix moyen, et les laisser estimer chacun de son cote aurait donne deux idees differentes
# du meme trimestre dans le meme bot.
#
# Au tout premier trimestre le bot n'a encore aucune part : il suppose la part egale entre
# maisons, ce qu'un joueur suppose aussi faute de mieux. Sans ce plancher il ne produirait
# rien, donc ne vendrait rien, donc n'aurait jamais de part — un blocage de demarrage que
# le marche ne peut pas denouer tout seul.
static func _attendu(state: Dictionary, data: Dictionary) -> Dictionary:
	var maisons: float = float((state["rivaux"] as Dictionary).size()) + 1.0
	var segments: Dictionary = data["segments"]["segments"]
	var kg: float = 0.0
	var recette: float = 0.0
	for nom_seg: String in Etat.cles_triees(segments):
		var etat: Dictionary = (state["marche"] as Dictionary).get(nom_seg, {})
		var parts: Dictionary = etat.get("parts", {})
		var part: float = float(parts.get("joueur", 1.0 / maisons)) if not parts.is_empty() 			else 1.0 / maisons
		var v: float = (float(segments[nom_seg]["demande_base_trim"])
			+ float(etat.get("demande_fidele", 0.0))) * part
		kg += v
		recette += v * float((state["prix"] as Dictionary).get(nom_seg, 0.0))
	return {"kg": kg, "prix": recette / maxf(kg, 1e-6)}


# « Je ne produis pas plus que je ne peux blanchir. » Au-dessus de ce débit, chaque kg
# supplémentaire n'ajoute pas du propre : il ajoute du SALE qui s'entasse, et le tas se
# paie en visibilité chaque semaine (§5). C'est la seule phrase de stratégie de tout ce
# fichier, et elle sort directement du circuit fermé de §5.
#
# LE PRIX EST CELUI QU'IL VA RECEVOIR, pondéré par les segments qu'il sert — pas celui d'un
# segment choisi d'avance. Quand §19bis a donné un prix à chaque segment, ce garde lisait le
# prix le plus BAS, en se disant prudent. Il ne l'était pas : prudent sur la PRODUCTION,
# certes, mais la phrase parle du TAS, et le tas grossit au prix encaissé. Le bot gagnait
# 1,6× ce qu'il croyait sur le haut de gamme, dépassait son blanchiment sans le voir, et la
# mortalité est passée de 50 % à 100 % en une mesure. Un garde qui se trompe « du bon côté »
# sur la mauvaise grandeur ne protège de rien.
static func _soutenable(state: Dictionary, data: Dictionary, specs: Dictionary) -> float:
	var marge: float = float(_attendu(state, data)["prix"]) - float(specs["cout_unitaire"])
	return float(data["constants"]["blanchiment"]["capacite_sem"]) / maxf(marge, 1.0)


# Discipline d'achat : on ne lance pas une semaine de précurseurs qu'on ne peut pas payer.
# Sans ce garde, le bot creuse son propre (les précurseurs manquants y basculent, §5) et
# meurt d'une faute de gestion qu'aucun joueur ne commettrait.
static func _payable(state: Dictionary, data: Dictionary, strat: Dictionary,
		specs: Dictionary) -> float:
	var bourse: float = float(state["cash_sale"]) \
		+ maxf(float(state["cash_propre"]) - float(strat["reserve_propre"]), 0.0)
	return bourse / maxf(float(specs["cout_unitaire"]), 1.0)
