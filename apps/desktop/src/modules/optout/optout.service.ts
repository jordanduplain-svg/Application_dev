import { prisma } from '../../lib/prisma';
import { normalizeValue, detectKind, emailDomain, matchesOptOut } from './optout-match';
import type { OptOutEntry } from '@candio/shared';

/**
 * RGPD — liste « ne pas contacter » (opt-out / droit d'opposition).
 *
 * Deux granularités :
 *  - une adresse email précise (« john@acme.com »)
 *  - un domaine entier (« acme.com ») qui bloque toutes les adresses @acme.com
 *
 * La logique pure de correspondance vit dans ./optout-match (testable sans DB) ;
 * ce fichier ne porte que les accès Prisma.
 */

// matchesOptOut est réutilisé par company.service (filtrage des imports).
export { matchesOptOut };

function toEntry(row: { id: string; value: string; kind: string; reason: string | null; createdAt: Date }): OptOutEntry {
  return {
    id: row.id,
    value: row.value,
    kind: row.kind === 'domain' ? 'domain' : 'email',
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Toutes les entrées, les plus récentes d'abord. */
export async function listOptOuts(): Promise<OptOutEntry[]> {
  const rows = await prisma.optOut.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(toEntry);
}

/** Vrai si l'adresse donnée est dans la liste « ne pas contacter ». */
export async function isOptedOut(email: string): Promise<boolean> {
  const e = normalizeValue(email);
  if (!e) return false;
  const domain = emailDomain(e);
  // ← ROUAGE : on teste EN UNE requête l'adresse exacte ET son domaine nu. Un seul des deux
  //   présent dans la liste suffit à bloquer → couvre « john@acme.com » et « acme.com » d'un coup.
  const candidates = [e, ...(domain ? [domain] : [])];
  const hit = await prisma.optOut.findFirst({ where: { value: { in: candidates } } });
  return hit !== null;
}

/** Ajoute (ou met à jour la raison d') une entrée opt-out. Idempotent. */
export async function addOptOut(rawValue: string, reason?: string): Promise<OptOutEntry> {
  const value = normalizeValue(rawValue);
  if (!value) throw new Error('Valeur vide — saisis une adresse email ou un domaine.');
  const kind = detectKind(value);
  const row = await prisma.optOut.upsert({
    where: { value },
    update: { reason: reason ?? null },
    create: { value, kind, reason: reason ?? null },
  });
  return toEntry(row);
}

/** Retire une entrée (l'utilisateur la réautorise). */
export async function removeOptOut(id: string): Promise<void> {
  await prisma.optOut.delete({ where: { id } }).catch(() => { /* déjà absente */ });
}

/**
 * RGPD — droit à l'effacement. Pour une adresse donnée :
 *  1) on l'ajoute à la liste opt-out (ne sera plus jamais recontactée/réimportée) ;
 *  2) on supprime toutes les entreprises portant cette adresse (cascade →
 *     candidatures associées), toutes campagnes confondues.
 * Renvoie le nombre d'entreprises/candidatures effacées.
 */
export async function eraseContact(rawEmail: string, reason?: string): Promise<{ erased: number }> {
  const email = normalizeValue(rawEmail);
  if (!email || !email.includes('@')) {
    throw new Error('Saisis une adresse email complète à effacer.');
  }
  await addOptOut(email, reason ?? `Effacement RGPD demandé (${email})`);

  // Match insensible à la casse : on compare en minuscules côté JS car SQLite
  // n'applique pas de collation NOCASE par défaut sur ces colonnes.
  const companies = await prisma.company.findMany({ select: { id: true, contactEmail: true } });
  const targetIds = companies.filter((c) => c.contactEmail.trim().toLowerCase() === email).map((c) => c.id);
  if (targetIds.length === 0) return { erased: 0 };

  // ← ROUAGE de l'effacement : on supprime les Company ; la CASCADE Prisma (onDelete:
  //   Cascade sur Application.companyId) efface automatiquement les candidatures liées.
  //   Pas besoin de supprimer les candidatures à la main → cohérence garantie par le schéma.
  const result = await prisma.company.deleteMany({ where: { id: { in: targetIds } } });
  return { erased: result.count };
}
