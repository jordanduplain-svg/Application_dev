# Orbite — Journal d'avancement

Tycoon spatial 3D (Vite + TypeScript + Three.js). Voir `files/GDD_Fusees.md` (design) et `ARCHITECTURE.md` (frontières des couches).

## Fait (10–11/07/2026)

### Étape 1-2 — Scaffold & architecture
- Projet Vite + TS strict, `three` en npm (pas de CDN).
- 5 couches à dépendances à sens unique : `render/` (Three.js pur), `state/` (pur TS, testable sans DOM), `data/` (config JSON), `bridge/` (état → scène), `ui/` (DOM, jamais la scène).

### Étape 3 — Terrain + caméra
- Caméra orbitale custom (`orbitCamera.ts`) : clic gauche rotation, clic droit pan, molette zoom, amortissement lerp. Même logique theta/phi/distance que le prototype `files/interface_3d.html`.
- Sol graphite, brouillard, lumières ambre/cyan, envMap `RoomEnvironment` (sans lui les matériaux métalliques glTF rendent noir).

### Étape 4 — Grille & placement (GDD section 12, verrouillée)
- Monde 36×36 cases (case = 4 unités), 9×9 parcelles de 4×4 cases, départ 12×12 (3×3 parcelles centrales).
- Achat de parcelles : **adjacence obligatoire**, prix **×1,4 à chaque achat** (base 400 ◈) — GDD 12.1.
- Placement : snap grille, fantôme vert/rouge case par case, **rotation touche R**, vérification cases libres + possédées + budget.
- HUD : budget, menu construction (boutons grisés si trop cher), tooltip d'achat de parcelle ("non adjacente" / "fonds insuffisants" / prix).
- État pur testé : `npm test` (node --experimental-strip-types, zéro framework, 21 asserts).

### Étape 5 — Modèles 3D
- Pipeline : `node scripts/convert-models.mjs` convertit les OBJ (pack Ultimate Modular Sci-Fi) en `.glb` via obj2gltf → `public/models/`. Les glTF natifs (Sci-Fi Essentials, Ultimate Space Kit) sont copiés tels quels.
- Runtime : GLTFLoader + cache, mise à l'échelle automatique sur l'empreinte avec plafond de hauteur (2× la hauteur nominale), teinte optionnelle (`tint`), primitive de substitution si modèle absent ou en échec.

### Alignement GDD 12.2 — Les 10 bâtiments officiels

| Bâtiment | Empreinte | Coût* | Modèle |
|---|---|---|---|
| Entrepôt logistique | 2×2 | 600 | Props_ContainerFull |
| Pas de tir · Petit | 2×2 | 800 | RoofTile_Plate |
| Centre de formation | 2×2 | 900 | Props_Capsule |
| Usine · Propulsion | 2×2 | 1000 | House_Long (Space Kit) |
| Usine · Structures | 2×2 | 1000 | House_Open (Space Kit) |
| Usine · Avionique | 2×2 | 1000 | House_Cylinder (Space Kit) |
| Labo R&D | 2×2 | 1200 | GeodesicDome (Space Kit) |
| Centre de contrôle | 2×2 | 1500 | Prop_SatelliteDish (Essentials) |
| Pas de tir · Moyen | 3×3 | 2000 | RoofTile_Plate2 |
| Pas de tir · Lourd | 4×4 | 4500 | RoofTile_Details |

\* Coûts inventés — le GDD n'en donne pas. Budget de départ 3000 ◈ (≈ 3 bâtiments) : à équilibrer.

## Assets disponibles

- `Ultimate Modular Sci-Fi …/` — 91 modèles OBJ/FBX/Blend (intérieur modulaire, props). Conversion .glb nécessaire.
- `Sci-Fi Essentials Kit[Standard]/` — props FPS + **Prop_SatelliteDish** (glTF + textures PBR).
- `Ultimate Space Kit …/` — 92 modèles glTF autonomes : bâtiments House_*, GeodesicDome, panneaux solaires, rovers, astronautes, planètes.

### Étape 6 — Post-processing
- Bloom minimal : EffectComposer + RenderPass + UnrealBloomPass (force 0,35, rayon 0,4, seuil 0,85 — seuls les matériaux très lumineux/émissifs brillent). Redimensionné avec le viewport.

### Cœur systémique (GDD section 6) — `state/launch.ts`
- **Fiabilité** (`SpaceProgram.reliability`) : jauge décomposée — produit des composants × risque par jonction inter-étages (0,97^n) × maturité (vol inaugural ×0,95 → heritage +1,5 %/succès plafonné à +10 %) × marge (presser 0,93 / standard 1 / roder 1,04), total plafonné à 0,99.
- **Lancement** (`launch`) : RNG injectable ; échec → 55 % partiel / 45 % total ; la cause journalisée = le facteur le plus faible de la jauge.
- **Réputation** : deux axes 0-100 (étatique / commerciale), gains lents (+2/+3) pertes fortes (-10/-15 en échec total), pondérées par la publicité (discret ×0,25). Journal des échecs consultable (`failures`).
- Coefficients inventés (GDD n'en donne pas) : à équilibrer. Blacklist par client reportée au système de contrats (GDD 7).
- Testé : `npm test` lance aussi `launch.test.ts`.

### Panneau de lancement — `ui/launchPanel.ts`
- Bouton 🚀 en haut à droite ; verrouillé tant qu'aucun `pad_*` n'est construit.
- Choix design (2 fusées dans `data/rockets.json` : Kestrel 1 à 2 étages, Albatros à 3), marge (presser −50 ◈ / standard / roder +150 ◈), publicité (contrat public payé vs essai interne discret).
- Jauge décomposée (composants / jonctions / maturité / marge) + fiabilité totale, barres de réputation, journal des 5 derniers échecs.
- Boucle économique : lancement débité, paiement crédité si succès (moitié si échec partiel, rien si total ou essai interne). `GameState` gagne `spend`/`credit`.
- Vérifié en jeu : vol inaugural 83,2 % → 92,9 % après 4 succès (heritage), réputation 50 → 58/62.

### Arbre tech (GDD section 3, MVP) — `state/tech.ts`
- 3 branches (`data/tech.json`) : Propulsion liquide, Structures & Réservoirs, Avionique & Guidage — 3 paliers chacune (100/250/500 PR), recherche séquentielle.
- Effet : chaque palier réduit de 15 % la probabilité de panne des composants tagués de la branche (`applyTech`, sans mutation). Les composants de `rockets.json` sont tagués `branch`.
- PR gagnés en lançant (40 succès / 15 partiel / 5 total), ×1,5 par Labo R&D construit.
- Prérequis de design : l'Albatros exige Propulsion 1 + Structures 1 (verrou 🔒 dans le sélecteur).
- Panneau 🔬 Recherche (`ui/researchPanel.ts`) : PR, paliers acquis/suivants par branche ; exclusif avec le panneau 🚀.
- Testé (`tech.test.ts`) + vérifié en jeu : Kestrel 83,2 % → 95,2 % (heritage + 2 techs), Albatros déverrouillé après recherche, échec journalisé avec cause.
- Simplifications MVP : coût double du GDD (PR + points de branche) réduit aux PR ; pas d'obsolescence douce.

### Contrats (GDD section 7) — `state/contracts.ts`
- 6 contrats dans `data/contracts.json` (étatiques et privés), filtrés par confiance commerciale (GDD 6.2 : premium à 55/65), taille de fusée (`minStages`) et disponibilité client.
- Un vol = essai interne (discret, non payé) ou exécution du contrat accepté (public). Le paiement fixe des designs a été supprimé — seuls les contrats paient.
- Règlement : succès plein + bonus rép. (étatique +4 domestique, privé +2 commercial) ; partiel = moitié ; échec total = clause de pénalité privée + **blacklist client 3 vols** (GDD 6.3).
- Anti-farming : client servi indisponible 2 vols après un succès — sauf « Capsule de démonstration » (`repeatable`, filet de récupération GDD 6.2, mais blacklistable).
- Panneau 📋 Contrats (`ui/contractsPanel.ts`), 3 panneaux de droite mutuellement exclusifs.
- Reporté : financement étatique fixe et concurrence IA (exigent un système de temps).

### Équilibrage — `scripts/balance-sim.ts`
- Simulation : 500 parties × 40 vols, stratégie naïve, RNG déterministe (`node --experimental-strip-types scripts/balance-sim.ts`).
- Valeurs retenues : budget 3500 ◈, Kestrel 450 ◈, Albatros 800 ◈, labo 1000 ◈, PR 25/10/5, rép. succès +1/+2, sonde 1500 ◈, constellation 2600 ◈, démo 550 ◈ répétable.
- Résultats : faillites 1,4 % (pad seul) / 3,4 % (pad+labo), Albatros au vol médian 9 / 7 (le labo paie), confiance médiane 88 (plus de plafonnement à 100), min de trésorerie médian 2700 / 1700 ◈.
- Le solde final (~34 000 ◈ au vol 40) attend des gouffres à argent (multi-sites, gros pads, assemblage) — pas un problème de contrats.
- Note : la sim ne joue PAS les événements (choix joueur) ni l'assurance ; c'est le socle économique de base, ces couches ajoutent variance et dépenses par-dessus.

### Événements (GDD 5) — `state/events.ts` + `ui/eventModal.ts`
- 6 événements (`data/events.json`), 4 catégories, chaque choix à double tranchant (effets déclaratifs : budget ferme / %, réputation, PR, modificateur de fiabilité transitoire).
- Sélection pure à RNG injectable : probabilité croissante avec les vols calmes (12 %/vol, plafond 60 %), pondérée par l'échec récent. La commission d'enquête n'apparaît qu'après un échec.
- Modal bloquant après chaque vol. `SpaceProgram` gagne un modificateur de fiabilité sur N vols (`applyReliabilityMod`).

### Assurance (GDD 6.2) — `state/launch.ts` (`insurancePremium`/`insurancePayout`)
- Case à cocher dans le panneau de lancement. Prime = 15 % du coût à confiance 100 → 50 % à confiance 0 (chère quand on en a le plus besoin). Rembourse le véhicule si échec (plein si total, moitié si partiel).

### Assemblage de fusées (GDD 2/3) — `state/assembly.ts` + `ui/assemblyPanel.ts`
- Catalogue de composants (`data/components.json`) : moteurs/réservoirs/avionique en 3 paliers + coiffe, débloqués par l'arbre tech (`available`).
- Atelier 🛠️ : 1-3 étages, moteur+réservoir par étage, avionique + coiffe optionnelle sur l'étage supérieur ; aperçu fiabilité/coût en direct ; « Assembler » pousse le design au panneau de lancement (`LaunchPanel.addDesign`).
- `buildDesign` : coût = composants + 60 ◈/étage ; id déterministe (heritage partagé) ; composants tagués `branch` (profitent de `applyTech`). Testé (`assembly.test.ts`).

### Environnement & couleurs — `render/sceneRoot.ts` + `render/decor.ts` + `bridge/sceneBridge.ts`
- Ciel dégradé (indigo → horizon violet-ambré) via CanvasTexture ; brouillard réchauffé ; sol brun-mauve.
- Parcelles possédées teintées teal.
- **Socle des bâtiments revu** : plateforme métallique sombre + liseré coloré émissif par type (capté par le bloom), et le bâtiment se pose dessus (`BASE_HEIGHT`). Remplace la dalle colorée pleine jugée criarde.
- **Décor (`render/decor.ts`)** : kit Environment Quaternius (déjà dans le repo, non exploité jusqu'ici). 26 glTF auto-suffisants copiés dans `public/models/env/`. Dispersion déterministe (graine fixe) d'un anneau de paysage (rochers, végétation stylisée) hors du monde 36×36, + 4 planètes réparties dans le ciel. Purement visuel, hors grille (le raycaster ne touche que le plan mathématique).
- Assets source : `Ultimate Space Kit …/Environment/GLTF` (rochers, arbres, buissons, planètes, panneaux solaires — tous CC0, même style que les bâtiments).

### Lisibilité & filet éco — `ui/objectivePanel.ts` + passe rendu
- **Barre d'objectif** (haut-centre) : guide toujours vers la prochaine action (① pas de tir → ② accepter un contrat → ③ lancer sous contrat). Résout l'opacité de la boucle éco signalée en test joueur.
- **Avance d'État** (anti-blocage) : bouton visible seulement quand le budget passe sous la fusée la moins chère ; +1200 ◈ contre −5 rép. étatique, cooldown 4 vols. Empêche le blocage par sur-dépense (ex. Centre de contrôle acheté trop tôt). GDD 7 (financement étatique).
- **Passe rendu « juice »** : tone mapping ACES (expo 1,25), lumières montées (soleil 2,6, hémisphère 1,1), `environmentIntensity` 0,85, sol sable chaud, grille discrète (opacité 0,15), parcelles dalle béton, décor densifié (220). Corrige le rendu plat jugé « raw ».

### Retour joueur — « pas fun », lancement abstrait (2026-07-11)
- **Décollage animé (`render/launchFx.ts`)** : fusée procédurale (corps + coiffe + anneaux d'étages + ailerons + tuyère émissive), hauteur ∝ nombre d'étages du design. Décolle du pas de tir réel (`SceneBridge.padPosition`), accélère et disparaît (succès), culbute (partiel), ou explose (échec total, flash émissif nettoyé). Relie carte/bâtiments/lancement. Piloté par `SceneRoot.start(onFrame)`. Logique validée par simulation (dt injecté) — non observable dans le navigateur MCP (pas de rAF), OK dans la vraie fenêtre.
- **Recherche lisible** : chaque palier suivant affiche « 🔒 Il te manque N PR » (pourquoi grisé) et « Débloque : <composants> » (lien vers l'assemblage). `ResearchPanel` reçoit le catalogue de composants.
- **Notifs non collantes** : barre d'objectif refermable (× → pastille 🎯, se rouvre à chaque nouvelle étape) ; résultat de lancement effacé après 7 s.

### Effets des bâtiments (GDD 8) — `state/facilities.ts`
Avant : seuls pad (lancer) et labo (+RP) servaient à quelque chose. Maintenant **chaque bâtiment a un effet mécanique**, affiché au menu de construction (`effect` dans buildings.json) :
- **Entrepôt** : −6 % coût des fusées/entrepôt (plancher 0,7×).
- **Pas de tir Petit/Moyen/Lourd** : plafonne la taille lançable à 2/3/5 étages (`padCapacity`). Un design trop grand est bloqué avec message explicite. GDD : pads par taille.
- **Usine Propulsion/Structures/Avionique** : −15 % de risque sur les composants de SA branche (`applyFacilities`, comme une usine = palier tech supplémentaire).
- **Centre de formation** : +2 % fiabilité globale/unité. **Centre de contrôle** : +3 %/unité (plafond combiné ×1,12).
- **Labo R&D** : +50 % PR/labo (`rpFactor`).
- Câblé dans `launchPanel` (coût, fiabilité via `reliability(..., facilityMult)` + `applyFacilities`, gating pad, RP) et aperçu `assemblyPanel`. Testé (`facilities.test.ts`, 7e suite).
- Caveat : `balance-sim.ts` ne modélise pas encore les bâtiments/pads (baseline éco pure) — à mettre à jour pour intégrer le gating.

## Reste à faire

- **Pas de tir spécialisés** : tout pad débloque tout design pour l'instant (GDD : pads par taille de fusée).
- **GDD 3.2 complet** : points de branche spécialisés, nœuds de convergence, obsolescence douce.
- **Concurrence IA & financement étatique** (GDD 7) et **échelle de temps** (GDD 13) : plusieurs systèmes en dépendent.
- **Tint réel des modèles** : les bâtiments gardent leurs textures glTF ; seul le socle est coloré. Passer `tint:true` si un vrai code couleur des volumes est voulu.
- Questions ouvertes GDD section 13 (échelle de temps, vue lancement, multi-site, sandbox).

## Commandes

- `npm run dev` — serveur de dev (port 5173)
- `npm test` — auto-vérification de l'état du jeu
- `node scripts/convert-models.mjs` — (re)convertir les modèles référencés par `buildings.json`
