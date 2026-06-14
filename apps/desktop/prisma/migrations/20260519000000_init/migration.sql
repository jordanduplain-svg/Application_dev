-- Migration initiale — création des 4 tables (SQLite).

-- CreateTable : profil unique de l'utilisateur.
CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "emailSender" TEXT,
    "cvPath" TEXT,
    "cvParsed" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable : campagnes de recherche.
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "contractTypes" TEXT NOT NULL,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable : entreprises cibles d'une campagne.
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT,
    "contactRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Company_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable : candidatures (email généré + suivi).
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "messageId" TEXT,
    "sentAt" DATETIME,
    "repliedAt" DATETIME,
    "replyContent" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Application_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex : une seule candidature par entreprise cible.
CREATE UNIQUE INDEX "Application_companyId_key" ON "Application"("companyId");
CREATE INDEX "Company_campaignId_idx" ON "Company"("campaignId");
CREATE INDEX "Application_campaignId_idx" ON "Application"("campaignId");
CREATE INDEX "Application_status_idx" ON "Application"("status");
