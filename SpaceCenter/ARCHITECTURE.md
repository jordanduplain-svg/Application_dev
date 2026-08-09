# Architecture — Orbite

Cinq couches, dépendances à sens unique. On doit pouvoir remplacer un module sans toucher aux autres.

```
UI ──► État du jeu ◄── Pont ──► Rendu (Three.js)
              ▲          ▲
              └── Config (buildings.json, paramètres)
```

| Couche | Dossier | Rôle | Dépend de |
|---|---|---|---|
| Rendu | `src/render/` | Renderer, caméra orbitale, lumières, terrain, boucle | Three.js uniquement |
| État du jeu | `src/state/` | Grille, bâtiments, budget, parcelles. Pur TS, testable sans DOM ni Three.js | Config |
| Config | `src/data/` (+ `buildings.json`) | Empreintes, coûts, chemins de modèles — jamais en dur dans la logique | rien |
| Pont | `src/bridge/` | Traduit les changements d'état en objets Three.js, **sens unique** état → scène | État, Rendu |
| UI | `src/ui/` | Panneaux, menu construction, HUD. Consomme l'état via events/store | État |

## Interdits

- L'**état** n'importe jamais Three.js, le DOM, ni le pont.
- L'**UI** ne touche jamais la scène Three.js directement — tout passe par l'état ; le pont reflète.
- Le **rendu** ne connaît aucune règle de jeu (pas de coût, pas d'empreinte, pas de budget).
- Aucune valeur de gameplay en dur dans le code : tout vient de la config.

## État actuel (étape 5)

Les cinq couches existent :

- `src/render/` — `sceneRoot.ts` (renderer, lumières, terrain), `orbitCamera.ts`
- `src/state/` — `game.ts` (grille, parcelles avec adjacence et prix ×1,4/achat, budget, placement avec rotation) + `game.test.ts` (`npm test`, sans framework)
- `src/data/` — `buildings.json` (grille GDD 12.1 : parcelles 4×4, départ 12×12 ; les 10 bâtiments du GDD 12.2 — coûts encore provisoires, le GDD n'en donne pas)
- `src/bridge/` — `sceneBridge.ts` (tuiles de parcelles, chargement GLB avec cache + mise à l'échelle sur l'empreinte, fantôme avec rotation R, picking souris)
- `src/ui/` — `hud.ts` (budget, menu construction, tooltip d'achat)

Assets : modèles Quaternius convertis OBJ → GLB par `scripts/convert-models.mjs` (obj2gltf) vers `public/models/` ; primitive de substitution si `model` est null ou si le chargement échoue.

Reste : étape 6 (bloom) et itération sur le mapping visuel modèle ↔ bâtiment.
