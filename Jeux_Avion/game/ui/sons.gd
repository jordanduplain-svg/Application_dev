# Raison d'être : les deux seuls sons du jeu, SYNTHÉTISÉS à la volée — le dépôt ne porte
# aucun asset audio. Un clic sec pour la navigation, une alerte grave quand la trésorerie
# passe au rouge (l'événement le plus critique du jeu, jusqu'ici purement visuel).
extends RefCounted

const TAUX: int = 22050


# Sinus + enveloppe descendante : `descente` élevé = attaque percussive (clic),
# `descente` = 1 = décroissance linéaire (bourdon d'alerte).
static func _ton(freq: float, duree: float, volume: float, descente: float) -> AudioStreamWAV:
	var n: int = int(float(TAUX) * duree)
	var octets := PackedByteArray()
	octets.resize(n * 2)
	for i: int in range(n):
		var t: float = float(i) / float(TAUX)
		var enveloppe: float = pow(1.0 - float(i) / float(n), descente)
		var echantillon: float = sin(TAU * freq * t) * volume * enveloppe
		octets.encode_s16(i * 2, int(clampf(echantillon, -1.0, 1.0) * 32767.0))
	var flux := AudioStreamWAV.new()
	flux.format = AudioStreamWAV.FORMAT_16_BITS
	flux.mix_rate = TAUX
	flux.data = octets
	return flux


static func clic() -> AudioStreamWAV:
	return _ton(880.0, 0.03, 0.22, 2.5)


static func alerte() -> AudioStreamWAV:
	return _ton(196.0, 0.5, 0.45, 1.0)
