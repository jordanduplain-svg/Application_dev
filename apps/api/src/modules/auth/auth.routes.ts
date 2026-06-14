import { FastifyInstance } from 'fastify';
import { AuthService } from './auth.service';
import {
  RegisterInput,
  registerSchema,
  LoginInput,
  loginSchema,
  RequestPasswordResetInput,
  requestPasswordResetSchema,
  ResetPasswordInput,
  resetPasswordSchema,
} from '@candio/shared';
import { sendTransactionalEmail, buildPasswordResetEmail } from '../../lib/mailer';

/**
 * Rôle : Routes d'authentification (/api/auth/*).
 *
 * Stratégie de tokens :
 *  - access token  : JWT de courte durée (15 min), renvoyé dans le corps de
 *    la réponse et stocké côté client.
 *  - refresh token : secret aléatoire de longue durée (7 jours). Il est
 *    transmis DEUX façons pour couvrir les deux types de clients :
 *      • cookie httpOnly  → clients web (inaccessible au JS, protège du XSS) ;
 *      • corps de réponse → app mobile native (la persistance des cookies y
 *        est peu fiable ; le token est alors stocké dans SecureStore).
 *    À l'appel /refresh, le token est accepté depuis le cookie OU le corps.
 */

// Options communes au cookie de refresh token.
// `path` restreint l'envoi du cookie à la seule route /refresh.
const REFRESH_COOKIE_OPTS = {
  httpOnly: true, // inaccessible au JS client (protège du vol par XSS)
  secure: process.env.NODE_ENV === 'production', // HTTPS only en prod
  sameSite: 'strict' as const, // protège du CSRF
  path: '/api/auth/refresh',
  maxAge: 7 * 24 * 60 * 60, // 7 jours (en secondes)
};

// Limite de débit stricte sur les routes sensibles (anti-bruteforce).
// 10 tentatives par minute et par IP, au lieu de la limite globale (100/15min).
const AUTH_RATE_LIMIT = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
};

export async function authRoutes(app: FastifyInstance) {
  const authService = new AuthService();

  // Inscription : crée le compte, puis connecte directement l'utilisateur.
  app.post<{ Body: RegisterInput }>('/register', AUTH_RATE_LIMIT, async (request, reply) => {
    const data = registerSchema.parse(request.body);
    const user = await authService.register(data);

    const accessToken = app.jwt.sign({ sub: user.id }, { expiresIn: '15m' });
    const refreshToken = await authService.createRefreshToken(user.id);

    reply.setCookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTS);

    return reply.status(201).send({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      accessToken,
      refreshToken, // pour les clients sans gestion de cookie (mobile natif)
    });
  });

  // Connexion : vérifie les identifiants et délivre les tokens.
  app.post<{ Body: LoginInput }>('/login', AUTH_RATE_LIMIT, async (request, reply) => {
    const data = loginSchema.parse(request.body);
    const user = await authService.login(data);

    const accessToken = app.jwt.sign({ sub: user.id }, { expiresIn: '15m' });
    const refreshToken = await authService.createRefreshToken(user.id);

    reply.setCookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTS);

    return reply.status(200).send({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      accessToken,
      refreshToken, // pour les clients sans gestion de cookie (mobile natif)
    });
  });

  // Rafraîchissement : échange le refresh token contre un nouvel access token.
  // Le token est lu depuis le cookie (web) OU le corps de la requête (mobile).
  // Il est tourné à chaque appel (rotation).
  app.post('/refresh', async (request, reply) => {
    const rawToken =
      request.cookies.refreshToken || (request.body as any)?.refreshToken;
    if (!rawToken) {
      return reply.status(401).send({ error: 'Refresh token missing' });
    }

    const user = await authService.verifyRefreshToken(rawToken);

    // Rotation : on révoque l'ancien token et on en émet un nouveau. Ainsi un
    // refresh token volé ne reste valide que jusqu'au prochain rafraîchissement.
    await authService.revokeRefreshToken(rawToken);
    const newRefreshToken = await authService.createRefreshToken(user.id);
    const newAccessToken = app.jwt.sign({ sub: user.id }, { expiresIn: '15m' });

    reply.setCookie('refreshToken', newRefreshToken, REFRESH_COOKIE_OPTS);

    return reply.status(200).send({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken, // nouveau token tourné, pour le mobile
    });
  });

  // Réinitialisation de mot de passe — étape 1 : demande d'un code (S1).
  // Réponse TOUJOURS générique (200), que l'email existe ou non, pour ne pas
  // révéler quels comptes sont enregistrés.
  app.post<{ Body: RequestPasswordResetInput }>(
    '/forgot-password',
    AUTH_RATE_LIMIT,
    async (request, reply) => {
      const { email } = requestPasswordResetSchema.parse(request.body);
      const result = await authService.createPasswordResetCode(email);

      if (result) {
        const mail = buildPasswordResetEmail(result.firstName, result.code);
        try {
          await sendTransactionalEmail({ to: email, ...mail });
        } catch (err) {
          // Un échec d'envoi ne doit pas révéler l'existence du compte ni
          // bloquer l'utilisateur : on journalise et on répond malgré tout.
          request.log.error({ err }, "Échec d'envoi de l'email de réinitialisation");
        }
      }

      return reply.status(200).send({
        message:
          'Si un compte existe pour cet email, un code de réinitialisation vient d\'être envoyé.',
      });
    }
  );

  // Réinitialisation de mot de passe — étape 2 : validation du code (S1).
  app.post<{ Body: ResetPasswordInput }>(
    '/reset-password',
    AUTH_RATE_LIMIT,
    async (request, reply) => {
      const data = resetPasswordSchema.parse(request.body);
      await authService.resetPassword(data.email, data.code, data.newPassword);
      return reply.status(200).send({ message: 'Mot de passe réinitialisé avec succès.' });
    }
  );

  // Déconnexion : révoque le refresh token et supprime le cookie.
  app.post('/logout', async (request, reply) => {
    const rawToken =
      request.cookies.refreshToken || (request.body as any)?.refreshToken;
    if (rawToken) {
      await authService.revokeRefreshToken(rawToken);
    }
    // Le `path` doit être IDENTIQUE à celui utilisé au setCookie : un
    // navigateur ne supprime le cookie que si le path correspond exactement.
    reply.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    return reply.status(200).send({ message: 'Logged out' });
  });
}
