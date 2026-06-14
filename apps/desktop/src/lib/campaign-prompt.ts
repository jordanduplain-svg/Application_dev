/**
 * Choisit le prompt A ou la variante B (50/50) pour un test A/B.
 * FM-02 : retourne aussi le nom de la variante choisie pour traçabilité.
 */
export function pickCampaignPrompt(
  prompt: string,
  promptVariantB: string | null | undefined
): { prompt: string; variant: 'A' | 'B' } {
  if (promptVariantB && Math.random() < 0.5) {
    return { prompt: promptVariantB, variant: 'B' };
  }
  return { prompt, variant: 'A' };
}
