# Raison d'être : les ateliers de série — capacité trimestrielle par paliers,
# agrandissement payant et lent (anticiper la demande fait partie du jeu).
# Les ingénieurs affectés au poste atelier grattent quelques appareils par trimestre.
extends RefCounted

const Ingenieurs := preload("res://sim/engineers.gd")
const Comptes := preload("res://sim/comptes.gd")


# Plafond du « shadow scheme » : actif tant que l'échéance n'est pas passée. Publique —
# les écrans Marché et Direction l'affichent, et doivent lire la MÊME règle que la sim.
static func plafond_actif(state: Dictionary) -> bool:
	if not bool(state.get("plafond_atelier", false)):
		return false
	return float(state["tick"]) < float(state.get("plafond_atelier_fin", 0.0))


# Semaines restantes avant la fin du plan (0 si aucun plafond).
static func plafond_reste_sem(state: Dictionary) -> float:
	if not plafond_actif(state):
		return 0.0
	return maxf(float(state.get("plafond_atelier_fin", 0.0)) - float(state["tick"]), 0.0)


static func capacite(state: Dictionary, data: Dictionary) -> float:
	var paliers: Array = data["constants"]["eco"]["paliers_atelier"]
	var base: float = float(paliers[int(state["atelier"]["palier"]) - 1])
	# Usine bombardée : la capacité du trimestre est amputée au prorata des semaines perdues
	# (13 semaines de dégâts = plus rien ne sort). Voir sim/bombardements.gd.
	var perdues: float = clampf(float(state.get("degats_sem", 0.0)), 0.0, 13.0)
	base *= (13.0 - perdues) / 13.0
	# floor : on livre des appareils entiers, pas des fractions.
	return floorf(base * (1.0 + Ingenieurs.bonus(state, data, "atelier")))


static func tick_hebdo(state: Dictionary) -> void:
	var at: Dictionary = state["atelier"]
	if float(at["chantier_sem"]) > 0.0:
		at["chantier_sem"] = float(at["chantier_sem"]) - 1.0
		if float(at["chantier_sem"]) <= 0.0:
			at["chantier_sem"] = 0.0
			at["palier"] = float(at["palier"]) + 1.0


static func agrandir(state: Dictionary, data: Dictionary) -> bool:
	var eco: Dictionary = data["constants"]["eco"]
	var at: Dictionary = state["atelier"]
	var palier: int = int(at["palier"])
	var paliers: Array = eco["paliers_atelier"]
	# Nationalisations acceptées (événement 1936) : l'atelier est plafonné à vie.
	if plafond_actif(state):
		return false
	if float(at["chantier_sem"]) > 0.0 or palier >= paliers.size():
		return false
	var cout: float = float(eco["cout_palier"][palier])
	if float(state["tresorerie"]) < cout:
		return false
	state["tresorerie"] = float(state["tresorerie"]) - cout
	Comptes.note(state, "atelier", -cout)
	state["stats"]["autres_cumules"] = float(state["stats"]["autres_cumules"]) - cout
	at["chantier_sem"] = float(eco["delai_palier_sem"][palier])
	return true
