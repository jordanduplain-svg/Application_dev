# ADR 0002 — Matrice RBAC pour les 6 rôles

- **Statut** : Accepté (matrice validée le 2026-06-11 : RH = administratif seul,
  Manager = détail chimique complet sur ses secteurs)
- **Date** : 2026-06-06
- **Décideur** : Jordan

## Contexte

L'application manipule des données de santé soumises au RGPD et expose **trois niveaux de
restitution** exigés par le décret 2024-307 (R. 4412-93-1 à 4) :

- **nominatif complet** pour la médecine du travail / SPST ;
- **individuel restreint** pour chaque collaborateur sur sa propre fiche ;
- **anonymisé** pour les autres travailleurs et le CSE.

Six rôles MVP : **Admin, HSE, RH, Médecine, Manager, Collaborateur**.

Le RBAC est appliqué **côté backend** à deux niveaux :

1. Guard HTTP qui autorise/refuse l'accès à un endpoint.
2. `AccessFilter` passé au repository qui filtre **lignes et colonnes en SQL** avant
   transmission au frontend.

Le navigateur ne reçoit **jamais** des données ensuite masquées par l'UI — fuite RGPD
inacceptable (la réponse réseau est inspectable).

## Décisions

### Identité et rattachement

- **Collaborateur** identifié par `matricule` (clé canonique stable) — pas par nom/prénom
  ni email. Lien `User.matricule` ↔ `Personnel.matricule` documenté dans le schéma Prisma.
- **Manager** porte une liste de `code_secteur` qu'il supervise (table de rattachement
  `ManagerSector`). Non auto-déduit du PERSONNEL pour rester explicite et auditable.
- **HSE, RH, Médecine, Admin** : pas de filtre row-level par défaut (voir cas particuliers
  ci-dessous).

### Matrice ligne (row-level) — qui voit quelles personnes

| Rôle | Périmètre des lignes visibles |
|---|---|
| **Admin** | Toutes les lignes. Réservé à la configuration et à l'administration de l'app, pas à l'usage métier quotidien. |
| **HSE** | Toutes les lignes du périmètre HSE (toute l'entreprise). Pas de filtrage par secteur. |
| **RH** | Toutes les lignes RH (toute l'entreprise). Pas de filtrage par secteur. |
| **Médecine** | Toutes les lignes (suivi nominatif individuel obligatoire art. R. 4412-93-3). |
| **Manager** | Uniquement les personnes dont le `code_secteur` figure dans la liste des secteurs du manager. |
| **Collaborateur** | Une seule ligne : sa propre fiche (`Personnel.matricule = User.matricule`). |

### Matrice colonne (column-level) — qui voit quoi sur une ligne autorisée

Légende : ✅ visible, 🔒 masqué/anonymisé, — non concerné.

| Colonne | Admin | HSE | RH | Médecine | Manager | Collaborateur (sur sa ligne) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| nom | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| prenom | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| matricule | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fonction | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| code_secteur | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| date_debut_secteur | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| date_fin_secteur | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| designation (produit) | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| n_cas | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| classif_sgh | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| pictogrammes | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| voies_exposition | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| mention_danger | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| mesures_prevention | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| niveau_risque | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| date_evaluation | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| date_retrait | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| degre_exposition | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |
| duree_exposition_annees (calculée) | ✅ | ✅ | 🔒 | ✅ | ✅ | ✅ |

**Rationale RH** : RH a besoin de connaître les personnes et leurs affectations (nom,
prénom, fonction, secteur, dates d'affectation), mais pas les **détails substances/produits**
qui relèvent du suivi HSE / médecine. Cette frontière limite la diffusion inutile
d'informations sensibles dans la chaîne RH. À discuter selon les pratiques internes —
modifiable via l'admin.

**Rationale Manager** : voit le détail chimique des personnes qu'il encadre (sa
responsabilité de prévention au niveau du secteur le justifie). À reconsidérer si la
politique interne le restreint.

### Vue anonymisée (CSE / autres travailleurs)

C'est un **mode de restitution** séparé, pas un rôle direct. Tous les rôles peuvent demander
la vue anonymisée d'un secteur s'ils y ont accès en lecture. Règles :

- nom, prenom, matricule : retirés ;
- regroupement par (secteur, produit) avec compteurs ;
- **k-anonymat configurable** (défaut k=5) : si un groupe a moins de k personnes, soit
  agrégation avec d'autres secteurs/produits, soit masquage avec mention « effectif < k »
  selon paramétrage de l'export ;
- `code_secteur` peut lui-même devenir identifiant si l'effectif est unique → traité par la
  règle de k-anonymat.

### Exports réglementaires

Trois exports, chacun appliquant les règles ci-dessus avant génération :

| Export | Rôles autorisés à le déclencher | Application |
|---|---|---|
| **Individuel** (1 personne, complet) | Collaborateur (sa fiche), Médecine, HSE, Admin | Vue nominative individuelle, PDF + Excel |
| **CSE anonymisé** | HSE, RH, Admin, CSE (si rôle ajouté plus tard) | Vue anonymisée, k-anonymat appliqué, PDF + Excel |
| **SPST nominatif** | HSE, Médecine, Admin | Vue nominative complète, PDF + Excel, prêt à transmission |

### Audit log — obligation absolue

**Toute** lecture ou export passant par un rôle non-Collaborateur (et toute lecture
Collaborateur hors de sa propre fiche, qui devrait être impossible mais doit être détectée si
elle survient) est enregistrée par le port `AuditLogger` :

- horodatage UTC
- utilisateur (id + rôle)
- action (consultation dashboard, vue individuelle, export X)
- périmètre (filtres appliqués, ids ciblés)
- résultat (succès / refus)

Aucune PII dans les messages de log eux-mêmes (uniquement des identifiants techniques).

## Conséquences

- L'AccessFilter est un objet du domaine, construit dans le cas d'usage à partir du
  `AuthenticatedUser`, et passé au repository. Tests unitaires sur ses règles.
- Le frontend reçoit déjà filtré. Pas de logique de masquage côté UI à des fins de sécurité
  (seulement à des fins d'ergonomie pure).
- Cette matrice est un **point de départ documenté**. L'admin pourra ajuster les
  visibilités colonne par rôle via une UI dédiée dans une évolution post-MVP (rôles
  configurables en base). Au MVP, les règles sont câblées dans `domain/authorization`.

## Points à valider par l'utilisateur

- **RH voit ou non les détails chimiques** ? Choix actuel : non. À confirmer selon vos
  pratiques HSE/RH internes.
- **Manager voit ou non les détails chimiques** ? Choix actuel : oui. À confirmer.
- **Un rôle CSE séparé** dès le MVP, ou la vue anonymisée déclenchée par HSE/RH suffit ?
  Choix actuel : pas de rôle CSE au MVP, ajouté plus tard si besoin.
- **Valeurs k-anonymat par défaut** : k=5. À ajuster selon la doctrine de votre DPO.
- **Admin technique vs Admin métier** ? Choix actuel : un seul rôle Admin pour le MVP, à
  séparer si besoin.

## ADR liés

- `0001-stack-and-tooling.md` — stack technique
- `0003-historisation-scd2.md` — historisation 40 ans
