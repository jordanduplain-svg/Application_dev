import path from "node:path";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BuildDashboardForUserUseCase } from "../src/application/dashboard/BuildDashboardForUserUseCase.js";
import { GenerateExportUseCase } from "../src/application/exports/GenerateExportUseCase.js";
import { ImportListUseCase } from "../src/application/import/ImportListUseCase.js";
import { AnalyticsUseCase } from "../src/application/analytics/AnalyticsUseCase.js";
import { ConformityUseCase } from "../src/application/conformity/ConformityUseCase.js";
import { ListDeparturesUseCase } from "../src/application/conformity/ListDeparturesUseCase.js";
import { UserAdminUseCase } from "../src/application/users/UserAdminUseCase.js";
import { PrismaTransmissionRepository } from "../src/infrastructure/persistence/PrismaTransmissionRepository.js";
import { RunFlowUseCase } from "../src/application/flows/RunFlowUseCase.js";
import { DryRunMappingUseCase } from "../src/application/sources/DryRunMappingUseCase.js";
import { PreviewSourceUseCase } from "../src/application/sources/PreviewSourceUseCase.js";
import { ExcelConnectorFactory } from "../src/infrastructure/connectors/ExcelConnectorFactory.js";
import { PrismaFlowRepository } from "../src/infrastructure/persistence/PrismaFlowRepository.js";
import type { MappingConfig } from "../src/domain/mapping/types.js";
import { ExcelDataSource } from "../src/infrastructure/connectors/excel/ExcelDataSource.js";
import { SystemClock } from "../src/infrastructure/clock/SystemClock.js";
import { LocalAuthProvider } from "../src/infrastructure/auth/LocalAuthProvider.js";
import { PrismaAuditLogger } from "../src/infrastructure/persistence/PrismaAuditLogger.js";
import { PrismaImportJournal } from "../src/infrastructure/persistence/PrismaImportJournal.js";
import { PrismaListRepository } from "../src/infrastructure/persistence/PrismaListRepository.js";
import { PrismaUserRepository } from "../src/infrastructure/persistence/PrismaUserRepository.js";
import { PdfRenderer } from "../src/infrastructure/rendering/PdfRenderer.js";
import { XlsxRenderer } from "../src/infrastructure/rendering/XlsxRenderer.js";
import { buildApp } from "../src/interface/http/buildApp.js";

/**
 * Intégration export (HTTP) : autorisations par rôle, formats, et — crucial —
 * le k-anonymat dans la sortie CSE (aucune fuite nominative).
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
        mention_danger: "Danger",
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

describe("exports réglementaires (HTTP, RBAC + k-anonymat)", () => {
  const prisma = new PrismaClient();
  const clock = new SystemClock();
  const repository = new PrismaListRepository(prisma, clock);
  const tenantId = `it-exp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const password = "test-password-123!";

  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const importer = new ImportListUseCase(repository, new PrismaImportJournal(prisma), clock);
    for (const { sheet, mapping } of SHEETS) {
      await importer.execute(new ExcelDataSource(), {
        mapping,
        table: { location: FIXTURE, table: sheet },
        sourceLabel: `export-fixture#${sheet}`,
        write: { tenantId, recordedBy: "integration-test" },
      });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const make = (email: string, role: string, matricule?: string) =>
      prisma.user.create({
        data: {
          tenantId,
          email,
          displayName: role,
          role: role as never,
          passwordHash,
          ...(matricule !== undefined ? { matricule } : {}),
        },
      });
    await make("hse@test.local", "HSE");
    await make("rh@test.local", "RH");
    await make("alice@test.local", "COLLABORATEUR", "EMP-001");

    const flowRepo = new PrismaFlowRepository(prisma);
    const importLocal = new ImportListUseCase(repository, new PrismaImportJournal(prisma), clock);
    const testVault = {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    app = await buildApp({
      authProvider: new LocalAuthProvider(prisma, clock, { jwtSecret: "x".repeat(48) }),
      dashboard: new BuildDashboardForUserUseCase(repository, clock),
      exporter: new GenerateExportUseCase(
        repository,
        new PrismaAuditLogger(prisma),
        clock,
        [new PdfRenderer(), new XlsxRenderer()],
        5,
      ),
      flows: flowRepo,
      runFlow: new RunFlowUseCase(flowRepo, new ExcelConnectorFactory(), importLocal, clock, testVault),
      previewSource: new PreviewSourceUseCase(new ExcelConnectorFactory()),
      dryRun: new DryRunMappingUseCase(new ExcelConnectorFactory()),
      vault: testVault,
      audit: new PrismaAuditLogger(prisma),
      importJournal: new PrismaImportJournal(prisma),
      users: new UserAdminUseCase(new PrismaUserRepository(prisma), new PrismaAuditLogger(prisma), clock),
      departures: new ListDeparturesUseCase(repository, clock),
      conformity: new ConformityUseCase(repository, new PrismaTransmissionRepository(prisma), clock),
      analytics: new AnalyticsUseCase(repository, clock),
      transmissions: new PrismaTransmissionRepository(prisma),
      clock,
      databaseUrl: process.env.DATABASE_URL ?? "",
      migrationsDir: path.resolve(process.cwd(), "prisma", "migrations"),
      retentionYears: 40,
      frontendOrigin: "http://localhost:5173",
      uploadsDir: "./var/uploads-test",
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.personnelHistory.deleteMany({ where: { tenantId } });
    await prisma.risqueChimiqueHistory.deleteMany({ where: { tenantId } });
    await prisma.degreExpositionHistory.deleteMany({ where: { tenantId } });
    await prisma.auditEvent.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  const login = async (email: string): Promise<string> => {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
    return (res.json() as { token: string }).token;
  };

  it("HSE exporte le nominatif SPST en PDF (pièce jointe, binaire PDF)", async () => {
    const token = await login("hse@test.local");
    const res = await app.inject({
      method: "GET",
      url: "/api/export/spst_nominative?format=pdf",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(".pdf");
    // Signature d'un fichier PDF.
    expect(res.rawPayload.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("HSE exporte le nominatif en Excel (binaire xlsx)", async () => {
    const token = await login("hse@test.local");
    const res = await app.inject({
      method: "GET",
      url: "/api/export/spst_nominative?format=xlsx",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    // Signature ZIP (les .xlsx sont des archives ZIP : « PK »).
    expect(res.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("RH ne peut PAS exporter le nominatif SPST (403)", async () => {
    const token = await login("rh@test.local");
    const res = await app.inject({
      method: "GET",
      url: "/api/export/spst_nominative",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("RH PEUT exporter la liste CSE anonymisée", async () => {
    const token = await login("rh@test.local");
    const res = await app.inject({
      method: "GET",
      url: "/api/export/cse_anonymized?format=xlsx",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("export CSE anonymisé : AUCUNE donnée nominative dans le binaire xlsx", async () => {
    const token = await login("hse@test.local");
    const res = await app.inject({
      method: "GET",
      url: "/api/export/cse_anonymized?format=xlsx",
      headers: { authorization: `Bearer ${token}` },
    });
    // Les chaînes d'un .xlsx sont stockées en clair dans le ZIP (sharedStrings).
    // Les patronymes synthétiques NE doivent PAS y apparaître.
    const body = res.rawPayload.toString("latin1");
    expect(body).not.toContain("Durand-Test");
    expect(body).not.toContain("Moreau-Test");
    expect(body).not.toContain("EMP-001");
  });

  it("COLLABORATEUR exporte SA fiche, et ne peut pas exporter le SPST", async () => {
    const token = await login("alice@test.local");

    const ok = await app.inject({
      method: "GET",
      url: "/api/export/individual?format=pdf",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.subarray(0, 4).toString("latin1")).toBe("%PDF");

    const denied = await app.inject({
      method: "GET",
      url: "/api/export/spst_nominative",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("COLLABORATEUR ne peut pas exporter la fiche d'un AUTRE (matricule ignoré)", async () => {
    const token = await login("alice@test.local");
    // Alice (EMP-001) tente d'exporter EMP-002 : le matricule cible est ignoré,
    // elle n'obtient que SA fiche. On vérifie via l'audit que rowCount
    // correspond à ses propres lignes, pas à celles d'un autre.
    const res = await app.inject({
      method: "GET",
      url: "/api/export/individual?format=pdf&matricule=EMP-002",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId, action: "export_individual" },
      orderBy: { at: "desc" },
    });
    // Alice a 2 expositions (Acétone + Toluène) ; EMP-002 en aurait d'autres.
    expect((audit?.detail as { rowCount: number }).rowCount).toBe(2);
  });

  it("export non authentifié : 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/export/cse_anonymized" });
    expect(res.statusCode).toBe(401);
  });
});
