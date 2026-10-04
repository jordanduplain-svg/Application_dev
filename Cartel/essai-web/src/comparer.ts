// ESSAI WEB — relit ce que Godot a calculé (sortie/godot.json) et le recalcule avec le
// portage TypeScript. Verdict : combien de nombres sont IDENTIQUES AU BIT PRÈS, et pour les
// autres, de combien d'ULP (le plus petit écart représentable) ils diffèrent.
//
//   node essai-web/src/comparer.ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliser, specs, type Data } from "./produit.ts";

const ici = dirname(fileURLToPath(import.meta.url));
const racine = join(ici, "..", "..");

// Les MÊMES fichiers que sim/state.gd::CHEMINS_DATA — une seule source de vérité.
const FICHIERS = ["constants", "precurseurs", "calibration", "segments", "rivaux", "procedes",
  "conception"];
const data: Data = {};
for (const f of FICHIERS) {
  data[f] = JSON.parse(readFileSync(join(racine, "data", f + ".json"), "utf8"));
}
const godot = JSON.parse(readFileSync(join(ici, "..", "sortie", "godot.json"), "utf8"));

// Distance en ULP entre deux doubles : on compare leurs représentations entières.
const vue = new DataView(new ArrayBuffer(8));
function bits(x: number): bigint {
  vue.setFloat64(0, x);
  const b = vue.getBigInt64(0);
  return b < 0n ? -(b & 0x7fffffffffffffffn) : b;
}
const ulp = (a: number, b: number): bigint => {
  const d = bits(a) - bits(b);
  return d < 0n ? -d : d;
};

// 1. LES SPECS
let total = 0;
let identiques = 0;
let pireUlp = 0n;
let pireRel = 0;
let pireOu = "";
const parSpec: Record<string, { n: number; diff: number; maxUlp: bigint }> = {};
const recettes: any[] = godot.recettes;
for (let i = 0; i < recettes.length; i++) {
  const attendu: Record<string, number> = godot.specs[i];
  const obtenu = specs(recettes[i], data);
  for (const cle of Object.keys(attendu)) {
    total++;
    const a = attendu[cle];
    const o = obtenu[cle];
    const s = (parSpec[cle] ??= { n: 0, diff: 0, maxUlp: 0n });
    s.n++;
    if (Object.is(a, o)) {
      identiques++;
      continue;
    }
    s.diff++;
    const u = ulp(a, o);
    if (u > s.maxUlp) s.maxUlp = u;
    const rel = Math.abs(a - o) / Math.max(Math.abs(a), 1e-300);
    if (u > pireUlp) {
      pireUlp = u;
      pireRel = rel;
      pireOu = `recette ${i} / ${cle} : godot ${a} vs ts ${o}`;
    }
  }
}

// 2. NORMALISER AVEC LES LIMITES DE RECHERCHE
let normOk = 0;
const normKo: string[] = [];
for (const c of godot.normaliser) {
  const o = normaliser(c.recette, data, godot.limites[c.limites]);
  const ok = Object.keys(c.normalisee).every((k) => Object.is(c.normalisee[k], o[k]))
    && Object.keys(o).length === Object.keys(c.normalisee).length;
  if (ok) normOk++;
  else if (normKo.length < 3) normKo.push(JSON.stringify({ attendu: c.normalisee, obtenu: o }));
}

// 3. LA VITESSE — même travail que Godot : un passage complet sur toutes les recettes, avec
// un tour de chauffe d'abord (le JIT de V8 compile le code chaud ; ne pas le compter serait
// mesurer le compilateur, pas le programme).
for (const r of recettes) specs(r, data);
const tours = 3;
const t0 = process.hrtime.bigint();
for (let t = 0; t < tours; t++) for (const r of recettes) specs(r, data);
const usTs = Number(process.hrtime.bigint() - t0) / 1000 / (tours * recettes.length);

console.log(`specs        | ${identiques} / ${total} nombres identiques au bit près (${(100 * identiques / total).toFixed(3)} %)`);
for (const [cle, s] of Object.entries(parSpec)) {
  console.log(`             | ${cle.padEnd(18)} ${String(s.diff).padStart(6)} écart(s) sur ${s.n}, pire ${s.maxUlp} ULP`);
}
if (pireOu) console.log(`             | pire écart : ${pireUlp} ULP, ${pireRel.toExponential(2)} relatif — ${pireOu}`);
console.log(`normaliser   | ${normOk} / ${godot.normaliser.length} cas identiques (avec limites de recherche)`);
for (const k of normKo) console.log(`             | ÉCART ${k}`);
console.log(`vitesse      | godot ${Number(godot.us_par_specs).toFixed(2)} µs/appel — typescript ${usTs.toFixed(3)} µs/appel — x${(Number(godot.us_par_specs) / usTs).toFixed(1)}`);
