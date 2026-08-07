-- CreateTable
CREATE TABLE "import_sources" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "listType" TEXT NOT NULL,
    "connectorType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flows" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMPTZ(3),
    "lastRunStatus" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_sources_tenantId_enabled_idx" ON "import_sources"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "flows_tenantId_enabled_idx" ON "flows"("tenantId", "enabled");
