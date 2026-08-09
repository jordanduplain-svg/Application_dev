// Simulation d'équilibrage — joue une stratégie naïve sur N parties et mesure
// la santé de l'économie. node --experimental-strip-types scripts/balance-sim.ts
import { SpaceProgram, type RocketDesign } from '../src/state/launch.ts';
import { TechTree, applyTech, RP_GAIN, type TechConfig, type BranchId } from '../src/state/tech.ts';
import { ContractBoard, type ContractDef } from '../src/state/contracts.ts';
import { readFileSync } from 'node:fs';

const load = (f: string) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const rockets: (RocketDesign & { cost: number; requires?: Partial<Record<BranchId, number>> })[] =
  load('rockets.json').designs;
const techCfg: TechConfig = load('tech.json');
const contractDefs: ContractDef[] = load('contracts.json').contracts;
const buildings = load('buildings.json');

// RNG déterministe (mulberry32)
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START_BUDGET: number = buildings.startBudget;
const PAD_COST: number = buildings.buildings.find((b: { id: string }) => b.id === 'pad_small').cost;
const LAB_COST: number = buildings.buildings.find((b: { id: string }) => b.id === 'lab').cost;
const RESEARCH_ORDER: BranchId[] = ['propulsion', 'structures', 'avionique'];
const MAX_FLIGHTS = 40;

interface Run {
  bankrupt: boolean; // impossible de payer le vol le moins cher
  albatrosAt: number | null; // n° de vol au déblocage
  finalBudget: number;
  minBudget: number;
  finalRepC: number;
  failures: number;
}

function simulate(seed: number, buyLab: boolean): Run {
  const rand = rng(seed);
  const program = new SpaceProgram();
  const tree = new TechTree(techCfg);
  const board = new ContractBoard(contractDefs.map((c) => ({ ...c })));
  let budget = START_BUDGET - PAD_COST - (buyLab ? LAB_COST : 0);
  const labs = buyLab ? 1 : 0;
  let minBudget = budget;
  let albatrosAt: number | null = null;

  for (let flight = 1; flight <= MAX_FLIGHTS; flight++) {
    // recherche : dans l'ordre, dès que payable
    for (const b of RESEARCH_ORDER) while (tree.canResearch(b)) tree.research(b);

    const unlocked = rockets.filter((d) => tree.meets(d.requires));
    if (albatrosAt === null && unlocked.some((d) => d.id === 'albatros')) albatrosAt = flight;
    const maxStages = Math.max(...unlocked.map((d) => d.stages.length));

    // meilleur contrat disponible, sinon le plus gros payable, sinon essai interne
    const offers = board
      .statuses(program.repCommercial, program.flightCount, maxStages)
      .filter((s) => s.available)
      .sort((a, z) => z.def.reward - a.def.reward);
    for (const o of offers) {
      const d = unlocked.filter((x) => x.stages.length >= o.def.minStages).sort((a, z) => a.cost - z.cost)[0];
      if (d && d.cost <= budget) {
        board.accept(o.def.id, program.repCommercial, program.flightCount, maxStages);
        break;
      }
    }
    const active = board.active;
    const design = active
      ? unlocked.filter((x) => x.stages.length >= active.minStages).sort((a, z) => a.cost - z.cost)[0]
      : unlocked.sort((a, z) => a.cost - z.cost)[0];

    if (design.cost > budget) {
      return { bankrupt: true, albatrosAt, finalBudget: budget, minBudget, finalRepC: program.repCommercial, failures: program.failures.length };
    }

    budget -= design.cost;
    const res = program.launch(applyTech(design, tree), { margin: 'standard', publicity: active ? 'public' : 'discret' }, rand);
    tree.award(Math.round(RP_GAIN[res.outcome] * (1 + 0.5 * labs)));
    if (active) budget += board.resolve(res.outcome, res.flightNumber).payout;
    minBudget = Math.min(minBudget, budget);
  }
  return { bankrupt: false, albatrosAt, finalBudget: budget, minBudget, finalRepC: program.repCommercial, failures: program.failures.length };
}

for (const buyLab of [false, true]) {
  const runs = Array.from({ length: 500 }, (_, i) => simulate(i + 1, buyLab));
  const ok = runs.filter((r) => !r.bankrupt);
  const med = (xs: number[]) => xs.sort((a, z) => a - z)[Math.floor(xs.length / 2)] ?? NaN;
  console.log(`\n--- stratégie ${buyLab ? 'pad + labo' : 'pad seul'} (500 parties, ${MAX_FLIGHTS} vols max) ---`);
  console.log(`faillites            : ${runs.length - ok.length} (${(((runs.length - ok.length) / runs.length) * 100).toFixed(1)} %)`);
  console.log(`Albatros débloqué    : vol médian ${med(ok.map((r) => r.albatrosAt ?? NaN))} (jamais : ${ok.filter((r) => r.albatrosAt === null).length})`);
  console.log(`budget final médian  : ${med(ok.map((r) => r.finalBudget))} ◈ (min médian en cours de partie : ${med(ok.map((r) => r.minBudget))} ◈)`);
  console.log(`confiance com. médiane: ${med(ok.map((r) => r.finalRepC))}`);
  console.log(`échecs médians       : ${med(ok.map((r) => r.failures))} / ${MAX_FLIGHTS} vols`);
}
