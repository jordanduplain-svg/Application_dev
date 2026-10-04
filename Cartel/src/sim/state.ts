// Raison d'être : construction du state initial (100 % JSON), sérialisation canonique
// (clés triées, pleine précision) et garde-fous de fin de tick (NaN, bornes, bourses).
// Porté de sim/state.gd (Godot), lui-même porté de bureau-etudes (§13 : socle, tel quel) —
// seul le CONTENU du state change. Pas d'équivalent de `AN0` ici : l'horloge de Cartel est
// interne, la semaine 1 n'est aucune date réelle (§1).
//
// Ce fichier ne touche PAS au disque : la simulation doit tourner telle quelle dans
// l'interface (navigateur d'Electron). Lire les data/*.json et hacher un state vivent dans
// src/sim/disque.ts, côté Node.
import { type Dict, absf, maxf } from "./gd.ts";

// La liste grandit d'un jalon à l'autre (§14 : precurseurs, procedes, graphe, vehicules…).
// Le chargeur (disque.ts) crie si l'une manque, plutôt que de laisser un `data` à moitié
// vide traverser tout le harnais.
export const FICHIERS_DATA: string[] = ["constants", "precurseurs", "calibration", "segments",
  "rivaux", "procedes", "conception"];

export function nouvellePartie(graine: number, data: Dict): Dict {
  const eco = data.constants.eco;
  const dette = data.constants.dette;
  return {
    rng: graine >>> 0,
    graine: graine >>> 0,
    tick: 0.0,
    fin: "",
    // LES DEUX BOURSES (§5) : séparées ici comme partout ailleurs. Rien dans ce fichier,
    // ni dans le harnais, ne les additionne — pas même pour calculer « la richesse ».
    cash_propre: Number(eco.cash_propre_depart),
    cash_sale: Number(eco.cash_sale_depart),
    // L'horloge de l'acte I (§1bis) : le RESTANT dû, remboursable en propre à l'échéance.
    dette: Number(dette.montant),
    semaines_rouge: 0.0,
    visibilite: 0.0,
    semaines_traque: 0.0,
    stock_kg: 0.0,
    // La recette : les paramètres de §2. Elle reste VIDE tant que personne n'en a posé une
    // — aucune valeur de départ en dur, et aucune constante de départ que les bots
    // écraseraient au tick 0 (ce serait un levier mort-né).
    // `ponytail:` UNE recette à la fois au jalon 1. Le catalogue de trois (§2) arrive avec
    // les lignes de production du jalon 2.
    recette: {},
    // Part du débit de la recette effectivement lancée en production cette semaine.
    part_capacite: 0.0,
    // UN PRIX PAR SEGMENT (§4, §19bis) : nom_segment -> $/kg. Absent ou 0 = on ne vend pas
    // là ; le marché ne met en lice que ce qui a une recette ET un prix, donc se retirer
    // d'un segment est une décision, pas un cas dégénéré. C'est ce qui rend le marché
    // opérant : OÙ partent les kilos est la décision de l'acte I.
    prix: {},
    // Le marché (§4) : nom_segment -> {parts, demande_fidele, ventes_joueur}. Les parts
    // sont par MAISON (le joueur en est une) et se déplacent avec inertie.
    marche: {},
    // Les deux cartels (§4). Le troisième emplacement reste vide jusqu'à la première
    // trahison (§6, jalon 4).
    rivaux: {},
    // LA RECHERCHE (§2bis) : les cases acquises de la grille et le savoir-faire par BRAS
    // (nommés dans data/procedes.json). `acquis` est un dictionnaire et non une liste pour
    // que la sérialisation canonique le trie — l'ordre d'acquisition ne fait pas partie de
    // l'état du jeu. Le savoir-faire n'est pas une bourse : rien ne le convertit en argent.
    recherche: { acquis: {}, savoir: savoirVide(data) },
    stats: {
      kg_produits: 0.0, kg_vendus: 0.0, sale_encaisse: 0.0,
      propre_blanchi: 0.0, precurseurs_sale: 0.0, precurseurs_propre: 0.0,
      propre_recherche: 0.0,
    },
  };
}

function savoirVide(data: Dict): Dict {
  const savoir: Dict = {};
  for (const bras of Object.keys(data.procedes.savoir.bras)) {
    if (!bras.startsWith("_")) savoir[bras] = 0.0;
  }
  return savoir;
}

// JSON à clés TRIÉES à tous les niveaux : deux campagnes identiques produisent deux textes
// identiques, quel que soit l'ordre dans lequel le code a inséré les clés. Les nombres
// sortent à la précision la plus courte qui se relit à l'identique (JSON.stringify le
// garantit) — là où Godot perdait le dernier ULP au round-trip.
export function serialiser(state: unknown): string {
  return JSON.stringify(state, (_cle, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const trie: Dict = {};
      for (const k of Object.keys(v).sort()) trie[k] = v[k];
      return trie;
    }
    return v;
  });
}

export function canonique(state: Dict): Dict {
  return JSON.parse(serialiser(state));
}

// Équivalence à epsilon près : le contrat save/load est « même campagne à 1e-9 relatif ».
// En JavaScript le round-trip JSON est exact au bit, donc ce garde est plus large que
// nécessaire — il est gardé tel quel pour que le test signifie la même chose qu'avant.
export function equivalents(a: unknown, b: unknown): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" && typeof b === "number") {
    return absf(a - b) <= maxf(1e-6, 1e-9 * maxf(absf(a), absf(b)));
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => equivalents(v, b[i]));
  }
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a as Dict);
    if (ka.length !== Object.keys(b as Dict).length) return false;
    return ka.every((k) => Object.hasOwn(b as Dict, k) && equivalents((a as Dict)[k], (b as Dict)[k]));
  }
  return a === b;
}

class InvariantViole extends Error {}

function exiger(condition: boolean, message: string): void {
  if (!condition) throw new InvariantViole(message);
}

// Les garde-fous de fin de tick. Godot les retirait des builds exportés (assert) ; ici ils
// tournent toujours, parce qu'ils coûtent peu en JavaScript et qu'un NaN doit crier là où il
// naît, pas trois écrans plus loin.
export function valider(state: Dict): void {
  sain(state, "state");
  // Le sale ne se découvre pas à découvert : on ne dépense que ce qu'on a physiquement (§5).
  exiger(Number(state.cash_sale) >= -1e-6, "cash_sale négatif");
  exiger(Number(state.stock_kg) >= -1e-6, "stock négatif");
  exiger(Number(state.visibilite) >= 0.0, "visibilité hors bornes");
  exiger(Number(state.dette) >= 0.0, "dette négative");
  for (const nomSeg of Object.keys(state.prix)) {
    exiger(Number(state.prix[nomSeg]) >= 0.0, "prix négatif sur " + nomSeg);
  }
  // Σ parts = 1 sur tout segment ouvert : c'est l'invariant que `bureau-etudes` a payé cher
  // pour apprendre, et il crie ici plutôt que trois écrans plus loin.
  for (const nomSeg of Object.keys(state.marche)) {
    const parts: Dict = state.marche[nomSeg].parts;
    const uids = Object.keys(parts);
    if (uids.length === 0) continue;
    let somme = 0.0;
    for (const uid of uids) somme += Number(parts[uid]);
    exiger(absf(somme - 1.0) < 0.001, "somme des parts != 1 dans " + nomSeg);
  }
  exiger(Number(state.cash_propre) > -1e12, "trésorerie propre absurde");
  for (const bras of Object.keys(state.recherche.savoir)) {
    exiger(Number(state.recherche.savoir[bras]) >= 0.0, "savoir-faire négatif : " + bras);
  }
}

// DEUX PASSES, et la première ne fabrique aucune chaîne : construire le chemin de CHAQUE
// valeur à CHAQUE tick pour ne s'en servir qu'en cas d'échec coûtait, sous Godot, la moitié
// d'un tick. Le parcours détaillé ne tourne que si le rapide a trouvé quelque chose.
function sain(valeur: unknown, chemin: string): void {
  if (sainRapide(valeur)) return;
  sainDetail(valeur, chemin);
}

function sainRapide(valeur: unknown): boolean {
  if (typeof valeur === "number") return Number.isFinite(valeur);
  if (Array.isArray(valeur)) return valeur.every(sainRapide);
  if (valeur && typeof valeur === "object") return Object.values(valeur).every(sainRapide);
  return true;
}

function sainDetail(valeur: unknown, chemin: string): void {
  if (typeof valeur === "number") {
    exiger(!Number.isNaN(valeur), "NaN : " + chemin);
    exiger(Number.isFinite(valeur), "Inf : " + chemin);
  } else if (Array.isArray(valeur)) {
    valeur.forEach((v, i) => sain(v, `${chemin}[${i}]`));
  } else if (valeur && typeof valeur === "object") {
    for (const [k, v] of Object.entries(valeur)) sain(v, chemin + "." + k);
  }
}
