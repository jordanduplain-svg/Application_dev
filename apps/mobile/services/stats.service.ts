import { api } from '@/lib/api';

/**
 * Rôle : Accès aux statistiques du tableau de bord depuis l'app mobile.
 * Fine couche au-dessus du client `api` (axios).
 */
export const statsService = {
  /** Récupère les statistiques agrégées du tableau de bord. */
  getStats: async () => {
    const response = await api.get('/stats');
    return response.data;
  },
  /** Récupère la liste des candidatures ayant reçu une réponse. */
  getReplies: async () => {
    const response = await api.get('/stats/replies');
    return response.data;
  },
};
