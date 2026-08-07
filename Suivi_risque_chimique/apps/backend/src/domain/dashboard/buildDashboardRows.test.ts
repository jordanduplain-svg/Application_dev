import { describe, expect, it } from "vitest";

import type { Clock } from "../../ports/Clock.js";
import type {
  DegreExpositionItem,
  PersonnelItem,
  RisqueChimiqueItem,
} from "../mapping/types.js";
import { buildDashboardRows } from "./buildDashboardRows.js";

/** Données 100 % synthétiques. Clock figé pour des durées déterministes. */

class FakeClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return this.fixed;
  }
}

const clock = new FakeClock(new Date("2026-01-01T00:00:00Z"));
const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const personne = (over: Partial<PersonnelItem>): PersonnelItem => ({
  naturalKey: `m:${over.matricule ?? "x"}|secteur-a|2020-01-01`,
  matricule: "EMP-001",
  nom: "Durand-Test",
  prenom: "Alice",
  fonction: "Opératrice",
  codeSecteur: "SECTEUR-A",
  dateDebutSecteur: d("2020-01-01"),
  dateFinSecteur: null,
  entrepriseTravailTemporaire: null,
  ...over,
});

const produit = (over: Partial<RisqueChimiqueItem>): RisqueChimiqueItem => ({
  naturalKey: "produit x|secteur-a",
  designation: "Produit X",
  nCas: "00-00-0",
  classifSgh: "H300",
  pictogrammes: null,
  voiesExposition: null,
  mentionDanger: "Danger test",
  mesuresPrevention: null,
  niveauRisque: null,
  dateEvaluation: d("2023-01-01"),
  dateRetrait: null,
  codeSecteur: "SECTEUR-A",
  ...over,
});

const degre = (over: Partial<DegreExpositionItem>): DegreExpositionItem => ({
  naturalKey: "m:emp-001|secteur-a|produit x",
  matricule: "EMP-001",
  nom: "Durand-Test",
  prenom: "Alice",
  codeSecteur: "SECTEUR-A",
  nomProduit: "Produit X",
  degreExposition: "Modéré",
  ...over,
});

describe("buildDashboardRows", () => {
  it("croise personne × produits du secteur, degré null si non renseigné", () => {
    const { rows, joinAnomalies } = buildDashboardRows(
      [personne({})],
      [produit({}), produit({ designation: "Produit Y", naturalKey: "produit y|secteur-a" })],
      [],
      clock,
    );
    expect(joinAnomalies).toEqual([]);
    expect(rows).toHaveLength(2); // 1 personne × 2 produits
    expect(rows.every((r) => r.degreExposition === null)).toBe(true);
    // En poste + produit utilisé → durée court jusqu'à aujourd'hui (6 ans).
    expect(rows[0]!.dureeExpositionAnnees).toBeGreaterThan(5.9);
  });

  it("ne croise PAS des secteurs différents", () => {
    const { rows } = buildDashboardRows(
      [personne({ codeSecteur: "SECTEUR-A" })],
      [produit({ codeSecteur: "SECTEUR-B", naturalKey: "produit x|secteur-b" })],
      [],
      clock,
    );
    expect(rows).toHaveLength(0);
  });

  it("le rapprochement secteur est insensible à la casse et aux accents", () => {
    const { rows } = buildDashboardRows(
      [personne({ codeSecteur: "Pôle-Étanchéité" })],
      [produit({ codeSecteur: "POLE-ETANCHEITE", naturalKey: "produit x|pole-etancheite" })],
      [],
      clock,
    );
    expect(rows).toHaveLength(1);
  });

  it("attribue le degré par matricule", () => {
    const { rows, joinAnomalies } = buildDashboardRows(
      [personne({})],
      [produit({})],
      [degre({})],
      clock,
    );
    expect(joinAnomalies).toEqual([]);
    expect(rows[0]!.degreExposition).toBe("Modéré");
  });

  it("attribue le degré par nom+prénom quand le matricule manque et que le nom est unique", () => {
    const { rows, joinAnomalies } = buildDashboardRows(
      [personne({ matricule: null, naturalKey: "np:durand-test|alice|secteur-a|2020-01-01" })],
      [produit({})],
      [degre({ matricule: null, naturalKey: "np:durand-test|alice|secteur-a|produit x" })],
      clock,
    );
    expect(joinAnomalies).toEqual([]);
    expect(rows[0]!.degreExposition).toBe("Modéré");
  });

  it("HOMONYMES : degré sans matricule + deux personnes au même nom → anomalie, pas d'attribution", () => {
    const { rows, joinAnomalies } = buildDashboardRows(
      [
        personne({ matricule: "EMP-001", naturalKey: "m:emp-001|secteur-a|2020-01-01" }),
        // Homonyme parfait, autre matricule, même secteur.
        personne({ matricule: "EMP-099", naturalKey: "m:emp-099|secteur-a|2021-05-01", dateDebutSecteur: d("2021-05-01") }),
      ],
      [produit({})],
      [degre({ matricule: null, naturalKey: "np:durand-test|alice|secteur-a|produit x" })],
      clock,
    );
    expect(joinAnomalies).toHaveLength(1);
    expect(joinAnomalies[0]!.code).toBe("ambiguous_person_match");
    // Aucune des deux lignes ne reçoit le degré : pas d'attribution au hasard.
    expect(rows.every((r) => r.degreExposition === null)).toBe(true);
  });

  it("MULTI-AFFECTATIONS : même personne revenue dans le secteur → pas une ambiguïté, degré sur chaque affectation", () => {
    const { rows, joinAnomalies } = buildDashboardRows(
      [
        // Même matricule, deux affectations successives au même secteur.
        personne({ naturalKey: "m:emp-001|secteur-a|2018-01-01", dateDebutSecteur: d("2018-01-01"), dateFinSecteur: d("2019-01-01") }),
        personne({ naturalKey: "m:emp-001|secteur-a|2021-01-01", dateDebutSecteur: d("2021-01-01") }),
      ],
      [produit({})],
      [degre({})],
      clock,
    );
    expect(joinAnomalies).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.degreExposition === "Modéré")).toBe(true);
  });

  it("MULTI-AFFECTATIONS SANS MATRICULE : même personne (nom unique) revenue → pas d'ambiguïté, degré sur chaque affectation", () => {
    const { rows, joinAnomalies } = buildDashboardRows(
      [
        personne({ matricule: null, naturalKey: "np:durand-test|alice|secteur-a|2018-01-01", dateDebutSecteur: d("2018-01-01"), dateFinSecteur: d("2019-01-01") }),
        personne({ matricule: null, naturalKey: "np:durand-test|alice|secteur-a|2021-01-01", dateDebutSecteur: d("2021-01-01") }),
      ],
      [produit({})],
      [degre({ matricule: null, naturalKey: "np:durand-test|alice|secteur-a|produit x" })],
      clock,
    );
    expect(joinAnomalies).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.degreExposition === "Modéré")).toBe(true);
  });

  it("degré orphelin de produit → anomalie", () => {
    const { joinAnomalies } = buildDashboardRows(
      [personne({})],
      [produit({})],
      [degre({ nomProduit: "Produit Inconnu", naturalKey: "m:emp-001|secteur-a|produit inconnu" })],
      clock,
    );
    expect(joinAnomalies[0]!.code).toBe("degree_orphan_product");
  });

  it("degré orphelin de personne → anomalie", () => {
    const { joinAnomalies } = buildDashboardRows(
      [personne({})],
      [produit({})],
      [degre({ matricule: "EMP-404", naturalKey: "m:emp-404|secteur-a|produit x" })],
      clock,
    );
    expect(joinAnomalies[0]!.code).toBe("degree_orphan_person");
  });

  it("durée bornée par le retrait du produit quand il précède la sortie de secteur", () => {
    const { rows } = buildDashboardRows(
      [personne({ dateDebutSecteur: d("2020-01-01"), dateFinSecteur: null })],
      [produit({ dateRetrait: d("2022-01-01") })],
      [],
      clock,
    );
    // 2020-01-01 → 2022-01-01 : 731 jours (2020 bissextile).
    expect(rows[0]!.dureeExpositionAnnees).toBeCloseTo(731 / 365.25, 6);
  });

  it("dates incohérentes → durée 0 + anomalie d'exposition SUR la ligne", () => {
    const { rows } = buildDashboardRows(
      [personne({ dateDebutSecteur: d("2024-01-01"), dateFinSecteur: d("2020-01-01") })],
      [produit({})],
      [],
      clock,
    );
    expect(rows[0]!.dureeExpositionAnnees).toBe(0);
    expect(rows[0]!.exposureAnomalies[0]!.code).toBe("sector_end_before_start");
  });
});
