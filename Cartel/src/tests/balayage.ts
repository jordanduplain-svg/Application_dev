// Raison d'être : balayer UNE constante sur N valeurs et imprimer les cibles de §16 pour
// chacune. Port de tests/balayage.gd.
//
// CE QU'IL MONTRE et qu'une valeur isolée cache : la FORME. Une falaise (tout bascule d'une
// ligne à l'autre) ne se règle pas — il manque au jeu une source de risque, pas un chiffre.
// Une pente se règle. Un plateau dit que la constante ne décide de rien dans cette plage.
//
// AUCUN CHIFFRE MESURÉ DANS CET EN-TÊTE, et c'est une règle du projet, apprise ici même :
// **un commentaire garde le RAISONNEMENT et nomme la COMMANDE**. Le chiffre s'obtient en la
// lançant — c'est la seule version qui ne ment jamais.
//
// Il n'invente aucun seuil : il appelle Balance.resume() et Balance.verdicts(), les mêmes que
// le harnais. Ce n'est pas un TEST — il sort toujours en 0 — mais le smoke de la CI le lance.
//
//   node src/tests/balayage.ts <constante> <min> <max> [pas] [graines]
//   node src/tests/balayage.ts visibilite.k_volume 0.14 0.42 5 10
//
// La constante se nomme en entier (`constants.visibilite.k_volume`) ou par sa fin
// (`visibilite.k_volume`) ; une fin ambiguë est refusée plutôt que devinée.
import { type Dict, clesTriees, copie } from "../sim/gd.ts";
import { chargerData } from "../sim/disque.ts";
import * as Bots from "./bots.ts";
import * as Balance from "./balance.ts";
import * as Levier from "./levier.ts";
import { fmt, num } from "./fmt.ts";

const GRAINES_DEFAUT = 20;
const PAS_DEFAUT = 7;

function principal(): number {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("usage : node src/tests/balayage.ts <constante> <min> <max> [pas] [graines]");
    return 1;
  }
  const bas = Number(args[1]);
  const haut = Number(args[2]);
  const pas = args[3] !== undefined && /^\d+$/.test(args[3]) ? Math.max(Number(args[3]), 2) : PAS_DEFAUT;
  const graines = args[4] !== undefined && /^\d+$/.test(args[4]) ? Math.max(Number(args[4]), 1) : GRAINES_DEFAUT;
  const data = chargerData();
  const candidats = (Levier.inventaire(data).chemins as string[][]).filter((c) => {
    const plein = c.join(".");
    return plein === args[0] || plein.endsWith("." + args[0]);
  });
  if (candidats.length === 0) {
    console.error(`${args[0]} n'existe dans aucun fichier de data/`);
    return 1;
  }
  if (candidats.length > 1) {
    console.error(`${args[0]} est ambigu : ${candidats.map((c) => c.join(".")).join(" ")}`);
    return 1;
  }
  const chemin = candidats[0];
  const noms = clesTriees(Bots.strategies());
  console.log(fmt("balayage : %s de %s a %s en %d valeurs, %d graines x %d bots", chemin.join("."), num(bas, 4), num(haut, 4), pas, graines, noms.length));
  console.log(`  valeur actuelle : ${num(Number(Levier.lire(data, chemin)), 4)}`);
  console.log("");
  console.log(fmt("%-10s | %-9s | %-9s | %-9s | %-8s | cibles", "valeur", "mortalite", "precoce", "victoires", "ecart"));
  let precedent = "";
  for (let i = 0; i < pas; i++) {
    const v = bas + (haut - bas) * i / (pas - 1);
    precedent = uneValeur(data, chemin, v, noms, graines, precedent);
  }
  console.log("");
  console.log("Une FALAISE (tout passe d'un coup d'une ligne a l'autre) veut dire qu'il n'y a pas");
  console.log("de reglage a trouver : il manque au jeu une source de risque, pas un chiffre.");
  return 0;
}

function uneValeur(data: Dict, chemin: string[], v: number, noms: string[], graines: number, precedent: string): string {
  const d = copie(data);
  Levier.ecrire(d, chemin, v);
  const resultats = Balance.campagnes(d, noms, graines);
  const r = Balance.resume(noms, resultats, graines);
  const etats: string[] = [];
  const rates: string[] = [];
  for (const verdict of Balance.verdicts(r)) {
    etats.push(`${verdict.cle}${verdict.ok ? "+" : "-"}`);
    if (!verdict.ok) rates.push(verdict.texte);
  }
  const ecartTxt = r.mesurable ? fmt("%+.0f%%", r.ecart * 100) : "n/a";
  const morts = noms.flatMap((nom) => (resultats[nom] as Dict[]).filter(Balance.perdue).map((res) => Number(res.fin_tick)));
  const mortTxt = morts.length === 0 ? "" : fmt(" | mort med. sem %.0f", Balance.mediane(morts));
  console.log(fmt("%-10s | %8.0f%% | %8.0f%% | %8.0f%% | %8s | %s%s", num(v, 4), r.mortalite * 100, r.precoce * 100, r.victoires_max * 100, ecartTxt, etats.join(" "), mortTxt));
  for (const nom of r.jalon_douteux as string[]) {
    console.log(fmt("           ^ ATTENTION : %s meurt en mediane semaine %.0f, AVANT la semaine de comparaison — l'ecart de richesse ne mesure plus ce qu'il annonce", nom, r.morts_medianes[nom]));
  }
  // Les cibles ratées ne se répètent que quand la signature change : une falaise se voit.
  const signature = etats.join(" ");
  if (signature !== precedent) for (const texte of rates) console.log(`           ^ ${texte}`);
  return signature;
}

if (import.meta.main) process.exit(principal());
