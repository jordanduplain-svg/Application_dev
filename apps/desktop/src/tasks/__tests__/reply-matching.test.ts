import { describe, test, expect } from 'vitest';
import { matchReply, matchBounce, inboxKey, detectOptOutRequest, isAutoReply, pollSinceDate, stripQuotedReply, classifyReplySentiment, effectiveSentiment } from '../reply-matching';

// Pas de dépendances Electron/Prisma — fonctions pures, aucun mock nécessaire.

// Fixtures réutilisables.
const app = (contactEmail: string, messageId = '<msg-123@smtp>', followUpMessageId?: string) => ({
  messageId,
  followUpMessageId: followUpMessageId ?? null,
  company: { contactEmail },
});

const msg = (from: string, inReplyTo: string | null, references: string | null = null) =>
  ({ from, inReplyTo, references, date: new Date() });

describe('classifyReplySentiment (paliers ordonnés)', () => {
  test('barrière linguistique EN (« don\'t speak French ») → neutre, PAS intérêt', () => {
    // Même en citant ta candidature (pleine de « entretien / disponible »), ça ne doit pas
    // devenir « intérêt ».
    const t = 'Hello, we do not speak French, could you please write in English?\n\nLe 9 juil. a écrit : je reste disponible pour un entretien.';
    expect(classifyReplySentiment(t)).toBe('neutral');
  });

  test('refus fort FR même en citant ton pitch → refus (pas intérêt)', () => {
    const t = 'Bonjour, nous ne donnons pas suite à votre candidature.\n\nLe 9 juil. a écrit : disponible pour un entretien.';
    expect(classifyReplySentiment(t)).toBe('rejection');
  });

  test('« bonne continuation » et « unfortunately … not moving forward » → refus', () => {
    expect(classifyReplySentiment('Nous vous souhaitons une bonne continuation.')).toBe('rejection');
    expect(classifyReplySentiment('Unfortunately, we are not moving forward with your application.')).toBe('rejection');
  });

  test('intérêt : entretien / profil intéresse / a retenu notre attention → positif', () => {
    expect(classifyReplySentiment('Votre profil nous intéresse, seriez-vous disponible pour un entretien ?')).toBe('positive');
    expect(classifyReplySentiment('Votre candidature a retenu notre attention.')).toBe('positive');
  });

  test('un vrai entretien qui contient « malheureusement » reste positif', () => {
    expect(classifyReplySentiment('Malheureusement le poste A est pourvu, mais nous aimerions vous proposer un entretien pour un autre poste.')).toBe('positive');
  });

  test('voix recruteur « nous aimerions échanger avec vous » → positif (cas SDMS réel)', () => {
    const t = 'Bonjour\nNous avons bien reçu votre candidature et nous aimerions échanger avec vous.\n'
      + 'Seriez-vous disposé çà échanger avec le directeur de production sur les prochaines semaines ?\n'
      + 'Quelles sont disponibilités ?\nCordialement\nFanny PEREZ\nResponsable RH';
    expect(classifyReplySentiment(t)).toBe('positive');
  });

  test('refus faible (poste ne correspond pas) → refus, plus juste « neutre »', () => {
    expect(classifyReplySentiment('Le poste ne correspond pas à votre profil actuellement.')).toBe('rejection');
  });

  test('refus poli FLATTEUR (cas CAPTIVEA réel) → refus, pas intérêt', () => {
    const t = 'Bonjour Jordan,\nNous vous remercions sincèrement pour l\'intérêt que vous portez à Captivea.\n'
      + 'Après une analyse attentive de votre profil, bien que votre parcours présente de réelles qualités et des '
      + 'compétences intéressantes, nous n\'avons pas encore de poste adéquat à votre profil à pourvoir actuellement.\n'
      + 'Cela étant, votre profil a retenu toute notre attention. Avec votre accord, nous souhaiterions conserver '
      + 'votre CV afin de pouvoir revenir vers vous si une opportunité se présente.\n'
      + 'Nous vous souhaitons pleine réussite dans la suite de votre parcours professionnel.';
    expect(classifyReplySentiment(t)).toBe('rejection');
  });

  test('petite structure sans recrutement (cas FONCIPROM réel) → refus', () => {
    const t = 'Bonjour\nPour faire suite à votre mail, nous sommes une petite structure d\'uniquement 3 associés '
      + '(sans salariés) et n\'envisageons aucun recrutement.\nBonne chance dans votre recherche';
    expect(classifyReplySentiment(t)).toBe('rejection');
  });

  test('refus avec adverbes intercalés (« ne recrute toutefois pas », cas J.V. GROUP) → refus', () => {
    const t = 'Bonjour M. Duplain,\nMerci pour l\'intérêt que vous portez à notre entreprise. PTV Mobility France '
      + 'ne recrute toutefois pas actuellement.\nJe vous souhaite le meilleur pour la suite de votre carrière,\nBien cordialement';
    expect(classifyReplySentiment(t)).toBe('rejection');
  });

  test('« pas aujourd\'hui de besoins » + « bon courage » (cas ECEDI) → refus', () => {
    const t = 'Bonjour Jordan,\nnotre agence n\'a pas aujourd\'hui de besoins pour des postes de Data Analyst, '
      + 'je vous laisse quand même contacter l\'adresse suivante au cas où.\nBonne journée et bon courage';
    expect(classifyReplySentiment(t)).toBe('rejection');
  });

  test('renvoi vers le site pour postuler (cas SCI LA ROSE) → neutre (ni intérêt ni refus)', () => {
    const t = 'Bonjour Jordan,\nMerci beaucoup pour votre message et votre intérêt pour La Rosée.\n'
      + 'Pour découvrir toutes nos offres d\'emplois, n\'hésitez pas à vous rendre directement sur notre page. '
      + 'Vous pourrez également postuler directement par l\'intermédiaire de cette plateforme et en candidature spontanée.';
    expect(classifyReplySentiment(t)).toBe('neutral');
  });

  test('citation Gmail « On … wrote: » repliée sur 2 lignes → coupée, verdict = neutre (cas SCI LA ROSE complet)', () => {
    // La candidature citée (avec « entretien / discuter ») ne doit PAS fuir : l'attribution
    // « On <date>, <nom> <email>\nwrote: » a le « wrote: » à la ligne → doit être reconnue.
    const full = [
      'Bonjour Jordan,',
      'Merci beaucoup pour votre message et votre intérêt pour La Rosée.',
      "Pour découvrir toutes nos offres d'emplois, n'hésitez pas à vous rendre sur notre page Welcome to the Jungle.",
      'Vous pourrez également postuler directement et en candidature spontanée.',
      'À bientôt',
      '--',
      'Mathilde',
      '',
      'On Tue, Jul 07 2026, at 07:35 AM, Jordan Duplain <jordan.duplain@gmail.com>',
      'wrote:',
      '',
      'Bonjour,',
      "Je vous contacte pour un poste de Data Analyst, en CDI ou en CDD.",
      'Je reste disponible pour un entretien si vous souhaitez en discuter',
    ].join('\n');
    const stripped = stripQuotedReply(full);
    expect(stripped).not.toMatch(/entretien/i);           // la citation est bien coupée
    expect(classifyReplySentiment(stripped)).toBe('neutral');
  });

  test('simple accusé → neutre', () => {
    expect(classifyReplySentiment('Bonjour, bien reçu, merci.')).toBe('neutral');
  });
});

describe('stripTicketBoilerplate (réponse via outil de tickets)', () => {
  // Cas réel : CELLA MSP — la réponse humaine arrive enrobée du gabarit du helpdesk.
  const ticket = '### Hannah Crystal commented on incident Incident [#15350] ###\n\n'
    + 'Reply above this line to add a comment\n\n\nHC\n\n\n'
    + 'HANNAH CRYSTAL COMMENTED ON INCIDENT #15350\n\n\n'
    + 'Hello Jordan,\n\nUnfortunately, we are not moving forward with your application.';

  test('ne garde que le vrai message, sans le charabia du ticket', () => {
    const out = stripQuotedReply(ticket);
    expect(out.startsWith('Hello Jordan,')).toBe(true);
    expect(out).not.toMatch(/###|Reply above this line|COMMENTED ON INCIDENT/);
  });

  test('le refus reste correctement détecté après nettoyage', () => {
    expect(classifyReplySentiment(stripQuotedReply(ticket))).toBe('rejection');
  });

  test('un email NORMAL n\'est jamais amputé', () => {
    const normal = 'Bonjour,\n\nNous avons bien reçu votre candidature.\n\nCordialement';
    expect(stripQuotedReply(normal)).toBe(normal);
  });

  test('une phrase contenant « incident » en minuscules n\'est pas prise pour un entête', () => {
    const t = 'Bonjour,\n\nSuite à un incident technique, je reviens vers vous.\n\nCordialement';
    expect(stripQuotedReply(t)).toBe(t);
  });
});

describe('effectiveSentiment (correction manuelle > heuristique)', () => {
  test('sans override → heuristique sur le message dé-cité', () => {
    expect(effectiveSentiment({ replyContent: 'Nous ne donnons pas suite.', sentimentOverride: null }))
      .toBe('rejection');
  });
  test('override valide → prime sur l\'heuristique', () => {
    // L'heuristique dirait « rejection » ; l'utilisateur corrige en « positive ».
    expect(effectiveSentiment({ replyContent: 'Nous ne donnons pas suite.', sentimentOverride: 'positive' }))
      .toBe('positive');
  });
  test('override invalide (valeur inconnue) → repli sur heuristique', () => {
    expect(effectiveSentiment({ replyContent: 'Bien reçu, merci.', sentimentOverride: 'bogus' }))
      .toBe('neutral');
  });
});

describe('matchReply', () => {
  // Test 6 : matching par Message-ID
  test('matche par In-Reply-To (Message-ID initial)', () => {
    const inboxMsg = msg('recruiter@acme.com', '<msg-123@smtp>');
    const candidature = app('recruiter@acme.com', '<msg-123@smtp>');

    expect(matchReply(inboxMsg, candidature, [candidature])).toBe(true);
  });

  // BUG-2 : matching par l'en-tête References quand In-Reply-To est absent.
  test('matche par References même si l\'expéditeur diffère (In-Reply-To absent)', () => {
    // ATS qui répond depuis une adresse no-reply (≠ contact) sans In-Reply-To, mais
    // dont le header References cite le Message-ID initial → doit matcher.
    const inboxMsg = msg('ats-noreply@workday.com', null, '<thread-x@smtp> <msg-123@smtp>');
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

describe('matchBounce (BOUNCE-FALLBACK)', () => {
  const bounceApp = (contactEmail: string, messageId: string, emailBounced = false) =>
    ({ messageId, followUpMessageId: null, emailBounced, company: { contactEmail } });

  test('matche par Message-ID quand présent (cas fiable)', () => {
    const a = bounceApp('rh@acme.com', '<msg-1@smtp>');
    const msg = { bouncedMessageId: '<msg-1@smtp>', bouncedCandidateEmails: [] };
    expect(matchBounce(msg, [a])).toBe(a);
  });

  test('replie sur l\'adresse email du NDR quand le Message-ID est absent', () => {
    // Rejet immédiat « adresse introuvable » : pas de Message-ID dans le corps,
    // mais l'adresse rejetée y figure en clair.
    const a = bounceApp('albert.einstein@nuxit.com', '<msg-2@smtp>');
    const msg = { bouncedMessageId: null, bouncedCandidateEmails: ['albert.einstein@nuxit.com'] };
    expect(matchBounce(msg, [a])).toBe(a);
  });

  test('ne matche PAS si l\'adresse est ambiguë (plusieurs candidatures)', () => {
    const a1 = bounceApp('rh@bigcorp.fr', '<msg-3@smtp>');
    const a2 = bounceApp('rh@bigcorp.fr', '<msg-4@smtp>');
    const msg = { bouncedMessageId: null, bouncedCandidateEmails: ['rh@bigcorp.fr'] };
    expect(matchBounce(msg, [a1, a2])).toBeUndefined();
  });

  test('ignore une candidature déjà marquée rebondie', () => {
    const a = bounceApp('rh@acme.com', '<msg-5@smtp>', /* emailBounced */ true);
    const msg = { bouncedMessageId: null, bouncedCandidateEmails: ['rh@acme.com'] };
    expect(matchBounce(msg, [a])).toBeUndefined();
  });

  test('aucun candidat email → pas de match', () => {
    const a = bounceApp('rh@acme.com', '<msg-6@smtp>');
    const msg = { bouncedMessageId: null, bouncedCandidateEmails: [] };
    expect(matchBounce(msg, [a])).toBeUndefined();
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
    'Stop avec vos emails',              // formule FR courante « stop … emails »
    'Arrêtez vos emails',
    'Arrêtez de me contacter',
    'Cessez vos envois',
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

describe('pollSinceDate (anti scan-complet / timeout)', () => {
  const NOW = new Date('2026-06-21T10:00:00Z').getTime();
  const DAY = 24 * 60 * 60 * 1000;

  test('un dernier relevé existe → on repart de là', () => {
    const last = NOW - 2 * DAY;
    expect(pollSinceDate([NOW - 5 * DAY], last, NOW).getTime()).toBe(last);
  });

  test('pas de relevé → plus ancien envoi récent', () => {
    const earliest = NOW - 3 * DAY;
    expect(pollSinceDate([earliest, NOW - DAY], null, NOW).getTime()).toBe(earliest);
  });

  test('pas de relevé + envoi très ancien → borné au plancher (60 j)', () => {
    const veryOld = NOW - 400 * DAY;
    expect(pollSinceDate([veryOld], null, NOW).getTime()).toBe(NOW - 60 * DAY);
  });

  test('aucun envoi → maintenant', () => {
    expect(pollSinceDate([], null, NOW).getTime()).toBe(NOW);
  });

  test('RÉGRESSION : ne renvoie JAMAIS 1970 (le bug d\'origine)', () => {
    const since = pollSinceDate([NOW - DAY], null, NOW);
    expect(since.getFullYear()).toBeGreaterThan(2020);
  });
});

describe('stripQuotedReply (n\'afficher que le vrai message)', () => {
  test('coupe la citation Gmail EN « On … wrote: »', () => {
    const raw = 'Merci pour votre message, intéressé.\nOn Sun, Jun 21, 2026 at 7:25 AM Jordan wrote:\n> Bonjour,\n> ma candidature…';
    expect(stripQuotedReply(raw)).toBe('Merci pour votre message, intéressé.');
  });
  test('coupe la citation FR « Le … a écrit : »', () => {
    const raw = 'Bonjour, on peut se rencontrer ?\nLe 21 juin 2026 à 07:25, Jordan a écrit :\n> Bonjour…';
    expect(stripQuotedReply(raw)).toBe('Bonjour, on peut se rencontrer ?');
  });
  test('coupe dès la première ligne citée « > »', () => {
    expect(stripQuotedReply('Top, je vous rappelle.\n> texte d\'origine')).toBe('Top, je vous rappelle.');
  });
  test('coupe l\'en-tête Outlook « De : »', () => {
    expect(stripQuotedReply('Reçu, merci.\nDe : Jordan\nEnvoyé : …')).toBe('Reçu, merci.');
  });
  test('cas INLINE (tout sur une ligne, Gmail déplié) → coupe à l\'attribution', () => {
    const raw = 'Test 3-4 On Sun, Jun 21, 2026 at 7:15 AM Jordan Duplain wrote: > Bonjour, > Sopra Steria…';
    expect(stripQuotedReply(raw)).toBe('Test 3-4');
  });
  test('réponse sans citation → inchangée', () => {
    expect(stripQuotedReply('Bonjour, votre profil nous intéresse.')).toBe('Bonjour, votre profil nous intéresse.');
  });
  test('tout est de la citation → on garde l\'original (sécurité)', () => {
    const raw = '> Bonjour,\n> ma candidature…';
    expect(stripQuotedReply(raw)).toBe(raw.trim());
  });
  test('vide → chaîne vide', () => {
    expect(stripQuotedReply('')).toBe('');
  });
});

describe('inboxKey', () => {
  test('utilise le Message-ID PROPRE du message, sinon from+timestamp', () => {
    const date = new Date('2025-01-01T10:00:00Z');
    expect(inboxKey({ messageId: '<own-1@smtp>', from: 'a@b.com', date }))
      .toBe('<own-1@smtp>');
    expect(inboxKey({ messageId: null, from: 'a@b.com', date }))
      .toBe(`a@b.com:${date.getTime()}`);
  });

  test('BUG-ÉCHANGE : 2 messages du MÊME fil ont des clés DIFFÉRENTES', () => {
    // Deux réponses du recruteur au même mail initial → même In-Reply-To, mais ce sont
    // bien deux emails distincts. Avec l'ancienne clé (In-Reply-To), le 2ᵉ était jeté.
    const date = new Date('2025-01-01T10:00:00Z');
    const a = inboxKey({ messageId: '<rh-1@corp>', from: 'rh@corp.com', date });
    const b = inboxKey({ messageId: '<rh-2@corp>', from: 'rh@corp.com', date });
    expect(a).not.toBe(b);
  });
});
