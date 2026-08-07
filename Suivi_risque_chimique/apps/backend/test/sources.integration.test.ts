import { copyFile, mkdir, rm } from "node:fs/promises";
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
import { SystemClock } from "../src/infrastructure/clock/SystemClock.js";
import { LocalAuthProvider } from "../src/infrastructure/auth/LocalAuthProvider.js";
import { PrismaAuditLogger } from "../src/infrastructure/persistence/PrismaAuditLogger.js";
import { PrismaFlowRepository } from "../src/infrastructure/persistence/PrismaFlowRepository.js";
import { PrismaImportJournal } from "../src/infrastructure/persistence/PrismaImportJournal.js";
import { PrismaListRepository } from "../src/infrastructure/persistence/PrismaListRepository.js";
import { PrismaUserRepository } from "../src/infrastructure/persistence/PrismaUserRepository.js";
import { PdfRenderer } from "../src/infrastructure/rendering/PdfRenderer.js";
import { XlsxRenderer } from "../src/infrastructure/rendering/XlsxRenderer.js";
import { buildApp } from "../src/interface/http/buildApp.js";

/**
 * Intégration de l'espace « Administration des données » (HTTP) :
 * schéma → aperçu → dry-run → création/liste/suppression, RBAC ADMIN/HSE, et
 * garde-fou anti path-traversal sur le jeton de fichier.
 */

process.env.DATABASE_URL ??=
  "postgresql://cmr:cmr_dev_password@localhost:5435/cmr_tracker?schema=public";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "import-synthetique.xlsx");

const PERSONNEL_COLUMNS = {
  matricule: "Matricule",
  nom: "Nom de famille",
  prenom: "Prénom",
  code_secteur: "Code Atelier",
  date_debut_secteur: "Entrée secteur",
};

describe("administration des sources (HTTP)", () => {
  const prisma = new PrismaClient();
  const clock = new SystemClock();
  const repository = new PrismaListRepository(prisma, clock);
  const tenantId = `it-src-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uploadsDir = path.join(import.meta.dirname, `.uploads-${tenantId}`);
  const fileToken = "fixture.xlsx";
  const password = "test-password-123!";

  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    await mkdir(uploadsDir, { recursive: true });
    await copyFile(FIXTURE, path.join(uploadsDir, fileToken));

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.user.create({
      data: { tenantId, email: "admin@test.local", displayName: "Admin", role: "ADMIN", passwordHash },
    });
    await prisma.user.create({
      data: {
        tenantId,
        email: "alice@test.local",
        displayName: "Alice",
        role: "COLLABORATEUR",
        matricule: "EMP-001",
        passwordHash,
      },
    });

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
      uploadsDir,
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.auditEvent.deleteMany({ where: { tenantId } });
    await prisma.importSource.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
    await rm(uploadsDir, { recursive: true, force: true });
  });

  const login = async (email: string): Promise<string> => {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
    return (res.json() as { token: string }).token;
  };
  const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

  it("ADMIN obtient le schéma (connecteurs + champs canoniques)", async () => {
    const token = await login("admin@test.local");
    const res = await app.inject({ method: "GET", url: "/api/sources/schema", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      connectors: { type: string; status: string }[];
      fields: Record<string, { field: string }[]>;
    };
    expect(body.connectors.find((c) => c.type === "excel")?.status).toBe("available");
    expect(body.connectors.find((c) => c.type === "snowflake")?.status).toBe("coming_soon");
    expect(body.fields.PERSONNEL?.some((f) => f.field === "nom")).toBe(true);
  });

  it("COLLABORATEUR n'accède pas au schéma (403)", async () => {
    const token = await login("alice@test.local");
    const res = await app.inject({ method: "GET", url: "/api/sources/schema", headers: auth(token) });
    expect(res.statusCode).toBe(403);
  });

  it("aperçu : profils de colonnes du fichier", async () => {
    const token = await login("admin@test.local");
    const res = await app.inject({
      method: "POST",
      url: "/api/sources/preview",
      headers: auth(token),
      payload: { connectorType: "excel", fileToken, sheet: "Personnel" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rowCount: number; columns: { name: string }[] };
    expect(body.rowCount).toBeGreaterThan(0);
    expect(body.columns.some((c) => c.name === "Nom de famille")).toBe(true);
  });

  it("anti path-traversal : un jeton hors dossier est refusé (403)", async () => {
    const token = await login("admin@test.local");
    const res = await app.inject({
      method: "POST",
      url: "/api/sources/preview",
      headers: auth(token),
      payload: { connectorType: "excel", fileToken: "../../../../etc/passwd", sheet: "Personnel" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("dry-run : compte les lignes importables du mapping personnel", async () => {
    const token = await login("admin@test.local");
    const res = await app.inject({
      method: "POST",
      url: "/api/sources/dry-run",
      headers: auth(token),
      payload: {
        connectorType: "excel",
        fileToken,
        sheet: "Personnel",
        listType: "PERSONNEL",
        columns: PERSONNEL_COLUMNS,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { wouldImport: number; configError: boolean };
    expect(body.configError).toBe(false);
    expect(body.wouldImport).toBe(4); // 4 lignes valides dans la fixture
  });

  it("CRUD : création → liste → suppression (ADMIN)", async () => {
    const token = await login("admin@test.local");

    const created = await app.inject({
      method: "POST",
      url: "/api/sources",
      headers: auth(token),
      payload: {
        name: "Personnel (test)",
        listType: "PERSONNEL",
        connectorType: "excel",
        fileToken,
        sheet: "Personnel",
        columns: PERSONNEL_COLUMNS,
        enabled: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    const listed = await app.inject({ method: "GET", url: "/api/sources", headers: auth(token) });
    const sources = listed.json() as { id: string; name: string }[];
    expect(sources.find((s) => s.id === id)?.name).toBe("Personnel (test)");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/sources/${id}`,
      headers: auth(token),
    });
    expect(removed.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/api/sources", headers: auth(token) });
    expect((after.json() as unknown[]).every((s) => (s as { id: string }).id !== id)).toBe(true);
  });

  it("COLLABORATEUR ne peut pas créer de source (403)", async () => {
    const token = await login("alice@test.local");
    const res = await app.inject({
      method: "POST",
      url: "/api/sources",
      headers: auth(token),
      payload: {
        name: "Tentative",
        listType: "PERSONNEL",
        connectorType: "excel",
        fileToken,
        sheet: "Personnel",
        columns: PERSONNEL_COLUMNS,
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
