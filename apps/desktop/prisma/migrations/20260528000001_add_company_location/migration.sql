-- SCRAPE-LOC : localisation structurée + secteur normalisé sur Company
-- Ajoutés par classification.py côté scraper (parse_location + classify_sector).
-- Tous nullables → migration additive sans risque de perte de données.

ALTER TABLE "Company" ADD COLUMN "country"           TEXT;
ALTER TABLE "Company" ADD COLUMN "regionAdmin"       TEXT;
ALTER TABLE "Company" ADD COLUMN "dept"              TEXT;
ALTER TABLE "Company" ADD COLUMN "deptName"          TEXT;
ALTER TABLE "Company" ADD COLUMN "city"              TEXT;
ALTER TABLE "Company" ADD COLUMN "sector"            TEXT;
ALTER TABLE "Company" ADD COLUMN "companySizeBucket" TEXT;
