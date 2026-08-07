/**
 * Client API minimal. Toute la sécurité vit côté serveur (RBAC, filtrage) —
 * ce client ne fait que transporter le jeton et traduire les erreurs HTTP en
 * erreurs típées affichables.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  user: { id: string; displayName: string; role: string };
}

export interface DashboardRowDto {
  matricule: string | null;
  nom: string;
  prenom: string;
  fonction: string | null;
  codeSecteur: string;
  dateDebutSecteur: string;
  dateFinSecteur: string | null;
  entrepriseTravailTemporaire: string | null;
  designation: string;
  nCas: string | null;
  classifSgh: string | null;
  mentionDanger: string | null;
  isCmr: boolean;
  cmrCategories: string[];
  dateEvaluation: string | null;
  dateRetrait: string | null;
  degreExposition: string | null;
  dureeExpositionAnnees: number;
  exposureAnomalies: { code: string; message: string }[];
}

export interface AdministrativeRowDto {
  matricule: string | null;
  nom: string;
  prenom: string;
  fonction: string | null;
  codeSecteur: string;
  dateDebutSecteur: string;
  dateFinSecteur: string | null;
  entrepriseTravailTemporaire: string | null;
}

export interface ImportRunDto {
  id: string;
  listType: string;
  sourceLabel: string;
  status: "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string;
  rowsRead: number;
  created: number;
  updated: number;
  unchanged: number;
  anomalies: { rowNumber: number; field: string | null; code: string; message: string }[];
}

export interface AuditEventDto {
  id: string;
  userId: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  at: string;
}

export type UserRole = "ADMIN" | "HSE" | "RH" | "MEDECINE" | "MANAGER" | "COLLABORATEUR";

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  matricule: string | null;
  isActive: boolean;
  managedSectors: string[];
}

export interface DepartureDto {
  matricule: string | null;
  nom: string;
  prenom: string;
  lastDeparture: string;
}

export interface ConformitySummaryDto {
  lastTransmission: { at: string; kind: string } | null;
  departuresPending: number;
  cmrProducts: number;
  cmrExposedWorkers: number;
  joinAnomalies: number;
}

export interface JoinAnomalyDto {
  code: string;
  codeSecteur: string;
  message: string;
  degreNaturalKey: string;
}

export interface TransmissionDto {
  id: string;
  at: string;
  userId: string | null;
  kind: string;
  rowCount: number;
  note: string | null;
}

export interface PurgeResultDto {
  cutoff: string;
  personnel: number;
  risques: number;
  degres: number;
}

export interface NamedCountDto {
  name: string;
  count: number;
}

export interface AnalyticsDto {
  totals: { workers: number; products: number; exposures: number };
  cmr: { products: number; workers: number };
  bySector: NamedCountDto[];
  byProduct: NamedCountDto[];
  byDegree: NamedCountDto[];
  truncated: { bySector: boolean; byProduct: boolean };
}

export interface ModelEntryDto {
  listType: string;
  rowCount: number;
  columns: CanonicalFieldDto[];
}

export interface AnalyticsOverviewDto {
  model: ModelEntryDto[];
  analytics: AnalyticsDto;
}

export interface UserPayload {
  email?: string; // requis à la création, ignoré à l'édition
  displayName: string;
  role: UserRole;
  matricule?: string;
  password?: string; // requis à la création, optionnel à l'édition
  isActive: boolean;
  managedSectors: string[];
}

export type DashboardViewDto =
  | { columns: "full"; rows: DashboardRowDto[]; joinAnomalies: { code: string; message: string }[] }
  | { columns: "administrative"; rows: AdministrativeRowDto[] };

export interface FlowDto {
  id: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: "success" | "partial" | "failed" | null;
}

export interface FlowRunSummaryDto {
  flowId: string;
  status: "success" | "partial" | "failed";
  sources: {
    sourceId: string;
    name: string;
    outcome: "success" | "partial" | "failed";
    created: number;
    updated: number;
    unchanged: number;
    anomalies: number;
    error?: string;
  }[];
}

// ---------------------------------------------------------------------
// Administration des sources de données (setup : connexion / aperçu /
// transformation / mapping). Réservé ADMIN/HSE — le serveur renvoie 403 sinon.
// ---------------------------------------------------------------------

/** Règle de transformation déclarative — miroir du domaine backend. */
export type MappingRule =
  | { kind: "trim"; column: string }
  | { kind: "uppercase"; column: string }
  | { kind: "lowercase"; column: string }
  | { kind: "defaultValue"; column: string; value: string }
  | { kind: "filterRowWhen"; column: string; equals: string }
  | { kind: "concat"; targetColumn: string; columns: string[]; separator: string }
  | { kind: "rename"; column: string; to: string }
  | { kind: "splitColumn"; column: string; separator: string; left: string; right: string }
  | { kind: "replace"; column: string; search: string; replaceWith: string }
  | { kind: "removeColumn"; column: string }
  | { kind: "fillDown"; column: string }
  | { kind: "dropEmptyRows" };

export interface ConnectorDescriptor {
  type: string;
  label: string;
  category: "file" | "cloud" | "database";
  status: "available" | "coming_soon";
  fileExtensions?: string[];
  description: string;
}

export interface CanonicalFieldDto {
  field: string;
  label: string;
  required: boolean;
  kind: "text" | "date";
  hint?: string;
}

export interface SourceSchemaDto {
  connectors: ConnectorDescriptor[];
  fields: Record<string, CanonicalFieldDto[]>;
}

export interface ColumnProfileDto {
  name: string;
  inferredType: "empty" | "date" | "number" | "text";
  filledCount: number;
  totalCount: number;
  distinctCount: number;
  sampleValues: string[];
}

export interface PreviewResultDto {
  rowCount: number;
  columns: ColumnProfileDto[];
  sampleRows: Record<string, string | null>[];
}

export interface DryRunResultDto {
  rowsRead: number;
  wouldImport: number;
  wouldReject: number;
  configError: boolean;
  anomalies: { rowNumber: number; field: string | null; code: string; message: string }[];
}

export interface SourceDto {
  id: string;
  name: string;
  listType: string;
  connectorType: string;
  sheet: string | null;
  enabled: boolean;
  columns: Record<string, string>;
  rules: MappingRule[];
}

/** Corps de création/édition d'une source. fileToken absent à l'édition = on garde le fichier. */
export interface SourcePayload {
  name: string;
  listType: string;
  connectorType: string;
  fileToken?: string;
  /** Secret des connecteurs base de données (chaîne de connexion). */
  connectionString?: string;
  sheet?: string;
  columns: Record<string, string>;
  rules?: MappingRule[];
  enabled: boolean;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        // On ne pose Content-Type QUE s'il y a un corps : Fastify refuse de
        // parser un corps vide annoncé comme JSON (cas d'un POST sans payload,
        // ex. déclenchement de flow).
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable. Vérifiez que le backend est démarré.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? "Erreur inattendue.");
  }
  return (await response.json()) as T;
}

/** Variante pour les réponses sans corps JSON (204 No Content : suppression). */
async function requestVoid(path: string, options: RequestInit, token: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable. Vérifiez que le backend est démarré.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? "Erreur inattendue.");
  }
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  refresh: (refreshToken: string) =>
    request<LoginResponse>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),

  /** URL de démarrage du login OIDC (le navigateur y est redirigé entièrement). */
  oidcLoginUrl: () => `${BASE_URL}/auth/oidc/start`,

  /** Tableau de bord. `asOf` (YYYY-MM-DD) reconstitue l'état à une date passée. */
  dashboard: (token: string, asOf?: string) =>
    request<DashboardViewDto>(
      `/api/dashboard${asOf !== undefined && asOf !== "" ? `?asOf=${asOf}` : ""}`,
      {},
      token,
    ),

  imports: (token: string) => request<ImportRunDto[]>("/api/imports", {}, token),

  audit: (token: string) => request<AuditEventDto[]>("/api/audit", {}, token),

  // --- Gestion des comptes (Admin) ---
  users: (token: string) => request<UserDto[]>("/api/users", {}, token),

  createUser: (token: string, body: UserPayload) =>
    request<{ id: string }>("/api/users", { method: "POST", body: JSON.stringify(body) }, token),

  updateUser: (token: string, id: string, body: UserPayload) =>
    request<{ id: string }>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(body) }, token),

  deleteUser: (token: string, id: string) => requestVoid(`/api/users/${id}`, { method: "DELETE" }, token),

  departures: (token: string) => request<DepartureDto[]>("/api/departures", {}, token),

  // --- Analytique (vue data analyst) ---
  analytics: (token: string) => request<AnalyticsOverviewDto>("/api/analytics", {}, token),

  // --- Conformité (1.2 à 1.5) ---
  conformity: (token: string) => request<ConformitySummaryDto>("/api/conformity", {}, token),

  dataQuality: (token: string) => request<JoinAnomalyDto[]>("/api/data-quality", {}, token),

  transmissions: (token: string) => request<TransmissionDto[]>("/api/transmissions", {}, token),

  recordTransmission: (token: string, body: { rowCount: number; note?: string }) =>
    request<{ id: string }>(
      "/api/transmissions",
      { method: "POST", body: JSON.stringify({ kind: "spst_nominative", ...body }) },
      token,
    ),

  purge: (token: string, execute: boolean) =>
    request<PurgeResultDto>(
      "/api/admin/purge",
      { method: "POST", body: JSON.stringify({ execute }) },
      token,
    ),

  flows: (token: string) => request<FlowDto[]>("/api/flows", {}, token),

  runFlow: (token: string, id: string) =>
    request<FlowRunSummaryDto>(`/api/flows/${id}/run`, { method: "POST" }, token),

  // --- Administration des sources ---
  sourceSchema: (token: string) => request<SourceSchemaDto>("/api/sources/schema", {}, token),

  listSources: (token: string) => request<SourceDto[]>("/api/sources", {}, token),

  /** Upload multipart d'un fichier. Le navigateur fixe lui-même le boundary. */
  uploadSource: async (
    token: string,
    file: File,
  ): Promise<{ fileToken: string; originalName: string }> => {
    const form = new FormData();
    form.append("file", file);
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/api/sources/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    } catch {
      throw new ApiError(0, "Serveur injoignable.");
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError(response.status, body?.message ?? "Upload impossible.");
    }
    return (await response.json()) as { fileToken: string; originalName: string };
  },

  previewSource: (
    token: string,
    body: {
      connectorType: string;
      fileToken?: string;
      connectionString?: string;
      sheet?: string;
      rules?: MappingRule[];
    },
  ) => request<PreviewResultDto>("/api/sources/preview", { method: "POST", body: JSON.stringify(body) }, token),

  dryRunSource: (
    token: string,
    body: {
      connectorType: string;
      fileToken?: string;
      connectionString?: string;
      sheet?: string;
      listType: string;
      columns: Record<string, string>;
      rules?: MappingRule[];
    },
  ) => request<DryRunResultDto>("/api/sources/dry-run", { method: "POST", body: JSON.stringify(body) }, token),

  createSource: (token: string, body: SourcePayload) =>
    request<{ id: string }>("/api/sources", { method: "POST", body: JSON.stringify(body) }, token),

  updateSource: (token: string, id: string, body: SourcePayload) =>
    request<{ id: string }>(`/api/sources/${id}`, { method: "PUT", body: JSON.stringify(body) }, token),

  deleteSource: (token: string, id: string) =>
    requestVoid(`/api/sources/${id}`, { method: "DELETE" }, token),

  /**
   * Télécharge un export (binaire). Le jeton voyage en en-tête Authorization,
   * jamais dans l'URL — pas de secret ni de PII dans l'historique de navigation.
   */
  exportFile: async (
    token: string,
    type: string,
    format: string,
    matricule?: string,
  ): Promise<{ blob: Blob; filename: string }> => {
    const q = `?format=${format}${matricule !== undefined ? `&matricule=${encodeURIComponent(matricule)}` : ""}`;
    return downloadBinary(`/api/export/${type}${q}`, token, `export.${format}`);
  },

  /** Sauvegarde complète de la base (Admin) → fichier .sql téléchargé. */
  downloadBackup: (token: string) => downloadBinary("/api/admin/backup", token, "cmr-backup.sql"),
};

/** Télécharge un binaire authentifié et extrait le nom de fichier de l'en-tête. */
async function downloadBinary(
  path: string,
  token: string,
  fallbackName: string,
): Promise<{ blob: Blob; filename: string }> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError(0, "Serveur injoignable.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? "Téléchargement impossible.");
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), filename: match?.[1] ?? fallbackName };
}
