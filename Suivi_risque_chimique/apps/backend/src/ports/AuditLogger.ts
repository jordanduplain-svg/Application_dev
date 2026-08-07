/**
 * Port `AuditLogger` — journal d'accès centralisé (brief §11, RGPD art. 5.2).
 *
 * Append-only. Les `detail` ne contiennent JAMAIS de données personnelles de
 * salariés (noms, matricules…) : uniquement des identifiants techniques, des
 * rôles et des compteurs. Le journal sert à démontrer QUI a accédé À QUOI
 * (catégorie d'action + volume), pas à dupliquer les données consultées.
 */
export interface AccessEvent {
  tenantId: string;
  /** null pour un échec d'authentification (aucune identité prouvée). */
  userId: string | null;
  action:
    | "login_success"
    | "login_failed"
    | "dashboard_view"
    | "export_individual"
    | "export_cse_anonymized"
    | "export_spst_nominative"
    | "flow_run_manual"
    // Administration des sources de données. `detail` ne porte que de la config
    // (nom de source, type de connecteur/liste, compteurs) — jamais de PII.
    // `source_preview` et `source_dry_run` LISENT des données salariées : les
    // journaliser trace qui a inspecté quelle source.
    | "source_preview"
    | "source_dry_run"
    | "source_create"
    | "source_update"
    | "source_delete"
    // Gestion des comptes (Admin). `detail` ne porte que l'id technique de la
    // cible et son rôle — jamais l'email ni le nom.
    | "user_create"
    | "user_update"
    | "user_delete"
    // Sauvegarde de la base (Admin) — uniquement l'action, aucune donnée.
    | "backup_download"
    // Conformité : transmission au SPST tracée, purge de rétention.
    | "transmission_record"
    | "retention_purge";
  detail?: Record<string, unknown>;
  at: Date;
}

/** Un événement d'audit tel que présenté à l'écran (id sérialisable). */
export interface AuditEventView {
  id: string;
  userId: string | null;
  action: AccessEvent["action"];
  detail: Record<string, unknown> | null;
  at: Date;
}

export interface AuditLogger {
  record(event: AccessEvent): Promise<void>;

  /**
   * Derniers événements d'un tenant (plus récent d'abord). Lecture réservée à
   * l'ADMIN côté route — le journal d'accès est lui-même une donnée sensible.
   */
  list(tenantId: string, limit?: number): Promise<AuditEventView[]>;
}
