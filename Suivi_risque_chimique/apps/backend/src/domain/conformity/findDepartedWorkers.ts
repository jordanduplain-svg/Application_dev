import { normalizeText } from "../mapping/normalizeText.js";
import type { PersonnelItem } from "../mapping/types.js";

/**
 * Travailleurs « partis » : pour qui TOUTES les affectations connues sont
 * terminées à la date donnée (date de fin renseignée et révolue). Le décret
 * 2024-307 impose de remettre au travailleur, à son départ, l'attestation des
 * informations qui le concernent — cette liste alimente le rappel + la
 * génération de l'attestation individuelle.
 *
 * Une date de fin FUTURE (départ planifié) ne compte pas : la personne est
 * encore en poste. Fonction PURE (instant injecté).
 */
export interface DepartedWorker {
  matricule: string | null;
  nom: string;
  prenom: string;
  /** Date de fin la plus récente parmi ses affectations (= date de départ). */
  lastDeparture: Date;
}

export function findDepartedWorkers(personnel: PersonnelItem[], asOf: Date): DepartedWorker[] {
  const byPerson = new Map<string, PersonnelItem[]>();
  for (const p of personnel) {
    const key =
      p.matricule !== null && p.matricule.trim() !== ""
        ? `m:${normalizeText(p.matricule)}`
        : `np:${normalizeText(p.nom)}|${normalizeText(p.prenom)}`;
    const list = byPerson.get(key) ?? [];
    list.push(p);
    byPerson.set(key, list);
  }

  const result: DepartedWorker[] = [];
  for (const items of byPerson.values()) {
    const allEnded = items.every(
      (p) => p.dateFinSecteur !== null && p.dateFinSecteur.getTime() <= asOf.getTime(),
    );
    if (!allEnded) continue;
    const lastDeparture = items.reduce<Date>((max, p) => {
      const end = p.dateFinSecteur as Date;
      return end.getTime() > max.getTime() ? end : max;
    }, new Date(0));
    const first = items[0]!;
    result.push({
      matricule: first.matricule,
      nom: first.nom,
      prenom: first.prenom,
      lastDeparture,
    });
  }
  // Plus récents d'abord.
  result.sort((a, b) => b.lastDeparture.getTime() - a.lastDeparture.getTime());
  return result;
}
