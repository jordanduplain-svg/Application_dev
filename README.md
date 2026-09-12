# Projets applicatifs

Dépôt regroupant mes projets personnels de développement. Chaque dossier est un projet indépendant, avec son propre README.

## Projets principaux

### [Suivi des expositions aux risques chimiques (CMR)](Suivi_risque_chimique)

Outil de traçabilité des expositions des travailleurs aux agents chimiques CMR, conçu pour répondre au décret n° 2024-307 du 4 avril 2024.

Import depuis Excel, SharePoint et Snowflake vers une base PostgreSQL qui sert de source de vérité unique, calcul automatique des durées d'exposition, historisation SCD type 2 permettant de reconstituer l'état des données à n'importe quelle date passée, et trois niveaux de restitution appliqués côté serveur selon le rôle : nominatif complet pour la médecine du travail, individuel restreint pour chaque salarié, anonymisé avec k-anonymat pour le CSE. Exports réglementaires PDF et Excel, et moteur de flux planifiés pour le réimport.

`TypeScript` · `React` · `Prisma` · `PostgreSQL` · `Vitest`

### [Candio](Candio)

Application d'automatisation de bout en bout avec intégration d'un LLM : collecte automatisée d'annonces, génération de contenu personnalisé via l'API Claude, envoi et moteur de relance, avec suivi des taux de réponse par segment. Plus de 800 exécutions en production.

`TypeScript` · `React` · `Electron` · `Prisma` · `Vitest`

## Projets d'apprentissage

### [SpaceCenter](SpaceCenter)

Visualisation 3D de mécanique orbitale dans le navigateur.

`TypeScript` · `Three.js` · `Vite`

### [Jeux_Avion](Jeux_Avion)

Projet de jeu, réalisé pour explorer le rendu temps réel et la boucle de jeu.
