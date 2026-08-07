-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'HSE', 'RH', 'MEDECINE', 'MANAGER', 'COLLABORATEUR');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "matricule" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_sectors" (
    "id" BIGSERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "codeSecteur" TEXT NOT NULL,

    CONSTRAINT "manager_sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "userId" UUID,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "manager_sectors_userId_codeSecteur_key" ON "manager_sectors"("userId", "codeSecteur");

-- CreateIndex
CREATE INDEX "audit_events_tenantId_at_idx" ON "audit_events"("tenantId", "at");

-- AddForeignKey
ALTER TABLE "manager_sectors" ADD CONSTRAINT "manager_sectors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
