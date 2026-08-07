# Protocole de test manuel — Phases 0, 1, 2, 5

> Validation fonctionnelle des évolutions. Chaque test : **rôle** → **étapes** → **résultat attendu**.
> Mot de passe commun des comptes démo : `demo-cmr-2026!`.

## 0. Démarrage

```powershell
# Terminal 1 — backend + base embarquée (laisser tourner)
pnpm --filter @cmr-tracker/backend dev:embedded
#   → attendre la ligne « [boot] backend prêt sur :3001 »

# Terminal 2 — données de démo (À LANCER APRÈS le message ci-dessus)
pnpm --filter @cmr-tracker/backend run seed:demo

# Terminal 2 (ou 3) — interface
pnpm --filter @cmr-tracker/frontend dev
```
Ouvrir **http://localhost:5173**.

| Compte | Rôle | Voit |
|---|---|---|
| admin@demo.local | ADMIN | tout + administration |
| hse@demo.local | HSE | tout + Sources/Imports/Conformité/Analytique |
| medecine@demo.local | MEDECINE | tout (nominatif) + Analytique |
| rh@demo.local | RH | vue administrative (sans chimie) |
| manager@demo.local | MANAGER | son secteur (ATELIER-B) |
| alice@demo.local | COLLABORATEUR | sa fiche |

> Le seed crée un produit **CMR de démo** (« Benzène (démo) », H350/H340) dans ATELIER-A : les fonctions CMR sont donc visibles.

---

## A. Socle — connexion, RBAC, session

| # | Rôle | Étapes | Attendu |
|---|---|---|---|
| A1 | — | Mauvais mot de passe | « Identifiants invalides. » |
| A2 | — | >10 tentatives ratées d'affilée | « Trop de tentatives… » (429) |
| A3 | RH | Se connecter | Bandeau « Vue administrative » ; **aucune colonne chimique** (ni produit, ni degré) |
| A4 | MANAGER | Se connecter | Ne voit que les lignes d'**ATELIER-B** |
| A5 | COLLABORATEUR (alice) | Se connecter | Titre « Votre fiche » ; uniquement ses lignes |
| A6 | HSE | Trier une colonne au **clavier** (Tab jusqu'à l'en-tête, Entrée) ; ouvrir une ligne (Tab + Entrée) | Tri + fiche s'ouvrent sans souris (accessibilité) |

---

## Phase 0 — Quick wins

| # | Rôle | Étapes | Attendu |
|---|---|---|---|
| 0.1a | HSE | Dashboard → `?` à côté de « État au : » et « CMR uniquement » | Bulle d'aide s'ouvre (clic + Échap ferme) |
| 0.1b | HSE | Sources → Nouvelle source → un `?` à chaque étape | Aide contextuelle sur liste/connecteur/fichier/aperçu/mapping/règles/validation |
| 0.2 | ADMIN | Header → **Sauvegarder** | Télécharge `cmr-backup-AAAA-MM-JJ.sql` (ouvrable, contient du SQL) |
| 0.3 | HSE | Wizard, charger un fichier, étape **Mapping** → **Remplir automatiquement** | Les champs se pré-remplissent d'après les noms de colonnes |
| 0.4 | HSE | Dashboard → bannière ambre « N travailleurs sont partis… » → déplier → **Attestation (PDF)** | Liste *Moreau-Test* (parti 31/03/2023) ; le PDF se télécharge |

---

## Phase 1 — Conformité (bouton **Conformité**, HSE/ADMIN)

| # | Rôle | Étapes | Attendu |
|---|---|---|---|
| 1.2 | HSE | Ouvrir Conformité | 5 cartes : dernière transmission (**Jamais** au départ), attestations à remettre (≥1), produits CMR (**1**), exposés CMR (**≥1**), anomalies |
| 1.4a | HSE | Section Transmissions → **Enregistrer une transmission** | Apparaît dans l'historique (date + nb) ; carte « dernière transmission » = aujourd'hui |
| 1.3 | HSE | Section Qualité des données | Liste des anomalies (sur données propres : « Aucune anomalie ») |
| 1.5a | ADMIN | Section Conservation → **Simuler** | « 0 version close concernée » (normal à 40 ans) ; bouton « Purger » désactivé |
| 1.x | ADMIN | Bouton **Journal d'accès** après 1.4a/0.2 | Les actions `transmission_record`, `backup_download` y figurent |

---

## Phase 2 — Import avancé (wizard, HSE/ADMIN)

Préparer un petit fichier CSV de test, ex. `risques.csv` :
```
Produit;CAS;SGH;Secteur
Benzene;71-43-2;H350;ATELIER-A
Acetone;67-64-1;H225;ATELIER-A
```

| # | Étapes | Attendu |
|---|---|---|
| 2.1 | Sources → Nouvelle source → liste « Risques chimiques » → connecteur CSV → charger le fichier → étape Mapping | Les nouvelles règles sont proposées : Renommer, Scinder, Remplacer, Supprimer colonne, Remplir vers le bas, Supprimer lignes vides |
| 2.2a | Ajouter une règle « Mettre en MAJUSCULES » sur `Produit` | La grille **« Aperçu après transformations »** se met à jour en direct (BENZENE, ACETONE) |
| 2.2b | Ajouter une 2ᵉ règle, la **réordonner** avec ↑/↓ | L'ordre change, l'aperçu reflète le nouvel ordre |
| 2.2c | Règle « Remplir vers le bas » sur une colonne à trous | Les vides reprennent la valeur du dessus dans l'aperçu |

---

## Phase 5 — Analytique (bouton **Analytique**, HSE/ADMIN/MEDECINE)

| # | Étapes | Attendu |
|---|---|---|
| 5.2a | Ouvrir Analytique | 5 KPI (travailleurs, produits, expositions, **produits CMR=1**, exposés CMR≥1) |
| 5.2b | Graphiques | Barres « par secteur », « par produit », « par degré » cohérentes avec les données |
| 5.1 | Section « Modèle de données » | 3 cartes (Personnel / Risques / Degrés) avec nb de lignes et la liste des champs (obligatoires marqués `*`) |

---

## CMR (transversal — visible grâce au seed)

| # | Rôle | Étapes | Attendu |
|---|---|---|---|
| C1 | HSE | Dashboard → chercher « Benzène » | Badge rouge **CMR** sur la ligne (info-bulle : cancérogène, mutagène) |
| C2 | HSE | Cocher **« CMR uniquement »** | Ne reste que les lignes CMR (Benzène démo) |

---

## Phase 3 — Connecteurs externes (Sources, ADMIN/HSE)

Prérequis : `FIELD_ENCRYPTION_KEY` définie dans `.env` (déjà le cas) — les secrets de connexion sont chiffrés dans le coffre.

| # | Connecteur | Étapes | Attendu |
|---|---|---|---|
| 3a | **PostgreSQL** | Sources → Nouvelle → « Base PostgreSQL » → chaîne `postgresql://cmr:cmr_dev_password@localhost:5435/cmr_tracker` + table `users` → Suivant | Aperçu des colonnes de la table `users` (lecture réelle via `pg`) |
| 3b | **Injection SQL** | Table = `users; DROP TABLE x` | Refus (nom de table invalide) |
| 3c | **SharePoint** | Sources → Nouvelle → « SharePoint / OneDrive » → colle un **lien de partage** d'un .xlsx/.csv + feuille → Suivant | Fichier téléchargé via Graph, aperçu des colonnes |
| 3d | **Coffre** | Après création d'une source SQL/SharePoint | La chaîne/lien n'est **jamais** renvoyée à l'écran (édition : champ vide = on conserve) |

## Phase 4 — OIDC (login Microsoft)

Prérequis : le compte app dont l'**email = ton email Microsoft** doit exister (Comptes → Nouveau compte).

| # | Étapes | Attendu |
|---|---|---|
| 4a | Page login → **« Se connecter avec Microsoft »** | Redirection Microsoft → retour connecté (le compte app correspondant) |
| 4b | Login Microsoft avec un email **sans** compte app | Retour à /login avec « Connexion Microsoft refusée… » (pas d'auto-création) |

## Mode packagé (un seul process : base + API + interface)
```powershell
pnpm build                                           # construit frontend + backend
pnpm --filter @cmr-tracker/backend start:embedded    # sert TOUT sur :3001
```
→ Ouvre **http://localhost:3001** : l'interface est servie par le backend. (Pour l'OIDC en packagé, mets `http://localhost:3001` en tête de `FRONTEND_ORIGIN`.)

---

## Arrêt propre
**Ctrl+C** dans le terminal du backend (arrête aussi la base → pas de process résiduel). Ne lancer qu'un seul serveur à la fois.

## Non couvert
**Snowflake** (Phase 3.3) : nécessite un compte Snowflake + une dépendance native — à faire sur le même socle que PostgreSQL le jour où c'est utile.
