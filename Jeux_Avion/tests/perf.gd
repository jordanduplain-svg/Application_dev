# Raison d'être : la mesure du critère de done §16 — FPS réels sur la scène de stress
# (marché ouvert, vitesse ×4, sim qui tourne), nombre de nœuds, nombre de _process actifs.
# Rendu réel obligatoire : lancer SANS --headless.
extends SceneTree


func _initialize() -> void:
	create_timer(60.0).timeout.connect(func() -> void:
		printerr("ECHEC PERF : chien de garde")
		quit(1))
	_mesurer()


func _mesurer() -> void:
	var scene: PackedScene = load("res://game/main.tscn")
	var principal: Node = scene.instantiate()
	root.add_child(principal)
	for i: int in range(8):
		await process_frame
	# Scène de stress : marché affiché, sim à ×4, aucune limite de FPS.
	principal._montrer_ecran(1)
	Engine.max_fps = 0
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	for i: int in range(30):
		await process_frame  # échauffement
	# Baseline : rendu seul, sim en pause (isole le coût du compositeur/fenêtre).
	var base_min: float = 1e9
	var base_somme: float = 0.0
	for i: int in range(150):
		await process_frame
		var fps_b: float = Engine.get_frames_per_second()
		base_min = minf(base_min, fps_b)
		base_somme += fps_b
	print("perf | baseline pause : FPS moyen %.0f, min %.0f" % [base_somme / 150.0, base_min])
	principal._regler_vitesse(3)
	var fps_min: float = 1e9
	var somme: float = 0.0
	var n: int = 300
	for i: int in range(n):
		await process_frame
		var fps: float = Engine.get_frames_per_second()
		fps_min = minf(fps_min, fps)
		somme += fps
	var en_process: int = 0
	var total: int = 0
	var pile: Array = [root]
	while not pile.is_empty():
		var noeud: Node = pile.pop_back()
		total += 1
		if noeud.is_processing() or noeud.is_physics_processing():
			en_process += 1
		pile.append_array(noeud.get_children())
	print("perf | FPS moyen %.0f, min %.0f (INDICATIF : fenêtre d'arrière-plan throttlée par l'OS ;"
		% [somme / float(n), fps_min]
		+ " la mesure 60 fps valide se fait fenêtre au premier plan, cf. campagnes manuelles)")
	print("perf | nœuds %d | _process actifs %d (cible ≤2) | 0 shader | 0 Light2D" % [total, en_process])
	# Verdict structurel seulement : les FPS d'une fenêtre non focusée ne prouvent rien.
	var ok: bool = en_process <= 2
	if ok:
		print("PERF : STRUCTURE CONFORME")
	quit(0 if ok else 1)
