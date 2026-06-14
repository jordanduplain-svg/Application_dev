import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../middleware/authGuard';
import { StatsService } from './stats.service';
import fastifySse from 'fastify-sse-v2';

// Validation des paramètres de pagination communs.
const paginationSchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(10),
});

/**
 * Rôle : Routes des statistiques du tableau de bord.
 * Toutes les routes exigent un utilisateur authentifié.
 */
export async function statsRoutes(app: FastifyInstance) {
  const statsService = new StatsService();

  // Plugin SSE (Server-Sent Events) pour la route de streaming temps réel.
  app.register(fastifySse);
  app.addHook('onRequest', authGuard);

  // Stats ponctuelles du tableau de bord.
  app.get('/', async (request, reply) => {
    const stats = await statsService.getDashboardStats(request.user.sub);
    return reply.send(stats);
  });

  // Flux temps réel : pousse les stats au client toutes les 15 secondes via SSE.
  app.get('/stream', async (request, reply) => {
    // Drapeau d'arrêt : passé à `false` dès que le client se déconnecte, pour
    // que la boucle du générateur s'arrête et qu'aucune connexion ne fuie.
    let alive = true;
    request.raw.on('close', () => {
      alive = false;
    });

    reply.sse(
      (async function* () {
        while (alive) {
          const stats = await statsService.getDashboardStats(request.user.sub);
          yield { data: JSON.stringify(stats), event: 'stats_updated' };
          // Temporisation non bloquante entre deux émissions.
          await new Promise((resolve) => setTimeout(resolve, 15000));
        }
      })()
    );
  });

  // Liste paginée des réponses reçues sur les candidatures de l'utilisateur.
  app.get('/replies', async (request, reply) => {
    const { page, limit } = paginationSchema.parse(request.query);
    const replies = await statsService.getReplies(request.user.sub, page, limit);
    return reply.send(replies);
  });
}
