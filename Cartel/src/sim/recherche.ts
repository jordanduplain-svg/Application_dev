// Raison d'être : §2bis — la recherche en GRILLE D'HEXAGONES, à la Plague Inc. On achète une
// case voisine de ce qu'on possède, en `cash_propre` ET en savoir-faire de son bras,
// instantanément ; chaque case acquise renchérit les suivantes de sa branche. Ce qu'une case
// livre n'est JAMAIS un nombre : c'est une borne ou une option de l'écran de conception (§2).
//
// AUCUN NOMBRE D'ÉQUILIBRAGE DANS CE FICHIER (§14) : coûts, inflation, grille, savoir-faire
// et ouvertures de départ vivent tous dans data/procedes.json.
//
// LA PROMESSE QUE CE FICHIER DOIT TENIR, et c'est la seule de §2bis qui puisse être fausse en
// silence : **la recherche n'est jamais un prérequis de survie.** C'est la trajectoire du bot
// `discret`, et la cible 23 de §16 la mesure campagne par campagne.
import { type Dict, clampf, maxf, get, str, clesTriees } from "./gd.ts";
import { PURETE_MIN, RENDEMENT_MIN, COMPLEXITE_MIN } from "./produit.ts";

// Ce qu'une case peut ouvrir. La liste est FERMÉE, et c'est elle qui rend vraie la phrase
// « elle ne donne aucun bonus numérique direct » (§2bis) : une clé de plus dans un `ouvre` de
// data/procedes.json et la promesse tombe, sans qu'une ligne de code change. Le test de
// structure la vérifie contre le fichier de données.
export const OUVERTURES = ["famille", "purete_max", "rendement_max", "complexite_max",
  "coupe_max", "stabilisation_max", "marquage_max", "forme", "agent", "cadence"];
export const BORNES = ["purete_max", "rendement_max", "complexite_max", "coupe_max",
  "stabilisation_max", "marquage_max"];
// Les ouvertures qui AJOUTENT une option à une liste, comme une famille.
export const LISTES: Dict = { famille: "familles", forme: "formes", agent: "agents", cadence: "cadences" };

// Les six voisins d'une case en coordonnées axiales. De la géométrie, pas de l'équilibrage.
const VOISINS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

// Le minimum de chaque curseur, pour la proximité du savoir-faire : les bornes de domaine de
// src/sim/produit.ts, pas de l'équilibrage.
const BORNES_MIN: Dict = {
  purete: PURETE_MIN, rendement: RENDEMENT_MIN, complexite: COMPLEXITE_MIN, coupe: 0.0, stabilisation: 0.0,
};

// Ce que le joueur a le droit de concevoir AUJOURD'HUI : les ouvertures de départ, élargies
// par chaque case acquise. Les bornes se prennent au PLUS LARGE — c'est ce qui rend les
// raccourcis de la grille honnêtes : sauter une case de veine donne la borne de la case
// atteinte, ni plus, ni moins.
export function ouvertures(state: Dict, data: Dict): Dict {
  const depart = data.procedes.ouvertures_depart;
  const limites: Dict = {
    familles: [...depart.familles],
    formes: [...depart.formes],
    agents: [...depart.agents],
    cadences: [...depart.cadences],
    // LA BUTÉE NE S'ÉLARGIT PAS : un repli qui suit la recherche est un repli décidé par
    // l'alphabet (voir data/procedes.json).
    famille_defaut: str(depart.famille_defaut),
  };
  for (const cle of BORNES) limites[cle] = Number(depart[cle]);
  const noeuds = data.procedes.noeuds;
  for (const id of Object.keys(state.recherche.acquis)) {
    if (!Object.hasOwn(noeuds, id)) continue;
    const ouvre: Dict = noeuds[id].ouvre;
    for (const cleL of Object.keys(LISTES)) {
      const liste: string[] = limites[LISTES[cleL]];
      if (Object.hasOwn(ouvre, cleL) && !liste.includes(str(ouvre[cleL]))) liste.push(str(ouvre[cleL]));
    }
    for (const cle2 of BORNES) {
      if (Object.hasOwn(ouvre, cle2)) limites[cle2] = maxf(Number(limites[cle2]), Number(ouvre[cle2]));
    }
  }
  for (const cleT of Object.keys(LISTES)) (limites[LISTES[cleT]] as string[]).sort();
  return limites;
}

// "q,r" -> [q, r]. Les coordonnées sont des chaînes dans le JSON pour échapper au levier.
export function lireCase(texte: string): number[] {
  const [q, r] = texte.split(",");
  return [Math.trunc(Number(q)) + 0, Math.trunc(Number(r)) + 0];
}

export function voisines(a: number[], b: number[]): boolean {
  return VOISINS.some((v) => a[0] + v[0] === b[0] && a[1] + v[1] === b[1]);
}

// Les cases achetables : non acquises, et qui TOUCHENT le centre ou une case acquise. Il
// n'est pas dit ici si elles sont PAYABLES : un écran qui masquerait ce qu'on ne peut pas
// s'offrir cacherait l'objectif (§12bis).
export function disponibles(state: Dict, data: Dict): string[] {
  return clesTriees(data.procedes.noeuds).filter((id) => estDisponible(state, data, id));
}

// La même question pour UNE case : `acheter` la pose à chaque tentative, et les bots
// retentent chaque semaine tant que le savoir-faire manque.
export function estDisponible(state: Dict, data: Dict, id: string): boolean {
  const acquis: Dict = state.recherche.acquis;
  const noeuds: Dict = data.procedes.noeuds;
  if (Object.hasOwn(acquis, id) || !Object.hasOwn(noeuds, id)) return false;
  const ici = lireCase(str(noeuds[id].case));
  if (voisines(ici, lireCase(str(data.procedes.centre)))) return true;
  for (const acq of Object.keys(acquis)) {
    if (Object.hasOwn(noeuds, acq) && voisines(ici, lireCase(str(noeuds[acq].case)))) return true;
  }
  return false;
}

// LE PRIX DU JOUR : chaque case déjà acquise dans la même branche le renchérit (§2bis).
// C'est l'inflation qui freine la montée — une case prise par curiosité rend toutes les
// autres plus chères.
export function cout(state: Dict, data: Dict, id: string): number {
  const noeuds: Dict = data.procedes.noeuds;
  const branche = str(noeuds[id].branche);
  let n = 0;
  for (const acq of Object.keys(state.recherche.acquis)) {
    if (Object.hasOwn(noeuds, acq) && str(noeuds[acq].branche) === branche) n++;
  }
  return Number(noeuds[id].cout_propre) * (1.0 + Number(data.procedes.inflation_par_acquis) * n);
}

// L'ACHAT EST INSTANTANÉ (§2bis, à la Plague Inc). Ni chantier, ni remboursement, ni
// dé-évolution : une case achetée est de l'argent et de l'expérience dépensés.
export function acheter(state: Dict, data: Dict, id: string): boolean {
  if (!estDisponible(state, data, id)) return false;
  const noeud = data.procedes.noeuds[id];
  const prix = cout(state, data, id);
  // EN PROPRE, et c'est le cœur de §2bis : le sale n'achète rien d'enregistré (§5). D'où le
  // fait que le rythme de la recherche soit étranglé par le blanchiment.
  if (Number(state.cash_propre) < prix) return false;
  // ET EN SAVOIR-FAIRE DU BRAS, et seulement du sien : l'expérience de la coupe n'achète pas
  // de la pureté. Pas d'inflation ici — le temps passé à apprendre freine déjà.
  const bras = str(noeud.bras);
  const savoir: Dict = state.recherche.savoir;
  const exige = Number(noeud.cout_savoir);
  if (Number(get(savoir, bras, 0.0)) < exige) return false;
  state.cash_propre = Number(state.cash_propre) - prix;
  savoir[bras] = Number(savoir[bras]) - exige;
  state.recherche.acquis[id] = 1.0;
  state.stats.propre_recherche = Number(state.stats.propre_recherche) + prix;
  return true;
}

// LE SAVOIR-FAIRE S'APPREND EN PRODUISANT (§2bis), une fois par semaine, après la
// production. Chaque bras n'apprend que de ses propres curseurs, d'autant plus qu'ils sont
// près de leur plafond ACTUEL. PAR SEMAINE, pondéré par la part de capacité, et pas par kilo :
// un petit labo plein apprend aussi vite qu'une usine pleine. Ne touche à AUCUNE bourse.
export function apprendre(state: Dict, data: Dict): void {
  const recette: Dict = state.recette;
  const part = clampf(Number(state.part_capacite), 0.0, 1.0);
  if (Object.keys(recette).length === 0 || part <= 0.0) return;
  const cs = data.procedes.savoir;
  const lim = ouvertures(state, data);
  const savoir: Dict = state.recherche.savoir;
  for (const bras of Object.keys(cs.bras)) {
    if (bras.startsWith("_")) continue;
    const b = cs.bras[bras];
    let meilleure = 0.0;
    for (const curseur of get(b, "curseurs", []) as string[]) {
      meilleure = maxf(meilleure, proximite(recette, lim, str(curseur), Number(cs.seuil_proximite)));
    }
    if (Boolean(get(b, "famille_avancee", false))
      && str(get(recette, "famille", "")) === familleAvancee(lim, data)) {
      meilleure = 1.0;
    }
    savoir[bras] = Number(get(savoir, bras, 0.0)) + part * meilleure * Number(cs.gain_semaine);
  }
}

// Où est ce curseur entre son minimum et son plafond du jour, ramené de [seuil, 1] vers
// [0, 1]. Un plafond encore égal au minimum ne donne rien : être en butée d'un palier unique
// ne coûte rien et ne prouve rien.
export function proximite(recette: Dict, lim: Dict, curseur: string, seuil: number): number {
  const mini = Number(BORNES_MIN[curseur]);
  const plafond = Number(lim[curseur + "_max"]);
  if (plafond - mini <= 1e-9) return 0.0;
  const pos = clampf((Number(get(recette, curseur, mini)) - mini) / (plafond - mini), 0.0, 1.0);
  return clampf((pos - seuil) / maxf(1.0 - seuil, 1e-9), 0.0, 1.0);
}

// La famille ouverte la plus puissante (plus fort `k_famille`) — celle qu'on « maîtrise »
// pour avancer dans la veine Familles. Égalité tranchée par l'ordre trié : déterministe.
export function familleAvancee(lim: Dict, data: Dict): string {
  const familles = data.precurseurs.familles;
  let meilleure = "";
  let kMax = -1.0;
  for (const f of lim.familles as string[]) {
    const k = Number(familles[str(f)].k_famille);
    if (k > kMax) {
      kMax = k;
      meilleure = str(f);
    }
  }
  return meilleure;
}
