-- RGPD : liste « ne pas contacter » (opt-out global, persistant).
-- CreateTable
CREATE TABLE "OptOut" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "OptOut_value_key" ON "OptOut"("value");
