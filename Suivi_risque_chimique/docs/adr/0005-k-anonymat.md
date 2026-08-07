# ADR 0005 — Stratégie de k-anonymat pour la vue anonymisée (CSE)

- **Statut** : Accepté
- **Date** : 2026-06-12
- **Décideur** : Jordan

## Contexte

L'article R. 4412-93-2 impose de tenir à disposition des **autres travailleurs
et des membres du CSE** une **version anonymisée** de la liste des exposés.

« Anonymisée » ne se réduit pas à « sans les noms ». Un **secteur à effectif
réduit** ré-identifie une personne sans la nommer : « le seul salarié de
l'atelier X exposé au toluène » désigne quelqu'un. Le brief le signale
explicitement (« se méfier des croisements ré-identifiants, ex. un secteur
avec un seul salarié »).

Il faut donc un seuil de **k-anonymat** : aucune information publiée ne doit
pouvoir se rapporter à moins de `k` personnes.

## Décision

### Unité d'agrégation : le couple (secteur, produit)

La vue anonymisée agrège les expositions par **(secteur, produit)**. Pour
chaque couple, on publie : effectif exposé (personnes distinctes), répartition
des degrés, et les métadonnées **non personnelles** du produit (n° CAS,
classification SGH, mention de danger).

### Seuil appliqué au niveau du couple

Un couple (secteur, produit) dont l'effectif de personnes **distinctes** est
**< k** est entièrement **masqué** : ni le produit, ni le secteur, ni le degré
ne sont publiés pour lui.

**`k` est configurable** (variable `K_ANONYMITY_THRESHOLD`, défaut **5**).

### Pourquoi ce niveau plutôt que le niveau secteur

Appliquer le seuil au couple (secteur, produit) est **strictement plus
protecteur** que l'appliquer au secteur seul, et il **subsume** le cas du
brief :

- un secteur d'un seul salarié a, pour chacun de ses produits, un effectif de
  1 → tous ses couples sont masqués → le secteur n'apparaît nulle part ;
- un secteur de 50 personnes dont une seule manipule un produit rare : le
  couple (secteur, produit rare) a un effectif de 1 → masqué, alors qu'un
  seuil au niveau secteur l'aurait laissé fuiter.

C'est le modèle de k-anonymat classique appliqué aux quasi-identifiants
réellement publiés : ici le quasi-identifiant est la paire (secteur, produit).

### Transparence du masquage (sans fuite)

On remonte un décompte **agrégé et global** de ce qui a été masqué : nombre de
couples masqués et nombre d'expositions concernées. **Sans** nommer les
secteurs ni les produits — les nommer trahirait justement les petits effectifs.

Cela satisfait deux exigences :
- règle UX « pas de troncature silencieuse » : le CSE sait que des données ont
  été retirées et combien ;
- RGPD *accountability* : on documente le traitement appliqué.

### Décompte des personnes : distinctes, pas les lignes

Une personne présente plusieurs fois (multi-affectation, plusieurs lignes) est
comptée **une seule fois** par couple. Clé de décompte : matricule prioritaire,
repli nom+prénom normalisés — cohérente avec la jointure (ADR 0004).

## Conséquences

- Module pur `domain/anonymization`, `k` injecté, couvert par 11 tests dont
  des assertions anti-fuite (aucune donnée nominative ni secteur masqué dans
  la sortie).
- Réutilisé par l'export CSE (PDF/Excel) et par toute future « vue anonymisée »
  à l'écran.
- Limite assumée : le k-anonymat protège contre la ré-identification par les
  quasi-identifiants publiés. Il ne protège pas contre un attaquant disposant
  d'un savoir externe fort (« je sais que Bob est le seul à faire telle tâche »).
  Pour le périmètre réglementaire CSE, ce niveau est l'état de l'art ; la
  l-diversité / t-proximité ne sont pas requises ici et seraient
  disproportionnées.

## Points à valider (préventeur / DPO)

- **Valeur de `k`** : 5 par défaut. À confirmer selon la doctrine du DPO et la
  taille des effectifs réels.
- **Masquage vs regroupement** : on a choisi le **masquage** (le couple
  disparaît). Une alternative serait de regrouper les petits effectifs sous un
  libellé « autres secteurs » — plus informatif mais plus délicat à garantir
  sans fuite. Masquage retenu pour le MVP par prudence.

## ADR liés

- `0002-rbac-matrix.md` — qui peut déclencher l'export CSE
- `0004-jointure-applicative.md` — clé de personne et normalisation partagées
