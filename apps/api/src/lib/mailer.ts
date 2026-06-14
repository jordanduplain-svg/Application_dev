import { Resend } from 'resend';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Rôle : Envoi d'emails TRANSACTIONNELS de la plateforme (réinitialisation de
 * mot de passe, notifications de compte…).
 *
 * À ne pas confondre avec l'envoi des candidatures : celles-ci partent via la
 * config SMTP PERSONNELLE de l'utilisateur (cf. smtp-sender.worker.ts). Ici,
 * c'est Candio qui écrit à l'utilisateur depuis sa propre adresse.
 *
 * Si `RESEND_API_KEY` n'est pas défini (typiquement en développement), le
 * mailer bascule en mode "log" : le contenu de l'email est journalisé au lieu
 * d'être réellement expédié. Cela évite de bloquer le flux de dev sans clé.
 */

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

interface SendMailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendTransactionalEmail({ to, subject, html, text }: SendMailParams): Promise<void> {
  // Mode dégradé (pas de clé Resend) : on journalise l'email plutôt que de
  // faire échouer l'appelant. Le `text` permet, en dev, de récupérer le code
  // de réinitialisation directement dans les logs.
  if (!resend) {
    logger.warn(
      { to, subject, body: text },
      '[Mailer] RESEND_API_KEY absent — email NON envoyé (mode log)'
    );
    return;
  }

  try {
    await resend.emails.send({ from: env.MAIL_FROM, to, subject, html, text });
    logger.info({ to, subject }, '[Mailer] Email transactionnel envoyé');
  } catch (err) {
    // On propage : l'appelant (ex. la route forgot-password) décide quoi faire.
    logger.error({ err, to }, '[Mailer] Échec envoi email transactionnel');
    throw err;
  }
}

/** Gabarit de l'email contenant le code de réinitialisation de mot de passe. */
export function buildPasswordResetEmail(firstName: string, code: string) {
  const subject = 'Réinitialisation de votre mot de passe Candio';
  const text =
    `Bonjour ${firstName},\n\n` +
    `Voici votre code de réinitialisation de mot de passe : ${code}\n\n` +
    `Ce code est valable 15 minutes. Si vous n'êtes pas à l'origine de cette ` +
    `demande, ignorez cet email — votre mot de passe reste inchangé.\n\n` +
    `— L'équipe Candio`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h1 style="color:#2563EB;font-size:24px">Candio</h1>
      <p>Bonjour ${firstName},</p>
      <p>Voici votre code de réinitialisation de mot de passe :</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:8px;color:#111827;background:#EFF6FF;padding:16px;border-radius:12px;text-align:center">${code}</p>
      <p style="color:#6B7280;font-size:14px">Ce code est valable 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe reste inchangé.</p>
      <p style="color:#9CA3AF;font-size:12px">— L'équipe Candio</p>
    </div>`;
  return { subject, text, html };
}
