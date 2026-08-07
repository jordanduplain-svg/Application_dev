-- =====================================================================
-- Index uniques partiels SCD2 — garantie « une seule version active par
-- ligne logique » (ADR 0003).
--
-- Pourquoi hors DSL Prisma : le schéma Prisma ne sait pas exprimer un
-- index partiel (clause WHERE). Ces index sont donc ajoutés à la main
-- dans la migration initiale. Ce fichier est la RÉFÉRENCE versionnée de
-- leur définition — si une migration future recrée ces tables, copier
-- ces définitions.
--
-- Effet : toute tentative d'insérer une deuxième version active
-- (valid_to IS NULL) pour le même entity_id échoue au niveau de la
-- base. C'est le filet de sécurité ultime contre un bug de concurrence
-- dans le repository : même si deux imports tournent en parallèle, la
-- contrainte tient.
--
-- On contraint aussi la natural_key active par tenant : deux lignes
-- logiques distinctes ne peuvent pas revendiquer la même clé métier en
-- même temps (sinon le rapprochement d'import deviendrait ambigu).
-- =====================================================================

-- Une seule version active par affectation.
CREATE UNIQUE INDEX "personnel_history_one_active_version"
  ON "personnel_history" ("entityId")
  WHERE "validTo" IS NULL;

-- Une seule affectation active par clé métier (tenant inclus).
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
