-- THREAD-01 backfill : reconstruit le fil à partir des champs mono-message existants.
-- Réponse reçue (replyContent) → message ENTRANT daté sur repliedAt.
-- Ma réponse (myReplyContent) → message SORTANT daté sur myRepliedAt.
-- messageId laissé vide : ces messages sortent de la fenêtre de polling → jamais re-scannés.
INSERT INTO "Message" ("id", "applicationId", "direction", "body", "fromEmail", "messageId", "createdAt")
SELECT lower(hex(randomblob(16))), "id", 'IN', "replyContent", "replyFromEmail", NULL,
       COALESCE("repliedAt", "updatedAt")
FROM "Application"
WHERE "replyContent" IS NOT NULL AND "replyContent" <> '';

INSERT INTO "Message" ("id", "applicationId", "direction", "body", "fromEmail", "messageId", "createdAt")
SELECT lower(hex(randomblob(16))), "id", 'OUT', "myReplyContent", NULL, NULL,
       COALESCE("myRepliedAt", "updatedAt")
FROM "Application"
WHERE "myReplyContent" IS NOT NULL AND "myReplyContent" <> '';
