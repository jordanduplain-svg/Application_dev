# Couche `interface`

Point d'entrée HTTP (Fastify). Reçoit les requêtes, valide les DTOs (Zod), authentifie,
applique les guards RBAC, appelle les cas d'usage (`application/`), sérialise la réponse.

## Sous-dossiers

- `http/` — routes Fastify, controllers, guards, middlewares.
- `dto/` — schémas Zod des entrées/sorties (réutilisés depuis `@cmr-tracker/shared` quand
  pertinent).

## Règles

- Aucune logique métier ici. Les controllers sont des **fils** : valider → appeler le cas
  d'usage → retourner.
- Les guards d'autorisation appellent la couche `domain/authorization` pour décider, ils
  ne décident pas eux-mêmes.
- Les codes d'erreur HTTP sont normalisés (un `ProblemDetails` par erreur).
