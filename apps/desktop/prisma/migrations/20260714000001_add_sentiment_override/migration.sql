-- SENTIMENT-OVR : correction manuelle du sentiment détecté (positive/rejection/neutral).
ALTER TABLE "Application" ADD COLUMN "sentimentOverride" TEXT;
