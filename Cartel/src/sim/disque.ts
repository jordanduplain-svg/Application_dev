// Raison d'être : ce que la simulation ne doit PAS savoir faire pour rester portable dans
// l'interface — lire data/*.json sur le disque et hacher un state. Côté Node uniquement :
// le harnais et les outils l'importent, sim/ jamais.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type Dict } from "./gd.ts";
import { FICHIERS_DATA, serialiser } from "./state.ts";

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Crie si un fichier manque ou ne se lit pas, plutôt que de laisser un `data` à moitié vide
// traverser tout le harnais.
export function chargerData(): Dict {
  const data: Dict = {};
  for (const cle of FICHIERS_DATA) {
    const chemin = join(RACINE, "data", cle + ".json");
    data[cle] = JSON.parse(readFileSync(chemin, "utf8"));
  }
  return data;
}

export function hacher(state: Dict): string {
  return createHash("sha256").update(serialiser(state)).digest("hex");
}
