// Raison d'être : les bots stratégiques de §16 — fonctions pures et déterministes du state,
// paramétrées par un dict de stratégie ; ne servent qu'à l'équilibrage par simulation.
// Port de tests/bots.gd : mêmes témoins, même ordre de décisions, mêmes nombres.
//
// RÈGLE DE FIXTURE, apprise en lisant une trace : un bot a le droit de jouer mal, jamais de
// jouer BÊTE. Une stratégie qui perd est un témoin qui fait son travail (§16) ; une qui
// achète des précurseurs pour produire ce que personne n'achètera mesure la faute de celui
// qui l'a écrite. Les trois gardes ci-dessous (écoulable, soutenable, payable) sont là pour
// ça, et aucune ne lit quoi que ce soit qu'un joueur ne verrait pas sur son écran.
//
// Les nombres de ce fichier ne sont PAS de l'équilibrage : ce sont des fixtures. Les MARGES
// sont GELÉES — ne jamais les tourner pour faire passer une cible ; si une cible rougit,
// c'est le JEU qu'on ajuste.
import { type Dict, minf, maxf, get, str, clesTriees, isEqualApprox, copie } from "../sim/gd.ts";
import * as Sim from "../sim/sim.ts";
import * as Produit from "../sim/produit.ts";
import * as Recherche from "../sim/recherche.ts";

export function strategies(): Dict {
  return {
    // « Petit volume, produit propre, jamais d'épidémie » (§16). Famille banale, pureté
    // basse : un produit de rue. Il rembourse la dette et lève le pied (§1bis), et ne produit
    // jamais plus qu'il ne peut blanchir. IL NE CHERCHE RIEN, et ce n'est pas un oubli : §2bis
    // promet qu'une partie entière est jouable sans rien chercher, et dit que c'est SA
    // trajectoire (cible 23). Coupe à zéro : depuis que couper rapporte des KILOS, la coupe
    // est un levier de volume, le contraire de ce que ce témoin représente.
    discret: {
      recette: { famille: "verdal", purete: 0.45, rendement: 0.75, complexite: 1, coupe: 0.0, stabilisation: 0 },
      // ×4 : un marchand de rue prend ×4 sur un produit coupé. Nombre rond, tenu pour ce
      // qu'il est — et pas choisi pour passer sous un seuil de la cible 3.
      marge: 4.00,
      part_capacite: 0.60,
      part_apres_dette: 0.30,
      plafonne_sur_blanchiment: true,
      recherche: [],
      // Un trimestre de charges fixes en réserve : le marché paie tous les 13 semaines, les
      // précurseurs toutes les semaines.
      reserve_propre: 60000.0,
    },
    // « Gros volume, produit puissant » (§16) : la recette qui se vend le plus cher ET qui
    // charge le plus vite (§8). Il ne regarde ni son tas ni sa jauge. Sa recette cible est
    // INTERDITE au départ : il commence près du témoin prudent, et grimpe. IL QUITTE LE
    // PRÉCURSEUR SURVEILLÉ D'ABORD — la mesure a imposé cet ordre. Dans la grille, l'ordre
    // devient un CHEMIN : chaque case touche le centre ou une case déjà prise.
    industriel: {
      recette: { famille: "corymbe", purete: 0.95, rendement: 0.60, complexite: 2, coupe: 0.05, stabilisation: 0 },
      // ×2 sur un produit haut de gamme dont le coût est déjà cinq fois celui de la rue.
      marge: 2.00,
      part_capacite: 1.0,
      part_apres_dette: 1.0,
      plafonne_sur_blanchiment: false,
      recherche: ["extraction_azurite", "synthese_corymbe", "filtration", "raffinage_court",
        "procede_deux_etapes", "recristallisation", "colonne_seche"],
      reserve_propre: 60000.0,
    },
    // LES DEUX TÉMOINS DES CHOIX DE CONCEPTION (data/conception.json), nés quand vingt cases
    // de la grille sur vingt-sept ne servaient à aucun témoin. Leur INTENTION est écrite
    // avant toute mesure, et c'est elle qui fixe leurs nombres.
    //
    // « La rue en gros : coupé, fidélisé, vendu pas cher. » Il pousse tout ce qui fait du
    // kilo et prend l'agent exaltant pour que la coupe fidélise. Il ne regarde ni son tas ni
    // sa jauge. L'agent enrobant n'est pas son choix : c'est la case par laquelle on atteint
    // l'exaltant depuis son bras.
    grossiste: {
      recette: { famille: "verdal", purete: 0.45, rendement: 0.95, complexite: 1, coupe: 0.70,
        stabilisation: 0, cadence: "gros_lots", agent: "exaltant" },
      // ×3 : il casse les prix de la rue.
      marge: 3.00,
      part_capacite: 1.0,
      part_apres_dette: 1.0,
      plafonne_sur_blanchiment: false,
      recherche: ["cuves_larges", "charges_neutres", "gros_lots", "charges_lourdes",
        "cuves_en_serie", "agent_enrobant", "agent_exaltant"],
      reserve_propre: 60000.0,
    },
    // « Petit volume haut de gamme, qui se protège de tout. » Le contraire d'`industriel` sur
    // le seul axe qui les sépare : il stabilise, il signe peu (cristaux), il dose
    // régulièrement (petits lots) et il tamponne ses lots. LA PROTECTION D'ABORD, toute la
    // protection — la mesure a montré qu'avec les cristaux en fin de liste il ne les
    // atteignait jamais, contre son intention écrite.
    orfevre: {
      recette: { famille: "corymbe", purete: 0.90, rendement: 0.45, complexite: 2, coupe: 0.0,
        stabilisation: 2, forme: "cristaux", cadence: "petits_lots", marquage: 1 },
      // ×2.5 : un artisan qui vend peu et cher.
      marge: 2.50,
      part_capacite: 0.50,
      part_apres_dette: 0.50,
      plafonne_sur_blanchiment: true,
      recherche: ["liant_gris", "procede_deux_etapes", "cristallisation", "extraction_azurite",
        "synthese_corymbe", "filtration", "raffinage_court", "recristallisation", "liant_ambre",
        "petits_lots", "tampon_de_maison"],
      reserve_propre: 60000.0,
    },
  };
}

export function agir(state: Dict, data: Dict, strat: Dict): void {
  // LA RECETTE CIBLE EST REPOSÉE À CHAQUE SEMAINE : elle est RAMENÉE EN BUTÉE par ce que la
  // recherche a ouvert, et la reposer est la seule façon qu'une case livrée serve à quelque
  // chose.
  Sim.appliquer(state, data, { type: "recette", recette: recetteJouable(state, data, strat) });
  chercher(state, data, strat);
  const recette: Dict = state.recette;
  if (Object.keys(recette).length === 0) return;
  const specs = Produit.specs(recette, data);
  // Le prix est au joueur (§4) ; un bot le pose comme un joueur prudent, et le REPOSE quand
  // le coût change. La comparaison se fait sur le prix déjà posé : `state.prix` EST le mémo.
  if (!prixAJour(state, data, strat, specs)) poserPrix(state, data, strat, specs);
  // Le plafond est le DÉBIT de la recette (§2), que le joueur lirait sur son écran.
  const debit = Number(specs.debit_kg_sem);
  let part = Number(strat.part_capacite);
  // L'échéance passée, le témoin lève le pied : il a payé, il ne cherche pas la suite.
  if (Number(state.dette) <= 0.0) part = Number(strat.part_apres_dette);
  let kg = debit * part;
  kg = minf(kg, ecoulable(state, data, specs));
  if (Boolean(strat.plafonne_sur_blanchiment)) kg = minf(kg, soutenable(state, data, specs));
  kg = minf(kg, payable(state, data, strat, specs));
  Sim.appliquer(state, data, { type: "production", part: kg / maxf(debit, 1e-6) });
}

// LA RECETTE QU'IL PEUT RÉELLEMENT FABRIQUER. Il vise sa famille cible, mais tant qu'elle est
// fermée il prend LA DERNIÈRE QU'IL A OUVERTE SUR SON PROPRE CHEMIN — sa liste de recherche
// est sa préférence, lue à l'envers. Un joueur choisit ; la butée n'est qu'un filet.
function recetteJouable(state: Dict, data: Dict, strat: Dict): Dict {
  const recette: Dict = copie(strat.recette);
  const ouvertes: string[] = Recherche.ouvertures(state, data).familles;
  if (ouvertes.includes(str(recette.famille))) return recette;
  const acquis: Dict = state.recherche.acquis;
  const noeuds: Dict = data.procedes.noeuds;
  const liste: string[] = strat.recherche;
  for (let i = liste.length - 1; i >= 0; i--) {
    const id = str(liste[i]);
    if (!Object.hasOwn(acquis, id)) continue;
    const ouvre: Dict = noeuds[id].ouvre;
    if (Object.hasOwn(ouvre, "famille") && ouvertes.includes(str(ouvre.famille))) {
      recette.famille = str(ouvre.famille);
      return recette;
    }
  }
  return recette;
}

function prixAJour(state: Dict, data: Dict, strat: Dict, specs: Dict): boolean {
  const prix: Dict = state.prix;
  if (Object.keys(prix).length === 0) return false;
  const base = Number(specs.cout_unitaire) * Number(strat.marge);
  const segments: Dict = data.segments.segments;
  for (const nomSeg of clesTriees(segments)) {
    const niveau = Number(get(segments[nomSeg], "niveau_prix", 1.0));
    if (!isEqualApprox(Number(get(prix, nomSeg, -1.0)), base * niveau)) return false;
  }
  return true;
}

// LA RECHERCHE (§2bis) : les prochaines cases de la liste, achetées dès qu'elles sont
// payables. LA DETTE N'EST JAMAIS DÉPENSÉE : on ne lance pas un achat avec l'argent qu'on
// doit — d'où le constat de §1bis, la dette mange le budget de recherche de la première
// année. L'ACHAT EST INSTANTANÉ : autant de cases que payables cette semaine, dans l'ordre, et
// arrêt à la première qu'il ne peut pas s'offrir (sa liste est un chemin).
function chercher(state: Dict, data: Dict, strat: Dict): void {
  const acquis: Dict = state.recherche.acquis;
  for (const id of strat.recherche as string[]) {
    if (Object.hasOwn(acquis, str(id))) continue;
    const cout = Recherche.cout(state, data, str(id));
    const garde = Number(strat.reserve_propre) + Number(state.dette);
    if (Number(state.cash_propre) - cout < garde) return;
    if (!Sim.appliquer(state, data, { type: "recherche", noeud: str(id) })) return;
  }
}

// LE PRIX, un par segment (§19bis) : coût × marge GELÉE du bot × niveau_prix du segment. Le
// facteur vient de data/segments.json — un datum de jeu, pas un réglage de témoin.
function poserPrix(state: Dict, data: Dict, strat: Dict, specs: Dict): void {
  const base = Number(specs.cout_unitaire) * Number(strat.marge);
  const segments: Dict = data.segments.segments;
  for (const nomSeg of clesTriees(segments)) {
    const niveau = Number(get(segments[nomSeg], "niveau_prix", 1.0));
    Sim.appliquer(state, data, { type: "prix", segment: nomSeg, prix: base * niveau });
  }
}

// Ce qui partira au prochain trimestre, ramené à la semaine, moins ce qui dort déjà en stock.
// Sans ce garde, un bot empilait des centaines de kilos d'invendus.
function ecoulable(state: Dict, data: Dict, _specs: Dict): number {
  const sem = Number(data.constants.sim.semaines_par_trimestre);
  return maxf(Number(attendu(state, data).kg) - Number(state.stock_kg), 0.0) / sem;
}

// CE QUE LE PROCHAIN TRIMESTRE VA PRENDRE, et à quel prix : la demande de chaque segment
// pondérée par la part qu'on y détient. Au premier trimestre, part égale entre maisons —
// ce qu'un joueur suppose aussi faute de mieux.
function attendu(state: Dict, data: Dict): Dict {
  const maisons = Object.keys(state.rivaux).length + 1.0;
  const segments: Dict = data.segments.segments;
  let kg = 0.0;
  let recette = 0.0;
  for (const nomSeg of clesTriees(segments)) {
    const etat: Dict = get(state.marche, nomSeg, {});
    const parts: Dict = get(etat, "parts", {});
    const part = Object.keys(parts).length > 0 ? Number(get(parts, "joueur", 1.0 / maisons)) : 1.0 / maisons;
    const v = (Number(segments[nomSeg].demande_base_trim) + Number(get(etat, "demande_fidele", 0.0))) * part;
    kg += v;
    recette += v * Number(get(state.prix, nomSeg, 0.0));
  }
  return { kg, prix: recette / maxf(kg, 1e-6) };
}

// « Je ne produis pas plus que je ne peux blanchir. » LE PRIX EST CELUI QU'IL VA RECEVOIR,
// pondéré par les segments qu'il sert : un garde qui se trompe « du bon côté » sur la
// mauvaise grandeur ne protège de rien.
function soutenable(state: Dict, data: Dict, specs: Dict): number {
  const marge = Number(attendu(state, data).prix) - Number(specs.cout_unitaire);
  return Number(data.constants.blanchiment.capacite_sem) / maxf(marge, 1.0);
}

// Discipline d'achat : on ne lance pas une semaine de précurseurs qu'on ne peut pas payer.
function payable(state: Dict, _data: Dict, strat: Dict, specs: Dict): number {
  const bourse = Number(state.cash_sale) + maxf(Number(state.cash_propre) - Number(strat.reserve_propre), 0.0);
  return bourse / maxf(Number(specs.cout_unitaire), 1.0);
}
