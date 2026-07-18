import { handle } from './registry';
import {
  validate,
  ApplicationSendSchema,
  ApplicationUpdateDraftSchema,
  ManualStatusSchema,
  SentimentSchema,
  FollowUpNoteSchema,
  IdSchema,
  CampaignIdSchema,
} from './validation';
import * as appService from '../../src/modules/application/application.service';
import { enqueueGeneration } from '../../src/tasks/generate-email.task';
import { enqueueSend } from '../../src/tasks/send-email.task';
import { getOpenaiKey, getAnthropicKey, getGeminiKey, getGroqKey, getAiProvider, getDailySendLimit, getDailySendCount, tryIncrementDailySend, refundDailySend } from '../../src/lib/secrets';
import { getProfile } from '../../src/modules/profile/profile.service';
import { isOptedOut } from '../../src/modules/optout/optout.service';
import { getCv } from '../../src/modules/cv/cv.service';
import { prisma } from '../../src/lib/prisma';
import { generatePitch, generateCampaignPrompts, generateCoverLetter } from '../../src/modules/ai/ai.service';
import type { CvParsed } from '@candio/shared';

// L'IA est prête si Ollama est choisi (local, sans clé) OU si une clé OpenAI existe.
function assertAiReady(): void {
  const provider = getAiProvider();
  if (provider === 'ollama') return; // local, aucune clé requise
  if (provider === 'anthropic') {
    if (getAnthropicKey() === null) {
      throw new Error('Clé Anthropic absente — renseigne-la dans les Réglages, ou choisis un autre moteur IA.');
    }
    return;
  }
  if (provider === 'gemini') {
    if (getGeminiKey() === null) {
      throw new Error('Clé Google Gemini absente — renseigne-la dans les Réglages, ou choisis un autre moteur IA.');
    }
    return;
  }
  if (provider === 'groq') {
    if (getGroqKey() === null) {
      throw new Error('Clé Groq absente — renseigne-la dans les Réglages, ou choisis un autre moteur IA.');
    }
    return;
  }
  if (getOpenaiKey() === null) {
    throw new Error('Aucune IA configurée — choisis Ollama (local) ou renseigne une clé OpenAI dans les Réglages.');
  }
}

// Charge le CvParsed du CV d'une campagne, avec messages d'erreur clairs.
async function requireCampaignCv(cvId: string | null): Promise<CvParsed> {
  if (!cvId) throw new Error('Aucun CV sélectionné pour cette campagne — choisis-en un dans le formulaire de campagne.');
  const cv = await getCv(cvId);
  if (!cv?.parsed) throw new Error("Le CV de cette campagne n'est pas encore analysé — importe son PDF dans l'onglet CV.");
  try { return JSON.parse(cv.parsed) as CvParsed; }
  catch { throw new Error('CV illisible (données corrompues) — ré-importe le PDF dans l\'onglet CV.'); }
}
import { upsertDraft } from '../../src/modules/application/application.service';
import { sendApplicationEmail } from '../../src/lib/mailer';
import { pickCampaignPrompt } from '../../src/lib/campaign-prompt';
import { throttleSend } from '../../src/tasks/send-email.task';

/** Handlers IPC du domaine Candidatures. */
export function registerApplicationHandlers(): void {
  // PROMPT-HELPER IA : génère 2 prompts enrichis (matériel saisi + CV analysé).
  handle('ai:generateCampaignPrompts', async ({ material, cvId }) => {
    let cvParsed: CvParsed | null = null;
    if (cvId) {
      const cv = await getCv(cvId);
      if (cv?.parsed) {
        try { cvParsed = JSON.parse(cv.parsed) as CvParsed; } catch { /* CV illisible — ignoré */ }
      }
    }
    return generateCampaignPrompts(material, cvParsed);
  });

  // LETTRE-ANNONCE : lettre de motivation pour une annonce collée. Réutilise
  // generatePitch en injectant le texte de l'annonce comme « fiche entreprise »
  // (champ description) → le §2/§3 s'ancre dessus. Rien n'est persisté.
  handle('ai:generateCoverLetter', async ({ cvId, jobTitle, company, contact, annonce, availability }) => {
    assertAiReady();
    if (!jobTitle?.trim()) throw new Error('Indique le poste visé.');
    if (!company?.trim()) throw new Error("Indique le nom de l'entreprise.");
    if (!annonce?.trim() || annonce.trim().length < 30) {
      throw new Error("Colle le texte de l'annonce (au moins quelques lignes).");
    }
    const cvParsed = await requireCampaignCv(cvId);
    const profile = await getProfile();
    return generateCoverLetter(
      jobTitle.trim(),
      company.trim(),
      contact?.trim() || null,
      annonce,
      cvParsed,
      profile,
      availability?.trim() || null,
    );
  });

  handle('application:listByCampaign', (payload) => {
    const { campaignId } = validate(CampaignIdSchema, payload);
    const p = payload as { page?: number; pageSize?: number };
    return appService.listByCampaign(campaignId, p.page ?? 0, p.pageSize ?? 100);
  });
  // PERF-M1 : retourne toujours { items, total } — page/pageSize optionnels.
  // PERF-01 fix : pageSize 1000 → 100 par défaut (chaque replyContent peut faire
  // 50 Ko — 1000 items = jusqu'à 50 Mo en IPC d'un coup).
  handle('application:listReplied', async (payload) => {
    const p = payload as { page?: number; pageSize?: number } | void;
    return appService.listRepliedPaginated(p?.page ?? 0, p?.pageSize ?? 100);
  });

  handle('application:generate', async (payload) => {
    const { campaignId } = validate(CampaignIdSchema, payload);
    assertAiReady();
    // Les pré-requis CV (sélectionné + analysé) sont validés dans enqueueGeneration.
    const { enqueued, skippedUnverified } = await enqueueGeneration(campaignId);
    // Erreur SEULEMENT si rien à faire ET rien sauté : sinon « tout sauté (email à vérifier) »
    // est un cas normal → on renvoie le résultat pour que l'UI affiche le message d'info.
    if (enqueued === 0 && skippedUnverified === 0) {
      throw new Error(
        'Tous les emails ont déjà été générés — aucune entreprise sans brouillon dans cette campagne.'
      );
    }
    return { enqueued, skippedUnverified };
  });

  // Régénère TOUTES les lettres régénérables de la campagne (brouillons + échecs +
  // entreprises sans lettre), pour réappliquer le prompt courant. N'écrase jamais
  // une candidature déjà envoyée. Renvoie le nombre enfilé.
  handle('application:regenerateAll', async (payload) => {
    const { campaignId } = validate(CampaignIdSchema, payload);
    assertAiReady();
    const { enqueued, skippedUnverified } = await enqueueGeneration(campaignId, 'regenerate');
    return { enqueued, skippedUnverified };
  });

  handle('application:updateDraft', (payload) => {
    const data = validate(ApplicationUpdateDraftSchema, payload);
    return appService.updateDraft(data.id, data.subject, data.body);
  });

  handle('application:send', (payload) => {
    const { id, force } = validate(ApplicationSendSchema, payload);
    return enqueueSend(id, force);
  });

  handle('application:sendAll', async (payload) => {
    const { campaignId } = validate(CampaignIdSchema, payload);
    const targetIds = await appService.listDraftAndFailedIds(campaignId);
    if (targetIds.length === 0) return;

    const results = await Promise.allSettled(targetIds.map((id) => enqueueSend(id)));
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

    if (errors.length > 0) {
      throw new Error(
        `${errors.length} enfilement(s) échoué(s) sur ${targetIds.length} : ${errors[0]}`
      );
    }
  });

  handle('application:addFollowUpNote', async (payload) => {
    const data = validate(FollowUpNoteSchema, payload);
    await appService.addFollowUpNote(data.id, data.note);
  });

  // FOLLOWUP-BATCH : relance en lot toutes les candidatures éligibles (SENT > 7j,
  // sans réponse/relance), bornée au quota d'envoi restant du jour pour ne pas
  // dépasser le plafond anti-suspension Gmail. Renvoie le détail pour l'UI.
  handle('application:followUpAllEligible', async () => {
    const remaining = Math.max(0, getDailySendLimit() - getDailySendCount().count);
    const totalEligible = (await appService.listFollowUpEligibleIds()).length;
    if (remaining === 0) return { enqueued: 0, eligible: totalEligible, remaining };
    const ids = await appService.listFollowUpEligibleIds(remaining);
    const { enqueueFollowUp } = await import('../../src/tasks/send-followup.task');
    for (const id of ids) await enqueueFollowUp(id);
    return { enqueued: ids.length, eligible: totalEligible, remaining };
  });

  handle('application:regenerateOne', async (payload) => {
    validate(IdSchema, payload);
    assertAiReady();
    const app = await prisma.application.findUnique({
      where: { id: payload.id },
      include: { company: true, campaign: true },
    });
    if (!app) throw new Error('Candidature introuvable.');
    if (app.status !== 'DRAFT' && app.status !== 'FAILED') {
      throw new Error('Seuls les brouillons et les échecs peuvent être régénérés.');
    }

    const profile = await getProfile();
    if (!profile) throw new Error('Profil inexistant — créez-le dans le Profil.');
    // CV-MULTI : CV de la campagne (plus le profil).
    const cvParsed = await requireCampaignCv(app.campaign.cvId);

    // FM-02 : capturer la variante choisie pour traçabilité A/B.
    const { prompt, variant } = pickCampaignPrompt(app.campaign.prompt, app.campaign.promptVariantB);
    const email = await generatePitch(
      app.campaign.jobTitle,
      prompt,
      app.company.name,
      app.company.contactName,
      cvParsed,
      profile,
      {
        sector: app.company.sector,
        activityDomain: app.company.activityDomain,
        city: app.company.city,
        website: app.company.website,
        description: app.company.description,
      },
      // Types de contrat de la campagne (CSV en base → tableau) pour annoncer le contrat en §1.
      (app.campaign.contractTypes || '').split(',').map((s) => s.trim()).filter(Boolean),
      // AVAIL : disponibilité saisie → recopiée telle quelle au §4 (pas de date inventée).
      app.campaign.availability,
    );
    await upsertDraft({
      campaignId: app.campaignId,
      companyId: app.companyId,
      subject: email.subject,
      body: email.body,
      promptVariant: variant,
    });
  });

  handle('application:sendTest', async (payload) => {
    validate(IdSchema, payload);
    const profile = await getProfile();
    if (!profile?.emailSender) {
      throw new Error('Adresse email non configurée dans le Profil.');
    }
    const app = await prisma.application.findUnique({
      where: { id: payload.id },
      include: { company: true, campaign: { include: { cv: true } } },
    });
    if (!app) throw new Error('Candidature introuvable.');

    // AUDIT-H2 fix : le même throttle 8 s doit s'appliquer aux emails de test
    // pour éviter de contourner le délai anti-spam en spammant ce bouton.
    await throttleSend();
    await sendApplicationEmail({
      fromName: `${profile.firstName} ${profile.lastName}`,
      fromEmail: profile.emailSender,
      to: profile.emailSender,
      subject: `[TEST] ${app.subject}`,
      body: app.body,
      cvPath: app.campaign.cv?.filePath ?? undefined, // CV-MULTI : CV de la campagne
    });
  });

  // TEST-CAMPAGNE : s'envoie en test TOUS les brouillons/échecs de la campagne
  // (rendu réel + CV joint), à sa propre adresse. Ne touche pas aux statuts et
  // n'envoie rien aux destinataires réels — sert à valider la campagne avant le
  // vrai « Tout envoyer ». Throttle 8 s appliqué comme un envoi normal.
  handle('application:sendTestAll', async (payload) => {
    const { campaignId } = validate(CampaignIdSchema, payload);
    const profile = await getProfile();
    if (!profile?.emailSender) {
      throw new Error('Adresse email non configurée dans le Profil.');
    }
    const targetIds = await appService.listDraftAndFailedIds(campaignId);
    if (targetIds.length === 0) return { sent: 0, total: 0 };

    // PERF-1 : une seule requête (in: ids) au lieu d'un findUnique par brouillon (N+1).
    const apps = await prisma.application.findMany({
      where: { id: { in: targetIds } },
      include: { company: true, campaign: { include: { cv: true } } },
    });

    let sent = 0;
    for (const app of apps) {
      if (!app.body) continue;
      await throttleSend();
      await sendApplicationEmail({
        fromName: `${profile.firstName} ${profile.lastName}`,
        fromEmail: profile.emailSender,
        to: profile.emailSender,
        subject: `[TEST → ${app.company.name}] ${app.subject}`,
        body: app.body,
        cvPath: app.campaign.cv?.filePath ?? undefined,
      });
      sent++;
    }
    return { sent, total: targetIds.length };
  });

  handle('application:setManualStatus', async (payload) => {
    const data = validate(ManualStatusSchema, payload);
    await appService.setManualStatus(data.id, data.manualStatus);
  });

  handle('application:setSentiment', async (payload) => {
    const data = validate(SentimentSchema, payload);
    await appService.setSentiment(data.id, data.sentiment);
  });

  handle('application:listActionRequired', () => appService.listActionRequired());

  // FM-08 : enregistrer les informations de suivi d'entretien.
  handle('application:setInterview', async (payload) => {
    validate(IdSchema, payload);
    const { id, interviewDate, interviewLocation, interviewNotes } = payload as {
      id: string;
      interviewDate: string | null;
      interviewLocation: string | null;
      interviewNotes: string | null;
    };
    await appService.setInterview(id, interviewDate, interviewLocation, interviewNotes);
  });

  // UX-S8 : prévisualisation de la relance avant envoi.
  handle('application:previewFollowUp', async (payload) => {
    validate(IdSchema, payload);
    // RGPD : ne pas gaspiller un appel IA pour un contact désinscrit — on bloque
    // dès l'aperçu (l'envoi est déjà protégé, mais autant éviter le coût).
    const app = await appService.getApplication(payload.id);
    if (app && (await isOptedOut(app.contactEmail))) {
      throw new Error('Ce contact figure dans la liste « ne pas contacter » (RGPD) — relance impossible.');
    }
    // BOUNCE-01 (B5) : ne pas générer (ni facturer) l'aperçu d'une relance vers une adresse
    // déjà rebondie — l'envoi est de toute façon bloqué côté claim.
    if (app?.emailBounced) {
      throw new Error('Adresse rebondie (email mort) — relance impossible.');
    }
    const { generateFollowUpContent } = await import('../../src/tasks/send-followup.task');
    return generateFollowUpContent(payload.id);
  });

  // UX-S8 : envoi de la relance avec le body fourni (pas de régénération IA).
  handle('application:sendFollowUpWithBody', async (payload) => {
    validate(IdSchema, payload);
    const { id, subject, body } = payload as { id: string; subject: string; body: string };

    // FOLLOWUP-N : parité avec enqueueFollowUp — capturer l'état avant le claim,
    // accepter 1ʳᵉ relance (SENT) ET suivantes (FOLLOWED_UP > FOLLOWUP_DELAY_DAYS j), et SURTOUT
    // incrémenter followUpCount (sinon le plafond MAX_FOLLOWUPS est contourné et la
    // candidature reçoit des relances auto supplémentaires).
    const before = await prisma.application.findUnique({
      where: { id },
      select: { status: true, followUpSentAt: true, followUpCount: true },
    });
    if (!before) throw new Error('Candidature introuvable.');
    const restore = { status: before.status, followUpSentAt: before.followUpSentAt, followUpCount: before.followUpCount };

    const cutoff = appService.followUpCutoff();
    const claimed = await prisma.application.updateMany({
      where: {
        id,
        repliedAt: null,
        emailBounced: false, // BOUNCE-01 : jamais de relance sur une adresse rebondie (parité enqueueFollowUp).
        followUpCount: { lt: appService.MAX_FOLLOWUPS },
        OR: [
          { status: 'SENT', followUpSentAt: null },
          { status: 'FOLLOWED_UP', followUpSentAt: { lt: cutoff } },
        ],
      },
      data: { status: 'FOLLOWED_UP', followUpSentAt: new Date(), followUpCount: { increment: 1 } },
    });
    if (claimed.count === 0) throw new Error('Candidature non éligible à une relance (déjà relancée récemment, adresse rebondie, ou plafond atteint).');

    const app = await appService.getApplication(id);
    if (!app) throw new Error('Candidature introuvable.');

    // RGPD : ne pas relancer un contact désinscrit. On annule le claim.
    if (await isOptedOut(app.contactEmail)) {
      await prisma.application.update({ where: { id }, data: restore });
      throw new Error('Relance bloquée — ce contact figure dans la liste « ne pas contacter » (RGPD).');
    }

    const profile = await getProfile();
    if (!profile?.emailSender) {
      // Annule le claim : la candidature reste relançable une fois le profil configuré.
      await prisma.application.update({ where: { id }, data: restore });
      throw new Error('Email de profil non configuré.');
    }

    // BUG-A : la relance compte dans le plafond quotidien. Annule le claim si atteint.
    const allowed = await tryIncrementDailySend();
    if (!allowed) {
      await prisma.application.update({ where: { id }, data: restore });
      throw new Error(`Plafond d'envois du jour atteint (${getDailySendLimit()}/jour) — réessaie demain.`);
    }

    // BUG 2 : joindre le CV de la campagne, comme la relance automatique (cohérence).
    const campaignCv = await prisma.campaign.findUnique({
      where: { id: app.campaignId },
      select: { cv: { select: { filePath: true } } },
    });
    const cvPath = campaignCv?.cv?.filePath ?? undefined;

    // BUG-H4 fix : appliquer le même throttle 8 s que le task-runner pour
    // éviter de contourner le délai anti-spam en passant par ce handler direct.
    await throttleSend();

    // BUG-H2 (parité avec enqueueFollowUp) : si l'envoi SMTP échoue, on annule le
    // claim pour que la candidature redevienne relançable. On distingue les deux
    // phases avec smtpSent : une fois l'email parti, rollback INTERDIT (sinon double
    // envoi au prochain essai) — seul le stockage du messageId peut alors échouer.
    let smtpSent = false;
    try {
      // BUG-04 fix : threading — la relance s'accroche au fil de l'email initial.
      const messageId = await sendApplicationEmail({
        fromName: `${profile.firstName} ${profile.lastName}`,
        fromEmail: profile.emailSender,
        to: app.contactEmail,
        subject,
        body,
        cvPath, // BUG 2 : CV de la campagne joint (parité avec la relance auto).
        inReplyTo: app.messageId ?? undefined,
        references: app.messageId ?? undefined,
      });
      smtpSent = true;

      await prisma.application.update({
        where: { id },
        data: { followUpMessageId: messageId },
      });
      // THREAD-01 : la relance figure comme message sortant dans le fil.
      await appService.recordOutboundMessage(id, body, messageId);
    } catch (err) {
      if (!smtpSent) {
        // L'email n'est pas parti : on rend le crédit de quota consommé + rollback du claim
        // (restaure status/followUpSentAt/followUpCount à leur valeur d'avant).
        await refundDailySend();
        await prisma.application.update({
          where: { id },
          data: { ...restore, errorMessage: err instanceof Error ? err.message : 'Échec de la relance' },
        });
      }
      throw err;
    }
  });

  // UX-S9 : répondre à un recruteur depuis la page Réponses.
  handle('application:replyToRecruiter', async (payload) => {
    validate(IdSchema, payload);
    const { id, body } = payload as { id: string; body: string };

    const app = await appService.getApplication(id);
    if (!app) throw new Error('Candidature introuvable.');

    const profile = await getProfile();
    if (!profile?.emailSender) throw new Error('Email de profil non configuré.');

    // REPLY-IN : on répond à l'adresse d'où le recruteur a ÉCRIT (replyFromEmail), qui peut
    // différer de l'email scrapé d'origine. Repli sur contactEmail si non captée (vieux fils).
    const replyTo = app.replyFromEmail || app.contactEmail;

    // BUG-04 fix : threading — la réponse s'accroche au fil de l'email initial.
    // Le recruteur a répondu à l'email de candidature (messageId) ; on repasse
    // ce même Message-ID pour que la réponse s'imbrique dans le même fil.
    const outMessageId = await sendApplicationEmail({
      fromName: `${profile.firstName} ${profile.lastName}`,
      fromEmail: profile.emailSender,
      to: replyTo,
      subject: `Re: ${app.subject}`,
      body,
      inReplyTo: app.messageId ?? undefined,
      references: app.messageId ?? undefined,
    });

    // REPLY-OUT : email parti → on trace ma réponse (contenu + date) pour l'afficher
    // dans le fil et calculer le badge Répondu / En attente. Après un envoi SMTP réussi.
    await prisma.application.update({
      where: { id },
      data: { myReplyContent: body, myRepliedAt: new Date() },
    });
    // THREAD-01 : consigner le message sortant dans le fil de conversation.
    await appService.recordOutboundMessage(id, body, outMessageId);
  });

  // THREAD-01 : fil de conversation complet d'une candidature.
  handle('application:getThread', async (payload) => {
    validate(IdSchema, payload);
    return appService.getThread(payload.id);
  });

  // REMIND-01 : pose/efface un rappel sur une candidature.
  handle('application:setRemindAt', async (payload) => {
    validate(IdSchema, payload);
    const { id, remindAt } = payload as { id: string; remindAt: string | null };
    const at = remindAt ? new Date(remindAt) : null;
    if (at && Number.isNaN(at.getTime())) throw new Error('Date de rappel invalide.');
    await appService.setRemindAt(id, at);
  });
}
