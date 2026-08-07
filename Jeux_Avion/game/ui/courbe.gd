# Raison d'être : la courbe de trésorerie du livre des comptes — un tracé, un axe zéro
# rouge. Extraite de main.gd (elle y était une classe interne) le jour où l'écran Comptes
# a eu besoin de la même courbe : deux appelants, un seul dessin.
extends Control

const Palette := preload("res://game/ui/palette.gd")

var points: Array = []


func _draw() -> void:
	if points.size() < 2:
		return
	var bas: float = 0.0
	var haut: float = 1.0
	for v: Variant in points:
		bas = minf(bas, float(v))
		haut = maxf(haut, float(v))
	var etendue: float = maxf(haut - bas, 1.0)
	var y_zero: float = size.y - size.y * (0.0 - bas) / etendue
	draw_line(Vector2(0.0, y_zero), Vector2(size.x, y_zero), Palette.ROUGE_ALERTE, 1.0)
	var ligne := PackedVector2Array()
	for i: int in range(points.size()):
		ligne.append(Vector2(size.x * float(i) / float(points.size() - 1),
			size.y - size.y * (float(points[i]) - bas) / etendue))
	draw_polyline(ligne, Palette.BLEU_CYANOTYPE, 1.0)
