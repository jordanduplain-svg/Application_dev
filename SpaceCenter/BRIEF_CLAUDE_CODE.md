# Brief de démarrage — Orbite (prototype 3D)

## Contexte
Portage d'un prototype HTML/Three.js (CDN) vers un vrai projet Vite. Voir fichiers joints :
- `interface_3d.html` — référence de structure/logique (caméra orbitale, panneau de détails, placement) — À NE PAS copier tel quel, juste s'en inspirer.
- `GDD_Fusees.md` — contexte thématique complet, notamment section 12 (système de grille, verrouillé).

## Setup demandé
1. Projet **Vite + npm**, `three` en dépendance npm (pas de CDN).
2. Imports propres depuis les addons : `three/examples/jsm/loaders/GLTFLoader`, `three/examples/jsm/postprocessing/EffectComposer`, `UnrealBloomPass`, `RenderPass`.
3. Caméra orbitale custom (rotation clic gauche, pan clic droit, zoom molette) — reprendre la logique du prototype, pas besoin d'`OrbitControls` officiel.

## Système de grille (remplace le placement libre du prototype)
- Grille de départ **12×12 cases**, taille de case = 4 unités.
- Extension uniquement par **achat de parcelles** (budget), coût croissant par palier.
- Chaque type de bâtiment a une empreinte en cases (voir GDD section 12.2) définie dans un fichier `buildings.json` unique, avec le chemin vers son modèle `.glb`.
- Placement : snap sur la grille, vérifie que toutes les cases de l'empreinte sont libres et possédées, fantôme affiche l'empreinte complète (vert/rouge par case).
- Zones non possédées visuellement distinctes (désaturées) avec indicateur d'achat au survol.

## Assets
- **Source principale : Quaternius** (https://quaternius.com / https://quaternius.itch.io), CC0, glTF natif — pas de conversion nécessaire. Packs pertinents : **Sci-Fi Essentials Kit**, **Modular Sci-Fi MegaKit**, pack **Space**.
- Fichiers `.glb`/`.gltf` à placer dans `/public/models/`, référencés dans `buildings.json`.
- Si aucun modèle ne correspond exactement à un type de bâtiment, garder temporairement une primitive Three.js de substitution (même logique que le prototype) plutôt que bloquer l'avancement.

### Adaptation des assets Quaternius au thème du jeu
Les kits sont modulaires par conception — privilégier la recomposition/recoloration plutôt que chercher des modèles "parfaits" tout faits :
1. **Recoloration runtime** : override `MeshStandardMaterial.color` sur les meshes importés pour matcher la palette du prototype (ambre `#F2A65A` / cyan `#4FD1C5` / graphite). Le plus rentable, aucune dépendance externe.
2. **Composition de pièces** : assembler plusieurs éléments modulaires du kit (base + antenne + panneaux + caisses, etc.) en un seul bâtiment composite par type — usage prévu du kit, pas de bidouille.
3. **Redimensionnement** : scale/stretch des pièces pour matcher les empreintes de grille (section 12.2 du GDD).
4. **Effets runtime** par-dessus le modèle importé (émissif clignotant, glow) — même logique que sur les primitives du prototype.
5. **Édition de mesh réelle (optionnel, si Blender est installé)** : script Python `bpy` piloté en headless (`blender --background --python script.py`) pour fusionner/dupliquer/varier des meshes et réexporter en `.glb`. À réserver aux cas où la recomposition simple ne suffit pas.

## Docs de référence
- Three.js API : https://threejs.org/docs/
- Exemples officiels (post-processing, loaders) : https://threejs.org/examples/
- GLTFLoader : https://threejs.org/docs/#examples/en/loaders/GLTFLoader

## Modèle recommandé
Claude Sonnet 5, effort `xhigh` — tâche d'implémentation avec patterns connus, pas de conception architecturale ambiguë.
