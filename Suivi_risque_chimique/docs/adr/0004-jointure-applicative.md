# ADR 0004 — Jointure du tableau de bord en couche applicative (pas en SQL)

- **Statut** : Accepté
- **Date** : 2026-06-11
- **Décideur** : Jordan (implémenté étape 4 du MVP)

## Contexte

Le brief (§7, §15.4) décrit le croisement des trois listes « en SQL » :
PERSONNEL × RISQUES_CHIMIQUES sur `code_secteur`, LEFT JOIN DEGRE_EXPOSITION
sur (identité personne, secteur, produit). Le rapprochement produit passe par
une **normalisation** (casse, accents, espaces) et l'attribution d'un degré
sans matricule exige une **détection d'ambiguïté homonymes**.

## Décision

La jointure est implémentée comme **fonction pure du domaine**
(`domain/dashboard/buildDashboardRows.ts`) opérant sur les trois listes
courantes récupérées depuis PostgreSQL — et non comme une requête SQL JOIN.

PostgreSQL **reste la source de vérité** : les données viennent exclusivement
des vues `*_current` via le repository. Seul le CROISEMENT se fait en mémoire.

## Justification

1. **Une seule implémentation de la normalisation.** Le rapprochement repose
   sur `normalizeText` (trim, casse, accents, espaces). En SQL il faudrait la
   ré-implémenter (`unaccent` + `lower` + `regexp_replace`) — deux
   implémentations qui finiraient par diverger silencieusement, sur la
   logique la plus sensible du produit (attribuer une exposition).
2. **La règle d'ambiguïté est du métier, pas de la plomberie.** Un degré sans
   matricule qui correspond à deux personnes du secteur ne doit PAS être
   attribué (données de santé : pas d'attribution au hasard) et doit produire
   une anomalie actionnable. Exprimer ça en SQL est tortueux ; en TypeScript
   pur c'est dix lignes testées.
3. **Volumes cibles.** ETI : quelques milliers de personnes, dizaines de
   produits par secteur. Le croisement tient en mémoire sans effort
   (millisecondes). On n'optimise pas un problème qu'on n'a pas.
4. **Testabilité.** 11 tests unitaires couvrent homonymes, multi-affectations,
   orphelins, durées — sans base de données, en millisecondes.

## Seuil de révision

Si un déploiement dépasse ~50 000 lignes de dashboard ou que le temps de
construction excède ~1 s : persister des colonnes normalisées
(`codeSecteurNorm`, `designationNorm`, `personKey`) calculées par le domaine à
l'import, et pousser la jointure en SQL sur ces colonnes. Les règles métier
(normalisation, ambiguïté) resteraient dans le domaine — seule l'exécution
descendrait en base. Le port `ListRepository` absorbe ce changement sans
toucher les couches supérieures.

## Conséquences

- Le RBAC (étape 5) filtrera les listes AVANT la jointure, dans la requête
  SQL du repository (`AccessFilter`) : le row-level reste appliqué en base.
- Les anomalies de jointure (`ambiguous_person_match`, `degree_orphan_*`)
  sont retournées avec les lignes et alimenteront l'écran qualité HSE.

## ADR liés

- `0003-historisation-scd2.md` — les vues `*_current` interrogées
- `0002-rbac-matrix.md` — l'AccessFilter s'applique en amont de la jointure
