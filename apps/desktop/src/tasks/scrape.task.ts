import { taskRunner } from '../lib/task-runner';
import { getScrapingEnabled } from '../lib/secrets';
import { logger } from '../lib/logger';

/**
 * Recherche automatique d'entreprises cibles — OPTION DÉSACTIVÉE par défaut.
 *
 * Le chemin principal voulu est la saisie manuelle et l'import CSV. Le
 * scraping du prototype était entièrement simulé : il n'y a donc aucune
 * logique réelle à reprendre. Ce fichier est un emplacement réservé, gardé
 * derrière le drapeau `scrapingEnabled` des Réglages — à compléter le jour où
 * une vraie source de leads sera branchée.
 */
export function enqueueScrape(campaignId: string): void {
  if (!getScrapingEnabled()) {
    logger.info('Scraping désactivé — import manuel/CSV uniquement.');
    return;
  }
  taskRunner.enqueue({
    type: 'scrape',
    label: 'Recherche d\'entreprises',
    run: async () => {
      throw new Error(
        'Recherche automatique non implémentée — ajoutez vos entreprises manuellement ou via import CSV.'
      );
    },
  });
}
