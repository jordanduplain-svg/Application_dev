import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BuildDashboardUseCase } from "../src/application/dashboard/BuildDashboardUseCase.js";
import { ImportListUseCase } from "../src/application/import/ImportListUseCase.js";
import type { MappingConfig } from "../src/domain/mapping/types.js";
import { ExcelDataSource } from "../src/infrastructure/connectors/excel/ExcelDataSource.js";
import { SystemClock } from "../src/infrastructure/clock/SystemClock.js";
import { PrismaImportJournal } from "../src/infrastructure/persistence/PrismaImportJournal.js";
import { PrismaListRepository } from "../src/infrastructure/persistence/PrismaListRepository.js";

/**
 * Intégration étape 4 : la fixture Excel importée (étape 3) doit produire un
 * tableau de bord correct — jointures secteur, rapprochement produit
 * normalisé, degrés attribués, durées calculées.
 *
 * Prérequis : `docker compose up -d` (Postgres dev sur le port 5435).
 */

process.env.DATABASE_URL ??=
  "postgresql://cmr:cmr_dev_password@localhost:5435/cmr_tracker?schema=public";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "import-synthetique.xlsx");

const MAPPINGS: Record<string, { mapping: MappingConfig; sheet: string }> = {
  personnel: {
    sheet: "Personnel",
    mapping: {
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
    },
  },
  risques: {
    sheet: "Risques",
    mapping: {
      listType: "RISQUES_CHIMIQUES",
      columns: {
        designation: "Produit",
        n_cas: "CAS",
        classif_sgh: "SGH",
        pictogrammes: "Pictos",
        voies_exposition: "Voies",
        mention_danger: "Danger",
        mesures_prevention: "Prévention",
        niveau_risque: "Niveau",
        date_evaluation: "Évaluation",
        date_retrait: "Retrait",
        code_secteur: "Secteur",
      },
    },
  },
  degres: {
    sheet: "Degres",
    mapping: {
      listType: "DEGRE_EXPOSITION",
      columns: {
        matricule: "Matricule",
        nom: "Nom",
        prenom: "Prénom",
        code_secteur: "Secteur",
        nom_produit: "Produit",
        degre_exposition: "Degré",
      },
    },
  },
};

describe("tableau de bord bout-en-bout (fixture importée)", () => {
  const prisma = new PrismaClient();
  const clock = new SystemClock();
  const repository = new PrismaListRepository(prisma, clock);
  const journal = new PrismaImportJournal(prisma);
  const importer = new ImportListUseCase(repository, journal, clock);
  const dashboard = new BuildDashboardUseCase(repository, clock);
  const source = new ExcelDataSource();

  const tenantId = `it-dash-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const write = { tenantId, recordedBy: "integration-test" };

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    // Import des trois listes depuis la fixture.
    for (const { sheet, mapping } of Object.values(MAPPINGS)) {
      await importer.execute(source, {
        mapping,
        table: { location: FIXTURE, table: sheet },
        sourceLabel: `import-synthetique.xlsx#${sheet}`,
        write,
      });
    }
  });

  afterAll(async () => {
    await prisma.personnelHistory.deleteMany({ where: { tenantId } });
    await prisma.risqueChimiqueHistory.deleteMany({ where: { tenantId } });
    await prisma.degreExpositionHistory.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  it("produit les 6 lignes attendues (2 pers. × 2 prod. en A, 2 pers. × 1 prod. en B)", async () => {
    const { rows, joinAnomalies } = await dashboard.execute(tenantId);
    expect(joinAnomalies).toEqual([]);
    expect(rows).toHaveLength(6);

    const resume = rows
      .map((r) => `${r.matricule ?? r.nom}×${r.designation}`)
      .sort();
    expect(resume).toEqual([
      "EMP-001×Acétone Technique",
      "EMP-001×Toluène-Test",
      "EMP-002×Acétone Technique",
      "EMP-002×Toluène-Test",
      "EMP-003×Dégraissant DX-Test",
      "Roux-Test×Dégraissant DX-Test",
    ]);
  });

  it("attribue les degrés à travers les écritures hétérogènes (normalisation)", async () => {
    const { rows } = await dashboard.execute(tenantId);

    // « ACÉTONE   TECHNIQUE » dans la feuille degrés → « Acétone Technique ».
    const aliceAcetone = rows.find(
      (r) => r.matricule === "EMP-001" && r.designation === "Acétone Technique",
    );
    expect(aliceAcetone?.degreExposition).toBe("Modéré");

    const aliceToluene = rows.find(
      (r) => r.matricule === "EMP-001" && r.designation === "Toluène-Test",
    );
    expect(aliceToluene?.degreExposition).toBe("Fort");

    // David (sans matricule) : attribution par nom+prénom, degré numérique.
    const davidDegraissant = rows.find(
      (r) => r.nom === "Roux-Test" && r.designation === "Dégraissant DX-Test",
    );
    expect(davidDegraissant?.degreExposition).toBe("2");

    // Chloé n'a aucun degré renseigné : null, sans anomalie.
    const chloe = rows.find((r) => r.matricule === "EMP-003");
    expect(chloe?.degreExposition).toBeNull();
  });

  it("calcule les durées selon la règle « première date de fin »", async () => {
    const { rows } = await dashboard.execute(tenantId);

    // Alice (entrée 15/01/2020, en poste) × Toluène (retiré le 31/12/2023) :
    // borné par le RETRAIT → (2023-12-31 - 2020-01-15) = 1446 j ≈ 3.959 ans.
    const aliceToluene = rows.find(
      (r) => r.matricule === "EMP-001" && r.designation === "Toluène-Test",
    );
    expect(aliceToluene!.dureeExpositionAnnees).toBeCloseTo(1446 / 365.25, 4);

    // Bruno (entré 01/06/2018, SORTI le 31/03/2023) × Toluène (retiré 31/12/2023) :
    // borné par la SORTIE DE SECTEUR → (2023-03-31 - 2018-06-01) = 1764 j.
    const brunoToluene = rows.find(
      (r) => r.matricule === "EMP-002" && r.designation === "Toluène-Test",
    );
    expect(brunoToluene!.dureeExpositionAnnees).toBeCloseTo(1764 / 365.25, 4);

    // Alice × Acétone (jamais retirée, Alice en poste) : durée ouverte
    // jusqu'à aujourd'hui — strictement supérieure à 5 ans (entrée 2020).
    const aliceAcetone = rows.find(
      (r) => r.matricule === "EMP-001" && r.designation === "Acétone Technique",
    );
    expect(aliceAcetone!.dureeExpositionAnnees).toBeGreaterThan(5);
    expect(aliceAcetone!.exposureAnomalies).toEqual([]);
  });
});
