import type { Application, ApplicationStatus } from '@candio/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

// Gestion des candidatures : email généré + suivi de statut.

// La candidature porte toujours les infos de son entreprise (nom, email).
type AppWithCompany = Prisma.ApplicationGetPayload<{ include: { company: true } }>;
const includeCompany = { company: true } as const;

// Aplati l'entreprise dans le DTO pour simplifier l'affichage côté UI.
function toDTO(a: AppWithCompany): Application {
  return {
    id: a.id,
    campaignId: a.campaignId,
    companyId: a.companyId,
    companyName: a.company.name,
    contactEmail: a.company.contactEmail,
    subject: a.subject,
    body: a.body,
    // status est typé String en base ; on le restreint à l'union de l'UI.
    status: a.status as ApplicationStatus,
    sentAt: a.sentAt?.toISOString() ?? null,
    repliedAt: a.repliedAt?.toISOString() ?? null,
    replyContent: a.replyContent,
    errorMessage: a.errorMessage,
    // UX-10 : note de suivi et relance automatique.
    followUpNote: a.followUpNote ?? null,
    followUpSentAt: a.followUpSentAt?.toISOString() ?? null,
    // UX-4v3 : statut manuel post-réponse.
    manualStatus: a.manualStatus ?? null,
    // BUG-04 : exposer le Message-ID de l'email initial pour le threading.
    messageId: a.messageId ?? null,
    // B2 : Message-ID de la relance (distinct du messageId de l'email initial).
    followUpMessageId: a.followUpMessageId ?? null,
    // FM-02 : variante de prompt A/B utilisée lors de la génération.
    promptVariant: a.promptVariant ?? null,
    // FM-08 : suivi d'entretien.
    interviewDate: (a as typeof a & { interviewDate?: Date | null }).interviewDate?.toISOString() ?? null,
    interviewLocation: (a as typeof a & { interviewLocation?: string | null }).interviewLocation ?? null,
    interviewNotes: (a as typeof a & { interviewNotes?: string | null }).interviewNotes ?? null,
    // BOUNCE-01 : bounce tracking.
    emailBounced: (a as typeof a & { emailBounced?: boolean }).emailBounced ?? false,
    emailBouncedAt: (a as typeof a & { emailBouncedAt?: Date | null }).emailBouncedAt?.toISOString() ?? null,
    // DELIV-01 : source de l'email — sert au marquage « à vérifier » et au blocage d'envoi.
    emailSource: ((a.company as { emailSource?: string }).emailSource ?? 'manual') as Application['emailSource'],
  };
}

// PERF-1v3 : pagination serveur des candidatures.
export async function listByCampaign(
  campaignId: string,
  page = 0,
  pageSize = 100
): Promise<{ items: Application[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.application.findMany({
      where: { campaignId },
      include: includeCompany,
      orderBy: { createdAt: 'asc' },
      skip: page * pageSize,
      take: pageSize,
    }),
    prisma.application.count({ where: { campaignId } }),
  ]);
  return { items: rows.map(toDTO), total };
}

// Toutes les réponses reçues, toutes campagnes confondues (page Réponses).
export async function listReplied(): Promise<Application[]> {
  const rows = await prisma.application.findMany({
    where: { status: 'REPLIED' },
    include: includeCompany,
    orderBy: { repliedAt: 'desc' },
  });
  return rows.map(toDTO);
}

// PERF-M1 : version paginée de listReplied.
export async function listRepliedPaginated(
  page = 0,
  pageSize = 20
): Promise<{ items: Application[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.application.findMany({
      where: { status: 'REPLIED' },
      include: includeCompany,
      orderBy: { repliedAt: 'desc' },
      skip: page * pageSize,
      take: pageSize,
    }),
    prisma.application.count({ where: { status: 'REPLIED' } }),
  ]);
  return { items: rows.map(toDTO), total };
}

export async function getApplication(id: string): Promise<Application | null> {
  const a = await prisma.application.findUnique({ where: { id }, include: includeCompany });
  return a ? toDTO(a) : null;
}

// Modifie l'objet/le corps d'un brouillon (validation manuelle avant envoi).
// M2 : seuls DRAFT et FAILED sont éditables — un email déjà envoyé ne doit pas
// être modifié (incohérence entre ce qui est stocké et ce qu'a reçu le recruteur).
export async function updateDraft(id: string, subject: string, body: string): Promise<Application> {
  const result = await prisma.application.updateMany({
    where: { id, status: { in: ['DRAFT', 'FAILED'] } },
    data: { subject, body },
  });
  if (result.count === 0) {
    throw new Error('Cette candidature ne peut plus être modifiée (déjà envoyée ou répondue).');
  }
  // Re-fetch pour renvoyer le DTO complet avec l'entreprise associée.
  // M5 : la candidature peut être supprimée (cascade) entre updateMany et findUnique.
  const a = await prisma.application.findUnique({ where: { id }, include: includeCompany });
  if (!a) throw new Error('Candidature introuvable après sauvegarde — rechargez la page.');
  return toDTO(a);
}

/**
 * Crée (ou met à jour) le brouillon de candidature d'une entreprise.
 * Utilisé par la tâche de génération d'email. La contrainte d'unicité sur
 * companyId garantit une seule candidature par entreprise — relancer la
 * génération réécrit le brouillon au lieu d'en créer un doublon.
 */
export async function upsertDraft(params: {
  campaignId: string;
  companyId: string;
  subject: string;
  body: string;
  // FM-02 : variante du prompt A/B utilisée pour cette génération.
  promptVariant?: 'A' | 'B';
}): Promise<void> {
  await prisma.application.upsert({
    where: { companyId: params.companyId },
    create: {
      campaignId: params.campaignId,
      companyId: params.companyId,
      subject: params.subject,
      body: params.body,
      status: 'DRAFT',
      promptVariant: params.promptVariant ?? 'A',
    },
    update: {
      subject: params.subject,
      body: params.body,
      ...(params.promptVariant ? { promptVariant: params.promptVariant } : {}),
    },
  });
}

// --- Transitions de statut (appelées par les tâches de fond) ----------------

// H1 : transition atomique DRAFT/FAILED → SENDING.
// Retourne false si une autre tâche a déjà pris cette candidature (double-clic,
// sendAll + send simultanés) — l'appelant peut alors s'arrêter proprement.
export async function markSending(id: string): Promise<boolean> {
  const result = await prisma.application.updateMany({
    where: { id, status: { in: ['DRAFT', 'FAILED'] } },
    data: { status: 'SENDING' },
  });
  return result.count > 0;
}

export async function markSent(id: string, messageId: string): Promise<void> {
  await prisma.application.update({
    where: { id },
    data: { status: 'SENT', sentAt: new Date(), messageId, errorMessage: null },
  });
}

export async function markFailed(id: string, errorMessage: string): Promise<void> {
  await prisma.application.update({
    where: { id },
    data: { status: 'FAILED', errorMessage },
  });
}

/**
 * Marque une candidature comme ayant reçu une réponse.
 * C4 : retourne { marked: true } si la transition SENT→REPLIED a eu lieu,
 * { marked: false } si la candidature était déjà dans un autre état (idempotence).
 * L'appelant peut ainsi éviter d'émettre une notification en double.
 */
export async function markReplied(id: string, replyContent: string): Promise<{ marked: boolean }> {
  // B2 : accepter aussi FOLLOWED_UP → REPLIED (réponse reçue après une relance).
  const result = await prisma.application.updateMany({
    where: { id, status: { in: ['SENT', 'FOLLOWED_UP'] } },
    data: { status: 'REPLIED', repliedAt: new Date(), replyContent },
  });
  return { marked: result.count > 0 };
}

/**
 * BOUNCE-01 : marque une candidature comme rebondie (NDR reçu par IMAP).
 * Idempotent — un double déclenchement n'écrase pas une date déjà enregistrée.
 */
export async function markBounced(id: string): Promise<{ marked: boolean }> {
  const result = await (prisma.application.updateMany as Function)({
    where: { id, emailBounced: false },
    data: { emailBounced: true, emailBouncedAt: new Date() },
  });
  return { marked: result.count > 0 };
}

/**
 * UX-10 : enregistre une note de suivi sur une candidature.
 */
export async function addFollowUpNote(id: string, note: string): Promise<void> {
  await prisma.application.update({ where: { id }, data: { followUpNote: note } });
}

/**
 * Candidatures en attente d'envoi — sans limite de pagination.
 */
export async function listDraftAndFailedIds(campaignId: string): Promise<string[]> {
  const rows = await prisma.application.findMany({
    where: { campaignId, status: { in: ['DRAFT', 'FAILED'] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Candidatures envoyées en attente de réponse — base du matching IMAP.
 * Pas de fenêtre temporelle : une réponse peut arriver des semaines après l'envoi.
 */
export async function listSentForReplyMatching(): Promise<AppWithCompany[]> {
  return prisma.application.findMany({
    where: {
      status: { in: ['SENT', 'FOLLOWED_UP'] },
      messageId: { not: null },
    },
    include: includeCompany,
  });
}

/**
 * Candidatures envoyées et munies d'un Message-ID — base du matching IMAP.
 * H4 (revue 7) : paramètre `since` optionnel pour limiter le scan aux envois
 * récents et éviter de charger toute la table en mémoire sur le long terme.
 */
export async function listSentWithMessageId(since?: Date): Promise<AppWithCompany[]> {
  // B2 : inclure FOLLOWED_UP — leurs réponses peuvent arriver sur le messageId original ou followUpMessageId.
  return prisma.application.findMany({
    where: {
      status: { in: ['SENT', 'FOLLOWED_UP'] },
      messageId: { not: null },
      ...(since && { sentAt: { gte: since } }),
    },
    include: includeCompany,
  });
}

/**
 * FM-08 : enregistre les informations de suivi d'entretien.
 */
export async function setInterview(
  id: string,
  interviewDate: string | null,
  interviewLocation: string | null,
  interviewNotes: string | null
): Promise<void> {
  await prisma.application.update({
    where: { id },
    data: {
      interviewDate: interviewDate ? new Date(interviewDate) : null,
      interviewLocation,
      interviewNotes,
    } as {
      interviewDate: Date | null;
      interviewLocation: string | null;
      interviewNotes: string | null;
    },
  });
}

/**
 * UX-4v3 : définit le statut manuel post-réponse d'une candidature.
 */
export async function setManualStatus(
  id: string,
  manualStatus: 'INTERVIEWED' | 'OFFER' | 'REJECTED' | 'ACCEPTED' | null
): Promise<void> {
  await prisma.application.update({ where: { id }, data: { manualStatus } });
}

/**
 * UX-5v3 : liste les candidatures nécessitant une action (relance, qualification, réessai).
 */
export async function listActionRequired(): Promise<Application[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5); // il y a 7 jours
  const rows = await prisma.application.findMany({
    where: {
      OR: [
        // Envoyées il y a + de 7 jours sans réponse et sans relance.
        { status: 'SENT', sentAt: { lt: sevenDaysAgo }, followUpSentAt: null },
        // Réponses reçues sans statut manuel (à qualifier).
        { status: 'REPLIED', manualStatus: null },
        // Échecs à renvoyer.
        { status: 'FAILED' },
      ],
    },
    include: includeCompany,
    orderBy: { sentAt: 'asc' },
  });
  return rows.map(toDTO);
}

/**
 * FOLLOWUP-BATCH : ids des candidatures éligibles à une relance (SENT depuis + de
 * 7 jours, sans réponse ni relance déjà envoyée), les plus anciennes d'abord.
 * Sert à la relance en lot. `limit` borne le nombre retourné (quota d'envoi).
 */
export async function listFollowUpEligibleIds(limit?: number): Promise<string[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5); // il y a 7 jours
  const rows = await prisma.application.findMany({
    where: { status: 'SENT', sentAt: { lt: sevenDaysAgo }, followUpSentAt: null },
    select: { id: true },
    orderBy: { sentAt: 'asc' },
    ...(limit && limit > 0 ? { take: limit } : {}),
  });
  return rows.map((r) => r.id);
}
