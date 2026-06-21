-- SCRAPE-01 : données d'enrichissement entreprise issues du scraper
-- Ajout de region, activityDomain, companySize sur Company

ALTER TABLE "Company" ADD COLUMN "region"         TEXT;
ALTER TABLE "Company" ADD COLUMN "activityDomain" TEXT;
ALTER TABLE "Company" ADD COLUMN "companySize"    TEXT;
