# ADR 0003 — Historisation SCD type 2 (40 ans)

- **Statut** : Accepté
- **Date** : 2026-06-06
- **Décideur** : Jordan

## Contexte

L'article **R. 4412-93-3** du Code du travail (décret 2024-307) impose que la liste
nominative des travailleurs exposés aux CMR, transmise aux SPST, **soit conservée 40 ans**
dans le DMST. Notre outil, qui en est la source côté employeur, doit pouvoir :

1. **Reconstituer l'état exact de chaque liste à toute date passée** (audit, contestation,
   transmission rétroactive au SPST en cas de découverte tardive d'exposition).
2. **Conserver l'historique des modifications** sans perte, sur la durée légale.
3. Rester **performant** sur les requêtes courantes (état actuel), qui constituent 99% du
   trafic.

Le choix de stratégie d'historisation impacte le schéma des trois listes métier
(PERSONNEL, RISQUES_CHIMIQUES, DEGRE_EXPOSITION) et toutes les requêtes qui en découlent.

## Décision

Adopter **Slowly Changing Dimension type 2 (SCD2)** sur les trois listes métier.

### Principe

Chaque ligne logique est représentée par **plusieurs versions** dans une table d'historique,
chacune valide sur un intervalle `[valid_from, valid_to)`. Une seule version est « active »
à tout moment (celle dont `valid_to IS NULL`).

```
PersonnelHistory
├── id (bigserial)              -- clé technique de la version
├── personnel_id (uuid)         -- identité logique stable
├── matricule
├── nom, prenom, fonction
├── code_secteur
├── date_debut_secteur, date_fin_secteur
├── valid_from (timestamptz)    -- début de validité de cette version
├── valid_to (timestamptz NULL) -- fin de validité, NULL = active
├── operation (enum INSERT/UPDATE/DELETE)
├── recorded_by (uuid)          -- utilisateur ou import qui a écrit
└── recorded_at (timestamptz)
```

Index :
- unique partiel `(personnel_id) WHERE valid_to IS NULL` → garantit une seule version
  active.
- composite `(personnel_id, valid_from)` pour les requêtes temporelles.

### Vue de l'état actuel

Vue SQL (ou simple `WHERE valid_to IS NULL`) :

```sql
CREATE VIEW personnel_current AS
  SELECT * FROM personnel_history WHERE valid_to IS NULL;
```

Les requêtes du dashboard travaillent sur la vue. Les requêtes temporelles utilisent la
table d'historique.

### Reconstitution à une date

```sql
SELECT * FROM personnel_history
WHERE valid_from <= :at
  AND (valid_to IS NULL OR valid_to > :at);
```

Encapsulé dans la méthode `ListRepository.getHistory(listType, at)` du port.

### Écritures

Un upsert métier (import nightly, modification utilisateur) se traduit par :

1. **Si aucun changement de valeur** : ne rien faire.
2. **Si la ligne logique existe et qu'au moins un champ tracké a changé** :
   - `UPDATE personnel_history SET valid_to = NOW() WHERE personnel_id = ? AND valid_to IS NULL`
   - `INSERT` nouvelle version avec `valid_from = NOW()`, `valid_to = NULL`.
3. **Si la ligne logique n'existe pas** : `INSERT` avec `valid_from = NOW()`, `valid_to = NULL`.
4. **Soft-delete** : `UPDATE valid_to = NOW(), operation = DELETE`, pas de nouvelle version.

Le tout dans une **transaction**, idéalement via une fonction Postgres ou un repository
applicatif testé. Pour l'instant : niveau repository TypeScript (plus facile à tester),
avec un test d'intégration qui vérifie qu'on ne casse pas l'unicité de la version active.

### Champs trackés

- **PERSONNEL** : tous les champs métier (changement de fonction = nouvelle version, changement
  de secteur = nouvelle version).
- **RISQUES_CHIMIQUES** : tous les champs métier (mise à jour de la classif SGH, du niveau de
  risque, du retrait = nouvelle version).
- **DEGRE_EXPOSITION** : tous les champs métier (changement du degré pour une personne sur un
  produit = nouvelle version).

### Audit log distinct

L'historique SCD2 **n'est pas** le journal d'accès. Les deux coexistent :

- **SCD2** : versions des données métier (état à date).
- **AuditLog** : qui a consulté/exporté quoi, quand (port `AuditLogger`).

L'AuditLog n'a pas besoin de SCD2 (table append-only classique).

### Rétention

- **Par défaut** : aucune purge automatique → 40 ans garantis tant que la base existe.
- **Paramétrable** : un job de purge optionnel pourra supprimer les versions dont
  `valid_to < now() - retention_years`. Désactivé au MVP.
- Toute purge ne touche **jamais** la version active.

## Alternatives écartées

### Soft-delete + colonne `updated_at`

Simple, mais **incapable de reconstituer l'état à date** sans relire les logs de
modification. Insuffisant pour la conformité 40 ans et les contestations rétroactives.

### Event sourcing complet

Très puissant (toute la base est reconstruite par rejeu d'événements), mais :
- coût d'implémentation élevé (event store, projections, versioning des événements) ;
- complexité de maintenance pour un dev solo ;
- aucun besoin réel : on ne fait pas de CQRS complexe, on a juste besoin de l'état à date.

Sur-architecturé pour le MVP. Réévaluable si un besoin d'audit forensique émerge.

### Tables miroirs `*_history` séparées de la table « live »

Deux tables par entité (live + history), synchronisées par trigger. Plus complexe à maintenir
(double schéma, triggers à versionner), avec moins de bénéfice. SCD2 dans une seule table
historique + vue `*_current` est plus simple et tout aussi performant.

## Conséquences

- **Schéma Prisma** : les modèles métier seront nommés `PersonnelHistory`,
  `RisqueChimiqueHistory`, `DegreExpositionHistory`. Vues `*_current` matérialisées ou non
  selon le volume.
- **Repository** : encapsule la logique « close + insert » derrière une API simple
  `upsertItems()`. Tests d'intégration obligatoires sur la concurrence.
- **Imports** : un import nightly génère des nouvelles versions uniquement pour les lignes
  réellement modifiées. Diff calculé avant écriture.
- **Performance** : l'index unique partiel sur `(personnel_id) WHERE valid_to IS NULL` rend
  les requêtes courantes (état actuel) aussi rapides qu'une table normale. Les requêtes
  historiques sont plus lourdes mais rares.
- **Tests** : le `Clock` est injecté pour rendre `valid_from`/`valid_to` déterministes en
  test.

## ADR liés

- `0001-stack-and-tooling.md` — Prisma + Postgres
- `0002-rbac-matrix.md` — l'AccessFilter s'applique sur la vue current ET sur les requêtes
  historiques (les droits ne changent pas selon la date interrogée)
