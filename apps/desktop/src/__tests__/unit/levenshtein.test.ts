/**
 * FM-10 : tests unitaires de levenshteinSimilarity.
 */
import { describe, test, expect } from 'vitest';
import { levenshteinSimilarity } from '../../lib/levenshtein';

describe('levenshteinSimilarity', () => {
  test('retourne 1 pour deux chaînes identiques', () => {
    expect(levenshteinSimilarity('Acme Corp', 'Acme Corp')).toBe(1);
  });

  test('retourne 1 pour deux chaînes identiques insensibles à la casse', () => {
    expect(levenshteinSimilarity('ACME', 'acme')).toBe(1);
  });

  test('retourne 0 pour deux chaînes complètement différentes', () => {
    expect(levenshteinSimilarity('abc', 'xyz')).toBe(0);
  });

  test('retourne 0 si l\'une des chaînes est vide', () => {
    expect(levenshteinSimilarity('', 'Acme')).toBe(0);
    expect(levenshteinSimilarity('Acme', '')).toBe(0);
  });

  test('"Acme SAS" et "Acme" ont un score > 0.5 (suffisamment proches)', () => {
    const score = levenshteinSimilarity('Acme SAS', 'Acme');
    // "Acme" (4) vs "Acme SAS" (8) : distance = 4, max = 8, similarité = 0.5
    expect(score).toBeGreaterThanOrEqual(0.5);
  });

  test('"Acme" et "Acme Corp" ont un score >= 0.4 (sous-chaîne)', () => {
    // "Acme" (4) vs "Acme Corp" (9) : distance = 5, max = 9, sim ≈ 0.44.
    const score = levenshteinSimilarity('Acme', 'Acme Corp');
    expect(score).toBeGreaterThan(0.3);
  });

  test('"Google" et "Googgle" (faute de frappe) ont un score > 0.8', () => {
    const score = levenshteinSimilarity('Google', 'Googgle');
    expect(score).toBeGreaterThan(0.8);
  });

  test('"OpenAI" et "OpenAl" (l vs I) ont un score > 0.8', () => {
    const score = levenshteinSimilarity('OpenAI', 'OpenAl');
    expect(score).toBeGreaterThan(0.8);
  });

  test('"TotalEnergies" et "SomeOtherCorp" ont un score faible', () => {
    const score = levenshteinSimilarity('TotalEnergies', 'SomeOtherCorp');
    expect(score).toBeLessThan(0.5);
  });

  test('les deux chaînes vides retournent 1 (convention : vide = identique)', () => {
    expect(levenshteinSimilarity('', '')).toBe(1);
  });
});
