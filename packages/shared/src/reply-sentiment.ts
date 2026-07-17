// Classification pure du sentiment d'une réponse + dé-citation — SANS dépendance Node.
//
// Vit dans packages/shared (et non dans apps/desktop/src) pour être importable À LA FOIS
// par le process principal (imap, poll-replies, stats, company.service) ET par le renderer
// (RepliesPage, PipelinePage) sans que l'UI sandboxée ait à « reculer » dans la couche
// main-process — l'ancien import `renderer → ../../src/tasks/reply-matching` était une
// violation de couche qui cassait dès que reply-matching toucherait un module Node.
// reply-matching.ts ré-exporte ces symboles pour les appelants backend historiques.

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
  /(?:pas|aucun|plus)\b[^.!?]{0,25}(?:de\s+)?(?:poste|besoin|recrutement|ouvertur|vacance)/i,
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

/**
 * SENTIMENT-OVR — sentiment EFFECTIF d'une réponse : correction manuelle si elle existe,
 * sinon heuristique sur le message dé-cité. Source de vérité unique partagée par la page
 * Réponses (pastille) et le Pipeline (filtre « À qualifier »).
 */
export function effectiveSentiment(
  reply: { replyContent: string | null; sentimentOverride: string | null }
): ReplySentiment {
  const o = reply.sentimentOverride;
  if (o === 'positive' || o === 'rejection' || o === 'neutral') return o;
  return classifyReplySentiment(stripQuotedReply(reply.replyContent));
}

// GABARIT DE TICKETING (Zendesk, Freshdesk, Jira SM…) : quand ton mail tombe dans l'outil de
// tickets d'une boîte, la réponse HUMAINE t'est renvoyée ENROBÉE d'un entête automatique —
// « ### X commented on incident [#123] ### », « Reply above this line to add a comment », une
// pastille d'initiales (« HC »), puis l'entête répété en MAJUSCULES. Le vrai message est
// EN DESSOUS. Sans nettoyage, l'affichage commence par ce charabia et la classification lit
// du bruit. On ne cherche le gabarit que dans l'entête (20 premières lignes) et, si rien ne
// matche, le texte est rendu intact.
const _TICKET_BOILERPLATE: RegExp[] = [
  /^\s*#{2,}.*#{2,}\s*$/,              // « ### … ### »
  /reply above this line/i,            // marqueur Zendesk/Freshdesk classique
  /please type your reply above/i,
];

// Entête répété en MAJUSCULES (« HANNAH CRYSTAL COMMENTED ON INCIDENT #15350 »). Sans le
// flag `i` ET en interdisant toute minuscule : une phrase normale contenant « incident »
// n'est jamais touchée.
const _TICKET_CAPS_HEADER = /^[^a-zà-ÿ]*\b(?:COMMENTED|INCIDENT|TICKET|REQUEST|CASE)\b[^a-zà-ÿ]*$/;

// Pastille d'avatar (« HC ») — n'est retirée QUE si on est déjà dans la zone de gabarit.
const _TICKET_INITIALS = /^\s*[A-ZÀ-Ÿ]{1,3}\s*$/;

const _TICKET_HEAD_LINES = 20;

/**
 * Retire l'entête de notification d'un outil de ticketing pour ne garder que le vrai
 * message. Pur. Renvoie le texte inchangé si aucun marqueur n'est trouvé (cas normal).
 */
export function stripTicketBoilerplate(text: string | null | undefined): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const limit = Math.min(lines.length, _TICKET_HEAD_LINES);
  let lastIdx = -1;
  for (let i = 0; i < limit; i++) {
    const l = lines[i];
    const isBoiler = _TICKET_BOILERPLATE.some((re) => re.test(l))
      || _TICKET_CAPS_HEADER.test(l.trim())
      || (lastIdx >= 0 && _TICKET_INITIALS.test(l));
    if (isBoiler) lastIdx = i;
  }
  if (lastIdx < 0) return text;                       // pas un mail de ticketing → intact
  const rest = lines.slice(lastIdx + 1).join('\n').replace(/^\s+/, '');
  return rest || text;                                // sécurité : jamais de résultat vide
}

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
export function stripQuotedReply(input: string | null | undefined): string {
  if (!input) return '';
  // 0) Retire d'abord l'entête d'un outil de ticketing (le vrai message est en dessous).
  const text = stripTicketBoilerplate(input);
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
