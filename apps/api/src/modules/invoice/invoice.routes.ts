import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../middleware/authGuard';
import { prisma } from '../../lib/prisma';

/**
 * Rôle : Historique de facturation de l'utilisateur (A2).
 * Liste les factures d'achat (CHARGE) et les avoirs (REFUND).
 * Toutes les routes exigent un utilisateur authentifié.
 */

const paginationSchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
});

export async function invoiceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard);

  // Liste paginée des factures de l'utilisateur, de la plus récente à la plus
  // ancienne. Le filtre `userId` garantit qu'un utilisateur ne voit que ses
  // propres factures.
  app.get('/', async (request, reply) => {
    const { page, limit } = paginationSchema.parse(request.query);
    const where = { userId: request.user.sub };

    const [data, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { campaign: { select: { name: true } } },
      }),
      prisma.invoice.count({ where }),
    ]);

    return reply.send({
      // `amount` est un Decimal Prisma : on le convertit en `number` pour une
      // sérialisation JSON exploitable côté client (cf. campaign.service.ts).
      data: data.map((invoice) => ({ ...invoice, amount: Number(invoice.amount) })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    });
  });
}
