-- Coffre à secrets : identifiants chiffrés des connecteurs distants.
CREATE TABLE "connector_secrets" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "ref" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connector_secrets_tenantId_ref_key" ON "connector_secrets" ("tenantId", "ref");
