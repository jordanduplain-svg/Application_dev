# Roadmap — Suivi des expositions CMR

> Consolidation des évolutions : conformité, gain de temps, confiance (données de
> santé) et expansion. Estimations d'effort **indicatives** : S ≈ 1–2 j, M ≈ 3–5 j,
> L ≈ 1–2 sem. Les axes de valeur : **Conformité**, **Temps**, **Confiance**, **Marché**.
>
> **Avancement** : ✅ **Phases 0, 1, 2, 5 complètes** + ✅ **3.0 coffre** + ✅ **3.2 PostgreSQL**
> + ✅ **3.1 SharePoint** (Graph, via app Entra) + ✅ **4.1 OIDC** (login Microsoft, code+jose,
> en plus du login local) + ✅ **6.2 packaging** (le backend sert le frontend compilé →
> `start:embedded` = base+API+UI en un process). **Restent par CHOIX** : 3.3 Snowflake (dép
> native + compte → YAGNI), 4.2 chiffrement des champs (le chiffrement au repos du déploiement
> couvre la menace sans casser le SCD2), 6.1 multi-établissement (spéculatif — 1 orga ; schéma
> déjà tenant-scopé). Migrations auto en embarqué : `transmissions`, `connector_secrets`.

---

## ✅ Déjà livré (socle)

| Élément | Détail |
|---|---|
| Cœur métier | Import Excel/CSV, mapping configurable, jointure 3 listes, calcul de durée d'exposition, détection d'anomalies |
| Historisation SCD2 | Reconstitution de l'état à toute date passée (conservation 40 ans) |
| Restitutions par rôle | Nominatif (SPST), individuel, anonymisé k-anonymat — RBAC côté serveur |
| Exports | PDF + Excel réglementaires |
| Moteur de flux | Réimport planifié (cron) + manuel |
| Sécurité | argon2id, JWT, **refresh token**, rate-limit login, audit sans PII |
| Écrans | Tableau de bord, fiche individuelle, admin sources, **journal d'imports**, **journal d'audit**, **gestion utilisateurs/rôles** |
| Vue temporelle | « État au JJ/MM/AAAA » |
| Intérimaires | Champ ETT (décret 2024-307) |
| Déploiement | **PostgreSQL embarqué** (sans Docker) + mode « tout-en-un » (`--embedded`) |
| Correctifs | 9 corrections (fuite k-anonymat, normalisation RBAC, a11y clavier, homonymes…) |

---

## 🚀 Roadmap

### Phase 0 — Quick wins (parallélisables, faible risque)

| # | Ajout | Valeur | Effort | Dépend de | Origine |
|---|---|---|---|---|---|
| 0.1 | **Aide contextuelle** (`?` à chaque étape, popover Radix + i18n) | Temps | S | — | toi |
| 0.2 | **Sauvegarde / restauration en 1 clic** (PG embarqué = un fichier) | Confiance | S | — | moi |
| 0.3 | **Suggestions de mapping auto** à l'import (nom de colonne → champ) | Temps | S | profilage existant | moi |
| 0.4 | **Attestation individuelle auto au départ** du salarié | Conformité | S | export individuel existant | moi |

### Phase 1 — Conformité (cœur de valeur)

| # | Ajout | Valeur | Effort | Dépend de | Origine |
|---|---|---|---|---|---|
| 1.1 | **Détection auto des CMR** depuis SGH/CLP (`H340/H350/H360`) | Conformité | S–M | champ `classifSgh` existant | moi |
| 1.2 | **Tableau de bord « Êtes-vous à jour ? »** (échéances SPST, départs sans attestation, CMR non déclarés) | Conformité | M | 1.1, 0.4 | moi |
| 1.3 | **Dashboard qualité des données** (centralise toutes les anomalies + parcours de correction) | Temps | S–M | moteur d'anomalies existant | moi |
| 1.4 | **Transmission SPST tracée** (envoi sécurisé + accusé + journal) | Conformité | M | — | moi |
| 1.5 | **Application réelle de la rétention 40 ans** + purge RGPD des non-CMR | Conformité | S–M | — | moi (dette) |

### Phase 2 — Import avancé « PowerQuery-lite »

| # | Ajout | Valeur | Effort | Dépend de | Origine |
|---|---|---|---|---|---|
| 2.1 | **Règles de transformation supplémentaires** (renommer, scinder, remplacer, supprimer colonne, remplir vers le bas, supprimer lignes vides) | Temps | S | moteur de règles existant | toi |
| 2.2 | **Grille interactive + « étapes appliquées »** (réordonnables, annulables, aperçu live) | Temps | M–L | 2.1 | toi |

### Phase 3 — Connecteurs externes

| # | Ajout | Valeur | Effort | Dépend de | Origine |
|---|---|---|---|---|---|
| 3.0 | **Coffre à secrets** (table chiffrée AES-GCM via `FIELD_ENCRYPTION_KEY`) | Confiance | S–M | — | moi (pré-requis) |
| 3.1 | **Connecteur SharePoint / OneDrive** (Graph → réutilise le parseur fichier) | Marché | M | 3.0 + app Entra ID | toi |
| 3.2 | **Connecteur SQL** — 1 moteur d'abord (PostgreSQL ou SQL Server) | Marché | M | 3.0 | toi |
| 3.3 | Connecteur **Snowflake** (si besoin réel) | Marché | M | 3.0 | toi |

### Phase 4 — Confiance & sécurité avancée

| # | Ajout | Valeur | Effort | Dépend de | Origine |
|---|---|---|---|---|---|
| 4.1 | **OIDC + MFA** (Keycloak/Authentik…) | Confiance | M | port `AuthProvider` prêt | moi |
| 4.2 | **Chiffrement applicatif des champs** sensibles | Confiance | M | `FIELD_ENCRYPTION_KEY` | moi (différé) |

### Phase 5 — Analytique (genre Power BI, version lean)

| # | Ajout | Valeur | Effort | Dépend de | Origine |
|---|---|---|---|---|---|
| 5.1 | **Explorateur de modèle** (data dictionary : tables, colonnes, types, volumes, fraîcheur) | Temps | S–M | — | toi |
| 5.2 | **Tableaux de bord analytiques pré-construits** (exposés par secteur/produit, répartition des degrés, tendances) + filtres — **RBAC identique** | Marché | M–L | — | toi |

### Phase 6 — Expansion & packaging

| # | Ajout | Valeur | Effort | Dépend de | Origine |
|---|---|---|---|---|---|
| 6.1 | **Multi-établissement** (`tenantId` déjà partout dans le schéma) | Marché | M | — | moi |
| 6.2 | **Packaging « double-clic »** (Electron/Tauri ou `pkg`) | Marché | M–L | mode embarqué fait | moi |
| 6.3 | *(optionnel)* Export « as-of », API/webhooks, visite guidée premier lancement | — | — | — | backlog |

---

## 🧭 Ordre conseillé

1. **Phase 0** (quick wins) — en continu, faible risque.
2. **Phase 1** (conformité) — la valeur qui *justifie et vend* le produit.
3. **Phase 2** (import avancé) — capitalise sur l'existant, zéro dépendance.
4. **Phase 3** (connecteurs) — après le coffre à secrets (3.0).
5. **Phase 4** (sécurité avancée) puis **Phase 5** (analytique).
6. **Phase 6** (expansion) quand le socle fonctionnel est mûr.

## ✅ Décisions à verrouiller

1. **SharePoint** : l'organisation peut-elle créer une app Entra ID (OAuth) ? (sinon pas d'auth)
2. **SQL** : quel moteur en premier — PostgreSQL / SQL Server / Snowflake ?
3. **Analytique** : KPI pré-construits (reco) ou exploration ad-hoc (plus lourd) ?
4. **Coffre à secrets** : table chiffrée via `FIELD_ENCRYPTION_KEY` (reco on-prem) — validé ?
5. **Priorité** : conformité (inattaquable) vs temps (adoption) vs différenciation (vente) ?

---

*Estimations indicatives, à affiner par chantier. Chaque item fera l'objet d'un plan
d'implémentation détaillé (fichiers, étapes, tests) avant codage.*
