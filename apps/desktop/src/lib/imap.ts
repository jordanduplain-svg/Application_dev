import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import type { ImapInput } from '@candio/shared';
import { getImap } from './secrets';
import { isAutoReply } from '../tasks/reply-matching';

/**
 * Lecture de la boîte de réception par IMAP, pour détecter les réponses.
 * Approche par POLLING : relevé périodique déclenché par le task-runner.
 */

export interface InboxMessage {
  from: string;
  subject: string;
  date: Date;
  // THREAD-01 : Message-ID propre du message (dédup des entrants persistés en fil).
  messageId: string | null;
  inReplyTo: string | null;
  // BUG-2 : chaîne References (threading) — testée en plus d'In-Reply-To au matching.
  references: string | null;
  text: string;
  // BOUNCE-01 : true si ce message est un NDR (Non-Delivery Report / bounce).
  isBounce: boolean;
  // BOUNCE-01 : Message-ID de l'email original extrait du corps du NDR.
  bouncedMessageId: string | null;
  // BOUNCE-FALLBACK : adresses email trouvées dans le corps du NDR (repli de matching
  // quand bouncedMessageId est absent — cas des rejets « adresse introuvable »).
  bouncedCandidateEmails: string[];
  // AUTO-REPLY : true si réponse automatique (absence du bureau) — à ne pas
  // marquer comme une vraie réponse à qualifier.
  isAutoReply: boolean;
}

// ── Détection de bounces (NDR) ────────────────────────────────────────────────
// Un NDR vient typiquement de mailer-daemon ou postmaster et contient l'en-tête
// original dans son corps (Message-ID: <xxx>). On extrait l'ID pour retrouver
// la candidature concernée et la marquer comme rebondie.

const BOUNCE_FROM_RE = /mailer-daemon|postmaster|mail delivery/i;
const BOUNCE_SUBJECT_RE =
  /delivery status notification|undelivered mail|mail delivery failed|échec de remise|failure notice|undeliverable|returned to sender|message non remis|delivery failure/i;
// Regex pour extraire le Message-ID original depuis le corps du NDR.
const BOUNCED_MID_RE = /message-id:\s*(<[^>\s]+>)/i;

// BOUNCE-SOFT : un serveur émetteur (Gmail…) qui n'arrive pas à remettre un mail réessaie
// ~48 h et envoie une notif de DIFFÉRÉ à chaque tentative — « Delivery Status Notification
// (Delay) », DSN `Action: delayed` / `Status: 4.x.x`. L'adresse n'est PAS morte : le mail
// peut encore passer. Il ne faut donc PAS marquer la candidature rebondie sur un différé,
// sinon un envoi qui finit par aboutir est flaggé « email mort » à tort (et exclu des
// relances). On ne retient un VRAI rebond que sur un échec DÉFINITIF (5.x.x / Action: failed).
const DSN_PERMANENT_RE = /action:\s*failed|status:\s*5\.\d/i;
const DSN_DELAYED_RE =
  /action:\s*delayed|status:\s*4\.\d|\(delay(?:ed)?\)|\bdelayed\b|will (?:retry|keep trying)|temporar(?:y|ily)|message delayed|retard(?:é)?|différé/i;

// BOUNCE-FALLBACK : un NDR « adresse introuvable » (rejet immédiat au RCPT TO, le cas
// typique d'un email pattern/deviné inexistant) ne recopie SOUVENT PAS le Message-ID
// original dans son corps — contrairement à un NDR différé (boîte pleine), qui renvoie
// le message complet avec ses en-têtes. Sans Message-ID, le bounce était jusque-là
// silencieusement ignoré. On extrait donc aussi les adresses email mentionnées dans le
// corps (le destinataire rejeté y figure quasi toujours en clair) pour permettre un
// matching de repli par adresse — non ambigu — côté poll-replies.
const EMAIL_IN_TEXT_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function extractCandidateEmails(text: string): string[] {
  const matches = text.match(EMAIL_IN_TEXT_RE) ?? [];
  return [...new Set(matches.map((e) => e.toLowerCase()))];
}

/**
 * Corps texte d'un email. simpleParser ne remplit `parsed.text` que depuis la partie
 * text/plain ; beaucoup d'emails de recruteurs/ATS sont HTML-only → `text` vide, ce qui
 * cassait la classification du sentiment, la détection d'opt-out et le contenu affiché.
 * On replie donc sur le HTML converti en texte (dé-balisé, entités courantes décodées).
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')  // vire script/style et leur contenu
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')                          // toutes les autres balises
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function bodyText(parsed: ParsedMail): string {
  const plain = (parsed.text ?? '').trim();
  if (plain) return parsed.text as string;
  if (parsed.html) return htmlToText(parsed.html);
  return '';
}

// BOUNCE-01 : exporté pour test unitaire (soft vs hard). Pas d'effet de bord.
export function classifyBounce(
  from: string,
  subject: string,
  text: string
): { isBounce: boolean; bouncedMessageId: string | null; bouncedCandidateEmails: string[] } {
  const looksLikeDsn = BOUNCE_FROM_RE.test(from) || BOUNCE_SUBJECT_RE.test(subject);
  if (!looksLikeDsn) return { isBounce: false, bouncedMessageId: null, bouncedCandidateEmails: [] };

  // BOUNCE-SOFT : différé sans échec définitif → l'émetteur réessaie encore, ce n'est PAS
  // (encore) un rebond. On attend l'échec permanent (5.x.x / failed) ou l'abandon final.
  const haystack = `${subject}\n${text}`;
  if (DSN_DELAYED_RE.test(haystack) && !DSN_PERMANENT_RE.test(haystack)) {
    return { isBounce: false, bouncedMessageId: null, bouncedCandidateEmails: [] };
  }

  const match = BOUNCED_MID_RE.exec(text);
  return {
    isBounce: true,
    bouncedMessageId: match ? match[1] : null,
    bouncedCandidateEmails: extractCandidateEmails(text),
  };
}

// BUG-M4 fix : séparer taille de batch et limite totale.
// MAX_EMAILS_PER_POLL était trompeur — c'était la taille de batch, pas la limite totale.
// On plafonne maintenant à 500 emails par relevé pour éviter le timeout 60 s sur
// une grande boîte (500 * ~2 Ko/email ≈ 1 Mo → raisonnable).
const FETCH_BATCH_SIZE = 200;
const MAX_EMAILS_TOTAL = 500;
const CONNECT_TIMEOUT_MS = 15_000;
// B9 : timeout sur les opérations mailbox (search + fetch) — une INBOX de
// plusieurs milliers de messages peut bloquer indéfiniment sans cette garde.
const MAILBOX_TIMEOUT_MS = 60_000;

/**
 * H3 : connecte avec un timeout ET ferme la socket pendante si le délai expire.
 *
 * Promise.race() seul abandonne la promesse perdante sans fermer la connexion TCP
 * sous-jacente, créant une fuite de ressources à chaque timeout.
 */
async function connectWithTimeout(client: ImapFlow): Promise<void> {
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  // On démarre la connexion et on conserve sa promesse pour pouvoir l'absorber
  // en cas de timeout (évite une unhandledRejection flottante).
  const connectPromise = client.connect();

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error('IMAP: connexion timeout (15 s)'));
    }, CONNECT_TIMEOUT_MS);
  });

  try {
    await Promise.race([connectPromise, timeoutPromise]);
  } catch (err) {
    if (timedOut) {
      // Absorber le résultat de la connexion pendante (sinon unhandledRejection).
      connectPromise.catch(() => {});
      // Tenter de fermer la socket pour libérer la ressource réseau.
      try { client.close(); } catch { /* ignoré — la socket peut déjà être morte */ }
    }
    throw err;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

/**
 * UX-4 : vérifie qu'une config IMAP permet de se connecter, sans lire d'email.
 * Connecte + logout avec un timeout de 10 s.
 */
export async function verifyImap(config: ImapInput): Promise<void> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const connectPromise = client.connect();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error('IMAP: connexion timeout (10 s)'));
    }, 10_000);
  });

  try {
    await Promise.race([connectPromise, timeoutPromise]);
  } catch (err) {
    if (timedOut) connectPromise.catch(() => {});
    try { client.close(); } catch { /* ignoré */ }
    throw err;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }

  await client.logout().catch(() => undefined);
}

/**
 * fetchInboxSince — ROUAGE de la détection des réponses. Récupère les emails reçus
 * depuis `since`, les parse, et renvoie une liste enrichie (expéditeur, In-Reply-To,
 * bounce ?, auto-reply ?) que poll-replies confrontera ensuite aux candidatures envoyées.
 *
 * Les 2 lignes qui « font » le travail : `client.search({ since })` (quels emails) puis
 * `client.fetch(... source:true)` + `simpleParser` (lire et décoder chacun). Tout le reste
 * est de la robustesse réseau, INDISPENSABLE sur une vraie boîte mail :
 *   • borne `since` à 60 j en amont (cf. pollSinceDate) → jamais un scan complet ;
 *   • cap MAX_EMAILS_TOTAL=500, et on garde les UID les plus RÉCENTS (slice(-N)) car les
 *     UID IMAP sont croissants → sinon on lirait les plus vieux et raterait les réponses ;
 *   • timeouts connexion (15 s) + opérations mailbox (60 s) avec fermeture de socket, sinon
 *     une grande INBOX peut bloquer indéfiniment.
 */
export async function fetchInboxSince(since: Date): Promise<InboxMessage[]> {
  const imap = getImap();
  if (!imap) throw new Error('Configuration IMAP absente — renseignez-la dans les Réglages');

  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
  });

  const messages: InboxMessage[] = [];
  await connectWithTimeout(client);
  try {
    // B9 : les opérations mailbox (search + fetch) sont elles-mêmes enveloppées
    // dans un Promise.race pour éviter un blocage silencieux sur une grande boîte.
    let mailboxTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const mailboxOp = async () => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // ← ROUAGE 1/2 : QUELS emails. search({ since }) demande au serveur les UID des
        //   messages reçus depuis la date — granularité au JOUR côté IMAP (d'où le re-scan
        //   bénin du jour courant, neutralisé par l'idempotence de markReplied en aval).
        // BUG-M4 fix : tronquer à MAX_EMAILS_TOTAL avant de batcher.
        // client.search() peut retourner false (boîte vide) ou number[].
        const rawUids = await client.search({ since }, { uid: true });
        const allUids = Array.isArray(rawUids) ? rawUids : [];
        // AUDIT-H1 fix : UIDs IMAP sont ascendants (plus vieux = plus petit UID).
        // slice(0, N) prenait les N plus ANCIENS → les réponses récentes au-delà
        // du cap étaient silencieusement ignorées. On prend les N plus RÉCENTS.
        const uids = allUids.slice(-MAX_EMAILS_TOTAL);
        if (uids.length > 0) {
          for (let offset = 0; offset < uids.length; offset += FETCH_BATCH_SIZE) {
            const batch = uids.slice(offset, offset + FETCH_BATCH_SIZE);
            // ← ROUAGE 2/2 : LIRE chaque email. fetch(source:true) télécharge le message
            //   brut, simpleParser le décode (en-têtes, texte, In-Reply-To). C'est d'ici
            //   que sortent les champs sur lesquels matchReply décidera « c'est une réponse ».
            for await (const msg of client.fetch(batch, { source: true }, { uid: true })) {
              if (!msg.source) continue;
              const parsed: ParsedMail = await simpleParser(msg.source);
              const from    = parsed.from?.value?.[0]?.address ?? '';
              const subject = parsed.subject ?? '';
              // HTML-ONLY fix : replie sur le HTML dé-balisé quand text/plain est absent.
              const text    = bodyText(parsed);
              const { isBounce, bouncedMessageId, bouncedCandidateEmails } = classifyBounce(from, subject, text);
              // AUTO-REPLY : en-têtes RFC 3834 (simpleParser met les clés en minuscules).
              const headerStr = (name: string): string | null => {
                const v = parsed.headers.get(name);
                return typeof v === 'string' ? v : null;
              };
              // BUG-2 : References peut être une chaîne OU un tableau selon mailparser.
              const references = Array.isArray(parsed.references)
                ? parsed.references.join(' ')
                : ((parsed.references as string | undefined) ?? null);
              messages.push({
                from,
                subject,
                date: parsed.date ?? new Date(),
                // THREAD-01 : Message-ID propre du message reçu → dédup des entrants au polling.
                messageId: (parsed.messageId as string | undefined) ?? null,
                inReplyTo: (parsed.inReplyTo as string | null) ?? null,
                references,
                text,
                isBounce,
                bouncedMessageId,
                bouncedCandidateEmails,
                isAutoReply: isAutoReply({
                  autoSubmitted: headerStr('auto-submitted'),
                  xAutoreply: headerStr('x-autoreply'),
                  subject,
                }),
              });
            }
          }
        }
      } finally {
        lock.release();
      }
    };

    // BUG-3 : si l'opération expire, Promise.race abandonne la promesse perdante mais
    // `mailboxOp()` continue de tourner (lock INBOX tenu) et le `logout()` du finally
    // partirait pendant un fetch en vol. On ferme donc la socket sur timeout pour
    // ABANDONNER réellement l'opération (comme connectWithTimeout pour la connexion).
    let mailboxTimedOut = false;
    const mailboxTimeout = new Promise<never>((_, reject) => {
      mailboxTimeoutId = setTimeout(() => {
        mailboxTimedOut = true;
        reject(new Error('IMAP: opérations mailbox timeout (60 s)'));
      }, MAILBOX_TIMEOUT_MS);
    });

    const op = mailboxOp();
    try {
      await Promise.race([op, mailboxTimeout]);
    } catch (err) {
      if (mailboxTimedOut) {
        op.catch(() => {});                              // absorbe l'op pendante (pas d'unhandledRejection)
        try { client.close(); } catch { /* socket déjà morte */ }
      }
      throw err;
    } finally {
      if (mailboxTimeoutId !== null) clearTimeout(mailboxTimeoutId);
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return messages;
}
