# Raison d'être : RNG maison (LCG 32 bits) vivant dans le state JSON — même graine,
# même campagne, y compris après save/load ; aucun RandomNumberGenerator moteur.
extends RefCounted


static func suivant(state: Dictionary) -> int:
	var s: int = int(state["rng"])
	s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
	# Stocké en float : le state reste canonique JSON (un int divergerait au save/load).
	state["rng"] = float(s)
	return s


static func reel(state: Dictionary) -> float:
	return float(suivant(state)) / 4294967296.0
