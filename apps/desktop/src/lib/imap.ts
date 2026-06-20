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
  inReplyTo: string | null;
  text: string;
  // BOUNCE-01 : true si ce message est un NDR (Non-Delivery Report / bounce).
  isBounce: boolean;
  // BOUNCE-01 : Message-ID de l'email original extrait du corps du NDR.
  bouncedMessageId: string | null;
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

function classifyBounce(
  from: string,
  subject: string,
  text: string
): { isBounce: boolean; bouncedMessageId: string | null } {
  const isBounce = BOUNCE_FROM_RE.test(from) || BOUNCE_SUBJECT_RE.test(subject);
  if (!isBounce) return { isBounce: false, bouncedMessageId: null };
  const match = BOUNCED_MID_RE.exec(text);
  return { isBounce: true, bouncedMessageId: match ? match[1] : null };
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
            for await (const msg of client.fetch(batch, { source: true }, { uid: true })) {
              if (!msg.source) continue;
              const parsed: ParsedMail = await simpleParser(msg.source);
              const from    = parsed.from?.value?.[0]?.address ?? '';
              const subject = parsed.subject ?? '';
              const text    = parsed.text ?? '';
              const { isBounce, bouncedMessageId } = classifyBounce(from, subject, text);
              // AUTO-REPLY : en-têtes RFC 3834 (simpleParser met les clés en minuscules).
              const headerStr = (name: string): string | null => {
                const v = parsed.headers.get(name);
                return typeof v === 'string' ? v : null;
              };
              messages.push({
                from,
                subject,
                date: parsed.date ?? new Date(),
                inReplyTo: (parsed.inReplyTo as string | null) ?? null,
                text,
                isBounce,
                bouncedMessageId,
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

    const mailboxTimeout = new Promise<never>((_, reject) => {
      mailboxTimeoutId = setTimeout(
        () => reject(new Error('IMAP: opérations mailbox timeout (60 s)')),
        MAILBOX_TIMEOUT_MS
      );
    });

    try {
      await Promise.race([mailboxOp(), mailboxTimeout]);
    } finally {
      if (mailboxTimeoutId !== null) clearTimeout(mailboxTimeoutId);
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return messages;
}
