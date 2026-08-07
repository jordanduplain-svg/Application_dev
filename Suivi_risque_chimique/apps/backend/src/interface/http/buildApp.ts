import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";

import type { AnalyticsUseCase } from "../../application/analytics/AnalyticsUseCase.js";
import type { ConformityUseCase } from "../../application/conformity/ConformityUseCase.js";
import type { ListDeparturesUseCase } from "../../application/conformity/ListDeparturesUseCase.js";
import type { BuildDashboardForUserUseCase } from "../../application/dashboard/BuildDashboardForUserUseCase.js";
import type { GenerateExportUseCase } from "../../application/exports/GenerateExportUseCase.js";
import type { RunFlowUseCase } from "../../application/flows/RunFlowUseCase.js";
import type { DryRunMappingUseCase } from "../../application/sources/DryRunMappingUseCase.js";
import type { PreviewSourceUseCase } from "../../application/sources/PreviewSourceUseCase.js";
import { createLoginRateLimiter } from "./loginRateLimiter.js";
import { registerSourceRoutes } from "./sourceRoutes.js";
import type { UserAdminUseCase } from "../../application/users/UserAdminUseCase.js";
import { canManageUsers, canViewAuditLog } from "../../domain/authorization/adminPermissions.js";
import { AccessDeniedError } from "../../domain/authorization/errors.js";
import { canManageFlows } from "../../domain/authorization/flowPermissions.js";
import type { AuthenticatedUser, Role } from "../../domain/authorization/types.js";
import type { ExportType } from "../../domain/exports/types.js";
import type { FlowRepository } from "../../ports/FlowRepository.js";
import type { AuditLogger } from "../../ports/AuditLogger.js";
import { EmailAlreadyExistsError } from "../../ports/UserRepository.js";
import type { ImportJournal } from "../../ports/ImportJournal.js";
import type { SecretVault } from "../../ports/SecretVault.js";
import type { TransmissionRepository } from "../../ports/TransmissionRepository.js";
import type { AuthProvider } from "../../ports/AuthProvider.js";
import { InvalidCredentialsError, InvalidTokenError } from "../../ports/AuthProvider.js";
import type { Clock } from "../../ports/Clock.js";
import type { ExportFormat } from "../../ports/DocumentRenderer.js";
import { generateSqlBackup } from "../../infrastructure/db/sqlBackup.js";

/**
 * Façade HTTP. Les controllers sont des FILS : valider → cas d'usage →
 * répondre. Aucune logique métier ici (elle vit dans domain/), aucun accès
 * direct à Prisma (il vit derrière les ports).
 *
 * Règles transverses :
 *  - erreurs SANS détail technique ni donnée personnelle, avec un message
 *    actionnable (règle UX n°5) ;
 *  - tout accès aux données est journalisé via AuditLogger ;
 *  - le RBAC est déjà dans les cas d'usage — la façade se contente
 *    d'authentifier et de traduire AccessDeniedError en 403.
 */

/** Vue minimale du service OIDC (l'implémentation vit en infrastructure). */
interface OidcGateway {
  startUrl(state: string, nonce: string): Promise<string>;
  handleCallback(code: string, state: string): Promise<{ email: string } | null>;
}

export interface AppDependencies {
  authProvider: AuthProvider;
  /** Connexion OIDC déléguée (optionnelle ; null/absent = uniquement login local). */
  oidc?: OidcGateway | null;
  dashboard: BuildDashboardForUserUseCase;
  exporter: GenerateExportUseCase;
  flows: FlowRepository;
  runFlow: RunFlowUseCase;
  previewSource: PreviewSourceUseCase;
  dryRun: DryRunMappingUseCase;
  vault: SecretVault;
  audit: AuditLogger;
  importJournal: ImportJournal;
  users: UserAdminUseCase;
  departures: ListDeparturesUseCase;
  conformity: ConformityUseCase;
  analytics: AnalyticsUseCase;
  transmissions: TransmissionRepository;
  clock: Clock;
  /** Connexion à la base (pour la sauvegarde SQL). */
  databaseUrl: string;
  /** Dossier des migrations Prisma (rejoue le schéma dans la sauvegarde SQL). */
  migrationsDir: string;
  /** Années de conservation (purge de rétention). */
  retentionYears: number;
  frontendOrigin: string;
  /** Dossier de stockage des fichiers importés via l'UI. */
  uploadsDir: string;
  /** Dossier du frontend compilé à servir (mode packagé). Absent = API seule. */
  staticDir?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

const LoginBody = z.object({
  email: z.string().email("Adresse email invalide."),
  password: z.string().min(1, "Mot de passe requis."),
});

const RefreshBody = z.object({
  refreshToken: z.string().min(1),
});

const TransmissionBody = z.object({
  kind: z.enum(["spst_nominative"]).default("spst_nominative"),
  rowCount: z.coerce.number().int().min(0),
  note: z.string().optional(),
});
const PurgeBody = z.object({
  // Sécurité : la suppression n'a lieu que si execute=true ; sinon dry-run.
  execute: z.boolean().default(false),
});

const RoleEnum = z.enum(["ADMIN", "HSE", "RH", "MEDECINE", "MANAGER", "COLLABORATEUR"]);
// Mot de passe : 12 caractères mini (compromis usage interne / NIST). Pas de
// règle de composition imposée — la longueur prime (recommandation ANSSI/NIST).
const UserCreateBody = z.object({
  email: z.string().email("Adresse email invalide."),
  displayName: z.string().min(1, "Nom d'affichage requis."),
  role: RoleEnum,
  matricule: z.string().optional(),
  password: z.string().min(12, "Mot de passe : 12 caractères minimum."),
  isActive: z.boolean().default(true),
  managedSectors: z.array(z.string()).default([]),
});
const UserUpdateBody = z.object({
  displayName: z.string().min(1, "Nom d'affichage requis."),
  role: RoleEnum,
  matricule: z.string().optional(),
  // Optionnel à l'édition : absent = on conserve le mot de passe actuel.
  password: z.string().min(12, "Mot de passe : 12 caractères minimum.").optional(),
  isActive: z.boolean(),
  managedSectors: z.array(z.string()).default([]),
});

// Vue temporelle optionnelle : ?asOf=YYYY-MM-DD reconstitue l'état à cette date.
const DashboardQuery = z.object({
  asOf: z.coerce.date().optional(),
});

const ExportParams = z.object({
  type: z.enum(["individual", "cse_anonymized", "spst_nominative"]),
});
const ExportQuery = z.object({
  format: z.enum(["pdf", "xlsx"]).default("pdf"),
  matricule: z.string().optional(),
});

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // logger structuré branché plus tard (observabilité 16.2) — sans PII
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  // Upload de fichiers d'import (Excel/CSV). Limite de taille pour éviter le
  // déni de service par gros fichier ; un seul fichier par requête.
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  });
  // FRONTEND_ORIGIN accepte une liste séparée par des virgules (ex. en dev :
  // le Vite « officiel » sur 5173 et la preview sur 5174).
  await app.register(cors, {
    origin: deps.frontendOrigin.split(",").map((o) => o.trim()),
    credentials: false,
  });

  // --- Gestion d'erreurs centralisée : un seul endroit décide de ce qui
  // sort. Jamais de stack, jamais de message interne, jamais de PII.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof InvalidCredentialsError) {
      return reply.status(401).send({ message: "Identifiants invalides." });
    }
    if (error instanceof InvalidTokenError) {
      return reply.status(401).send({ message: "Session expirée — reconnectez-vous." });
    }
    if (error instanceof EmailAlreadyExistsError) {
      return reply.status(409).send({ message: error.message });
    }
    if (error instanceof AccessDeniedError) {
      return reply.status(403).send({
        message:
          "Votre compte n'est rattaché à aucun périmètre de données. " +
          "Contactez votre administrateur.",
      });
    }
    const maybeValidation = error as { validation?: unknown; message?: string };
    if (maybeValidation.validation) {
      return reply
        .status(400)
        .send({ message: "Requête invalide.", details: maybeValidation.message ?? "" });
    }
    // eslint-disable-next-line no-console
    console.error("[http] erreur non gérée :", error); // log serveur, pas client
    return reply.status(500).send({ message: "Erreur interne. Réessayez ou contactez le support." });
  });

  // ------------------------------------------------------------------
  // Authentification
  // ------------------------------------------------------------------

  // Anti-brute-force : plafond par IP sur le login (cf. loginRateLimiter).
  const loginLimiter = createLoginRateLimiter();

  app.post("/auth/login", { schema: { body: LoginBody } }, async (request, reply) => {
    if (loginLimiter.hit(request.ip, deps.clock.now())) {
      return reply
        .status(429)
        .send({ message: "Trop de tentatives de connexion. Réessayez dans quelques minutes." });
    }
    const { email, password } = request.body as z.infer<typeof LoginBody>;
    try {
      const result = await deps.authProvider.authenticate(email, password);
      await deps.audit.record({
        tenantId: "default", // multi-tenant : dérivé du domaine plus tard
        userId: result.user.id,
        action: "login_success",
        at: deps.clock.now(),
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        // Échec journalisé SANS identité (aucune preuve) et SANS l'email
        // saisi (PII potentielle d'un tiers).
        await deps.audit.record({
          tenantId: "default",
          userId: null,
          action: "login_failed",
          at: deps.clock.now(),
        });
      }
      throw err;
    }
  });

  // Prolongation de session : échange un refresh token contre un nouveau couple.
  app.post("/auth/refresh", { schema: { body: RefreshBody } }, async (request, reply) => {
    if (loginLimiter.hit(request.ip, deps.clock.now())) {
      return reply.status(429).send({ message: "Trop de tentatives. Réessayez dans un instant." });
    }
    const { refreshToken } = request.body as z.infer<typeof RefreshBody>;
    return reply.send(await deps.authProvider.refresh(refreshToken));
  });

  // --- Connexion déléguée OIDC (optionnelle). « start » redirige vers le
  // fournisseur ; « callback » valide le retour, retrouve le compte par email
  // (pas d'auto-provisionnement), émet nos jetons, et renvoie au frontend via un
  // fragment d'URL (#session=…) — le fragment n'est ni envoyé au serveur ni
  // journalisé.
  if (deps.oidc) {
    const oidc = deps.oidc;
    const frontend = deps.frontendOrigin.split(",")[0]?.trim() ?? "http://localhost:5173";

    app.get("/auth/oidc/start", async (_request, reply) => {
      return reply.redirect(await oidc.startUrl(randomUUID(), randomUUID()));
    });

    app.get("/auth/callback", async (request, reply) => {
      const { code, state } = request.query as { code?: string; state?: string };
      const fail = (reason: string): unknown => reply.redirect(`${frontend}/#oidc_error=${reason}`);
      if (code === undefined || state === undefined) return fail("requete_invalide");
      try {
        const verified = await oidc.handleCallback(code, state);
        if (verified === null) return fail("acces_refuse");
        const result = await deps.authProvider.issueForEmail(verified.email);
        if (result === null) return fail("compte_inconnu");
        await deps.audit.record({
          tenantId: "default",
          userId: result.user.id,
          action: "login_success",
          at: deps.clock.now(),
        });
        const session = Buffer.from(JSON.stringify(result)).toString("base64url");
        return reply.redirect(`${frontend}/#session=${session}`);
      } catch {
        return fail("auth_echec");
      }
    });
  }

  // ------------------------------------------------------------------
  // Routes protégées : guard Bearer → verify → request.user
  // ------------------------------------------------------------------

  app.register(async (api) => {
    api.addHook("preHandler", async (request: FastifyRequest) => {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) throw new InvalidTokenError();
      request.user = await deps.authProvider.verify(header.slice("Bearer ".length));
    });

    api.get("/api/me", async (request) => {
      const { id, role, matricule, managedSectors } = request.user;
      return { id, role, matricule, managedSectors };
    });

    api.get(
      "/api/dashboard",
      { schema: { querystring: DashboardQuery } },
      async (request) => {
        const { asOf } = request.query as z.infer<typeof DashboardQuery>;
        const view = await deps.dashboard.execute(request.user, asOf);
        await deps.audit.record({
          tenantId: request.user.tenantId,
          userId: request.user.id,
          action: "dashboard_view",
          detail: {
            role: request.user.role,
            columns: view.columns,
            rowCount: view.rows.length,
            ...(asOf !== undefined ? { asOf: asOf.toISOString().slice(0, 10) } : {}),
          },
          at: deps.clock.now(),
        });
        return view;
      },
    );

    // Export réglementaire. Le cas d'usage applique le RBAC d'export et
    // journalise ; la route ne fait que streamer le binaire en pièce jointe.
    api.get(
      "/api/export/:type",
      { schema: { params: ExportParams, querystring: ExportQuery } },
      async (request, reply) => {
        const { type } = request.params as z.infer<typeof ExportParams>;
        const { format, matricule } = request.query as z.infer<typeof ExportQuery>;
        const rendered = await deps.exporter.execute({
          user: request.user,
          type: type as ExportType,
          format: format as ExportFormat,
          ...(matricule !== undefined ? { targetMatricule: matricule } : {}),
        });
        return reply
          .header("Content-Type", rendered.contentType)
          .header("Content-Disposition", `attachment; filename="${rendered.filename}"`)
          .send(rendered.buffer);
      },
    );

    // --- Moteur de flux (Admin / HSE). Vue de statut + déclenchement manuel.
    api.get("/api/flows", async (request) => {
      if (!canManageFlows(request.user.role)) throw new AccessDeniedError("flows_role");
      const flows = await deps.flows.findFlowsByTenant(request.user.tenantId);
      return flows.map((f) => ({
        id: f.id,
        name: f.name,
        cronExpression: f.cronExpression,
        enabled: f.enabled,
        lastRunAt: f.lastRunAt ?? null,
        lastRunStatus: f.lastRunStatus ?? null,
      }));
    });

    api.post(
      "/api/flows/:id/run",
      { schema: { params: z.object({ id: z.string().uuid() }) } },
      async (request) => {
        if (!canManageFlows(request.user.role)) throw new AccessDeniedError("flows_role");
        const { id } = request.params as { id: string };
        const flow = await deps.flows.findFlow(id);
        // Un flow d'un autre tenant est traité comme inexistant (isolation).
        if (flow === null || flow.tenantId !== request.user.tenantId) {
          throw new AccessDeniedError("flow_introuvable");
        }
        const summary = await deps.runFlow.execute(flow);
        await deps.audit.record({
          tenantId: request.user.tenantId,
          userId: request.user.id,
          action: "flow_run_manual",
          detail: { flowId: flow.id, status: summary.status, sources: summary.sources.length },
          at: deps.clock.now(),
        });
        return summary;
      },
    );

    // --- Journal des imports (Admin / HSE) : « mon import est-il passé, et
    // qu'est-ce qui a été rejeté ? ». Lecture seule.
    api.get("/api/imports", async (request) => {
      if (!canManageFlows(request.user.role)) throw new AccessDeniedError("imports_role");
      return deps.importJournal.listRuns(request.user.tenantId);
    });

    // --- Journal d'accès (Admin uniquement) : qui a consulté/exporté quoi.
    // Le journal est lui-même sensible → réservé à l'ADMIN.
    api.get("/api/audit", async (request) => {
      if (!canViewAuditLog(request.user.role)) throw new AccessDeniedError("audit_role");
      return deps.audit.list(request.user.tenantId);
    });

    // --- Travailleurs partis → rappel de remise d'attestation (HSE / Médecine
    // / Admin, qui peuvent éditer une attestation individuelle).
    api.get("/api/departures", async (request) => {
      const { role } = request.user;
      if (role !== "ADMIN" && role !== "HSE" && role !== "MEDECINE") {
        throw new AccessDeniedError("departures_role");
      }
      return deps.departures.execute(request.user.tenantId);
    });

    // --- Sauvegarde complète de la base (Admin) : schéma + données en SQL
    // portable (sans dépendre du binaire pg_dump, absent sur certaines
    // plateformes — cf. infrastructure/db/sqlBackup.ts). La RESTAURATION
    // reste une opération manuelle volontaire (psql), trop sensible pour un
    // bouton.
    api.get("/api/admin/backup", async (request, reply) => {
      if (request.user.role !== "ADMIN") throw new AccessDeniedError("backup_role");
      const stamp = deps.clock.now().toISOString().slice(0, 10);
      const sql = await generateSqlBackup(deps.databaseUrl, deps.migrationsDir);
      await deps.audit.record({
        tenantId: request.user.tenantId,
        userId: request.user.id,
        action: "backup_download",
        at: deps.clock.now(),
      });
      return reply
        .header("Content-Type", "application/sql")
        .header("Content-Disposition", `attachment; filename="cmr-backup-${stamp}.sql"`)
        .send(sql);
    });

    // --- Conformité : synthèse « êtes-vous à jour ? » (HSE / Admin).
    api.get("/api/conformity", async (request) => {
      const { role } = request.user;
      if (role !== "ADMIN" && role !== "HSE") throw new AccessDeniedError("conformity_role");
      return deps.conformity.getSummary(request.user.tenantId);
    });

    // --- Analytique (vue data analyst) : modèle + agrégations (HSE / Médecine
    // / Admin — données chimiques, non nominatives).
    api.get("/api/analytics", async (request) => {
      const { role } = request.user;
      if (role !== "ADMIN" && role !== "HSE" && role !== "MEDECINE") {
        throw new AccessDeniedError("analytics_role");
      }
      return deps.analytics.getOverview(request.user.tenantId);
    });

    // --- Qualité des données : anomalies de jointure centralisées (HSE / Admin).
    api.get("/api/data-quality", async (request) => {
      const { role } = request.user;
      if (role !== "ADMIN" && role !== "HSE") throw new AccessDeniedError("data_quality_role");
      return deps.conformity.getDataQuality(request.user.tenantId);
    });

    // --- Transmissions au SPST : historique + enregistrement (HSE / Médecine / Admin).
    const canTransmit = (role: Role): boolean =>
      role === "ADMIN" || role === "HSE" || role === "MEDECINE";

    api.get("/api/transmissions", async (request) => {
      if (!canTransmit(request.user.role)) throw new AccessDeniedError("transmissions_role");
      return deps.transmissions.list(request.user.tenantId);
    });

    api.post("/api/transmissions", { schema: { body: TransmissionBody } }, async (request, reply) => {
      if (!canTransmit(request.user.role)) throw new AccessDeniedError("transmissions_role");
      const b = request.body as z.infer<typeof TransmissionBody>;
      const created = await deps.transmissions.record(request.user.tenantId, {
        at: deps.clock.now(),
        userId: request.user.id,
        kind: b.kind,
        rowCount: b.rowCount,
        note: b.note ?? null,
      });
      await deps.audit.record({
        tenantId: request.user.tenantId,
        userId: request.user.id,
        action: "transmission_record",
        detail: { kind: b.kind, rowCount: b.rowCount },
        at: deps.clock.now(),
      });
      return reply.status(201).send(created);
    });

    // --- Purge de rétention (Admin). Dry-run par défaut ; execute=true supprime.
    api.post("/api/admin/purge", { schema: { body: PurgeBody } }, async (request) => {
      if (request.user.role !== "ADMIN") throw new AccessDeniedError("purge_role");
      const { execute } = request.body as z.infer<typeof PurgeBody>;
      const result = await deps.conformity.purge(
        request.user.tenantId,
        deps.retentionYears,
        !execute,
      );
      if (execute) {
        await deps.audit.record({
          tenantId: request.user.tenantId,
          userId: request.user.id,
          action: "retention_purge",
          detail: {
            cutoff: result.cutoff.toISOString().slice(0, 10),
            personnel: result.personnel,
            risques: result.risques,
            degres: result.degres,
          },
          at: deps.clock.now(),
        });
      }
      return result;
    });

    // --- Gestion des comptes et rattachements (Admin uniquement).
    const guardUsers = (role: Role): void => {
      if (!canManageUsers(role)) throw new AccessDeniedError("users_role");
    };

    api.get("/api/users", async (request) => {
      guardUsers(request.user.role);
      return deps.users.list(request.user);
    });

    api.post("/api/users", { schema: { body: UserCreateBody } }, async (request, reply) => {
      guardUsers(request.user.role);
      const b = request.body as z.infer<typeof UserCreateBody>;
      const created = await deps.users.create(request.user, {
        email: b.email,
        displayName: b.displayName,
        role: b.role,
        matricule: b.matricule ?? null,
        password: b.password,
        isActive: b.isActive,
        managedSectors: b.managedSectors,
      });
      return reply.status(201).send(created);
    });

    api.put(
      "/api/users/:id",
      { schema: { params: z.object({ id: z.string().uuid() }), body: UserUpdateBody } },
      async (request, reply) => {
        guardUsers(request.user.role);
        const { id } = request.params as { id: string };
        const b = request.body as z.infer<typeof UserUpdateBody>;
        const ok = await deps.users.update(request.user, id, {
          displayName: b.displayName,
          role: b.role,
          matricule: b.matricule ?? null,
          isActive: b.isActive,
          managedSectors: b.managedSectors,
          ...(b.password !== undefined ? { password: b.password } : {}),
        });
        if (!ok) return reply.status(404).send({ message: "Utilisateur introuvable." });
        return { id };
      },
    );

    api.delete(
      "/api/users/:id",
      { schema: { params: z.object({ id: z.string().uuid() }) } },
      async (request, reply) => {
        guardUsers(request.user.role);
        const { id } = request.params as { id: string };
        const ok = await deps.users.remove(request.user, id);
        if (!ok) return reply.status(404).send({ message: "Utilisateur introuvable." });
        return reply.status(204).send();
      },
    );

    // --- Administration des sources de données (setup : upload / aperçu /
    // mapping / dry-run / CRUD). Routes gardées ADMIN/HSE en interne.
    registerSourceRoutes(api, {
      flows: deps.flows,
      previewSource: deps.previewSource,
      dryRun: deps.dryRun,
      audit: deps.audit,
      clock: deps.clock,
      uploadsDir: deps.uploadsDir,
      vault: deps.vault,
    });
  });

  // --- Frontend compilé (mode packagé) : sert les fichiers statiques + fallback
  // SPA (toute route GET non-API renvoie index.html, pour le routage client).
  if (deps.staticDir !== undefined) {
    await app.register(fastifyStatic, { root: deps.staticDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api") && !request.url.startsWith("/auth")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ message: "Ressource introuvable." });
    });
  }

  return app;
}
