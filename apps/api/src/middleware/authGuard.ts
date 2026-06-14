import { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from './error';

/**
 * Rôle : Garde d'authentification.
 *
 * À utiliser en hook `onRequest` (ou `preHandler`) sur les routes protégées.
 * Vérifie le JWT d'accès présent dans l'en-tête `Authorization: Bearer ...`.
 * En cas de succès, `request.user` est peuplé (cf. types/fastify.d.ts) ;
 * en cas d'échec, la requête est rejetée avec un 401.
 */
export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  try {
    // `jwtVerify` est ajouté par le plugin @fastify/jwt : il valide la
    // signature et l'expiration du token, puis remplit `request.user`.
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}
