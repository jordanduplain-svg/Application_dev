/**
 * Garde du filtre lieu des campagnes : cibler une région ne doit contacter QUE
 * cette région (accents/séparateurs ignorés) — jamais un lead hors zone.
 */
import { describe, test, expect } from 'vitest';
import { normLoc } from '../../lib/loc';

describe('normLoc (matching lieu campagne)', () => {
  test('région : accents et séparateurs ignorés', () => {
    expect(normLoc('Auvergne-Rhône-Alpes')).toBe(normLoc('auvergne rhone alpes'));
  });

  test('régions différentes ne matchent pas', () => {
    // Le bug d'origine : une campagne Auvergne-Rhône-Alpes contactait Pays de la Loire.
    expect(normLoc('Auvergne-Rhône-Alpes')).not.toBe(normLoc('Pays de la Loire'));
  });

  test('villes distinctes distinctes', () => {
    expect(normLoc('Nantes')).not.toBe(normLoc('Lyon'));
  });
});
