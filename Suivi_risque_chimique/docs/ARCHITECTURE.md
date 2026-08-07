# Architecture — Application de suivi des expositions CMR

But de ce document : une architecture **maintenable sur la durée** (le projet va vivre des
années, évoluer, accueillir des contributeurs). Le principe directeur : **isoler ce qui
change souvent de ce qui change rarement**, et garder les règles métier pures et testables
au centre.

> **À lire avant de coder.** Toute contribution doit respecter la règle de dépendance énoncée
> ci-dessous. Les ADR dans `docs/adr/` complètent ce document sur les décisions
> structurantes (stack, RBAC, historisation).

---

## 1. Principe de base : architecture en couches (hexagonale, version pragmatique)

Trois cercles, avec une règle absolue : **les dépendances pointent vers l'intérieur.**
L'extérieur connaît l'intérieur, jamais l'inverse.

```
        ┌─────────────────────────────────────────────┐
        │  INFRASTRUCTURE (détails, ça change souvent) │
        │  Prisma, connecteurs, HTTP, cron, OIDC        │
        │   ┌───────────────────────────────────────┐  │
        │   │  APPLICATION (cas d'usage / services)  │  │
        │   │  importer, construire dashboard,       │  │
        │   │  générer exports, exécuter flux        │  │
        │   │   ┌─────────────────────────────────┐  │  │
        │   │   │  DOMAINE (règles métier pures)  │  │  │
        │   │   │  calcul durée, mapping,         │  │  │
        │   │   │  anonymisation, autorisations   │  │  │
        │   │   └─────────────────────────────────┘  │  │
        │   └───────────────────────────────────────┘  │
        └─────────────────────────────────────────────┘
```

- **Domaine** : la logique métier (calcul de durée d'exposition, règles d'anonymisation,
  règles d'autorisation, entités). **Zéro dépendance** à une base de données, un framework,
  un réseau. C'est du TypeScript pur, testable en millisecondes. C'est le cœur qui ne doit
  jamais être pollué.
- **Application** : orchestre le domaine via des **ports** (interfaces). Un cas d'usage =
  une intention métier ("importer une source", "construire le tableau de bord pour cet
  utilisateur", "générer l'export CSE anonymisé").
- **Infrastructure** : les **détails techniques** qui implémentent les ports. Prisma, les
  connecteurs d'import (Excel, Snowflake, SharePoint…), le serveur HTTP Fastify, le
  scheduler, l'auth (locale ou OIDC).
  C'est ce qui change le plus souvent — donc c'est en périphérie, remplaçable sans toucher
  au cœur.

**Pourquoi ça évite le cauchemar :** quand la loi change le calcul de durée, on modifie UN
fichier dans le domaine, couvert par des tests. Quand on ajoute un connecteur, on écrit UN
adaptateur, sans rien casser ailleurs. Quand on change de base de données, le domaine ne le
sait même pas.

---

## 2. Structure de dossiers (monorepo)

```
cmr-tracker/
├── apps/
│   ├── backend/
│   │   └── src/
│   │       ├── domain/              # règles métier pures, 0 I/O
│   │       │   ├── exposure/        # calcul durée + value objects
│   │       │   ├── mapping/         # mapping colonnes → champs canoniques
│   │       │   ├── anonymization/   # anonymisation + anti ré-identification
│   │       │   ├── authorization/   # politiques RBAC (row + column)
│   │       │   └── entities/        # Personnel, RisqueChimique, Exposition
│   │       ├── application/         # cas d'usage (orchestration)
│   │       │   ├── import/
│   │       │   ├── dashboard/
│   │       │   ├── exports/
│   │       │   └── flows/
│   │       ├── ports/               # interfaces (contrats)
│   │       │   ├── DataSource.ts
│   │       │   ├── ListRepository.ts
│   │       │   ├── AuditLogger.ts
│   │       │   └── Clock.ts
│   │       ├── infrastructure/      # adaptateurs (implémentations)
│   │       │   ├── persistence/     # repositories Prisma + schéma
│   │       │   ├── connectors/      # excel/, snowflake/, sharepoint/, datalake/
│   │       │   ├── scheduler/       # node-cron (+ BullMQ plus tard)
│   │       │   └── auth/            # local (MVP) puis OIDC générique (Keycloak, …)
│   │       ├── interface/           # entrée HTTP
│   │       │   ├── http/            # routes Fastify, controllers, guards
│   │       │   └── dto/             # validation des entrées (Zod)
│   │       ├── config/              # chargement config/env
│   │       └── main.ts             # COMPOSITION ROOT (câblage des dépendances)
│   └── frontend/
│       └── src/
│           ├── features/            # découpage PAR FONCTIONNALITÉ
│           │   ├── dashboard/
│           │   ├── individual-view/
│           │   ├── mapping/
│           │   ├── sources/
│           │   ├── flows/
│           │   └── auth/
│           ├── components/          # UI réutilisable (design system shadcn)
│           ├── lib/                 # client API, hooks transverses, i18n
│           └── app/                 # routing, providers
├── packages/
│   └── shared/                      # types partagés front ↔ back (DTOs, enums)
├── docker/                          # Dockerfile(s) + docker-compose (self-hosted)
├── docs/
│   ├── ARCHITECTURE.md              # ce document
│   └── adr/                         # décisions d'architecture (voir §6)
├── .env.example
└── package.json                     # workspaces (pnpm)
```

Deux choix structurants :

- **Backend découpé par couche** (domain/application/infrastructure) → protège le cœur métier.
- **Frontend découpé par fonctionnalité** (et non par type de fichier) → quand l'app grossit,
  tout ce qui concerne "le dashboard" est au même endroit, pas éparpillé entre
  `components/`, `hooks/`, `services/`. C'est ce qui empêche le front de devenir illisible.

---

## 3. Les contrats (ports) qui rendent tout remplaçable

Les ports sont les interfaces que le domaine/application définit et que l'infrastructure
implémente. Exemples clés :

```typescript
// L'app dépend de CETTE interface, pas de Excel/Snowflake/SharePoint.
interface DataSource {
  test(): Promise<boolean>;
  fetchTable(config: TableConfig): Promise<RawRow[]>;
  hasChangesSince?(token: string | null): Promise<{ changed: boolean; nextToken: string }>;
}

// L'accès aux données passe par un repository, jamais par Prisma directement
// dans la logique métier.
interface ListRepository {
  upsertItems(listType: ListType, items: CanonicalItem[]): Promise<void>;
  query(listType: ListType, filter: AccessFilter): Promise<CanonicalItem[]>;
  getHistory(listType: ListType, at: Date): Promise<CanonicalItem[]>; // historisation 40 ans
}

// Clock injectable → le calcul de durée est testable de façon déterministe.
interface Clock {
  now(): Date;
}

// Journalisation des accès, transverse.
interface AuditLogger {
  record(event: AccessEvent): Promise<void>;
}

// Authentification : abstrait pour basculer local → OIDC générique sans casse.
interface AuthProvider {
  verify(token: string): Promise<AuthenticatedUser>;
}
```

**Pourquoi :** ajouter une source = écrire `class SnowflakeDataSource implements DataSource`.
Changer d'ORM = réécrire l'adaptateur `ListRepository`. Brancher un SSO (Keycloak,
Authentik, Zitadel…) = écrire `OidcAuthProvider`. Le reste du code ne bouge pas.

---

## 4. Le câblage : composition root unique

Tout l'assemblage des dépendances se fait à **un seul endroit** (`main.ts`) : on y crée les
implémentations concrètes (Prisma, connecteurs, scheduler) et on les injecte dans les cas
d'usage. Pas de `new PrismaClient()` disséminé dans 30 fichiers, pas de couplage caché.

```typescript
// main.ts (simplifié)
const clock = new SystemClock();
const repo = new PrismaListRepository(prisma);
const audit = new PrismaAuditLogger(prisma);
const auth = new LocalAuthProvider(prisma);          // remplaçable par OidcAuthProvider
const buildDashboard = new BuildDashboardUseCase(repo, audit, clock);
// ... puis on branche les routes HTTP sur les cas d'usage.
```

**Pourquoi :** pour comprendre comment l'app est branchée, on lit un seul fichier. Pour
remplacer un composant en test (ex. un `FakeClock`, un `InMemoryListRepository`), on change
une ligne ici.

---

## 5. Points sensibles, traités à UN seul endroit

Règle anti-cauchemar : chaque préoccupation transverse vit dans **un module unique**, jamais
dispersée.

- **Autorisations (RBAC)** : un module `domain/authorization` définit les règles (qui voit
  quelles lignes/colonnes). Appliqué à **deux niveaux** : un *guard* HTTP qui bloque
  l'accès, ET un `AccessFilter` passé au repository qui filtre les lignes/colonnes **dans la
  requête SQL** (jamais de filtrage seulement côté front). Une seule source de vérité pour
  les droits. Matrice détaillée dans `docs/adr/0002-rbac-matrix.md`.
- **Calcul de durée d'exposition** : une fonction pure dans `domain/exposure`, avec `Clock`
  injecté, couverte par des tests sur tous les cas limites.
- **Anonymisation** : un module `domain/anonymization` qui produit la vue anonymisée ET
  vérifie les risques de ré-identification (k-anonymat configurable, défaut k=5). Réutilisé
  par les exports CSE.
- **Mapping de colonnes** : un module `domain/mapping` qui transforme les colonnes client en
  champs canoniques, appliqué dans le pipeline d'import avant tout le reste. Parser de dates
  multi-format (ISO + FR + série Excel numérique) configurable par fichier.
- **Audit log** : un port `AuditLogger` appelé par les cas d'usage de lecture/export.
  Centralisé, pas réimplémenté partout.
- **Identité collaborateur** : `matricule` comme clé canonique stable, jamais nom/prénom seuls.

---

## 6. Pratiques qui gardent le projet sain dans le temps

- **Types partagés** (`packages/shared`) entre front et back → ils ne dérivent jamais. Une
  seule définition de chaque DTO/enum.
- **Validation aux frontières** : toute entrée HTTP validée par Zod dans `interface/dto`
  avant d'atteindre la logique. Le cœur ne reçoit que des données déjà sûres.
- **Migrations versionnées** (Prisma Migrate) → évolutions de schéma propres et reversibles.
- **Historisation SCD type 2** : tables `*_history` avec `valid_from` / `valid_to` pour la
  conservation 40 ans (R. 4412-93-3). Détails dans `docs/adr/0003-historisation-scd2.md`.
- **Tests en pyramide** : beaucoup de tests unitaires sur le domaine (rapides, sans DB) ;
  tests de cas d'usage avec adaptateurs en mémoire ; quelques tests d'intégration
  repository+DB ; e2e HTTP minimal. Stack : Vitest partout.
- **ADR (Architecture Decision Records)** dans `docs/adr/` : un court fichier par décision
  importante ("pourquoi Postgres", "pourquoi hexagonal", "pourquoi self-hosted"). Ça évite
  de re-débattre les choix dans 6 mois et aide les contributeurs.
- **Lint + format automatiques** (ESLint + Prettier), TypeScript strict partout.
- **Frontières de module respectées** : interdire (via lint, ex. `eslint-plugin-boundaries`)
  que le domaine importe de l'infrastructure. La règle de dépendance devient mécaniquement
  vérifiée, pas juste une bonne intention.

---

## 7. Ne PAS sur-architecturer (aussi important)

Une architecture trop lourde est elle-même un cauchemar de maintenance pour un dev solo.
Donc, pragmatique :

- **Pour le MVP** : garder tout dans `apps/backend/src/` avec les dossiers
  domain/application/infrastructure. **Ne pas créer** dès le départ une multitude de
  packages séparés ni de la DI complexe avec un framework dédié — l'injection manuelle dans
  `main.ts` suffit largement.
- N'extraire le domaine dans un `packages/domain` séparé **que si** un vrai besoin apparaît
  (réutilisation, build séparé).
- Pas d'abstraction "au cas où". On abstrait les points réellement variables (sources de
  données, persistance, horloge, auth) — pas le reste.
- La règle d'or : **le code le plus simple qui respecte la règle de dépendance (extérieur →
  intérieur)**. La clarté prime sur la sophistication.

---

## 8. Résumé : pourquoi ça ne deviendra pas ingérable

| Risque de cauchemar | Réponse architecturale |
|---|---|
| La loi change le calcul | Logique pure isolée + tests → un seul fichier à modifier |
| Ajouter une source de données | Nouvel adaptateur derrière le port `DataSource`, zéro impact ailleurs |
| Les droits d'accès s'éparpillent | RBAC centralisé, appliqué côté serveur (guard + filtre SQL) |
| Le front devient illisible | Découpage par fonctionnalité, design system, types partagés |
| Couplage caché / spaghetti | Règle de dépendance vérifiée par lint, câblage en un seul endroit |
| On oublie pourquoi un choix a été fait | ADR dans docs/adr/ |
| Régressions silencieuses | Pyramide de tests, domaine couvert à fond |
| Bascule auth local → SSO | Port `AuthProvider`, un seul adaptateur à écrire |
