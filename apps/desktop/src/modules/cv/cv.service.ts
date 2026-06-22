import type { Cv as CvDTO, CvParsed } from '@candio/shared';
import type { Cv as DbCv } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

// CV-MULTI : gestion de plusieurs CV nommés (remplace le CV unique du profil).
//
// ROUAGE : un CV porte DEUX choses qui servent à des étages différents — `filePath` (le
// PDF, joint tel quel à l'email par le mailer) et `parsed` (le CV extrait en JSON par l'IA,
// injecté dans le prompt de generatePitch pour personnaliser la lettre). Une campagne
// pointe vers UN cv (campaign.cvId) → c'est ce lien qui décide quel CV part et quel profil
// nourrit la rédaction. `parsed` peut être corrompu en base → toDTO le parse défensivement.

function toDTO(c: DbCv): CvDTO {
  let parsed: CvParsed | null = null;
  if (c.parsed) {
    try { parsed = JSON.parse(c.parsed) as CvParsed; }
    catch { logger.warn(`[cv] parsed corrompu pour CV ${c.id} — ignoré`); }
  }
  return {
    id: c.id,
    name: c.name,
    hasFile: !!c.filePath,
    parsed,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listCvs(): Promise<CvDTO[]> {
  const rows = await prisma.cv.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map(toDTO);
}

export async function createCv(name: string): Promise<CvDTO> {
  const c = await prisma.cv.create({ data: { name: name.trim() || 'CV sans nom' } });
  return toDTO(c);
}

export async function renameCv(id: string, name: string): Promise<CvDTO> {
  const c = await prisma.cv.update({ where: { id }, data: { name: name.trim() || 'CV sans nom' } });
  return toDTO(c);
}

export async function deleteCv(id: string): Promise<string | null> {
  // Retourne le filePath supprimé pour que l'appelant nettoie le PDF sur disque.
  const existing = await prisma.cv.findUnique({ where: { id } });
  await prisma.cv.delete({ where: { id } });
  return existing?.filePath ?? null;
}

/** Renvoie le chemin du PDF précédent (à supprimer) puis enregistre le nouveau. */
export async function setCvFile(id: string, filePath: string): Promise<string | null> {
  const existing = await prisma.cv.findUnique({ where: { id } });
  await prisma.cv.update({ where: { id }, data: { filePath } });
  return existing?.filePath ?? null;
}

export async function setCvParsed(id: string, parsed: CvParsed): Promise<void> {
  await prisma.cv.update({ where: { id }, data: { parsed: JSON.stringify(parsed) } });
}

export async function getCv(id: string): Promise<DbCv | null> {
  return prisma.cv.findUnique({ where: { id } });
}
