import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Rôle : Chiffrement/déchiffrement symétrique des données sensibles
 * (notamment les mots de passe SMTP des utilisateurs stockés en base).
 *
 * Algorithme : AES-256-GCM (chiffrement authentifié — détecte toute
 * altération du message via le tag d'authentification).
 */

const ALGORITHM = 'aes-256-gcm';
// AES-256-GCM utilise un IV (vecteur d'initialisation) de 16 octets,
// généré aléatoirement pour chaque chiffrement.
const IV_LENGTH = 16;

// AES-256 exige une clé de EXACTEMENT 32 octets. On dérive cette clé via
// SHA-256 à partir de `ENCRYPTION_KEY` : le résultat fait toujours 32 octets,
// quelle que soit la longueur ou l'encodage de la variable d'environnement
// (un `Buffer.from(str)` direct produirait ≠ 32 octets avec des caractères
// non-ASCII, ce qui ferait planter le chiffrement).
const KEY = crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest();

/**
 * Chiffre un texte en clair.
 * @returns une chaîne au format `iv:tag:données` (chaque partie en hexadécimal).
 */
export function encryptSymmetric(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  // Le tag d'authentification garantit l'intégrité au déchiffrement.
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Déchiffre une chaîne produite par `encryptSymmetric`.
 * Lève une erreur explicite si le format est invalide : on préfère échouer
 * franchement plutôt que de renvoyer silencieusement une donnée non déchiffrée
 * (ce qui, par ex., ferait tenter une connexion SMTP avec un mot de passe erroné).
 */
export function decryptSymmetric(encryptedText: string): string {
  const [ivHex, tagHex, encryptedData] = encryptedText.split(':');
  if (!ivHex || !tagHex || !encryptedData) {
    throw new Error('Format de données chiffrées invalide (attendu: iv:tag:données)');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
