-- Transmission au SPST (décret 2024-307) : trace horodatée des transmissions.
CREATE TABLE "transmissions" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "at" TIMESTAMPTZ(3) NOT NULL,
    "userId" UUID,
    "kind" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "transmissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transmissions_tenantId_at_idx" ON "transmissions" ("tenantId", "at");
