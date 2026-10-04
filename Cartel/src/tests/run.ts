// Raison d'être : porte d'entrée unique des tests — données, commandes citées, CI, espace de
// conception, recherche et savoir-faire, calibration, déterminisme seedé, save/load, règle du
// papier, horloge de la dette, jauge de visibilité, campagnes bot. Port de tests/run.gd :
// même structure, même convention de verdict (sortie 1 au premier échec relevé).
//
//   node src/tests/run.ts
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { type Dict, minf, maxf, floori, isEqualApprox, get, str, clesTriees } from "../sim/gd.ts";
import { chargerData, hacher, RACINE } from "../sim/disque.ts";
import * as Etat from "../sim/state.ts";
import * as Sim from "../sim/sim.ts";
import * as Produit from "../sim/produit.ts";
import * as Marche from "../sim/marche.ts";
import * as Recherche from "../sim/recherche.ts";
import * as Bots from "./bots.ts";
import * as Levier from "./levier.ts";
import { fmt, num } from "./fmt.ts";

const echecs: string[] = [];

function principal(): number {
  const data = chargerData();
  testDonnees(data);
  testCommandesCitees(data);
  testCi();
  testConception(data);
  testRecherche(data);
  testRechercheComportement(data);
  testSavoir(data);
  testCalibration(data);
  testDeterminisme(data);
  testSaveLoad(data);
  testRegleDuPapier(data);
  testDette(data);
  testVisibilite(data);
  testCampagnesBot(data);
  if (echecs.length === 0) {
    console.log("TOUS LES TESTS SONT VERTS");
    return 0;
  }
  for (const e of echecs) console.error("ECHEC : " + e);
  return 1;
}

// --- 1. données : tout charge, tout est fini ----------------------------------

function testDonnees(data: Dict): void {
  for (const cle of Etat.FICHIERS_DATA) {
    if (!Object.hasOwn(data, cle) || data[cle] == null) {
      echecs.push("data manquante ou illisible : " + cle);
      return;
    }
  }
  const n = verifierNombres(data.constants, "constants");
  testFormeState(data);
  testOrdreService(data);
  console.log(fmt("donnees      | %d fichier(s), %d constantes finies", Etat.FICHIERS_DATA.length, n));
}

// LA FORME DU STATE, vérifiée après une campagne de chaque bot : ses clés doivent être
// EXACTEMENT celles que `nouvellePartie` déclare. Ce test existe parce qu'une FIXTURE avait
// rangé un mémo dans le state du jeu (§13 : seul sim/ y écrit) — et le jour où l'interface
// existera, un écran qui mémorise un repli dans le state se fera attraper ici.
function testFormeState(data: Dict): void {
  const attendues = clesTriees(Etat.nouvellePartie(1, data));
  for (const nom of clesTriees(Bots.strategies())) {
    const trouvees = clesTriees(campagneAvec(3, data, 40, Bots.strategies()[nom]));
    for (const cle of trouvees) {
      if (!attendues.includes(cle)) {
        echecs.push(`le state a gagne la cle \`${cle}\` pendant une campagne de ${nom} : quelqu'un d'autre que sim/ ecrit dans l'etat du jeu (§13), et ce champ part dans les sauvegardes`);
      }
    }
    for (const cle2 of attendues) {
      if (!trouvees.includes(cle2)) echecs.push(`le state a PERDU la cle \`${cle2}\` pendant une campagne de ${nom}`);
    }
  }
  console.log(fmt("forme state  | %d cles, stables sur une campagne de chaque bot", attendues.length));
}

// L'ordre de service des segments (§4) est une REGLE DE JEU, et une LISTE ne se balaie pas au
// levier : ce test le remplace. Il attrape un segment ajouté et oublié dans la liste.
function testOrdreService(data: Dict): void {
  const segs: Dict = data.segments.segments;
  const liste: unknown[] = get(data.segments, "ordre_service", []);
  const vus = new Set<string>();
  for (const nom of liste) {
    const sNom = str(nom);
    if (!Object.hasOwn(segs, sNom)) echecs.push(`data/segments.json:ordre_service nomme \`${sNom}\`, qui n'est pas un segment`);
    if (vus.has(sNom)) echecs.push(`data/segments.json:ordre_service nomme \`${sNom}\` deux fois`);
    vus.add(sNom);
  }
  for (const nom of clesTriees(segs)) {
    if (!vus.has(nom)) echecs.push(`le segment \`${nom}\` est absent de data/segments.json:ordre_service — il serait servi en dernier sans que personne l'ait decide`);
  }
  console.log(fmt("ordre marche | %d segments, servis dans l'ordre declare : %s", Object.keys(segs).length, Marche.ordreService(data).join(" > ")));
}

function verifierNombres(d: Dict, chemin: string): number {
  let n = 0;
  for (const cle of clesTriees(d)) {
    if (cle.startsWith("_")) continue;
    const v = d[cle];
    if (v && typeof v === "object" && !Array.isArray(v)) n += verifierNombres(v, chemin + "." + cle);
    else if (typeof v === "number") {
      if (!Number.isFinite(v)) echecs.push(`constante non finie : ${chemin}.${cle}`);
      n++;
    } else echecs.push(`constante qui n'est pas un nombre : ${chemin}.${cle}`);
  }
  return n;
}

// --- 1ter. les commandes citées dans les commentaires résolvent -----------------

// La règle du projet : un commentaire garde le raisonnement et NOMME LA COMMANDE qui régénère
// le chiffre. Ce test extrait toutes les commandes `balayage.ts <constante> ...` et
// `trace.ts <graine> <bot> <pas> [<constante> ...]` des sources, des données, du .bat et de la
// CI, et vérifie que chaque constante et chaque bot cités existent — ainsi que chaque script
// `src/.../*.ts` qu'une ligne lance. Il attrape le renommage et la suppression : une commande
// citée qui ne marche plus promet au lecteur un moyen de vérifier et le lui refuse.
function testCommandesCitees(data: Dict): void {
  const connus = new Set((Levier.inventaire(data).chemins as string[][]).map((c) => c.join(".")));
  const bots = Bots.strategies();
  const reScript = /(src\/[a-z_]+\/[a-z_]+\.ts)/g;
  const reOutil = /\b(balayage|trace)\.ts\s+(\S.*)$/;
  let n = 0;
  const avant = echecs.length;
  const fichiers = sources();
  for (const fichier of fichiers) {
    for (const ligne of readFileSync(join(RACINE, fichier), "utf8").split("\n")) {
      for (const m of ligne.matchAll(reScript)) {
        n++;
        if (!existsSync(join(RACINE, m[1]))) echecs.push(`${fichier} lance \`${m[1]}\`, qui n'existe pas`);
      }
      const mo = reOutil.exec(ligne);
      if (!mo) continue;
      // Les jetons s'arrêtent à la ponctuation qui suit une commande citée dans une phrase.
      const args = mo[2].split(/\s+/).map((a) => a.replace(/[`,;:)"']+$/, "").replace(/\.$/, "")).filter((a) => a !== "");
      if (mo[1] === "balayage") n += verifierConstante(fichier, args, 0, connus);
      else {
        n += verifierBot(fichier, args, 1, bots);
        n += verifierConstante(fichier, args, 3, connus);
      }
    }
  }
  const casses = echecs.length - avant;
  if (casses > 0) console.log(fmt("commandes    | %d citees, %d CASSEE(S)", n, casses));
  else console.log(fmt("commandes    | %d citees dans %d fichiers, toutes resolues", n, fichiers.length));
}

// Les jokers d'une ligne d'usage (`<constante>`, `[graines]`) décrivent la commande au lieu
// de l'illustrer.
const joker = (a: string): boolean => a.startsWith("<") || a.startsWith("[") || a.startsWith("&");

function verifierConstante(fichier: string, args: string[], i: number, connus: Set<string>): number {
  if (args.length <= i || joker(args[i]) || !args[i].includes(".")) return 0;
  const cite = args[i];
  // La forme courte (`marche.inertie`) est acceptée par balayage.ts, donc ici aussi.
  const trouve = connus.has(cite) || [...connus].some((c) => c.endsWith("." + cite));
  if (!trouve) echecs.push(`${fichier} cite la constante \`${cite}\`, qui ne resout vers aucune constante`);
  return 1;
}

function verifierBot(fichier: string, args: string[], i: number, bots: Dict): number {
  if (args.length <= i || joker(args[i])) return 0;
  const bot = args[i];
  if (bot !== "tous" && !Object.hasOwn(bots, bot)) echecs.push(`${fichier} trace le bot \`${bot}\`, qui n'est pas dans Bots.strategies()`);
  return 1;
}

// --- 1quinquies. la CI se surveille elle-même ---------------------------------

// DEUX TROUS DU MÊME GENRE : un fichier de configuration que personne ne relit.
//   1. UNE DÉROGATION DATÉE HORS DU MÉCANISME : elle porte `jalon: N` et se fait vérifier ici
//      contre `Levier.JALON_COURANT`, comme les dormantes.
//   2. UN TEST QUE RIEN NE LANCE : un script de src/tests/ qui rend des verdicts
//      (`process.exit`) et qu'aucun workflow ne nomme est vert pour toujours.
const WORKFLOWS = ".github/workflows";

function testCi(): void {
  const dossier = join(RACINE, WORKFLOWS);
  if (!existsSync(dossier)) {
    echecs.push(`${WORKFLOWS} ne s'ouvre pas : la CI n'est plus surveillee`);
    return;
  }
  let texte = "";
  for (const f of readdirSync(dossier)) if (f.endsWith(".yml") || f.endsWith(".yaml")) texte += readFileSync(join(dossier, f), "utf8");
  let derogations = 0;
  for (const m of texte.matchAll(/DEROGATION DATEE.*?jalon:\s*([0-9]+)/gs)) {
    derogations++;
    const jalon = Number(m[1]);
    if (jalon <= Levier.JALON_COURANT) {
      echecs.push(fmt("ci.yml : une DEROGATION DATEE annonce le jalon %d, on est au jalon %d — perimee, a retirer ou a rejustifier", jalon, Levier.JALON_COURANT));
    }
  }
  let couverts = 0;
  for (const f of readdirSync(join(RACINE, "src", "tests"))) {
    if (!f.endsWith(".ts")) continue;
    const source = readFileSync(join(RACINE, "src", "tests", f), "utf8");
    if (!source.includes("process.exit(")) continue;
    if (texte.includes("src/tests/" + f)) couverts++;
    else echecs.push(`src/tests/${f} rend des verdicts (process.exit) mais n'apparait dans aucun workflow : rien ne le lance, donc il est vert pour toujours`);
  }
  console.log(fmt("ci           | %d script(s) a verdict couvert(s), %d derogation(s) datee(s) encore valide(s)", couverts, derogations));
  testCiContradiction(texte);
}

// LE SENS INVERSE : un script que la CI LANCE n'a pas le droit d'écrire qu'elle ne le lance
// pas — contradiction entre deux fichiers du même dépôt, donc lisible par une machine.
function testCiContradiction(workflows: string): void {
  for (const f of readdirSync(join(RACINE, "src", "tests"))) {
    if (!f.endsWith(".ts") || !workflows.includes("src/tests/" + f)) continue;
    for (const ligne of readFileSync(join(RACINE, "src", "tests", f), "utf8").split("\n")) {
      if (!ligne.trimStart().startsWith("//")) continue;
      if (ligne.toLowerCase().includes("pas dans la ci")) {
        echecs.push(`src/tests/${f} ecrit « ${ligne.trim()} » alors qu'un workflow le lance : la CI et le commentaire se contredisent`);
      }
    }
  }
}

// Les dossiers fouillés. Un dossier déclaré mais introuvable ÉCHOUE au lieu d'être sauté :
// le test resterait vert en ayant cessé de regarder.
const DOSSIERS = ["src/sim", "src/tests", "data", "outils", ".github/workflows"];
const EXTENSIONS = [".ts", ".json", ".bat", ".yml"];

function sources(): string[] {
  const liste: string[] = [];
  for (const dossier of DOSSIERS) {
    if (!existsSync(join(RACINE, dossier))) {
      echecs.push(`${dossier} est declare dans run.ts:DOSSIERS mais ne s'ouvre pas : le test des commandes a cesse de le regarder`);
      continue;
    }
    for (const f of readdirSync(join(RACINE, dossier))) if (EXTENSIONS.some((e) => f.endsWith(e))) liste.push(dossier + "/" + f);
  }
  return liste;
}

// --- 1ter bis. l'espace de conception (§2) -----------------------------------

// LE PENDANT DU LEVIER, UN ÉTAGE PLUS HAUT : le levier garde les CONSTANTES, ce test garde les
// CHOIX. Il parcourt l'espace des paramètres de §2 et demande « ce curseur a-t-il une
// position dominante ? ». Un paramètre dont une extrémité est toujours la bonne n'est pas un
// arbitrage, c'est une réponse.
// LES SEPT DIRECTIONS sont celles de §2. LE SEUIL vient de la mesure : la contrepartie la plus
// mince du jeu est à ~3 %, un terme symbolique à 0.01 % — le seuil passe entre les deux.
const SEUIL_ARBITRAGE = 0.01;
const DIRECTIONS: Dict = {
  cout_unitaire: -1.0, signature: -1.0, instabilite_neuro: -1.0,
  debit_kg_sem: 1.0, regularite_lot: 1.0, puissance: 1.0, dependance: 1.0,
};

function testConception(data: Dict): void {
  const avant = echecs.length;
  const familles = clesTriees(data.precurseurs.familles);
  const axes: Record<string, number[]> = {
    purete: [0.30, 0.50, 0.70, 0.85, 0.99],
    rendement: [0.20, 0.45, 0.70, 0.95],
    complexite: [1.0, 2.0, 3.0, 4.0, 5.0],
    coupe: [0.0, 0.25, 0.45, 0.70],
    stabilisation: [0.0, 1.0, 2.0, 3.0],
    marquage: [0.0, 1.0, 2.0],
  };
  const ctxs = contextes(familles);
  // L'ÉCHELLE DE CHAQUE SPEC, prise sur tout l'échantillon : un gain se juge contre l'étendue
  // de sa colonne, jamais contre sa propre valeur de départ.
  const basSpec: Dict = {};
  const hautSpec: Dict = {};
  for (const ctx0 of ctxs) {
    const s0 = Produit.specs(ctx0, data);
    for (const sp of Object.keys(DIRECTIONS)) {
      basSpec[sp] = minf(Number(get(basSpec, sp, 1e30)), s0[sp]);
      hautSpec[sp] = maxf(Number(get(hautSpec, sp, -1e30)), s0[sp]);
    }
  }
  let plusFaible = 1e30;
  let ouFaible = "";
  for (const axe of clesTriees(axes)) {
    const valeurs = axes[axe];
    // Deux sens, mesurés séparément : le MEILLEUR gain en montant le curseur, et en le baissant.
    let gainHaut = 0.0;
    let gainBas = 0.0;
    for (const ctx of ctxs) {
      for (let i = 0; i < valeurs.length - 1; i++) {
        const sb = Produit.specs({ ...ctx, [axe]: valeurs[i] }, data);
        const sh = Produit.specs({ ...ctx, [axe]: valeurs[i + 1] }, data);
        for (const spec of Object.keys(DIRECTIONS)) {
          const etendue = maxf(hautSpec[spec] - basSpec[spec], 1e-9);
          const g = (sh[spec] - sb[spec]) * DIRECTIONS[spec] / etendue;
          gainHaut = maxf(gainHaut, g);
          gainBas = maxf(gainBas, -g);
        }
      }
    }
    for (const sens of ["monter", "baisser"]) {
      const g2 = sens === "monter" ? gainHaut : gainBas;
      if (g2 < plusFaible) {
        plusFaible = g2;
        ouFaible = `${sens} \`${axe}\``;
      }
      if (g2 < SEUIL_ARBITRAGE) {
        echecs.push(fmt("§2 : %s `%s` n'ameliore aucune spec de plus de %.2f%% de son etendue (seuil %.0f%%) — la contrepartie existe peut-etre, mais elle est symbolique : ce curseur n'a qu'une bonne position",
          sens, axe, maxf(g2, 0.0) * 100, SEUIL_ARBITRAGE * 100));
      }
    }
  }
  // Les familles et les trois choix à options : aucune option ne doit être dominée par une
  // autre sur les sept specs dans tous les contextes — ce serait un choix que personne n'a de
  // raison de faire.
  testOptions(data, "famille", familles, ctxs);
  for (const [cle, groupe] of [["forme", "formes"], ["agent", "agents"], ["cadence", "cadences"]]) {
    testOptions(data, cle, clesTriees(data.conception[groupe].options), ctxs);
  }
  const casses = echecs.length - avant;
  if (casses > 0) console.log(fmt("conception   | %d contextes x %d axes : %d CURSEUR(S) SANS ARBITRAGE", ctxs.length, Object.keys(axes).length, casses));
  else {
    console.log(fmt("conception   | %d contextes x %d axes, %d familles : aucun curseur sans arbitrage — le plus mince : %s, %.1f%% (seuil %.0f%%)",
      ctxs.length, Object.keys(axes).length, familles.length, ouFaible, plusFaible * 100, SEUIL_ARBITRAGE * 100));
  }
}

function testOptions(data: Dict, cle: string, options: string[], ctxs: Dict[]): void {
  for (const a of options) {
    for (const b of options) {
      if (a === b) continue;
      let domine = true;
      for (const ctx of ctxs) {
        const sa = Produit.specs({ ...ctx, [cle]: a }, data);
        const sb = Produit.specs({ ...ctx, [cle]: b }, data);
        for (const spec of Object.keys(DIRECTIONS)) {
          if ((sb[spec] - sa[spec]) * DIRECTIONS[spec] < -1e-9) {
            domine = false;
            break;
          }
        }
        if (!domine) break;
      }
      if (domine) {
        echecs.push(`§2 : l'option \`${a}\` de \`${cle}\` est dominee par \`${b}\` sur les sept specs et dans tous les contextes : personne n'a de raison de la choisir`);
      }
    }
  }
}

// Un échantillon de recettes complètes, une par combinaison des AUTRES axes : on teste qu'un
// axe garde une raison d'être bougé DANS DES CONTEXTES VARIÉS.
function contextes(familles: string[]): Dict[] {
  const liste: Dict[] = [];
  for (const famille of familles)
    for (const purete of [0.40, 0.75, 0.99])
      for (const rendement of [0.30, 0.60, 0.95])
        for (const complexite of [1, 3, 5])
          for (const coupe of [0.0, 0.35, 0.70])
            for (const stabilisation of [0, 1, 3])
              liste.push({ famille, purete, rendement, complexite, coupe, stabilisation });
  return liste;
}

// --- 1quater. la recherche (§2bis) ------------------------------------------

// CE QUE CE TEST GARDE : les TROIS PROMESSES de §2bis, dont aucune ne se casse dans le code —
// elles se cassent dans une ligne de data/procedes.json, en silence.
//   1. « aucun bonus numérique direct » — la liste de ce qu'une case peut ouvrir est FERMÉE ;
//   2. « une partie entière est jouable sans rien rechercher » — le kit de départ SORT des kilos ;
//   3. la grille est UNE grille — cases lisibles, distinctes, hors du centre, toutes
//      atteignables depuis le centre de proche en proche.
function testRecherche(data: Dict): void {
  const noeuds: Dict = data.procedes.noeuds;
  const familles: Dict = data.precurseurs.familles;
  const centre = str(data.procedes.centre);
  const occupees: Dict = {};
  for (const id of clesTriees(noeuds)) {
    const n = noeuds[id];
    if (Object.keys(n.ouvre).length === 0) echecs.push(`la case \`${id}\` n'ouvre rien`);
    for (const cle of Object.keys(n.ouvre)) {
      if (!Recherche.OUVERTURES.includes(cle)) {
        echecs.push(`la case \`${id}\` ouvre \`${cle}\`, qui n'est pas dans la liste fermee de §2bis — la recherche donnerait un bonus numerique au lieu d'ouvrir un choix`);
      }
      if (cle === "famille" && !Object.hasOwn(familles, str(n.ouvre[cle]))) {
        echecs.push(`la case \`${id}\` ouvre la famille \`${n.ouvre[cle]}\`, absente de precurseurs.json`);
      }
      const groupe = ({ forme: "formes", agent: "agents", cadence: "cadences" } as Dict)[cle];
      if (groupe && !Object.hasOwn(data.conception[groupe].options, str(n.ouvre[cle]))) {
        echecs.push(`la case \`${id}\` ouvre l'option \`${n.ouvre[cle]}\` de \`${groupe}\`, absente de conception.json`);
      }
    }
    const texte = str(get(n, "case", ""));
    const morceaux = texte.split(",");
    if (morceaux.length !== 2 || !/^-?\d+$/.test(morceaux[0]) || !/^-?\d+$/.test(morceaux[1])) {
      echecs.push(`la case \`${id}\` a une coordonnee illisible (\`${texte}\`) : attendu \`q,r\``);
      continue;
    }
    const cleCase = `${Number(morceaux[0])},${Number(morceaux[1])}`;
    if (cleCase === centre) echecs.push(`la case \`${id}\` est posee sur le centre de la grille`);
    if (Object.hasOwn(occupees, cleCase)) echecs.push(`les cases \`${occupees[cleCase]}\` et \`${id}\` occupent le meme hexagone ${cleCase}`);
    occupees[cleCase] = id;
    const bras = str(get(n, "bras", ""));
    if (bras.startsWith("_") || !Object.hasOwn(data.procedes.savoir.bras, bras)) {
      echecs.push(`la case \`${id}\` appartient au bras \`${bras}\`, absent de procedes.savoir.bras`);
    }
    if (Number(get(n, "cout_savoir", -1.0)) < 0.0) echecs.push(`la case \`${id}\` n'a pas de \`cout_savoir\` valide`);
  }
  // LA CONNEXITÉ, vérifiée sur le code du jeu : on prend tout ce qui est disponible, sans
  // regarder l'argent, jusqu'à ce que plus rien ne s'ouvre.
  const tout = Sim.nouvellePartie(1, data);
  let ouvertes = Recherche.disponibles(tout, data);
  while (ouvertes.length > 0) {
    for (const id2 of ouvertes) tout.recherche.acquis[id2] = 1.0;
    ouvertes = Recherche.disponibles(tout, data);
  }
  for (const id3 of clesTriees(noeuds)) {
    if (!Object.hasOwn(tout.recherche.acquis, id3)) echecs.push(`la case \`${id3}\` n'est reliee au centre par aucun chemin : elle est inatteignable`);
  }
  const depart = data.procedes.ouvertures_depart;
  for (const borne of Recherche.BORNES) {
    if (!Object.hasOwn(depart, borne)) echecs.push(`ouvertures_depart n'a pas de \`${borne}\` : la borne de depart n'est pas declaree`);
  }
  for (const f of depart.familles as string[]) {
    if (!Object.hasOwn(familles, str(f))) echecs.push(`ouvertures_depart nomme la famille \`${f}\`, absente de precurseurs.json`);
  }
  // LA BUTÉE DÉCLARÉE doit être OUVERTE AU DÉPART.
  const defaut = str(depart.famille_defaut);
  if (!(depart.familles as string[]).includes(defaut)) {
    echecs.push(`ouvertures_depart.famille_defaut vaut \`${defaut}\`, qui n'est pas dans les familles ouvertes au depart : la butee donnerait une famille non cherchee`);
  }
  // La promesse 2, vérifiée sur le JEU : la meilleure recette du kit de départ sort-elle des kilos ?
  const etat = Sim.nouvellePartie(1, data);
  const limites = Recherche.ouvertures(etat, data);
  const auMax = { famille: str(depart.familles[0]), purete: 9.0, rendement: 9.0, complexite: 9, coupe: 0.0, stabilisation: 9 };
  const debit = Number(Produit.specs(Produit.normaliser(auMax, data, limites), data).debit_kg_sem);
  if (debit <= 0.0) echecs.push("le kit de depart ne produit AUCUN kilo : §2bis promet qu'une partie entiere est jouable sans rien rechercher");
  // Le repli ne doit pas DÉRIVER quand on cherche : la régression exacte qui a existé.
  const verrouillee = { famille: "___aucune___", purete: 0.5, rendement: 0.5, complexite: 1, coupe: 0.0, stabilisation: 0 };
  const replis = new Set<string>();
  for (const id4 of clesTriees(noeuds)) {
    etat.recherche.acquis[id4] = 1.0;
    replis.add(str(Produit.normaliser(verrouillee, data, Recherche.ouvertures(etat, data)).famille));
  }
  if (replis.size > 1 || !replis.has(defaut)) {
    echecs.push(`la butee de famille DERIVE au fil de la recherche (${[...replis].sort().join(" ")}) : elle doit rester \`${defaut}\``);
  }
  console.log(fmt("recherche    | %d cases, grille connexe, kit de depart a %.1f kg/sem, butee `%s` stable", Object.keys(noeuds).length, debit, defaut));
}

// L'ARITHMÉTIQUE DE src/sim/recherche.ts : une case de chaque genre d'ouverture parmi celles
// qui touchent le centre — et pas « la moins chère », qui n'exerçait qu'un genre.
function testRechercheComportement(data: Dict): void {
  const noeuds: Dict = data.procedes.noeuds;
  const libres = Recherche.disponibles(Sim.nouvellePartie(1, data), data);
  const cibles: Dict = {};
  for (const id of libres) for (const genre of Object.keys(noeuds[id].ouvre)) if (!Object.hasOwn(cibles, genre)) cibles[genre] = id;
  const verrou = clesTriees(noeuds).find((id) => !libres.includes(id)) ?? "";
  if (Object.keys(cibles).length === 0 || verrou === "") {
    echecs.push("recherche : la grille n'a pas a la fois des cases libres et des cases verrouillees au depart, ce test ne mesure rien");
    return;
  }
  for (const genre of clesTriees(cibles)) eprouverNoeud(data, cibles[genre], verrou, genre);
  console.log(fmt("recherche+   | %d genres : cout debite une fois, achat instantane, borne reculee, voisines ouvertes, inflation", Object.keys(cibles).length));
}

// Une passe complète sur UNE case. `genre` dit quelle ouverture elle porte.
function eprouverNoeud(data: Dict, cible: string, verrou: string, genre: string): void {
  const noeuds: Dict = data.procedes.noeuds;
  const cout = Number(noeuds[cible].cout_propre);
  const bras = str(noeuds[cible].bras);
  const exige = Number(noeuds[cible].cout_savoir);
  // 1. UNE CASE QUI NE TOUCHE RIEN REFUSE, ET NE DÉPENSE RIEN. Le savoir-faire est mis au plein
  // dans les premiers cas : c'est l'ADJACENCE puis l'ARGENT qui doivent refuser.
  let e = Sim.nouvellePartie(1, data);
  remplirSavoir(e, 1e6);
  let avant = Number(e.cash_propre);
  if (Sim.appliquer(e, data, { type: "recherche", noeud: verrou })) echecs.push(`recherche : \`${verrou}\` achete sans toucher ni le centre ni une case acquise`);
  if (!isEqualApprox(e.cash_propre, avant)) echecs.push("recherche : un achat REFUSE a quand meme debite le propre");
  // 2. UN ACHAT IMPAYABLE REFUSE, ET NE DÉPENSE RIEN.
  e.cash_propre = cout - 1.0;
  if (Sim.appliquer(e, data, { type: "recherche", noeud: cible })) echecs.push(`recherche : \`${cible}\` achete avec un dollar de moins que son cout`);
  if (!isEqualApprox(e.cash_propre, cout - 1.0)) echecs.push("recherche : un achat impayable a quand meme debite le propre");
  // 2bis. LE SAVOIR-FAIRE MANQUANT REFUSE AUSSI, et celui des AUTRES bras n'aide pas.
  if (exige > 0.0) {
    e = Sim.nouvellePartie(1, data);
    remplirSavoir(e, 1e6);
    e.recherche.savoir[bras] = exige - 0.01;
    avant = Number(e.cash_propre);
    if (Sim.appliquer(e, data, { type: "recherche", noeud: cible })) echecs.push(`recherche : \`${cible}\` achete sans le savoir-faire de son bras \`${bras}\`, avec celui des autres`);
    if (!isEqualApprox(e.cash_propre, avant)) echecs.push("recherche : un achat refuse faute de savoir-faire a quand meme debite le propre");
  }
  // 3. LE COÛT EST DÉBITÉ EXACTEMENT, ET UNE SEULE FOIS — prix de base, sans inflation, et
  // exactement son savoir-faire, dans son bras.
  e = Sim.nouvellePartie(1, data);
  e.recherche.savoir[bras] = exige + 5.0;
  avant = Number(e.cash_propre);
  const avantLim = Recherche.LISTES[genre] === undefined ? Number(get(Recherche.ouvertures(e, data), genre, 0.0)) : 0.0;
  const avantLibres = Recherche.disponibles(e, data);
  if (!Sim.appliquer(e, data, { type: "recherche", noeud: cible })) {
    echecs.push(`recherche : \`${cible}\` refuse alors qu'il est libre et payable`);
    return;
  }
  if (!isEqualApprox(e.cash_propre, avant - cout)) echecs.push(`recherche : \`${cible}\` coute ${num(cout, 2)} mais a debite ${num(avant - e.cash_propre, 2)}`);
  if (!isEqualApprox(e.stats.propre_recherche, cout)) echecs.push("recherche : la statistique `propre_recherche` ne suit pas le debit");
  if (!isEqualApprox(e.recherche.savoir[bras], 5.0)) echecs.push(`recherche : \`${cible}\` exige ${num(exige, 2)} de savoir-faire mais en a debite ${num(exige + 5.0 - e.recherche.savoir[bras], 2)}`);
  // 4. L'ACHAT EST INSTANTANÉ — acquis dans le même appel, et la borne a déjà reculé.
  if (!Object.hasOwn(e.recherche.acquis, cible)) echecs.push(`recherche : \`${cible}\` paye mais pas acquis sur-le-champ`);
  const ouvre = noeuds[cible].ouvre;
  const apres = Recherche.ouvertures(e, data);
  if (Recherche.LISTES[genre] !== undefined) {
    if (!(apres[Recherche.LISTES[genre]] as string[]).includes(str(ouvre[genre]))) echecs.push(`recherche : \`${cible}\` acquis mais l'option \`${ouvre[genre]}\` reste fermee`);
  } else if (Number(apres[genre]) <= avantLim) {
    echecs.push(`recherche : \`${cible}\` acquis mais la borne \`${genre}\` n'a pas recule (${num(apres[genre], 3)})`);
  }
  // 5. ON NE RACHÈTE PAS UNE CASE ACQUISE.
  const pendant = Number(e.cash_propre);
  if (Sim.appliquer(e, data, { type: "recherche", noeud: cible })) echecs.push(`recherche : \`${cible}\` achete deux fois`);
  if (!isEqualApprox(e.cash_propre, pendant)) echecs.push("recherche : un rachat refuse a quand meme debite le propre");
  // 6. L'ADJACENCE OUVRE : une voisine qui ne touchait rien avant est devenue achetable.
  const ici = Recherche.lireCase(str(noeuds[cible].case));
  for (const id of clesTriees(noeuds)) {
    if (avantLibres.includes(id) || id === cible) continue;
    if (Recherche.voisines(ici, Recherche.lireCase(str(noeuds[id].case))) && !Recherche.disponibles(e, data).includes(id)) {
      echecs.push(`recherche : \`${cible}\` acquis mais sa voisine \`${id}\` reste verrouillee`);
    }
  }
  // 7. L'INFLATION : toute autre case de la branche coûte sa base majorée d'UNE case acquise.
  const k = Number(data.procedes.inflation_par_acquis);
  const branche = str(noeuds[cible].branche);
  for (const id5 of clesTriees(noeuds)) {
    if (id5 === cible || str(noeuds[id5].branche) !== branche) continue;
    const attendu = Number(noeuds[id5].cout_propre) * (1.0 + k);
    if (!isEqualApprox(Recherche.cout(e, data, id5), attendu)) {
      echecs.push(`recherche : apres une case, \`${id5}\` coute ${num(Recherche.cout(e, data, id5), 2)} au lieu de ${num(attendu, 2)}`);
    }
  }
}

function remplirSavoir(e: Dict, valeur: number): void {
  for (const b of Object.keys(e.recherche.savoir)) e.recherche.savoir[b] = valeur;
}

// LE SAVOIR-FAIRE (§2bis) : les trois promesses qui le séparent d'une monnaie de recherche
// déguisée — chaque bras n'apprend QUE de ses curseurs ; un plafond encore égal au minimum
// n'apprend rien ; il ne touche à aucune bourse, et la part de production le pondère.
function testSavoir(data: Dict): void {
  const base = { famille: "verdal", purete: 0.40, rendement: 0.40, complexite: 1, coupe: 0.0, stabilisation: 0 };
  const cas: [string, number, string][] = [["purete", 0.60, "purete_procede"], ["coupe", 0.30, "volume"], ["rendement", 0.75, "volume"]];
  for (const [curseur, valeur, brasAttendu] of cas) {
    const e = Sim.nouvellePartie(1, data);
    Sim.appliquer(e, data, { type: "recette", recette: { ...base, [curseur]: valeur } });
    e.part_capacite = 1.0;
    const propre = Number(e.cash_propre);
    const sale = Number(e.cash_sale);
    Recherche.apprendre(e, data);
    const sv: Dict = e.recherche.savoir;
    for (const b of clesTriees(sv)) {
      const attenduPositif = b === brasAttendu || b === "familles_stabilisation";
      if (attenduPositif && sv[b] <= 0.0) echecs.push(`savoir : \`${curseur}\` en butee n'apprend rien au bras \`${b}\``);
      if (!attenduPositif && sv[b] > 0.0) echecs.push(`savoir : \`${curseur}\` en butee fait apprendre le bras \`${b}\`, qui n'est pas le sien — on pourrait farmer un curseur pour en acheter un autre`);
    }
    if (!isEqualApprox(e.cash_propre, propre) || !isEqualApprox(e.cash_sale, sale)) {
      echecs.push("savoir : apprendre a touche une bourse — le savoir-faire ne s'echange jamais contre de l'argent");
    }
  }
  const e2 = Sim.nouvellePartie(1, data);
  Sim.appliquer(e2, data, { type: "recette", recette: base });
  e2.part_capacite = 1.0;
  Recherche.apprendre(e2, data);
  if (e2.recherche.savoir.purete_procede > 0.0) echecs.push("savoir : complexite 1 au depart (plafond = minimum) fait apprendre le bras Purete/Procede");
  if (e2.recherche.savoir.familles_stabilisation <= 0.0) echecs.push("savoir : produire la famille la plus avancee n'apprend rien au bras Familles");
  const gains = [0.0, 0.2, 1.0].map((part) => {
    const e3 = Sim.nouvellePartie(1, data);
    Sim.appliquer(e3, data, { type: "recette", recette: base });
    e3.part_capacite = part;
    Recherche.apprendre(e3, data);
    return Number(e3.recherche.savoir.familles_stabilisation);
  });
  if (gains[0] > 0.0 || !(gains[1] < gains[2])) echecs.push(`savoir : la part de production ne pondere pas le gain (${gains.join(", ")})`);
  console.log("savoir       | chaque bras n'apprend que de ses curseurs, aucune bourse touchee, pondere par la part");
}

// --- 1bis. calibration ---------------------------------------------------------

// La substance est fictive : aucune vérité extérieure à laquelle se caler. Les attendus de
// data/calibration.json sont une INTENTION DE DESIGN, et ce test vérifie que les sept
// formules la servent encore. Un attendu à zéro ne se compare pas en relatif.
function testCalibration(data: Dict): void {
  const cal = data.calibration;
  const tol = Number(cal.tolerance);
  for (const r of cal.references as Dict[]) {
    const specs = Produit.specs(r.recette, data);
    const morceaux: string[] = [];
    for (const cle of clesTriees(r.attendu)) {
      const attendu = Number(r.attendu[cle]);
      const obtenu = Number(specs[cle]);
      const ecart = Math.abs(attendu) > 1e-9 ? Math.abs(obtenu - attendu) / attendu : Math.abs(obtenu);
      morceaux.push(fmt("%s %.4f", cle, obtenu));
      if (ecart > tol) {
        echecs.push(fmt("calibration hors tolerance : %s / %s (attendu %.4f, obtenu %.4f, ecart %.1f%%)", r.nom, cle, attendu, obtenu, ecart * 100));
      }
    }
    console.log(fmt("calibration  | %-40s %s", r.nom, morceaux.join(" | ")));
  }
  testCalibrationOrdres(data);
}

// L'INTENTION, ET PAS LES CHIFFRES : les ordres de calibration.json sont ce qu'aucune remesure
// d'attendu ne satisfait toute seule. Une formule qui casse un ordre a cassé le jeu.
function testCalibrationOrdres(data: Dict): void {
  const parId: Dict = {};
  for (const r of data.calibration.references as Dict[]) parId[str(get(r, "id", ""))] = r;
  let n = 0;
  for (const ordre of get(data.calibration, "ordres", []) as Dict[]) {
    const ids: string[] = ordre.croissant;
    for (const id of ids) {
      if (!Object.hasOwn(parId, id)) {
        echecs.push(`calibration.json:ordres cite \`${id}\`, qui n'est l'id d'aucune reference`);
        return;
      }
    }
    for (const spec of ordre.specs as string[]) {
      let precedent = -1e30;
      let nomPrec = "";
      for (const id2 of ids) {
        const v = Number(Produit.specs(parId[id2].recette, data)[spec]);
        if (v <= precedent) {
          echecs.push(`§2 : l'ordre est casse sur \`${spec}\` — \`${id2}\` donne ${num(v, 3)}, pas au-dessus de \`${nomPrec}\` (${num(precedent, 3)}). calibration.json:ordres exige ${ids.join(" < ")} strictement croissant.`);
        }
        precedent = v;
        nomPrec = id2;
      }
      n++;
    }
  }
  console.log(fmt("calib. ordres | %d ordres tenus, lus dans calibration.json (aucune recette recopiee ici)", n));
}

// --- 2. déterminisme : même graine, même hash ---------------------------------

// TOUS LES BOTS, et pas seulement `discret`, le seul profil qui ne cherche RIEN. Ce que ce
// test PEUT prouver : que le flux aléatoire avance et diffère d'une graine à l'autre. Il ne
// prétend pas que deux graines vivent des parties différentes — au jalon 1 elles n'en vivent
// pas, et ce n'est pas un bug du générateur.
function testDeterminisme(data: Dict): void {
  for (const nom of clesTriees(Bots.strategies())) {
    const strat = Bots.strategies()[nom];
    if (hacher(campagneAvec(42, data, 130, strat)) !== hacher(campagneAvec(42, data, 130, strat))) {
      echecs.push(`determinisme : hashes differents pour la meme graine (${nom})`);
      return;
    }
  }
  const h1 = hacher(campagneAvec(42, data, 130, Bots.strategies().discret));
  const strat = Bots.strategies().industriel;
  const a = campagneAvec(42, data, 30, strat);
  const b = campagneAvec(43, data, 30, strat);
  if (isEqualApprox(a.rng, b.rng)) {
    echecs.push("determinisme : deux graines aboutissent au meme etat de RNG (flux debranche)");
    return;
  }
  if (isEqualApprox(a.rng, a.graine)) {
    echecs.push("determinisme : le RNG n'a pas avance en 30 ticks (personne ne tire)");
    return;
  }
  console.log("determinisme | double run seede identique, graines distinctes (130 ticks)");
  // L'EMPREINTE, imprimée : à confronter ENTRE deux machines, sur le même commit. Ce n'est pas
  // une baseline qu'on cite (§16) : rien ici ne la stocke ni ne la compare à une valeur écrite.
  console.log(`             > empreinte campagne de reference (graine 42, 130 ticks) : ${h1.slice(0, 16)}`);
}

// --- 3. save/load : reprise sans divergence -----------------------------------

// ON S'ARRÊTE EN PLEINE MONTÉE de la grille, on ne l'espère pas : au moins une case acquise,
// pas toute la liste — c'est l'état partiel qui doit traverser le JSON.
function testSaveLoad(data: Dict): void {
  let enMontee = 0;
  for (const nom of clesTriees(Bots.strategies())) {
    const strat = Bots.strategies()[nom];
    const s1 = Sim.nouvellePartie(7, data);
    const voulu = (strat.recherche as string[]).length;
    for (let t = 0; t < 140; t++) {
      const nAcq = Object.keys(s1.recherche.acquis).length;
      if (nAcq > 0 && nAcq < voulu && t >= 60) break;
      Bots.agir(s1, data, strat);
      Sim.tick(s1, data);
    }
    const nFin = Object.keys(s1.recherche.acquis).length;
    if (nFin > 0 && nFin < voulu) enMontee++;
    const s2 = JSON.parse(Etat.serialiser(s1));
    if (!Etat.equivalents(s1, s2)) {
      echecs.push(`save/load (${nom}) : etat non equivalent des la sauvegarde`);
      return;
    }
    for (let i = 0; i < 60; i++) {
      Bots.agir(s1, data, strat);
      Sim.tick(s1, data);
      Bots.agir(s2, data, strat);
      Sim.tick(s2, data);
      if (!Etat.equivalents(s1, s2)) {
        echecs.push(`save/load (${nom}) : divergence au tick de reprise ${i + 1}`);
        return;
      }
    }
  }
  // Le test doit AVOIR TROUVÉ une montée, sinon il ne dit rien de §2bis.
  if (enMontee === 0) echecs.push("save/load : aucun bot n'etait en pleine montee de la grille, donc un etat de recherche partiel (§2bis) n'a jamais traverse un aller-retour JSON");
  console.log(fmt("save/load    | roundtrip + 60 ticks sur %d bots, dont %d en pleine montee de la grille", Object.keys(Bots.strategies()).length, enMontee));
}

// --- 4. la règle du papier (§5) : deux bourses, un seul robinet ----------------

// Le propre ne monte QUE par le blanchiment : d'une semaine à l'autre, sa hausse ne dépasse
// jamais ce que le blanchiment a rendu. Et le sale ne passe jamais sous zéro.
function testRegleDuPapier(data: Dict): void {
  const state = Sim.nouvellePartie(3, data);
  const strat = Bots.strategies().industriel;
  let hausseMax = 0.0;
  for (let i = 0; i < 200; i++) {
    const propreAvant = Number(state.cash_propre);
    const blanchiAvant = Number(state.stats.propre_blanchi);
    Bots.agir(state, data, strat);
    Sim.tick(state, data);
    if (state.cash_sale < 0.0) {
      echecs.push(fmt("regle du papier : cash_sale negatif au tick %d", state.tick));
      return;
    }
    const hausse = state.cash_propre - propreAvant;
    const blanchi = state.stats.propre_blanchi - blanchiAvant;
    if (hausse > blanchi + 1e-6) {
      echecs.push(fmt("regle du papier : le propre monte de %.2f alors que le blanchiment n'a rendu que %.2f (tick %d)", hausse, blanchi, state.tick));
      return;
    }
    hausseMax = maxf(hausseMax, hausse);
    if (state.fin !== "") break;
  }
  console.log(fmt("papier       | 1 seul robinet vers le propre (hausse hebdo max %.0f $), sale jamais negatif", hausseMax));
}

// --- 5. la dette : l'horloge de l'acte I (§1bis) -------------------------------

function testDette(data: Dict): void {
  const montant = Number(data.constants.dette.montant);
  const echeance = Number(data.constants.dette.echeance_sem);
  const riche = aLEcheance(data, montant * 3.0, echeance);
  if (riche.fin === "saisie" || riche.dette > 0.0) echecs.push("dette : le solvable n'a pas rembourse a l'echeance");
  else if (!isEqualApprox(riche.cash_propre, montant * 3.0 - montant - Number(data.constants.eco.cout_fixe_sem))) {
    echecs.push("dette : le remboursement n'a pas debite exactement le montant du");
  }
  const pauvre = aLEcheance(data, montant * 0.5, echeance);
  if (pauvre.fin !== "saisie") echecs.push(`dette : l'insolvable n'a pas ete saisi a l'echeance (fin=${pauvre.fin})`);
  const veille = aLEcheance(data, montant * 0.5, echeance - 1.0);
  if (veille.fin === "saisie") echecs.push("dette : saisie declenchee AVANT l'echeance");
  console.log(fmt("dette        | echeance semaine %.0f : solvable rembourse, insolvable saisi, veille calme", echeance));
}

function aLEcheance(data: Dict, propre: number, tickVise: number): Dict {
  const state = Sim.nouvellePartie(1, data);
  state.tick = tickVise - 1.0;
  state.cash_propre = propre;
  Sim.tick(state, data);
  return state;
}

// --- 6. la visibilité : la jauge 1/3 (§7) -------------------------------------

function testVisibilite(data: Dict): void {
  const cv = data.constants.visibilite;
  const state = Sim.nouvellePartie(1, data);
  state.cash_sale = 1e9;
  let semaines = 0;
  while (state.fin === "" && semaines < 100) {
    Sim.tick(state, data);
    semaines++;
  }
  if (state.fin !== "arrestation") echecs.push(`visibilite : un tas de sale enorme n'a pas mene a l'arrestation (fin=${state.fin})`);
  else if (semaines !== Math.trunc(cv.semaines_arrestation)) echecs.push(fmt("visibilite : arrestation en %d semaines, attendu %d", semaines, cv.semaines_arrestation));
  const calme = Sim.nouvellePartie(1, data);
  for (let i = 0; i < 10; i++) Sim.tick(calme, data);
  if (calme.visibilite !== 0.0) echecs.push(fmt("visibilite : la jauge bouge sans aucune activite (%.3f)", calme.visibilite));
  console.log(fmt("visibilite   | arrestation en %d semaines au-dessus de %.0f, plancher tenu a 0", semaines, cv.seuil_arrestation));
}

// --- 7. campagnes bot : elles finissent, et elles ne finissent pas pareil ------

function testCampagnesBot(data: Dict): void {
  const strats = Bots.strategies();
  const profils: Dict = {};
  for (const nom of clesTriees(strats)) {
    for (const graine of [1, 7, 13]) {
      const state = Sim.nouvellePartie(graine, data);
      const semainesMax = Math.trunc(data.constants.sim.semaines_max);
      for (let t = 0; t <= semainesMax; t++) {
        Bots.agir(state, data, strats[nom]);
        Sim.tick(state, data);
        if (state.fin !== "") break;
      }
      if (state.fin === "") echecs.push(`campagne ${nom}/${graine} : aucune fin atteinte`);
      profils[nom] = { fin: state.fin, visibilite: state.visibilite, cash_sale: state.cash_sale };
      console.log(fmt("campagne     | %-12s graine %2d | fin=%-13s sem=%3d propre=%9.0f sale=%11.0f visib=%5.1f",
        nom, graine, state.fin, state.tick, state.cash_propre, state.cash_sale, state.visibilite));
    }
  }
  // Deux bots qui vivent la même partie disent qu'aucun choix ne décide.
  const signatures = new Set(clesTriees(strats).map((nom) => {
    const s = profils[nom];
    return `${s.fin}|${floori(s.visibilite / 10)}|${floori(s.cash_sale / 1e6)}`;
  }));
  if (signatures.size < Object.keys(strats).length) echecs.push(`campagnes : les ${Object.keys(strats).length} bots vivent la meme partie — aucun choix ne decide`);
}

// --- boucle de campagne partagée ----------------------------------------------

function campagneAvec(graine: number, data: Dict, nTicks: number, strat: Dict): Dict {
  const state = Sim.nouvellePartie(graine, data);
  for (let i = 0; i < nTicks; i++) {
    Bots.agir(state, data, strat);
    Sim.tick(state, data);
  }
  return state;
}


if (import.meta.main) process.exit(principal());
