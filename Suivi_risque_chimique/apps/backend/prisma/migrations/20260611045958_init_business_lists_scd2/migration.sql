-- CreateEnum
CREATE TYPE "HistoryOperation" AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "personnel_history" (
    "id" BIGSERIAL NOT NULL,
    "entityId" UUID NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "matricule" TEXT,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "fonction" TEXT,
    "codeSecteur" TEXT NOT NULL,
    "dateDebutSecteur" DATE NOT NULL,
    "dateFinSecteur" DATE,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "operation" "HistoryOperation" NOT NULL,
    "recordedBy" TEXT,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "personnel_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risque_chimique_history" (
    "id" BIGSERIAL NOT NULL,
    "entityId" UUID NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "designation" TEXT NOT NULL,
    "nCas" TEXT,
    "classifSgh" TEXT,
    "pictogrammes" TEXT,
    "voiesExposition" TEXT,
    "mentionDanger" TEXT,
    "mesuresPrevention" TEXT,
    "niveauRisque" TEXT,
    "dateEvaluation" DATE,
    "dateRetrait" DATE,
    "codeSecteur" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "operation" "HistoryOperation" NOT NULL,
    "recordedBy" TEXT,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "risque_chimique_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "degre_exposition_history" (
    "id" BIGSERIAL NOT NULL,
    "entityId" UUID NOT NULL,
    "naturalKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "matricule" TEXT,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "codeSecteur" TEXT NOT NULL,
    "nomProduit" TEXT NOT NULL,
    "degreExposition" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "operation" "HistoryOperation" NOT NULL,
    "recordedBy" TEXT,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "degre_exposition_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personnel_history_entityId_validFrom_idx" ON "personnel_history"("entityId", "validFrom");

-- CreateIndex
CREATE INDEX "personnel_history_tenantId_codeSecteur_idx" ON "personnel_history"("tenantId", "codeSecteur");

-- CreateIndex
CREATE INDEX "personnel_history_naturalKey_idx" ON "personnel_history"("naturalKey");

-- CreateIndex
CREATE INDEX "risque_chimique_history_entityId_validFrom_idx" ON "risque_chimique_history"("entityId", "validFrom");

-- CreateIndex
CREATE INDEX "risque_chimique_history_tenantId_codeSecteur_idx" ON "risque_chimique_history"("tenantId", "codeSecteur");

-- CreateIndex
CREATE INDEX "risque_chimique_history_naturalKey_idx" ON "risque_chimique_history"("naturalKey");

-- CreateIndex
CREATE INDEX "degre_exposition_history_entityId_validFrom_idx" ON "degre_exposition_history"("entityId", "validFrom");

-- CreateIndex
CREATE INDEX "degre_exposition_history_tenantId_codeSecteur_idx" ON "degre_exposition_history"("tenantId", "codeSecteur");

-- CreateIndex
CREATE INDEX "degre_exposition_history_naturalKey_idx" ON "degre_exposition_history"("naturalKey");

-- =====================================================================
-- Ajouts manuels (non exprimables dans le DSL Prisma) — NE PAS SUPPRIMER
-- lors d'une future migration. Référence : prisma/sql/*.sql
-- =====================================================================

-- =====================================================================
-- Index uniques partiels SCD2 â€” garantie Â« une seule version active par
-- ligne logique Â» (ADR 0003).
--
-- Pourquoi hors DSL Prisma : le schÃ©ma Prisma ne sait pas exprimer un
-- index partiel (clause WHERE). Ces index sont donc ajoutÃ©s Ã  la main
-- dans la migration initiale. Ce fichier est la RÃ‰FÃ‰RENCE versionnÃ©e de
-- leur dÃ©finition â€” si une migration future recrÃ©e ces tables, copier
-- ces dÃ©finitions.
--
-- Effet : toute tentative d'insÃ©rer une deuxiÃ¨me version active
-- (valid_to IS NULL) pour le mÃªme entity_id Ã©choue au niveau de la
-- base. C'est le filet de sÃ©curitÃ© ultime contre un bug de concurrence
-- dans le repository : mÃªme si deux imports tournent en parallÃ¨le, la
-- contrainte tient.
--
-- On contraint aussi la natural_key active par tenant : deux lignes
-- logiques distinctes ne peuvent pas revendiquer la mÃªme clÃ© mÃ©tier en
-- mÃªme temps (sinon le rapprochement d'import deviendrait ambigu).
-- =====================================================================

-- Une seule version active par affectation.
CREATE UNIQUE INDEX "personnel_history_one_active_version"
  ON "personnel_history" ("entityId")
  WHERE "validTo" IS NULL;

-- Une seule affectation active par clÃ© mÃ©tier (tenant inclus).
CREATE UNIQUE INDEX "personnel_history_active_natural_key"
  ON "personnel_history" ("tenantId", "naturalKey")
  WHERE "validTo" IS NULL;

CREATE UNIQUE INDEX "risque_chimique_history_one_active_version"
  ON "risque_chimique_history" ("entityId")
  WHERE "validTo" IS NULL;

CREATE UNIQUE INDEX "risque_chimique_history_active_natural_key"
  ON "risque_chimique_history" ("tenantId", "naturalKey")
  WHERE "validTo" IS NULL;

CREATE UNIQUE INDEX "degre_exposition_history_one_active_version"
  ON "degre_exposition_history" ("entityId")
  WHERE "validTo" IS NULL;

CREATE UNIQUE INDEX "degre_exposition_history_active_natural_key"
  ON "degre_exposition_history" ("tenantId", "naturalKey")
  WHERE "validTo" IS NULL;

-- =====================================================================
-- Vues Â« Ã©tat courant Â» â€” ADR 0003.
--
-- 99 % des requÃªtes (dashboard, exports, recherche) portent sur l'Ã©tat
-- actuel des listes. Ces vues encapsulent le filtre SCD2
-- (valid_to IS NULL + exclusion des soft-deletes) pour que le code
-- applicatif n'ait pas Ã  le rÃ©pÃ©ter â€” et ne puisse pas l'oublier.
--
-- Les versions closes par un DELETE logique n'ont pas de successeur :
-- filtrer valid_to IS NULL les exclut d'office. On exclut aussi par
-- prÃ©caution les lignes dont la DERNIÃˆRE opÃ©ration est DELETE (cas d'un
-- DELETE qui serait restÃ© actif suite Ã  un bug d'Ã©criture).
-- =====================================================================

CREATE VIEW "personnel_current" AS
  SELECT *
  FROM "personnel_history"
  WHERE "validTo" IS NULL AND "operation" <> 'DELETE';

CREATE VIEW "risque_chimique_current" AS
  SELECT *
  FROM "risque_chimique_history"
  WHERE "validTo" IS NULL AND "operation" <> 'DELETE';

CREATE VIEW "degre_exposition_current" AS
  SELECT *
  FROM "degre_exposition_history"
  WHERE "validTo" IS NULL AND "operation" <> 'DELETE';

