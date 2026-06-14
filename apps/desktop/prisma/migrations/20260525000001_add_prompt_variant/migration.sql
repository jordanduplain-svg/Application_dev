-- FM-02 : ajout du champ promptVariant sur Application pour tracer quelle
-- variante de prompt A/B a été utilisée lors de la génération de l'email.
ALTER TABLE "Application" ADD COLUMN "promptVariant" TEXT;
