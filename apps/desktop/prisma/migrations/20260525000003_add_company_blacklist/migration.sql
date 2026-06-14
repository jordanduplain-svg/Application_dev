-- FM-06 : blacklist d'entreprise.
ALTER TABLE "Company" ADD COLUMN "blacklisted" INTEGER NOT NULL DEFAULT 0;
