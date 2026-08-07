# Couche `ports`

Interfaces que le domaine/application **définit** et que l'infrastructure **implémente**.
C'est la frontière qui rend tout remplaçable.

## Ports prévus

- `DataSource.ts` — connecteur d'import (Excel/SharePoint/Snowflake/datalake), lecture
  seule.
- `ListRepository.ts` — accès aux trois listes métier, avec historisation SCD2.
- `AuditLogger.ts` — journal centralisé des accès/exports.
- `Clock.ts` — horloge injectable, pour la testabilité.
- `AuthProvider.ts` — vérification d'un token d'authentification (local au MVP, OIDC
  générique plus tard).
- `Scheduler.ts` — déclencheurs planifiés (node-cron au MVP, BullMQ plus tard).
- `Encryption.ts` — chiffrement au repos des champs sensibles.

## Règles

- Uniquement des interfaces et des types. Aucune implémentation.
- Aucune dépendance externe.
- Stables dans le temps : on évite de casser ces signatures.
