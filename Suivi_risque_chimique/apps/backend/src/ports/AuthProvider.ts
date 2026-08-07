import type { AuthenticatedUser } from "../domain/authorization/types.js";

/**
 * Port `AuthProvider` — authentification, abstraite du fournisseur.
 *
 * MVP : `LocalAuthProvider` (email/password + argon2 + JWT). Post-MVP : un
 * `OidcAuthProvider` générique (Keycloak, Authentik, Zitadel auto-hébergés…)
 * implémentera la même interface — bascule = une ligne dans main.ts.
 */

export interface LoginResult {
  /** Jeton d'accès (courte durée). */
  token: string;
  /** Jeton de rafraîchissement (longue durée) pour prolonger la session. */
  refreshToken: string;
  user: {
    id: string;
    displayName: string;
    role: AuthenticatedUser["role"];
  };
}

/** Identifiants invalides OU compte inactif — message unique côté HTTP
 *  (ne pas révéler si l'email existe : énumération de comptes). */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("Identifiants invalides.");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidTokenError extends Error {
  constructor() {
    super("Jeton invalide ou expiré.");
    this.name = "InvalidTokenError";
  }
}

export interface AuthProvider {
  /** Vérifie les identifiants et émet un couple jeton d'accès + rafraîchissement. */
  authenticate(email: string, password: string): Promise<LoginResult>;

  /**
   * Échange un jeton de rafraîchissement valide contre un NOUVEAU couple
   * (rotation). Le compte est rechargé : un compte désactivé entre-temps ne
   * peut plus rafraîchir. Lève `InvalidTokenError` si le jeton est invalide,
   * expiré, ou n'est pas un jeton de rafraîchissement.
   */
  refresh(refreshToken: string): Promise<LoginResult>;

  /**
   * Émet un couple de jetons pour un utilisateur déjà authentifié par un
   * fournisseur externe (OIDC). On fait confiance à l'email validé. Renvoie
   * null si aucun compte actif ne correspond (pas d'auto-provisionnement).
   */
  issueForEmail(email: string): Promise<LoginResult | null>;

  /**
   * Vérifie un jeton et reconstruit l'utilisateur. L'utilisateur est RECHARGÉ
   * depuis la base à chaque vérification : désactiver un compte ou changer
   * ses rattachements (matricule, secteurs) prend effet immédiatement, sans
   * attendre l'expiration du jeton — important pour des données de santé.
   */
  verify(token: string): Promise<AuthenticatedUser>;
}
