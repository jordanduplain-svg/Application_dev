-- UX-6 : ajout de la colonne archivedAt pour l'archivage des campagnes.
ALTER TABLE "Campaign" ADD COLUMN "archivedAt" DATETIME;
