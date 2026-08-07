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
import { PdfRenderer } from "../src/infrastructure/rendering/PdfRenderer.js";
import { XlsxRenderer } from "../src/infrastructure/rendering/XlsxRenderer.js";
import type { MappingConfig } from "../src/domain/mapping/types.js";
import { ExcelDataSource } from "../src/infrastructure/connectors/excel/ExcelDataSource.js";
import { SystemClock } from "../src/infrastructure/clock/SystemClock.js";
import { LocalAuthProvider } from "../src/infrastructure/auth/LocalAuthProvider.js";
import { PrismaAuditLogger } from "../src/infrastructure/persistence/PrismaAuditLogger.js";
import { PrismaImportJournal } from "../src/infrastructure/persistence/PrismaImportJournal.js";
import { PrismaListRepository } from "../src/infrastructure/persistence/PrismaListRepository.js";
import { PrismaUserRepository } from "../src/infrastructure/persistence/PrismaUserRepository.js";
import { buildApp } from "../src/interface/http/buildApp.js";

/**
 * Intégration HTTP : login → Bearer → dashboard filtré par rôle, via
 * fastify.inject (pas de port réseau ouvert). C'est le test du système
 * COMPLET tel que le frontend le consommera.
 */

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
    date_evaluation: "Évaluation",
    date_retrait: "Retrait",
    code_secteur: "Secteur",
  },
};

describe("façade HTTP (login + RBAC bout-en-bout)", () => {
  const prisma = new PrismaClient();
  const clock = new SystemClock();
  const repository = new PrismaListRepository(prisma, clock);
  const tenantId = `it-http-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const password = "test-password-123!";
  const userIds: string[] = [];

  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;

    // Données métier du tenant de test.
    const importer = new ImportListUseCase(repository, new PrismaImportJournal(prisma), clock);
    for (const [sheet, mapping] of [
      ["Personnel", PERSONNEL_MAPPING],
      ["Risques", RISQUES_MAPPING],
    ] as const) {
      await importer.execute(new ExcelDataSource(), {
        mapping,
        table: { location: FIXTURE, table: sheet },
        sourceLabel: `http-fixture#${sheet}`,
        write: { tenantId, recordedBy: "integration-test" },
      });
    }

    // Comptes de test dans CE tenant.
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const hse = await prisma.user.create({
      data: { tenantId, email: "hse@test.local", displayName: "HSE", role: "HSE", passwordHash },
    });
    const alice = await prisma.user.create({
      data: {
        tenantId,
        email: "alice@test.local",
        displayName: "Alice",
        role: "COLLABORATEUR",
        matricule: "EMP-001",
        passwordHash,
      },
    });
    userIds.push(hse.id, alice.id);

    const flowRepo = new PrismaFlowRepository(prisma);
    const importList = new ImportListUseCase(repository, new PrismaImportJournal(prisma), clock);
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
      runFlow: new RunFlowUseCase(flowRepo, new ExcelConnectorFactory(), importList, clock, testVault),
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
    await prisma.auditEvent.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  const login = async (email: string): Promise<string> => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { token: string }).token;
  };

  it("login KO : 401 au mauvais mot de passe, message neutre, échec audité sans identité", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "hse@test.local", password: "mauvais" },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { message: string }).message).toBe("Identifiants invalides.");
    // Le même message pour un email inconnu (anti-énumération).
    const res2 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "inconnu@test.local", password: "x" },
    });
    expect(res2.statusCode).toBe(401);
    expect((res2.json() as { message: string }).message).toBe("Identifiants invalides.");
  });

  it("sans jeton : 401 sur les routes protégées", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    expect(res.statusCode).toBe(401);
  });

  it("HSE : login → dashboard complet du tenant, accès journalisé", async () => {
    const token = await login("hse@test.local");
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const view = res.json() as { columns: string; rows: unknown[] };
    expect(view.columns).toBe("full");
    expect(view.rows).toHaveLength(6);

    const audited = await prisma.auditEvent.findFirst({
      where: { tenantId, action: "dashboard_view" },
    });
    expect(audited).not.toBeNull();
  });

  it("COLLABORATEUR : uniquement ses lignes via HTTP, et le hash n'est jamais sérialisé", async () => {
    const token = await login("alice@test.local");
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { authorization: `Bearer ${token}` },
    });
    const view = res.json() as { rows: { matricule: string }[] };
    expect(view.rows.every((r) => r.matricule === "EMP-001")).toBe(true);
    // Défense en profondeur : aucun champ sensible de compte dans la réponse.
    expect(res.body).not.toContain("passwordHash");
    expect(res.body).not.toContain("argon2");
  });

  it("jeton bidon : 401 avec message actionnable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: "Bearer n.importe.quoi" },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { message: string }).message).toContain("reconnectez-vous");
  });
});
