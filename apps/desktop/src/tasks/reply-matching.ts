/**
 * Fonctions pures de matching IMAP → candidature.
 * Extraites dans ce module pour être testables sans dépendances Electron/Prisma.
 */

export interface InboxMsg {
  from: string;
  // THREAD : Message-ID PROPRE du message reçu (unique par email) — clé de dédup.
  messageId: string | null;
  inReplyTo: string | null;
  // BUG-2 : certains clients ne renseignent que `References` (et pas In-Reply-To),
  // surtout dans les longs fils. On la teste aussi pour ne pas rater de réponses.
  references: string | null;
  date: Date;
}

export interface AppRef {
  messageId: string | null;
  followUpMessageId?: string | null;
  company: { contactEmail: string };
}

/**
 * matchReply — ROUAGE de l'appariement réponse↔candidature. Fonction PURE (sans DB/réseau)
 * → testable et déterministe. Elle applique 4 critères du plus fiable au plus risqué, et
 * s'arrête au premier qui matche. Le dernier (domaine partagé) n'est accepté QUE s'il est
 * non ambigu (une seule candidature sur ce domaine) — sinon on risquerait d'attribuer une
 * réponse à la mauvaise entreprise.
 *
 * Priorités :
 *  1. In-Reply-To contient le Message-ID de l'envoi initial (B8 : includes au lieu de ===).
 *  2. In-Reply-To contient le Message-ID de la relance (B2 : followUpMessageId).
 *  3. Adresse email exacte de l'expéditeur.
 *  4. Domaine partagé, uniquement si UNE SEULE candidature cible ce domaine (H2 : anti-ambiguïté).
 */
export function matchReply(
  inboxMsg: Pick<InboxMsg, 'from' | 'inReplyTo' | 'references'>,
  app: AppRef,
  allApps: Pick<AppRef, 'company'>[]
): boolean {
  // BUG-2 : on cherche le Message-ID dans In-Reply-To OU References (threading).
  const threadCites = (mid: string): boolean =>
    !!inboxMsg.inReplyTo?.includes(mid) || !!inboxMsg.references?.includes(mid);
  // Priorité 1 : Message-ID initial.
  if (app.messageId && threadCites(app.messageId)) return true;
  // Priorité 2 : Message-ID de la relance (B2).
  if (app.followUpMessageId && threadCites(app.followUpMessageId)) return true;

  const senderLower = inboxMsg.from.toLowerCase();
  const contactLower = app.company.contactEmail.toLowerCase();

  // Priorité 3 : email exact.
  if (senderLower === contactLower) return true;

  // Priorité 4 : domaine partagé — uniquement si non-ambigu.
  const senderDomain = senderLower.split('@')[1];
  const contactDomain = contactLower.split('@')[1];
  if (!senderDomain || !contactDomain || senderDomain !== contactDomain) return false;

  const appsOnDomain = allApps.filter((a) => {
    const d = a.company.contactEmail.toLowerCase().split('@')[1];
    return d === contactDomain;
  });
  return appsOnDomain.length === 1;
}

export interface BounceMsg {
  bouncedMessageId: string | null;
  bouncedCandidateEmails: string[];
}

export interface BounceAppRef {
  messageId: string | null;
  followUpMessageId?: string | null;
  emailBounced: boolean;
  company: { contactEmail: string };
}

/**
 * matchBounce — ROUAGE de l'appariement NDR↔candidature. Priorité au Message-ID (le
 * plus fiable). REPLI par adresse email (BOUNCE-FALLBACK) quand le NDR ne recopie pas
 * le Message-ID original — cas typique d'un rejet immédiat « adresse introuvable »
 * (l'email pattern/deviné n'existe pas), qui restait silencieusement ignoré avant ce
 * repli. Le repli n'accepte le match QUE s'il désigne sans ambiguïté une seule
 * candidature encore en jeu (pas déjà marquée rebondie) — même principe anti-ambiguïté
 * que matchReply pour le domaine partagé.
 */
export function matchBounce<A extends BounceAppRef>(
  msg: BounceMsg,
  allSent: A[]
): A | undefined {
  const byMessageId = allSent.find(
    (a) => (a.messageId && a.messageId === msg.bouncedMessageId) ||
           (a.followUpMessageId && a.followUpMessageId === msg.bouncedMessageId)
  );
  if (byMessageId) return byMessageId;

  if (msg.bouncedCandidateEmails.length === 0) return undefined;
  const candidates = allSent.filter(
    (a) => !a.emailBounced && msg.bouncedCandidateEmails.includes(a.company.contactEmail.toLowerCase())
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Clé d'unicité d'un message inbox — son PROPRE Message-ID (unique par email). Sert à ne
 * pas attribuer le même email à deux candidatures.
 *
 * BUG-ÉCHANGE : on utilisait In-Reply-To, qui est PARTAGÉ par tous les messages répondant
 * au même mail. Deux messages du recruteur dans le même fil avaient donc la MÊME clé → le
 * 2ᵉ était considéré « déjà traité » et jeté : un échange n'était jamais vu en entier.
 * Repli sur from+date pour les rares messages sans Message-ID.
 */
export function inboxKey(msg: Pick<InboxMsg, 'messageId' | 'from' | 'date'>): string {
  return msg.messageId ?? `${msg.from}:${msg.date.getTime()}`;
}

// SENTIMENT — la classification pure (positive/rejection/neutral), la dé-citation et le
// sentiment effectif vivent désormais dans @candio/shared (importables par le renderer sans
// violer la couche main-process). Ré-exportés ici pour les appelants backend/tests historiques.
export {
  classifyReplySentiment,
  effectiveSentiment,
  stripQuotedReply,
  type ReplySentiment,
} from '@candio/shared';

// RGPD — marqueurs d'une demande de DÉSINSCRIPTION / opposition (FR + EN).
// Volontairement spécifiques pour éviter les faux positifs : un refus de
// candidature poli (« nous ne donnons pas suite ») n'est PAS une demande de ne
// plus être contacté. On ne déclenche que sur des formules explicites de retrait.
const _OPT_OUT_PATTERNS: RegExp[] = [
  /désinscri/i,                                              // désinscription / désinscrire / désinscrivez
  /ne\s+(?:plus|souhaite\s+plus|veux\s+plus)\s+(?:me\s+)?(?:être\s+)?(?:contact|sollicit|démarch|recevoir|écri)/i,
  /ne\s+(?:pas|plus)\s+me\s+(?:contacter|solliciter|écrire|démarcher)/i,
  /(?:retir|supprim|enlev|ôt)(?:ez|er|e)[-\s]?(?:moi|nous)?.{0,25}(?:liste|fichier|base|contact|diffusion)/i,
  /ne\s+plus\s+être\s+(?:contacté|sollicité|démarché)/i,
  /unsubscribe/i,
  /opt[\s-]?out/i,
  /remove\s+(?:me|us)\s+(?:from\s+)?(?:your\s+)?(?:list|mailing|database|contacts?)/i,
  /(?:please\s+)?(?:stop|no\s+more)\s+(?:contact|emails?|messages?|sending)/i,
  /please\s+(?:stop|do\s*n['’]?t)\s+(?:contact|email|messag)/i,
  /^\s*stop\.?\s*$/im,                                       // réponse réduite à « STOP » (cf. pied d'email opt-out)
  // FR — « stop avec vos emails », « stop les mails », « stop vos sollicitations ».
  /\bstop\b.{0,20}(?:e[\s-]?mails?|mails?|messages?|sollicit|envoi|démarch)/i,
  // FR — « arrêtez vos emails », « arrêtez de m'envoyer/écrire/contacter », « cessez vos envois ».
  /(?:arr[êe]t|cess)(?:ez|er|e|es)?\b.{0,25}(?:e[\s-]?mails?|mails?|messages?|envoi|sollicit|d[ée]march|contact|de\s+m['’]?(?:envoy|[ée]cri|contact|sollicit))/i,
];

/**
 * RGPD — vrai si la réponse exprime une demande explicite de ne plus être
 * contacté (désinscription / droit d'opposition). Pure et bornée aux premières
 * lignes ; les marqueurs sont conservateurs pour ne pas confondre un refus de
 * candidature (« pas de poste ») avec une demande de retrait.
 */
export function detectOptOutRequest(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.slice(0, 4000);
  return _OPT_OUT_PATTERNS.some((re) => re.test(t));
}

// Sujets typiques d'une réponse automatique d'absence (FR + EN).
const _AUTO_REPLY_SUBJECT_RE =
  /out of office|automatic reply|auto.?reply|automated response|réponse automatique|absence du bureau|absent[e]? du bureau|message d'absence|en cong[ée]s?|de retour le|currently (?:out|away|on leave)/i;

/**
 * Vrai si un message reçu est une réponse AUTOMATIQUE (absence du bureau, accusé
 * auto), à ne pas confondre avec une vraie réponse du recruteur.
 *
 * Signal de référence = en-tête RFC 3834 `Auto-Submitted` (valeur ≠ « no » ⇒
 * automatique). Repli sur l'en-tête `X-Autoreply` et sur le sujet. Pur/testable :
 * imap.ts extrait les en-têtes et passe leurs valeurs ici.
 */
/**
 * Date de début du relevé IMAP.
 *
 * - Si un dernier relevé existe → on repart de là.
 * - Sinon → du plus ancien envoi (pour rattraper les réponses déjà reçues),
 *   MAIS borné à `floorDays` jours en arrière pour ne JAMAIS scanner toute la
 *   boîte (sinon fetch de milliers de messages → timeout mailbox).
 * - Aucun envoi → maintenant.
 *
 * BUG-H1 (vrai correctif) : l'ancien `reduce(..., new Date(0))` cherchait un
 * minimum en partant de 1970 → renvoyait TOUJOURS 1970 → scan complet → timeout.
 */
export function pollSinceDate(
  sentAtMs: number[],
  lastPollMs: number | null,
  nowMs: number,
  floorDays = 60,
): Date {
  if (lastPollMs !== null) return new Date(lastPollMs);
  if (sentAtMs.length === 0) return new Date(nowMs);
  const floor = nowMs - floorDays * 24 * 60 * 60 * 1000;
  const earliest = Math.min(...sentAtMs);
  return new Date(Math.max(earliest, floor));
}

export function isAutoReply(opts: {
  autoSubmitted?: string | null;
  xAutoreply?: string | null;
  subject?: string | null;
}): boolean {
  const auto = (opts.autoSubmitted ?? '').trim().toLowerCase();
  if (auto && auto !== 'no') return true;        // auto-replied / auto-generated
  if ((opts.xAutoreply ?? '').trim()) return true;
  return _AUTO_REPLY_SUBJECT_RE.test(opts.subject ?? '');
}
