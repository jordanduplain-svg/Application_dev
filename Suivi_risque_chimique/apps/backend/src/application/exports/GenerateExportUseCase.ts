import { anonymizeExposures } from "../../domain/anonymization/anonymizeExposures.js";
import type { ExposureRecord } from "../../domain/anonymization/types.js";
import { canExport } from "../../domain/authorization/exportPermissions.js";
import { AccessDeniedError } from "../../domain/authorization/errors.js";
import type { AuthenticatedUser } from "../../domain/authorization/types.js";
import { buildDashboardRows } from "../../domain/dashboard/buildDashboardRows.js";
import type { DashboardRow } from "../../domain/dashboard/types.js";
import {
  buildAnonymizedDocument,
  buildIndividualDocument,
  buildNominativeDocument,
} from "../../domain/exports/buildDocuments.js";
import type { ExportType } from "../../domain/exports/types.js";
import { normalizeText } from "../../domain/mapping/normalizeText.js";
import type { AuditLogger } from "../../ports/AuditLogger.js";
import type { Clock } from "../../ports/Clock.js";
import type {
  DocumentRenderer,
  ExportFormat,
  RenderedDocument,
} from "../../ports/DocumentRenderer.js";
import type { ListRepository } from "../../ports/ListRepository.js";

/**
 * Cas d'usage : générer un export réglementaire.
 *
 * Garde-fous (côté serveur, AVANT toute génération) :
 *  1. le rôle a-t-il le droit de demander CE type d'export ? (matrice ADR 0002)
 *  2. un COLLABORATEUR ne peut exporter que SA fiche (le matricule cible est
 *     forcé au sien — un paramètre fourni est ignoré).
 * Toute génération est journalisée (audit).
 *
 * Périmètre des données par type :
 *  - individual      : les lignes d'UNE personne (matricule).
 *  - cse_anonymized  : tout le tenant, passé au k-anonymat.
 *  - spst_nominative : tout le tenant, nominatif.
 *
 * On charge l'intégralité des listes du tenant puis on construit toutes les
 * lignes du tableau de bord : cela garantit une attribution des degrés
 * identique à celle de l'écran (même gestion des homonymes). Les exports
 * étant rares, le surcoût est négligeable face à la garantie de cohérence.
 */

export interface ExportCommand {
  user: AuthenticatedUser;
  type: ExportType;
  format: ExportFormat;
  /** Pour un export individuel demandé par HSE/Médecine/Admin : la cible. */
  targetMatricule?: string;
}

export class GenerateExportUseCase {
  private readonly renderers: Map<ExportFormat, DocumentRenderer>;

  constructor(
    private readonly repository: ListRepository,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
    renderers: DocumentRenderer[],
    private readonly kAnonymityThreshold: number,
  ) {
    this.renderers = new Map(renderers.map((r) => [r.format, r]));
  }

  async execute(command: ExportCommand): Promise<RenderedDocument> {
    const { user, type, format } = command;

    if (!canExport(user.role, type)) {
      throw new AccessDeniedError(`export_${type}_interdit_role_${user.role}`);
    }
    const renderer = this.renderers.get(format);
    if (renderer === undefined) {
      throw new AccessDeniedError(`format_export_non_supporte_${format}`);
    }

    const generatedAt = this.clock.now();
    const allRows = await this.loadAllRows(user.tenantId);

    let document;
    let auditAction: Parameters<AuditLogger["record"]>[0]["action"];

    switch (type) {
      case "individual": {
        // Un collaborateur est verrouillé sur SON matricule, quoi qu'il passe.
        const matricule =
          user.role === "COLLABORATEUR" ? user.matricule : (command.targetMatricule ?? null);
        if (matricule === null || matricule.trim() === "") {
          throw new AccessDeniedError("export_individuel_sans_cible");
        }
        const target = normalizeText(matricule);
        const personRows = allRows.filter(
          (r) => r.matricule !== null && normalizeText(r.matricule) === target,
        );
        document = buildIndividualDocument(personRows, generatedAt);
        auditAction = "export_individual";
        break;
      }

      case "spst_nominative": {
        document = buildNominativeDocument(allRows, generatedAt);
        auditAction = "export_spst_nominative";
        break;
      }

      case "cse_anonymized": {
        const records: ExposureRecord[] = allRows.map((r) => ({
          matricule: r.matricule,
          nom: r.nom,
          prenom: r.prenom,
          codeSecteur: r.codeSecteur,
          designation: r.designation,
          nCas: r.nCas,
          classifSgh: r.classifSgh,
          mentionDanger: r.mentionDanger,
          degreExposition: r.degreExposition,
        }));
        const view = anonymizeExposures(records, { k: this.kAnonymityThreshold });
        document = buildAnonymizedDocument(view, generatedAt);
        auditAction = "export_cse_anonymized";
        break;
      }
    }

    const rendered = await renderer.render(document);

    // Audit SANS PII : type, format, rôle, volume. Jamais le nom de la cible.
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: auditAction,
      detail: { format, role: user.role, rowCount: documentRowCount(document) },
      at: generatedAt,
    });

    return rendered;
  }

  private async loadAllRows(tenantId: string): Promise<DashboardRow[]> {
    const [personnel, risques, degres] = await Promise.all([
      this.repository.findCurrentPersonnel(tenantId),
      this.repository.findCurrentRisquesChimiques(tenantId),
      this.repository.findCurrentDegresExposition(tenantId),
    ]);
    return buildDashboardRows(personnel, risques, degres, this.clock).rows;
  }
}

/** Compteur de lignes pour l'audit (sans contenu). */
function documentRowCount(document: { sections: { table?: { rows: unknown[] } }[] }): number {
  return document.sections.reduce((sum, s) => sum + (s.table?.rows.length ?? 0), 0);
}
