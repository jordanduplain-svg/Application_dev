// Raison d'être : garder les deux boucles d'équilibrage PRATICABLES. Une boucle qu'on ne
// relance plus parce qu'elle prend dix minutes est un harnais mort — on se met à deviner au
// lieu de mesurer. Port de tests/perf.gd.
//
// Il ne relance PAS balance.ts ni levier.ts (ce serait doubler le temps de CI pour mesurer ce
// qu'on vient de mesurer) : il mesure le coût d'un tick sur des campagnes réelles, puis
// l'extrapole avec le nombre de passes que levier.ts calcule LUI-MÊME (Levier.passes) — une
// garde qui devine les boucles d'un autre fichier n'est pas une garde.
//
//   node src/tests/perf.ts
import { type Dict, clesTriees } from "../sim/gd.ts";
import { chargerData } from "../sim/disque.ts";
import * as Sim from "../sim/sim.ts";
import * as Bots from "./bots.ts";
import * as Levier from "./levier.ts";
import { fmt } from "./fmt.ts";

const GRAINES_BALANCE = 100;
const GRAINES_LEVIER = Levier.N_GRAINES_DEFAUT;
// Les budgets sont ceux de l'époque Godot, gardés tels quels : le portage TypeScript les a
// rendus larges, et les resserrer sans mesure serait poser une contrainte sur une intuition.
const BUDGET_BALANCE_SEC = 300.0;
const BUDGET_LEVIER_SEC = 300.0;
// Au-delà, la boucle est encore verte mais on ne l'itère plus : on la lance et on part.
const SEUIL_ALERTE_SEC = 120.0;
// Le démarrage de Node et le chargement des données, hors simulation.
const DEMARRAGE_SEC = 0.5;
// Le JIT de V8 compile le code chaud : les premières campagnes ne comptent pas.
const GRAINES_CHAUFFE = 3;
const GRAINES_MESURE = 20;

function principal(): number {
  const data = chargerData();
  const strats = Bots.strategies();
  const noms = clesTriees(strats);
  for (let g = 1; g <= GRAINES_CHAUFFE; g++) for (const nom of noms) campagne(g, data, strats[nom]);
  const debut = process.hrtime.bigint();
  let ticks = 0;
  for (let g = 1; g <= GRAINES_MESURE; g++) for (const nom of noms) ticks += campagne(g, data, strats[nom]);
  const dureeUs = Number(process.hrtime.bigint() - debut) / 1000;
  const usParTick = dureeUs / Math.max(ticks, 1);
  const ticksParGraine = ticks / GRAINES_MESURE;
  console.log(fmt("perf | %d ticks en %.0f ms -> %.1f us/tick | %.0f ticks par graine (%d bots)", ticks, dureeUs / 1000, usParTick, ticksParGraine, noms.length));
  const echecs: string[] = [];
  const secBalance = DEMARRAGE_SEC + secondes(ticksParGraine, GRAINES_BALANCE, 1.0, usParTick);
  verdict(echecs, fmt("balance.ts a %d graines : %.1f s (budget %.0f s)", GRAINES_BALANCE, secBalance, BUDGET_BALANCE_SEC), secBalance < BUDGET_BALANCE_SEC);
  const nConstantes = (Levier.inventaire(data).chemins as string[][]).length;
  const passes = Levier.passes(data);
  const secLevier = DEMARRAGE_SEC + secondes(ticksParGraine, GRAINES_LEVIER, passes, usParTick);
  verdict(echecs, fmt("levier.ts a %d graines x %d constantes (%d passes) : %.1f s max (budget %.0f s)", GRAINES_LEVIER, nConstantes, passes, secLevier, BUDGET_LEVIER_SEC), secLevier < BUDGET_LEVIER_SEC);
  canari(echecs, secBalance);
  alerter("balance.ts", secBalance);
  alerter("levier.ts", secLevier);
  if (echecs.length === 0) {
    console.log("PERF : LES DEUX BOUCLES RESTENT PRATICABLES");
    return 0;
  }
  for (const e of echecs) console.error("ECHEC PERF : " + e);
  return 1;
}

function alerter(quoi: string, sec: number): void {
  if (sec <= SEUIL_ALERTE_SEC) return;
  console.log(fmt("ALERTE %s prend %.0f s (seuil d'usage %.0f s) : la boucle est encore verte mais on ne l'itere plus, on la lance et on va faire autre chose", quoi, sec, SEUIL_ALERTE_SEC));
}

function secondes(ticksParGraine: number, graines: number, passes: number, usParTick: number): number {
  return ticksParGraine * graines * passes * usParTick / 1e6;
}

// LE CANARI : le chemin d'échec doit savoir rougir, sinon les deux OK ne valent rien.
function canari(echecs: string[], secMesure: number): void {
  const faux: string[] = [];
  juger(faux, "budget impossible", secMesure < 0.0, false);
  juger(faux, "budget infini", secMesure < 1e9, false);
  const ok = faux.length === 1;
  console.log(fmt("%s canari : le verdict sait rougir (1 echec attendu sur 2 jugements, %d obtenu)", ok ? "CANA " : "RATE ", faux.length));
  if (!ok) echecs.push("le chemin d'echec de perf.ts est casse : il ne sait plus rougir, donc ses deux OK ne valent rien");
}

function verdict(echecs: string[], texte: string, ok: boolean): void {
  juger(echecs, texte, ok, true);
}

function juger(echecs: string[], texte: string, ok: boolean, bavard: boolean): void {
  if (bavard) console.log(`${ok ? "  OK " : "RATE "} ${texte}`);
  if (!ok) echecs.push(texte);
}

function campagne(graine: number, data: Dict, strat: Dict): number {
  const state = Sim.nouvellePartie(graine, data);
  const semainesMax = Math.trunc(data.constants.sim.semaines_max);
  let n = 0;
  for (let t = 0; t <= semainesMax; t++) {
    Bots.agir(state, data, strat);
    Sim.tick(state, data);
    n++;
    if (state.fin !== "") break;
  }
  return n;
}

if (import.meta.main) process.exit(principal());
