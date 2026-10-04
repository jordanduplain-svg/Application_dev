// Raison d'être : la jauge 1/3 (§7) — ce que les autorités savent de toi. C'est la
// réputation de `bureau-etudes` avec le SIGNE INVERSÉ (§13) : là-bas on cherchait à monter,
// ici toute montée est une menace.
//
// Périmètre jalon 1 : deux termes de traces sur sept. Les voyages d'engins, les actifs à
// quai, la saturation de marché, les événements et l'infection des nœuds arrivent avec leurs
// jalons (2, 3, 5) — chacun s'ajoute ICI le jour où son sous-système naît.
import { type Dict, maxf } from "./gd.ts";

export function tickHebdo(state: Dict, data: Dict, kgProduits: number, signature: number): void {
  const cv = data.constants.visibilite;
  // §7 : `signature_produit × kg_produits_sem` : produire peu d'un produit sale peut coûter
  // plus cher en attention que produire beaucoup d'un produit propre. 1e6 n'est pas un
  // nombre d'équilibrage : c'est l'unité de la formule de §5 (« par million de cash_sale »).
  const traces = Number(cv.k_volume) * signature * kgProduits
    + Number(cv.k_cash_sale) * (Number(state.cash_sale) / 1e6);
  // decroissance = (2.0 + bonus_contacts) × capacite_institutionnelle (§7). Les contacts
  // (§5bis, jalon 3) et l'instabilité mondiale (§9, jalon 5) manquent : le terme est nu.
  const v = maxf(Number(state.visibilite) + traces - Number(cv.decroissance_sem), 0.0);
  state.visibilite = v;
  if (v < Number(cv.seuil_arrestation)) {
    state.semaines_traque = 0.0;
    return;
  }
  state.semaines_traque = Number(state.semaines_traque) + 1.0;
  if (Number(state.semaines_traque) >= Number(cv.semaines_arrestation)) state.fin = "arrestation";
}
