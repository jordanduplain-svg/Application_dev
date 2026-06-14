import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../middleware/authGuard';
import { CampaignService } from './campaign.service';
import { createCampaignSchema, updateCampaignSchema } from '@candio/shared';

/**
 * Rôle : Routes CRUD des campagnes (/api/campaigns/*).
 * Toutes les routes exigent un utilisateur authentifié.
 */

// Validation du paramètre d'URL `:id` : on impose un identifiant au format cuid
// pour rejeter d'emblée les requêtes avec un id malformé.
const paramsSchema = z.object({ id: z.string().cuid() });

export async function campaignRoutes(app: FastifyInstance) {
  const campaignService = new CampaignService();

  // Toutes les routes sous /api/campaigns exigent un JWT valide.
  app.addHook('onRequest', authGuard);

  // Création d'une campagne.
  app.post('/', async (request, reply) => {
    const data = createCampaignSchema.parse(request.body);
    const campaign = await campaignService.createCampaign(request.user.sub, data);
    return reply.status(201).send(campaign);
  });

  // Liste paginée des campagnes de l'utilisateur.
  app.get('/', async (request, reply) => {
    const query = z
      .object({
        page: z.coerce.number().min(1).optional().default(1),
        limit: z.coerce.number().min(1).max(100).optional().default(10),
      })
      .parse(request.query);
    const result = await campaignService.getCampaigns(request.user.sub, query.page, query.limit);
    return reply.send(result);
  });

  // Détail d'une campagne (le service vérifie l'appartenance à l'utilisateur).
  app.get('/:id', async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const campaign = await campaignService.getCampaignById(request.user.sub, params.id);
    return reply.send(campaign);
  });

  // Mise à jour d'une campagne.
  app.patch('/:id', async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const data = updateCampaignSchema.parse(request.body);
    const campaign = await campaignService.updateCampaign(request.user.sub, params.id, data);
    return reply.send(campaign);
  });

  // Suppression d'une campagne. Réponse 204 (No Content) en cas de succès.
  app.delete('/:id', async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    await campaignService.deleteCampaign(request.user.sub, params.id);
    return reply.status(204).send();
  });
}
