import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

import type { PrismaClient } from "@prisma/client";

import type { AuthenticatedUser } from "../../domain/authorization/types.js";
import type { AuthProvider, LoginResult } from "../../ports/AuthProvider.js";
import { InvalidCredentialsError, InvalidTokenError } from "../../ports/AuthProvider.js";
import type { Clock } from "../../ports/Clock.js";

export interface LocalAuthConfig {
  jwtSecret: string;
  /** Durée de vie du jeton d'accès, en secondes (défaut 15 min). */
  accessTtlSeconds?: number;
  /** Durée de vie du jeton de rafraîchissement, en secondes (défaut 7 j). */
  refreshTtlSeconds?: number;
}

/**
 * Adaptateur d'authentification LOCALE : email/password (argon2id) + JWT.
 *
 * Choix de sécurité :
 *  - argon2id : recommandation OWASP pour le hachage de mots de passe.
 *  - le JWT ne porte QUE l'id utilisateur (`sub`) et le tenant. Ni rôle, ni
 *    matricule, ni secteurs : ces attributs sont rechargés depuis la base à
 *    chaque verify(), donc un changement de droits est effectif immédiatement
 *    (un jeton émis avant la révocation ne conserve aucun privilège périmé).
 *  - TTL court (15 min par défaut). Pas de refresh token au MVP : l'UI
 *    redemandera le login — acceptable pour un outil métier, à revoir avec
 *    l'OIDC.
 *  - message d'erreur unique pour « email inconnu » et « mot de passe faux »
 *    (anti-énumération de comptes).
 */
export class LocalAuthProvider implements AuthProvider {
  private readonly secret: Uint8Array;
  private readonly ttl: number;
  private readonly refreshTtl: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
    config: LocalAuthConfig,
  ) {
    this.secret = new TextEncoder().encode(config.jwtSecret);
    this.ttl = config.accessTtlSeconds ?? 15 * 60;
    this.refreshTtl = config.refreshTtlSeconds ?? 7 * 24 * 60 * 60;
  }

  async authenticate(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" }, isActive: true },
    });

    // On vérifie TOUJOURS un hash (factice si l'utilisateur n'existe pas)
    // pour que le temps de réponse ne révèle pas l'existence du compte.
    const hash =
      user?.passwordHash ??
      "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const valid = await argon2.verify(hash, password).catch(() => false);

    if (!user || !valid) throw new InvalidCredentialsError();

    return this.issueTokens(user.id, user.tenantId, {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
    });
  }

  /**
   * Émet nos jetons pour un utilisateur déjà authentifié AILLEURS (OIDC) :
   * on fait confiance à l'email validé par le fournisseur, on retrouve le
   * compte (actif) et on délivre le couple. Pas d'auto-provisionnement : un
   * email inconnu => null (le compte doit exister, créé par un admin).
   */
  async issueForEmail(email: string): Promise<LoginResult | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: "insensitive" }, isActive: true },
    });
    if (!user) return null;
    return this.issueTokens(user.id, user.tenantId, {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
    });
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    let userId: string;
    try {
      const { payload } = await jwtVerify(refreshToken, this.secret);
      // Un jeton d'accès ne doit JAMAIS pouvoir servir à rafraîchir.
      if (payload.typ !== "refresh" || typeof payload.sub !== "string") {
        throw new InvalidTokenError();
      }
      userId = payload.sub;
    } catch {
      throw new InvalidTokenError();
    }

    // Rechargement : un compte désactivé entre-temps ne peut plus prolonger.
    const user = await this.prisma.user.findFirst({ where: { id: userId, isActive: true } });
    if (!user) throw new InvalidTokenError();

    return this.issueTokens(user.id, user.tenantId, {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
    });
  }

  /** Émet un couple access + refresh (rotation à chaque appel). */
  private async issueTokens(
    userId: string,
    tenantId: string,
    user: LoginResult["user"],
  ): Promise<LoginResult> {
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const sign = (ttl: number, extra: Record<string, unknown>): Promise<string> =>
      new SignJWT({ tenantId, ...extra })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + ttl)
        .sign(this.secret);

    const [token, refreshToken] = await Promise.all([
      sign(this.ttl, {}),
      sign(this.refreshTtl, { typ: "refresh" }),
    ]);
    return { token, refreshToken, user };
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    let userId: string;
    try {
      const { payload } = await jwtVerify(token, this.secret);
      // Un jeton de rafraîchissement (longue durée) ne doit pas servir d'accès.
      if (typeof payload.sub !== "string" || payload.typ === "refresh") {
        throw new InvalidTokenError();
      }
      userId = payload.sub;
    } catch {
      throw new InvalidTokenError();
    }

    // Rechargement systématique : compte désactivé ou droits modifiés =
    // effet immédiat (cf. doc du port).
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      include: { managedSectors: true },
    });
    if (!user) throw new InvalidTokenError();

    return {
      id: user.id,
      role: user.role,
      tenantId: user.tenantId,
      matricule: user.matricule,
      managedSectors: user.managedSectors.map((s) => s.codeSecteur),
    };
  }
}
