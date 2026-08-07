# Suivi des expositions aux risques chimiques (CMR)

> Outil open source de traçabilité des expositions des travailleurs aux agents chimiques **CMR**
> (cancérogènes, mutagènes, toxiques pour la reproduction — classes 1A/1B).
>
> Conçu pour répondre aux obligations introduites par le **décret n° 2024-307 du 4 avril 2024**
> (articles **R. 4412-93-1 à R. 4412-93-4 du Code du travail**, en vigueur au 5 juillet 2024).

---

## Pourquoi ce projet

Le décret 2024-307 impose à l'employeur d'établir et de maintenir à jour une **liste nominative
des travailleurs susceptibles d'être exposés aux CMR**, en cohérence avec le DUERP, et de la
transmettre régulièrement aux **services de prévention et de santé au travail (SPST)**, qui la
conservent **40 ans**.

Concrètement, cela impose à l'employeur de :

- tenir une liste à jour, par travailleur, des substances CMR concernées et — quand connus — de la
  nature, durée et degré d'exposition ;
- mettre à disposition de chaque travailleur les informations qui le concernent ;
- fournir aux autres travailleurs et au CSE une **version anonymisée** de la liste ;
- transmettre la liste actualisée au SPST, qui l'intègre au DMST pendant 40 ans ;
- gérer les intérimaires en lien avec leur entreprise de travail temporaire.

La plupart des organisations gèrent cela aujourd'hui dans des fichiers Excel ou dans des outils
QHSE généralistes (Seirich, Présanse, CERIB…) qui ne sont pas pensés pour automatiser ces trois
niveaux de restitution ni l'historisation 40 ans.

**Ce projet est un outil léger, spécialisé, open source, et déployable on-premise** qui fait
exactement cela — et rien d'autre.

## Ce que fait l'application

- Import des données depuis Excel, SharePoint, Snowflake et data lakes — la base de données
  PostgreSQL embarquée est la **source de vérité unique**.
- Croisement des trois listes (Personnel, Risques chimiques, Degré d'exposition) sur la clé de
  liaison `code_secteur` (mappable).
- Calcul automatique de la **durée d'exposition** par couple (personne, produit).
- Tableau de bord avec recherche, tri, virtualisation.
- **Trois niveaux de restitution** appliqués côté serveur selon le rôle :
  - **nominatif complet** — médecine du travail / SPST ;
  - **individuel restreint** — chaque collaborateur sur sa propre fiche ;
  - **anonymisé avec k-anonymat** — autres travailleurs et CSE.
- **Exports réglementaires** (PDF + Excel) prêts à transmettre.
- **Historisation SCD type 2** sur les données métier — reconstitution de l'état à toute date
  passée, conforme à la conservation 40 ans.
- **Moteur de flux** type Power Automate : réimport planifié (cron) ou déclenché par détection
  de changement, recalcul automatique du tableau de bord.

## Ce que l'application ne fait pas (volontairement)

C'est un outil **spécialisé**, pas une plateforme QHSE généraliste. **Hors scope** :
audits, gestion qualité, environnement, gestion documentaire générique, fiches de sécurité,
formation, EPI. Si vous cherchez ça, regardez ailleurs — la valeur de ce projet vient de sa
focalisation sur la traçabilité CMR.

## Stack technique

- **Backend** : Node.js, TypeScript strict, Fastify, Prisma, Zod
- **Frontend** : React, Vite, TypeScript, Tailwind, shadcn/ui (Radix), TanStack Table + Virtual,
  i18next
- **Base de données** : PostgreSQL (source de vérité unique)
- **Tests** : Vitest + Testing Library
- **Monorepo** : pnpm workspaces

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour les principes d'architecture et
[`docs/adr/`](docs/adr/) pour les décisions structurantes.

## Déploiement

L'application est conçue **self-hosted en priorité** : votre organisation héberge l'outil sur
sa propre infrastructure et les données de santé ne quittent jamais votre environnement. Le
caractère open source permet en plus l'audit du code par vos propres équipes ou un tiers.

> Instructions Docker à venir une fois le MVP fonctionnel.

## Démarrage en développement

> ⚠️ Pas encore opérationnel — ces instructions seront complétées au fil de la construction du
> MVP. Voir la section *État du projet* ci-dessous.

```bash
# Cloner le dépôt
git clone <url>
cd Suivi_risque_chimique

# Démarrer la base PostgreSQL en local
docker compose up -d

# Installer les dépendances (monorepo pnpm)
pnpm install

# Lancer les tests
pnpm test

# Démarrer en dev (backend + frontend)
pnpm dev
```

## État du projet

🚧 **En construction — phase de fondations.** Ce dépôt vient d'être initialisé.

Suivi du MVP (cf. section 15 du cahier des charges) :

- [ ] Calcul de durée d'exposition isolé + tests unitaires
- [ ] Schéma Prisma (3 listes) + migrations
- [ ] Import Excel + couche de mapping
- [ ] Jointures SQL et tableau de bord
- [ ] RBAC backend (6 rôles)
- [ ] Frontend : tableau de bord + vue individuelle + exports
- [ ] Flow planifié de réimport
- [ ] Données de test synthétiques

## Avertissements importants

### Outil fourni sans garantie

Ce logiciel est publié sous licence **AGPL-3.0** sans aucune garantie. Il est de votre
responsabilité de **faire valider sa conformité juridique par un préventeur et un juriste**
avant tout usage en production. Les choix faits sur la base du décret 2024-307 sont des
choix de travail à confirmer dans votre contexte.

### Données de santé

L'application manipule des données de santé au sens du RGPD (catégorie sensible).
Une **analyse d'impact relative à la protection des données (AIPD/DPIA)** est requise
avant tout traitement réel. L'architecture fournit les éléments nécessaires (audit log,
minimisation, chiffrement, contrôle d'accès) mais ne remplace pas cette analyse.

### Jamais de données réelles dans le dépôt

Le dépôt git **ne doit jamais contenir de données réelles** (personnel, santé,
entreprise). Seuls les jeux synthétiques générés par l'application sont autorisés en
tests. Un garde-fou pre-commit en empêche l'introduction accidentelle.

## Contribuer

Voir [`CONTRIBUTING.md`](CONTRIBUTING.md). Pour signaler une vulnérabilité, voir
[`SECURITY.md`](SECURITY.md).

## Licence

[AGPL-3.0](LICENSE). Le caractère copyleft fort de l'AGPL garantit que toute amélioration —
y compris dans un déploiement SaaS — reste accessible à la communauté.
