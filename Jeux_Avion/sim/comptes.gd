# Raison d'être : le journal comptable — chaque mouvement d'argent de la sim y dépose sa
# ligne, classée par POSTE et par ANNÉE. C'est ce qui manquait pour répondre à « où est
# passé mon argent ? » : les compteurs `stats` sont cumulatifs et mélangent tout dans
# « autres » (playtest n°7 : faillite en 1936 sans que le joueur puisse voir que deux
# trimestres de série d'État avaient coupé ses ventes).
#
# `note()` n'écrit QUE le journal : la trésorerie reste modifiée par l'appelant, à côté.
# Deux écritures séparées plutôt qu'un guichet unique — un journal incomplet reste un bug
# d'affichage, un guichet unique bogué serait un bug d'économie.
extends RefCounted

const Etat := preload("res://sim/state.gd")

# Ordre d'affichage du livret ; le libellé vit dans l'UI (sim/ ne connaît pas la langue).
const POSTES: Array = [
	"ventes", "contrats", "entretien", "epreuves", "brevets", "occasion", "banque", "conseil",
	"production", "charges", "prototypes", "recherche", "atelier", "equipe", "publicite",
	"impots",
	"evenements",
]


static func journal(state: Dictionary) -> Dictionary:
	# ponytail: migration à la volée, comme Essais.tous — les vieux saves n'ont pas la clé.
	if not state.has("comptes"):
		state["comptes"] = {}
	return state["comptes"]


# Un mouvement : signe + pour une recette, − pour une dépense. L'année est celle du tick,
# en TEXTE (clé JSON) — la relecture d'un save trie les clés, `Etat.cles_triees` suffit.
static func note(state: Dictionary, poste: String, montant: float) -> void:
	if montant == 0.0:
		return
	var annee: String = "%d" % int(Etat.AN0 + float(state["tick"]) / 52.0)
	var j: Dictionary = journal(state)
	if not j.has(annee):
		j[annee] = {}
	var exercice: Dictionary = j[annee]
	exercice[poste] = float(exercice.get(poste, 0.0)) + montant


# Totaux d'un exercice (recettes, dépenses, résultat) — publics : le livret les affiche
# sans redupliquer la règle de signe.
static func totaux(exercice: Dictionary) -> Dictionary:
	var recettes: float = 0.0
	var depenses: float = 0.0
	for poste: String in Etat.cles_triees(exercice):
		var v: float = float(exercice[poste])
		if v >= 0.0:
			recettes += v
		else:
			depenses += v
	return {"recettes": recettes, "depenses": depenses, "resultat": recettes + depenses}
