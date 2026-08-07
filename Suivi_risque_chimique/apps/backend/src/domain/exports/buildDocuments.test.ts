import { describe, expect, it } from "vitest";

import type { AnonymizedView } from "../anonymization/types.js";
import type { DashboardRow } from "../dashboard/types.js";
import {
  buildAnonymizedDocument,
  buildIndividualDocument,
  buildNominativeDocument,
} from "./buildDocuments.js";

const AT = new Date("2026-06-12T00:00:00Z");
const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const row = (over: Partial<DashboardRow>): DashboardRow => ({
  matricule: "EMP-001",
  nom: "Durand-Test",
  prenom: "Alice",
  fonction: "Opératrice",
  codeSecteur: "ATELIER-A",
  dateDebutSecteur: d("2020-01-15"),
  dateFinSecteur: null,
  entrepriseTravailTemporaire: null,
  designation: "Acétone Technique",
  nCas: "67-64-1",
  classifSgh: "H225",
  mentionDanger: "Liquide très inflammable",
  isCmr: false,
  cmrCategories: [],
  dateEvaluation: d("2023-06-01"),
  dateRetrait: null,
  degreExposition: "Modéré",
  dureeExpositionAnnees: 6.4,
  exposureAnomalies: [],
  ...over,
});

describe("buildIndividualDocument", () => {
  it("porte l'identité, la base légale et les expositions du salarié", () => {
    const doc = buildIndividualDocument([row({}), row({ designation: "Toluène", degreExposition: "Fort" })], AT);
    expect(doc.type).toBe("individual");
    expect(doc.subtitle).toBe("Alice Durand-Test");
    expect(doc.meta.some((m) => m.value.includes("R. 4412-93-2"))).toBe(true);
    const expoTable = doc.sections.find((s) => s.heading === "Expositions")?.table;
    expect(expoTable?.rows).toHaveLength(2);
    expect(doc.meta.some((m) => m.value === "12/06/2026")).toBe(true);
  });

  it("fiche sans exposition : note explicite, pas de tableau vide trompeur", () => {
    const doc = buildIndividualDocument([], AT);
    const expo = doc.sections.find((s) => s.heading === "Expositions");
    expect(expo?.notes).toContain("Aucune exposition enregistrée à ce jour.");
  });

  it("anomalie de dates : la cellule durée le signale au lieu d'un chiffre", () => {
    const doc = buildIndividualDocument(
      [row({ exposureAnomalies: [{ code: "sector_end_before_start", message: "x" }] })],
      AT,
    );
    const table = doc.sections.find((s) => s.heading === "Expositions")?.table;
    expect(table?.rows[0]?.at(-1)).toBe("Dates incohérentes — durée non calculée");
  });
});

describe("buildNominativeDocument (SPST)", () => {
  it("mentionne la conservation 40 ans et le SPST", () => {
    const doc = buildNominativeDocument([row({})], AT);
    expect(doc.type).toBe("spst_nominative");
    expect(doc.meta.some((m) => m.value.includes("40 ans"))).toBe(true);
    expect(doc.meta.some((m) => m.value.includes("R. 4412-93-3"))).toBe(true);
  });

  it("compte les travailleurs distincts dans le sous-titre", () => {
    const doc = buildNominativeDocument(
      [
        row({ matricule: "EMP-001", designation: "A" }),
        row({ matricule: "EMP-001", designation: "B" }), // même personne, 2 expo
        row({ matricule: "EMP-002", nom: "Autre", designation: "A" }),
      ],
      AT,
    );
    expect(doc.subtitle).toContain("2 travailleur(s)");
    expect(doc.subtitle).toContain("3 exposition(s)");
  });
});

describe("buildAnonymizedDocument (CSE)", () => {
  const view: AnonymizedView = {
    k: 5,
    groups: [
      {
        codeSecteur: "ATELIER-A",
        designation: "Acétone Technique",
        nCas: "67-64-1",
        classifSgh: "H225",
        mentionDanger: "Liquide très inflammable",
        effectifExpose: 7,
        degres: [
          { valeur: "Modéré", effectif: 4 },
          { valeur: "Faible", effectif: 3 },
        ],
        effectifSansDegre: 0,
        effectifDegreMasque: 0,
      },
    ],
    masque: { groupes: 2, expositions: 3 },
  };

  it("publie les groupes et porte le seuil k en méta", () => {
    const doc = buildAnonymizedDocument(view, AT);
    expect(doc.type).toBe("cse_anonymized");
    expect(doc.meta.some((m) => m.value === "k = 5")).toBe(true);
    const table = doc.sections[0]?.table;
    expect(table?.rows[0]).toContain("7");
    expect(table?.rows[0]?.at(-1)).toBe("Modéré : 4 · Faible : 3");
  });

  it("indique les degrés masqués (sous le seuil) de façon agrégée", () => {
    const withMasked: AnonymizedView = {
      ...view,
      groups: [{ ...view.groups[0]!, degres: [{ valeur: "Faible", effectif: 5 }], effectifDegreMasque: 2 }],
    };
    const doc = buildAnonymizedDocument(withMasked, AT);
    expect(doc.sections[0]?.table?.rows[0]?.at(-1)).toBe("Faible : 5 · Autres (masqués) : 2");
  });

  it("note de masquage transparente SANS révéler secteurs/produits masqués", () => {
    const doc = buildAnonymizedDocument(view, AT);
    const note = doc.sections[0]?.notes?.join(" ") ?? "";
    expect(note).toContain("2 regroupement(s)");
    expect(note).toContain("3 exposition(s)");
    expect(note).toContain("k = 5");
  });

  it("vue entièrement masquée : message clair, aucun tableau de données", () => {
    const empty: AnonymizedView = { k: 5, groups: [], masque: { groupes: 1, expositions: 2 } };
    const doc = buildAnonymizedDocument(empty, AT);
    expect(doc.sections[0]?.notes).toContain(
      "Aucune donnée publiable au seuil d'anonymat retenu.",
    );
  });
});
