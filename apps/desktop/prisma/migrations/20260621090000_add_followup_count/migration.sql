-- FOLLOWUP-N : relances multiples (cadence 7 j). Compteur de relances déjà envoyées.
-- AlterTable
ALTER TABLE "Application" ADD COLUMN "followUpCount" INTEGER NOT NULL DEFAULT 0;
