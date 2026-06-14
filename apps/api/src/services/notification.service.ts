import axios from 'axios';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Rôle : Envoi de notifications push aux utilisateurs via le service
 * « Expo Push Notifications ».
 */
export class NotificationService {
  // Endpoint public du service de push d'Expo.
  private static EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

  /**
   * Envoie une notification push à un utilisateur.
   *
   * Volontairement « best effort » : si l'utilisateur n'a pas de token push,
   * ou si l'appel échoue, on ne propage PAS l'erreur — une notification ratée
   * ne doit jamais faire échouer l'action métier qui l'a déclenchée
   * (ex : la validation d'un paiement).
   */
  static async sendPushNotification(userId: string, title: string, body: string, data?: any) {
    try {
      // Le token push est enregistré sur le profil utilisateur depuis l'app mobile.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pushToken: true },
      });

      // Pas de token = l'utilisateur n'a pas autorisé les notifications : on sort.
      if (!user?.pushToken) {
        return;
      }

      const message = {
        to: user.pushToken,
        sound: 'default',
        title,
        body,
        data: data || {},
      };

      await axios.post(this.EXPO_PUSH_URL, message, {
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        // Timeout : sans lui, un endpoint Expo qui ne répond pas bloquerait
        // indéfiniment l'action appelante (paiement, worker de remboursement).
        timeout: 5000,
      });
    } catch (error) {
      // On journalise l'échec sans le propager (cf. commentaire ci-dessus).
      logger.error({ err: error, userId }, 'Échec envoi notification push');
    }
  }
}
