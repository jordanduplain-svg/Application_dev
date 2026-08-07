-- Smoke test (manuel, dev uniquement) : la contrainte « une seule version
-- active par entityId » doit rejeter la seconde insertion.
-- Tout est annulé par le ROLLBACK : aucune donnée ne reste en base.
BEGIN;

INSERT INTO personnel_history
  ("entityId", "naturalKey", nom, prenom, "codeSecteur", "dateDebutSecteur",
   "validFrom", operation, "recordedAt")
VALUES
  ('11111111-1111-1111-1111-111111111111', 'TEST|S1|2020-01-01',
   'Test', 'Smoke', 'S1', '2020-01-01', now(), 'INSERT', now());

-- Cette seconde version ACTIVE du même entityId doit échouer
-- (index partiel personnel_history_one_active_version).
INSERT INTO personnel_history
  ("entityId", "naturalKey", nom, prenom, "codeSecteur", "dateDebutSecteur",
   "validFrom", operation, "recordedAt")
VALUES
  ('11111111-1111-1111-1111-111111111111', 'TEST|S1|2020-01-01b',
   'Test', 'Smoke', 'S1', '2020-01-01', now(), 'UPDATE', now());

ROLLBACK;
