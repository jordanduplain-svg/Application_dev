/**
 * COST-01 : suivi du coût des appels IA (génération de mails, lettres, fiches…).
 *
 * - `recordAiUsage` journalise une ligne par appel (best-effort, jamais bloquant).
 * - Le prix est calculé À LA LECTURE depuis une grille modèle → $/1M tokens : ça reste
 *   juste même si les tarifs bougent, et les appels locaux (Ollama/Groq gratuit) coûtent 0.
 */

type Price = { in: number; out: number }; // dollars par million de tokens

// Grille (ordre = priorité de match). Modèles locaux/gratuits absents → coût 0.
const PRICES: [RegExp, Price][] = [
  [/sonnet-?4[.-]?6/i, { in: 3, out: 15 }],
  [/sonnet-?5/i, { in: 3, out: 15 }],
  [/haiku/i, { in: 1, out: 5 }],
  [/opus/i, { in: 5, out: 25 }],
  [/gpt-4o-mini/i, { in: 0.15, out: 0.6 }],
  [/gpt-4o/i, { in: 2.5, out: 10 }],
  [/gemini.*flash/i, { in: 0.075, out: 0.3 }],
  [/gemini/i, { in: 1.25, out: 5 }],
];

/** Prix du modèle, ou null si inconnu/local (→ gratuit). */
export function priceFor(model: string): Price | null {
  for (const [re, p] of PRICES) if (re.test(model)) return p;
  return null;
}

/** Coût estimé en dollars d'un appel (0 si modèle local/inconnu). */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = priceFor(model);
  if (!p) return 0;
  return (promptTokens * p.in + completionTokens * p.out) / 1_000_000;
}

/** Usage renvoyé par le SDK OpenAI-compatible (OpenAI, Anthropic, Gemini, Groq, Ollama). */
export interface CompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * Journalise un appel IA. Best-effort : une erreur DB ne doit jamais casser la génération.
 */
export async function recordAiUsage(
  kind: string,
  model: string,
  usage: CompletionUsage | null | undefined,
  opts?: { applicationId?: string | null; campaignId?: string | null },
): Promise<void> {
  try {
    // Import PARESSEUX : prisma tire electron (app.getPath) au chargement du module ;
    // le garder lazy évite de coupler les fonctions pures (priceFor/estimateCostUsd,
    // testées sans Electron) et le pipeline IA à ce module principal.
    const { prisma } = await import('./prisma');
    await prisma.aiUsage.create({
      data: {
        kind,
        model,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        applicationId: opts?.applicationId ?? null,
        campaignId: opts?.campaignId ?? null,
      },
    });
  } catch (err) {
    const { logger } = await import('./logger');
    logger.warn('[ai-cost] Journalisation de l\'usage IA échouée (non bloquant)', err);
  }
}
