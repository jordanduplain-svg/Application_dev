-- Supprimer les doublons (email identique dans la même campagne) avant la contrainte unique.
DELETE FROM "Company"
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM "Company"
  GROUP BY "campaignId", LOWER("contactEmail")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_campaignId_contactEmail_key" ON "Company"("campaignId", "contactEmail");
