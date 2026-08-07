import type { MappingRule } from "../domain/mapping/mappingRules.js";
import type { ListType, MappingConfig } from "../domain/mapping/types.js";

/**
 * Définitions du moteur de flux, lues depuis la base (éditables).
 */

export interface ImportSourceDefinition {
  id: string;
  tenantId: string;
  name: string;
  listType: ListType;
  connectorType: string;
  /** Localisation propre au connecteur (Excel : chemin de fichier). */
  location: string;
  /** Feuille / table, optionnelle selon le connecteur. */
  table: string | null;
  /** Mapping colonnes client → champs canoniques. */
  mapping: MappingConfig;
  enabled: boolean;
}

/**
 * Données fournies par l'utilisateur pour créer/modifier une source (le wizard).
 * Distincte de `ImportSourceDefinition` : pas d'`id` ni de `tenantId` (dérivés
 * du contexte), et le mapping y est sous sa forme « éditée » (colonnes + règles)
 * sans le `listType` redondant (porté à part).
 */
export interface SourceInput {
  name: string;
  listType: ListType;
  connectorType: string;
  location: string;
  sheet: string | null;
  columns: Record<string, string>;
  rules?: MappingRule[];
  enabled: boolean;
}

export type FlowRunStatus = "success" | "partial" | "failed";

export interface FlowDefinition {
  id: string;
  tenantId: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
  /** Dernier passage (null si jamais exécuté). Renseigné en lecture. */
  lastRunAt?: Date | null;
  lastRunStatus?: FlowRunStatus | null;
}

/**
 * Port `FlowRepository` — accès aux flows et aux sources d'import.
 */
export interface FlowRepository {
  /** Tous les flows actifs, tous tenants (pour la planification au démarrage). */
  findEnabledFlows(): Promise<FlowDefinition[]>;
  /** Tous les flows d'un tenant (vue de statut), avec leur dernier passage. */
  findFlowsByTenant(tenantId: string): Promise<FlowDefinition[]>;
  /** Un flow par id (déclenchement manuel). */
  findFlow(id: string): Promise<FlowDefinition | null>;
  /** Sources actives d'un tenant (ce qu'un flow réimporte). */
  findEnabledSources(tenantId: string): Promise<ImportSourceDefinition[]>;
  /** Met à jour l'état du dernier passage d'un flow (horodatage + statut). */
  recordFlowRun(flowId: string, status: FlowRunStatus, at: Date): Promise<void>;

  // --- Gestion des sources (espace d'administration des données) ---
  /** TOUTES les sources d'un tenant (actives et désactivées), pour la liste. */
  listSources(tenantId: string): Promise<ImportSourceDefinition[]>;
  /** Une source par id, ou null (un autre tenant est traité comme absent). */
  getSource(id: string, tenantId: string): Promise<ImportSourceDefinition | null>;
  /** Crée une source et renvoie sa définition complète. */
  createSource(tenantId: string, input: SourceInput): Promise<ImportSourceDefinition>;
  /** Met à jour une source ; null si elle n'existe pas dans ce tenant. */
  updateSource(
    id: string,
    tenantId: string,
    input: SourceInput,
  ): Promise<ImportSourceDefinition | null>;
  /** Supprime une source ; false si elle n'existe pas dans ce tenant. */
  deleteSource(id: string, tenantId: string): Promise<boolean>;
}
