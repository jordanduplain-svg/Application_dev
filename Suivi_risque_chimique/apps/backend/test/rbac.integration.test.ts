import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BuildDashboardForUserUseCase } from "../src/application/dashboard/BuildDashboardForUserUseCase.js";
import { ImportListUseCase } from "../src/application/import/ImportListUseCase.js";
import { AccessDeniedError } from "../src/domain/authorization/errors.js";
import type { AuthenticatedUser, Role } from "../src/domain/authorization/types.js";
import type { MappingConfig } from "../src/domain/mapping/types.js";
import { ExcelDataSource } from "../src/infrastructure/connectors/excel/ExcelDataSource.js";
import { SystemClock } from "../src/infrastructure/clock/SystemClock.js";
import { PrismaImportJournal } from "../src/infrastructure/persistence/PrismaImportJournal.js";
import { PrismaListRepository } from "../src/infrastructure/persistence/PrismaListRepository.js";

/**
 * Intégration étape 5 — RBAC appliqué côté serveur, jusqu'à la requête SQL.
 *
 * Le critère central : la RÉPONSE d'un rôle ne contient RIEN hors de son
 * périmètre. On ne teste pas un masquage d'UI — on teste ce qui sort du
 * serveur.
 */

process.env.DATABASE_URL ??=
  "postgresql://cmr:cmr_dev_password@localhost:5435/cmr_tracker?schema=public";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "import-synthetique.xlsx");

const SHEETS: { sheet: string; mapping: MappingConfig }[] = [
  {
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
  {
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
  {
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
];

describe("RBAC bout-en-bout (réponses serveur filtrées)", () => {
  const prisma = new PrismaClient();
  const clock = new SystemClock();
  const repository = new PrismaListRepository(prisma, clock);
  const journal = new PrismaImportJournal(prisma);
  const importer = new ImportListUseCase(repository, journal, clock);
  const dashboard = new BuildDashboardForUserUseCase(repository, clock);
  const source = new ExcelDataSource();

  const tenantId = `it-rbac-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const makeUser = (role: Role, over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
    id: `u-${role.toLowerCase()}`,
    role,
    tenantId,
    matricule: null,
    managedSectors: [],
    ...over,
  });

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    for (const { sheet, mapping } of SHEETS) {
      await importer.execute(source, {
        mapping,
        table: { location: FIXTURE, table: sheet },
        sourceLabel: `rbac-fixture#${sheet}`,
        write: { tenantId, recordedBy: "integration-test" },
      });
    }
  });

  afterAll(async () => {
    await prisma.personnelHistory.deleteMany({ where: { tenantId } });
    await prisma.risqueChimiqueHistory.deleteMany({ where: { tenantId } });
    await prisma.degreExpositionHistory.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  it("HSE : tout le tenant, colonnes complètes (6 lignes)", async () => {
    const view = await dashboard.execute(makeUser("HSE"));
    expect(view.columns).toBe("full");
    if (view.columns !== "full") return;
    expect(view.rows).toHaveLength(6);
    expect(view.rows.some((r) => r.designation === "Toluène-Test")).toBe(true);
  });

  it("MEDECINE : nominatif complet, identique à HSE en lignes", async () => {
    const view = await dashboard.execute(makeUser("MEDECINE"));
    if (view.columns !== "full") throw new Error("vue full attendue");
    expect(view.rows).toHaveLength(6);
  });

  it("COLLABORATEUR EMP-001 : UNIQUEMENT ses 2 lignes, aucune autre personne dans la réponse", async () => {
    const view = await dashboard.execute(makeUser("COLLABORATEUR", { matricule: "EMP-001" }));
    if (view.columns !== "full") throw new Error("vue full attendue");

    expect(view.rows).toHaveLength(2); // Acétone + Toluène de l'ATELIER-A
    // Le critère RGPD : pas une seule ligne d'un autre matricule ne sort.
    expect(view.rows.every((r) => r.matricule === "EMP-001")).toBe(true);
    // Et il voit le détail complet de SES expositions (R. 4412-93-2).
    const acetone = view.rows.find((r) => r.designation === "Acétone Technique");
    expect(acetone?.degreExposition).toBe("Modéré");
    expect(acetone?.dureeExpositionAnnees).toBeGreaterThan(5);
  });

  it("COLLABORATEUR : matricule insensible à la casse (emp-001)", async () => {
    const view = await dashboard.execute(makeUser("COLLABORATEUR", { matricule: "emp-001" }));
    if (view.columns !== "full") throw new Error("vue full attendue");
    expect(view.rows).toHaveLength(2);
  });

  it("COLLABORATEUR sans matricule rattaché : 403, jamais « tout voir par accident »", async () => {
    await expect(dashboard.execute(makeUser("COLLABORATEUR"))).rejects.toThrow(AccessDeniedError);
  });

  it("MANAGER de l'ATELIER-B : uniquement son secteur (2 lignes), pas l'ATELIER-A", async () => {
    const view = await dashboard.execute(makeUser("MANAGER", { managedSectors: ["ATELIER-B"] }));
    if (view.columns !== "full") throw new Error("vue full attendue");
    expect(view.rows).toHaveLength(2); // Chloé + David × Dégraissant
    expect(view.rows.every((r) => r.codeSecteur === "ATELIER-B")).toBe(true);
    expect(view.rows.some((r) => r.designation === "Toluène-Test")).toBe(false);
  });

  it("MANAGER sans secteur : 403", async () => {
    await expect(dashboard.execute(makeUser("MANAGER"))).rejects.toThrow(AccessDeniedError);
  });

  it("RH : vue ADMINISTRATIVE — toutes les personnes, AUCUN champ chimique sérialisé", async () => {
    const view = await dashboard.execute(makeUser("RH"));
    expect(view.columns).toBe("administrative");
    if (view.columns !== "administrative") return;

    // Les 4 personnes importées (y compris Chloé dont le secteur n'a qu'un
    // produit, et David sans matricule).
    expect(view.rows).toHaveLength(4);

    // Le critère : pas un seul champ chimique dans les objets sérialisés.
    for (const row of view.rows) {
      const keys = Object.keys(row);
      expect(keys).not.toContain("designation");
      expect(keys).not.toContain("nCas");
      expect(keys).not.toContain("degreExposition");
      expect(keys).not.toContain("dureeExpositionAnnees");
      expect(keys).not.toContain("mentionDanger");
    }
  });

  it("ADMIN : tout + anomalies de jointure visibles (outil qualité)", async () => {
    const view = await dashboard.execute(makeUser("ADMIN"));
    if (view.columns !== "full") throw new Error("vue full attendue");
    expect(view.rows).toHaveLength(6);
    expect(Array.isArray(view.joinAnomalies)).toBe(true);
  });
});
