/**
 * État PARTAGÉ minimal : un scraping Python est-il en train de tourner ?
 *
 * Lu par leadsMaster.ts pour NE PAS réécrire le master CSV pendant que le scraper Python
 * le réécrit lui aussi — deux processus écrivant le même fichier au même instant = corruption
 * / perte de leads. C'est l'équivalent, pour le writer de FOND (markLeadBounced), de
 * l'`assertNoScraperRunning()` qui protège déjà les mutations déclenchées par l'utilisateur.
 *
 * PROVIDER plutôt qu'un flag mirroré : la vérité vit dans scraping.ipc.ts (`activeProcess`),
 * qui a DEUX points de spawn et CINQ libérations. Un flag booléen à synchroniser à ces 7
 * endroits finirait par se désynchroniser (un `= null` oublié). On enregistre donc UN
 * getter sur la vraie variable → toujours exact, une seule source de vérité.
 */
let _provider: () => boolean = () => false;

/** Appelé une fois par scraping.ipc.ts : `registerScraperRunningProvider(() => activeProcess !== null)`. */
export function registerScraperRunningProvider(fn: () => boolean): void {
  _provider = fn;
}

export function isScraperRunning(): boolean {
  try { return _provider(); } catch { return false; }
}
