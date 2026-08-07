import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { normalizeText } from "../../domain/mapping/normalizeText.js";
import type {
  DegreExpositionItem,
  PersonnelItem,
  RisqueChimiqueItem,
} from "../../domain/mapping/types.js";
import type { Clock } from "../../ports/Clock.js";
import type {
  CurrentFilter,
  ListRepository,
  PurgeReport,
  UpsertReport,
  WriteContext,
} from "../../ports/ListRepository.js";

/**
 * Adaptateur Prisma du port `ListRepository` — écritures SCD2 (ADR 0003).
 *
 * Algorithme d'upsert, par item, dans UNE transaction par lot :
 *   1. retrouver la version ACTIVE portant la même (tenantId, naturalKey) ;
 *   2. absente → nouvelle entité (entityId frais, operation INSERT) ;
 *   3. présente et identique champ à champ → ne rien écrire (unchanged) ;
 *   4. présente et différente → clore la version (validTo = now) PUIS insérer
 *      la nouvelle version du MÊME entityId (operation UPDATE).
 *
 * La transaction garantit qu'on ne laisse jamais une entité « close sans
 * successeur » en cas de plantage au milieu. L'index unique partiel en base
 * (une seule version active par entityId) reste le filet ultime contre les
 * écritures concurrentes — si deux imports se chevauchent, l'un des deux
 * échouera proprement au lieu de corrompre l'historique.
 *
 * Le même instant `now` (Clock injecté) sert à toutes les écritures du lot :
 * l'état de la base à toute date est ainsi cohérent — un lot importé est
 * visible en entier ou pas du tout dans une requête temporelle.
 */
export class PrismaListRepository implements ListRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------
  // PERSONNEL
  // ------------------------------------------------------------------

  async upsertPersonnel(items: PersonnelItem[], ctx: WriteContext): Promise<UpsertReport> {
    const now = this.clock.now();
    const report: UpsertReport = { created: 0, updated: 0, unchanged: 0 };

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const active = await tx.personnelHistory.findFirst({
          where: { tenantId: ctx.tenantId, naturalKey: item.naturalKey, validTo: null },
        });

        const fields = {
          matricule: item.matricule,
          nom: item.nom,
          prenom: item.prenom,
          fonction: item.fonction,
          codeSecteur: item.codeSecteur,
          dateDebutSecteur: item.dateDebutSecteur,
          dateFinSecteur: item.dateFinSecteur,
          entrepriseTravailTemporaire: item.entrepriseTravailTemporaire,
        };

        if (!active) {
          await tx.personnelHistory.create({
            data: {
              entityId: randomUUID(),
              naturalKey: item.naturalKey,
              tenantId: ctx.tenantId,
              ...fields,
              ...versionColumns(now, "INSERT", ctx),
            },
          });
          report.created += 1;
        } else if (
          active.matricule === item.matricule &&
          active.nom === item.nom &&
          active.prenom === item.prenom &&
          active.fonction === item.fonction &&
          active.codeSecteur === item.codeSecteur &&
          active.entrepriseTravailTemporaire === item.entrepriseTravailTemporaire &&
          sameDay(active.dateDebutSecteur, item.dateDebutSecteur) &&
          sameDay(active.dateFinSecteur, item.dateFinSecteur)
        ) {
          report.unchanged += 1;
        } else {
          await tx.personnelHistory.update({
            where: { id: active.id },
            data: { validTo: now },
          });
          await tx.personnelHistory.create({
            data: {
              entityId: active.entityId,
              naturalKey: item.naturalKey,
              tenantId: ctx.tenantId,
              ...fields,
              ...versionColumns(now, "UPDATE", ctx),
            },
          });
          report.updated += 1;
        }
      }
    });

    return report;
  }

  async findCurrentPersonnel(
    tenantId: string,
    filter?: CurrentFilter,
    asOf?: Date,
  ): Promise<PersonnelItem[]> {
    const rows = await this.prisma.personnelHistory.findMany({
      where: { tenantId, ...versionWhere(asOf) },
    });
    const keep = currentFilterPredicate(filter);
    return rows.filter(keep).map((r) => ({
      naturalKey: r.naturalKey,
      matricule: r.matricule,
      nom: r.nom,
      prenom: r.prenom,
      fonction: r.fonction,
      codeSecteur: r.codeSecteur,
      dateDebutSecteur: r.dateDebutSecteur,
      dateFinSecteur: r.dateFinSecteur,
      entrepriseTravailTemporaire: r.entrepriseTravailTemporaire,
    }));
  }

  // ------------------------------------------------------------------
  // RISQUES_CHIMIQUES
  // ------------------------------------------------------------------

  async upsertRisquesChimiques(
    items: RisqueChimiqueItem[],
    ctx: WriteContext,
  ): Promise<UpsertReport> {
    const now = this.clock.now();
    const report: UpsertReport = { created: 0, updated: 0, unchanged: 0 };

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const active = await tx.risqueChimiqueHistory.findFirst({
          where: { tenantId: ctx.tenantId, naturalKey: item.naturalKey, validTo: null },
        });

        const fields = {
          designation: item.designation,
          nCas: item.nCas,
          classifSgh: item.classifSgh,
          pictogrammes: item.pictogrammes,
          voiesExposition: item.voiesExposition,
          mentionDanger: item.mentionDanger,
          mesuresPrevention: item.mesuresPrevention,
          niveauRisque: item.niveauRisque,
          dateEvaluation: item.dateEvaluation,
          dateRetrait: item.dateRetrait,
          codeSecteur: item.codeSecteur,
        };

        if (!active) {
          await tx.risqueChimiqueHistory.create({
            data: {
              entityId: randomUUID(),
              naturalKey: item.naturalKey,
              tenantId: ctx.tenantId,
              ...fields,
              ...versionColumns(now, "INSERT", ctx),
            },
          });
          report.created += 1;
        } else if (
          active.designation === item.designation &&
          active.nCas === item.nCas &&
          active.classifSgh === item.classifSgh &&
          active.pictogrammes === item.pictogrammes &&
          active.voiesExposition === item.voiesExposition &&
          active.mentionDanger === item.mentionDanger &&
          active.mesuresPrevention === item.mesuresPrevention &&
          active.niveauRisque === item.niveauRisque &&
          sameDay(active.dateEvaluation, item.dateEvaluation) &&
          sameDay(active.dateRetrait, item.dateRetrait) &&
          active.codeSecteur === item.codeSecteur
        ) {
          report.unchanged += 1;
        } else {
          await tx.risqueChimiqueHistory.update({
            where: { id: active.id },
            data: { validTo: now },
          });
          await tx.risqueChimiqueHistory.create({
            data: {
              entityId: active.entityId,
              naturalKey: item.naturalKey,
              tenantId: ctx.tenantId,
              ...fields,
              ...versionColumns(now, "UPDATE", ctx),
            },
          });
          report.updated += 1;
        }
      }
    });

    return report;
  }

  async findCurrentRisquesChimiques(
    tenantId: string,
    filter?: Pick<CurrentFilter, "sectors">,
    asOf?: Date,
  ): Promise<RisqueChimiqueItem[]> {
    const rows = await this.prisma.risqueChimiqueHistory.findMany({
      where: { tenantId, ...versionWhere(asOf) },
    });
    const keep = currentFilterPredicate(filter);
    return rows.filter(keep).map((r) => ({
      naturalKey: r.naturalKey,
      designation: r.designation,
      nCas: r.nCas,
      classifSgh: r.classifSgh,
      pictogrammes: r.pictogrammes,
      voiesExposition: r.voiesExposition,
      mentionDanger: r.mentionDanger,
      mesuresPrevention: r.mesuresPrevention,
      niveauRisque: r.niveauRisque,
      dateEvaluation: r.dateEvaluation,
      dateRetrait: r.dateRetrait,
      codeSecteur: r.codeSecteur,
    }));
  }

  // ------------------------------------------------------------------
  // DEGRE_EXPOSITION
  // ------------------------------------------------------------------

  async upsertDegresExposition(
    items: DegreExpositionItem[],
    ctx: WriteContext,
  ): Promise<UpsertReport> {
    const now = this.clock.now();
    const report: UpsertReport = { created: 0, updated: 0, unchanged: 0 };

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const active = await tx.degreExpositionHistory.findFirst({
          where: { tenantId: ctx.tenantId, naturalKey: item.naturalKey, validTo: null },
        });

        const fields = {
          matricule: item.matricule,
          nom: item.nom,
          prenom: item.prenom,
          codeSecteur: item.codeSecteur,
          nomProduit: item.nomProduit,
          degreExposition: item.degreExposition,
        };

        if (!active) {
          await tx.degreExpositionHistory.create({
            data: {
              entityId: randomUUID(),
              naturalKey: item.naturalKey,
              tenantId: ctx.tenantId,
              ...fields,
              ...versionColumns(now, "INSERT", ctx),
            },
          });
          report.created += 1;
        } else if (
          active.matricule === item.matricule &&
          active.nom === item.nom &&
          active.prenom === item.prenom &&
          active.codeSecteur === item.codeSecteur &&
          active.nomProduit === item.nomProduit &&
          active.degreExposition === item.degreExposition
        ) {
          report.unchanged += 1;
        } else {
          await tx.degreExpositionHistory.update({
            where: { id: active.id },
            data: { validTo: now },
          });
          await tx.degreExpositionHistory.create({
            data: {
              entityId: active.entityId,
              naturalKey: item.naturalKey,
              tenantId: ctx.tenantId,
              ...fields,
              ...versionColumns(now, "UPDATE", ctx),
            },
          });
          report.updated += 1;
        }
      }
    });

    return report;
  }

  async findCurrentDegresExposition(
    tenantId: string,
    filter?: CurrentFilter,
    asOf?: Date,
  ): Promise<DegreExpositionItem[]> {
    const rows = await this.prisma.degreExpositionHistory.findMany({
      where: { tenantId, ...versionWhere(asOf) },
    });
    const keep = currentFilterPredicate(filter);
    return rows.filter(keep).map((r) => ({
      naturalKey: r.naturalKey,
      matricule: r.matricule,
      nom: r.nom,
      prenom: r.prenom,
      codeSecteur: r.codeSecteur,
      nomProduit: r.nomProduit,
      degreExposition: r.degreExposition,
    }));
  }

  // ------------------------------------------------------------------
  // Rétention (purge des versions closes)
  // ------------------------------------------------------------------

  async purgeClosedBefore(
    tenantId: string,
    cutoff: Date,
    dryRun: boolean,
  ): Promise<PurgeReport> {
    // Versions CLOSES uniquement (validTo renseigné et antérieur au seuil) :
    // l'état courant (validTo null) n'est jamais supprimé.
    const where = { tenantId, validTo: { not: null, lt: cutoff } };
    if (dryRun) {
      const [personnel, risques, degres] = await Promise.all([
        this.prisma.personnelHistory.count({ where }),
        this.prisma.risqueChimiqueHistory.count({ where }),
        this.prisma.degreExpositionHistory.count({ where }),
      ]);
      return { personnel, risques, degres };
    }
    const [personnel, risques, degres] = await this.prisma.$transaction([
      this.prisma.personnelHistory.deleteMany({ where }),
      this.prisma.risqueChimiqueHistory.deleteMany({ where }),
      this.prisma.degreExpositionHistory.deleteMany({ where }),
    ]);
    return { personnel: personnel.count, risques: risques.count, degres: degres.count };
  }
}

/** Colonnes SCD2 communes à toute nouvelle version. */
function versionColumns(
  now: Date,
  operation: "INSERT" | "UPDATE",
  ctx: WriteContext,
): Pick<
  Prisma.PersonnelHistoryCreateInput,
  "validFrom" | "validTo" | "operation" | "recordedBy" | "recordedAt"
> {
  return {
    validFrom: now,
    validTo: null,
    operation,
    recordedBy: ctx.recordedBy,
    recordedAt: now,
  };
}

/**
 * Compare deux dates au JOUR près (les colonnes métier sont des @db.Date :
 * Postgres tronque déjà l'heure, mais l'item côté JS porte minuit UTC — on
 * compare donc sur la composante jour pour éviter de fausses différences).
 */
function sameDay(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/**
 * Filtre SCD2 « version active » — UNE seule définition, réutilisée par toutes
 * les lectures pour qu'on ne puisse pas l'oublier (les vues *_current de la
 * migration sont la même règle côté SQL ; ici c'est la version applicative).
 */
const CURRENT_VERSION = { validTo: null, operation: { not: "DELETE" } } as const;

/**
 * Clause WHERE « version d'une ligne logique à un instant donné ».
 *  - sans `asOf` : la version active (validTo IS NULL), hors soft-delete ;
 *  - avec `asOf` : la version dont l'intervalle [validFrom, validTo[ contient
 *    la date (intervalles SCD2 demi-ouverts et non chevauchants → au plus une
 *    version par entité). Permet de reconstituer l'état passé (conservation
 *    40 ans, ADR 0003).
 * Exportée pour test unitaire (la sémantique SQL elle-même se vérifie en
 * intégration, avec une vraie base).
 */
export function versionWhere(asOf?: Date): Record<string, unknown> {
  if (asOf === undefined) return { ...CURRENT_VERSION };
  return {
    operation: { not: "DELETE" },
    validFrom: { lte: asOf },
    OR: [{ validTo: null }, { validTo: { gt: asOf } }],
  };
}

/**
 * Prédicat row-level (RBAC) appliqué EN MÉMOIRE avec la MÊME normalisation que
 * la jointure du tableau de bord (casse + accents + espaces via normalizeText).
 *
 * Pourquoi pas en SQL : Prisma ne sait faire qu'un `mode: "insensitive"`
 * (casse seule), ce qui divergerait de normalizeText et filtrerait trop peu
 * (« Atelier » ≠ « Atélier »). On charge donc l'état courant du tenant puis on
 * filtre ici — cohérent avec la jointure applicative et ses volumes cibles ETI
 * (cf. buildDashboardRows). Upgrade path identique : colonne `codeSecteurNorm`
 * indexée + filtre SQL si les volumes l'exigent.
 */
function currentFilterPredicate(
  filter?: CurrentFilter,
): (row: { codeSecteur: string; matricule?: string | null }) => boolean {
  if (!filter) return () => true;
  const sectors =
    filter.sectors !== undefined ? new Set(filter.sectors.map(normalizeText)) : null;
  const matricule = filter.matricule !== undefined ? normalizeText(filter.matricule) : null;
  return (row) => {
    if (sectors !== null && !sectors.has(normalizeText(row.codeSecteur))) return false;
    if (
      matricule !== null &&
      (row.matricule === null ||
        row.matricule === undefined ||
        normalizeText(row.matricule) !== matricule)
    ) {
      return false;
    }
    return true;
  };
}
