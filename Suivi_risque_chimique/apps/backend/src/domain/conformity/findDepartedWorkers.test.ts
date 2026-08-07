import { describe, expect, it } from "vitest";

import type { PersonnelItem } from "../mapping/types.js";
import { findDepartedWorkers } from "./findDepartedWorkers.js";

const asOf = new Date("2026-06-25T00:00:00Z");
const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const p = (over: Partial<PersonnelItem>): PersonnelItem => ({
  naturalKey: "k",
  matricule: "EMP-1",
  nom: "Durand",
  prenom: "Alice",
  fonction: null,
  codeSecteur: "A",
  dateDebutSecteur: d("2020-01-01"),
  dateFinSecteur: null,
  entrepriseTravailTemporaire: null,
  ...over,
});

describe("findDepartedWorkers", () => {
  it("liste une personne dont l'affectation est terminée", () => {
    const r = findDepartedWorkers([p({ dateFinSecteur: d("2024-03-01") })], asOf);
    expect(r).toHaveLength(1);
    expect(r[0]!.lastDeparture).toEqual(d("2024-03-01"));
  });

  it("exclut une personne encore en poste (fin nulle)", () => {
    expect(findDepartedWorkers([p({ dateFinSecteur: null })], asOf)).toHaveLength(0);
  });

  it("exclut une personne avec une affectation active (partie d'un secteur, présente ailleurs)", () => {
    const r = findDepartedWorkers(
      [
        p({ codeSecteur: "A", naturalKey: "a", dateFinSecteur: d("2023-01-01") }),
        p({ codeSecteur: "B", naturalKey: "b", dateFinSecteur: null }),
      ],
      asOf,
    );
    expect(r).toHaveLength(0);
  });

  it("ignore une date de fin FUTURE (départ planifié)", () => {
    expect(findDepartedWorkers([p({ dateFinSecteur: d("2027-01-01") })], asOf)).toHaveLength(0);
  });

  it("prend la date de départ la plus récente sur plusieurs affectations terminées", () => {
    const r = findDepartedWorkers(
      [
        p({ naturalKey: "a", dateFinSecteur: d("2022-01-01") }),
        p({ naturalKey: "b", dateFinSecteur: d("2024-09-01") }),
      ],
      asOf,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.lastDeparture).toEqual(d("2024-09-01"));
  });
});
