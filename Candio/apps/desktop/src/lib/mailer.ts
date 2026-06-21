import nodemailer from 'nodemailer';
import { access } from 'fs/promises';
import type { SmtpInput } from '@candio/shared';
import { getSmtp, getDkim } from './secrets';
import { logger } from './logger';
import { checkSenderDeliverability } from './deliverability';

/**
 * Envoi des emails de candidature via le compte SMTP PERSONNEL de
 * l'utilisateur (Gmail, etc.). Aucun service tiers : le mail part directement
 * depuis l'adresse de l'utilisateur.
 *
 * Chaque appel crée puis ferme son propre transporteur (`finally close`) :
 * on évite de laisser un pool SMTP ouvert entre deux envois.
 */

// Convertit le corps texte en HTML : échappement (anti-injection HTML) puis
// retours à la ligne transformés en <br>.
function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
  return `<div>${escaped}</div>`;
}

interface SendParams {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
  cvPath?: string;      // Chemin du PDF du CV à joindre en pièce jointe.
  // BUG-04 fix : threading email — rattache la relance/réponse au fil original.
  inReplyTo?: string;   // Message-ID de l'email initial (header In-Reply-To).
  references?: string;  // Chaîne de threading (header References).
}

// B5 : délai minimum entre deux envois pour éviter le ban SMTP (Gmail ~100/h).
const SMTP_THROTTLE_MS = 3_000;
let lastSmtpSendAt = 0;

/**
 * Envoie un email de candidature. Renvoie le `Message-ID` généré : il est
 * stocké sur la candidature et sert ensuite à rattacher les réponses (IMAP).
 */
export async function sendApplicationEmail(params: SendParams): Promise<string> {
  const smtp = getSmtp();
  if (!smtp) throw new Error('Configuration SMTP absente — renseignez-la dans les Réglages');

  // SEC1 : sanitiser le nom de l'expéditeur pour éviter l'injection CRLF dans
  // les en-têtes email (ex: firstName = "Alice\r\nBcc: evil@spam.com").
  const safeName = params.fromName
    .replace(/[\r\n]/g, '')  // Supprime les retours à la ligne (CRLF injection)
    .replace(/"/g, "'");     // Remplace les guillemets doubles pour ne pas casser le header
  // SEC1 : sanitiser aussi fromEmail pour la défense en profondeur.
  // assertEmail() protège à la saisie mais une ancienne valeur en DB pourrait passer.
  const safeEmail = params.fromEmail.replace(/[\r\n]/g, '');

  // L4 : variable locale immuable — évite de muter le paramètre d'entrée.
  // H6 (revue 6) : vérification asynchrone (access vs existsSync) — ne bloque
  // plus l'event loop du process principal si le CV est sur un FS réseau lent.
  let cvPath = params.cvPath;
  if (cvPath) {
    const cvExists = await access(cvPath).then(() => true).catch(() => false);
    if (!cvExists) {
      logger.warn(`CV introuvable : ${cvPath} — envoi sans pièce jointe`);
      cvPath = undefined;
    }
  }

  // B5 : appliquer le throttle avant l'envoi pour éviter le ban SMTP.
  const now = Date.now();
  const elapsed = now - lastSmtpSendAt;
  if (elapsed < SMTP_THROTTLE_MS) {
    await new Promise<void>((r) => setTimeout(r, SMTP_THROTTLE_MS - elapsed));
  }
  lastSmtpSendAt = Date.now();

  const safeSubject = params.subject.replace(/[\r\n]/g, '');
  const safeTo = params.to.replace(/[\r\n]/g, '');

  // MOD-05 : DKIM signing — si la config DKIM est présente, l'injecter dans le transport.
  const dkimConfig = getDkim();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    ...(dkimConfig ? {
      dkim: {
        domainName: dkimConfig.domainName,
        keySelector: dkimConfig.keySelector,
        privateKey: dkimConfig.privateKey,
      },
    } : {}),
  });
  try {
    const info = await transporter.sendMail({
      from: `"${safeName}" <${safeEmail}>`,
      to: safeTo,
      subject: safeSubject,
      text: params.body,
      html: toHtml(params.body),
      // Joindre le PDF du CV si disponible.
      attachments: cvPath ? [{ filename: 'CV.pdf', path: cvPath }] : undefined,
      // BUG-04 fix : headers de threading RFC 2822 pour que la relance/réponse
      // apparaisse dans le même fil que l'email initial dans le client de messagerie.
      ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
      ...(params.references ? { references: params.references } : {}),
    });
    logger.info(`Email envoyé à ${params.to} (messageId: ${info.messageId})`);
    return info.messageId;
  } finally {
    // Ferme le pool sortant — sans ça, chaque envoi laisse une socket ouverte.
    transporter.close();
  }
}

/**
 * Vérifie qu'une config SMTP permet de se connecter, sans rien envoyer.
 * Utilisée par le bouton « Tester » des Réglages.
 *
 * Strat #3 : effectue aussi un check SPF/DMARC du domaine d'envoi et logue
 * les avertissements — avertit l'utilisateur AVANT qu'il n'envoie des candidatures.
 * Les warnings ne bloquent pas la vérification SMTP (informatif seulement).
 */
export async function verifySmtp(config: SmtpInput): Promise<{ warnings: string[] }> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
  try {
    await transporter.verify();
  } finally {
    transporter.close();
  }
  // Check délivrabilité du domaine expéditeur (non-bloquant même en cas d'échec DNS).
  let warnings: string[] = [];
  try {
    const report = await checkSenderDeliverability(config.user);
    warnings = report.warnings;
  } catch (err) {
    logger.warn('[SMTP] Impossible de vérifier la délivrabilité du domaine expéditeur', err);
  }
  return { warnings };
}
