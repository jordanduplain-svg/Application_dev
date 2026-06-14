import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * Rôle : Stockage des fichiers (CV des utilisateurs).
 *
 * ⚠️ Implémentation MOCKÉE : les fichiers sont écrits sur le disque local
 * (dossier `uploads/`) au lieu d'un bucket Cloudflare R2 / AWS S3.
 *
 * Les fonctions manipulent un IDENTIFIANT de fichier (nom de fichier opaque),
 * jamais un chemin absolu : le chemin serveur ne doit pas fuiter en base ni
 * vers le client (il est stocké tel quel dans `User.cvUrl` et renvoyé par
 * `GET /me`). En production, `uploadToR2` renverrait la clé d'objet R2.
 */

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

/**
 * Enregistre un fichier et renvoie son identifiant (nom de fichier).
 * @param buffer       contenu binaire du fichier
 * @param originalName nom d'origine (sert à récupérer l'extension)
 */
export async function uploadToR2(buffer: Buffer, originalName: string): Promise<string> {
  // Nom de fichier aléatoire : évite les collisions et n'expose pas le nom
  // d'origine fourni par l'utilisateur.
  const uuid = randomUUID();
  const ext = (originalName.split('.').pop() || 'pdf').toLowerCase();
  const fileName = `${uuid}.${ext}`;

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, fileName), buffer);

  return fileName; // En prod : la clé d'objet R2.
}

/**
 * Récupère le contenu binaire d'un fichier précédemment stocké.
 * `path.basename` : défense en profondeur contre un éventuel path traversal
 * si la référence venait à être altérée.
 */
export async function downloadFromR2(fileRef: string): Promise<Buffer> {
  return fs.readFile(path.join(UPLOAD_DIR, path.basename(fileRef)));
}

/**
 * Supprime un fichier précédemment stocké (ex : CV, lors de la suppression
 * d'un compte — RGPD). Tolérant : si le fichier a déjà disparu, on n'échoue
 * pas (la suppression du compte doit aboutir quand même).
 */
export async function deleteFromR2(fileRef: string): Promise<void> {
  try {
    await fs.unlink(path.join(UPLOAD_DIR, path.basename(fileRef)));
  } catch (err: any) {
    // ENOENT = fichier déjà absent : cas non bloquant.
    if (err?.code !== 'ENOENT') throw err;
  }
}
