import type { PrismaClient } from "@prisma/client";

import type { ListType } from "../../domain/mapping/types.js";
import { ConnectorConfigSchema, MappingShapeSchema } from "../../shared/sourceValidation.js";
import type {
  FlowDefinition,
  FlowRepository,
  FlowRunStatus,
  ImportSourceDefinition,
  SourceInput,
} from "../../ports/FlowRepository.js";

/**
 * Adaptateur Prisma du port `FlowRepository`.
 *
 * Le JSON stocké est validé à la lecture (Zod, schémas partagés) : une
 * définition corrompue est détectée tôt et clairement, plutôt que de planter
 * au milieu d'un import.
 */

const LIST_TYPES: readonly ListType[] = ["PERSONNEL", "RISQUES_CHIMIQUES", "DEGRE_EXPOSITION"];

export class PrismaFlowRepository implements FlowRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findEnabledFlows(): Promise<FlowDefinition[]> {
    const rows = await this.prisma.flow.findMany({ where: { enabled: true } });
    return rows.map(toFlowDefinition);
  }

  async findFlowsByTenant(tenantId: string): Promise<FlowDefinition[]> {
    const rows = await this.prisma.flow.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toFlowDefinition);
  }

  async findFlow(id: string): Promise<FlowDefinition | null> {
    const row = await this.prisma.flow.findUnique({ where: { id } });
    return row !== null ? toFlowDefinition(row) : null;
  }

  async findEnabledSources(tenantId: string): Promise<ImportSourceDefinition[]> {
    const rows = await this.prisma.importSource.findMany({
      where: { tenantId, enabled: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toSourceDefinition);
  }

  async recordFlowRun(flowId: string, status: FlowRunStatus, at: Date): Promise<void> {
    await this.prisma.flow.update({
      where: { id: flowId },
      data: { lastRunAt: at, lastRunStatus: status },
    });
  }

  // ------------------------------------------------------------------
  // CRUD des sources (espace d'administration des données)
  // ------------------------------------------------------------------

  async listSources(tenantId: string): Promise<ImportSourceDefinition[]> {
    const rows = await this.prisma.importSource.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toSourceDefinition);
  }

  async getSource(id: string, tenantId: string): Promise<ImportSourceDefinition | null> {
    // findFirst avec tenantId : une source d'un autre tenant est « introuvable ».
    const row = await this.prisma.importSource.findFirst({ where: { id, tenantId } });
    return row !== null ? toSourceDefinition(row) : null;
  }

  async createSource(tenantId: string, input: SourceInput): Promise<ImportSourceDefinition> {
    const row = await this.prisma.importSource.create({
      data: { tenantId, ...toPersisted(input) },
    });
    return toSourceDefinition(row);
  }

  async updateSource(
    id: string,
    tenantId: string,
    input: SourceInput,
  ): Promise<ImportSourceDefinition | null> {
    // updateMany filtre par tenant : impossible de modifier la source d'autrui,
    // même en connaissant son id. count=0 → source absente de ce tenant.
    const result = await this.prisma.importSource.updateMany({
      where: { id, tenantId },
      data: toPersisted(input),
    });
    if (result.count === 0) return null;
    return this.getSource(id, tenantId);
  }

  async deleteSource(id: string, tenantId: string): Promise<boolean> {
    const result = await this.prisma.importSource.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }
}

/**
 * Sérialise une saisie utilisateur vers les colonnes Prisma. Les blocs JSON
 * (config / mapping) sont construits ici, jamais ailleurs, pour rester
 * cohérents avec ce que `toSourceDefinition` relit. AUCUN secret dans config.
 */
function toPersisted(input: SourceInput): {
  name: string;
  listType: string;
  connectorType: string;
  config: { location: string; sheet?: string };
  mapping: { columns: Record<string, string>; rules?: SourceInput["rules"] };
  enabled: boolean;
} {
  return {
    name: input.name,
    listType: input.listType,
    connectorType: input.connectorType,
    config: {
      location: input.location,
      ...(input.sheet !== null ? { sheet: input.sheet } : {}),
    },
    mapping: {
      columns: input.columns,
      ...(input.rules !== undefined ? { rules: input.rules } : {}),
    },
    enabled: input.enabled,
  };
}

/** Relit une ligne Prisma en définition de source, JSON validé (Zod partagé). */
function toSourceDefinition(row: {
  id: string;
  tenantId: string;
  name: string;
  listType: string;
  connectorType: string;
  config: unknown;
  mapping: unknown;
  enabled: boolean;
}): ImportSourceDefinition {
  const config = ConnectorConfigSchema.parse(row.config);
  const mapping = MappingShapeSchema.parse(row.mapping);
  const listType = row.listType as ListType;
  if (!LIST_TYPES.includes(listType)) {
    throw new Error(`Source ${row.id} : listType inconnu « ${row.listType} ».`);
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    listType,
    connectorType: row.connectorType,
    location: config.location,
    table: config.sheet ?? null,
    mapping: {
      listType,
      columns: mapping.columns,
      ...(mapping.rules !== undefined ? { rules: mapping.rules } : {}),
    },
    enabled: row.enabled,
  };
}

function toFlowDefinition(row: {
  id: string;
  tenantId: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
}): FlowDefinition {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    cronExpression: row.cronExpression,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    lastRunStatus: row.lastRunStatus as FlowRunStatus | null,
  };
}
