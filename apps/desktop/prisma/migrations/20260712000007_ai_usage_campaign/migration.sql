-- COST-02 : regroupement du coût IA par campagne.
ALTER TABLE "AiUsage" ADD COLUMN "campaignId" TEXT;
