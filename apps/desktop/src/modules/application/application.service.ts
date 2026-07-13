import type { Application, ApplicationStatus, ThreadMessage } from '@candio/shared';
import { UNVERIFIED_EMAIL_SOURCES } from '@candio/shared';
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
    // REPLY-IN : adresse réelle d'où le recruteur a répondu (cast défensif — champ récent).
    replyFromEmail: (a as typeof a & { replyFromEmail?: string | null }).replyFromEmail ?? null,
    // REPLY-OUT : ma réponse au recruteur (champs récents → cast défensif comme interview/bounce).
    myReplyContent: (a as typeof a & { myReplyContent?: string | null }).myReplyContent ?? null,
    myRepliedAt: (a as typeof a & { myRepliedAt?: Date | null }).myRepliedAt?.toISOString() ?? null,
    // REMIND-01 : rappel/snooze.
    remindAt: (a as typeof a & { remindAt?: Date | null }).remindAt?.toISOString() ?? null,
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
  // Ne JAMAIS écraser une candidature déjà envoyée/en cours : entre l'enqueue d'une
  // génération en masse et son exécution (file de concurrence), le statut a pu passer
  // à SENT/SENDING/REPLIED/FOLLOWED_UP. On ne met à jour QUE les DRAFT/FAILED — sinon
  // le corps stocké d'une candidature envoyée divergerait de l'email réellement parti
  // (et fausserait le justificatif France Travail).
  const updated = await prisma.application.updateMany({
    where: { companyId: params.companyId, status: { in: ['DRAFT', 'FAILED'] } },
    data: {
      subject: params.subject,
      body: params.body,
      ...(params.promptVariant ? { promptVariant: params.promptVariant } : {}),
    },
  });
  if (updated.count > 0) return;

  // Aucune ligne mise à jour : soit la candidature n'existe pas (→ create), soit elle
  // existe mais est protégée → le create lèvera P2002 et on la laisse intacte.
  try {
    await prisma.application.create({
      data: {
        campaignId: params.campaignId,
        companyId: params.companyId,
        subject: params.subject,
        body: params.body,
        status: 'DRAFT',
        promptVariant: params.promptVariant ?? 'A',
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err;
  }
}

// --- Transitions de statut (appelées par les tâches de fond) ----------------

// H1 : transition atomique DRAFT/FAILED → SENDING.
// Retourne false si une autre tâche a déjà pris cette candidature (double-clic,
// sendAll + send simultanés) — l'appelant peut alors s'arrêter proprement.
export async function markSending(id: string): Promise<boolean> {
  // ← ROUAGE anti-doublon (utilisé par enqueueSend). Une seule requête SQL fait à la fois
  //   le test (status DRAFT/FAILED ?) et la prise (→ SENDING). Deux tâches concurrentes : la
  //   première met count=1, la seconde voit 0 ligne (le status n'est plus DRAFT/FAILED) → false.
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
export async function markReplied(
  id: string,
  replyContent: string,
  replyFromEmail?: string,
): Promise<{ marked: boolean }> {
  // ← ROUAGE de l'idempotence : `updateMany ... WHERE status IN (SENT, FOLLOWED_UP)` ne
  //   touche la ligne QUE si elle n'est pas déjà REPLIED. result.count = 0 → c'était déjà
  //   traité (le re-scan IMAP du même jour ne renotifie donc pas). La base arbitre, pas le code.
  // B2 : accepter aussi FOLLOWED_UP → REPLIED (réponse reçue après une relance).
  // REPLY-IN : on mémorise l'adresse d'où vient la réponse (si fournie et non vide) pour
  // que « Répondre au recruteur » vise la bonne boîte, pas l'email scrapé d'origine.
  const result = await prisma.application.updateMany({
    where: { id, status: { in: ['SENT', 'FOLLOWED_UP'] } },
    data: {
      status: 'REPLIED',
      repliedAt: new Date(),
      replyContent,
      ...(replyFromEmail ? { replyFromEmail } : {}),
    },
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
 * THREAD-01 : enregistre un message ENTRANT (réponse recruteur) dans le fil.
 * Dédupliqué : par Message-ID s'il est présent, sinon par (candidature + corps identique)
 * — évite d'insérer deux fois le même email si le relevé IMAP le re-voit. Renvoie true si
 * un NOUVEAU message a été inséré (utile pour ne bumper repliedAt que sur du neuf).
 */
export async function recordInboundMessage(
  applicationId: string,
  body: string,
  fromEmail: string | null,
  messageId: string | null,
): Promise<boolean> {
  const dup = messageId
    ? await prisma.message.findFirst({ where: { applicationId, messageId } })
    : await prisma.message.findFirst({ where: { applicationId, direction: 'IN', body } });
  if (dup) return false;
  await prisma.message.create({
    data: { applicationId, direction: 'IN', body, fromEmail: fromEmail ?? null, messageId: messageId ?? null },
  });
  return true;
}

/** THREAD-01 : enregistre un message SORTANT (ma réponse ou une relance) dans le fil. */
export async function recordOutboundMessage(
  applicationId: string,
  body: string,
  messageId?: string | null,
): Promise<void> {
  await prisma.message.create({
    data: { applicationId, direction: 'OUT', body, messageId: messageId ?? null },
  });
}

/**
 * THREAD-01 / B3 : met à jour la date de dernière activité entrante (et l'adresse
 * d'où le recruteur a répondu). Contrairement à markReplied (idempotent, 1ʳᵉ réponse
 * seulement), ceci bump repliedAt à CHAQUE nouvelle réponse → le fil remonte dans le tri
 * et le badge « Répondu/En attente » rebascule correctement.
 */
export async function touchLatestReply(
  applicationId: string,
  at: Date,
  fromEmail: string | null,
): Promise<void> {
  await prisma.application.update({
    where: { id: applicationId },
    data: { repliedAt: at, ...(fromEmail ? { replyFromEmail: fromEmail } : {}) },
  });
}

/**
 * THREAD-01 : fil de conversation complet d'une candidature. La candidature initiale
 * ouvre le fil (message sortant), suivie des messages entrants/sortants chronologiques.
 */
export async function getThread(applicationId: string): Promise<ThreadMessage[]> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      body: true,
      sentAt: true,
      messages: { orderBy: { createdAt: 'asc' }, select: { id: true, direction: true, body: true, fromEmail: true, createdAt: true } },
    },
  });
  if (!app) return [];
  const thread: ThreadMessage[] = [];
  // La candidature initiale (envoi) ouvre le fil.
  if (app.sentAt) {
    thread.push({ id: 'initial', direction: 'OUT', body: app.body, fromEmail: null, createdAt: app.sentAt.toISOString() });
  }
  for (const m of app.messages) {
    thread.push({
      id: m.id,
      direction: m.direction === 'IN' ? 'IN' : 'OUT',
      body: m.body,
      fromEmail: m.fromEmail ?? null,
      createdAt: m.createdAt.toISOString(),
    });
  }
  return thread;
}

/**
 * REMIND-01 : pose ou efface un rappel (« me rappeler de répondre le … »). Quand la date
 * est passée, la candidature ressort dans « À traiter » (cf. listActionRequired).
 */
export async function setRemindAt(id: string, remindAt: Date | null): Promise<void> {
  await prisma.application.update({ where: { id }, data: { remindAt } });
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
 * FOLLOWUP-N : nombre maximum de relances automatiques par candidature (cadence 10 j).
 * Une seule relance, à J+10 de l'envoi, puis on arrête.
 */
export const MAX_FOLLOWUPS = 1;

/**
 * FOLLOWUP-N : condition Prisma « candidature éligible à une (n-ième) relance ».
 * - 1ʳᵉ relance : SENT, envoyée il y a + de 10 j, jamais relancée.
 * - relances suivantes : FOLLOWED_UP, dernière relance il y a + de 10 j (mort code
 *   tant que MAX_FOLLOWUPS = 1, gardé si le plafond est relevé un jour).
 * Dans les deux cas : pas de réponse reçue et plafond de relances non atteint.
 */
function followUpEligibleWhere(tenDaysAgo: Date): Prisma.ApplicationWhereInput {
  return {
    repliedAt: null,
    emailBounced: false, // BOUNCE-01 : ne jamais relancer une adresse qui a rebondi.
    followUpCount: { lt: MAX_FOLLOWUPS },
    OR: [
      { status: 'SENT', sentAt: { lt: tenDaysAgo }, followUpSentAt: null },
      { status: 'FOLLOWED_UP', followUpSentAt: { lt: tenDaysAgo } },
    ],
  };
}

/**
 * UX-5v3 : liste les candidatures nécessitant une action (relance, qualification, réessai).
 */
export async function listActionRequired(): Promise<Application[]> {
  const tenDaysAgo = new Date(Date.now() - 10 * 864e5); // il y a 10 jours
  const rows = await prisma.application.findMany({
    where: {
      OR: [
        // Éligibles à une relance (1ʳᵉ ou suivante, cadence 10 j).
        followUpEligibleWhere(tenDaysAgo),
        // Réponses reçues sans statut manuel (à qualifier).
        { status: 'REPLIED', manualStatus: null },
        // REMIND-01 : rappels échus (« me rappeler de répondre le … »).
        { remindAt: { lte: new Date() } },
        // Échecs à renvoyer — SAUF les « à vérifier » (email deviné/pattern bloqué à
        // l'envoi) : ce n'est pas une action quotidienne, ça polluait « À traiter ».
        // Ils restent visibles/éditables dans la campagne. On garde ici les vrais
        // échecs SMTP (email 'manual'/vérifié qui a raté l'envoi).
        { status: 'FAILED', company: { emailSource: { notIn: [...UNVERIFIED_EMAIL_SOURCES] } } },
      ],
    },
    include: includeCompany,
    orderBy: { sentAt: 'asc' },
  });
  return rows.map(toDTO);
}

/**
 * FOLLOWUP-BATCH : ids des candidatures éligibles à une relance (cadence 10 j,
 * plafonnée à MAX_FOLLOWUPS), les plus anciennes d'abord. `limit` borne le nombre
 * retourné (quota d'envoi).
 */
export async function listFollowUpEligibleIds(limit?: number): Promise<string[]> {
  const tenDaysAgo = new Date(Date.now() - 10 * 864e5); // il y a 10 jours
  const rows = await prisma.application.findMany({
    where: followUpEligibleWhere(tenDaysAgo),
    select: { id: true },
    orderBy: { sentAt: 'asc' },
    ...(limit && limit > 0 ? { take: limit } : {}),
  });
  return rows.map((r) => r.id);
}
