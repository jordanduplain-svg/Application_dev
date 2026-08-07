import { describe, expect, it } from "vitest";

import type { Clock } from "../../ports/Clock.js";
import type { ConnectorFactory } from "../../ports/ConnectorFactory.js";
import type { DataSource, TableConfig } from "../../ports/DataSource.js";
import type {
  FlowDefinition,
  FlowRepository,
  FlowRunStatus,
  ImportSourceDefinition,
  SourceInput,
} from "../../ports/FlowRepository.js";
import type { ImportJournal } from "../../ports/ImportJournal.js";
import type {
  DegreExpositionItem,
  PersonnelItem,
  RisqueChimiqueItem,
  RowAnomaly,
  SourceRow,
} from "../../domain/mapping/types.js";
import type {
  ListRepository,
  UpsertReport,
  WriteContext,
} from "../../ports/ListRepository.js";
import { ImportListUseCase } from "../import/ImportListUseCase.js";
import { RunFlowUseCase } from "./RunFlowUseCase.js";

/** Horloge figée. */
const clock: Clock = { now: () => new Date("2026-06-13T02:00:00Z") };

/** Repository en mémoire minimal : compte les créations par naturalKey. */
class InMemoryListRepository implements ListRepository {
  private readonly seen = new Set<string>();

  private upsert(items: { naturalKey: string }[]): UpsertReport {
    const report: UpsertReport = { created: 0, updated: 0, unchanged: 0 };
    for (const item of items) {
      if (this.seen.has(item.naturalKey)) report.unchanged += 1;
      else {
        this.seen.add(item.naturalKey);
        report.created += 1;
      }
    }
    return report;
  }

  upsertPersonnel(items: PersonnelItem[], _ctx: WriteContext): Promise<UpsertReport> {
    return Promise.resolve(this.upsert(items));
  }
  upsertRisquesChimiques(items: RisqueChimiqueItem[], _ctx: WriteContext): Promise<UpsertReport> {
    return Promise.resolve(this.upsert(items));
  }
  upsertDegresExposition(items: DegreExpositionItem[], _ctx: WriteContext): Promise<UpsertReport> {
    return Promise.resolve(this.upsert(items));
  }
  findCurrentPersonnel(): Promise<PersonnelItem[]> {
    return Promise.resolve([]);
  }
  findCurrentRisquesChimiques(): Promise<RisqueChimiqueItem[]> {
    return Promise.resolve([]);
  }
  findCurrentDegresExposition(): Promise<DegreExpositionItem[]> {
    return Promise.resolve([]);
  }
  purgeClosedBefore(): Promise<{ personnel: number; risques: number; degres: number }> {
    return Promise.resolve({ personnel: 0, risques: 0, degres: 0 });
  }
}

class InMemoryImportJournal implements ImportJournal {
  public runs = 0;
  recordRun(): Promise<string> {
    this.runs += 1;
    return Promise.resolve(`run-${this.runs}`);
  }
  listRuns(): Promise<never[]> {
    return Promise.resolve([]);
  }
}

/** Connecteur de test : rend des lignes fixes, ou lève selon le type. */
function fakeConnector(rows: SourceRow[], shouldThrow = false): DataSource {
  return {
    test: () => Promise.resolve(true),
    fetchTable: (_config: TableConfig) =>
      shouldThrow
        ? Promise.reject(new Error("source indisponible (simulée)"))
        : Promise.resolve(rows),
  };
}

class FakeFlowRepository implements FlowRepository {
  public recorded: { flowId: string; status: FlowRunStatus }[] = [];
  constructor(private readonly sources: ImportSourceDefinition[]) {}
  findEnabledFlows(): Promise<FlowDefinition[]> {
    return Promise.resolve([]);
  }
  findFlowsByTenant(): Promise<FlowDefinition[]> {
    return Promise.resolve([]);
  }
  findFlow(): Promise<FlowDefinition | null> {
    return Promise.resolve(null);
  }
  findEnabledSources(): Promise<ImportSourceDefinition[]> {
    return Promise.resolve(this.sources);
  }
  recordFlowRun(flowId: string, status: FlowRunStatus): Promise<void> {
    this.recorded.push({ flowId, status });
    return Promise.resolve();
  }
  // CRUD non exercé par ces tests (cf. tests dédiés des use cases sources) :
  // stubs minimaux pour satisfaire le port.
  listSources(): Promise<ImportSourceDefinition[]> {
    return Promise.resolve(this.sources);
  }
  getSource(): Promise<ImportSourceDefinition | null> {
    return Promise.resolve(null);
  }
  createSource(_tenantId: string, _input: SourceInput): Promise<ImportSourceDefinition> {
    return Promise.reject(new Error("non implémenté dans ce fake"));
  }
  updateSource(): Promise<ImportSourceDefinition | null> {
    return Promise.resolve(null);
  }
  deleteSource(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

const personnelSource = (over: Partial<ImportSourceDefinition> = {}): ImportSourceDefinition => ({
  id: "src-1",
  tenantId: "default",
  name: "RH",
  listType: "PERSONNEL",
  connectorType: "excel",
  location: "/data/rh.xlsx",
  table: "Personnel",
  mapping: {
    listType: "PERSONNEL",
    columns: {
      matricule: "Matricule",
      nom: "Nom",
      prenom: "Prénom",
      code_secteur: "Secteur",
      date_debut_secteur: "Entrée",
    },
  },
  enabled: true,
  ...over,
});

const personnelRows: SourceRow[] = [
  {
    rowNumber: 2,
    data: { Matricule: "EMP-001", Nom: "Test", Prénom: "Alice", Secteur: "A", Entrée: "2020-01-01" },
  },
];

const flow: FlowDefinition = {
  id: "flow-1",
  tenantId: "default",
  name: "Réimport nocturne",
  cronExpression: "0 2 * * *",
  enabled: true,
};

function makeUseCase(
  sources: ImportSourceDefinition[],
  connectorFor: (type: string) => DataSource,
): { useCase: RunFlowUseCase; repo: FakeFlowRepository } {
  const repo = new FakeFlowRepository(sources);
  const connectors: ConnectorFactory = { create: connectorFor };
  const importList = new ImportListUseCase(
    new InMemoryListRepository(),
    new InMemoryImportJournal(),
    clock,
  );
  const vault = {
    get: () => Promise.resolve(null),
    put: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
  return { useCase: new RunFlowUseCase(repo, connectors, importList, clock, vault), repo };
}

describe("RunFlowUseCase", () => {
  it("réimporte les sources actives et renvoie un résumé success", async () => {
    const { useCase, repo } = makeUseCase([personnelSource()], () =>
      fakeConnector(personnelRows),
    );
    const summary = await useCase.execute(flow);

    expect(summary.status).toBe("success");
    expect(summary.sources).toHaveLength(1);
    expect(summary.sources[0]!.created).toBe(1);
    // L'état du flow est journalisé.
    expect(repo.recorded).toEqual([{ flowId: "flow-1", status: "success" }]);
  });

  it("une source indisponible n'interrompt PAS les autres (tolérance, brief §10)", async () => {
    const sources = [
      personnelSource({ id: "ok", name: "RH-OK" }),
      personnelSource({ id: "ko", name: "RH-KO", connectorType: "cassé" }),
    ];
    const { useCase } = makeUseCase(sources, (type) =>
      fakeConnector(personnelRows, type === "cassé"),
    );
    const summary = await useCase.execute(flow);

    // Une réussite + un échec → statut global partial. La source indisponible
    // est captée par le pipeline d'import (journalisée comme anomalie) : son
    // outcome est "failed", les autres sources ont quand même tourné.
    expect(summary.status).toBe("partial");
    const ko = summary.sources.find((s) => s.sourceId === "ko");
    expect(ko?.outcome).toBe("failed");
    const ok = summary.sources.find((s) => s.sourceId === "ok");
    expect(ok?.outcome).toBe("success");
    expect(ok?.created).toBe(1);
  });

  it("connecteur de type inconnu : échec isolé, pas d'exception propagée", async () => {
    const { useCase } = makeUseCase([personnelSource()], () => {
      throw new Error("connecteur inconnu : excel-v2");
    });
    const summary = await useCase.execute(flow);
    expect(summary.status).toBe("failed");
    expect(summary.sources[0]!.error).toContain("excel-v2");
  });

  it("aucune source active : statut failed (rien à importer)", async () => {
    const { useCase } = makeUseCase([], () => fakeConnector([]));
    const summary = await useCase.execute(flow);
    expect(summary.status).toBe("failed");
    expect(summary.sources).toHaveLength(0);
  });

  it("lignes rejetées au mapping : statut partial (import passé, anomalies)", async () => {
    // La colonne « Entrée » existe mais sa valeur est vide → la date
    // obligatoire manque → ligne rejetée (anomalie de ligne, pas de config).
    const badRows: SourceRow[] = [
      {
        rowNumber: 2,
        data: { Matricule: "EMP-009", Nom: "Sans", Prénom: "Date", Secteur: "A", Entrée: "" },
      },
    ];
    const { useCase } = makeUseCase([personnelSource()], () => fakeConnector(badRows));
    const summary = await useCase.execute(flow);
    expect(summary.status).toBe("partial");
    expect(summary.sources[0]!.anomalies).toBeGreaterThan(0);
  });
});

// Évite un import inutilisé signalé par le typeur strict.
export type _Anomaly = RowAnomaly;
