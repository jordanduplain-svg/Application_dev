/**
 * Fonctions pures de matching IMAP → candidature.
 * Extraites dans ce module pour être testables sans dépendances Electron/Prisma.
 */

export interface InboxMsg {
  from: string;
  inReplyTo: string | null;
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
  inboxMsg: Pick<InboxMsg, 'from' | 'inReplyTo'>,
  app: AppRef,
  allApps: Pick<AppRef, 'company'>[]
): boolean {
  // Priorité 1 : Message-ID initial.
  if (app.messageId && inboxMsg.inReplyTo?.includes(app.messageId)) return true;
  // Priorité 2 : Message-ID de la relance (B2).
  if (app.followUpMessageId && inboxMsg.inReplyTo?.includes(app.followUpMessageId)) return true;

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

/**
 * Clé d'unicité d'un message inbox pour éviter de matcher le même email
 * à deux candidatures différentes.
 */
export function inboxKey(msg: Pick<InboxMsg, 'inReplyTo' | 'from' | 'date'>): string {
  return msg.inReplyTo ?? `${msg.from}:${msg.date.getTime()}`;
}

export type ReplySentiment = 'positive' | 'rejection' | 'neutral';

// Marqueurs de REFUS (FR + EN). Volontairement spécifiques pour éviter les faux
// positifs (« malheureusement » seul ne suffit pas toujours, mais combiné aux
// formules de rejet ci-dessous il est très fiable dans un contexte RH).
const _REJECTION_PATTERNS: RegExp[] = [
  /ne\s+(?:pas\s+)?donn(?:er|ons|ons pas)\s+suite/i,
  /pas\s+donner\s+suite/i,
  /n('|’)?(?:a|avons|ont)\s+pas\s+(?:été\s+)?reten/i,   // « n'a pas été retenue »
  /candidature\s+.*reten/i,
  /ne\s+correspond\s+pas/i,
  /pas\s+(?:de\s+)?(?:poste|besoin|opportunit|recrutement)/i,
  /ne\s+recrut(?:ons|e)\s+pas/i,
  /déclin(?:ons|er)/i,
  /pas\s+en\s+mesure/i,
  /au\s+regret/i,
  /unfortunately/i,
  /not\s+(?:moving|proceed|selected|a\s+fit)/i,
  /we\s+(?:will|won('|’)?t|are\s+not)\s+(?:not\s+)?(?:proceed|moving|hiring)/i,
  /no\s+(?:current\s+)?(?:openings?|positions?|vacanc)/i,
];

// Marqueurs d'INTÉRÊT (priment sur le refus — un email d'entretien n'est pas un refus).
const _POSITIVE_PATTERNS: RegExp[] = [
  /entretien/i,
  /rendez[\s-]?vous/i,
  /(?:vous\s+)?rencontr(?:er|ons)/i,
  /échang(?:er|eons|e)\b/i,
  /(?:votre\s+)?profil\s+.*intéress/i,
  /intéress(?:é|és|ée|ant)\s+par\s+(?:votre|ton)/i,
  /disponibilit/i,
  /interview/i,
  /(?:happy|glad|like)\s+to\s+(?:meet|chat|discuss)/i,
  /next\s+steps?/i,
];

/**
 * Strat #1 — classification légère (heuristique, sans LLM) du sentiment d'une
 * réponse reçue. Sert à distinguer une réponse POSITIVE (intérêt/entretien) d'un
 * REFUS, afin que la boucle de feedback du scraper ne boost pas autant un domaine
 * qui décline systématiquement qu'un domaine intéressé.
 *
 * Priorité : intérêt > refus > neutre (un refus poli peut contenir « malheureusement »
 * tout en proposant un entretien ailleurs — l'intérêt l'emporte).
 */
export function classifyReplySentiment(text: string | null | undefined): ReplySentiment {
  if (!text) return 'neutral';
  const t = text.slice(0, 4000); // borne : seules les 1res lignes portent le verdict
  if (_POSITIVE_PATTERNS.some((re) => re.test(t))) return 'positive';
  if (_REJECTION_PATTERNS.some((re) => re.test(t))) return 'rejection';
  return 'neutral';
}

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
// Marqueurs de DÉBUT de citation (l'email d'origine recopié sous la réponse).
const _QUOTE_START: RegExp[] = [
  /^\s*>/,                                  // ligne citée « > … »
  /^\s*On\b.*\bwrote\s*:?\s*$/i,            // Gmail EN : « On … wrote: »
  /^\s*Le\b.*\ba\s+écrit\s*:?\s*$/i,        // Gmail FR : « Le … a écrit : »
  /^\s*-{2,}\s*Original Message\s*-{2,}/i,  // Outlook
  /^\s*_{5,}\s*$/,                          // séparateur Outlook
  /^\s*De\s*:\s.+/i,                        // en-tête Outlook FR (De : …)
  /^\s*From:\s.+/i,                         // en-tête transféré EN
  /^\s*Begin forwarded message/i,
];

/**
 * Garde uniquement le VRAI message du correspondant : coupe la citation de l'email
 * d'origine recopiée dessous (lignes « > », « On … wrote: », en-têtes Outlook…).
 * Pur/testable. Si tout le contenu est de la citation, renvoie l'original (sécurité).
 */
export function stripQuotedReply(text: string | null | undefined): string {
  if (!text) return '';
  let cut = text.length;

  // 1) Attribution INLINE (Gmail « déplie » souvent la réponse sur une seule ligne :
  //    « … wrote: > Bonjour … »). On coupe dès « On … wrote: » / « Le … a écrit : ».
  for (const re of [
    /\bOn\b[^\n]{0,300}?\bwrote\s*:/i,        // Gmail EN
    /\bLe\b[^\n]{0,300}?\ba\s+écrit\s*:/i,    // Gmail FR
    /-{2,}\s*Original Message\s*-{2,}/i,       // Outlook
    /\bBegin forwarded message\b/i,
  ]) {
    const m = text.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }

  // 2) Marqueurs par LIGNE (texte multi-lignes : « > … », en-têtes Outlook…).
  const lines = text.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    if (_QUOTE_START.some((re) => re.test(line))) { if (offset < cut) cut = offset; break; }
    offset += line.length + 1; // +1 pour le « \n »
  }

  const head = text.slice(0, cut).trim();
  return head || text.trim();
}

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
