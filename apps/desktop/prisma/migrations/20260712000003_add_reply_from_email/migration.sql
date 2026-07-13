-- REPLY-IN : adresse réelle d'où le recruteur a répondu (peut différer de l'email
-- scrapé). Permet d'envoyer ma réponse à la bonne adresse plutôt qu'au contact d'origine.
ALTER TABLE "Application" ADD COLUMN "replyFromEmail" TEXT;
