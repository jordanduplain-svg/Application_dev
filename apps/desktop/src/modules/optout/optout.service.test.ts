import { describe, it, expect } from 'vitest';
import { normalizeValue, detectKind, emailDomain, matchesOptOut } from './optout-match';

describe('normalizeValue', () => {
  it('trim + minuscules', () => {
    expect(normalizeValue('  John@Acme.COM ')).toBe('john@acme.com');
  });
  it('retire le préfixe mailto:', () => {
    expect(normalizeValue('mailto:contact@acme.com')).toBe('contact@acme.com');
  });
  it('retire le @ de tête d\'un domaine saisi « @acme.com »', () => {
    expect(normalizeValue('@Acme.com')).toBe('acme.com');
  });
});

describe('detectKind', () => {
  it('email si @ présent', () => expect(detectKind('a@b.com')).toBe('email'));
  it('domaine sinon', () => expect(detectKind('acme.com')).toBe('domain'));
});

describe('emailDomain', () => {
  it('extrait le domaine', () => expect(emailDomain('a@acme.com')).toBe('acme.com'));
  it('null si pas d\'@', () => expect(emailDomain('acme.com')).toBeNull());
});

describe('matchesOptOut', () => {
  const entries = [
    { value: 'jean@acme.com', kind: 'email' },
    { value: 'blocked.com', kind: 'domain' },
  ];

  it('bloque une adresse email exacte (insensible à la casse)', () => {
    expect(matchesOptOut('Jean@Acme.com', entries)).toBe(true);
  });
  it('ne bloque pas une autre adresse du même domaine si seul l\'email est listé', () => {
    expect(matchesOptOut('marie@acme.com', entries)).toBe(false);
  });
  it('bloque toute adresse d\'un domaine listé', () => {
    expect(matchesOptOut('n.importe.qui@blocked.com', entries)).toBe(true);
    expect(matchesOptOut('autre@blocked.com', entries)).toBe(true);
  });
  it('ne bloque pas un domaine voisin', () => {
    expect(matchesOptOut('a@notblocked.com', entries)).toBe(false);
  });
  it('email vide → non bloqué', () => {
    expect(matchesOptOut('', entries)).toBe(false);
  });
});
