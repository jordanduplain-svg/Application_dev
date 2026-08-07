import { describe, expect, it } from "vitest";

import { mapDegreExpositionRows, mapPersonnelRows, mapRisqueChimiqueRows } from "./mapRows.js";
import type { MappingConfig } from "./types.js";

/**
 * Tests du mapper — données 100 % synthétiques (cf. CONTRIBUTING : jamais de
 * données réelles, même dans les tests).
 */

/** Enveloppe des lignes de test avec leur numéro source (2 = première ligne de données). */
const src = (...rows: Record<string, unknown>[]) => rows.map((data, i) => ({ rowNumber: i + 2, data }));

const PERSONNEL_CONFIG: MappingConfig = {
  listType: "PERSONNEL",
  columns: {
    matricule: "Matricule",
    nom: "Nom de famille",
    prenom: "Prénom",
    fonction: "Poste",
    code_secteur: "Code Atelier",
    date_debut_secteur: "Entrée secteur",
    date_fin_secteur: "Sortie secteur",
  },
};

describe("mapPersonnelRows", () => {
  it("mappe une ligne complète avec colonnes renommées client", () => {
    const { items, anomalies } = mapPersonnelRows(src(
        {
          "Matricule": "EMP-001",
          "Nom de famille": "Dupont-Test",
          "Prénom": "Alice",
          "Poste": "Opératrice",
          "Code Atelier": "ATELIER-A",
          "Entrée secteur": "15/01/2020",
          "Sortie secteur": "",
        },
      ),
      PERSONNEL_CONFIG,
    );
    expect(anomalies).toEqual([]);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.matricule).toBe("EMP-001");
    expect(item.nom).toBe("Dupont-Test");
    expect(item.dateDebutSecteur.toISOString()).toBe("2020-01-15T00:00:00.000Z");
    expect(item.dateFinSecteur).toBeNull();
    expect(item.naturalKey).toBe("m:emp-001|atelier-a|2020-01-15");
  });

  it("repli nom+prénom normalisés quand le matricule est absent", () => {
    const { items } = mapPersonnelRows(src(
        {
          "Matricule": "",
          "Nom de famille": "  DUPONT-Test ",
          "Prénom": "Émile",
          "Poste": null,
          "Code Atelier": "B",
          "Entrée secteur": "2021-03-01",
          "Sortie secteur": null,
        },
      ),
      PERSONNEL_CONFIG,
    );
    expect(items[0]!.naturalKey).toBe("np:dupont-test|emile|b|2021-03-01");
  });

  it("rejette la ligne au champ obligatoire vide, avec le numéro de ligne Excel", () => {
    const { items, anomalies } = mapPersonnelRows(src(
        {
          "Matricule": "EMP-002",
          "Nom de famille": "Valide",
          "Prénom": "Bob",
          "Poste": null,
          "Code Atelier": "A",
          "Entrée secteur": "2020-01-01",
          "Sortie secteur": null,
        },
        {
          "Matricule": "EMP-003",
          "Nom de famille": "", // nom manquant → rejet
          "Prénom": "Carla",
          "Poste": null,
          "Code Atelier": "A",
          "Entrée secteur": "2020-01-01",
          "Sortie secteur": null,
        },
      ),
      PERSONNEL_CONFIG,
    );
    expect(items).toHaveLength(1);
    expect(anomalies).toHaveLength(1);
    // Ligne 3 dans Excel : 1 = en-têtes, 2 = EMP-002, 3 = EMP-003.
    expect(anomalies[0]).toMatchObject({
      rowNumber: 3,
      field: "nom",
      code: "missing_required_field",
    });
  });

  it("rejette la ligne dont une date OPTIONNELLE est illisible (jamais null silencieux)", () => {
    const { items, anomalies } = mapPersonnelRows(src(
        {
          "Matricule": "EMP-004",
          "Nom de famille": "Test",
          "Prénom": "Diane",
          "Poste": null,
          "Code Atelier": "A",
          "Entrée secteur": "2020-01-01",
          "Sortie secteur": "en poste", // illisible : ni vide ni date
        },
      ),
      PERSONNEL_CONFIG,
    );
    expect(items).toHaveLength(0);
    expect(anomalies[0]).toMatchObject({ field: "date_fin_secteur", code: "invalid_date" });
  });

  it("signale une colonne mappée absente du fichier (erreur de config)", () => {
    const { anomalies } = mapPersonnelRows(src({ "Nom de famille": "X", "Prénom": "Y" }),
      PERSONNEL_CONFIG,
    );
    const configErrors = anomalies.filter((a) => a.code === "mapped_column_absent");
    // Matricule, Poste, Code Atelier, Entrée secteur, Sortie secteur manquent.
    expect(configErrors.length).toBeGreaterThanOrEqual(4);
    expect(configErrors[0]!.rowNumber).toBe(1);
  });
});

describe("mapRisqueChimiqueRows", () => {
  const CONFIG: MappingConfig = {
    listType: "RISQUES_CHIMIQUES",
    columns: {
      designation: "Produit",
      n_cas: "CAS",
      classif_sgh: "SGH",
      code_secteur: "Secteur",
      date_evaluation: "Évaluation",
      date_retrait: "Retrait",
    },
  };

  it("clé naturelle = désignation + secteur normalisés", () => {
    const { items, anomalies } = mapRisqueChimiqueRows(src(
        {
          Produit: "  Acétone   Technique ",
          CAS: "67-64-1",
          SGH: "H225",
          Secteur: "ATELIER-A",
          Évaluation: "2023-06-01",
          Retrait: null,
        },
      ),
      CONFIG,
    );
    expect(anomalies).toEqual([]);
    expect(items[0]!.naturalKey).toBe("acetone technique|atelier-a");
    expect(items[0]!.designation).toBe("Acétone   Technique"); // affichage : trim seul
    expect(items[0]!.dateRetrait).toBeNull();
  });

  it("champs facultatifs non mappés → null sans anomalie", () => {
    const { items, anomalies } = mapRisqueChimiqueRows(src({ Produit: "Éthanol", Secteur: "B", CAS: null, SGH: null, Évaluation: null, Retrait: null }),
      CONFIG,
    );
    expect(anomalies).toEqual([]);
    expect(items[0]!.nCas).toBeNull();
    expect(items[0]!.mentionDanger).toBeNull(); // jamais mappé : null
  });
});

describe("mapDegreExpositionRows", () => {
  const CONFIG: MappingConfig = {
    listType: "DEGRE_EXPOSITION",
    columns: {
      matricule: "Matricule",
      nom: "Nom",
      prenom: "Prénom",
      code_secteur: "Secteur",
      nom_produit: "Produit",
      degre_exposition: "Degré",
    },
  };

  it("degré conservé en texte brut (polymorphe selon client)", () => {
    const { items } = mapDegreExpositionRows(src(
        {
          Matricule: "EMP-001",
          Nom: "Dupont-Test",
          Prénom: "Alice",
          Secteur: "ATELIER-A",
          Produit: "Acétone Technique",
          Degré: "Modéré",
        },
        {
          Matricule: "EMP-005",
          Nom: "Martin-Test",
          Prénom: "Paul",
          Secteur: "ATELIER-A",
          Produit: "Acétone Technique",
          Degré: "3", // échelle numérique chez un autre client : conservée telle quelle
        },
      ),
      CONFIG,
    );
    expect(items[0]!.degreExposition).toBe("Modéré");
    expect(items[1]!.degreExposition).toBe("3");
    expect(items[0]!.naturalKey).toBe("m:emp-001|atelier-a|acetone technique");
  });

  it("la clé naturelle du degré converge avec celle du produit (rapprochement)", () => {
    // Même produit écrit différemment dans les deux fichiers : la
    // normalisation doit faire converger nomProduit ↔ designation.
    const { items } = mapDegreExpositionRows(src(
        {
          Matricule: "EMP-001",
          Nom: "Dupont-Test",
          Prénom: "Alice",
          Secteur: "atelier-a",
          Produit: "ACÉTONE TECHNIQUE",
          Degré: "Faible",
        },
      ),
      CONFIG,
    );
    expect(items[0]!.naturalKey.endsWith("|atelier-a|acetone technique")).toBe(true);
  });
});
