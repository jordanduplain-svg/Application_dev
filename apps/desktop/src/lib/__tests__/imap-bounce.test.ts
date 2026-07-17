/**
 * BOUNCE-01 : classifyBounce doit distinguer un DIFFÉRÉ (soft, l'émetteur réessaie) d'un
 * ÉCHEC DÉFINITIF (hard, adresse morte). Un différé NE DOIT PAS marquer la candidature
 * rebondie — sinon un mail qui finit par passer est flaggé « mort » et exclu des relances.
 *
 * imap.ts importe secrets.ts → electron : on stubbe electron pour pouvoir l'importer.
 */
import { describe, test, expect, vi } from 'vitest';

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }));

import { classifyBounce, htmlToText } from '../imap';

describe('classifyBounce (soft vs hard)', () => {
  test('échec DÉFINITIF (Status 5.1.1) → rebond', () => {
    const r = classifyBounce(
      'mailer-daemon@googlemail.com',
      'Delivery Status Notification (Failure)',
      'Action: failed\nStatus: 5.1.1\nThe email account that you tried to reach does not exist.\nMessage-ID: <orig-1@smtp>',
    );
    expect(r.isBounce).toBe(true);
    expect(r.bouncedMessageId).toBe('<orig-1@smtp>');
  });

  test('DIFFÉRÉ Gmail (Delay, Status 4.x.x) → PAS un rebond', () => {
    const r = classifyBounce(
      'mailer-daemon@googlemail.com',
      'Delivery Status Notification (Delay)',
      'Action: delayed\nStatus: 4.4.1\nYour message will be retried for 46 more hours.\nMessage-ID: <orig-2@smtp>',
    );
    expect(r.isBounce).toBe(false);
  });

  test('différé PUIS échec définitif dans le même corps → rebond (le hard l\'emporte)', () => {
    const r = classifyBounce(
      'mailer-daemon@googlemail.com',
      'Delivery Status Notification (Failure)',
      'Previously delayed. Action: failed\nStatus: 5.0.0\nMessage-ID: <orig-3@smtp>',
    );
    expect(r.isBounce).toBe(true);
  });

  test('vraie réponse d\'un recruteur → PAS un rebond', () => {
    const r = classifyBounce('rh@acme.com', 'Re: Candidature spontanée', 'Bonjour, merci pour votre message…');
    expect(r.isBounce).toBe(false);
  });
});

describe('htmlToText (fallback emails HTML-only)', () => {
  test('dé-balise, préserve les sauts de ligne et décode les entités', () => {
    const html = '<div><p>Bonjour,</p><p>Nous ne donnons pas suite &agrave; votre candidature.</p>'
      + '<br>Cordialement&nbsp;&amp; bonne continuation</div><style>.x{color:red}</style>';
    const t = htmlToText(html);
    expect(t).toContain('Bonjour,');
    expect(t).toContain('ne donnons pas suite');   // → classifiable en refus
    expect(t).toContain('&');                       // &amp; décodé
    expect(t).not.toMatch(/<[^>]+>/);               // plus aucune balise
    expect(t).not.toContain('color:red');           // contenu <style> supprimé
  });
});
