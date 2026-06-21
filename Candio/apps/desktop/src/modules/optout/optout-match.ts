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
