/**
 * Port `TransmissionRepository` — trace des transmissions de la liste au SPST
 * (décret 2024-307). Append-only ; aucune donnée nominative (compteurs + méta).
 */
export interface Transmission {
  id: string;
  at: Date;
  userId: string | null;
  kind: string;
  rowCount: number;
  note: string | null;
}

export interface RecordTransmissionInput {
  at: Date;
  userId: string | null;
  kind: string;
  rowCount: number;
  note: string | null;
}

export interface TransmissionRepository {
  record(tenantId: string, input: RecordTransmissionInput): Promise<{ id: string }>;
  list(tenantId: string, limit?: number): Promise<Transmission[]>;
  latest(tenantId: string): Promise<Transmission | null>;
}
