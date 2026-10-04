// Raison d'être : LA MÉMOIRE DU HARNAIS. Ce fichier lit deux mesures — balance.csv ou
// levier.csv, produites par deux exécutions — et dit ce qui a changé. Port de
// tests/comparer.gd.
//
// Ce n'est PAS une baseline versionnée (§16 : « la baseline se remesure, elle ne se cite pas
// depuis une note ancienne ») : on rejoue le harnais sur deux commits et on compare DEUX
// MESURES FRAÎCHES. Les .csv sont gitignorés pour que personne ne soit tenté d'en figer un.
//
// Ce n'est pas un TEST — aucun verdict, il sort en 0 (sauf fichier illisible) — et le smoke de
// la CI le lance, comme les outils de trace et de balayage.
//
//   node src/tests/comparer.ts <avant.csv> <apres.csv>
//
//   git stash && node src/tests/levier.ts && copy levier.csv avant.csv
//   git stash pop && node src/tests/levier.ts
//   node src/tests/comparer.ts avant.csv levier.csv
import { readFileSync, existsSync } from "node:fs";
import { type Dict, absf, maxf, mini } from "../sim/gd.ts";
import { fmt, num } from "./fmt.ts";

// Un mouvement se juge contre L'ÉCHELLE DE SA COLONNE, jamais contre sa propre valeur de
// départ — la faute que levier.ts avait déjà corrigée de son côté.
const SEUIL_ECHELLE = 0.01;
const MAX_LIGNES = 20;
// Les colonnes d'ENTRÉE : ce qu'on a changé soi-même. Elles sortent à part et en premier.
const COLONNES_CAUSE = ["valeur"];

const estNombre = (s: string): boolean => s.trim() !== "" && Number.isFinite(Number(s));

function principal(): number {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("usage : node src/tests/comparer.ts <avant.csv> <apres.csv>");
    return 1;
  }
  const avant = lire(args[0]);
  const apres = lire(args[1]);
  if (!avant || !apres) return 1;
  if (avant.entete !== apres.entete) {
    console.error("ces deux fichiers n'ont pas les memes colonnes : ce ne sont pas deux mesures du meme genre");
    console.error("  avant : " + avant.entete);
    console.error("  apres : " + apres.entete);
    return 1;
  }
  console.log(`=== ${args[0]} -> ${args[1]} ===`);
  comparer(avant, apres);
  return 0;
}

function lire(chemin: string): Dict | null {
  if (!existsSync(chemin)) {
    console.error(`illisible : ${chemin}`);
    return null;
  }
  const lignesTexte = readFileSync(chemin, "utf8").split(/\r?\n/).filter((l) => l !== "");
  const entete = lignesTexte[0]?.split(",") ?? [];
  if (entete.length < 2) {
    console.error(`pas un csv de mesure : ${chemin}`);
    return null;
  }
  const cles = entete.includes("constante") ? ["constante"] : (entete.includes("bot") && entete.includes("graine") ? ["bot", "graine"] : [entete[0]]);
  const lignes: Dict = {};
  for (const texte of lignesTexte.slice(1)) {
    const l = texte.split(",");
    if (l.length !== entete.length) continue;
    const ligne: Dict = {};
    entete.forEach((c, i) => (ligne[c] = l[i]));
    lignes[cles.map((c) => ligne[c]).join("|")] = ligne;
  }
  return { entete: entete.join(","), colonnes: entete, lignes, cles };
}

function comparer(avant: Dict, apres: Dict): void {
  const lAvant: Dict = avant.lignes;
  const lApres: Dict = apres.lignes;
  const communes = Object.keys(lApres).filter((c) => Object.hasOwn(lAvant, c)).sort();
  const ajoutees = Object.keys(lApres).filter((c) => !Object.hasOwn(lAvant, c)).sort();
  const retirees = Object.keys(lAvant).filter((c) => !Object.hasOwn(lApres, c)).sort();
  console.log(fmt("  %d ligne(s) commune(s), %d ajoutee(s), %d retiree(s)", communes.length, ajoutees.length, retirees.length));
  for (const c of ajoutees) console.log(`  + ${c}`);
  for (const c of retirees) console.log(`  - ${c}`);
  const ech = echelles(avant, apres);
  const causes: string[] = [];
  const textes: string[] = [];
  const nombres: { texte: string; poids: number }[] = [];
  for (const cle of communes) {
    const a = lAvant[cle];
    const b = lApres[cle];
    for (const col of avant.colonnes as string[]) {
      if ((avant.cles as string[]).includes(col)) continue;
      const va = String(a[col]);
      const vb = String(b[col]);
      if (va === vb) continue;
      if (!estNombre(va) || !estNombre(vb)) {
        textes.push(`${cle} | ${col} : ${va} -> ${vb}`);
        continue;
      }
      const fa = Number(va);
      const fb = Number(vb);
      const texte = `${cle} | ${col} : ${num(fa, 4)} -> ${num(fb, 4)} (${relatif(fa, fb)})`;
      if (COLONNES_CAUSE.includes(col)) {
        causes.push(texte);
        continue;
      }
      if (!Object.hasOwn(ech, col)) continue;
      const poids = absf(fb - fa) / ech[col];
      if (poids < SEUIL_ECHELLE) continue;
      nombres.push({ texte, poids });
    }
  }
  if (causes.length === 0 && textes.length === 0 && nombres.length === 0) {
    console.log(fmt("  AUCUN changement au-dela de %.0f %% de l'echelle des colonnes : les deux mesures racontent la meme chose", SEUIL_ECHELLE * 100));
    return;
  }
  if (causes.length > 0) {
    console.log(fmt("  CE QUI A CHANGE EN ENTREE (%d) — la cause, avant ses effets :", causes.length));
    for (const t of causes) console.log(`    ${t}`);
  }
  if (textes.length > 0) {
    console.log(fmt("  CHANGEMENTS D'ETAT (%d) — statut de levier, fin de partie :", textes.length));
    for (const t of textes) console.log(`    ${t}`);
  }
  if (nombres.length === 0) return;
  nombres.sort((x, y) => y.poids - x.poids);
  const montres = mini(MAX_LIGNES, nombres.length);
  const suffixe = montres === nombres.length ? "" : fmt(", les %d plus gros", montres);
  console.log(fmt("  MOUVEMENTS (%d au-dela de %.0f %% de l'echelle de leur colonne%s) :", nombres.length, SEUIL_ECHELLE * 100, suffixe));
  for (let i = 0; i < montres; i++) console.log(`    ${nombres[i].texte}`);
}

function echelles(avant: Dict, apres: Dict): Dict {
  const sommes: Dict = {};
  const comptes: Dict = {};
  for (const source of [avant, apres]) {
    for (const ligne of Object.values(source.lignes as Dict)) {
      for (const col of source.colonnes as string[]) {
        const v = String(ligne[col]);
        if (!estNombre(v)) continue;
        sommes[col] = (sommes[col] ?? 0.0) + absf(Number(v));
        comptes[col] = (comptes[col] ?? 0) + 1;
      }
    }
  }
  const e: Dict = {};
  for (const col of Object.keys(sommes)) e[col] = maxf(sommes[col] / maxf(comptes[col], 1.0), 1e-12);
  return e;
}

function relatif(fa: number, fb: number): string {
  if (absf(fa) < 1e-9) return "depuis zero";
  return fmt("%+.0f %%", (fb / fa - 1.0) * 100);
}

if (import.meta.main) process.exit(principal());
