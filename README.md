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

### [SAM.gov Tracker](SAM_Tracker)

Application Windows installable qui repère les appels d'offres fédéraux américains publiés sur SAM.gov correspondant à des mots-clés (marketing, communication, branding, web design et développement). Téléchargement quotidien des données publiques, score par mots-clés pondérés, regroupement des versions d'une même offre, seules les offres encore ouvertes affichées par défaut, et page de réglages pour modifier les mots-clés. Installateur généré automatiquement par GitHub Actions.

`Python` · `Flask` · `SQLite` · `PyInstaller` · `Inno Setup` · `pytest`

## Projets d'apprentissage

### [Cartel](Cartel)

Jeu de gestion PC en développement : concevoir un produit entièrement fictif par de vrais arbitrages, le distribuer sur un réseau mondial, blanchir un argent qui accuse, jusqu'à l'épidémie que ses propres routes propagent. Simulation déterministe pilotée par les données, recherche en grille d'hexagones, et harnais d'équilibrage par bots témoins (levier de sensibilité, cibles chiffrées). Simulation portée de Godot vers TypeScript et validée au bit près, campagne par campagne ; interface web à venir, empaquetée par Electron. Le document de conception (`GDD.md`) est la source de vérité.

`TypeScript` · `Node.js` · `Electron` (à venir)

### [SpaceCenter](SpaceCenter)

Visualisation 3D de mécanique orbitale dans le navigateur.

`TypeScript` · `Three.js` · `Vite`

### [Jeux_Avion](Jeux_Avion)

Projet de jeu, réalisé pour explorer le rendu temps réel et la boucle de jeu.
