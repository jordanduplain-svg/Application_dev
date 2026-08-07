-- =====================================================================
-- Vues « état courant » — ADR 0003.
--
-- 99 % des requêtes (dashboard, exports, recherche) portent sur l'état
-- actuel des listes. Ces vues encapsulent le filtre SCD2
-- (valid_to IS NULL + exclusion des soft-deletes) pour que le code
-- applicatif n'ait pas à le répéter — et ne puisse pas l'oublier.
--
-- Les versions closes par un DELETE logique n'ont pas de successeur :
-- filtrer valid_to IS NULL les exclut d'office. On exclut aussi par
-- précaution les lignes dont la DERNIÈRE opération est DELETE (cas d'un
-- DELETE qui serait resté actif suite à un bug d'écriture).
-- =====================================================================

CREATE VIEW "personnel_current" AS
  SELECT *
  FROM "personnel_history"
  WHERE "validTo" IS NULL AND "operation" <> 'DELETE';

CREATE VIEW "risque_chimique_current" AS
  SELECT *
  FROM "risque_chimique_history"
  WHERE "validTo" IS NULL AND "operation" <> 'DELETE';

CREATE VIEW "degre_exposition_current" AS
  SELECT *
  FROM "degre_exposition_history"
  WHERE "validTo" IS NULL AND "operation" <> 'DELETE';
