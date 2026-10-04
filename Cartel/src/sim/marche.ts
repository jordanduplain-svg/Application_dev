// Raison d'être : §4 — qui achète, à qui, et combien. Port de sim/marche.gd, lui-même porté
// AU SCALPEL de `bureau-etudes/sim/market.gd` (§13) : les formules sont inchangées.
//
// DEUX correctifs MESURÉS sont venus avec le port, et ce sont eux qui le justifiaient :
//
//   1. LE PRIX MÉDIAN SE PREND UNE VOIX PAR MAISON. Sur la liste brute des produits, une
//      maison qui en aligne trois sur cinq FIXE la médiane et étrangle le `f_prix` de ses
//      concurrents.
//   2. L'EMPILEMENT A UN RENDEMENT DÉCROISSANT. La part se prend au carré PAR PRODUIT puis se
//      somme par maison : deux produits jumeaux valent √2 fois un seul. `empilement_maison`
//      = 1.0 reproduit le comportement historique, et c'est le témoin.
//
// CADENCE : la résolution est TRIMESTRIELLE alors que tout le reste bat à la semaine. C'est
// ce que §4 écrit (`demande_trim`) : l'inertie de 20 % n'a de sens qu'à cette cadence. La
// production reste hebdomadaire — on fabrique toutes les semaines, on vend tous les
// trimestres, et le stock fait le tampon.
//
// ORDRE DES OPÉRATIONS : celui de sim/marche.gd, sommes comprises — les parts se somment
// dans l'ordre TRIÉ des maisons, parce qu'un ordre différent change le dernier bit.
import { type Dict, clampf, minf, maxf, int, mini, floori, get, str, clesTriees, copie } from "./gd.ts";
import { reel } from "./rng.ts";
import { specs as specsProduit, normaliser } from "./produit.ts";

export const JOUEUR = "joueur";

export function initRivaux(state: Dict, data: Dict): void {
  const rivaux: Dict = {};
  for (const id of clesTriees(data.rivaux.maisons)) {
    const d = data.rivaux.maisons[id];
    // La maison du traître n'existe qu'après la trahison (§6) : elle a son emplacement dans
    // les données, pas encore dans la partie.
    if (Boolean(get(d, "fusion_only", false))) continue;
    rivaux[id] = { recette: copie(d.recette), marge: Number(d.marge), trim_depuis_renouv: 0.0 };
  }
  state.rivaux = rivaux;
}

// --- le trimestre -------------------------------------------------------------

// `specs` arrive de src/sim/sim.ts, qui les calcule UNE fois par tick : les recalculer ici
// donnerait deux vérités pour une recette le jour où une formule bouge.
export function trimestre(state: Dict, data: Dict, specs: Dict): void {
  renouveler(state, data);
  // LES RIVAUX sont les mêmes pour les trois segments : leurs specs se calculent UNE fois
  // par trimestre. Le JOUEUR pose un prix par segment (§19bis) : sa ligne de lice change
  // d'un segment à l'autre, et le prix médian avec elle.
  const rivaux = liceRivaux(state, data);
  for (const nomSeg of ordreService(data)) allouer(state, data, nomSeg, rivaux, specs);
}

// §4 : les trois segments puisent dans le MÊME stock, donc l'ordre de service décide qui
// mange la pénurie. Il est DÉCLARÉ dans data/segments.json, sous forme de LISTE — un rang
// n'est pas une grandeur, et trois nombres de priorité étaient trois constantes débranchées.
export function ordreService(data: Dict): string[] {
  const segs: Dict = data.segments.segments;
  const noms: string[] = [];
  for (const nom of get(data.segments, "ordre_service", []) as unknown[]) {
    if (Object.hasOwn(segs, str(nom)) && !noms.includes(str(nom))) noms.push(str(nom));
  }
  // Filet, pas comportement nominal : un segment absent de la liste est servi en dernier
  // plutôt que de disparaître du marché. Le test de couverture, lui, échoue.
  for (const nom of clesTriees(segs)) if (!noms.includes(nom)) noms.push(nom);
  return noms;
}

// Une voix par maison (voir l'en-tête).
function prixMedian(lice: Dict[]): number {
  const parMaison: Record<string, number[]> = {};
  for (const e of lice) {
    const m = str(e.maison);
    (parMaison[m] ??= []).push(Number(e.prix));
  }
  return mediane(clesTriees(parMaison).map((m) => mediane(parMaison[m])));
}

// La R&D simulée des rivaux (§4). Un rival qui ne renouvelle pas devient décoratif en dix
// trimestres, et le joueur gagne par forfait sans avoir rien fait.
function renouveler(state: Dict, data: Dict): void {
  for (const id of clesTriees(state.rivaux)) {
    const riv = state.rivaux[id];
    const d = data.rivaux.maisons[id];
    riv.trim_depuis_renouv = Number(riv.trim_depuis_renouv) + 1.0;
    if (Number(riv.trim_depuis_renouv) < Number(d.renouvellement_trim)) continue;
    riv.trim_depuis_renouv = 0.0;
    const recette = riv.recette;
    recette.purete = minf(Number(recette.purete) + Number(d.purete_pas), Number(d.purete_plafond));
    // La montée en gamme suit la pureté : au-delà d'un palier, la famille précédente ne
    // porte plus la recette. Les paliers sont dans les données, pas ici.
    const montee: unknown[] = d.familles_montee;
    const rang = mini(int(Math.floor(Number(recette.purete) / 0.34)), montee.length - 1);
    recette.famille = str(montee[rang]);
  }
}

// --- un segment ---------------------------------------------------------------

function allouer(state: Dict, data: Dict, nomSeg: string, rivaux: Dict[], specs: Dict): void {
  const cm = data.constants.marche;
  const seg = data.segments.segments[nomSeg];
  const marche: Dict = state.marche;
  if (!Object.hasOwn(marche, nomSeg)) marche[nomSeg] = { parts: {}, demande_fidele: 0.0, ventes_joueur: 0.0 };
  const etatSeg = marche[nomSeg];
  const parts: Dict = etatSeg.parts;
  // Aléa de conjoncture (seedé) : tiré AVANT toute sortie anticipée, pour garder le flux RNG
  // identique quel que soit l'état des catalogues.
  const amp = Number(cm.alea_demande);
  const alea = 1.0 + amp * (2.0 * reel(state) - 1.0);
  const lice = enLice(state, data, specs, nomSeg, rivaux);
  const prixMed = prixMedian(lice);
  if (lice.length === 0) {
    etatSeg.parts = {};
    return;
  }

  // 2. ATTRACTIVITÉS → parts cibles, au carré (k = 2 accentue les écarts), avec le
  // rendement décroissant de l'empilement.
  const empil = Number(cm.empilement_maison);
  const rang: Dict = {};
  const poids: Dict = {};
  let sommeA2 = 0.0;
  for (const e of lice) {
    const a = attractivite(data, seg, e, prixMed);
    const mm = str(e.maison);
    const k = int(get(rang, mm, 0));
    rang[mm] = k + 1;
    poids[str(e.uid)] = a * a * Math.pow(empil, k);
    sommeA2 += Number(poids[str(e.uid)]);
  }

  // 3. Produits disparus : on retire leurs parts.
  const uids = lice.map((e) => str(e.uid));
  for (const uid of clesTriees(parts)) if (!uids.includes(uid)) delete parts[uid];

  // 4. INERTIE — les clients sont fidèles, 20 % de rattrapage par trimestre.
  const inertie = Number(cm.inertie);
  for (const e of lice) {
    const uidP = str(e.uid);
    const cible = sommeA2 > 0.0 ? Number(poids[uidP]) / sommeA2 : 1.0 / lice.length;
    parts[uidP] = Number(get(parts, uidP, 0.0)) + (cible - Number(get(parts, uidP, 0.0))) * inertie;
  }
  // RENORMALISATION. L'inertie rapproche chaque part de sa cible SÉPARÉMENT : partant de
  // zéro, la somme vaut 0.20 au premier trimestre et ne vaut 1 qu'à convergence. Sans cette
  // boucle, 80 % du marché n'appartenait à personne pendant un an de jeu.
  let sommeP = 0.0;
  for (const uid of clesTriees(parts)) sommeP += Number(parts[uid]);
  if (sommeP > 0.0) for (const uid of clesTriees(parts)) parts[uid] = Number(parts[uid]) / sommeP;

  // 5. VENTES. La demande du trimestre porte la DÉPENDANCE accumulée (§4) : un produit
  // addictif fait grandir son propre marché — jusqu'à ce qu'il le tue (acte III).
  const demande = (Number(seg.demande_base_trim) + Number(etatSeg.demande_fidele)) * alea;
  const partJoueur = Number(get(parts, JOUEUR, 0.0));
  const voulu = demande * partJoueur;
  // Plafonné par le stock : on ne vend que ce qu'on a livré sur place.
  const vendu = minf(voulu, Number(state.stock_kg));
  state.stock_kg = Number(state.stock_kg) - vendu;
  etatSeg.ventes_joueur = vendu;
  if (vendu > 0.0) {
    const recetteVente = vendu * Number(get(state.prix, nomSeg, 0.0));
    // La vente rentre en SALE, toujours : personne ne vire de l'argent pour ça (§5).
    state.cash_sale = Number(state.cash_sale) + recetteVente;
    state.stats.kg_vendus = Number(state.stats.kg_vendus) + vendu;
    state.stats.sale_encaisse = Number(state.stats.sale_encaisse) + recetteVente;
    // La boucle de fidélité, plafonnée. Sans plafond c'est une rétroaction positive nue, et
    // elle diverge.
    const bonus = Number(specs.dependance) * vendu * Number(cm.k_fidelite);
    etatSeg.demande_fidele = minf(Number(etatSeg.demande_fidele) + bonus,
      Number(seg.demande_base_trim) * Number(cm.plafond_fidelite));
  }
}

// --- l'attractivité (§4) ------------------------------------------------------

// attractivite = qualite_s × f_prix × f_confiance × f_delai. Publique : l'écran marché
// (§12bis) en aura besoin pour expliquer au joueur POURQUOI il perd.
export function attractivite(data: Dict, seg: Dict, e: Dict, prixMed: number): number {
  const cm = data.constants.marche;
  const q = qualite(data, seg, e.profil);
  // L'exposant est celui du SEGMENT (§4) et le facteur est BORNÉ, comme l'est la qualité.
  const fPrix = minf(Math.pow(prixMed / maxf(Number(e.prix), 1.0), Number(seg.exposant_prix)),
    Number(cm.plafond_prix));
  // `f_confiance` : ce qui rassure le client, c'est que les lots se ressemblent.
  const fConfiance = Number(cm.confiance_base) + Number(cm.confiance_amplitude) * Number(e.profil.regularite_lot);
  // `f_delai` : la rupture d'approvisionnement. Le graphe (§3) la remplira au jalon 2 ; le
  // terme est déjà là pour ne pas être ajouté après coup dans un système calibré (§2).
  const fDelai = 1.0 / (1.0 + Number(cm.k_delai) * Number(get(e, "ruptures", 0.0)));
  return maxf(q * fPrix * fConfiance * fDelai, 0.0);
}

// qualite_s = Σ poids_i × clamp(spec_i / besoin_ref_i, 0, plafond), avec un SEUIL optionnel.
// LE SEUIL (§4) est une RAMPE et pas une falaise :
//     ratio <= seuil     ->  0
//     seuil < ratio < 1  ->  ratio × (ratio − seuil) / (1 − seuil)
//     ratio >= 1         ->  ratio (inchangé, borné par le plafond)
export function qualite(data: Dict, seg: Dict, prof: Dict): number {
  const plafond = Number(data.constants.marche.plafond_critere);
  let q = 0.0;
  for (const crit of seg.criteres as Dict[]) {
    const v = Number(prof[str(crit.nom)]);
    const ref = Number(crit.ref);
    let ratio = str(crit.sens) === "bas" ? ref / maxf(v, 1e-6) : v / maxf(ref, 1e-6);
    const seuil = Number(get(crit, "seuil", 0.0));
    if (seuil > 0.0 && ratio < 1.0) ratio *= clampf((ratio - seuil) / maxf(1.0 - seuil, 1e-6), 0.0, 1.0);
    q += Number(crit.poids) * clampf(ratio, 0.0, plafond);
  }
  return q;
}

// --- qui est en lice ----------------------------------------------------------

// Les specs des rivaux se calculent ici, parce que ce sont d'autres recettes. Ils ne
// dépendent d'aucun segment : une seule fois par trimestre.
function liceRivaux(state: Dict, data: Dict): Dict[] {
  return clesTriees(state.rivaux).map((id) => {
    const riv = state.rivaux[id];
    const specsRiv = specsProduit(riv.recette, data);
    return { maison: id, uid: id, prix: Number(specsRiv.cout_unitaire) * Number(riv.marge),
      profil: profil(riv.recette, data, specsRiv) };
  });
}

// Le joueur entre dans la lice d'un segment s'il a une recette ET un prix > 0 POUR CE
// SEGMENT. Un prix nul l'en sort : se retirer d'un marché est une décision.
// `ponytail:` les rivaux gardent un prix unique — leur marge est leur stratégie entière.
function enLice(state: Dict, data: Dict, specs: Dict, nomSeg: string, rivaux: Dict[]): Dict[] {
  const lice = [...rivaux];
  const prix = Number(get(state.prix, nomSeg, 0.0));
  if (Object.keys(state.recette).length > 0 && prix > 0.0) {
    lice.unshift({ maison: JOUEUR, uid: JOUEUR, prix, profil: profil(state.recette, data, specs) });
  }
  return lice;
}

// Ce que le marché sait lire d'un produit : les sept specs de §2, plus la pureté (un
// paramètre brut, mais le client la juge) et la discrétion dérivée de la signature. Un
// critère de segments.json ne peut nommer que ces clés-là.
export function profil(recette: Dict, data: Dict, specs: Dict = {}): Dict {
  const p: Dict = { ...(Object.keys(specs).length > 0 ? specs : specsProduit(recette, data)) };
  const r = normaliser(recette, data);
  p.purete = Number(r.purete);
  p.discretion = 1.0 / (1.0 + Number(p.signature));
  return p;
}

function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0.0;
  const tri = [...valeurs].sort((a, b) => a - b);
  return Number(tri[floori(valeurs.length / 2.0)]);
}
