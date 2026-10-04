// Raison d'être : harnais d'équilibrage de §16 — N graines × les bots disponibles,
// distribution des fins et verdicts chiffrés contre les cibles du GDD. On ajuste data/,
// jamais le code. Port de tests/balance.gd.
//
// LA RÈGLE DES CIBLES, et pas leur liste : **une cible s'écrit le jour où son axe naît**,
// jamais rétro-ajoutée (§15). Celles qui manquent attendent leur sous-système : 8/9/15 avec
// le parc, 10/11/16/17/18 avec l'argent sale, 12 avec les hommes, 13/14 avec l'épidémie.
// LA LISTE DE CE QUI EST ARMÉ N'EST PAS RECOPIÉE ICI : `verdicts()` la produit et le rapport
// l'imprime — une énumération dans un commentaire pourrit par construction.
//
//   node src/tests/balance.ts [graines]      (100 pour valider un jalon, 20 pour itérer)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Dict, mini, maxf, minf, floori, get, str, clesTriees } from "../sim/gd.ts";
import { chargerData, RACINE } from "../sim/disque.ts";
import * as Sim from "../sim/sim.ts";
import * as Produit from "../sim/produit.ts";
import * as Bots from "./bots.ts";
import { fmt } from "./fmt.ts";

// Cible 3 : le OU est délibéré (§16) — gagner souvent en finissant à peine plus riche est une
// égalité, pas une domination.
export const VICTOIRES_MAX = 0.60;
export const ECART_DOMINATION = 0.15;
// Cible 1 : la fourchette de mortalité lisible.
export const MORTALITE_MIN = 0.15;
export const MORTALITE_MAX = 0.35;
// Cible 3, TROISIÈME terme : la SURVIE. Aucun écart de richesse ne rachète 0 % contre 100 %
// de survie : c'est un jeu à une seule stratégie viable. Le terme est un ET, pas un OU. Ce
// n'est pas un doublon de la cible 1, qui regarde la mortalité MOYENNE.
export const SURVIE_DOMINATION = 0.80;
// Cible 3 : la richesse se compare à une DATE COMMUNE, choisie après que les trajectoires se
// sont séparées et avant la première mort. Elle n'est pas citée en commentaire : la garde
// `jalon_douteux` surveille l'invariant et crie si un bot meurt avant.
export const SEMAINE_COMPARAISON = 95;
// Cible 2 : une mort avant cette semaine est une mort au démarrage. Garde-fou anti-régression.
export const SEMAINE_DEMARRAGE = 104;
export const SEUIL_PRECOCE = 0.10;
// Cible 7 : `instabilite_neuro` par bot, sur la médiane des graines — bornes du GDD.
export const CIBLE_7: Dict = {
  discret: { min: 0.0, max: 0.25 },
  industriel: { min: 0.50, max: 1.0 },
};
// CIBLE 23 (§2bis) — écrite le jour où la recherche est née : « elle n'est JAMAIS un
// prérequis de survie ». Ne s'applique qu'aux bots qui ne cherchent RIEN.
export const SURVIE_SANS_RECHERCHE = 0.80;
// Au-delà de cette part, une seule cause de mort fait toute la mortalité. ALERTE et pas
// verdict : on ajoute la MESURE avant d'en faire une CONTRAINTE (§16).
export const CAUSE_DOMINANTE = 0.80;

const CHEMIN_CSV = join(RACINE, "balance.csv");

// Toutes les campagnes de tous les bots, dans un ordre fixe.
export function campagnes(data: Dict, noms: string[], n: number): Dict {
  const strats = Bots.strategies();
  const resultats: Dict = {};
  for (const nom of noms) {
    const liste: Dict[] = [];
    for (let graine = 1; graine <= n; graine++) liste.push(campagne(graine, data, strats[nom]));
    resultats[nom] = liste;
  }
  return resultats;
}

// Une campagne complète, jusqu'à la fin ou jusqu'au plafond de semaines. run.ts et levier.ts
// rejouent exactement la même boucle, sinon les trois tests ne parlent pas du même jeu.
export function campagne(graine: number, data: Dict, strat: Dict): Dict {
  const state = Sim.nouvellePartie(graine, data);
  const semainesMax = Math.trunc(Number(data.constants.sim.semaines_max));
  let propreCumule = 0.0;
  for (let t = 0; t <= semainesMax; t++) {
    Bots.agir(state, data, strat);
    Sim.tick(state, data);
    if (Math.trunc(state.tick) <= SEMAINE_COMPARAISON) propreCumule += Number(state.cash_propre);
    if (str(state.fin) !== "") break;
  }
  return {
    fin: str(state.fin),
    fin_tick: Math.trunc(state.tick),
    // LES DEUX BOURSES, séparées jusque dans le rapport (§5) : le jeu ne les additionne
    // jamais, nulle part — y compris pour classer les bots.
    cash_propre: Number(state.cash_propre),
    cash_sale: Number(state.cash_sale),
    visibilite: Number(state.visibilite),
    kg: Number(state.stats.kg_vendus),
    // LA RICHESSE EN INTÉGRALE : le propre MOYEN tenu jusqu'à la date commune. Un
    // instantané répond « avait-il payé une case cette semaine-là », une intégrale répond
    // « a-t-il été riche ».
    propre_moyen: propreCumule / Math.max(SEMAINE_COMPARAISON, 1),
    // L'axe de la cible 7 : il ne fait RIEN au jalon 1, c'est pour ça qu'on le mesure.
    instabilite: Object.keys(state.recette).length > 0
      ? Number(Produit.specs(state.recette, data).instabilite_neuro) : 0.0,
    // Combien de cases ce profil a-t-il pu poser — zéro est la valeur que surveille la
    // cible 23.
    noeuds: Object.keys(state.recherche.acquis).length,
  };
}

// Une partie PERDUE : faillite, saisie du créancier (§1bis) ou arrestation (§7).
export function perdue(r: Dict): boolean {
  const fin = str(r.fin);
  return fin === "faillite" || fin === "saisie" || fin === "arrestation";
}

// LES CIBLES, EN UN SEUL ENDROIT. Le rapport imprime, `resume` mesure, `verdicts` juge — et
// balayage.ts appelle les deux derniers, pour ne jamais redécrire les seuils de son côté.
export function resume(noms: string[], resultats: Dict, n: number): Dict {
  let perdues = 0;
  let precoces = 0;
  const medianes: Dict = {};
  const instabilites: Dict = {};
  const moyens: Dict = {};
  const mortsMed: Dict = {};
  const mortalites: Dict = {};
  const noeuds: Dict = {};
  const jalonDouteux: string[] = [];
  const causes: Dict = {};
  for (const nom of noms) {
    const propres: number[] = [];
    const insta: number[] = [];
    let perduesBot = 0;
    for (const r of resultats[nom] as Dict[]) {
      insta.push(Number(r.instabilite));
      if (perdue(r)) {
        perduesBot++;
        perdues++;
        causes[str(r.fin)] = Number(get(causes, str(r.fin), 0)) + 1;
        if (r.fin_tick < SEMAINE_DEMARRAGE) precoces++;
      } else {
        propres.push(Number(r.cash_propre));
      }
    }
    medianes[nom] = mediane(propres);
    instabilites[nom] = mediane(insta);
    moyens[nom] = mediane(col(resultats[nom], "propre_moyen"));
    // La date de comparaison n'a de sens que si tout le monde est encore en vie : si un bot
    // meurt avant, la cible 3 change de sens EN SILENCE. On le dit.
    const morts = (resultats[nom] as Dict[]).filter(perdue).map((r) => Number(r.fin_tick));
    mortalites[nom] = perduesBot / Math.max(n, 1);
    noeuds[nom] = mediane(col(resultats[nom], "noeuds"));
    mortsMed[nom] = morts.length > 0 ? mediane(morts) : -1.0;
    if (morts.length > 0 && mediane(morts) < SEMAINE_COMPARAISON) jalonDouteux.push(nom);
  }
  const gagnants: Dict = {};
  for (let i = 0; i < n; i++) {
    let meilleur = "";
    let score = -1e30;
    for (const nom of noms) {
      const r2 = resultats[nom][i];
      const sc = perdue(r2) ? -1e20 : Number(r2.cash_propre);
      if (sc > score) {
        score = sc;
        meilleur = nom;
      }
    }
    gagnants[meilleur] = Number(get(gagnants, meilleur, 0)) + 1;
  }
  let victoiresMax = 0.0;
  let champion = "";
  for (const nom of noms) {
    const taux = Number(get(gagnants, nom, 0)) / n;
    if (taux > victoiresMax) champion = nom;
    victoiresMax = maxf(victoiresMax, taux);
  }
  let medSecond = 0.0;
  for (const nom of noms) if (nom !== champion) medSecond = maxf(medSecond, Number(get(medianes, nom, 0.0)));
  // L'ÉCART se mesure à la date commune et sur TOUTES les campagnes, mortes comprises.
  let haut = 0.0;
  let bas = 1e30;
  for (const nom of noms) {
    haut = maxf(haut, Number(moyens[nom]));
    bas = minf(bas, Number(moyens[nom]));
  }
  const mesurable = bas > 0.0;
  const total = noms.length * n;
  return {
    mortalite: perdues / total,
    precoce: precoces / total,
    victoires_max: victoiresMax,
    champion,
    survivants: medSecond > 0.0,
    mesurable,
    ecart: mesurable ? haut / bas - 1.0 : Infinity,
    medianes, instabilites, jalons: moyens, mortalites, noeuds,
    morts_medianes: mortsMed, jalon_douteux: jalonDouteux, causes, gagnants,
  };
}

function col(liste: Dict[], cle: string): number[] {
  return liste.map((r) => Number(r[cle]));
}

export function verdicts(r: Dict): Dict[] {
  const v: Dict[] = [];
  const m = Number(r.mortalite);
  v.push({ cle: "1", ok: m >= MORTALITE_MIN && m <= MORTALITE_MAX,
    texte: fmt("mortalite globale lisible : %.0f%% (cible %.0f-%.0f%%)", m * 100, MORTALITE_MIN * 100, MORTALITE_MAX * 100) });
  v.push({ cle: "2", ok: Number(r.precoce) < SEUIL_PRECOCE,
    texte: fmt("mortalite de demarrage : %.0f%% avant la semaine %d (seuil %.0f%%)", Number(r.precoce) * 100, SEMAINE_DEMARRAGE, SEUIL_PRECOCE * 100) });
  const ec = Number(r.ecart);
  const survie = ecartSurvie(r);
  v.push({ cle: "3",
    ok: (Number(r.victoires_max) <= VICTOIRES_MAX || (Boolean(r.mesurable) && ec <= ECART_DOMINATION))
      && survie < SURVIE_DOMINATION,
    texte: fmt("aucune domination : victoires max %.0f%% - ecart sem %d %s - ecart de survie %.0f%% (seuils %.0f%% / %.0f%% / %.0f%%)",
      Number(r.victoires_max) * 100, SEMAINE_COMPARAISON, r.mesurable ? fmt("%+.0f %%", ec * 100) : "n/a",
      survie * 100, VICTOIRES_MAX * 100, ECART_DOMINATION * 100, SURVIE_DOMINATION * 100) });
  // Cible 23 : uniquement sur les profils qui ne cherchent rien.
  for (const nom of clesTriees(r.noeuds)) {
    if (Number(r.noeuds[nom]) > 0) continue;
    const mort = Number(r.mortalites[nom]);
    v.push({ cle: "23", ok: mort <= 1.0 - SURVIE_SANS_RECHERCHE,
      texte: fmt("la recherche n'est pas un peage : %s ne cherche rien et survit a %.0f%% (seuil %.0f%%)", nom, (1 - mort) * 100, SURVIE_SANS_RECHERCHE * 100) });
  }
  for (const nom of clesTriees(CIBLE_7)) {
    if (!Object.hasOwn(r.instabilites, nom)) continue;
    const b = CIBLE_7[nom];
    const x = Number(r.instabilites[nom]);
    v.push({ cle: "7", ok: x >= b.min && x <= b.max,
      texte: fmt("instabilite_neuro %s : %.3f (cible %.2f-%.2f)", nom, x, b.min, b.max) });
  }
  return v;
}

// L'écart entre le bot qui survit le mieux et celui qui survit le moins bien.
export function ecartSurvie(r: Dict): number {
  const m: Dict = r.mortalites;
  if (Object.keys(m).length < 2) return 0.0;
  let haut = 0.0;
  let bas = 1.0;
  for (const nom of clesTriees(m)) {
    haut = maxf(haut, Number(m[nom]));
    bas = minf(bas, Number(m[nom]));
  }
  return haut - bas;
}

export function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0.0;
  const tri = [...valeurs].sort((a, b) => a - b);
  return Number(tri[floori(tri.length / 2.0)]);
}

function rapport(noms: string[], resultats: Dict, nGraines: number): number {
  const echecs: string[] = [];
  const alertes: string[] = [];
  for (const nom of noms) {
    const liste: Dict[] = resultats[nom];
    let nP = 0;
    const propres: number[] = [];
    const fins: Dict = {};
    const semainesMortes: number[] = [];
    const signatures = new Set<string>();
    for (const r of liste) {
      fins[str(r.fin)] = Number(get(fins, str(r.fin), 0)) + 1;
      // La signature d'une campagne : deux graines qui la partagent ont raconté la même
      // partie. Les SIX colonnes, pas trois.
      signatures.add(fmt("%s|%d|%.0f|%.0f|%.3f|%.1f", r.fin, r.fin_tick, r.cash_propre, r.cash_sale, r.visibilite, r.kg));
      if (perdue(r)) {
        nP++;
        semainesMortes.push(Number(r.fin_tick));
      } else {
        propres.push(Number(r.cash_propre));
      }
    }
    // Un bot mort n'a pas de richesse de fin : on le dit au lieu d'imprimer un zéro.
    const propreTxt = propres.length > 0 ? fmt("%9.0f $", mediane(propres)) : "      n/a  ";
    console.log(fmt("%-12s | perdues %3.0f%% | propre fin %s | sale median %10.0f $ | visibilite med. %5.1f",
      nom, 100 * nP / liste.length, propreTxt, mediane(col(liste, "cash_sale")), mediane(col(liste, "visibilite"))));
    console.log(fmt("             > instabilite_neuro mediane : %.3f", mediane(col(liste, "instabilite"))));
    if (semainesMortes.length > 0) {
      semainesMortes.sort((a, b) => a - b);
      console.log(fmt("             > morts : semaines %.0f / %.0f / %.0f (min/med/max)",
        semainesMortes[0], mediane(semainesMortes), semainesMortes[semainesMortes.length - 1]));
    }
    console.log(fmt("             > fins : %s", finsTexte(fins)));
    // Un bot sans variance rend ses N graines décoratives : le harnais croit mesurer une
    // distribution et mesure un point.
    console.log(fmt("             > graines distinctes : %d/%d", signatures.size, liste.length));
    if (signatures.size === 1 && liste.length > 1) {
      alertes.push(fmt("%s : les %d graines donnent LA MEME campagne — pour ce bot, le harnais mesure un point, pas une distribution", nom, liste.length));
    }
  }
  // UNE SEULE VÉRITÉ : resume()/verdicts(), les mêmes que balayage.ts.
  const r = resume(noms, resultats, nGraines);
  for (const nom of noms) {
    console.log(fmt("victoires %-12s : %3.0f%%", nom, Number(get(r.gagnants, nom, 0)) / nGraines * 100));
  }
  const ecartTxt = r.mesurable ? fmt("%+.0f %%", r.ecart * 100) : fmt("n/a (un bot a zero a la semaine %d)", SEMAINE_COMPARAISON);
  console.log(fmt("richesse MOYENNE jusqu'a la semaine %d : %s | ecart %s", SEMAINE_COMPARAISON,
    noms.map((nom) => fmt("%s %.0f $", nom, r.jalons[nom])).join(" | "), ecartTxt));
  for (const nom of r.jalon_douteux as string[]) {
    alertes.push(fmt("%s meurt en mediane semaine %.0f, AVANT la semaine %d de comparaison : son instantane de richesse est celui d'un mort, et la cible 3 ne mesure plus ce qu'elle annonce",
      nom, r.morts_medianes[nom], SEMAINE_COMPARAISON));
  }
  if (!r.survivants) {
    console.log("             > un bot ne finit aucune campagne : sa richesse de FIN n'existe pas,");
    console.log("               d'ou la comparaison a date commune plutot qu'un verdict muet.");
  }
  const perduesN = Number(r.mortalite) * noms.length * nGraines;
  for (const verdict of verdicts(r)) {
    let texte = `${verdict.cle}. ${verdict.texte}`;
    if (verdict.cle === "1" && perduesN > 0) texte += ` | morts par ${finsTexte(r.causes)}`;
    console.log(`${verdict.ok ? "  OK " : "RATE "} ${texte}`);
    if (!verdict.ok) echecs.push(texte);
  }
  // Un taux tenu par une seule porte de sortie n'est pas la mortalité que §16 décrit.
  let causePart = 0.0;
  let causeTop = "";
  for (const c of clesTriees(r.causes)) {
    const part = Number(r.causes[c]) / maxf(perduesN, 1.0);
    if (part > causePart) {
      causePart = part;
      causeTop = c;
    }
  }
  if (perduesN > 0 && causePart > CAUSE_DOMINANTE) {
    alertes.push(fmt("%.0f%% des morts sont des %s : le jeu n'a qu'une porte de sortie, et la cible 1 ne le verrait pas", causePart * 100, causeTop));
  }
  // Les alertes ne font pas échouer : elles disent ce que les cibles ne savent pas voir.
  for (const a of alertes) console.log(`ALERTE ${a}`);
  if (echecs.length === 0) {
    console.log(fmt("EQUILIBRAGE : TOUTES LES CIBLES ACTIVES SONT ATTEINTES (%d alerte(s))", alertes.length));
    return 0;
  }
  for (const e of echecs) console.error(`CIBLE RATEE : ${e}`);
  return 1;
}

// Une ligne par campagne, sur le disque. Ce n'est PAS une baseline qu'on citera plus tard :
// c'est de quoi COMPARER deux mesures fraîches (comparer.ts).
function exporter(noms: string[], resultats: Dict, nGraines: number): void {
  const lignes = ["bot,graine,fin,fin_sem,cash_propre,cash_sale,visibilite,kg"];
  for (const nom of noms) {
    (resultats[nom] as Dict[]).forEach((r, i) => {
      lignes.push(fmt("%s,%d,%s,%d,%.2f,%.2f,%.4f,%.4f", nom, i + 1, r.fin, r.fin_tick, r.cash_propre, r.cash_sale, r.visibilite, r.kg));
    });
  }
  writeFileSync(CHEMIN_CSV, lignes.join("\n") + "\n");
  console.log(fmt("csv : %d lignes dans balance.csv", noms.length * nGraines));
}

function finsTexte(fins: Dict): string {
  return clesTriees(fins).map((cle) => fmt("%s x%d", cle, fins[cle])).join(" ");
}

if (import.meta.main) {
  const arg = process.argv[2];
  const nGraines = arg !== undefined && /^\d+$/.test(arg) ? Math.max(Number(arg), 1) : 100;
  const data = chargerData();
  const noms = clesTriees(Bots.strategies());
  console.log(fmt("harnais : %d graines × %d bots", nGraines, noms.length));
  const resultats = campagnes(data, noms, nGraines);
  exporter(noms, resultats, nGraines);
  process.exit(rapport(noms, resultats, nGraines));
}
