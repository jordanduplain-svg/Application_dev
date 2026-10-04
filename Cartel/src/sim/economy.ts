// Raison d'être : le tick hebdomadaire de l'argent — production, les DEUX bourses non
// fongibles (§5), le débit de blanchiment plafonné, l'horloge de la dette (§1bis) et la
// faillite.
//
// ON FABRIQUE TOUTES LES SEMAINES, ON VEND TOUS LES TRIMESTRES (§4) : la vente vit dans
// src/sim/marche.ts, et le stock fait le tampon entre les deux cadences. Ce qui reste ici est
// le drain hebdomadaire — précurseurs, charges fixes, blanchiment, dette, faillite.
import { type Dict, minf } from "./gd.ts";

// Retourne les kg produits cette semaine : la visibilité en a besoin (§7), et c'est la seule
// valeur du tick qui sorte d'ici — personne d'autre n'écrit dans les bourses.
export function tickHebdo(state: Dict, data: Dict, specs: Dict): number {
  const eco = data.constants.eco;
  let kgProduits = 0.0;
  if (Object.keys(specs).length > 0) {
    // Le plafond de production est le DÉBIT de la recette (§2), qui dérive de la capacité du
    // labo mais que le rendement, la complexité et la rareté de la famille rabotent.
    kgProduits = Number(specs.debit_kg_sem) * Number(state.part_capacite);
    payerPrecurseurs(state, kgProduits * Number(specs.cout_unitaire));
    state.stock_kg = Number(state.stock_kg) + kgProduits;
    state.stats.kg_produits = Number(state.stats.kg_produits) + kgProduits;
  }
  // Charges fixes : labo, loyers, salaires déclarés. Il y a un papier, donc c'est du PROPRE.
  state.cash_propre = Number(state.cash_propre) - Number(eco.cout_fixe_sem);
  blanchir(state, data);
  dette(state, data);
  faillite(state, data);
  return kgProduits;
}

// Les précurseurs se paient au marché noir tant que le tas y suffit (§5 : le sale achète du
// précurseur), et au fournisseur déclaré pour le reste — il y a une facture, donc du propre.
// C'est aussi ce qui rend l'amorçage possible : on démarre avec 0 sale.
function payerPrecurseurs(state: Dict, montant: number): void {
  const parLeNoir = minf(Number(state.cash_sale), montant);
  state.cash_sale = Number(state.cash_sale) - parLeNoir;
  state.cash_propre = Number(state.cash_propre) - (montant - parLeNoir);
  state.stats.precurseurs_sale = Number(state.stats.precurseurs_sale) + parLeNoir;
  state.stats.precurseurs_propre = Number(state.stats.precurseurs_propre) + (montant - parLeNoir);
}

// §5 : le blanchiment n'est pas une transaction et aucun bouton ne le déclenche — c'est un
// DÉBIT hebdomadaire plafonné. D'où sa place dans le tick et pas dans Sim.appliquer().
function blanchir(state: Dict, data: Dict): void {
  const cb = data.constants.blanchiment;
  const debit = minf(Number(state.cash_sale), Number(cb.capacite_sem));
  if (debit <= 0.0) return;
  const propre = debit * Number(cb.taux);
  state.cash_sale = Number(state.cash_sale) - debit;
  state.cash_propre = Number(state.cash_propre) + propre;
  state.stats.propre_blanchi = Number(state.stats.propre_blanchi) + propre;
}

// §1bis : en une fois, à la date, en argent PROPRE. Le `>=` (et non `==`) est délibéré — le
// levier déplace l'échéance de ±30 %, et une égalité stricte raterait la semaine décalée.
function dette(state: Dict, data: Dict): void {
  const cd = data.constants.dette;
  if (Number(state.dette) <= 0.0 || Number(state.tick) < Number(cd.echeance_sem)) return;
  if (Number(state.cash_propre) < Number(state.dette)) {
    state.fin = "saisie";
    return;
  }
  state.cash_propre = Number(state.cash_propre) - Number(state.dette);
  state.dette = 0.0;
}

function faillite(state: Dict, data: Dict): void {
  if (Number(state.cash_propre) >= 0.0) {
    state.semaines_rouge = 0.0;
    return;
  }
  state.semaines_rouge = Number(state.semaines_rouge) + 1.0;
  if (Number(state.semaines_rouge) >= Number(data.constants.eco.semaines_faillite)) {
    state.fin = "faillite";
  }
}
