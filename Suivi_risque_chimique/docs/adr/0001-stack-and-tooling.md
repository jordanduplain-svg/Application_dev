# ADR 0001 — Stack technique et outillage

- **Statut** : Accepté
- **Date** : 2026-06-06
- **Décideur** : Jordan
- **Contexte** : choix initiaux pour le MVP (cf. brief produit et `docs/ARCHITECTURE.md`)

## Contexte

Le projet est un outil de traçabilité CMR, open source (AGPL-3.0), conçu pour un déploiement
**self-hosted prioritaire** + SaaS possible, manipulant des **données de santé** (RGPD
sensible). Cible : ETI industrielles. Dev solo en alternance HSE, donc l'outillage doit
favoriser la productivité et la maintenance long terme sur 40 ans (durée légale de
conservation côté SPST).

Ce document fige les choix de stack pour le MVP et explique pourquoi.

## Décisions

### Langage et runtime — Node.js + TypeScript strict (front et back)

- **Pourquoi** : un seul langage pour tout le monorepo (back + front + scripts), types
  partagés via `packages/shared`, écosystème mature pour les connecteurs Excel/SharePoint/
  Snowflake. Embauche/contribution open source faciles.
- **Alternatives écartées** : Go/Rust (excellents mais pas d'écosystème front confortable
  partagé, sur-coût pour un dev solo) ; Python (moins typé, moins ergonomique côté front,
  perfs runtime inférieures).
- **Conséquences** : `strict: true` + `noUncheckedIndexedAccess` dans `tsconfig`. Pas de
  `any` toléré sans commentaire justifiant.

### Monorepo — pnpm workspaces

- **Pourquoi** : rapide, économe en disque (hard-links), gère proprement les workspaces
  `apps/backend`, `apps/frontend`, `packages/shared`. Standard moderne, compatible CI.
- **Alternatives écartées** : npm (plus lent sur monorepos volumineux), Yarn (équivalent
  fonctionnel, choix par préférence outillage), Nx/Turborepo (sur-architecture pour le MVP,
  ajoutables plus tard si besoin de cache distant).
- **Conséquences** : `pnpm-workspace.yaml` à la racine, `package.json` par workspace,
  versions de dépendances alignées.

### Backend — Fastify

- **Pourquoi** : très performant, schémas JSON natifs (intégration Zod via
  `fastify-type-provider-zod`), plugins matures (auth, cors, helmet, swagger), API
  ergonomique TS. Hooks de cycle de vie clairs (utiles pour guards RBAC).
- **Alternatives écartées** : Express (moins typé, plus lent, écosystème vieillissant),
  Hono (excellent mais moins de plugins matures pour ce cas), NestJS (DI lourde et
  framework opinioné, frottement avec l'archi hexagonale pragmatique de ce projet).

### Validation — Zod

- **Pourquoi** : standard TS, schémas réutilisables front/back via `packages/shared`,
  inférence de types nickel. Intègre Fastify pour valider les DTOs HTTP. Utilisable aussi
  pour valider les données importées avant upsert.
- **Alternatives écartées** : TypeBox (perfs supérieures à l'exécution mais moins
  ergonomique), Joi/ajv (pas de partage élégant des types côté front).

### ORM et migrations — Prisma + Prisma Migrate

- **Pourquoi** : excellent DX TS, schéma déclaratif, migrations versionnées et reversibles,
  client typé. Documentation et écosystème mature. Compatible avec une stratégie
  d'historisation SCD type 2 (cf. ADR 0003).
- **Alternatives écartées** : Drizzle (excellent, plus proche du SQL, mais moins mature
  pour les workflows de migrations en équipe — réévaluable plus tard), TypeORM (architecture
  decorators qui se prête mal à l'archi hexagonale).
- **Conséquences** : `prisma/schema.prisma` source de vérité du schéma de base. Les
  repositories Prisma vivent en `infrastructure/persistence`, jamais accédés directement
  depuis le domaine.

### Base de données — PostgreSQL

- **Pourquoi** : source de vérité unique du brief. Excellentes capacités relationnelles +
  JSONB (utile pour le mapping de colonnes), Row-Level Security disponible si besoin,
  réputation solide pour les données réglementées, écosystème self-hosted mature.
- **Alternatives écartées** : SQLite (insuffisant pour multi-utilisateurs concurrents et
  audit long terme), MySQL (moins riche fonctionnellement), MongoDB (mauvais fit pour des
  jointures réglementaires sur clé partagée).

### Scheduler — node-cron au MVP, abstrait pour BullMQ + Redis ensuite

- **Pourquoi** : node-cron suffit pour un MVP avec quelques flows planifiés et un seul
  process. L'abstraction `Scheduler` permet de basculer vers BullMQ + Redis sans toucher
  aux flows quand la charge le justifie (retry, observabilité, multi-worker).
- **Alternative écartée** : démarrer directement BullMQ → complexité prématurée (Redis à
  héberger en plus, files à monitorer).

### Authentification — `AuthProvider` abstrait, local au MVP, OIDC générique ensuite

- **Pourquoi** : pour rester cohérent avec la promesse open source + self-hosted, le projet
  **ne dépend d'aucun fournisseur d'identité particulier**. Au MVP, un `LocalAuthProvider`
  gère email/password (argon2 + JWT court + refresh) — zéro tiers, démarrage instantané.
  Pour les déploiements qui veulent un SSO, un `OidcAuthProvider` générique sera ajouté :
  il parle à n'importe quel fournisseur OpenID Connect via le document de découverte
  `/.well-known/openid-configuration`. Les organisations peuvent ainsi brancher leur
  **Keycloak**, **Authentik** ou **Zitadel** auto-hébergés (recommandé pour rester sur de
  l'open source / self-hosted). N'importe quel autre fournisseur OIDC standard est
  techniquement compatible, mais ne fait pas partie de ce que le projet documente ou
  promeut. Le projet ne mentionne ni ne dépend d'aucun produit propriétaire dans son code
  ou son déploiement par défaut.
- **Conséquence** : aucune logique d'auth dans le domaine ou les routes. Les routes appellent
  un guard qui appelle le port. Bascule = changer un fil dans `main.ts`. Aucune mention de
  fournisseur propriétaire dans le code, le `.env.example` ou les ADR.

### Frontend — React + Vite

- **Pourquoi** : standard maîtrisé, Vite ultra-rapide en dev (HMR, ESM natif), build prod
  optimisé. Compatible avec tout l'écosystème UI choisi.
- **Alternatives écartées** : Next.js (utile pour SSR/SEO, mais l'app est un dashboard
  interne, pas un site public — surcout pour rien et complique le self-hosting), Remix
  (excellent mais même critique que Next).

### UI — shadcn/ui + Tailwind + Radix

- **Pourquoi** : composants copiés dans le repo (auditables, customisables, pas une
  dépendance opaque), accessibilité native (Radix), look moderne et sobre adapté à un outil
  métier de données sensibles. Cohérent avec l'approche skills design (Impeccable, Emil
  Kowalski, Taste) prévue dans le brief.
- **Alternatives écartées** : Mantine (riche mais moins customisable au pixel près), MUI
  (look Material trop marqué, lourd), pure Tailwind (re-créer les primitives = perte de
  temps inutile).

### Tableau — TanStack Table + TanStack Virtual

- **Pourquoi** : moteur headless performant, virtualisation native (indispensable pour des
  ETI avec milliers de lignes), tri/filtre/regroupement/pagination de qualité. S'habille
  proprement avec shadcn.
- **Alternative écartée** : AG Grid Community (puissant mais look "tableur" Excel, lourd).

### i18n — i18next

- **Pourquoi** : standard, ressources externes (JSON), pluralisation/contexte, ICU si besoin.
  Permet de viser FR au MVP avec une structure prête pour EN sans rétrofit coûteux.

### Tests — Vitest + Testing Library

- **Pourquoi** : même runner front et back (DX cohérente), ESM natif, rapide, syntaxe Jest-
  compatible. Testing Library pour les composants React. Vitest accepte les mocks et fakes,
  pyramide de tests confortable.
- **Alternatives écartées** : Jest (config plus lourde, plus lent en ESM), Node test runner
  natif (manque de confort sur les snapshots/mocks).

### Lint / format — ESLint + Prettier + eslint-plugin-boundaries

- **Pourquoi** : standard. `eslint-plugin-boundaries` rend la règle de dépendance de l'archi
  hexagonale **mécaniquement vérifiable** : un import depuis `infrastructure` dans
  `domain/` est rejeté par le lint, pas juste par convention.

### Conteneurisation dev / déploiement — Docker + docker-compose

- **Pourquoi** : reproductible, prépare directement le self-hosted demandé. Postgres +
  Adminer en dev via `docker-compose.yml` à la racine.

## Conséquences globales

- **Productivité dev solo** : stack TypeScript homogène, DX moderne, peu de friction.
- **Maintenabilité long terme** : ports/adapters isolent les choix réversibles. Si Prisma
  meurt, on réécrit `infrastructure/persistence`. Si Fastify vieillit, on réécrit
  `interface/http`. Le domaine reste.
- **Adoption open source** : stack mainstream → contributeurs faciles à attirer.
- **Self-hosted** : tout est embarquable dans des conteneurs sans dépendance cloud
  propriétaire.

## ADR liés

- `0002-rbac-matrix.md` — matrice RBAC pour les 6 rôles
- `0003-historisation-scd2.md` — stratégie d'historisation 40 ans
