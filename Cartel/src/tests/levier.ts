// Raison d'être : LA porte du jalon 0 (§15) — « casser volontairement une constante de 30 %
// et vérifier qu'un verdict passe au rouge. Si rien ne bouge, le levier est débranché et
// l'équilibrage se fera dans le vide pendant six mois. » Port de tests/levier.gd.
//
// Ce test fait le tour COMPLET des données : chaque constante, une par une, ±30 %, et au
// moins une métrique doit bouger. C'est la règle de §16 (« un résultat bit-identique après
// un changement de 20 % n'est pas une confirmation, c'est un levier débranché ») appliquée
// au harnais lui-même.
//
// Ce qu'il ne dit PAS : qu'une constante est bien câblée, ou câblée au bon endroit. Il dit
// qu'elle est câblée quelque part, et DE COMBIEN elle pèse. Rien n'est écrit sur le disque
// hors du csv : les constantes sont perturbées dans une COPIE des données.
//
//   node src/tests/levier.ts [graines]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Dict, absf, maxf, mini, maxi, floori, isEqualApprox, clesTriees, copie } from "../sim/gd.ts";
import { chargerData, RACINE } from "../sim/disque.ts";
import * as Produit from "../sim/produit.ts";
import * as Bots from "./bots.ts";
import * as Balance from "./balance.ts";
import { fmt, num } from "./fmt.ts";

export const PERTURBATION = 0.30;
// Une constante à zéro ne bouge pas de ±30 % : on la perturbe d'un delta ABSOLU, vers le haut,
// et le rapport le dit.
const DELTA_NUL = 1000.0;

// LE CANARI : une constante que RIEN ne lit, perturbée exactement comme les autres, et qui
// doit ressortir MORTE. C'est la seule preuve que ce fichier sache encore dire non.
const CLE_CANARI = "canari_levier";

// Les six sorties observables d'une campagne. `issue` (perdue / pas perdue) est traitée à
// part : son basculement est le signal le plus fort qu'une constante puisse produire.
const METRIQUES = ["issue", "fin_sem", "propre", "sale", "visibilite", "kg"];

// LES SEPT SPECS DES PRODUITS DE RÉFÉRENCE, mesurées en plus des campagnes : c'est là que
// vivent les constantes de conception qu'aucun bot n'atteint (stabilisation, Noctal, choix
// de conception) — et `instabilite_neuro`, qui ne fait rien au jalon 1.
const SPECS = ["cout_unitaire", "debit_kg_sem", "dependance", "regularite_lot",
  "instabilite_neuro", "puissance", "signature"];

// LE JALON EN COURS. Une dormante annonce le jalon qui la réveillera ; passé cette date,
// l'exemption est PÉRIMÉE et le test échoue tant qu'on ne l'a pas retirée.
export const JALON_COURANT = 1;

// LES SATURÉES : branchées, mais une borne délibérée absorbe leurs deux sens. Aucun jalon ne
// les débloquera. Vérifiées dans les deux sens comme les dormantes.
//
// `los_hermanos.marge` y a fait trois allers-retours avant d'en sortir pour de bon avec
// `grossiste`. Le savoir-faire du Liant ambré y est entré comme celui de l'Azurite (sorti avec
// `orfevre`) : quand `orfevre` peut payer la case, il a déjà bien plus d'expérience qu'elle
// n'en demande. Le monter pour le faire mordre serait tourner un nombre pour passer le levier.
// Le retrouver : `node src/tests/trace.ts 7 orfevre 13`, colonne note.
const SATUREES: Dict = {
  "procedes.noeuds.liant_ambre.cout_savoir":
    "saturee par l'argent : quand `orfevre` peut payer le Liant ambre, il a deja l'experience",
};

// LA LISTE DORMANTE — le seul endroit où une constante a le droit de ne rien bouger. Une
// constante y entre quand son SOUS-SYSTÈME n'est pas né (ou qu'aucun JOUEUR ne s'en sert
// encore), jamais parce qu'elle gêne : chaque ligne nomme le jalon qui la retirera, et la
// liste est vérifiée DANS LES DEUX SENS — une dormante qui se met à bouger fait échouer le
// test tant qu'on ne l'a pas retirée.
// `couvre` PINCE le nombre de constantes endormies par un préfixe : une constante ajoutée
// sous ce préfixe sans qu'on l'ait décidé fait échouer le récapitulatif.
const DORMANTES: Dict = {
  // LA FAILLITE EST UNE PORTE FERMÉE. Le débit de blanchiment couvre toujours les charges
  // fixes du jalon 1 : le propre ne passe jamais sous zéro. Ce qui la rouvrira est le MÊME
  // système que ce qui manque à la cible 1 : les saisies et les descentes (§3bis, jalon 2) —
  // il manque au jeu un risque GRUMELEUX.
  "constants.eco.semaines_faillite": { jalon: 2,
    pourquoi: "les saisies (§3bis) : sans risque grumeleux, personne ne passe dans le rouge" },

  // LES CASES QUE PERSONNE NE PREND (§2bis). Le sous-système existe, il manque un JOUEUR.
  // `grossiste` et `orfevre` en ont réveillé la moitié ; il en reste treize, datées du profil
  // qui les réveillera. Leurs EFFETS sont mesurés par les références de calibration.
  "procedes.noeuds.matrice_froide": { jalon: 5, couvre: 3,
    pourquoi: "le bout de la veine defensive : aucun temoin ne stabilise a 3 avant `accelerateur` (§8)" },
  "procedes.noeuds.culture_noctal": { jalon: 5, couvre: 2,
    pourquoi: "le sommet des familles : aucun temoin ne monte au Noctal avant `accelerateur`" },
  "procedes.noeuds.reflux": { jalon: 5, couvre: 3,
    pourquoi: "complexite 3 : aucun temoin ne depasse 2 avant `accelerateur`" },
  "procedes.noeuds.cascade": { jalon: 5, couvre: 3,
    pourquoi: "complexite 4 : aucun temoin ne depasse 2 avant `accelerateur`" },
  "procedes.noeuds.synthese_continue": { jalon: 5, couvre: 3,
    pourquoi: "complexite 5 : aucun temoin ne depasse 2 avant `accelerateur`" },
  "procedes.noeuds.cuves_en_serie": { jalon: 3, couvre: 3,
    pourquoi: "le bout de la veine volume : `grossiste` est arrete avant, `opportuniste` le reveillera" },
  "procedes.noeuds.agent_enrobant": { jalon: 3, couvre: 2,
    pourquoi: "les agents : `grossiste` est arrete avant, `opportuniste` les reveillera" },
  "procedes.noeuds.agent_exaltant": { jalon: 3, couvre: 2,
    pourquoi: "les agents : `grossiste` est arrete avant, `opportuniste` les reveillera" },
  "procedes.noeuds.petits_lots": { jalon: 3, couvre: 2,
    pourquoi: "`orfevre` n'en a jamais les moyens, `opportuniste` le reveillera" },
  "procedes.noeuds.tampon_de_maison": { jalon: 3, couvre: 3,
    pourquoi: "`orfevre` n'en a jamais les moyens, `opportuniste` le reveillera" },
  "procedes.noeuds.marque_deposee": { jalon: 3, couvre: 3,
    pourquoi: "aucun temoin ne va jusqu'a la marque, `opportuniste` le reveillera" },
  "procedes.noeuds.galets": { jalon: 3, couvre: 2,
    pourquoi: "aucun profil ne vise les galets aujourd'hui" },
  "procedes.noeuds.gelification": { jalon: 3, couvre: 2,
    pourquoi: "aucun profil ne vise le gel aujourd'hui" },
  // LE PLAFOND DE FIDÉLITÉ, endormi par effet de bord : il faut un profil A LA FOIS durable
  // ET addictif pour l'atteindre.
  "constants.marche.plafond_fidelite": { jalon: 3,
    pourquoi: "il faut un profil durable ET addictif pour saturer la fidelite : `opportuniste`" },
  // L'EMPLACEMENT DU TRAÎTRE, endormi par PRÉFIXE : ses neuf nombres n'existent pas encore
  // dans la partie (§6, jalon 4).
  "rivaux.maisons.le_traitre": { jalon: 4, couvre: 9,
    pourquoi: "§6 : la maison du traitre n'existe qu'apres la premiere trahison" },
  // Un seul produit par maison : `pow(empilement, 0)` vaut 1 quoi qu'on mette dedans.
  "constants.marche.empilement_maison": { jalon: 2,
    pourquoi: "le catalogue de 3 recettes (§2) : il demande les lignes de production du jalon 2" },
  // `f_delai = 1 / (1 + k x ruptures)`, et personne n'a de rupture : il attend le graphe.
  "constants.marche.k_delai": { jalon: 2,
    pourquoi: "le graphe (§3) : pas de rupture d'approvisionnement sans routes" },
};

const CHEMIN_CSV = join(RACINE, "levier.csv");

// 6 GRAINES. Sous Godot, le levier était passé à 4 graines pour tenir le budget de perf.gd
// à quatre bots ; le portage TypeScript l'a rendu bien plus rapide, et la précision perdue
// est rendue. La puissance de ce test est le nombre de campagnes par mesure, bots × graines.
export const N_GRAINES_DEFAUT = 6;

let nGraines = N_GRAINES_DEFAUT;
const echecs: string[] = [];
// Les bots dont toutes les graines racontent la même campagne. Mesuré, jamais supposé.
const sansVariance = new Set<string>();

function principal(): number {
  const arg = process.argv[2];
  if (arg !== undefined && /^\d+$/.test(arg)) nGraines = Math.max(Number(arg), 1);
  const data = chargerData();
  const inv = inventaire(data);
  const chemins: string[][] = inv.chemins;
  for (const probleme of inv.problemes as string[]) echecs.push(probleme);
  verifierDormantes(chemins);
  const strats = Bots.strategies();
  console.log(fmt("levier : %d constantes x +/-%.0f%% x %d graines x %d bots = %d metriques par mesure",
    chemins.length, PERTURBATION * 100, nGraines, Object.keys(strats).length, tailleVecteur()));
  // L'AVEU, imprimé : ce fichier mesure le couple (jeu, bots). Un levier que personne ne
  // pousse ressort débranché sans que le jeu l'ignore pour autant.
  console.log(fmt("        ces verdicts valent pour CES bots (%s) : un levier que personne ne pousse", clesTriees(strats).join(", ")));
  console.log("        ressort debranche sans que le jeu l'ignore pour autant.");
  detecterVariance(data);
  const base = metriques(data);
  const baseSpecs = specsRef(data);
  const ref = {
    campagnes: base, echelles: echelles(base, METRIQUES.length),
    specs: baseSpecs, echelles_specs: echelles(baseSpecs, SPECS.length),
  };
  console.log(fmt("        + %d specs de reference (%d produits x %d specs) : c'est la que vivent les",
    baseSpecs.length, data.calibration.references.length, SPECS.length));
  console.log("        constantes de conception, qu'aucune campagne ne peut bouger.");
  // LE CANARI D'ABORD : si le comparateur bruite, le reste du rapport est sans valeur.
  if (!canari(data, ref)) {
    console.error("ECHEC : " + echecs[0]);
    return 1;
  }
  const classement: Dict[] = [];
  let issuesTotal = 0;
  for (const chemin of chemins) {
    const r = eprouver(data, chemin, ref);
    issuesTotal += r.issues;
    classement.push(r);
  }
  afficherClassement(classement);
  portee(classement);
  recapExemptions(chemins);
  exporter(classement);
  // LA PHRASE QUE CE FICHIER DEVAIT SAVOIR DIRE : combien de fins de partie basculent.
  console.log("");
  console.log(fmt("issues de campagne basculees, toutes constantes confondues : %d", issuesTotal));
  if (issuesTotal === 0) {
    console.log(fmt("ALERTE aucune fin de partie ne change : sur %d constantes a +/-%.0f%%, les %d campagnes gardent toutes leur issue.",
      chemins.length, PERTURBATION * 100, nGraines * Object.keys(strats).length));
  }
  if (echecs.length === 0) {
    console.log(fmt("LEVIER : %d constantes branchees, %d dormante(s) declaree(s) sur %d, canari mort",
      chemins.length - Object.keys(DORMANTES).length, Object.keys(DORMANTES).length, chemins.length));
    return 0;
  }
  for (const e of echecs) console.error("ECHEC : " + e);
  return 1;
}

// --- le canari ----------------------------------------------------------------

function canari(data: Dict, ref: Dict): boolean {
  const avec = copie(data);
  avec.constants[CLE_CANARI] = 1.0;
  const r = mesurer(avec, ["constants", CLE_CANARI], 1.0, ref);
  if (r.bouges === 0) {
    console.log(fmt("CANA  %-30s %-11s | %s", CLE_CANARI, "1.0", r.details));
    console.log("       ^ une constante que rien ne lit ne bouge rien : le comparateur sait dire non");
    return true;
  }
  console.log(fmt("RATE  %-30s %-11s | %s", CLE_CANARI, "1.0", r.details));
  echecs.push(fmt("le CANARI bouge (%d metriques) : le comparateur est bruite, et tout ce que ce fichier pourrait dire d'autre est sans valeur", r.bouges));
  return false;
}

// --- une constante ------------------------------------------------------------

function eprouver(data: Dict, chemin: string[], ref: Dict): Dict {
  const nom = chemin.join(".");
  const valeur = Number(lire(data, chemin));
  const r = mesurer(data, chemin, valeur, ref);
  const cleDormante = couvre(DORMANTES, nom);
  const cleSaturee = couvre(SATUREES, nom);
  const dormante = cleDormante !== "" || cleSaturee !== "";
  const ok = (r.bouges > 0) !== dormante;
  const etat = !ok ? "RATE " : (dormante ? (cleSaturee !== "" ? "SATU " : "DORM ") : "  OK ");
  console.log(fmt("%s %-30s %-11s | %s", etat, nom, num(valeur, 4), r.details));
  if (cleSaturee !== "") console.log(`       ^ ${SATUREES[cleSaturee]}`);
  else if (cleDormante !== "") {
    const d = DORMANTES[cleDormante];
    console.log(fmt("       ^ dormante jusqu'au jalon %d : %s", d.jalon, d.pourquoi));
  }
  if (!ok) {
    if (cleSaturee !== "") {
      echecs.push(`${nom} : declaree SATUREE mais elle bouge desormais — la borne a change, retire-la de SATUREES`);
    } else if (dormante) {
      // Le sens qui garde la liste honnête : la constante mord, l'exemption n'a plus lieu d'être.
      echecs.push(fmt("%s : declaree dormante jusqu'au jalon %d mais elle BOUGE desormais — retire-la de DORMANTES", nom, DORMANTES[cleDormante].jalon));
    } else {
      echecs.push(fmt("%s = %s : levier DEBRANCHE, aucune metrique ne bouge a +/-%.0f%%", nom, num(valeur, 4), PERTURBATION * 100));
    }
  }
  const statut = dormante ? "dormante" : (r.bouges === 0 ? "DEBRANCHEE" : "branchee");
  return { nom, valeur, statut, amplitude: r.amplitude, bouges: r.bouges, issues: r.issues,
    par_bot: r.par_bot, bouges_bot: r.bouges_bot, dormante };
}

// Les deux sens, agrégés sur le plus fort : une constante branchée dans un seul sens (un
// plafond qu'on ne peut que baisser) est branchée.
function mesurer(data: Dict, chemin: string[], valeur: number, ref: Dict): Dict {
  const essais: [string, number][] = [];
  if (absf(valeur) < 1e-12) {
    essais.push([fmt("+%.0f abs.", DELTA_NUL), DELTA_NUL]);
  } else if (isEqualApprox(valeur, Math.floor(valeur)) && absf(valeur) * PERTURBATION < 1.0) {
    // ANGLE MORT DES ENTIERS : `complexite = 1` perturbée de ±30 % donne 1.3 et 0.7, que le
    // consommateur ramène à 1 par int()+clamp. Sous un écart de 1, on perturbe d'un cran
    // entier — la plus petite variation qui existe réellement pour ce levier.
    essais.push(["+1 (entier)", valeur + 1.0]);
    essais.push(["-1 (entier)", valeur - 1.0]);
  } else {
    essais.push([fmt("+%.0f%%", PERTURBATION * 100), valeur * (1.0 + PERTURBATION)]);
    essais.push([fmt("-%.0f%%", PERTURBATION * 100), valeur * (1.0 - PERTURBATION)]);
  }
  const nBots = Object.keys(Bots.strategies()).length;
  let bouges = 0;
  let issues = 0;
  let amplitude = 0.0;
  const parBot = new Array(nBots).fill(0.0);
  const bougesBot = new Array(nBots).fill(0);
  const details: string[] = [];
  for (const [etiquette, v] of essais) {
    const perturbe = copie(data);
    ecrire(perturbe, chemin, v);
    const c = comparer(ref.campagnes, metriques(perturbe), ref.echelles, METRIQUES.length, true);
    const cs = comparer(ref.specs, specsRef(perturbe), ref.echelles_specs, SPECS.length);
    bouges = maxi(bouges, c.bouges + cs.bouges);
    issues = maxi(issues, c.issues);
    amplitude = maxf(amplitude, maxf(c.amplitude, cs.amplitude));
    for (let j = 0; j < nBots; j++) {
      parBot[j] = maxf(parBot[j], c.par_bot[j]);
      bougesBot[j] = maxi(bougesBot[j], c.bouges_bot[j]);
    }
    details.push(fmt("%s %3d camp. + %d specs", etiquette, c.bouges, cs.bouges));
  }
  details.push(`ampl. ${pourcent(amplitude)}`);
  if (issues > 0) details.push(fmt("%d issue(s)", issues));
  return { bouges, issues, amplitude, par_bot: parBot, bouges_bot: bougesBot, details: details.join(" | ") };
}

// --- métriques : UNE LIGNE PAR CAMPAGNE, jamais une somme ----------------------

// Sommer les campagnes serait le défaut classique : une constante qui enrichit un bot et
// appauvrit l'autre d'autant ne bougerait pas le total. On compare campagne par campagne,
// dans un ordre fixe (bots triés, puis graines croissantes).
function metriques(data: Dict): number[] {
  const m: number[] = [];
  const strats = Bots.strategies();
  for (const nom of clesTriees(strats)) {
    // BOT SANS VARIANCE : ses N graines donnent la MÊME campagne — on en simule une et on la
    // réplique. Échange de précision contre du temps, dit franchement.
    const seules = sansVariance.has(nom);
    for (let graine = 1; graine <= nGraines; graine++) {
      const r = Balance.campagne(seules ? 1 : graine, data, strats[nom]);
      m.push(Balance.perdue(r) ? 1.0 : 0.0, r.fin_tick, r.cash_propre, r.cash_sale, r.visibilite, r.kg);
    }
  }
  return m;
}

// Les sept specs de chaque produit de référence, dans l'ordre du fichier puis de SPECS.
function specsRef(data: Dict): number[] {
  const v: number[] = [];
  for (const r of data.calibration.references as Dict[]) {
    const s = Produit.specs(r.recette, data);
    for (const cle of SPECS) v.push(Number(s[cle]));
  }
  return v;
}

// On le MESURE au lieu de le supposer : une graine contre une autre, sur la base.
function detecterVariance(data: Dict): void {
  const strats = Bots.strategies();
  const figes: string[] = [];
  for (const nom of clesTriees(strats)) {
    const a = Balance.campagne(1, data, strats[nom]);
    const b = Balance.campagne(2, data, strats[nom]);
    if (a.fin === b.fin && isEqualApprox(a.cash_propre, b.cash_propre) && isEqualApprox(a.kg, b.kg)) {
      sansVariance.add(nom);
      figes.push(nom);
    }
  }
  if (figes.length > 0) {
    console.log(fmt("        %s : graines identiques sur la base, une seule sera simulee (precision echangee contre du temps)", figes.join(" ")));
  }
}

function tailleVecteur(): number {
  return nGraines * Object.keys(Bots.strategies()).length * METRIQUES.length;
}

// L'échelle d'une métrique, c'est sa moyenne absolue sur la base — pas sa valeur campagne par
// campagne. Le plancher à 1.0 protège la division quand une colonne est nulle partout.
function echelles(base: number[], n: number): number[] {
  const e: number[] = [];
  for (let j = 0; j < n; j++) {
    let somme = 0.0;
    let compte = 0;
    for (let i = j; i < base.length; i += n) {
      somme += absf(base[i]);
      compte++;
    }
    e.push(maxf(somme / maxf(compte, 1.0), 1.0));
  }
  return e;
}

// `ventiler` dit si le vecteur comparé est RANGÉ PAR BOT : vrai pour les campagnes, faux pour
// les specs de référence, qui n'appartiennent à personne.
function comparer(base: number[], autre: number[], ech: number[], n: number, ventiler = false): Dict {
  const parCampagne = nGraines * n;
  const nBots = Object.keys(Bots.strategies()).length;
  let bouges = 0;
  let issues = 0;
  let amplitude = 0.0;
  const parBot = new Array(nBots).fill(0.0);
  const bougesBot = new Array(nBots).fill(0);
  for (let i = 0; i < base.length; i++) {
    const x = base[i];
    const y = autre[i];
    const d = absf(x - y);
    if (d <= maxf(1e-6, 1e-9 * maxf(absf(x), absf(y)))) continue;
    bouges++;
    const bot = ventiler ? floori(i / parCampagne) : -1;
    // Le COMPTAGE inclut la colonne d'issue, que l'amplitude saute.
    if (ventiler && bot >= 0 && bot < nBots) bougesBot[bot]++;
    if (i % n === 0) {
      issues++;
      continue;
    }
    const a = d / ech[i % n];
    amplitude = maxf(amplitude, a);
    if (ventiler && bot >= 0 && bot < nBots) parBot[bot] = maxf(parBot[bot], a);
  }
  return { bouges, issues, amplitude, par_bot: parBot, bouges_bot: bougesBot };
}

// --- le classement : la carte des boutons qui comptent -------------------------

function afficherClassement(classement: Dict[]): void {
  classement.sort((a, b) => b.amplitude - a.amplitude);
  console.log("");
  console.log(fmt("--- sensibilite : de combien chaque constante deplace le jeu a +/-%.0f%% ---", PERTURBATION * 100));
  const nomsBots = clesTriees(Bots.strategies());
  classement.forEach((c, i) => {
    console.log(fmt("%3d. %-30s ampl. %-7s [%s] %3d/%d metriques%s", i + 1, c.nom, pourcent(c.amplitude),
      nomsBots.map((n, j) => `${n} ${pourcent(c.par_bot[j])}`).join(" | "), c.bouges, tailleVecteur(),
      c.dormante ? "  [dormante]" : ""));
  });
}

// --- la portée : qui SENT chaque levier ----------------------------------------

// TROIS catégories : levier de campagne, hors de portée POUR X, specs seulement (constante de
// conception qu'aucune partie ne peut déplacer — pas un angle mort des bots). MESURE ET PAS
// VERDICT (§16) ; il le deviendra au jalon 2.
function portee(classement: Dict[]): void {
  const nomsBots = clesTriees(Bots.strategies());
  const atteints = new Array(nomsBots.length).fill(0);
  let campagne = 0;
  let specsSeules = 0;
  for (const c of classement) {
    if (c.dormante) continue;
    let total = 0;
    nomsBots.forEach((_n, j) => {
      const b = c.bouges_bot[j];
      total += b;
      if (b > 0) atteints[j]++;
    });
    if (total > 0) campagne++;
    else if (c.bouges > 0) specsSeules++;
  }
  console.log("");
  console.log(fmt("--- portee : combien des %d leviers de campagne chaque profil peut SENTIR ---", campagne));
  let pire = campagne;
  nomsBots.forEach((n, j) => {
    const a = atteints[j];
    pire = mini(pire, a);
    console.log(fmt("  %-12s %3d sentis | %3d hors de portee (%.0f%%)", n, a, campagne - a, 100 * (campagne - a) / maxf(campagne, 1)));
  });
  console.log(fmt("  %-12s %3d constantes ne bougent que les specs de reference : conception (§2),", "(personne)", specsSeules));
  console.log("               aucune campagne ne les atteint, et ce n'est pas un angle mort.");
  if (pire * 2 < campagne) {
    console.log(fmt("ALERTE un profil ne sent que %d des %d leviers de campagne : pour lui, la majorite du jeu n'a pas de boutons. La porte est verte parce qu'elle met les bots en commun.", pire, campagne));
  }
}

// Une ligne par constante, sur le disque : comparer.ts lit ce fichier d'un commit à l'autre.
function exporter(classement: Dict[]): void {
  const nomsBots = clesTriees(Bots.strategies());
  const lignes = [["constante", "valeur", "statut", "bouges", "metriques", "amplitude", "issues",
    ...nomsBots.map((n) => "ampl_" + n)].join(",")];
  for (const c of classement) {
    lignes.push([c.nom, fmt("%.6f", c.valeur), c.statut, String(c.bouges), String(tailleVecteur()),
      fmt("%.6f", c.amplitude), String(c.issues), ...nomsBots.map((_n, j) => fmt("%.6f", c.par_bot[j]))].join(","));
  }
  writeFileSync(CHEMIN_CSV, lignes.join("\n") + "\n");
  console.log(fmt("csv : %d lignes dans levier.csv", classement.length));
}

function pourcent(v: number): string {
  if (v > 9.99) return ">999%";
  // « 0 % » alors que des métriques bougent dirait « débranché » d'une constante branchée
  // mais négligeable.
  if (v > 0.0 && v < 0.005) return "<1%";
  return fmt("%.0f%%", v * 100);
}

// --- parcours des données -----------------------------------------------------

// UN SEUL parcours de data/, et il est exporté : perf.ts a besoin du coût de ce fichier, et
// le lui faire redeviner de son côté rendait son budget faux. Il balaie TOUS les fichiers de
// données sauf `calibration`, dont les nombres sont des ASSERTIONS, pas des leviers.
const FICHIERS_EXCLUS = ["calibration"];
// `constants.json` ne contient QUE de l'équilibrage : un non-nombre y est une faute.
const FICHIERS_STRICTS = ["constants"];

export function inventaire(data: Dict): Dict {
  const chemins: string[][] = [];
  const problemes: string[] = [];
  for (const fichier of clesTriees(data)) {
    if (FICHIERS_EXCLUS.includes(fichier)) continue;
    parcourir(data[fichier], [fichier], chemins, problemes, FICHIERS_STRICTS.includes(fichier));
  }
  return { chemins, problemes };
}

function parcourir(noeud: unknown, prefixe: string[], chemins: string[][], problemes: string[], strict: boolean): void {
  if (Array.isArray(noeud)) {
    // Les critères de segments.json vivent dans un tableau.
    noeud.forEach((v, k) => parcourir(v, [...prefixe, String(k)], chemins, problemes, strict));
  } else if (noeud && typeof noeud === "object") {
    for (const cle of clesTriees(noeud as Dict)) {
      if (cle.startsWith("_")) continue;
      parcourir((noeud as Dict)[cle], [...prefixe, cle], chemins, problemes, strict);
    }
  } else if (typeof noeud === "number") {
    chemins.push(prefixe);
  } else if (strict) {
    problemes.push(`${prefixe.join(".")} : ni un nombre ni une section (${typeof noeud})`);
  }
}

// Le coût d'une exécution complète, en campagnes-passes : la base, le canari (deux sens),
// puis chaque constante — un seul sens si elle est nulle, deux sinon.
export function passes(data: Dict): number {
  let n = 1 + 2;
  for (const chemin of inventaire(data).chemins as string[][]) n += absf(Number(lire(data, chemin))) < 1e-12 ? 1 : 2;
  return n;
}

// Le premier élément du chemin est le FICHIER ; les suivants des clés ou des index.
export function lire(data: Dict, chemin: string[]): unknown {
  let noeud: any = data;
  for (const cle of chemin) noeud = Array.isArray(noeud) ? noeud[Number(cle)] : noeud[cle];
  return noeud;
}

export function ecrire(data: Dict, chemin: string[], valeur: number): void {
  let noeud: any = data;
  for (let i = 0; i < chemin.length - 1; i++) noeud = Array.isArray(noeud) ? noeud[Number(chemin[i])] : noeud[chemin[i]];
  const derniere = chemin[chemin.length - 1];
  if (Array.isArray(noeud)) noeud[Number(derniere)] = valeur;
  else noeud[derniere] = valeur;
}

// Une entrée couvre une constante OU un préfixe.
function couvre(liste: Dict, nom: string): string {
  if (Object.hasOwn(liste, nom)) return nom;
  for (const cle of Object.keys(liste)) if (nom.startsWith(cle + ".")) return cle;
  return "";
}

// Un préfixe doit EXISTER, et on doit voir ce qu'il couvre : le nombre annoncé fait foi.
function recapExemptions(chemins: string[][]): void {
  const couverture: Dict = {};
  for (const liste of [DORMANTES, SATUREES]) for (const cle of Object.keys(liste)) couverture[cle] = 0;
  for (const chemin of chemins) {
    const nom = chemin.join(".");
    for (const cle of Object.keys(couverture)) if (nom === cle || nom.startsWith(cle + ".")) couverture[cle]++;
  }
  console.log("");
  console.log("--- exemptions et ce qu'elles couvrent ---");
  for (const cle of clesTriees(couverture)) {
    const n = couverture[cle];
    const genre = Object.hasOwn(SATUREES, cle) ? "saturee" : fmt("dormante jusqu'au jalon %d", DORMANTES[cle].jalon);
    const attendu = Object.hasOwn(DORMANTES, cle) ? Number(DORMANTES[cle].couvre ?? 1) : 1;
    let verdict = "";
    if (n !== attendu) {
      verdict = fmt("  <-- ANNONCE %d", attendu);
      echecs.push(fmt("%s endort %d constante(s) alors que son entree en annonce %d : ajoute, retire ou corrige `couvre`", cle, n, attendu));
    }
    console.log(fmt("  %-42s %2d constante(s) | %s%s%s", cle, n, genre, n > 1 ? "  [PREFIXE]" : "", verdict));
  }
}

// Une exemption dont la constante a disparu, ou dont le jalon est passé, fait échouer : une
// dérogation qui survit à son objet est la forme la plus discrète du poteau qu'on déplace.
function verifierDormantes(chemins: string[][]): void {
  const connus = new Set(chemins.map((c) => c.join(".")));
  for (const nom of [...Object.keys(DORMANTES), ...Object.keys(SATUREES)]) {
    const existe = connus.has(nom) || [...connus].some((c) => c.startsWith(nom + "."));
    if (!existe) {
      echecs.push(`DORMANTES contient ${nom}, qui n'existe plus dans les donnees : entree orpheline a retirer`);
    } else if (Object.hasOwn(DORMANTES, nom) && DORMANTES[nom].jalon <= JALON_COURANT) {
      echecs.push(fmt("DORMANTES : %s etait endormie jusqu'au jalon %d, on est au jalon %d — exemption PERIMEE, a retirer ou a rejustifier",
        nom, DORMANTES[nom].jalon, JALON_COURANT));
    }
  }
}

// Le nombre de bots et de graines, pour perf.ts.
export const nombreBots = (): number => Object.keys(Bots.strategies()).length;

if (import.meta.main) process.exit(principal());
