/**
 * Erreur métier : l'utilisateur n'a aucun périmètre d'accès.
 * La couche HTTP la traduira en 403 avec un message ACTIONNABLE (règle UX
 * n°5) : « votre compte n'est pas rattaché — contactez votre administrateur »,
 * jamais un code technique brut.
 */
export class AccessDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(`Accès refusé : ${reason}`);
    this.name = "AccessDeniedError";
  }
}
