import { describe, it, expect } from 'vitest';
import { encryptBuffer, decryptBuffer } from './db-crypto';

describe('db-crypto (AES-256-GCM par mot de passe)', () => {
  const plain = Buffer.from('SQLite format 3\0— contenu de base de données arbitraire 🎯', 'utf8');
  const pass = 'mon-mot-de-passe-fort';

  it('round-trip : déchiffre exactement ce qui a été chiffré', () => {
    const enc = encryptBuffer(plain, pass);
    const dec = decryptBuffer(enc, pass);
    expect(dec.equals(plain)).toBe(true);
  });

  it('le conteneur chiffré diffère du clair et commence par le magic', () => {
    const enc = encryptBuffer(plain, pass);
    expect(enc.equals(plain)).toBe(false);
    expect(enc.subarray(0, 6).toString('ascii')).toBe('CJENC1');
  });

  it('deux chiffrements du même contenu diffèrent (sel/iv aléatoires)', () => {
    expect(encryptBuffer(plain, pass).equals(encryptBuffer(plain, pass))).toBe(false);
  });

  it('mauvais mot de passe ⇒ échec explicite', () => {
    const enc = encryptBuffer(plain, pass);
    expect(() => decryptBuffer(enc, 'mauvais-mot-de-passe')).toThrow(/incorrect|endommagé/);
  });

  it('contenu altéré ⇒ échec (authentification GCM)', () => {
    const enc = encryptBuffer(plain, pass);
    enc[enc.length - 1] ^= 0xff; // corrompt le dernier octet du ciphertext
    expect(() => decryptBuffer(enc, pass)).toThrow();
  });

  it('mot de passe trop court refusé au chiffrement', () => {
    expect(() => encryptBuffer(plain, 'court')).toThrow(/8 caractères/);
  });

  it('fichier non reconnu ⇒ erreur de format', () => {
    expect(() => decryptBuffer(Buffer.from('pas un backup chiffré du tout'), pass)).toThrow(/Format non reconnu|invalide/);
  });
});
