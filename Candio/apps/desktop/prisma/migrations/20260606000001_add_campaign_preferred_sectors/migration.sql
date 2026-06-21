-- AlterTable
-- SECTOR-PREF : secteurs préférés de la campagne (CSV de clés, max 5). '' = tous.
ALTER TABLE "Campaign" ADD COLUMN "preferredSectors" TEXT NOT NULL DEFAULT '';
