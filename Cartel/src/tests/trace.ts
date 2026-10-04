// Raison d'être : traceur de diagnostic pour l'équilibrage — UNE campagne, UNE ligne par
// semaine, pour voir une trajectoire au lieu d'itérer à l'aveugle sur des distributions.
// Port de tests/trace.gd.
//
// Ce n'est PAS un test : il ne rend aucun verdict et sort toujours en 0. C'est l'outil qu'on
// ouvre quand balance.ts passe au rouge et qu'on veut savoir POURQUOI. Il est lancé par le
// smoke de la CI, comme balayage.ts et comparer.ts : un outil que rien n'exécute pourrit
// jusqu'au jour où on en a besoin.
//
//   node src/tests/trace.ts <graine> <bot> <pas> [<constante> <facteur> [<graines>]]
//   node src/tests/trace.ts 7 industriel 1             une ligne par semaine, graine 7
//   node src/tests/trace.ts 7 tous 13                  un trimestre sur l'autre, tous les bots
//   node src/tests/trace.ts 7 discret 13 blanchiment.capacite_sem 0.7
//                              MODE DIFF : la même campagne avec et sans la perturbation, côte
//                              à côte, et la semaine où les deux se séparent
//   node src/tests/trace.ts 7 discret 13 blanchiment.capacite_sem 0.7 10
//                              le même diff sur 10 graines : le détail pour la première, puis
//                              ce que les neuf autres en disent — conclure sur n = 1 est
//                              l'erreur que §16 nomme.
//
// La colonne « note » marque les semaines QUI COMPTENT, quel que soit le pas : échéance de la
// dette, seuil de visibilité franchi, saut de production, CASES DE LA GRILLE achetées (c'est
// ici qu'on lit à quelle semaine un profil atteint sa recette cible — le critère des coûts de
// data/procedes.json), passage dans le rouge, fin.
import { type Dict, absf, maxf, maxi, floori, get, str, clesTriees, copie } from "../sim/gd.ts";
import { chargerData } from "../sim/disque.ts";
import * as Sim from "../sim/sim.ts";
import * as Produit from "../sim/produit.ts";
import * as Bots from "./bots.ts";
import * as Levier from "./levier.ts";
import { fmt, num } from "./fmt.ts";

const GRAINE_DEFAUT = 42;
// Un changement de régime se note ; un ajustement de restockage ne se note pas.
const SAUT_PART = 0.25;

const entier = (s: string | undefined, defaut: number): number => (s !== undefined && /^-?\d+$/.test(s) ? Number(s) : defaut);

function principal(): number {
  const args = process.argv.slice(2);
  const graine = entier(args[0], GRAINE_DEFAUT);
  const vise = args[1] ?? "tous";
  const pas = Math.max(entier(args[2], 1), 1);
  const constante = args[3] ?? "";
  const facteur = args[4] !== undefined && Number.isFinite(Number(args[4])) ? Number(args[4]) : 0.7;
  const graines = Math.max(entier(args[5], 1), 1);
  const data = chargerData();
  const strats = Bots.strategies();
  for (const nom of clesTriees(strats)) {
    if (vise !== "tous" && vise !== nom) continue;
    console.log("");
    if (constante === "") {
      console.log(fmt("=== %s | graine %d | une ligne toutes les %d semaine(s) ===", nom, graine, pas));
      tracer(data, strats[nom], graine, pas);
    } else {
      console.log(fmt("=== %s | graines %d..%d | DIFF %s x%.2f ===", nom, graine, graine + graines - 1, constante, facteur));
      diff(data, strats[nom], graine, pas, constante, facteur, graines);
    }
  }
  return 0;
}

function prixMoyen(state: Dict): number {
  const prix = Object.values(state.prix as Dict).map(Number).filter((p) => p > 0.0);
  return prix.reduce((a, b) => a + b, 0) / maxf(prix.length, 1.0);
}

function tracer(data: Dict, strat: Dict, graine: number, pas: number): void {
  const state = Sim.nouvellePartie(graine, data);
  const echeance = Math.trunc(data.constants.dette.echeance_sem);
  const seuil = Number(data.constants.visibilite.seuil_arrestation);
  const semainesMax = Math.trunc(data.constants.sim.semaines_max);
  console.log(" sem |  part |  kg p |  kg v | stock |     propre |       sale | blanchi | visib | note");
  let kgPCum = 0.0;
  let kgVCum = 0.0;
  let blanchiCum = 0.0;
  let visibMax = 0.0;
  let semDette = -1;
  let semTraque = -1;
  for (let t = 0; t <= semainesMax; t++) {
    const partAvant = Number(state.part_capacite);
    const detteAvant = Number(state.dette);
    const acquisAvant = { ...state.recherche.acquis };
    Bots.agir(state, data, strat);
    Sim.tick(state, data);
    const sem = Math.trunc(state.tick);
    const kgP = state.stats.kg_produits - kgPCum;
    const kgV = state.stats.kg_vendus - kgVCum;
    const blanchi = state.stats.propre_blanchi - blanchiCum;
    kgPCum = state.stats.kg_produits;
    kgVCum = state.stats.kg_vendus;
    blanchiCum = state.stats.propre_blanchi;
    const visib = Number(state.visibilite);
    visibMax = maxf(visibMax, visib);
    if (detteAvant > 0.0 && state.dette <= 0.0) semDette = sem;
    if (semTraque < 0 && visib >= seuil) semTraque = sem;
    // Les semaines QUI COMPTENT s'impriment quel que soit le pas.
    const notes: string[] = [];
    if (sem === echeance) notes.push("ECHEANCE DETTE");
    if (sem === semDette) notes.push("dette remboursee");
    if (sem === semTraque) notes.push("SEUIL FRANCHI");
    const part = Number(state.part_capacite);
    if (absf(part - partAvant) >= SAUT_PART || (part > 0.0) !== (partAvant > 0.0)) notes.push(fmt("part %.2f -> %.2f", partAvant, part));
    for (const id of clesTriees(state.recherche.acquis)) if (!Object.hasOwn(acquisAvant, id)) notes.push("case " + id);
    if (state.cash_propre < 0.0) notes.push(fmt("ROUGE %d sem", state.semaines_rouge));
    if (state.fin !== "") notes.push("FIN : " + state.fin);
    if (sem % pas === 0 || notes.length > 0) {
      console.log(fmt("%4d | %5.2f | %5.1f | %5.1f | %5.1f | %10.0f | %10.0f | %7.0f | %5.1f | %s",
        sem, part, kgP, kgV, state.stock_kg, state.cash_propre, state.cash_sale, blanchi, visib, notes.join(" ")));
    }
    if (state.fin !== "") break;
  }
  const recette: Dict = state.recette;
  if (Object.keys(recette).length > 0) {
    const specs = Produit.specs(recette, data);
    console.log(fmt("  %s purete %.2f -> puissance %.3f | cout %.0f $/kg | prix %.0f $/kg | debit %.1f kg/sem | INSTAB %.3f",
      recette.famille, recette.purete, specs.puissance, specs.cout_unitaire, prixMoyen(state), specs.debit_kg_sem, specs.instabilite_neuro));
    const parts = clesTriees(state.marche).map((seg) => fmt("%s %.0f%%", seg, 100 * Number(get(state.marche[seg].parts, "joueur", 0.0))));
    console.log(`  parts finales : ${parts.join(" | ")}`);
  }
  console.log(fmt("  fin=%s sem=%d | kg vendus %.0f | visibilite max %.1f | dette %s", state.fin, state.tick, kgVCum, visibMax,
    semDette > 0 ? fmt("remboursee sem %d", semDette) : "JAMAIS REMBOURSEE"));
}

// La constante se nomme en entier (`constants.blanchiment.capacite_sem`) ou par sa fin
// (`blanchiment.capacite_sem`), comme dans balayage.ts. Sous Godot, ce mode cherchait le chemin
// court dans le mauvais dictionnaire depuis que le levier balaie tous les fichiers de données :
// il ne marchait plus, et aucun test ne le lançait avec une constante. La CI le fait désormais.
function diff(data: Dict, strat: Dict, graine: number, pas: number, constante: string, facteur: number, graines: number): void {
  const candidats = (Levier.inventaire(data).chemins as string[][]).filter((c) => {
    const plein = c.join(".");
    return plein === constante || plein.endsWith("." + constante);
  });
  if (candidats.length !== 1) {
    console.error(`  ${constante} ${candidats.length === 0 ? "n'existe dans aucun fichier de data/" : "est ambigu : " + candidats.map((c) => c.join(".")).join(" ")}`);
    return;
  }
  const chemin = candidats[0];
  const valeur = Number(Levier.lire(data, chemin));
  const dataB = copie(data);
  Levier.ecrire(dataB, chemin, valeur * facteur);
  console.log(`  ${chemin.join(".")} : ${num(valeur, 4)} -> ${num(valeur * facteur, 4)}`);
  const resultats: Dict[] = [];
  for (let g = graine; g < graine + graines; g++) resultats.push(diffUne(data, dataB, strat, g, pas, g === graine));
  if (graines > 1) resumeDiff(resultats);
}

function diffUne(data: Dict, dataB: Dict, strat: Dict, graine: number, pas: number, detail: boolean): Dict {
  if (detail) console.log(" sem |   propre A |  d propre |     sale A |    d sale | visib A | d visib | note");
  const a = Sim.nouvellePartie(graine, data);
  const b = Sim.nouvellePartie(graine, dataB);
  const semainesMax = Math.trunc(data.constants.sim.semaines_max);
  let divergence = -1;
  for (let t = 0; t <= semainesMax; t++) {
    Bots.agir(a, data, strat);
    Sim.tick(a, data);
    Bots.agir(b, dataB, strat);
    Sim.tick(b, dataB);
    const sem = maxi(Math.trunc(a.tick), Math.trunc(b.tick));
    const dPropre = b.cash_propre - a.cash_propre;
    const dSale = b.cash_sale - a.cash_sale;
    const dVisib = b.visibilite - a.visibilite;
    const notes: string[] = [];
    if (divergence < 0 && (absf(dPropre) > 1e-6 || absf(dSale) > 1e-6 || absf(dVisib) > 1e-9)) {
      divergence = sem;
      notes.push("DIVERGENCE");
    }
    if (detail && (sem % pas === 0 || notes.length > 0 || a.fin !== "" || b.fin !== "")) {
      if (a.fin !== "") notes.push("A fin=" + a.fin);
      if (b.fin !== "") notes.push("B fin=" + b.fin);
      console.log(fmt("%4d | %10.0f | %+9.0f | %10.0f | %+9.0f | %7.1f | %+7.1f | %s", sem, a.cash_propre, dPropre, a.cash_sale, dSale, a.visibilite, dVisib, notes.join(" ")));
    }
    if (a.fin !== "" && b.fin !== "") break;
  }
  if (detail) {
    console.log(fmt("  A : fin=%-13s sem=%3d propre=%10.0f | B : fin=%-13s sem=%3d propre=%10.0f", a.fin, a.tick, a.cash_propre, b.fin, b.tick, b.cash_propre));
    console.log(`  divergence : ${divergence > 0 ? fmt("semaine %d", divergence) : "AUCUNE — cette constante ne change rien pour ce bot et cette graine"}`);
  }
  return { graine, fin_a: a.fin, fin_b: b.fin, d_propre: b.cash_propre - a.cash_propre, divergence };
}

function resumeDiff(resultats: Dict[]): void {
  console.log(fmt("  --- les %d graines ---", resultats.length));
  let finsChangees = 0;
  const dPropres: number[] = [];
  const divergences: number[] = [];
  for (const r of resultats) {
    if (r.fin_a !== r.fin_b) {
      finsChangees++;
      console.log(fmt("    graine %d : fin %s -> %s", r.graine, r.fin_a, r.fin_b));
    }
    dPropres.push(r.d_propre);
    if (r.divergence > 0) divergences.push(r.divergence);
  }
  console.log(fmt("    issues changees   : %d/%d", finsChangees, resultats.length));
  console.log(fmt("    graines qui divergent : %d/%d", divergences.length, resultats.length));
  if (dPropres.length > 0) {
    dPropres.sort((x, y) => x - y);
    console.log(fmt("    d propre          : min %+.0f | med %+.0f | max %+.0f", dPropres[0], mediane(dPropres), dPropres[dPropres.length - 1]));
  }
  if (divergences.length > 0) {
    divergences.sort((x, y) => x - y);
    console.log(fmt("    semaine de divergence : min %.0f | med %.0f | max %.0f", divergences[0], mediane(divergences), divergences[divergences.length - 1]));
  }
}

function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0.0;
  const tri = [...valeurs].sort((x, y) => x - y);
  return tri[floori(tri.length / 2.0)];
}

if (import.meta.main) process.exit(principal());
