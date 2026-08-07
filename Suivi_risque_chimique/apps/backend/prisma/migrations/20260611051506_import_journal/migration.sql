-- CreateEnum
CREATE TYPE "ImportRunStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "listType" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "status" "ImportRunStatus" NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3) NOT NULL,
    "rowsRead" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "unchanged" INTEGER NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_anomalies" (
    "id" BIGSERIAL NOT NULL,
    "runId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "field" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "import_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_tenantId_startedAt_idx" ON "import_runs"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "import_anomalies_runId_idx" ON "import_anomalies"("runId");

-- AddForeignKey
ALTER TABLE "import_anomalies" ADD CONSTRAINT "import_anomalies_runId_fkey" FOREIGN KEY ("runId") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
