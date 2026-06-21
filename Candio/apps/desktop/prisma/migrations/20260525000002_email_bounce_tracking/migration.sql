-- BOUNCE-01 : email bounce tracking + source de l'email scrappé
-- Ajout de emailSource et emailAlternatives sur Company
-- Ajout de emailBounced et emailBouncedAt sur Application

ALTER TABLE "Company" ADD COLUMN "emailSource"      TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Company" ADD COLUMN "emailAlternatives" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "Application" ADD COLUMN "emailBounced"   BOOLEAN  NOT NULL DEFAULT false;
ALTER TABLE "Application" ADD COLUMN "emailBouncedAt" DATETIME;
