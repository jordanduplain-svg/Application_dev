import '@fastify/jwt';

/**
 * Rôle : Augmentation de type pour @fastify/jwt.
 *
 * Décrit la forme du contenu (payload) de nos JWT et ce qui est exposé sur
 * `request.user` après `jwtVerify()`. Grâce à cette déclaration, TypeScript
 * connaît `request.user.sub` (l'identifiant de l'utilisateur connecté).
 */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    // Données encodées dans le token à la signature.
    payload: { sub: string };
    // Données disponibles sur `request.user` après vérification.
    user: { sub: string };
  }
}
