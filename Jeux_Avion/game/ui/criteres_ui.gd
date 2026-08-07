# Raison d'être : représentation partagée « étoiles d'importance » des critères de
# segment — utilisée par le bureau (avec flèche de comparaison au design) et le marché
# (vue d'ensemble sans design précis). Les poids/réfs restent en data, jamais affichés bruts.
extends RefCounted

const NOMS: Dictionary = {
	"fiabilite": "fiabilité", "autonomie": "autonomie", "cout": "coût", "vitesse": "vitesse",
	"capacite": "capacité", "reputation": "réputation", "armement": "armement",
}


static func nom(crit_nom: String) -> String:
	# Fonction statique : pas de self, donc TranslationServer.translate et non tr().
	return String(TranslationServer.translate(str(NOMS.get(crit_nom, crit_nom))))


static func etoiles(poids: float) -> String:
	return "★★★" if poids >= 0.3 else ("★★" if poids >= 0.2 else "★")


# Critères d'un segment triés par importance décroissante (le plus lourd d'abord).
static func tries(seg: Dictionary) -> Array:
	var t: Array = (seg["criteres"] as Array).duplicate()
	t.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a["poids"]) > float(b["poids"]))
	return t


# [spec, seuil de signifiance, gabarit] — l'ordre est l'ordre d'affichage.
const DELTAS_AFFICHES: Array = [
	["vmax_kmh", 1.0, "%+d km/h"],
	["fiabilite", 0.005, "%+d pt fiab"],
	["autonomie_km", 25.0, "%+d km d'autonomie"],
	["plafond_m", 150.0, "%+d m plafond"],
	["maniabilite", 1.0, "%+d mania"],
	["capacite", 1.0, "%+d pax"],
	["armement", 1.0, "%+d arme"],
]


# Résumé compact d'un delta de specs (retour de Avion.delta_feature) : les 3 effets
# significatifs les plus prioritaires + le surcoût unitaire. "" si tout est négligeable.
static func resume_delta(delta: Dictionary) -> String:
	var morceaux: Array = []
	for ligne: Array in DELTAS_AFFICHES:
		if morceaux.size() >= 3:
			break
		var v: float = float(delta.get(str(ligne[0]), 0.0))
		if absf(v) < float(ligne[1]):
			continue
		if str(ligne[0]) == "fiabilite":
			v *= 100.0
		morceaux.append(String(TranslationServer.translate(str(ligne[2]))) % int(roundf(v)))
	var cout: float = float(delta.get("cout_unitaire", 0.0))
	if absf(cout) >= 500.0:
		morceaux.append("%+d £" % int(roundf(cout)))
	return " · ".join(morceaux)
