import { prisma } from '../../lib/prisma';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { UnauthorizedError, ConflictError, BadRequestError } from '../../middleware/error';
import { RegisterInput, LoginInput, TOS_VERSION } from '@candio/shared';

/**
 * Rôle : Logique métier de l'authentification (inscription, connexion,
 * gestion des refresh tokens persistés en base).
 */

// Coût bcrypt : 12 tours = bon compromis sécurité / latence en 2026.
const BCRYPT_ROUNDS = 12;

// Durée de vie d'un refresh token : 7 jours (doit rester aligné avec le maxAge
// du cookie posé dans auth.routes.ts).
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Durée de vie d'un code de réinitialisation de mot de passe : 15 minutes.
const RESET_CODE_TTL_MS = 15 * 60 * 1000;

/** Hache un mot de passe en clair avant stockage. */
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Compare un mot de passe en clair au hash stocké (résistant au timing). */
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export class AuthService {
  /**
   * Inscrit un nouvel utilisateur : vérifie l'unicité de l'email,
   * hache le mot de passe puis crée l'enregistrement en base.
   */
  async register(data: RegisterInput) {
    // Empêche la création de deux comptes avec le même email.
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) {
      throw new ConflictError('Email already in use');
    }

    const passwordHash = await hashPassword(data.password);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        // Consentement CGU (S4) : l'inscription n'est possible que si
        // `acceptTos` vaut `true` (garanti par registerSchema). On horodate
        // l'acceptation et on mémorise la version acceptée.
        tosAcceptedAt: new Date(),
        tosVersion: TOS_VERSION,
      },
    });

    // On ne renvoie jamais le passwordHash à l'appelant.
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      plan: user.plan,
    };
  }

  /**
   * Authentifie un utilisateur par email + mot de passe.
   * Renvoie une erreur générique (sans préciser si c'est l'email ou le mot
   * de passe qui est faux) pour ne pas faciliter l'énumération de comptes.
   */
  async login(data: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const valid = await verifyPassword(data.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      plan: user.plan,
    };
  }

  /**
   * Crée un refresh token : génère un secret aléatoire, n'en stocke que le
   * hash SHA-256 en base (le secret en clair ne vit que dans le cookie client),
   * et renvoie le secret en clair à poser dans le cookie.
   */
  async createRefreshToken(userId: string): Promise<string> {
    const rawToken = randomBytes(40).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    // Nettoyage opportuniste des jetons expirés (refresh + reset) : évite le
    // gonflement progressif des tables. Best effort — `void` : on n'attend pas
    // et un échec ici ne perturbe pas l'authentification.
    void this.cleanupExpiredTokens();

    return rawToken;
  }

  /** Supprime les jetons expirés (refresh + réinitialisation de mot de passe). */
  private async cleanupExpiredTokens() {
    const now = new Date();
    try {
      await prisma.$transaction([
        prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
        prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      ]);
    } catch {
      // Best effort : on ignore tout échec de purge.
    }
  }

  /**
   * Vérifie un refresh token reçu du client : on re-hache le secret pour
   * retrouver la ligne en base, puis on contrôle qu'elle n'est pas expirée.
   */
  async verifyRefreshToken(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const refreshToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!refreshToken || refreshToken.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    return refreshToken.user;
  }

  /** Révoque un refresh token (déconnexion ou rotation après /refresh). */
  async revokeRefreshToken(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await prisma.refreshToken.deleteMany({
      where: { tokenHash },
    });
  }

  /**
   * Étape 1 de la réinitialisation de mot de passe (S1).
   * Génère un code à 6 chiffres pour l'email donné, en stocke le hash, et
   * renvoie le code en clair (à envoyer par email par l'appelant).
   *
   * Si l'email n'existe pas, renvoie `null` SANS lever d'erreur : la route
   * appelante répond alors un succès générique, pour ne pas révéler quels
   * emails sont enregistrés (anti-énumération de comptes).
   */
  async createPasswordResetCode(
    email: string
  ): Promise<{ firstName: string; code: string } | null> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null;

    // Code numérique à 6 chiffres, généré avec un PRNG cryptographique.
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    // Le hash inclut l'userId : deux utilisateurs tirant le même code ne
    // produisent pas le même `tokenHash` (la colonne est `@unique`).
    const tokenHash = createHash('sha256').update(`${user.id}:${code}`).digest('hex');

    // On invalide les éventuels codes précédents encore actifs pour cet
    // utilisateur : un seul code valable à la fois.
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
      },
    });

    return { firstName: user.firstName, code };
  }

  /**
   * Étape 2 de la réinitialisation (S1) : vérifie le code et change le mot de
   * passe. Le code est à usage unique et expire au bout de 15 minutes.
   *
   * Par sécurité, tous les refresh tokens de l'utilisateur sont révoqués :
   * une éventuelle session ouverte par un attaquant est ainsi coupée.
   */
  async resetPassword(email: string, code: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    // Message générique : on ne distingue pas « email inconnu » de « code faux ».
    if (!user) {
      throw new BadRequestError('Code invalide ou expiré');
    }

    // Jeton actif le plus récent de l'utilisateur (createPasswordResetCode
    // supprime les précédents → il y en a au plus un).
    const token = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!token) {
      throw new BadRequestError('Code invalide ou expiré');
    }

    // Verrouillage anti-bruteforce : après 5 essais erronés, le jeton est
    // bloqué — l'utilisateur doit redemander un code.
    const MAX_ATTEMPTS = 5;
    if (token.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestError('Trop de tentatives. Demandez un nouveau code.');
    }

    // Comparaison à temps constant du hash du code fourni avec le hash stocké.
    const providedHash = createHash('sha256').update(`${user.id}:${code}`).digest('hex');
    const codeMatches =
      providedHash.length === token.tokenHash.length &&
      timingSafeEqual(Buffer.from(providedHash), Buffer.from(token.tokenHash));

    if (!codeMatches) {
      // Code erroné : on incrémente le compteur d'essais.
      await prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestError('Code invalide ou expiré');
    }

    const passwordHash = await hashPassword(newPassword);

    // Transaction : on change le mot de passe, on consomme le code et on
    // révoque toutes les sessions, de façon atomique.
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ]);
  }
}
