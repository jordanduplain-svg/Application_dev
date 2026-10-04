// ESSAI WEB — portage de sim/produit.gd en TypeScript, ligne pour ligne.
// L'ordre des opérations flottantes est recopié EXACTEMENT : (a * b) * c n'est pas
// a * (b * c) au dernier bit, et l'essai cherche l'identité bit à bit avec Godot.
// Aucun nombre d'équilibrage ici : tout vient des mêmes data/*.json que Godot.

export type Data = Record<string, any>;
export type Recette = Record<string, any>;
export type Specs = Record<string, number>;

export const PURETE_MIN = 0.30;
export const PURETE_MAX = 0.99;
export const RENDEMENT_MIN = 0.20;
export const RENDEMENT_MAX = 0.95;
export const COMPLEXITE_MIN = 1;
export const COMPLEXITE_MAX = 5;
export const COUPE_MAX = 0.70;
export const STABILISATION_MAX = 3;
export const MARQUAGE_MAX = 2;

// Les primitives de Godot, recopiées de leur définition C++ : les fonctions de Math de JS
// ne garantissent pas le même comportement aux bornes (NaN, -0).
const clampf = (v: number, lo: number, hi: number): number => (v < lo ? lo : (v > hi ? hi : v));
const minf = (a: number, b: number): number => (a < b ? a : b);
const maxf = (a: number, b: number): number => (a > b ? a : b);
// int() de GDScript tronque vers zéro et n'a pas de -0 (c'est un entier) ; Math.trunc(-0.3)
// rend -0, que « + 0 » ramène à +0. Trouvé par la comparaison bit à bit.
const int = (v: unknown): number => Math.trunc(Number(v)) + 0;
const clampi = (v: number, lo: number, hi: number): number => (v < lo ? lo : (v > hi ? hi : v));
const get = (d: Record<string, any>, k: string, defaut: any): any => (k in d ? d[k] : defaut);
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

const clesTriees = (d: Record<string, any>): string[] => Object.keys(d).sort();

export function normaliser(recette: Recette, data: Data, limites: Record<string, any> = {}): Recette {
  const familles: Record<string, any> = data.precurseurs.familles;
  let famille = str(get(recette, "famille", ""));
  const ouvertes: string[] = get(limites, "familles", []);
  if (!(famille in familles) || (ouvertes.length > 0 && !ouvertes.includes(famille))) {
    const defaut = str(get(limites, "famille_defaut", ""));
    if (defaut !== "" && defaut in familles) {
      famille = defaut;
    } else if (ouvertes.length === 0) {
      famille = str(clesTriees(familles)[0]);
    } else {
      famille = str(ouvertes[0]);
    }
  }
  const pMax = minf(PURETE_MAX, Number(get(limites, "purete_max", PURETE_MAX)));
  const rMax = minf(RENDEMENT_MAX, Number(get(limites, "rendement_max", RENDEMENT_MAX)));
  const cMax = Math.min(COMPLEXITE_MAX, int(get(limites, "complexite_max", COMPLEXITE_MAX)));
  const kMax = minf(COUPE_MAX, Number(get(limites, "coupe_max", COUPE_MAX)));
  const sMax = Math.min(STABILISATION_MAX, int(get(limites, "stabilisation_max", STABILISATION_MAX)));
  const mMax = Math.min(MARQUAGE_MAX, int(get(limites, "marquage_max", MARQUAGE_MAX)));
  const conc = data.conception;
  return {
    famille,
    purete: clampf(Number(get(recette, "purete", PURETE_MIN)), PURETE_MIN, maxf(pMax, PURETE_MIN)),
    rendement: clampf(Number(get(recette, "rendement", RENDEMENT_MIN)), RENDEMENT_MIN,
      maxf(rMax, RENDEMENT_MIN)),
    complexite: clampi(int(get(recette, "complexite", COMPLEXITE_MIN)), COMPLEXITE_MIN,
      Math.max(cMax, COMPLEXITE_MIN)),
    coupe: clampf(Number(get(recette, "coupe", 0.0)), 0.0, maxf(kMax, 0.0)),
    stabilisation: clampi(int(get(recette, "stabilisation", 0)), 0, Math.max(sMax, 0)),
    marquage: clampi(int(get(recette, "marquage", 0)), 0, Math.max(mMax, 0)),
    forme: option(recette, "forme", conc.formes, get(limites, "formes", [])),
    agent: option(recette, "agent", conc.agents, get(limites, "agents", [])),
    cadence: option(recette, "cadence", conc.cadences, get(limites, "cadences", [])),
  };
}

function option(recette: Recette, cle: string, groupe: Record<string, any>, ouvertes: string[]): string {
  const v = str(get(recette, cle, ""));
  const options = groupe.options;
  if (!(v in options) || (ouvertes.length > 0 && !ouvertes.includes(v))) {
    return str(groupe.defaut);
  }
  return v;
}

export function specs(recette: Recette, data: Data): Specs {
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

  const puissance = purete * (1.0 - coupe * Number(get(ag, "dilution", 1.0))) * Number(f.k_famille);

  const coutPurete = 1.0 + Number(eco.k_cout_purete) * purete * purete
    / Math.pow(complexite, Number(cp.k_complexite_purete));
  const cout = (Number(f.cout_base_kg)
    * coutPurete
    * (Number(cp.rendement_reference) / rendement)
    * (1.0 + Number(cp.k_cout_complexite) * (complexite - 1.0))
    + Number(cp.cout_stabilisation_kg) * stabilisation) * (1.0 - coupe)
    * Number(get(fo, "mult_cout", 1.0));

  const debit = Number(eco.capacite_labo_kg_sem) * rendement
    * maxf(1.0 - Number(cp.k_debit_complexite) * complexite, 0.0)
    * Number(f.disponibilite) / maxf(1.0 - coupe, 0.05)
    * Number(get(fo, "mult_debit", 1.0)) * Number(get(ca, "mult_debit", 1.0));

  const signature = maxf((Number(f.tracabilite)
    * (1.0 + Number(cp.k_signature_complexite) * complexite)
    - Number(cp.k_signature_stabilisation) * stabilisation)
    * Number(get(fo, "mult_signature", 1.0))
    + Number(conc.marquage.k_signature) * marquage, 0.0);

  const competence = Number(cp.competence_defaut);
  const variance = (Number(cp.k_variance_purete) * purete
    + Number(cp.k_variance_complexite) * (complexite - 1.0)
    + Number(cp.k_variance_rendement) * rendement) * (1.0 - competence)
    * Number(get(fo, "mult_variance", 1.0)) * Number(get(ca, "mult_variance", 1.0))
    + Number(get(ag, "variance_par_coupe", 0.0)) * coupe;
  const regularite = clampf(1.0 - variance, 0.0, 1.0);

  const dependance = Math.pow(maxf(puissance, 0.0), Number(cp.exposant_dependance))
    * (1.0 - coupe) * (1.0 + Number(get(ag, "dependance_par_coupe", 0.0)) * coupe)
    * (1.0 + Number(conc.marquage.k_dependance) * marquage);

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
