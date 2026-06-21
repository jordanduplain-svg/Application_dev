import { readFile } from 'fs/promises';
import pdfParse from 'pdf-parse';

/**
 * Extrait le texte brut d'un fichier PDF.
 *
 * Limite connue : un PDF scanné (pages = images) ne contient pas de texte
 * sélectionnable → l'extraction renvoie une chaîne vide. L'appelant doit le
 * détecter et prévenir l'utilisateur (pas d'OCR en v1).
 */
export async function extractPdfText(pdfPath: string): Promise<string> {
  const buffer = await readFile(pdfPath);
  const data = await pdfParse(buffer);
  return data.text;
}
