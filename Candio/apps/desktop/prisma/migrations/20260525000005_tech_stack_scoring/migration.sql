-- SCRAPE-02 : stack technique et scores de pertinence/fraîcheur.
-- SQLite : on ajoute les colonnes avec DEFAULT pour éviter un NOT NULL sans défaut.

ALTER TABLE "Company" ADD COLUMN "techStack"      TEXT    NOT NULL DEFAULT '[]';
ALTER TABLE "Company" ADD COLUMN "freshnessScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Company" ADD COLUMN "relevanceScore" INTEGER NOT NULL DEFAULT 0;
