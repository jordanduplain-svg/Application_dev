import { describe, test, expect } from 'vitest';
import { matchReply, inboxKey, detectOptOutRequest, isAutoReply } from '../reply-matching';

// Pas de dépendances Electron/Prisma — fonctions pures, aucun mock nécessaire.

// Fixtures réutilisables.
const app = (contactEmail: string, messageId = '<msg-123@smtp>', followUpMessageId?: string) => ({
  messageId,
  followUpMessageId: followUpMessageId ?? null,
  company: { contactEmail },
});

const msg = (from: string, inReplyTo: string | null) => ({ from, inReplyTo, date: new Date() });

describe('matchReply', () => {
  // Test 6 : matching par Message-ID
  test('matche par In-Reply-To (Message-ID initial)', () => {
    const inboxMsg = msg('recruiter@acme.com', '<msg-123@smtp>');
    const candidature = app('recruiter@acme.com', '<msg-123@smtp>');

    expect(matchReply(inboxMsg, candidature, [candidature])).toBe(true);
  });

  // Test 7 : matching par adresse email exacte (quand pas d'In-Reply-To)
  test('matche par adresse email exacte quand In-Reply-To est absent', () => {
    // Certains clients mail (webmail basiques) ne renvoient pas In-Reply-To.
    const inboxMsg = msg('rh@startup.io', null);
    const candidature = app('rh@startup.io', '<msg-456@smtp>');

    expect(matchReply(inboxMsg, candidature, [candidature])).toBe(true);
  });

  // Test 8 : pas de match si domaine ambigu
  test('ne matche PAS sur le domaine si plusieurs candidatures ciblent ce domaine', () => {
    // Deux recruteurs du même groupe → risque de faux positif → on refuse le match.
    const app1 = app('alice@bigcorp.fr', '<id-1@smtp>');
    const app2 = app('bob@bigcorp.fr', '<id-2@smtp>');
    const allApps = [app1, app2];

    // Un email de bigcorp.fr sans In-Reply-To reconnu → ambigu → false.
    const inboxMsg = msg('noreply@bigcorp.fr', null);
    expect(matchReply(inboxMsg, app1, allApps)).toBe(false);
    expect(matchReply(inboxMsg, app2, allApps)).toBe(false);
  });
});

describe('detectOptOutRequest (RGPD option A)', () => {
  test.each([
    'Merci de me désinscrire de votre liste.',
    'Je ne souhaite plus être contacté.',
    'Merci de ne plus me contacter à cette adresse.',
    'Pouvez-vous me retirer de votre fichier ?',
    'Please unsubscribe me.',
    'Remove me from your mailing list.',
    'STOP',
    'stop.',
    'Please stop emailing me.',
  ])('détecte la désinscription : %s', (txt) => {
    expect(detectOptOutRequest(txt)).toBe(true);
  });

  test.each([
    'Bonjour, merci pour votre candidature, nous ne donnons pas suite.',          // refus ≠ désinscription
    'Votre profil ne correspond pas à nos besoins actuels.',
    'Nous serions ravis de vous rencontrer pour un entretien.',
    'Malheureusement, pas de poste ouvert pour le moment.',
    '',
  ])('ne confond PAS un refus/intérêt avec une désinscription : %s', (txt) => {
    expect(detectOptOutRequest(txt)).toBe(false);
  });

  test('borne aux 4000 premiers caractères', () => {
    const long = 'a'.repeat(5000) + ' désinscription';
    expect(detectOptOutRequest(long)).toBe(false); // au-delà de la borne → ignoré
  });
});

describe('isAutoReply (filtre absence du bureau)', () => {
  test('Auto-Submitted ≠ no ⇒ automatique', () => {
    expect(isAutoReply({ autoSubmitted: 'auto-replied' })).toBe(true);
    expect(isAutoReply({ autoSubmitted: 'auto-generated' })).toBe(true);
  });
  test('Auto-Submitted: no ⇒ humain', () => {
    expect(isAutoReply({ autoSubmitted: 'no' })).toBe(false);
  });
  test('X-Autoreply présent ⇒ automatique', () => {
    expect(isAutoReply({ xAutoreply: 'yes' })).toBe(true);
  });
  test.each([
    'Réponse automatique : absent du bureau',
    'Out of Office: back on Monday',
    'Automatic reply',
    'Je suis actuellement en congés',
  ])('sujet d\'absence ⇒ automatique : %s', (subject) => {
    expect(isAutoReply({ subject })).toBe(true);
  });
  test('vraie réponse RH ⇒ pas auto', () => {
    expect(isAutoReply({ subject: 'Re: Candidature — entretien possible ?', autoSubmitted: 'no' })).toBe(false);
  });
});

describe('inboxKey', () => {
  test('utilise In-Reply-To si disponible, sinon from+timestamp', () => {
    const date = new Date('2025-01-01T10:00:00Z');
    expect(inboxKey({ inReplyTo: '<ref@smtp>', from: 'a@b.com', date }))
      .toBe('<ref@smtp>');
    expect(inboxKey({ inReplyTo: null, from: 'a@b.com', date }))
      .toBe(`a@b.com:${date.getTime()}`);
  });
});
