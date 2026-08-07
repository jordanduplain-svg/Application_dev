# Couche `application`

Cas d'usage métier. Orchestrent le domaine via les **ports** (interfaces dans `ports/`).
Aucune connaissance des implémentations concrètes (Prisma, Excel, HTTP).

## Modules prévus

- `import/` — exécution d'un import depuis une `DataSource`, application du mapping,
  upsert SCD2 dans le `ListRepository`, journalisation des anomalies.
- `dashboard/` — construction du tableau de bord pour un utilisateur connecté (jointures
  via repository, filtre RBAC, calcul des durées).
- `exports/` — génération des trois types d'exports (individuel, CSE anonymisé, SPST
  nominatif) en PDF et Excel.
- `flows/` — moteur de flux : déclencheurs, conditions, actions.

Chaque cas d'usage est une classe avec un constructeur qui reçoit ses dépendances (ports)
et une méthode `execute()`. Pas de singleton, pas d'état caché.
