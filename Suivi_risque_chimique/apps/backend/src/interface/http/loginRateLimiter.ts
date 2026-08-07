/**
 * Limiteur de débit anti-brute-force pour `/auth/login`.
 *
 * ponytail: compteur fenêtre-fixe en mémoire, par clé (IP). Suffisant pour un
 * déploiement self-hosted mono-instance — pas de dépendance, pas de store
 * externe. Upgrade path si multi-instances : @fastify/rate-limit + Redis.
 *
 * Le filtre anti-énumération (hash factice à temps constant) protège l'identité
 * des comptes ; CE module protège le DÉBIT — les deux sont complémentaires.
 */
export interface LoginRateLimiter {
  /** true si la tentative dépasse le quota (à refuser), false sinon. */
  hit(key: string, now: Date): boolean;
}

export function createLoginRateLimiter(
  maxAttempts = 10,
  windowMs = 5 * 60 * 1000,
): LoginRateLimiter {
  // ponytail: jamais purgé activement — une entrée se réinitialise à la
  // prochaine tentative après expiration de sa fenêtre. Cardinalité d'IP basse
  // pour un outil interne ; ajouter un balayage périodique si exposé large.
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key, now) {
      const t = now.getTime();
      const bucket = buckets.get(key);
      if (bucket === undefined || t >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return false;
      }
      bucket.count += 1;
      return bucket.count > maxAttempts;
    },
  };
}
