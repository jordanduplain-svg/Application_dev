// Raison d'être : les primitives de GDScript dont dépend la simulation, recopiées de leur
// définition C++ dans Godot. Les fonctions de Math de JavaScript ne garantissent pas le même
// comportement aux bornes (NaN, -0), et le portage vise l'identité bit à bit avec la
// version Godot qu'il remplace (essai-web : 82 178 specs sur 82 180 identiques, les deux
// écarts venant de pow()).

export type Dict = Record<string, any>;

export const clampf = (v: number, lo: number, hi: number): number => (v < lo ? lo : (v > hi ? hi : v));
export const minf = (a: number, b: number): number => (a < b ? a : b);
export const maxf = (a: number, b: number): number => (a > b ? a : b);
export const absf = Math.abs;
// int() de GDScript tronque vers zéro et n'a pas de -0 (c'est un entier) ; Math.trunc(-0.3)
// rend -0, que « + 0 » ramène à +0. Trouvé par la comparaison bit à bit de l'essai.
export const int = (v: unknown): number => Math.trunc(Number(v)) + 0;
export const clampi = (v: number, lo: number, hi: number): number => (v < lo ? lo : (v > hi ? hi : v));
export const mini = (a: number, b: number): number => (a < b ? a : b);
export const maxi = (a: number, b: number): number => (a > b ? a : b);
export const floori = (v: number): number => Math.floor(v) + 0;
export const float = (v: unknown): number => Number(v);
export const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

// Dictionary.get(cle, defaut) : la valeur si la clé EXISTE, même nulle.
export const get = (d: Dict, k: string, defaut: any): any => (Object.hasOwn(d, k) ? d[k] : defaut);
export const has = (d: Dict, k: string): boolean => Object.hasOwn(d, k);

// Etat.cles_triees : l'ordre de String < de Godot, c'est-à-dire par point de code. Le sort()
// par défaut de JavaScript compare des unités UTF-16, identique pour tout ce que ce projet
// nomme (aucun caractère hors du plan de base dans une clé).
export const clesTriees = (d: Dict): string[] => Object.keys(d).sort();

// is_equal_approx de Godot (core/math/math_funcs.h), à la lettre.
const CMP_EPSILON = 0.00001;
export function isEqualApprox(a: number, b: number): boolean {
  if (a === b) return true;
  let tolerance = CMP_EPSILON * Math.abs(a);
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(a - b) < tolerance;
}

// Copie profonde d'un dictionnaire JSON (Dictionary.duplicate(true)).
export const copie = <T>(v: T): T => structuredClone(v);
