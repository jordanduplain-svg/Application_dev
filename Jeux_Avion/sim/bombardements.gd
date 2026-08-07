# Raison d'être : la Luftwaffe sur vos chaînes. Septembre 1940, les usines Supermarine de
# Woolston sont rasées ; la production du Spitfire survit parce qu'elle avait été DISPERSÉE
# dans des garages et des ateliers de province, décidés des mois plus tôt. C'est exactement
# le dilemme qu'on veut : une grande usine produit plus ET se voit de plus loin, la parade
# coûte cher et doit être achetée AVANT le premier raid.
#
# Sans ça, la fin de partie n'était plus qu'une formalité : produire en masse, encaisser
# (75 M£ au playtest n°7). Ici, le magot a enfin un emploi et l'atelier une fragilité.
#
# RNG seedé comme les accidents, et TIRÉ SEULEMENT quand le risque existe (guerre + palier
# suffisant) : avant 1940 le flux aléatoire est bit-identique à celui d'avant cette mécanique.
extends RefCounted

const Etat := preload("res://sim/state.gd")
const Rng := preload("res://sim/rng.gd")


static func dispersion(state: Dictionary) -> bool:
	return bool(state.get("dispersion", false))


# Semaines pendant lesquelles l'atelier tourne au ralenti (0 = intact). Publique : l'UI
# l'affiche, et `Production.capacite` la lit pour amputer la capacité.
static func degats_sem(state: Dictionary) -> float:
	return maxf(float(state.get("degats_sem", 0.0)), 0.0)


# Probabilité qu'un raid touche vos chaînes ce trimestre — publique pour que l'écran
# Direction affiche le risque RÉEL et non une estimation qui pourrait diverger.
static func risque(state: Dictionary, data: Dictionary) -> float:
	if not (data["constants"] as Dictionary).has("bombardements"):
		return 0.0
	var cb: Dictionary = data["constants"]["bombardements"]
	var annee: float = Etat.AN0 + float(state["tick"]) / 52.0
	if annee < float(cb["annee_debut"]) or annee > float(cb["annee_fin"]):
		return 0.0
	# Une usine de 64 appareils ne se cache pas : le risque suit la CAPACITÉ du palier.
	var paliers: Array = data["constants"]["eco"]["paliers_atelier"]
	var cap: float = float(paliers[int(state["atelier"]["palier"]) - 1])
	var p: float = float(cb["base"]) + cap * float(cb["par_appareil_capacite"])
	if dispersion(state):
		p *= float(cb["mult_disperse"])
	return clampf(p, 0.0, float(cb["proba_max"]))


static func trimestre(state: Dictionary, data: Dictionary) -> void:
	# Les dégâts en cours se résorbent, que l'on soit bombardé à nouveau ou non.
	if float(state.get("degats_sem", 0.0)) > 0.0:
		state["degats_sem"] = maxf(float(state["degats_sem"]) - 13.0, 0.0)
	var p: float = risque(state, data)
	if p <= 0.0:
		return
	if Rng.reel(state) >= p:
		return
	var cb: Dictionary = data["constants"]["bombardements"]
	var sem: float = float(cb["degats_sem"])
	var corps: String = "Vos chaînes sont touchées : %d semaines de production perdues, le temps de déblayer et de remonter les gabarits."
	if dispersion(state):
		sem *= float(cb["degats_mult_disperse"])
		corps = "Un raid frappe l'usine principale, mais l'essentiel des chaînes est dispersé en province : %d semaines seulement de production perdues."
	state["degats_sem"] = degats_sem(state) + sem
	(state["presse"] as Array).append({"titre": "RAID SUR VOS USINES",
		"corps": corps % int(sem)})


# Disperser les chaînes : cher, irréversible, et surtout INUTILE une fois l'usine en ruines —
# c'est une assurance, elle s'achète avant. Payée depuis sim.gd (qui possède la trésorerie).
static func cout_dispersion(data: Dictionary) -> float:
	return float(data["constants"]["bombardements"]["cout_dispersion"])
