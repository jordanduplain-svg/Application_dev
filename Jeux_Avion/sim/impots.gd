# Raison d'être : l'impôt sur les surprofits de guerre (Excess Profits Duty — 100 % au
# Royaume-Uni en 1940, ramené à 80 % ensuite). Sans lui, une maison qui a bien joué termine
# la partie sur un magot que rien ne peut employer : 75 M£ au playtest n°7, et plus aucune
# décision à prendre. Avec lui, thésauriser cesse d'être une stratégie — l'argent doit
# repartir en usines, en recherche et en équipe, sinon Whitehall le prend.
#
# S'appuie sur le journal comptable (`Comptes`) : le bénéfice imposable est le RÉSULTAT de
# l'exercice écoulé, pas la trésorerie — on ne taxe pas un capital, on taxe un profit.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Comptes := preload("res://sim/comptes.gd")


# Appelée au passage d'année (sim.gd). L'exercice imposé est celui qui vient de se clore.
static func tick_annuel(state: Dictionary, data: Dictionary) -> void:
	if not (data["constants"] as Dictionary).has("impots"):
		return
	var ci: Dictionary = data["constants"]["impots"]
	var annee: float = Etat.AN0 + float(state["tick"]) / 52.0
	var close: int = int(annee) - 1
	if float(close) < float(ci["annee_debut"]) or float(close) > float(ci["annee_fin"]):
		return
	var journal: Dictionary = Comptes.journal(state)
	var cle: String = "%d" % close
	if not journal.has(cle):
		return
	var resultat: float = float(Comptes.totaux(journal[cle])["resultat"])
	var imposable: float = resultat - float(ci["franchise"])
	if imposable <= 0.0:
		return
	# On ne prélève jamais plus que ce qu'il y a en caisse : l'impôt ne fait pas la faillite,
	# il empêche l'accumulation (c'est un plafond de fortune, pas une exécution).
	var du: float = minf(imposable * float(ci["taux"]), maxf(float(state["tresorerie"]), 0.0))
	if du <= 0.0:
		return
	state["tresorerie"] = float(state["tresorerie"]) - du
	Comptes.note(state, "impots", -du)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - du
	(state["presse"] as Array).append({"titre": "L'IMPÔT SUR LES BÉNÉFICES DE GUERRE",
		"corps": "Exercice %d : %d £ de profits au-delà de la franchise, %d £ versés au Trésor. Le pays ne veut pas de millionnaires du réarmement." \
			% [close, int(imposable), int(du)]})
