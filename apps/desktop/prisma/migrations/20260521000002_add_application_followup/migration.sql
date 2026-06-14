-- UX-10 : note de suivi manuelle dans la page Réponses.
ALTER TABLE "Application" ADD COLUMN "followUpNote" TEXT;
-- UX-12 : date d'envoi de la relance automatique.
ALTER TABLE "Application" ADD COLUMN "followUpSentAt" DATETIME;
