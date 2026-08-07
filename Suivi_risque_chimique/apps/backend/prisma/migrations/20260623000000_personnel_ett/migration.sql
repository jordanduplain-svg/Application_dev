-- Intérimaires (décret 2024-307) : entreprise de travail temporaire (ETT)
-- portée par l'affectation PERSONNEL. NULL = salarié de l'entreprise utilisatrice.
ALTER TABLE "personnel_history" ADD COLUMN "entrepriseTravailTemporaire" TEXT;
