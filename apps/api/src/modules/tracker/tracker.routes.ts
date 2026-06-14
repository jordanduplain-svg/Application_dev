import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';

/**
 * Rôle : Tracking d'ouverture des emails de candidature.
 *
 * Le principe du « pixel espion » : chaque email envoyé contient une image
 * de 1×1 pixel pointant vers cette route. Quand le destinataire ouvre l'email,
 * son client mail charge l'image → on sait que l'email a été ouvert.
 *
 * Route volontairement publique (pas d'authentification) : elle est appelée
 * par le client mail du destinataire, pas par l'app.
 */
export async function trackerRoutes(fastify: FastifyInstance) {
  // Limite GÉNÉREUSE plutôt que désactivée : endpoint public à fort trafic
  // externe (les ouvertures via Gmail passent toutes par les IP du proxy
  // Google). 600/min absorbe le trafic légitime tout en bornant l'abus —
  // `rateLimit: false` exposerait un endpoint d'écriture DB illimité (DoS).
  fastify.get(
    '/:applicationId',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
    const { applicationId } = request.params as { applicationId: string };

    try {
      // `updateMany` filtré sur `status: 'SENT'` :
      //  - `updateMany` ne lève pas d'erreur si l'id n'existe pas (la route
      //    doit TOUJOURS renvoyer le pixel) ;
      //  - le filtre `SENT` évite de « rétrograder » une candidature déjà
      //    passée en REPLIED, et rend l'opération idempotente (les ouvertures
      //    suivantes ne réécrivent rien).
      await prisma.application.updateMany({
        where: { id: applicationId, status: 'SENT' },
        data: { status: 'OPENED', openedAt: new Date() },
      });
    } catch (err) {
      // On avale toute erreur : le pixel doit TOUJOURS être renvoyé, sinon
      // le client mail du destinataire afficherait une image cassée.
      request.log.error({ err }, '[Tracker] Erreur de traitement');
    }

    // GIF transparent de 1×1 pixel (encodé en base64).
    const pixel = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );

    reply
      .type('image/gif')
      // `no-store` : on empêche la mise en cache, pour détecter chaque ouverture.
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      .send(pixel);
  });
}
