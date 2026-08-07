import type { PrismaClient } from "@prisma/client";

import type {
  RecordTransmissionInput,
  Transmission,
  TransmissionRepository,
} from "../../ports/TransmissionRepository.js";

/** Adaptateur Prisma du journal des transmissions au SPST. Append-only. */
export class PrismaTransmissionRepository implements TransmissionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(tenantId: string, input: RecordTransmissionInput): Promise<{ id: string }> {
    const created = await this.prisma.transmission.create({
      data: {
        tenantId,
        at: input.at,
        userId: input.userId,
        kind: input.kind,
        rowCount: input.rowCount,
        note: input.note,
      },
    });
    return { id: created.id };
  }

  async list(tenantId: string, limit = 50): Promise<Transmission[]> {
    const rows = await this.prisma.transmission.findMany({
      where: { tenantId },
      orderBy: { at: "desc" },
      take: limit,
    });
    return rows.map(toTransmission);
  }

  async latest(tenantId: string): Promise<Transmission | null> {
    const row = await this.prisma.transmission.findFirst({
      where: { tenantId },
      orderBy: { at: "desc" },
    });
    return row !== null ? toTransmission(row) : null;
  }
}

function toTransmission(row: {
  id: string;
  at: Date;
  userId: string | null;
  kind: string;
  rowCount: number;
  note: string | null;
}): Transmission {
  return {
    id: row.id,
    at: row.at,
    userId: row.userId,
    kind: row.kind,
    rowCount: row.rowCount,
    note: row.note,
  };
}
