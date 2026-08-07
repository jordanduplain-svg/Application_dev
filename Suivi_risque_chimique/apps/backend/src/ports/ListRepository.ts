import type {
  CanonicalItem,
  DegreExpositionItem,
  ListType,
  PersonnelItem,
  RisqueChimiqueItem,
} from "../domain/mapping/types.js";

/**
 * Port `ListRepository` — accès aux trois listes métier, avec historisation
 * SCD2 (ADR 0003). La logique métier ne touche JAMAIS Prisma directement.
 */

/** Issue de l'upsert d'un item : ce qui s'est réellement passé en base. */
export type UpsertOutcome = "created" | "updated" | "unchanged";

export interface UpsertReport {
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Métadonnées d'écriture communes : qui écrit (utilisateur ou flow), pour la
 * colonne recordedBy de l'historique.
 */
export interface WriteContext {
  tenantId: string;
  recordedBy: string | null;
}

/**
 * Filtre row-level appliqué DANS la requête SQL (WHERE), jamais en
 * post-traitement : une donnée hors périmètre ne sort pas de la base.
 *
 * La comparaison est insensible à la casse (les codes secteur varient
 * "Atelier-A"/"ATELIER-A" selon les fichiers sources). Limite connue : les
 * écarts d'ACCENTS ne sont pas couverts en SQL — les codes de rattachement
 * (managedSectors, matricule de compte) doivent être saisis tels qu'ils
 * figurent dans les sources, à la casse près. Cf. seuil de révision ADR 0004
 * (colonnes normalisées persistées) si ça devient un problème réel.
 */
export interface CurrentFilter {
  /** Restreint aux secteurs listés (MANAGER). */
  sectors?: string[];
  /** Restreint à la personne portant ce matricule (COLLABORATEUR). */
  matricule?: string;
}

export interface ListRepository {
  /**
   * Upsert SCD2 d'un lot d'items canoniques :
   *  - item inconnu (naturalKey active absente) → nouvelle entité (INSERT) ;
   *  - item connu et différent → clôture de la version active + nouvelle
   *    version (UPDATE), même entityId ;
   *  - item connu et identique → aucune écriture (unchanged).
   *
   * Mode « merge » uniquement pour le MVP : les lignes logiques absentes du
   * lot ne sont PAS soft-supprimées (un import partiel ne doit pas effacer le
   * reste). Le mode « snapshot complet » (avec soft-delete des absents)
   * viendra avec le moteur de flux configurable.
   */
  upsertPersonnel(items: PersonnelItem[], ctx: WriteContext): Promise<UpsertReport>;
  upsertRisquesChimiques(items: RisqueChimiqueItem[], ctx: WriteContext): Promise<UpsertReport>;
  upsertDegresExposition(items: DegreExpositionItem[], ctx: WriteContext): Promise<UpsertReport>;

  /**
   * Lecture de l'état d'une liste. Sans `asOf` : état COURANT (versions
   * actives, hors DELETE). Avec `asOf` (date) : état RECONSTITUÉ à cette date
   * passée via le SCD2 (ADR 0003) — la version active à l'instant donné.
   */
  findCurrentPersonnel(
    tenantId: string,
    filter?: CurrentFilter,
    asOf?: Date,
  ): Promise<PersonnelItem[]>;
  findCurrentRisquesChimiques(
    tenantId: string,
    filter?: Pick<CurrentFilter, "sectors">,
    asOf?: Date,
  ): Promise<RisqueChimiqueItem[]>;
  findCurrentDegresExposition(
    tenantId: string,
    filter?: CurrentFilter,
    asOf?: Date,
  ): Promise<DegreExpositionItem[]>;

  /**
   * Purge de rétention : supprime les VERSIONS CLOSES (validTo < cutoff) des
   * trois listes. Les versions ACTIVES ne sont jamais touchées (l'état courant
   * reste intact). `dryRun` true compte sans supprimer. Retourne le nombre de
   * lignes par liste.
   */
  purgeClosedBefore(tenantId: string, cutoff: Date, dryRun: boolean): Promise<PurgeReport>;
}

/** Nombre de versions closes purgées (ou purgeables, en dry-run) par liste. */
export interface PurgeReport {
  personnel: number;
  risques: number;
  degres: number;
}

/** Garde de type utilitaire pour les rapports génériques. */
export interface ImportRunRecord {
  listType: ListType;
  sourceLabel: string;
  startedAt: Date;
  finishedAt: Date;
  status: "success" | "partial" | "failed";
  rowsRead: number;
  report: UpsertReport;
  anomalyCount: number;
}

export type { CanonicalItem };
