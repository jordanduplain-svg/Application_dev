import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

/**
 * Chiffrement de sauvegarde portable, par mot de passe (AES-256-GCM).
 *
 * Contrairement à safeStorage/DPAPI (lié à la machine + au compte Windows),
 * ce format est déchiffrable sur n'importe quel poste tant qu'on connaît le
 * mot de passe — adapté à une sauvegarde qu'on déplace ou archive.
 *
 * Format binaire :
 *   MAGIC(6) | version(1) | salt(16) | iv(12) | authTag(16) | ciphertext(…)
 *
 * La clé est dérivée par scrypt (résistant au brute-force matériel) ; GCM
 * fournit l'authentification (un mauvais mot de passe ⇒ échec de déchiffrement,
 * pas de données corrompues silencieuses).
 */

const MAGIC = Buffer.from('CJENC1', 'ascii'); // Carreer-ops Job ENCryption v1
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
// Paramètres scrypt (N=2^15) : ~tens of ms, raisonnable pour une action manuelle.
const SCRYPT_COST = 32768;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, { N: SCRYPT_COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** Chiffre un buffer en clair avec un mot de passe. Retourne le conteneur complet. */
export function encryptBuffer(plain: Buffer, passphrase: string): Buffer {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Mot de passe trop court (8 caractères minimum).');
  }
  // ← ROUAGE sécurité : salt ALÉATOIRE par sauvegarde → deux backups du même fichier avec
  //   le même mot de passe donnent des clés/chiffrés différents (pas de table de correspondance).
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);   // scrypt : lent à dessein → brute-force coûteux
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  // getAuthTag = sceau d'intégrité : au déchiffrement, un mauvais mot de passe ou 1 octet
  // altéré fait échouer final() → on ne rend JAMAIS de données corrompues silencieusement.
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, tag, ciphertext]);
}

/** Déchiffre un conteneur produit par encryptBuffer. Lève si le mot de passe est faux ou le fichier altéré. */
export function decryptBuffer(container: Buffer, passphrase: string): Buffer {
  const headerLen = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN;
  if (container.length < headerLen) {
    throw new Error('Fichier de sauvegarde chiffré invalide (trop court).');
  }
  if (!container.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Format non reconnu — ce n\'est pas une sauvegarde chiffrée Carreer-ops.');
  }
  let offset = MAGIC.length;
  const version = container[offset]; offset += 1;
  if (version !== VERSION) {
    throw new Error(`Version de sauvegarde non supportée (${version}).`);
  }
  const salt = container.subarray(offset, offset + SALT_LEN); offset += SALT_LEN;
  const iv = container.subarray(offset, offset + IV_LEN); offset += IV_LEN;
  const tag = container.subarray(offset, offset + TAG_LEN); offset += TAG_LEN;
  const ciphertext = container.subarray(offset);

  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM final() échoue si le mot de passe est faux ou le contenu altéré.
    throw new Error('Déchiffrement impossible — mot de passe incorrect ou fichier endommagé.');
  }
}
