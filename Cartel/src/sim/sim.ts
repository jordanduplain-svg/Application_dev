// Raison d'être : LE point d'entrée unique de mutation du state — tick hebdomadaire et
// intentions de l'UI (appliquer) ; personne d'autre n'écrit dans le state.
import { type Dict, clampf, maxf, int, get, str } from "./gd.ts";
import * as Etat from "./state.ts";
import * as Economie from "./economy.ts";
import * as Visibilite from "./visibilite.ts";
import * as Produit from "./produit.ts";
import * as Marche from "./marche.ts";
import * as Recherche from "./recherche.ts";

export function nouvellePartie(graine: number, data: Dict): Dict {
  // Canonisation JSON immédiate : le run « frais » et le run « rechargé » vivent pareil.
  const state = Etat.nouvellePartie(graine, data);
  Marche.initRivaux(state, data);
  return Etat.canonique(state);
}

export function tick(state: Dict, data: Dict): void {
  if (str(state.fin) !== "") return;
  state.tick = Number(state.tick) + 1.0;
  // Les sept specs, calculées UNE fois par tick et passées à qui en a besoin. Les recalculer
  // dans chaque module donnerait deux vérités pour une recette le jour où une formule bouge.
  let specs: Dict = {};
  if (Object.keys(state.recette).length > 0) specs = Produit.specs(state.recette, data);
  const kg = Economie.tickHebdo(state, data, specs);
  // LE SAVOIR-FAIRE S'APPREND APRÈS LA PRODUCTION (§2bis) : c'est la semaine qu'on vient de
  // faire tourner qui enseigne, avec la recette qu'on vient d'utiliser.
  Recherche.apprendre(state, data);
  // La visibilité lit le tas de sale APRÈS le blanchiment de la semaine : ce qui est parti
  // au lavage ne t'accuse plus. L'ordre est une règle de jeu.
  Visibilite.tickHebdo(state, data, kg, Number(get(specs, "signature", 0.0)));
  // Le marché se résout au TRIMESTRE (§4), la production reste hebdomadaire. On vend le
  // stock de la semaine qui vient d'être produite, pas celui d'avant.
  if (int(state.tick) % int(data.constants.sim.semaines_par_trimestre) === 0) {
    Marche.trimestre(state, data, specs);
  }
  if (Number(state.tick) >= Number(data.constants.sim.semaines_max) && str(state.fin) === "") {
    state.fin = "fin_campagne";
  }
  Etat.valider(state);
}

export function appliquer(state: Dict, data: Dict, intention: Dict): boolean {
  if (str(state.fin) !== "") return false;
  switch (str(intention.type)) {
    case "recette": return recette(state, data, intention);
    case "production": return production(state, intention);
    case "prix": return prix(state, data, intention);
    case "recherche": return Recherche.acheter(state, data, str(intention.noeud));
  }
  return false;
}

// Les paramètres de §2, normalisés par src/sim/produit.ts — c'est lui qui connaît les
// plages. Une recette hors bornes n'est pas refusée, elle est ramenée dans le domaine, comme
// un curseur d'écran qui s'arrête en butée.
function recette(state: Dict, data: Dict, intention: Dict): boolean {
  state.recette = Produit.normaliser(get(intention, "recette", {}), data, Recherche.ouvertures(state, data));
  return true;
}

// Le prix est au JOUEUR (§4) : le marché ne le fixe pas, il le juge par `f_prix`. Un prix
// nul veut dire « pas en vente » et sort le produit de la lice de CE segment. Sans
// `segment`, le même prix partout.
function prix(state: Dict, data: Dict, intention: Dict): boolean {
  const prixSeg: Dict = state.prix;
  const valeur = maxf(Number(intention.prix), 0.0);
  const segments: Dict = data.segments.segments;
  if (Object.hasOwn(intention, "segment")) {
    const seg = str(intention.segment);
    if (!Object.hasOwn(segments, seg)) return false;
    prixSeg[seg] = valeur;
    return true;
  }
  for (const seg2 of Object.keys(segments)) prixSeg[seg2] = valeur;
  return true;
}

function production(state: Dict, intention: Dict): boolean {
  state.part_capacite = clampf(Number(intention.part), 0.0, 1.0);
  return true;
}
