/**
 * Composition root — point d'entrée unique de câblage des dépendances.
 *
 * C'est ICI, et seulement ici, qu'on instancie les implémentations concrètes
 * (Prisma, connecteurs, scheduler, auth) et qu'on les injecte dans les cas
 * d'usage. Aucune autre couche ne fait de `new PrismaClient()`.
 *
 * Pour basculer un composant (ex. LocalAuthProvider → OidcAuthProvider),
 * on change UNE ligne ici.
 */

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { PrismaClient } from "@prisma/client";

import { AnalyticsUseCase } from "./application/analytics/AnalyticsUseCase.js";
import { ConformityUseCase } from "./application/conformity/ConformityUseCase.js";
import { ListDeparturesUseCase } from "./application/conformity/ListDeparturesUseCase.js";
import { BuildDashboardForUserUseCase } from "./application/dashboard/BuildDashboardForUserUseCase.js";
import { GenerateExportUseCase } from "./application/exports/GenerateExportUseCase.js";
import { ImportListUseCase } from "./application/import/ImportListUseCase.js";
import { UserAdminUseCase } from "./application/users/UserAdminUseCase.js";
import { RunFlowUseCase } from "./application/flows/RunFlowUseCase.js";
import { DryRunMappingUseCase } from "./application/sources/DryRunMappingUseCase.js";
import { PreviewSourceUseCase } from "./application/sources/PreviewSourceUseCase.js";
import { loadEnv } from "./config/env.js";
import { LocalAuthProvider } from "./infrastructure/auth/LocalAuthProvider.js";
import { OidcService } from "./infrastructure/auth/OidcService.js";
import { SystemClock } from "./infrastructure/clock/SystemClock.js";
import { ExcelConnectorFactory } from "./infrastructure/connectors/ExcelConnectorFactory.js";
import { PrismaAuditLogger } from "./infrastructure/persistence/PrismaAuditLogger.js";
import { PrismaFlowRepository } from "./infrastructure/persistence/PrismaFlowRepository.js";
import { PrismaImportJournal } from "./infrastructure/persistence/PrismaImportJournal.js";
import { PrismaListRepository } from "./infrastructure/persistence/PrismaListRepository.js";
import { PrismaTransmissionRepository } from "./infrastructure/persistence/PrismaTransmissionRepository.js";
import { PrismaUserRepository } from "./infrastructure/persistence/PrismaUserRepository.js";
import { PdfRenderer } from "./infrastructure/rendering/PdfRenderer.js";
import { XlsxRenderer } from "./infrastructure/rendering/XlsxRenderer.js";
import { startEmbeddedPostgres, type EmbeddedPostgresHandle } from "./infrastructure/db/embeddedPostgres.js";
import { createSecretCipher } from "./infrastructure/crypto/secretCipher.js";
import { PrismaSecretVault } from "./infrastructure/persistence/PrismaSecretVault.js";
import type { SecretVault } from "./ports/SecretVault.js";
import { NodeCronScheduler } from "./infrastructure/scheduler/NodeCronScheduler.js";
import { buildApp } from "./interface/http/buildApp.js";

/**
 * Applique les migrations Prisma en attente (équivalent `prisma migrate
 * deploy`). En mode embarqué, l'app est responsable du schéma : on l'aligne
 * AVANT de servir. On invoque la CLI Prisma via Node (pas de dépendance au PATH
 * ni à pnpm).
 */
async function applyMigrations(databaseUrl: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const prismaCli = path.join(path.dirname(require.resolve("prisma/package.json")), "build/index.js");
  await promisify(execFile)(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

async function main(): Promise<void> {
  const env = loadEnv();

  // Mode tout-en-un : DB_EMBEDDED=true OU option CLI `--embedded`. L'app démarre
  // son propre PostgreSQL puis migre, avant toute connexion Prisma.
  const useEmbedded = env.DB_EMBEDDED || process.argv.includes("--embedded");
  let embedded: EmbeddedPostgresHandle | null = null;
  if (useEmbedded) {
    // eslint-disable-next-line no-console
    console.log("[boot] PostgreSQL embarqué : démarrage…");
    embedded = await startEmbeddedPostgres(env.DATABASE_URL);
    // eslint-disable-next-line no-console
    console.log("[boot] application des migrations…");
    await applyMigrations(env.DATABASE_URL);
  }

  // --- Adaptateurs (infrastructure) ---
  const prisma = new PrismaClient();
  const clock = new SystemClock();
  const repository = new PrismaListRepository(prisma, clock);
  const audit = new PrismaAuditLogger(prisma);
  const authProvider = new LocalAuthProvider(prisma, clock, {
    jwtSecret: env.JWT_SECRET,
  });

  // Connexion déléguée OIDC : active uniquement si les 4 variables sont fournies.
  const oidc =
    env.OIDC_ISSUER_URL !== undefined &&
    env.OIDC_CLIENT_ID !== undefined &&
    env.OIDC_CLIENT_SECRET !== undefined &&
    env.OIDC_REDIRECT_URI !== undefined
      ? new OidcService({
          issuerUrl: env.OIDC_ISSUER_URL,
          clientId: env.OIDC_CLIENT_ID,
          clientSecret: env.OIDC_CLIENT_SECRET,
          redirectUri: env.OIDC_REDIRECT_URI,
        })
      : null;

  // Coffre à secrets : actif si FIELD_ENCRYPTION_KEY est fournie ; sinon une
  // implémentation « indisponible » qui laisse passer les connecteurs fichier
  // (get → null) mais refuse de stocker un secret (connecteurs base de données).
  const vault: SecretVault =
    env.FIELD_ENCRYPTION_KEY !== undefined
      ? new PrismaSecretVault(prisma, createSecretCipher(env.FIELD_ENCRYPTION_KEY))
      : {
          put() {
            throw new Error(
              "FIELD_ENCRYPTION_KEY requise pour les connecteurs base de données (coffre à secrets).",
            );
          },
          get: () => Promise.resolve(null),
          remove: () => Promise.resolve(),
        };

  // --- Moteur de flux (infrastructure) ---
  const flowRepository = new PrismaFlowRepository(prisma);
  const sharepointCfg =
    env.SHAREPOINT_TENANT_ID !== undefined &&
    env.SHAREPOINT_CLIENT_ID !== undefined &&
    env.SHAREPOINT_CLIENT_SECRET !== undefined
      ? {
          creds: {
            tenantId: env.SHAREPOINT_TENANT_ID,
            clientId: env.SHAREPOINT_CLIENT_ID,
            clientSecret: env.SHAREPOINT_CLIENT_SECRET,
          },
          tempDir: env.UPLOADS_DIR,
        }
      : undefined;
  const connectorFactory = new ExcelConnectorFactory(
    sharepointCfg !== undefined ? { sharepoint: sharepointCfg } : {},
  );
  const scheduler = new NodeCronScheduler();

  // --- Cas d'usage (application) ---
  const dashboard = new BuildDashboardForUserUseCase(repository, clock);
  const exporter = new GenerateExportUseCase(
    repository,
    audit,
    clock,
    [new PdfRenderer(), new XlsxRenderer()],
    env.K_ANONYMITY_THRESHOLD,
  );
  const importJournal = new PrismaImportJournal(prisma);
  const importList = new ImportListUseCase(repository, importJournal, clock);
  const runFlow = new RunFlowUseCase(flowRepository, connectorFactory, importList, clock, vault);
  const previewSource = new PreviewSourceUseCase(connectorFactory);
  const dryRun = new DryRunMappingUseCase(connectorFactory);
  const users = new UserAdminUseCase(new PrismaUserRepository(prisma), audit, clock);
  const departures = new ListDeparturesUseCase(repository, clock);
  const transmissions = new PrismaTransmissionRepository(prisma);
  const conformity = new ConformityUseCase(repository, transmissions, clock);
  const analytics = new AnalyticsUseCase(repository, clock);

  // --- Planification des flows actifs (brief §10) ---
  // À chaque occurrence cron : on RECHARGE la définition du flow depuis la
  // base (un flow désactivé/modifié entre-temps est pris en compte) puis on
  // l'exécute. Le scheduler isole les erreurs : un import raté ne tue pas le
  // serveur, l'app reste opérationnelle sur les données antérieures.
  for (const flow of await flowRepository.findEnabledFlows()) {
    scheduler.schedule({
      id: flow.id,
      cronExpression: flow.cronExpression,
      handler: async () => {
        const fresh = await flowRepository.findFlow(flow.id);
        if (fresh !== null && fresh.enabled) await runFlow.execute(fresh);
      },
    });
  }
  scheduler.start();

  // --- Façade HTTP ---
  const app = await buildApp({
    authProvider,
    oidc,
    dashboard,
    exporter,
    flows: flowRepository,
    runFlow,
    previewSource,
    dryRun,
    vault,
    audit,
    importJournal,
    users,
    departures,
    conformity,
    analytics,
    transmissions,
    clock,
    databaseUrl: env.DATABASE_URL,
    migrationsDir: path.resolve(process.cwd(), "prisma", "migrations"),
    retentionYears: env.DATA_RETENTION_YEARS,
    frontendOrigin: env.FRONTEND_ORIGIN,
    uploadsDir: env.UPLOADS_DIR,
    // Sert le frontend compilé s'il existe (mode packagé : un seul process).
    ...(existsSync(path.resolve(process.cwd(), "..", "frontend", "dist"))
      ? { staticDir: path.resolve(process.cwd(), "..", "frontend", "dist") }
      : {}),
  });

  await app.listen({ port: env.BACKEND_PORT, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`[boot] backend prêt sur :${env.BACKEND_PORT} (env=${env.NODE_ENV}, auth=${env.AUTH_PROVIDER})`);

  // Arrêt propre : on arrête le scheduler, on ferme le serveur, puis la base.
  const shutdown = async (): Promise<void> => {
    scheduler.stop();
    await app.close();
    await prisma.$disconnect();
    if (embedded !== null) await embedded.stop(); // libère le cluster embarqué
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[boot] échec démarrage :", err);
  process.exit(1);
});
