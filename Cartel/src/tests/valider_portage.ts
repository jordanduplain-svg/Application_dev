// Raison d'être : LA VALIDATION DU PORTAGE GODOT -> TYPESCRIPT. Rejoue en TypeScript les
// campagnes que essai-web/export_campagnes.gd a exportées depuis la vraie simulation Godot,
// et dit, pour chacune, si elle est identique au bit près, et sinon à quelle semaine et sur
// quelle grandeur la première divergence apparaît.
//
// Ce que ce test ne peut PAS exiger : l'identité bit à bit de bout en bout. pow() n'est pas
// calculé par la même bibliothèque dans les deux moteurs (essai-web : 2 specs sur 82 180, à
// 1-2 ULP), et sur 260 semaines avec des comparaisons à seuil, un ULP peut déplacer une
// décision. Le verdict a donc deux étages : IDENTIQUE (bit à bit), ou PROCHE (même issue,
// même semaine de fin, écart relatif sous 1e-6 sur les bourses) — et sinon, ÉCHEC avec la
// première semaine fautive, qui est ce qu'on vient chercher.
//
//   node src/tests/valider_portage.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Dict, clesTriees, get } from "../sim/gd.ts";
import { chargerData, RACINE } from "../sim/disque.ts";
import * as Sim from "../sim/sim.ts";
import * as Bots from "./bots.ts";

const data = chargerData();
const godot = JSON.parse(readFileSync(join(RACINE, "essai-web", "sortie", "campagnes.json"), "utf8"));

function releve(s: Dict): Dict {
  const parts: Dict = {};
  for (const seg of clesTriees(s.marche)) parts[seg] = Number(get(s.marche[seg].parts, "joueur", 0.0));
  return {
    tick: s.tick, fin: s.fin, cash_propre: s.cash_propre, cash_sale: s.cash_sale,
    visibilite: s.visibilite, stock_kg: s.stock_kg, dette: s.dette, part_capacite: s.part_capacite,
    rng: s.rng, acquis: clesTriees(s.recherche.acquis), savoir: { ...s.recherche.savoir }, parts,
  };
}

// La première différence entre deux relevés, au bit près, et son écart relatif.
function difference(a: Dict, b: Dict, chemin = ""): { ou: string; rel: number } | null {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[k];
    const vb = b[k];
    const ici = chemin + k;
    if (typeof va === "number" && typeof vb === "number") {
      if (!Object.is(va, vb)) return { ou: ici, rel: Math.abs(va - vb) / Math.max(Math.abs(va), 1e-300) };
    } else if (va && vb && typeof va === "object") {
      const d = difference(va, vb, ici + ".");
      if (d) return d;
    } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
      return { ou: ici, rel: Infinity };
    }
  }
  return null;
}

let identiques = 0;
let proches = 0;
let echecs = 0;
for (const c of godot.campagnes) {
  const strat = Bots.strategies()[c.bot];
  const s = Sim.nouvellePartie(c.graine, data);
  const ts: Dict[] = [];
  const maxSem = Number(data.constants.sim.semaines_max);
  for (let t = 0; t <= maxSem; t++) {
    if (s.fin !== "") break;
    Bots.agir(s, data, strat);
    Sim.tick(s, data);
    ts.push(releve(s));
  }
  const g: Dict[] = c.semaines;
  let premiere: string | null = null;
  let pireRel = 0;
  for (let i = 0; i < Math.max(g.length, ts.length); i++) {
    if (!g[i] || !ts[i]) {
      premiere ??= `semaine ${i + 1} : la campagne ${!g[i] ? "Godot" : "TypeScript"} est déjà finie`;
      pireRel = Infinity;
      break;
    }
    const d = difference(g[i], ts[i]);
    if (d) {
      premiere ??= `semaine ${g[i].tick} : ${d.ou} (écart relatif ${d.rel.toExponential(1)})`;
      pireRel = Math.max(pireRel, d.rel);
    }
  }
  const finG = g[g.length - 1];
  const finT = ts[ts.length - 1];
  const memeIssue = finG.fin === finT.fin && finG.tick === finT.tick;
  const bourses = Math.max(
    Math.abs(finG.cash_propre - finT.cash_propre) / Math.max(Math.abs(finG.cash_propre), 1),
    Math.abs(finG.cash_sale - finT.cash_sale) / Math.max(Math.abs(finG.cash_sale), 1));
  let verdict: string;
  if (!premiere) {
    verdict = "IDENTIQUE";
    identiques++;
  } else if (memeIssue && bourses < 1e-6) {
    verdict = "PROCHE   ";
    proches++;
  } else {
    verdict = "ECHEC    ";
    echecs++;
  }
  console.log(`${verdict} | ${String(c.bot).padEnd(10)} graine ${String(c.graine).padStart(2)} | fin ${finT.fin} sem ${finT.tick} (godot ${finG.fin} sem ${finG.tick})${premiere ? " | 1re divergence " + premiere : ""}`);
}
console.log(`\nportage : ${identiques} identiques, ${proches} proches, ${echecs} échecs sur ${godot.campagnes.length} campagnes`);
process.exit(echecs > 0 ? 1 : 0);
