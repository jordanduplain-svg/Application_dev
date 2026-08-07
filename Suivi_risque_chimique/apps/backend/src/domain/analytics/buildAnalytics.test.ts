import { describe, expect, it } from "vitest";

import type { DashboardRow } from "../dashboard/types.js";
import { buildAnalytics } from "./buildAnalytics.js";

const row = (over: Partial<DashboardRow>): DashboardRow => ({
  matricule: "EMP-1",
  nom: "Durand",
  prenom: "Alice",
  fonction: null,
  codeSecteur: "ATELIER-A",
  dateDebutSecteur: new Date("2020-01-01"),
  dateFinSecteur: null,
  entrepriseTravailTemporaire: null,
  designation: "Acétone",
  nCas: null,
  classifSgh: null,
  mentionDanger: null,
  isCmr: false,
  cmrCategories: [],
  dateEvaluation: null,
  dateRetrait: null,
  degreExposition: "Fort",
  dureeExpositionAnnees: 1,
  exposureAnomalies: [],
  ...over,
});

describe("buildAnalytics", () => {
  it("compte travailleurs/produits/expositions distincts", () => {
    const a = buildAnalytics([
      row({ matricule: "A", designation: "Acétone" }),
      row({ matricule: "A", designation: "Toluène" }), // même personne, 2 produits
      row({ matricule: "B", designation: "Acétone" }),
    ]);
    expect(a.totals.workers).toBe(2);
    expect(a.totals.products).toBe(2);
    expect(a.totals.exposures).toBe(3);
  });

  it("agrège par secteur en personnes distinctes", () => {
    const a = buildAnalytics([
      row({ matricule: "A", codeSecteur: "ATELIER-A" }),
      row({ matricule: "A", codeSecteur: "ATELIER-A", designation: "Toluène" }),
      row({ matricule: "B", codeSecteur: "ATELIER-B" }),
    ]);
    expect(a.bySector).toEqual([
      { name: "ATELIER-A", count: 1 },
      { name: "ATELIER-B", count: 1 },
    ]);
  });

  it("répartit les degrés (avec « Non renseigné »)", () => {
    const a = buildAnalytics([
      row({ degreExposition: "Fort" }),
      row({ degreExposition: "Fort", matricule: "B" }),
      row({ degreExposition: null, matricule: "C" }),
    ]);
    expect(a.byDegree).toEqual([
      { name: "Fort", count: 2 },
      { name: "Non renseigné", count: 1 },
    ]);
  });

  it("compte les CMR (produits et travailleurs distincts)", () => {
    const a = buildAnalytics([
      row({ matricule: "A", designation: "Benzène", isCmr: true }),
      row({ matricule: "B", designation: "Benzène", isCmr: true }),
      row({ matricule: "C", designation: "Acétone", isCmr: false }),
    ]);
    expect(a.cmr).toEqual({ products: 1, workers: 2 });
  });
});
