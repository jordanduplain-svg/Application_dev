// RGPD — logique pure de correspondance opt-out (sans DB, testable isolément).

export type OptOutKind = 'email' | 'domain';

/** Normalise une saisie : minuscules, sans espaces, sans « mailto: » ni « @ » de tête. */
export function normalizeValue(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '')
    .replace(/^@/, ''); // « @acme.com » saisi comme domaine → « acme.com »
}

/** Déduit le type d'une valeur normalisée : un « @ » ⇒ email, sinon domaine. */
export function detectKind(value: string): OptOutKind {
  return value.includes('@') ? 'email' : 'domain';
}

/** Domaine d'une adresse email normalisée (partie après le « @ »), ou null. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : null;
}

// Fournisseurs d'emails personnels : bloquer leur DOMAINE bannirait des milliers de
// contacts sans rapport → pour ces domaines, l'opt-out reste au niveau de l'ADRESSE.
const _FREEMAIL_RE = /^(?:gmail|yahoo|ymail|hotmail|outlook|live|msn|orange|free|sfr|laposte|wanadoo|bbox|numericable|icloud|me|gmx|proton(?:mail)?|aol)\./i;

/** Vrai si le domaine appartient à un fournisseur d'email grand public (freemail). */
export function isFreemailDomain(domain: string | null | undefined): boolean {
  return !!domain && _FREEMAIL_RE.test(domain);
}

/**
 * Cible d'opt-out à enregistrer quand une réponse demande à ne plus être contacté :
 * le DOMAINE entier pour une adresse pro (bloque toute l'entreprise), mais l'ADRESSE
 * seule pour un freemail (sinon un « stop » depuis un gmail bannirait tout gmail.com).
 */
export function optOutTargetForReply(email: string): string {
  const e = normalizeValue(email);
  const domain = emailDomain(e);
  return domain && !isFreemailDomain(domain) ? domain : e;
}

/**
 * Cœur pur : une adresse est-elle bloquée par l'ensemble des entrées opt-out ?
 * Une entrée « email » bloque l'adresse exacte ; une entrée « domain » bloque
 * toutes les adresses de ce domaine.
 */
export function matchesOptOut(
  email: string,
  entries: ReadonlyArray<{ value: string; kind: string }>,
): boolean {
  const e = normalizeValue(email);
  if (!e) return false;
  const domain = emailDomain(e);
  for (const entry of entries) {
    if (entry.kind === 'email' && entry.value === e) return true;
    if (entry.kind === 'domain' && domain !== null && domain === entry.value) return true;
  }
  return false;
}
