import { describe, test, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// Mock nodemailer : aucun vrai SMTP. On capture les arguments de sendMail.
// vi.hoisted : les mocks doivent exister avant le hoisting de vi.mock.
const { sendMail, close, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async (_opts: Record<string, unknown>) => ({ messageId: '<generated-id@test>' }));
  const close = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail, close }));
  return { sendMail, close, createTransport };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

// Mock des secrets : SMTP factice, pas de DKIM.
vi.mock('./secrets', () => ({
  getSmtp: vi.fn(() => ({ host: 'smtp.test', port: 587, secure: false, user: 'me@test.io', pass: 'pw' })),
  getDkim: vi.fn(() => null),
}));

import { sendApplicationEmail } from './mailer';
import { getSmtp } from './secrets';

beforeAll(() => {
  // Neutralise le throttle anti-spam (setTimeout) pour ne pas attendre 3 s entre les envois.
  vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; });
});
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => { sendMail.mockClear(); close.mockClear(); createTransport.mockClear(); });

const base = { fromName: 'Jean Dupont', fromEmail: 'jean@test.io', to: 'rh@acme.com', subject: 'Candidature', body: 'Bonjour,\nVoici ma candidature.' };

describe('sendApplicationEmail', () => {
  test('renvoie le messageId du transport et envoie le bon contenu', async () => {
    const id = await sendApplicationEmail({ ...base });
    expect(id).toBe('<generated-id@test>');
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.test', port: 587 }));
    const arg = sendMail.mock.calls[0]![0];
    expect(arg.to).toBe('rh@acme.com');
    expect(arg.subject).toBe('Candidature');
    expect(arg.text).toBe(base.body);
    expect(arg.html).toContain('<br>'); // le saut de ligne devient <br>
    expect(close).toHaveBeenCalled();   // le transport est toujours fermé
  });

  test('ajoute les en-têtes de threading quand fournis (relance/réponse dans le fil)', async () => {
    await sendApplicationEmail({ ...base, inReplyTo: '<orig@smtp>', references: '<orig@smtp>' });
    const arg = sendMail.mock.calls[0]![0];
    expect(arg.inReplyTo).toBe('<orig@smtp>');
    expect(arg.references).toBe('<orig@smtp>');
  });

  test('pas d\'en-têtes de threading par défaut', async () => {
    await sendApplicationEmail({ ...base });
    const arg = sendMail.mock.calls[0]![0];
    expect(arg.inReplyTo).toBeUndefined();
    expect(arg.references).toBeUndefined();
  });

  test('SEC1 : neutralise l\'injection CRLF dans le nom de l\'expéditeur', async () => {
    // La défense = retirer les CRLF : sans saut de ligne, impossible de démarrer un
    // nouvel en-tête (« Bcc: ») même si le texte reste collé sur la même ligne.
    await sendApplicationEmail({ ...base, fromName: 'Alice\r\nBcc: evil@spam.com' });
    const from = sendMail.mock.calls[0]![0].from as string;
    expect(from).not.toMatch(/[\r\n]/);
  });

  test('CV inexistant → envoi SANS pièce jointe (pas de crash)', async () => {
    await sendApplicationEmail({ ...base, cvPath: '/chemin/inexistant/CV.pdf' });
    expect(sendMail.mock.calls[0]![0].attachments).toBeUndefined();
  });

  test('lève si la config SMTP est absente', async () => {
    vi.mocked(getSmtp).mockReturnValueOnce(null);
    await expect(sendApplicationEmail({ ...base })).rejects.toThrow(/SMTP/);
  });

  test('propage l\'erreur SMTP et ferme quand même le transport', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP 535 auth refused'));
    await expect(sendApplicationEmail({ ...base })).rejects.toThrow(/535/);
    expect(close).toHaveBeenCalled(); // finally → fermeture garantie
  });
});
