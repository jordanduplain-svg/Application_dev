-- FM-08 : suivi d'entretien.
ALTER TABLE "Application" ADD COLUMN "interviewDate" DATETIME;
ALTER TABLE "Application" ADD COLUMN "interviewLocation" TEXT;
ALTER TABLE "Application" ADD COLUMN "interviewNotes" TEXT;
