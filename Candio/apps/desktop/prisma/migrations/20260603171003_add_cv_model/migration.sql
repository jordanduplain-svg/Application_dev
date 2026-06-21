/*
  Warnings:

  - You are about to alter the column `blacklisted` on the `Company` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Boolean`.

*/
-- CreateTable
CREATE TABLE "Cv" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "filePath" TEXT,
    "parsed" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "contractTypes" TEXT NOT NULL,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "archivedAt" DATETIME,
    "notes" TEXT,
    "scheduledAt" DATETIME,
    "promptVariantB" TEXT,
    "cvId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "Cv" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Campaign" ("archivedAt", "contractTypes", "createdAt", "id", "jobTitle", "location", "name", "notes", "prompt", "promptVariantB", "salaryMax", "salaryMin", "scheduledAt", "status", "updatedAt") SELECT "archivedAt", "contractTypes", "createdAt", "id", "jobTitle", "location", "name", "notes", "prompt", "promptVariantB", "salaryMax", "salaryMin", "scheduledAt", "status", "updatedAt" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT,
    "contactRole" TEXT,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "emailSource" TEXT NOT NULL DEFAULT 'manual',
    "emailAlternatives" TEXT NOT NULL DEFAULT '[]',
    "region" TEXT,
    "activityDomain" TEXT,
    "companySize" TEXT,
    "country" TEXT,
    "regionAdmin" TEXT,
    "dept" TEXT,
    "deptName" TEXT,
    "city" TEXT,
    "sector" TEXT,
    "companySizeBucket" TEXT,
    "techStack" TEXT NOT NULL DEFAULT '[]',
    "freshnessScore" INTEGER NOT NULL DEFAULT 0,
    "relevanceScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Company_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Company" ("activityDomain", "blacklisted", "campaignId", "city", "companySize", "companySizeBucket", "contactEmail", "contactName", "contactRole", "country", "createdAt", "dept", "deptName", "emailAlternatives", "emailSource", "freshnessScore", "id", "name", "region", "regionAdmin", "relevanceScore", "sector", "techStack", "website") SELECT "activityDomain", "blacklisted", "campaignId", "city", "companySize", "companySizeBucket", "contactEmail", "contactName", "contactRole", "country", "createdAt", "dept", "deptName", "emailAlternatives", "emailSource", "freshnessScore", "id", "name", "region", "regionAdmin", "relevanceScore", "sector", "techStack", "website" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE INDEX "Company_campaignId_idx" ON "Company"("campaignId");
CREATE UNIQUE INDEX "Company_campaignId_contactEmail_key" ON "Company"("campaignId", "contactEmail");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
