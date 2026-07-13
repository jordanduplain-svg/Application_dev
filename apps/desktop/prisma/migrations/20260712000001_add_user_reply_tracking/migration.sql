-- REPLY-OUT : trace la réponse de l'utilisateur au recruteur (contenu + date d'envoi).
-- Sert à afficher ma réponse dans le fil et à calculer le badge Répondu / En attente.

ALTER TABLE "Application" ADD COLUMN "myReplyContent" TEXT;
ALTER TABLE "Application" ADD COLUMN "myRepliedAt"    DATETIME;
