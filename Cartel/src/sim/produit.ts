// Raison d'être : les specs ÉMERGENT de la recette — une seule fonction transforme les choix
// bruts (famille, pureté, rendement, complexité, coupe, stabilisation, puis marquage, forme,
// agent, cadence) en sept specs. **Aucun curseur ne contrôle directement une spec affichée**
// (§2).
//
// Fonction pure sur `(recette, data)`, aucun accès au state, aucun nombre d'équilibrage.
// L'ordre des opérations flottantes est celui de sim/produit.gd, À LA LETTRE : (a * b) * c
// n'est pas a * (b * c) au dernier bit, et le portage a été validé bit à bit contre Godot.
//
// `instabilite_neuro` EST ICI DÈS AUJOURD'HUI. Il ne fait rien pendant tout l'acte I. Il est
// la cause de l'acte III. Un axe ajouté après coup dans un système déjà calibré force à
// compenser au mauvais endroit — la cible 7 de §16 existe pour tenir cette règle.
import { type Dict, clampf, minf, maxf, int, clampi, mini, maxi, get, str, clesTriees } from "./gd.ts";

// Les plages de §2. Le clamp est un domaine de définition, pas un réglage : `pow()` sur une
// puissance négative ne veut rien dire, et un rendement nul diviserait par zéro. Aucune ne
// se tourne pour équilibrer.
export const PURETE_MIN = 0.30;
export const PURETE_MAX = 0.99;
export const RENDEMENT_MIN = 0.20;
export const RENDEMENT_MAX = 0.95;
export const COMPLEXITE_MIN = 1;
export const COMPLEXITE_MAX = 5;
export const COUPE_MAX = 0.70;
export const STABILISATION_MAX = 3;
// Le marquage (data/conception.json) : 0 aucun, 1 tampon, 2 marque.
export const MARQUAGE_MAX = 2;

// `limites` vient de src/sim/recherche.ts (§2bis) et RÉTRÉCIT les plages ci-dessus : ce que
// le joueur n'a pas encore cherché n'est pas refusé, il est ramené en butée — comme un
// curseur d'écran qui s'arrête. Vide (le défaut), aucune limite de recherche ne s'applique :
// c'est le cas des RIVAUX et des produits de référence, qui ne sont pas soumis à la grille
// du joueur.
export function normaliser(recette: Dict, data: Dict, limites: Dict = {}): Dict {
  const familles: Dict = data.precurseurs.familles;
  let famille = str(get(recette, "famille", ""));
  const ouvertes: string[] = get(limites, "familles", []);
  if (!Object.hasOwn(familles, famille) || (ouvertes.length > 0 && !ouvertes.includes(famille))) {
    // La butée d'une famille fermée est DÉCLARÉE (data/procedes.json) et non déduite :
    // `ouvertes[0]` après tri faisait changer le repli à mesure qu'on cherchait. Sans
    // limites (rivaux, produits de référence), on garde la première famille du catalogue.
    const defaut = str(get(limites, "famille_defaut", ""));
    if (defaut !== "" && Object.hasOwn(familles, defaut)) famille = defaut;
    else if (ouvertes.length === 0) famille = str(clesTriees(familles)[0]);
    else famille = str(ouvertes[0]);
  }
  const pMax = minf(PURETE_MAX, Number(get(limites, "purete_max", PURETE_MAX)));
  const rMax = minf(RENDEMENT_MAX, Number(get(limites, "rendement_max", RENDEMENT_MAX)));
  const cMax = mini(COMPLEXITE_MAX, int(get(limites, "complexite_max", COMPLEXITE_MAX)));
  const kMax = minf(COUPE_MAX, Number(get(limites, "coupe_max", COUPE_MAX)));
  const sMax = mini(STABILISATION_MAX, int(get(limites, "stabilisation_max", STABILISATION_MAX)));
  const mMax = mini(MARQUAGE_MAX, int(get(limites, "marquage_max", MARQUAGE_MAX)));
  const conc = data.conception;
  return {
    famille,
    purete: clampf(Number(get(recette, "purete", PURETE_MIN)), PURETE_MIN, maxf(pMax, PURETE_MIN)),
    rendement: clampf(Number(get(recette, "rendement", RENDEMENT_MIN)), RENDEMENT_MIN,
      maxf(rMax, RENDEMENT_MIN)),
    complexite: clampi(int(get(recette, "complexite", COMPLEXITE_MIN)), COMPLEXITE_MIN,
      maxi(cMax, COMPLEXITE_MIN)),
    coupe: clampf(Number(get(recette, "coupe", 0.0)), 0.0, maxf(kMax, 0.0)),
    stabilisation: clampi(int(get(recette, "stabilisation", 0)), 0, maxi(sMax, 0)),
    // LES QUATRE CHOIX DE CONCEPTION (data/conception.json). Absents, ils valent leur option
    // NEUTRE — c'est ce qui laisse les rivaux, les références et les bots bit-identiques à
    // ce qu'ils étaient avant que ces choix existent.
    marquage: clampi(int(get(recette, "marquage", 0)), 0, maxi(mMax, 0)),
    forme: option(recette, "forme", conc.formes, get(limites, "formes", [])),
    agent: option(recette, "agent", conc.agents, get(limites, "agents", [])),
    cadence: option(recette, "cadence", conc.cadences, get(limites, "cadences", [])),
  };
}

// Une option fermée ou inconnue retombe sur l'option NEUTRE déclarée, jamais sur « la
// première ouverte » : c'est la leçon de la butée de famille (§20), appliquée d'emblée.
function option(recette: Dict, cle: string, groupe: Dict, ouvertes: string[]): string {
  const v = str(get(recette, cle, ""));
  if (!Object.hasOwn(groupe.options, v) || (ouvertes.length > 0 && !ouvertes.includes(v))) {
    return str(groupe.defaut);
  }
  return v;
}

// LES SEPT SPECS. Une recette normalisée entre, sept nombres sortent, rien d'autre n'est lu.
export function specs(recette: Dict, data: Dict): Dict {
  const r = normaliser(recette, data);
  const cp = data.constants.produit;
  const eco = data.constants.eco;
  const f = data.precurseurs.familles[str(r.famille)];
  const purete: number = r.purete;
  const rendement: number = r.rendement;
  const complexite: number = r.complexite;
  const coupe: number = r.coupe;
  const stabilisation: number = r.stabilisation;
  const conc = data.conception;
  const marquage: number = r.marquage;
  const fo = conc.formes.options[str(r.forme)];
  const ag = conc.agents.options[str(r.agent)];
  const ca = conc.cadences.options[str(r.cadence)];

  // 1. PUISSANCE — ce qui se vend. La coupe dilue après production ; l'agent de coupe
  // décide QUELLE PART de la coupe dilue (1 pour l'agent neutre, moins pour un enrobant).
  const puissance = purete * (1.0 - coupe * Number(get(ag, "dilution", 1.0))) * Number(f.k_famille);

  // 2. COÛT UNITAIRE — la pureté coûte en CARRÉ (§2), le rendement bas coûte en inverse (on
  // jette ce qu'on ne convertit pas), la complexité et les additifs s'ajoutent.
  // CE QUE LA COMPLEXITÉ ACHÈTE : elle DIVISE le carré de la pureté — sans elle ce curseur
  // n'avait aucune raison d'être bougé. À complexité 1 le diviseur vaut 1.
  // LA COUPE DIVISE LE COÛT PAR KILO VENDU : on vend plus de kilos pour le même précurseur.
  const coutPurete = 1.0 + Number(eco.k_cout_purete) * purete * purete
    / Math.pow(complexite, Number(cp.k_complexite_purete));
  const cout = (Number(f.cout_base_kg)
    * coutPurete
    * (Number(cp.rendement_reference) / rendement)
    * (1.0 + Number(cp.k_cout_complexite) * (complexite - 1.0))
    + Number(cp.cout_stabilisation_kg) * stabilisation) * (1.0 - coupe)
    * Number(get(fo, "mult_cout", 1.0));

  // 3. DÉBIT — ce que le labo sort par semaine, EN KILOS VENDABLES. Un procédé complexe est
  // lent, une famille rare ne s'approvisionne pas à volonté, et la coupe AJOUTE du volume :
  // puissance × volume reste constant, c'est un échange pur qualité contre quantité.
  const debit = Number(eco.capacite_labo_kg_sem) * rendement
    * maxf(1.0 - Number(cp.k_debit_complexite) * complexite, 0.0)
    * Number(f.disponibilite) / maxf(1.0 - coupe, 0.05)
    * Number(get(fo, "mult_debit", 1.0)) * Number(get(ca, "mult_debit", 1.0));

  // 4. SIGNATURE — ce que le produit laisse derrière lui. Elle entre dans la visibilité
  // (§7) multipliée par les kilos. La forme la module, le marquage l'alourdit : un tampon se
  // reconnaît, c'est son but.
  const signature = maxf((Number(f.tracabilite)
    * (1.0 + Number(cp.k_signature_complexite) * complexite)
    - Number(cp.k_signature_stabilisation) * stabilisation)
    * Number(get(fo, "mult_signature", 1.0))
    + Number(conc.marquage.k_signature) * marquage, 0.0);

  // 5. RÉGULARITÉ DU LOT — la variance de fabrication, d'un lot à l'autre. Ce n'est pas la
  // qualité : viser haut, c'est rater plus souvent, et c'est ce que paient `milieu` et
  // `haut_de_gamme`. LE RENDEMENT PAIE ICI, et c'est sa seule contrepartie. La forme et la
  // cadence la multiplient, l'agent enrobant l'alourdit à proportion de la coupe. La
  // compétence du chimiste arrive avec les bras droits (§6, jalon 4).
  const competence = Number(cp.competence_defaut);
  const variance = (Number(cp.k_variance_purete) * purete
    + Number(cp.k_variance_complexite) * (complexite - 1.0)
    + Number(cp.k_variance_rendement) * rendement) * (1.0 - competence)
    * Number(get(fo, "mult_variance", 1.0)) * Number(get(ca, "mult_variance", 1.0))
    + Number(get(ag, "variance_par_coupe", 0.0)) * coupe;
  const regularite = clampf(1.0 - variance, 0.0, 1.0);

  // 6. DÉPENDANCE — ce qui fidélise la demande (§4). Elle punit la coupe deux fois ; l'agent
  // exaltant la renforce à proportion de la coupe, le marquage la fidélise.
  const dependance = Math.pow(maxf(puissance, 0.0), Number(cp.exposant_dependance))
    * (1.0 - coupe) * (1.0 + Number(get(ag, "dependance_par_coupe", 0.0)) * coupe)
    * (1.0 + Number(conc.marquage.k_dependance) * marquage);

  // 7. INSTABILITE_NEURO — l'axe le plus important du jeu (§2). Il monte avec la puissance,
  // la stabilisation le rachète à prix fort, la famille pose son seuil : la recette la plus
  // rentable est mécaniquement celle qui charge le plus vite (§8).
  const instabilite = clampf(
    Math.pow(maxf(puissance, 0.0), Number(cp.exposant_instabilite))
    - Number(cp.k_instabilite_stabilisation) * stabilisation
    - Number(f.seuil_famille)
    + Number(get(ag, "instabilite_par_coupe", 0.0)) * coupe, 0.0, 1.0);

  return {
    puissance,
    cout_unitaire: cout,
    debit_kg_sem: debit,
    signature,
    regularite_lot: regularite,
    dependance,
    instabilite_neuro: instabilite,
  };
}
