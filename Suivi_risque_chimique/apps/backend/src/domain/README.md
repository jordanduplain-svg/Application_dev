# Couche `domain`

Règles métier **pures**. Zéro dépendance à une BDD, un framework, un réseau, un système de
fichiers. Pas d'import depuis `infrastructure/`, `interface/` ou `application/`. Le lint
(`eslint-plugin-boundaries`) refuse ces imports.

## Modules prévus

- `exposure/` — calcul de la durée d'exposition (fonction pure + value objects).
- `mapping/` — transformation colonnes client → champs canoniques, parser de dates
  multi-format.
- `anonymization/` — vue anonymisée, vérification du k-anonymat.
- `authorization/` — politiques RBAC (construction d'`AccessFilter` selon le rôle).
- `entities/` — `Personnel`, `RisqueChimique`, `Exposition`, value objects (`Matricule`,
  `CodeSecteur`, etc.).

## Règles

- Code synchrone autant que possible (sauf si une opération métier est légitimement async).
- `Clock` injectable pour la testabilité (pas de `new Date()` direct dans le code métier).
- Erreurs métier = classes spécifiques (`InvalidDateRangeError`, `MissingMatriculeError`),
  pas de strings.
- Tests unitaires Vitest rapides (millisecondes), sans setup.
