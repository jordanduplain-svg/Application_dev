# PROMPT — Démarrage projet Orbite (V1)

Tu es en charge de porter un prototype HTML/Three.js (CDN, fichier unique) vers un vrai projet structuré. Ce n'est pas un script jetable : c'est la fondation d'un jeu de gestion spatiale (arbre tech, réputation, fiabilité composants) qui va grossir sur plusieurs mois. Priorise une **architecture claire et profonde** dès ce premier commit, pas un MVP jetable qu'il faudra tout réécrire.

## Contexte fourni
- `interface_3d.html` — prototype de référence (caméra orbitale, panneau de détails, placement). Source d'inspiration pour la logique, PAS à copier tel quel.
- `GDD_Fusees.md` — design complet du jeu, notamment section 12 (système de grille, verrouillé).
- `assets-source/quaternius/` — pack de modèles 3D CC0 téléchargé, à trier.

## Exigence d'architecture
Structure le projet en couches nettement séparées, avec des frontières explicites — je veux pouvoir remplacer un module sans toucher aux autres :

1. **Rendu / scène (Three.js pur)** — setup renderer, caméra, lumières, terrain, boucle de rendu. Ne connaît rien à la logique de jeu.
2. **État du jeu** — grille, bâtiments possédés, budget, zones débloquées. Pur JS/TS, testable sans Three.js (pas de dépendance au DOM ou au renderer).
3. **Config data-driven** — `buildings.json` (type, empreinte, chemin du modèle, coût) et tout autre paramètre de jeu externalisé, jamais en dur dans le code de logique.
4. **Pont scène ↔ état** — un module qui traduit les changements d'état (bâtiment posé, parcelle achetée) en objets Three.js, dans un seul sens. L'état ne doit jamais dépendre du rendu.
5. **UI** — panneaux, menu de construction, HUD. Consomme l'état via une interface propre (events ou store), ne manipule jamais directement la scène Three.js.

Documente ces frontières dans un `ARCHITECTURE.md` court à la racine (comme pour CMR) : qui dépend de quoi, et surtout ce qui NE doit PAS dépendre de quoi.

## Qualité de code attendue
- Types stricts si TypeScript (à privilégier pour un projet de cette taille).
- Fonctions courtes, noms explicites, pas de logique métier planquée dans des handlers d'événements DOM.
- [PRÉCISION À VENIR — "ponytail" à clarifier]

## Setup
- Vite + npm, `three` en dépendance npm.
- Imports addons depuis `three/examples/jsm/...` (`GLTFLoader`, `EffectComposer`, `UnrealBloomPass`, `RenderPass`).
- Caméra orbitale custom (pas d'`OrbitControls` officiel) — reprendre la logique du prototype.

## Système de grille (remplace le placement libre du prototype)
- Grille de départ 12×12 cases, taille de case = 4 unités.
- Extension uniquement par achat de parcelles (budget), coût croissant par palier.
- Empreintes par type de bâtiment dans `buildings.json` (voir GDD section 12.2).
- Placement : snap grille, vérifie que toutes les cases de l'empreinte sont libres et possédées.
- Fantôme de placement : empreinte complète en surbrillance case par case (vert/rouge).
- Zones non possédées : visuellement distinctes, indicateur d'achat au survol.

## Assets (Quaternius)
Voir `BRIEF_CLAUDE_CODE.md` section Assets pour le détail des niveaux d'adaptation (recoloration runtime, composition de pièces modulaires, redimensionnement, effets runtime, édition Blender optionnelle si besoin).

## Étapes attendues
1. Scaffold Vite + structure de dossiers reflétant les couches ci-dessus.
2. `ARCHITECTURE.md`.
3. Terrain + caméra orbitale fonctionnels (sans bâtiments).
4. Système de grille + placement avec primitives de substitution.
5. Intégration des premiers modèles Quaternius triés/adaptés.
6. Post-processing (bloom minimal).

Check-in avec moi après l'étape 3 avant de continuer — je veux valider la sensation de la caméra avant qu'on construise dessus.
