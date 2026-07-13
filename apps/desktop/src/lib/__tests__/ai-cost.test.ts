/**
 * COST-01 : grille de prix IA (fonctions pures, sans Electron/DB). Chemin « argent »
 * → un test garde-fou : si un tarif ou un mapping de modèle casse, le coût affiché dévie.
 */
import { describe, test, expect } from 'vitest';
import { priceFor, estimateCostUsd } from '../ai-cost';

describe('ai-cost', () => {
  test('mappe les modèles cloud connus', () => {
    expect(priceFor('claude-sonnet-4-6')).toEqual({ in: 3, out: 15 });
    expect(priceFor('claude-haiku-4-5')).toEqual({ in: 1, out: 5 });
    expect(priceFor('gpt-4o-mini')).toEqual({ in: 0.15, out: 0.6 });
    expect(priceFor('gpt-4o')).toEqual({ in: 2.5, out: 10 });
  });

  test('gpt-4o-mini ne matche PAS la règle gpt-4o (ordre de priorité)', () => {
    // La règle mini est avant gpt-4o dans la grille → sinon mini serait facturé 16× trop cher.
    expect(priceFor('gpt-4o-mini')).not.toEqual(priceFor('gpt-4o'));
  });

  test('modèle local/inconnu → gratuit', () => {
    expect(priceFor('qwen2.5-coder:7b')).toBeNull();
    expect(estimateCostUsd('qwen2.5-coder:7b', 100000, 100000)).toBe(0);
  });

  test('coût = tokens × tarif / 1M', () => {
    // Sonnet 4.6 : 2000 in ($3/M) + 250 out ($15/M) = 0.006 + 0.00375 = 0.00975
    expect(estimateCostUsd('claude-sonnet-4-6', 2000, 250)).toBeCloseTo(0.00975, 6);
  });
});
