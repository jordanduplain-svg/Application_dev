import type { PrismaClient } from "@prisma/client";

import type { RowAnomaly } from "../../domain/mapping/types.js";
import type { ImportJournal, ImportRunView } from "../../ports/ImportJournal.js";
import type { ImportRunRecord } from "../../ports/ListRepository.js";

/** Adaptateur Prisma du port `ImportJournal`. */
export class PrismaImportJournal implements ImportJournal {
  constructor(private readonly prisma: PrismaClient) {}

  async listRuns(tenantId: string, limit = 50): Promise<ImportRunView[]> {
    const rows = await this.prisma.importRun.findMany({
      where: { tenantId },
      orderBy: { startedAt: "desc" },
      take: limit,
      include: { anomalies: { orderBy: { rowNumber: "asc" } } },
    });
    return rows.map((r) => ({
      id: r.id,
      listType: r.listType,
      status: r.status === "SUCCESS" ? "success" : r.status === "PARTIAL" ? "partial" : "failed",
      sourceLabel: r.sourceLabel,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      rowsRead: r.rowsRead,
      created: r.created,
      updated: r.updated,
      unchanged: r.unchanged,
      anomalies: r.anomalies.map((a) => ({
        rowNumber: a.rowNumber,
        field: a.field,
        code: a.code,
        message: a.message,
      })),
    }));
  }

  async recordRun(run: ImportRunRecord, anomalies: RowAnomaly[]): Promise<string> {
    const created = await this.prisma.importRun.create({
      data: {
        listType: run.listType,
        sourceLabel: run.sourceLabel,
        status:
          run.status === "success" ? "SUCCESS" : run.status === "partial" ? "PARTIAL" : "FAILED",
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        rowsRead: run.rowsRead,
        created: run.report.created,
        updated: run.report.updated,
        unchanged: run.report.unchanged,
        anomalies: {
          create: anomalies.map((a) => ({
            rowNumber: a.rowNumber,
            field: a.field,
            code: a.code,
            message: a.message,
          })),
        },
      },
    });
    return created.id;
  }
}
