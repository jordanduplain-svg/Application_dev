/**
 * Port `Clock` — abstraction de l'instant courant.
 *
 * Pourquoi un port pour quelque chose d'aussi simple que `new Date()` ?
 *
 *  1. **Testabilité.** Toute logique métier qui dépend de "aujourd'hui" (durée
 *     d'exposition d'une personne encore en poste, expiration d'un token, fenêtre
 *     d'audit) devient sinon impossible à tester de façon déterministe. Injecter
 *     un Clock permet de remplacer par un FakeClock figé dans les tests.
 *
 *  2. **Cohérence transverse.** Dans un même cas d'usage, plusieurs étapes
 *     veulent "le même maintenant" (calcul + journalisation + horodatage en
 *     base). Si on appelle `new Date()` plusieurs fois, on peut avoir des écarts
 *     de quelques millisecondes — pas grave fonctionnellement, mais source de
 *     bugs subtils en test et en debugging. Un Clock unique par cas d'usage
 *     élimine ce piège.
 *
 *  3. **Frontière de pureté.** Le domaine est censé être pur. `new Date()` est
 *     une lecture d'horloge système — une impureté. La cacher derrière un port
 *     est cohérent avec le reste de l'architecture (idem pour le repository, le
 *     logger, etc.).
 */
export interface Clock {
  /** Retourne l'instant courant. */
  now(): Date;
}
