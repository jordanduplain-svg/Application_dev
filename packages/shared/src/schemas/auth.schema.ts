import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  // Consentement CGU obligatoire (S4) : `z.literal(true)` rejette `false` ou
  // l'absence du champ. Le client envoie `true` lorsque la case est cochée.
  acceptTos: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez accepter les conditions d\'utilisation' }),
  }),
}).strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
}).strict();

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Demande de réinitialisation de mot de passe (S1, étape 1).
 * L'utilisateur saisit son email ; l'API lui envoie un code à 6 chiffres.
 */
export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
}).strict();

export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

/**
 * Réinitialisation effective (S1, étape 2).
 * L'utilisateur fournit l'email, le code reçu et son nouveau mot de passe.
 */
export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Le code doit comporter 6 chiffres'),
  newPassword: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
}).strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
