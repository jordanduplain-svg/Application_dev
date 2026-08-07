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
 * Intégration du moteur de flux (HTTP) : déclenchement manuel d'un flow par un
 * Admin → réimport effectif depuis une source Excel, données visibles au
 * dashboard, run journalisé. + RBAC (collaborateur interdit).
 */

process.env.DATABASE_URL ??=
  "postgresql://cmr:cmr_dev_password@localhost:5435/cmr_tracker?schema=public";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "import-synthetique.xlsx");

describe("moteur de flux (déclenchement manuel)", () => {
  const prisma = new PrismaClient();
  const clock = new SystemClock();
  const repository = new PrismaListRepository(prisma, clock);
  const tenantId = `it-flow-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const password = "test-password-123!";
  let flowId = "";

  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;

    // Une source Excel (personnel) + un flow, dans le tenant de test.
    await prisma.importSource.create({
      data: {
        tenantId,
        name: "Fichier Personnel",
        listType: "PERSONNEL",
        connectorType: "excel",
        config: { location: FIXTURE, sheet: "Personnel" },
        mapping: {
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
        enabled: true,
      },
    });
    const flow = await prisma.flow.create({
      data: { tenantId, name: "Réimport test", cronExpression: "0 2 * * *", enabled: true },
    });
    flowId = flow.id;

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
      uploadsDir: "./var/uploads-test",
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.personnelHistory.deleteMany({ where: { tenantId } });
    await prisma.auditEvent.deleteMany({ where: { tenantId } });
    await prisma.importSource.deleteMany({ where: { tenantId } });
    await prisma.flow.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  const login = async (email: string): Promise<string> => {
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
    return (res.json() as { token: string }).token;
  };

  it("ADMIN déclenche le flow → réimport effectif + run journalisé", async () => {
    const token = await login("admin@test.local");

    // Avant : aucune donnée personnel pour ce tenant.
    const before = await repository.findCurrentPersonnel(tenantId);
    expect(before).toHaveLength(0);

    const res = await app.inject({
      method: "POST",
      url: `/api/flows/${flowId}/run`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const summary = res.json() as { status: string; sources: { created: number }[] };
    // 4 personnes valides dans la fixture (2 lignes rejetées) → partial.
    expect(summary.status).toBe("partial");
    expect(summary.sources[0]!.created).toBe(4);

    // Après : les données sont en base, visibles au dashboard.
    const after = await repository.findCurrentPersonnel(tenantId);
    expect(after).toHaveLength(4);

    // L'état du flow est mis à jour.
    const flow = await prisma.flow.findUniqueOrThrow({ where: { id: flowId } });
    expect(flow.lastRunStatus).toBe("partial");
    expect(flow.lastRunAt).not.toBeNull();

    // Le déclenchement manuel est audité.
    const audited = await prisma.auditEvent.findFirst({
      where: { tenantId, action: "flow_run_manual" },
    });
    expect(audited).not.toBeNull();
  });

  it("ré-exécution : aucune création (données déjà à jour)", async () => {
    const token = await login("admin@test.local");
    const res = await app.inject({
      method: "POST",
      url: `/api/flows/${flowId}/run`,
      headers: { authorization: `Bearer ${token}` },
    });
    const summary = res.json() as { sources: { created: number; unchanged: number }[] };
    expect(summary.sources[0]!.created).toBe(0);
    expect(summary.sources[0]!.unchanged).toBe(4);
  });

  it("COLLABORATEUR ne peut pas déclencher un flow (403)", async () => {
    const token = await login("alice@test.local");
    const res = await app.inject({
      method: "POST",
      url: `/api/flows/${flowId}/run`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("ADMIN voit la liste des flows avec le statut du dernier passage", async () => {
    const token = await login("admin@test.local");
    const res = await app.inject({
      method: "GET",
      url: "/api/flows",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const flows = res.json() as { id: string; lastRunStatus: string | null }[];
    const mine = flows.find((f) => f.id === flowId);
    expect(mine?.lastRunStatus).toBe("partial");
  });

  it("COLLABORATEUR ne voit pas la liste des flows (403)", async () => {
    const token = await login("alice@test.local");
    const res = await app.inject({
      method: "GET",
      url: "/api/flows",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
