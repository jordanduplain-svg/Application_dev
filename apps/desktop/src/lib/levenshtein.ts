/**
 * Calcule la similarité normalisée de Levenshtein entre deux chaînes.
 * Normalise en lowercase. Retourne 1 - distance / max(len(a), len(b)).
 * 1.0 = identique, 0.0 = complètement différent.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Matrice dp[i][j] = distance entre s1[0..i-1] et s2[0..j-1].
  const rows = s1.length + 1;
  const cols = s2.length + 1;
  const dp: number[] = new Array(rows * cols).fill(0);

  // Initialisation : transformer chaîne vide.
  for (let i = 0; i < rows; i++) dp[i * cols] = i;
  for (let j = 0; j < cols; j++) dp[j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i * cols + j] = Math.min(
        dp[(i - 1) * cols + j] + 1,     // suppression
        dp[i * cols + (j - 1)] + 1,     // insertion
        dp[(i - 1) * cols + (j - 1)] + cost // substitution
      );
    }
  }

  const distance = dp[(rows - 1) * cols + (cols - 1)];
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - distance / maxLen;
}
