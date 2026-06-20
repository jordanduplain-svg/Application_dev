import type { Profile, ProfileInput, CvParsed } from '@candio/shared';
import type { Profile as DbProfile } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

// Gestion du profil unique de l'utilisateur (une seule ligne en base).

function toDTO(p: DbProfile): Profile {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    emailSender: p.emailSender,
    cvPath: p.cvPath,
    // M5 (revue 7) : JSON.parse sans try/catch crashe toute la page si la
    // valeur en base est corrompue. On log + on renvoie null plutôt que de bloquer.
    cvParsed: p.cvParsed
      ? (() => {
          try { return JSON.parse(p.cvParsed!) as CvParsed; }
          catch { logger.warn('[profile] cvParsed corrompu en base — ignoré'); return null; }
        })()
      : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    // FM-05 : champs de contact complémentaires.
    phone: (p as DbProfile & { phone?: string | null }).phone ?? null,
    linkedin: (p as DbProfile & { linkedin?: string | null }).linkedin ?? null,
    portfolio: (p as DbProfile & { portfolio?: string | null }).portfolio ?? null,
    // PROFILE-GH : GitHub perso.
    github: (p as DbProfile & { github?: string | null }).github ?? null,
  };
}

export async function getProfile(): Promise<Profile | null> {
  const p = await prisma.profile.findFirst();
  return p ? toDTO(p) : null;
}

/**
 * Crée le profil au premier appel, le met à jour ensuite.
 *
 * L3 : la séquence findFirst() → create() a une race TOCTOU théorique : deux
 * appels simultanés peuvent tous deux voir null et tenter un create(). On
 * attrape P2002 (unique constraint) sur le create pour réessayer avec update.
 */
export async function updateProfile(input: ProfileInput): Promise<Profile> {
  // FM-05 : inclure les nouveaux champs de contact s'ils sont fournis.
  const data = {
    firstName: input.firstName,
    lastName: input.lastName,
    emailSender: input.emailSender,
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.linkedin !== undefined ? { linkedin: input.linkedin } : {}),
    ...(input.portfolio !== undefined ? { portfolio: input.portfolio } : {}),
    ...(input.github !== undefined ? { github: input.github } : {}),
  };

  const existing = await prisma.profile.findFirst();
  if (existing) {
    const p = await prisma.profile.update({ where: { id: existing.id }, data });
    return toDTO(p);
  }
  try {
    const p = await prisma.profile.create({ data });
    return toDTO(p);
  } catch (err) {
    // L3 : race — un autre appel a créé le profil entre notre findFirst et notre create.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const p2 = await prisma.profile.findFirst();
      if (!p2) throw err; // Ne devrait pas arriver, mais on relance si c'est le cas.
      const p3 = await prisma.profile.update({ where: { id: p2.id }, data });
      return toDTO(p3);
    }
    throw err;
  }
}

export async function setCvParsed(parsed: CvParsed): Promise<void> {
  const existing = await prisma.profile.findFirst();
  if (!existing) throw new Error('Profil inexistant');
  await prisma.profile.update({
    where: { id: existing.id },
    data: { cvParsed: JSON.stringify(parsed) },
  });
}

