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
 * Détermine si un message IMAP est une réponse à une candidature.
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
