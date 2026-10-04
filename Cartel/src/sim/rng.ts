// Raison d'être : le seul générateur aléatoire de la simulation, un congruentiel linéaire
// dont l'état vit DANS le state — une partie se rejoue à l'identique depuis sa graine, et
// une sauvegarde reprend le flux là où il s'était arrêté.
//
// L'arithmétique est exacte en double : s < 2^32, donc s * 1664525 + 1013904223 < 2^53, et
// le modulo 2^32 remplace le `& 0xFFFFFFFF` de GDScript (un & JavaScript tronquerait à 32 bits
// SIGNÉS avant de masquer).
import { type Dict } from "./gd.ts";

export function suivant(state: Dict): number {
  const s = (Number(state.rng) * 1664525 + 1013904223) % 4294967296;
  state.rng = s;
  return s;
}

export function reel(state: Dict): number {
  return suivant(state) / 4294967296.0;
}
