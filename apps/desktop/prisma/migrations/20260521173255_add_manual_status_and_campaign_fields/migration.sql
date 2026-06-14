-- AlterTable
ALTER TABLE "Application" ADD COLUMN "manualStatus" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "promptVariantB" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "scheduledAt" DATETIME;
