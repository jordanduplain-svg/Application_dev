import { describe, test, expect } from 'vitest';
import { csvCell, csvLine } from '@candio/shared';

// Garde anti-injection de formule : une cellule commençant par = + - @ (ou tab/CR) est
// neutralisée par une apostrophe, sinon Excel/LibreOffice l'exécuteraient à l'ouverture.
describe('csvCell (échappement + anti-injection de formule)', () => {
  test('préfixe les cellules qui commencent par un caractère de formule', () => {
    // Le résultat est aussi quoté car il contient des virgules/guillemets.
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('=HYPERLINK("http://x","go")'))
      .toBe('"\'=HYPERLINK(""http://x"",""go"")"');   // préfixée PUIS quotée
  });

  test('laisse le texte normal intact et quote seulement si nécessaire', () => {
    expect(csvCell('Acme Corp')).toBe('Acme Corp');
    expect(csvCell('Doe, John')).toBe('"Doe, John"');   // virgule → quoté
    expect(csvCell(null)).toBe('');
  });

  test('csvLine assemble des cellules sûres', () => {
    expect(csvLine(['Acme', '=2', 'x'])).toBe("Acme,'=2,x");
  });
});
