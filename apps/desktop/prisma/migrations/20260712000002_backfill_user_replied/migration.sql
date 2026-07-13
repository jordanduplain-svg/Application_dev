-- REPLY-OUT backfill : l'utilisateur a déjà répondu à toutes les réponses reçues
-- existantes. On les marque « répondu » en datant ma réponse sur repliedAt (même
-- instant → badge vert ET tri par activité inchangé, pas de remontée artificielle).
-- Le contenu (myReplyContent) reste vide : ces réponses n'ont jamais été tracées.
-- One-shot : sur une base neuve, aucune ligne REPLIED → no-op.
UPDATE "Application"
SET "myRepliedAt" = "repliedAt"
WHERE "status" = 'REPLIED' AND "myRepliedAt" IS NULL AND "repliedAt" IS NOT NULL;
