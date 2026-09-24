# Raison d'être : la jauge 1/3 (§7) — ce que les autorités savent de toi. C'est
# bureau-etudes/sim/reputation.gd avec le SIGNE INVERSÉ (§13) : là-bas on cherchait à
# monter, ici toute montée est une menace.
#
# Périmètre jalon 0 : deux termes de traces sur sept. Les voyages d'engins, les actifs à
# quai, la saturation de marché, les événements et l'infection des nœuds arrivent avec
# leurs jalons (2, 3, 5) — chacun s'ajoute ICI le jour où son sous-système naît, jamais
# rétro-ajouté après coup.
extends RefCounted


static func tick_hebdo(state: Dictionary, data: Dictionary, kg_produits: float,
		signature: float) -> void:
	var cv: Dictionary = data["constants"]["visibilite"]
	# §7 : `signature_produit × kg_produits_sem`. La SIGNATURE (§2) est arrivée avec
	# sim/produit.gd, et elle change la nature de ce terme : produire peu d'un produit sale
	# peut coûter plus cher en attention que produire beaucoup d'un produit propre.
	# 1e6 n'est pas un nombre d'équilibrage : c'est l'unité de la formule de §5
	# (« par million de cash_sale »). Le levier, c'est k_cash_sale.
	var traces: float = float(cv["k_volume"]) * signature * kg_produits \
		+ float(cv["k_cash_sale"]) * (float(state["cash_sale"]) / 1e6)
	# decroissance = (2.0 + bonus_contacts) × capacite_institutionnelle (§7). Les contacts
	# (§5bis, jalon 3) et l'instabilité mondiale (§9, jalon 5) manquent : le terme est nu.
	var v: float = maxf(float(state["visibilite"]) + traces - float(cv["decroissance_sem"]), 0.0)
	state["visibilite"] = v
	if v < float(cv["seuil_arrestation"]):
		state["semaines_traque"] = 0.0
		return
	state["semaines_traque"] = float(state["semaines_traque"]) + 1.0
	if float(state["semaines_traque"]) >= float(cv["semaines_arrestation"]):
		state["fin"] = "arrestation"
