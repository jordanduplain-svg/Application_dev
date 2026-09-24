# Raison d'être : les specs ÉMERGENT de la recette — une seule fonction transforme six choix
# bruts (famille, pureté, rendement, complexité, coupe, stabilisation) en sept specs.
# **Aucun curseur ne contrôle directement une spec affichée** (§2).
#
# Structure reprise de `bureau-etudes/sim/aircraft.gd` `specs()` — fonction statique et pure
# sur `(recette, data)`, aucun accès au state, aucun nombre d'équilibrage — contenu
# entièrement réécrit : il n'y a plus un seul avion là-dedans.
#
# `instabilite_neuro` EST ICI DÈS AUJOURD'HUI, et c'est la seule raison pour laquelle ce
# fichier arrive maintenant plutôt qu'au jalon 5. Il ne fait rien pendant tout l'acte I. Il
# est la cause de l'acte III. §2 le dit sans détour : un axe ajouté après coup dans un
# système déjà calibré force à compenser au mauvais endroit, jusqu'à saturation du levier —
# c'est la leçon mesurée sur `bureau-etudes`, et la cible 7 de §16 existe pour la tenir.
extends RefCounted

const Etat := preload("res://sim/state.gd")


# Les six paramètres et leurs plages (§2). Le clamp est un domaine de définition, pas un
# réglage : `pow()` sur une puissance négative ne veut rien dire, et un rendement nul
# diviserait par zéro. Les bornes elles-mêmes viennent de §2 et sont ici parce qu'elles
# décrivent l'écran de conception, pas l'équilibrage — aucune ne se tourne pour équilibrer.
const PURETE_MIN: float = 0.30
const PURETE_MAX: float = 0.99
const RENDEMENT_MIN: float = 0.20
const RENDEMENT_MAX: float = 0.95
const COMPLEXITE_MIN: int = 1
const COMPLEXITE_MAX: int = 5
const COUPE_MAX: float = 0.70
const STABILISATION_MAX: int = 3


# `limites` vient de sim/recherche.gd (§2bis) et RETRECIT les plages ci-dessus : ce que le
# joueur n'a pas encore cherche n'est pas refuse, il est ramene en butee — comme un curseur
# d'ecran qui s'arrete. Vide (le defaut), aucune limite de recherche ne s'applique : c'est
# le cas des RIVAUX et des produits de reference de data/calibration.json, qui ne sont pas
# soumis a l'arbre du joueur. Leur passer ses limites aurait fait dependre le catalogue du
# marche de ce que le joueur a cherche, ce qui n'a aucun sens.
static func normaliser(recette: Dictionary, data: Dictionary,
		limites: Dictionary = {}) -> Dictionary:
	var familles: Dictionary = data["precurseurs"]["familles"]
	var famille: String = str(recette.get("famille", ""))
	var ouvertes: Array = limites.get("familles", []) as Array
	if not familles.has(famille) or (not ouvertes.is_empty() and not ouvertes.has(famille)):
		# La butee d'une famille fermee est la PREMIERE famille ouverte, pas la premiere de
		# data/precurseurs.json : ramener vers une famille que le joueur n'a pas cherchee
		# lui donnerait par accident ce que l'arbre lui refuse.
		# La butee est DECLAREE (data/procedes.json) et non deduite : `ouvertes[0]` apres tri
		# faisait changer le repli a mesure qu'on cherchait. Sans limites (rivaux, produits de
		# reference), on garde la premiere famille du catalogue.
		var defaut: String = str(limites.get("famille_defaut", ""))
		if defaut != "" and familles.has(defaut):
			famille = defaut
		elif ouvertes.is_empty():
			famille = str(Etat.cles_triees(familles)[0])
		else:
			famille = str(ouvertes[0])
	var p_max: float = minf(PURETE_MAX, float(limites.get("purete_max", PURETE_MAX)))
	var c_max: int = mini(COMPLEXITE_MAX, int(limites.get("complexite_max", COMPLEXITE_MAX)))
	var s_max: int = mini(STABILISATION_MAX,
		int(limites.get("stabilisation_max", STABILISATION_MAX)))
	return {
		"famille": famille,
		"purete": clampf(float(recette.get("purete", PURETE_MIN)), PURETE_MIN,
			maxf(p_max, PURETE_MIN)),
		"rendement": clampf(float(recette.get("rendement", RENDEMENT_MIN)),
			RENDEMENT_MIN, RENDEMENT_MAX),
		"complexite": float(clampi(int(recette.get("complexite", COMPLEXITE_MIN)),
			COMPLEXITE_MIN, maxi(c_max, COMPLEXITE_MIN))),
		"coupe": clampf(float(recette.get("coupe", 0.0)), 0.0, COUPE_MAX),
		"stabilisation": float(clampi(int(recette.get("stabilisation", 0)),
			0, maxi(s_max, 0))),
	}


# LES SEPT SPECS. Une recette normalisée entre, sept nombres sortent, rien d'autre n'est lu.
static func specs(recette: Dictionary, data: Dictionary) -> Dictionary:
	var r: Dictionary = normaliser(recette, data)
	var cp: Dictionary = data["constants"]["produit"]
	var eco: Dictionary = data["constants"]["eco"]
	var f: Dictionary = data["precurseurs"]["familles"][str(r["famille"])]
	var purete: float = float(r["purete"])
	var rendement: float = float(r["rendement"])
	var complexite: float = float(r["complexite"])
	var coupe: float = float(r["coupe"])
	var stabilisation: float = float(r["stabilisation"])

	# 1. PUISSANCE — ce qui se vend. La coupe dilue après production : elle fait du volume
	# bon marché au prix de tout le reste.
	var puissance: float = purete * (1.0 - coupe) * float(f["k_famille"])

	# 2. COÛT UNITAIRE — la pureté coûte en CARRÉ (§2), le rendement bas coûte en inverse
	# (on jette ce qu'on ne convertit pas), la complexité et les additifs s'ajoutent.
	#
	# CE QUE LA COMPLEXITÉ ACHÈTE : elle DIVISE le carré de la pureté. C'est la seule chose
	# qu'elle améliore, et sans elle ce curseur n'avait aucune raison d'être bougé — quatre
	# specs dégradées, zéro améliorée. L'intention existait déjà dans l'arbre de §2bis, où
	# `colonne_seche` exige `procede_deux_etapes` : un procédé complexe est ce qui PERMET la
	# haute pureté. À complexité 1 le diviseur vaut 1, donc rien ne bouge pour qui ne
	# recherche pas — la trajectoire du témoin prudent est intacte au dollar près.
	#
	# LA COUPE DIVISE LE COÛT PAR KILO VENDU : on vend plus de kilos pour le même précurseur.
	# C'est le même fait que le débit ci-dessous, pris par l'autre bout.
	var cout_purete: float = 1.0 + float(eco["k_cout_purete"]) * purete * purete \
		/ pow(complexite, float(cp["k_complexite_purete"]))
	var cout: float = (float(f["cout_base_kg"]) \
		* cout_purete \
		* (float(cp["rendement_reference"]) / rendement) \
		* (1.0 + float(cp["k_cout_complexite"]) * (complexite - 1.0)) \
		+ float(cp["cout_stabilisation_kg"]) * stabilisation) * (1.0 - coupe)

	# 3. DÉBIT — ce que le labo sort par semaine, EN KILOS VENDABLES. Un procédé complexe est
	# lent, une famille rare ne s'approvisionne pas à volonté, et la coupe AJOUTE du volume :
	# c'est la seule chose que le mot décrit, et elle manquait. Couper 50 % double les kilos,
	# divise la puissance par deux et le coût par kilo par deux — puissance × volume reste
	# constant, donc c'est un échange pur qualité contre quantité, et c'est exactement ce qui
	# sépare `rue` de `haut_de_gamme`. Aucune constante là-dedans : les deux effets sortent du
	# même fait arithmétique.
	var debit: float = float(eco["capacite_labo_kg_sem"]) * rendement \
		* maxf(1.0 - float(cp["k_debit_complexite"]) * complexite, 0.0) \
		* float(f["disponibilite"]) / maxf(1.0 - coupe, 0.05)

	# 4. SIGNATURE — ce que le produit laisse derrière lui. Elle entre dans la visibilité
	# (§7) multipliée par les kilos : produire peu d'un produit sale peut coûter autant que
	# produire beaucoup d'un produit propre.
	var signature: float = maxf(float(f["tracabilite"])
		* (1.0 + float(cp["k_signature_complexite"]) * complexite)
		- float(cp["k_signature_stabilisation"]) * stabilisation, 0.0)

	# 5. FIABILITÉ DU LOT — la variance de fabrication. La compétence du chimiste arrive
	# avec les bras droits (§6, jalon 4) ; d'ici là tout le monde en a autant.
	var competence: float = float(cp["competence_defaut"])
	# LE RENDEMENT PAIE ICI, et c'est sa seule contrepartie : pousser un procédé à haut
	# rendement, c'est le pousser tout court. Sans ce terme il n'avait AUCUN effet négatif —
	# le monter baissait le coût et montait le débit, point — donc la bonne réponse était
	# toujours le maximum. `fiabilite_lot` est la spec que `milieu` et `haut_de_gamme`
	# pondèrent le plus fort : le rendement s'arbitre désormais contre le segment visé.
	var variance: float = (float(cp["k_variance_purete"]) * purete
		+ float(cp["k_variance_complexite"]) * (complexite - 1.0)
		+ float(cp["k_variance_rendement"]) * rendement) * (1.0 - competence)
	var fiabilite: float = clampf(1.0 - variance, 0.0, 1.0)

	# 6. DÉPENDANCE — ce qui fidélise la demande (§4). Elle punit la coupe deux fois : une
	# fois dans la puissance dont elle dérive, une fois directement.
	var dependance: float = pow(maxf(puissance, 0.0), float(cp["exposant_dependance"])) \
		* (1.0 - coupe)

	# 7. INSTABILITE_NEURO — l'axe le plus important du jeu (§2). Il monte avec la
	# puissance, la stabilisation le rachète à prix fort, et la famille pose son seuil : les
	# familles puissantes sont celles dont le seuil est le plus bas. La recette la plus
	# rentable est donc mécaniquement celle qui charge le plus vite (§8), et le joueur qui
	# diversifie vers le haut de gamme accélère son propre acte III sans l'avoir choisi.
	var instabilite: float = clampf(
		pow(maxf(puissance, 0.0), float(cp["exposant_instabilite"]))
		- float(cp["k_instabilite_stabilisation"]) * stabilisation
		- float(f["seuil_famille"]), 0.0, 1.0)

	return {
		"puissance": puissance,
		"cout_unitaire": cout,
		"debit_kg_sem": debit,
		"signature": signature,
		"fiabilite_lot": fiabilite,
		"dependance": dependance,
		"instabilite_neuro": instabilite,
	}
