/**
 * Fonctions pures de matching IMAP → candidature.
 * Extraites dans ce module pour être testables sans dépendances Electron/Prisma.
 */

export interface InboxMsg {
  from: string;
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
 * Clé d'unicité d'un message inbox pour éviter de matcher le même email
 * à deux candidatures différentes.
 */
export function inboxKey(msg: Pick<InboxMsg, 'inReplyTo' | 'from' | 'date'>): string {
  return msg.inReplyTo ?? `${msg.from}:${msg.date.getTime()}`;
}

export type ReplySentiment = 'positive' | 'rejection' | 'neutral';

// BARRIÈRE LINGUISTIQUE / hors-sujet → NEUTRE (ni intérêt ni refus). Empêche qu'un mail
// « nous ne lisons pas le français, réécrivez en anglais » soit pris pour de l'intérêt à
// cause de TA candidature citée en dessous (pleine de « entretien / échange / disponible »).
const _LANGUAGE_BARRIER: RegExp[] = [
  /ne\s+(?:parl|li|comprenn|lis)\w*\s+(?:pas\s+)?(?:le\s+)?fran[çc]ais/i,
  /(?:don['’]?t|do\s+not|cannot|can['’]?t)\s+(?:speak|read|understand)\s+french/i,
  /(?:in|write|reply|respond|resend|send)\b.{0,25}\benglish\b/i,
  /\benglish[-\s]?(?:only|speaking)\b/i,
  /\ben\s+anglais\b/i,
];

// REFUS FORT — formules de déclin SANS ambiguïté. Vérifié AVANT l'intérêt : une lettre de
// refus recopie souvent ta candidature (« je reste disponible pour un entretien ») → sans
// cette priorité, ces mots CITÉS la feraient passer pour « intérêt ».
const _STRONG_REJECTION: RegExp[] = [
  /ne\s+(?:pas\s+)?donn(?:er|ons|erons)?\s+(?:pas\s+)?suite/i,
  /pas\s+donner\s+suite/i,
  /n['’]?(?:a|avons|ont)\s+pas\s+(?:été\s+)?reten/i,        // « n'a pas été retenue »
  /pas\s+reten(?:u|ue|us|ues)/i,
  /au\s+regret/i,
  /regret\s+to\s+inform/i,
  /ne\s+recrut\w*\b[^.!?]{0,20}\bpas\b/i,                    // « ne recrute toutefois pas »
  /déclin(?:ons|er|ée?s?)/i,
  /(?:poste|offre)\s+(?:déjà\s+)?pourvu/i,
  /(?:retenu|choisi|sélectionné)\s+(?:un\s+autre|d['’]autres?)\s+(?:candidat|profil)/i,
  // Refus FR polis (souvent flatteurs : « votre profil a retenu notre attention, MAIS… »),
  // avec tolérance aux adverbes intercalés (« pas AUJOURD'HUI de besoins »).
  /bon(?:ne)?\s+(?:continuation|chance|courage|réussite)/i, // clôtures classiques d'un refus
  /pleine\s+réussite/i,
  /n['’]envisageons?\s+(?:aucun|pas|plus)/i,
  /(?:pas|aucun|plus)\b[^.!?]{0,25}(?:de\s+)?(?:poste|besoin|recrutement|opportunit|ouvertur|vacance)/i,
  /pas\s+(?:encore\s+)?(?:de\s+)?poste\s+(?:adéquat|adapté|correspondant|à\s+pourvoir|disponible|vacant|ouvert)/i,
  /(?:conserv|gard)\w*\s+votre\s+(?:cv|candidature)/i,       // « conserver votre CV » = non poli
  /revenir\s+vers\s+vous\s+si/i,
  // Vœux de clôture d'un refus (« le meilleur pour la suite de votre carrière »).
  /(?:le\s+meilleur|bonne\s+suite|beaucoup\s+de\s+réussite)\b[^.!?]{0,25}(?:carrière|parcours|recherche|projet|suite)/i,
  /pour\s+la\s+suite\s+de\s+(?:votre|ta)\s+(?:carrière|parcours|recherche)/i,
  /unfortunately/i,
  /not\s+(?:be\s+)?(?:moving\s+forward|proceed(?:ing)?|selected|a\s+(?:good\s+)?fit)/i,
  /we\s+(?:will\s+not|won['’]?t|regret\s+to|are\s+not\s+(?:able|moving|proceeding|selecting))/i,
  /no\s+(?:current\s+)?(?:openings?|positions?|vacanc|roles?)\b/i,
];

// INTÉRÊT — entretien/rencontre proposés. (Après le refus fort → un refus qui cite ton
// pitch ne l'emporte pas ; avant le refus faible → un vrai entretien « malheureusement… »
// reste positif.)
const _POSITIVE_PATTERNS: RegExp[] = [
  /entretien/i,
  /rendez[\s-]?vous/i,
  /(?:vous\s+)?rencontr(?:er|ons|erions)/i,
  /interview/i,
  /next\s+steps?/i,
  // Resserré (.{0,40}, plus .* gourmand) : « votre profil nous intéresse », PAS un refus qui
  // sème « profil » et « compétences intéressantes » à 3 lignes d'écart.
  /(?:votre\s+)?(?:profil|candidature)\s+.{0,40}intéress/i,
  /reten\w*\s+.{0,12}attention/i,                           // « a retenu notre attention »
  /convenir\s+d['’]un/i,
  // « échanger / discuter / rencontrer » MAIS en VOIX RECRUTEUR uniquement (« nous aimerions
  // échanger », « seriez-vous disposé à échanger », « échanger avec le directeur ») → n'attrape
  // PAS ton pitch, écrit à la 1ʳᵉ personne (« un échange est envisageable »).
  /(?:aimerions|souhait(?:ons|erions|erions bien)|serions\s+ravis?|serait\s+ravi)\b[^.!?]{0,40}(?:échang|rencontr|discut|entretien|vous\s+(?:voir|recevoir))/i,
  /dispos\w+[^.!?]{0,15}(?:à|a|ç?a|pour)\s*(?:échang|discut|rencontr|un\s+(?:entretien|appel|échange))/i,
  /échang\w*\s+avec\s+(?:le|la|notre|nos|un|une|l['’])\s*\w*\s*(?:directeur|responsable|équipe|manager|dirigeant|g[ée]rant|recruteu)/i,
  // Le recruteur qui DEMANDE tes disponibilités (« quelles sont vos disponibilités ? »).
  /quelle?s?\s+(?:sont\s+)?(?:vos\s+)?disponibilit/i,
  /(?:indiquez|donnez|communiquez|vos)\b[^.!?]{0,20}disponibilit/i,
  /(?:happy|glad|pleased|would\s+like)\s+to\s+(?:meet|chat|discuss|invite|schedule)/i,
  /proposer\s+un\s+(?:entretien|créneau|rendez)/i,
];

// REFUS FAIBLE — formules plus douces (après l'intérêt, pour ne pas voler un vrai entretien).
const _WEAK_REJECTION: RegExp[] = [
  /malheureusement/i,
  /ne\s+correspond\s+pas/i,
  /pas\s+(?:de\s+)?(?:poste|besoin|opportunit|recrutement|ouvert)/i,
  /pas\s+en\s+mesure/i,
  /nous\s+reviendrons\s+vers\s+vous/i,
  /(?:gard|conserv)(?:ons|erons)\s+votre\s+(?:candidature|cv)/i,
  /vous\s+souhait(?:ons|e)\b.{0,25}(?:réussite|succès|bonne)/i,
];

/**
 * Strat #1 — classification légère (heuristique, sans LLM) du sentiment d'une réponse.
 * PALIERS ORDONNÉS (robustes à la citation de ta candidature en dessous) :
 *   0. barrière linguistique / hors-sujet → neutre ;
 *   1. refus FORT → refus (prime sur l'intérêt : un refus cite souvent ton pitch) ;
 *   2. intérêt (entretien/rencontre) → positif ;
 *   3. refus FAIBLE → refus ;
 *   4. sinon → neutre.
 */
export function classifyReplySentiment(text: string | null | undefined): ReplySentiment {
  if (!text) return 'neutral';
  const t = text.slice(0, 4000); // borne : seules les 1res lignes portent le verdict
  if (_LANGUAGE_BARRIER.some((re) => re.test(t))) return 'neutral';
  if (_STRONG_REJECTION.some((re) => re.test(t))) return 'rejection';
  if (_POSITIVE_PATTERNS.some((re) => re.test(t))) return 'positive';
  if (_WEAK_REJECTION.some((re) => re.test(t))) return 'rejection';
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
  /^\s*wrote\s*:?\s*$/i,                    // « wrote: » seul (attribution repliée sur 2 lignes)
  /^\s*a\s+écrit\s*:?\s*$/i,                // « a écrit : » seul
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
    // [\s\S] (et non [^\n]) : l'attribution Gmail passe souvent à la ligne — « On <date>,
    // <nom> <email>\nwrote: ». Les ancres « wrote: » / « a écrit : » n'existent pas dans un
    // texte FR/EN normal → aucun risque de fausse coupe.
    /\bOn\b[\s\S]{0,300}?\bwrote\s*:/i,        // Gmail EN (mono- ou multi-ligne)
    /\bLe\b[\s\S]{0,300}?\ba\s+écrit\s*:/i,    // Gmail FR (mono- ou multi-ligne)
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
