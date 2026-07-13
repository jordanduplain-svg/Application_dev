-- THREAD-01 : fil de conversation complet (messages entrants + sortants).
CREATE TABLE "Message" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "applicationId" TEXT NOT NULL,
  "direction"     TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "fromEmail"     TEXT,
  "messageId"     TEXT,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Message_applicationId_idx" ON "Message" ("applicationId");

-- COST-01 : journal des appels IA (une ligne par génération).
CREATE TABLE "AiUsage" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "at"               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "model"            TEXT NOT NULL,
  "kind"             TEXT NOT NULL,
  "promptTokens"     INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "applicationId"    TEXT
);
CREATE INDEX "AiUsage_at_idx" ON "AiUsage" ("at");
