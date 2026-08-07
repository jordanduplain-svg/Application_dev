import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ImportListUseCase } from "../src/application/import/ImportListUseCase.js";
import type { MappingConfig } from "../src/domain/mapping/types.js";
import { ExcelDataSource } from "../src/infrastructure/connectors/excel/ExcelDataSource.js";
import { SystemClock } from "../src/infrastructure/clock/SystemClock.js";
import { PrismaImportJournal } from "../src/infrastructure/persistence/PrismaImportJournal.js";
import { PrismaListRepository } from "../src/infrastructure/persistence/PrismaListRepository.js";

/**
 * Test d'intégration bout-en-bout : fixture Excel synthétique → connecteur →
 * mapping → upsert SCD2 → Postgres (base de DEV docker-compose, port 5435).
 *
 * Prérequis : `docker compose up -d` à la racine. Si la base est down, la
 * suite échoue franchement — c'est voulu, un import qui ne peut pas être
 * vérifié n'est pas « vert ».
 *
 * Isolation : chaque exécution utilise un tenantId unique — pas de nettoyage
 * nécessaire, pas de collision entre exécutions successives ou parallèles.
 */

// Valeurs par défaut du docker-compose de dev (cf. .env.example). En CI ou
// environnement custom, DATABASE_URL prime.
process.env.DATABASE_URL ??=
  "postgresql://cmr:cmr_dev_password@localhost:5435/cmr_tracker?schema=public";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "import-synthetique.xlsx");

const PERSONNEL_MAPPING: MappingConfig = {
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

const RISQUES_MAPPING: MappingConfig = {
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
};

const DEGRES_MAPPING: MappingConfig = {
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

describe("import Excel bout-en-bout (SCD2)", () => {
  const prisma = new PrismaClient();
  const clock = new SystemClock();
  const repository = new PrismaListRepository(prisma, clock);
  const journal = new PrismaImportJournal(prisma);
  const useCase = new ImportListUseCase(repository, journal, clock);
  const source = new ExcelDataSource();

  // Tenant unique par exécution : isolation sans nettoyage.
  const tenantId = `it-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const write = { tenantId, recordedBy: "integration-test" };

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`; // échec immédiat et clair si la base est down
  });

  afterAll(async () => {
    // On purge le tenant de test pour ne pas accumuler de données de test
    // dans la base de dev au fil des exécutions.
    await prisma.personnelHistory.deleteMany({ where: { tenantId } });
    await prisma.risqueChimiqueHistory.deleteMany({ where: { tenantId } });
    await prisma.degreExpositionHistory.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  it("import PERSONNEL : 4 lignes valides créées, 2 anomalies aux bons numéros de ligne", async () => {
    const result = await useCase.execute(source, {
      mapping: PERSONNEL_MAPPING,
      table: { location: FIXTURE, table: "Personnel" },
      sourceLabel: "import-synthetique.xlsx#Personnel",
      write,
    });

    expect(result.status).toBe("partial");
    // 6 lignes non vides lues (la ligne 6, vide, est ignorée par le connecteur).
    expect(result.rowsRead).toBe(6);
    expect(result.report).toEqual({ created: 4, updated: 0, unchanged: 0 });

    // Les anomalies pointent les numéros de ligne du FICHIER (7 et 8),
    // malgré la ligne vide sautée — c'est la garantie de provenance.
    expect(result.anomalies).toHaveLength(2);
    expect(result.anomalies.map((a) => a.rowNumber).sort()).toEqual([7, 8]);
    expect(result.anomalies.find((a) => a.rowNumber === 7)?.field).toBe("prenom");
    expect(result.anomalies.find((a) => a.rowNumber === 8)?.code).toBe("invalid_date");

    // Le run est journalisé avec ses anomalies.
    const run = await prisma.importRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { anomalies: true },
    });
    expect(run.status).toBe("PARTIAL");
    expect(run.anomalies).toHaveLength(2);
  });

  it("ré-import à l'identique : aucune écriture (unchanged), zéro nouvelle version", async () => {
    const result = await useCase.execute(source, {
      mapping: PERSONNEL_MAPPING,
      table: { location: FIXTURE, table: "Personnel" },
      sourceLabel: "import-synthetique.xlsx#Personnel (re-run)",
      write,
    });

    expect(result.report).toEqual({ created: 0, updated: 0, unchanged: 4 });

    const versions = await prisma.personnelHistory.count({ where: { tenantId } });
    expect(versions).toBe(4); // toujours 4 versions au total, aucune duplication
  });

  it("modification d'un champ : clôture + nouvelle version du même entityId", async () => {
    const current = await repository.findCurrentPersonnel(tenantId);
    const alice = current.find((p) => p.matricule === "EMP-001");
    expect(alice).toBeDefined();

    // Alice change de fonction : l'import suivant porte la nouvelle valeur.
    const report = await repository.upsertPersonnel(
      [{ ...alice!, fonction: "Chef d'atelier" }],
      write,
    );
    expect(report).toEqual({ created: 0, updated: 1, unchanged: 0 });

    // Historique : 2 versions pour cette entité, une close + une active.
    const activeRow = await prisma.personnelHistory.findFirstOrThrow({
      where: { tenantId, matricule: "EMP-001", validTo: null },
    });
    const allVersions = await prisma.personnelHistory.findMany({
      where: { tenantId, entityId: activeRow.entityId },
      orderBy: { validFrom: "asc" },
    });
    expect(allVersions).toHaveLength(2);
    expect(allVersions[0]!.validTo).not.toBeNull(); // version close
    expect(allVersions[0]!.fonction).toBe("Opératrice"); // l'historique garde l'état passé
    expect(allVersions[1]!.validTo).toBeNull();
    expect(allVersions[1]!.fonction).toBe("Chef d'atelier");
    expect(allVersions[1]!.operation).toBe("UPDATE");
  });

  it("import RISQUES_CHIMIQUES : succès complet, dates multi-formats parsées", async () => {
    const result = await useCase.execute(source, {
      mapping: RISQUES_MAPPING,
      table: { location: FIXTURE, table: "Risques" },
      sourceLabel: "import-synthetique.xlsx#Risques",
      write,
    });

    expect(result.status).toBe("success");
    expect(result.report).toEqual({ created: 3, updated: 0, unchanged: 0 });

    const produits = await repository.findCurrentRisquesChimiques(tenantId);
    const toluene = produits.find((p) => p.designation === "Toluène-Test");
    // "15/03/2023" (FR) et "31/12/2023" (FR) parsés correctement.
    expect(toluene?.dateEvaluation?.toISOString().slice(0, 10)).toBe("2023-03-15");
    expect(toluene?.dateRetrait?.toISOString().slice(0, 10)).toBe("2023-12-31");
  });

  it("import DEGRE_EXPOSITION : les clés convergent avec les produits (rapprochement normalisé)", async () => {
    const result = await useCase.execute(source, {
      mapping: DEGRES_MAPPING,
      table: { location: FIXTURE, table: "Degres" },
      sourceLabel: "import-synthetique.xlsx#Degres",
      write,
    });

    expect(result.status).toBe("success");
    expect(result.report.created).toBe(4);

    // « ACÉTONE   TECHNIQUE » (degrés) doit se rapprocher de
    // « Acétone Technique » (risques) une fois normalisé.
    const degres = await repository.findCurrentDegresExposition(tenantId);
    const acetoneDegre = degres.find((d) => d.matricule === "EMP-001" && d.degreExposition === "Modéré");
    expect(acetoneDegre).toBeDefined();
    expect(acetoneDegre!.naturalKey).toBe("m:emp-001|atelier-a|acetone technique");

    const produits = await repository.findCurrentRisquesChimiques(tenantId);
    const acetoneProduit = produits.find((p) => p.naturalKey === "acetone technique|atelier-a");
    expect(acetoneProduit).toBeDefined();
  });

  it("mapping faux (colonne inexistante) : échec global, RIEN n'est écrit", async () => {
    const before = await prisma.personnelHistory.count({ where: { tenantId } });

    const result = await useCase.execute(source, {
      mapping: {
        listType: "PERSONNEL",
        columns: { ...PERSONNEL_MAPPING.columns, nom: "Colonne Inexistante" },
      },
      table: { location: FIXTURE, table: "Personnel" },
      sourceLabel: "import-synthetique.xlsx#Personnel (mauvais mapping)",
      write,
    });

    expect(result.status).toBe("failed");
    expect(result.anomalies.some((a) => a.code === "mapped_column_absent")).toBe(true);

    const after = await prisma.personnelHistory.count({ where: { tenantId } });
    expect(after).toBe(before); // aucune écriture
  });

  it("fichier introuvable : échec journalisé proprement", async () => {
    const result = await useCase.execute(source, {
      mapping: PERSONNEL_MAPPING,
      table: { location: path.join(import.meta.dirname, "nexiste-pas.xlsx") },
      sourceLabel: "nexiste-pas.xlsx",
      write,
    });
    expect(result.status).toBe("failed");
    const run = await prisma.importRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.status).toBe("FAILED");
  });
});
