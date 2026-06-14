-- FM-05 : champs de contact complémentaires sur le profil.
ALTER TABLE "Profile" ADD COLUMN "phone" TEXT;
ALTER TABLE "Profile" ADD COLUMN "linkedin" TEXT;
ALTER TABLE "Profile" ADD COLUMN "portfolio" TEXT;
