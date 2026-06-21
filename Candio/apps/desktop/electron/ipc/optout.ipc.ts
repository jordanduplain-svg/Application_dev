import { handle } from './registry';
import { logger } from '../../src/lib/logger';
import {
  listOptOuts,
  addOptOut,
  removeOptOut,
  eraseContact,
} from '../../src/modules/optout/optout.service';

/** RGPD : handlers de la liste « ne pas contacter » (opt-out / effacement). */
export function registerOptOutHandlers(): void {
  handle('optout:list', () => listOptOuts());

  handle('optout:add', ({ value, reason }) => addOptOut(value, reason));

  handle('optout:remove', async ({ id }) => {
    await removeOptOut(id);
  });

  handle('optout:erase', async ({ email, reason }) => {
    const result = await eraseContact(email, reason);
    // SEC-S2 : trace l'exercice du droit à l'effacement.
    logger.warn(`[AUDIT] optout:erase — ${result.erased} entreprise(s)/candidature(s) effacée(s)`);
    return result;
  });
}
