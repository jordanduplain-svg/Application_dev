import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ListType } from "../../domain/mapping/types.js";
import { canManageFlows } from "../../domain/authorization/flowPermissions.js";
import { AccessDeniedError } from "../../domain/authorization/errors.js";
import { canonicalFieldCatalog } from "../../domain/sources/canonicalFields.js";
import { CONNECTOR_CATALOG, isConnectorAvailable } from "../../domain/sources/connectorCatalog.js";
import type { DryRunMappingUseCase } from "../../application/sources/DryRunMappingUseCase.js";
import type { PreviewSourceUseCase } from "../../application/sources/PreviewSourceUseCase.js";
import type { AuditLogger } from "../../ports/AuditLogger.js";
import type { Clock } from "../../ports/Clock.js";
import type { TableConfig } from "../../ports/DataSource.js";
import type { FlowRepository, SourceInput } from "../../ports/FlowRepository.js";
import type { SecretVault } from "../../ports/SecretVault.js";
import {
  ListTypeSchema,
  MappingColumnsSchema,
  MappingRuleSchema,
} from "../../shared/sourceValidation.js";

/**
 * Routes de l'espace « Administration des données » (setup des sources).
 *
 * Toutes RÉSERVÉES à ADMIN/HSE (canManageFlows), vérifié côté serveur — pas
 * seulement masqué dans l'UI. Le parcours :
 *   1. uploader un fichier → on le range dans UPLOADS_DIR, on rend un jeton ;
 *   2. prévisualiser (profils de colonnes) ;
 *   3. dry-run du mapping (compteurs OK/rejetées) ;
 *   4. créer/éditer/supprimer la source.
 *
 * Garde-fou anti path-traversal : le client ne manipule qu'un JETON de fichier
 * (nom de base validé) ; le serveur seul le résout dans UPLOADS_DIR. Impossible
 * de viser /etc/passwd ou un fichier hors du dossier d'uploads.
 */

export interface SourceRouteDependencies {
  flows: FlowRepository;
  previewSource: PreviewSourceUseCase;
  dryRun: DryRunMappingUseCase;
  audit: AuditLogger;
  clock: Clock;
  uploadsDir: string;
  /** Coffre à secrets : identifiants chiffrés des connecteurs base de données. */
  vault: SecretVault;
}

/**
 * Connecteur dont la « localisation » est un SECRET fourni à l'exécution
 * (chaîne de connexion SQL, lien de partage SharePoint) plutôt qu'un fichier
 * uploadé. Englobe les familles « database » et « cloud ».
 */
function connectorUsesSecret(type: string): boolean {
  return CONNECTOR_CATALOG.some(
    (c) => c.type === type && (c.category === "database" || c.category === "cloud"),
  );
}

/** Connecteur cloud (SharePoint…) : secret = lien de partage, feuille optionnelle. */
function connectorIsCloud(type: string): boolean {
  return CONNECTOR_CATALOG.some((c) => c.type === type && c.category === "cloud");
}

/** Jeton de fichier : nom de base sûr, extension de fichier tabulaire connue. */
const FILE_TOKEN = /^[A-Za-z0-9._-]+\.(xlsx|csv)$/;

const RulesSchema = z.array(MappingRuleSchema).optional();

// `sheet` : feuille Excel POUR les fichiers, nom de table/vue POUR les bases.
// `connectionString` : secret des connecteurs base de données (jamais persisté
// en clair — déposé au coffre). `fileToken` : pour les connecteurs fichier.
const PreviewBody = z.object({
  connectorType: z.string(),
  fileToken: z.string().optional(),
  connectionString: z.string().optional(),
  sheet: z.string().optional(),
  rules: RulesSchema,
});

const DryRunBody = z.object({
  connectorType: z.string(),
  fileToken: z.string().optional(),
  connectionString: z.string().optional(),
  sheet: z.string().optional(),
  listType: ListTypeSchema,
  columns: MappingColumnsSchema,
  rules: RulesSchema,
});

const SourceBody = z.object({
  name: z.string().min(1),
  listType: ListTypeSchema,
  connectorType: z.string(),
  // Optionnel à l'édition : si absent, on conserve le fichier/secret déjà rattaché.
  fileToken: z.string().optional(),
  connectionString: z.string().optional(),
  sheet: z.string().optional(),
  columns: MappingColumnsSchema,
  rules: RulesSchema,
  enabled: z.boolean().default(true),
});

/**
 * Résout un jeton de fichier en chemin absolu DANS le dossier d'uploads.
 * `path.basename` neutralise toute tentative de remontée (`../`), et le motif
 * impose une extension attendue. Lève si le jeton est malformé.
 */
function resolveUpload(uploadsDir: string, token: string): string {
  const base = path.basename(token);
  if (!FILE_TOKEN.test(base)) {
    throw new AccessDeniedError("file_token_invalide");
  }
  return path.resolve(uploadsDir, base);
}

/**
 * Construit la TableConfig de prévisualisation/dry-run selon la famille de
 * connecteur. Renvoie null si les entrées requises manquent (→ 400 par la route).
 *  - base de données : secret (chaîne de connexion, transitoire) + table (sheet) ;
 *  - fichier : jeton de fichier résolu dans UPLOADS_DIR.
 */
function resolveTableForPreview(
  deps: SourceRouteDependencies,
  body: {
    connectorType: string;
    fileToken?: string | undefined;
    connectionString?: string | undefined;
    sheet?: string | undefined;
  },
): TableConfig | null {
  if (connectorUsesSecret(body.connectorType)) {
    if (body.connectionString === undefined || body.connectionString === "") return null;
    const cloud = connectorIsCloud(body.connectorType);
    // SQL : table obligatoire. Cloud (SharePoint) : feuille optionnelle (CSV).
    if (!cloud && (body.sheet === undefined || body.sheet === "")) return null;
    return {
      location: cloud ? "sharepoint" : (body.sheet as string),
      ...(body.sheet !== undefined && body.sheet !== "" ? { table: body.sheet } : {}),
      secret: body.connectionString,
    };
  }
  if (body.fileToken === undefined) return null;
  const location = resolveUpload(deps.uploadsDir, body.fileToken);
  return { location, ...(body.sheet !== undefined ? { table: body.sheet } : {}) };
}

function tableInputError(connectorType: string): string {
  if (connectorIsCloud(connectorType)) return "Lien de partage SharePoint requis.";
  if (connectorUsesSecret(connectorType)) return "Chaîne de connexion et nom de table/vue requis.";
  return "Un fichier est requis.";
}

/** Connecteur réellement disponible, sinon 400 explicite. */
function assertAvailableConnector(connectorType: string): void {
  if (!isConnectorAvailable(connectorType)) {
    const err = new Error(
      `Connecteur « ${connectorType} » indisponible pour l'instant.`,
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
}

/** Construit un SourceInput à partir du corps validé + d'une localisation. */
function toSourceInput(
  body: z.infer<typeof SourceBody>,
  location: string,
): SourceInput {
  return {
    name: body.name,
    listType: body.listType as ListType,
    connectorType: body.connectorType,
    location,
    sheet: body.sheet ?? null,
    columns: body.columns,
    ...(body.rules !== undefined ? { rules: body.rules } : {}),
    enabled: body.enabled,
  };
}

export function registerSourceRoutes(api: FastifyInstance, deps: SourceRouteDependencies): void {
  // Garde commun : toutes ces routes exigent le rôle de gestion des flux.
  const guard = (role: Parameters<typeof canManageFlows>[0]): void => {
    if (!canManageFlows(role)) throw new AccessDeniedError("sources_role");
  };

  // --- Catalogue : connecteurs disponibles + champs canoniques par liste.
  // Statique (pas de données), sert à peupler le wizard.
  api.get("/api/sources/schema", async (request) => {
    guard(request.user.role);
    return { connectors: CONNECTOR_CATALOG, fields: canonicalFieldCatalog() };
  });

  // --- Liste des sources du tenant (actives et désactivées).
  api.get("/api/sources", async (request) => {
    guard(request.user.role);
    const sources = await deps.flows.listSources(request.user.tenantId);
    // On renvoie la config utile au wizard, le mapping inclus.
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      listType: s.listType,
      connectorType: s.connectorType,
      sheet: s.table,
      enabled: s.enabled,
      columns: s.mapping.columns,
      rules: s.mapping.rules ?? [],
    }));
  });

  // --- Upload d'un fichier. Le binaire est streamé sur disque (pas de mise en
  // mémoire complète) ; on renvoie un jeton opaque que les étapes suivantes
  // réutilisent.
  api.post("/api/sources/upload", async (request, reply) => {
    guard(request.user.role);
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ message: "Aucun fichier reçu." });
    }
    const ext = path.extname(file.filename).toLowerCase();
    if (ext !== ".xlsx" && ext !== ".csv") {
      return reply.status(400).send({ message: "Formats acceptés : .xlsx, .csv." });
    }
    await mkdir(deps.uploadsDir, { recursive: true });
    const token = `${randomUUID()}${ext}`;
    const dest = resolveUpload(deps.uploadsDir, token);
    await pipeline(file.file, createWriteStream(dest));
    // file.file.truncated est vrai si la limite de taille a été atteinte.
    if (file.file.truncated) {
      await unlink(dest).catch(() => undefined);
      return reply.status(413).send({ message: "Fichier trop volumineux." });
    }
    return { fileToken: token, originalName: file.filename };
  });

  // --- Prévisualisation : profils de colonnes + échantillon (lit des données).
  api.post("/api/sources/preview", { schema: { body: PreviewBody } }, async (request, reply) => {
    guard(request.user.role);
    const body = request.body as z.infer<typeof PreviewBody>;
    assertAvailableConnector(body.connectorType);
    const table = resolveTableForPreview(deps, body);
    if (table === null) {
      return reply.status(400).send({ message: tableInputError(body.connectorType) });
    }
    const result = await deps.previewSource.execute({
      connectorType: body.connectorType,
      table,
      ...(body.rules !== undefined ? { rules: body.rules } : {}),
    });
    await deps.audit.record({
      tenantId: request.user.tenantId,
      userId: request.user.id,
      action: "source_preview",
      detail: { connectorType: body.connectorType, rowCount: result.rowCount },
      at: deps.clock.now(),
    });
    return result;
  });

  // --- Dry-run : compteurs importables/rejetées + anomalies (sans écriture).
  api.post("/api/sources/dry-run", { schema: { body: DryRunBody } }, async (request, reply) => {
    guard(request.user.role);
    const body = request.body as z.infer<typeof DryRunBody>;
    assertAvailableConnector(body.connectorType);
    const table = resolveTableForPreview(deps, body);
    if (table === null) {
      return reply.status(400).send({ message: tableInputError(body.connectorType) });
    }
    const result = await deps.dryRun.execute({
      connectorType: body.connectorType,
      table,
      mapping: {
        listType: body.listType as ListType,
        columns: body.columns,
        ...(body.rules !== undefined ? { rules: body.rules } : {}),
      },
    });
    await deps.audit.record({
      tenantId: request.user.tenantId,
      userId: request.user.id,
      action: "source_dry_run",
      detail: {
        listType: body.listType,
        wouldImport: result.wouldImport,
        wouldReject: result.wouldReject,
      },
      at: deps.clock.now(),
    });
    return result;
  });

  // --- Création d'une source persistée.
  api.post("/api/sources", { schema: { body: SourceBody } }, async (request, reply) => {
    guard(request.user.role);
    const body = request.body as z.infer<typeof SourceBody>;
    assertAvailableConnector(body.connectorType);
    const db = connectorUsesSecret(body.connectorType);
    let location: string;
    if (db) {
      const cloud = connectorIsCloud(body.connectorType);
      if (
        body.connectionString === undefined ||
        body.connectionString === "" ||
        (!cloud && (body.sheet === undefined || body.sheet === ""))
      ) {
        return reply.status(400).send({ message: tableInputError(body.connectorType) });
      }
      location = cloud ? "sharepoint" : (body.sheet as string); // marqueur cloud OU nom de table
    } else {
      if (body.fileToken === undefined) {
        return reply.status(400).send({ message: "Un fichier est requis pour créer la source." });
      }
      location = resolveUpload(deps.uploadsDir, body.fileToken);
    }
    const created = await deps.flows.createSource(
      request.user.tenantId,
      toSourceInput(body, location),
    );
    // Le secret (chaîne de connexion) va au coffre, chiffré, clé = id de source.
    if (db && body.connectionString !== undefined) {
      await deps.vault.put(request.user.tenantId, created.id, body.connectionString);
    }
    await deps.audit.record({
      tenantId: request.user.tenantId,
      userId: request.user.id,
      action: "source_create",
      detail: { sourceId: created.id, name: created.name, listType: created.listType },
      at: deps.clock.now(),
    });
    return reply.status(201).send({ id: created.id });
  });

  // --- Mise à jour. Si aucun nouveau fichier (fileToken absent), on conserve
  // la localisation déjà enregistrée.
  api.put(
    "/api/sources/:id",
    { schema: { params: z.object({ id: z.string().uuid() }), body: SourceBody } },
    async (request, reply) => {
      guard(request.user.role);
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof SourceBody>;
      assertAvailableConnector(body.connectorType);

      const existing = await deps.flows.getSource(id, request.user.tenantId);
      if (existing === null) {
        return reply.status(404).send({ message: "Source introuvable." });
      }
      const db = connectorUsesSecret(body.connectorType);
      const location = db
        ? body.sheet !== undefined && body.sheet !== ""
          ? body.sheet
          : existing.location
        : body.fileToken !== undefined
          ? resolveUpload(deps.uploadsDir, body.fileToken)
          : existing.location;

      const updated = await deps.flows.updateSource(
        id,
        request.user.tenantId,
        toSourceInput(body, location),
      );
      if (updated === null) {
        return reply.status(404).send({ message: "Source introuvable." });
      }
      // Nouveau secret fourni → on le remplace au coffre (sinon on conserve).
      if (db && body.connectionString !== undefined && body.connectionString !== "") {
        await deps.vault.put(request.user.tenantId, id, body.connectionString);
      }
      await deps.audit.record({
        tenantId: request.user.tenantId,
        userId: request.user.id,
        action: "source_update",
        detail: { sourceId: id, name: updated.name },
        at: deps.clock.now(),
      });
      return { id: updated.id };
    },
  );

  // --- Suppression.
  api.delete(
    "/api/sources/:id",
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request, reply) => {
      guard(request.user.role);
      const { id } = request.params as { id: string };
      const removed = await deps.flows.deleteSource(id, request.user.tenantId);
      if (!removed) {
        return reply.status(404).send({ message: "Source introuvable." });
      }
      await deps.vault.remove(request.user.tenantId, id); // secret éventuel
      await deps.audit.record({
        tenantId: request.user.tenantId,
        userId: request.user.id,
        action: "source_delete",
        detail: { sourceId: id },
        at: deps.clock.now(),
      });
      return reply.status(204).send();
    },
  );
}
