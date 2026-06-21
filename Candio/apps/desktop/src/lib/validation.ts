/**
 * Validations légères côté main-process (pas de Zod pour rester simple).
 * Chaque fonction lève une Error si la valeur est invalide.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valide une adresse email — lève si invalide. */
export function assertEmail(value: string, label = 'Email'): void {
  if (!EMAIL_RE.test(value.trim())) {
    throw new Error(`${label} invalide : "${value}"`);
  }
}

/** Valide une chaîne non vide — lève si vide. */
export function assertNonEmpty(value: string, label = 'Champ'): void {
  if (!value.trim()) {
    throw new Error(`${label} ne peut pas être vide`);
  }
}
