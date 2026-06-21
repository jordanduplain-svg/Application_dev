-- AlterTable
-- AVAIL : disponibilité saisie de la campagne (texte libre, ex. « début octobre 2026 »).
-- Recopiée telle quelle dans la lettre (§4) pour éviter une date inventée par l'IA.
ALTER TABLE "Campaign" ADD COLUMN "availability" TEXT;
