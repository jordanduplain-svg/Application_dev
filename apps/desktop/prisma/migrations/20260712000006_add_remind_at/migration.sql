-- REMIND-01 : rappel/snooze sur une candidature (« me rappeler de répondre le … »).
ALTER TABLE "Application" ADD COLUMN "remindAt" DATETIME;
CREATE INDEX "Application_remindAt_idx" ON "Application" ("remindAt");
