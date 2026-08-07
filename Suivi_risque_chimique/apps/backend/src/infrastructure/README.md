# Couche `infrastructure`

Adaptateurs concrets qui **implémentent les ports**. C'est ici qu'on parle à Postgres, à
SharePoint, à Snowflake, au scheduler. Le code peut être impur (I/O, dates système,
réseau) — c'est son rôle.

## Modules prévus

- `persistence/` — repositories Prisma (`PrismaListRepository`, `PrismaAuditLogger`),
  schéma SCD2.
- `connectors/` — adaptateurs `DataSource` :
  - `excel/` — fichier ou dossier de fichiers Excel (`exceljs`).
  - `sharepoint/` — listes/fichiers SharePoint (Microsoft Graph), lecture seule.
  - `snowflake/` — entrepôt Snowflake.
  - `datalake/` — base SQL externe, Azure Data Lake, S3, API REST générique.
- `scheduler/` — `NodeCronScheduler` au MVP, `BullMQScheduler` ensuite.
- `auth/` — `LocalAuthProvider` (email/password + argon2 + JWT) au MVP,
  `OidcAuthProvider` (OIDC générique, compatible Keycloak, Authentik, Zitadel…) ensuite.
- `crypto/` — `AesGcmEncryption` pour les champs sensibles au repos.
- `clock/` — `SystemClock` (`Date.now()`).

## Règles

- Chaque adaptateur implémente exactement un port.
- Pas de logique métier ici — elle vit dans `domain/`.
- Tests d'intégration (avec vraie DB, vrai fichier) plutôt que pyramidiens.
