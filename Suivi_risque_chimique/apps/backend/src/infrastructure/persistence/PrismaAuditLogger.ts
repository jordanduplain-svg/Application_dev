import type { Prisma, PrismaClient } from "@prisma/client";

import type { AccessEvent, AuditEventView, AuditLogger } from "../../ports/AuditLogger.js";

/** Adaptateur Prisma du journal d'accès — append-only. */
export class PrismaAuditLogger implements AuditLogger {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string, limit = 100): Promise<AuditEventView[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { tenantId },
      orderBy: { at: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id.toString(), // BigInt → string (non sérialisable en JSON sinon)
      userId: r.userId,
      action: r.action as AccessEvent["action"],
      detail: (r.detail as Record<string, unknown> | null) ?? null,
      at: r.at,
    }));
  }

  async record(event: AccessEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        tenantId: event.tenantId,
        userId: event.userId,
        action: event.action,
        at: event.at,
        // `exactOptionalPropertyTypes` interdit de passer `undefined`
        // explicitement : la clé n'est présente que si un détail existe.
        ...(event.detail !== undefined
          ? { detail: event.detail as Prisma.InputJsonValue }
          : {}),
      },
    });
  }
}
