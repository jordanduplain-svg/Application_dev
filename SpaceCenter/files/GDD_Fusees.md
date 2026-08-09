# GAME DESIGN DOCUMENT — *Projet Orbite* (nom de code)
### Un tycoon spatial stratégique : R&D, industrie, diplomatie, réputation

---

## 1. PITCH

Tu diriges un programme spatial (étatique ou privé) depuis les années 1950 jusqu'au New Space contemporain. Tu recherches des technologies, construis des fusées composant par composant, gères une base industrielle sur une carte, négocies des contrats avec des États et des acteurs privés, et bâtis (ou détruis) ta réputation au fil des lancements — réussis ou explosés en direct devant tes clients.

**Pitch en une phrase** : *Kerbal Space Program rencontre Rimworld et Anno*, avec la rigueur d'un vrai arbre technologique aérospatial et un système de confiance/fiabilité qui a une mémoire.

**Piliers de design** :
1. **Authenticité technique** sans être un simulateur de vol — la physique est crédible, pas simulée à la Kerbal.
2. **Conséquences persistantes** — chaque échec laisse une trace (réputation, fiabilité, lore).
3. **Asymétrie géopolitique** — chaque pays joue différemment, pas juste des skins.
4. **Lisibilité malgré la complexité** — UI moderne, progressive disclosure, jamais un mur de chiffres.

---

## 2. BOUCLE DE GAMEPLAY

**Boucle courte (session)** : Recherche tech → Design de fusée (assemblage composants) → Estimation fiabilité → Lancement → Résultat (succès/échec partiel/échec total) → Impact réputation/fiabilité/finances → Nouveaux contrats débloqués.

**Boucle moyenne (partie)** : Choix de pays → Construction de la base industrielle sur la carte → Montée en gamme technologique par ère → Concurrence avec 3-5 acteurs IA (autres pays + privés) → Événements politiques qui redistribuent les cartes → Objectifs d'ère (orbite basse → Lune → SSTO → Mars).

**Boucle longue (méta)** : Le lore et l'historique de tes échecs/succès génèrent une "histoire" unique par partie, consultable dans une archive/journal — un peu comme un almanach qui raconte TON histoire spatiale alternative.

---

## 3. ARBRE TECHNOLOGIQUE

Objectif : complet, lisible, avec interdépendances fortes. Découpé en **10 branches**, chacune avec 5-8 paliers (Ère 1: Pionnier / Ère 2: Guerre froide / Ère 3: Navette / Ère 4: New Space / Ère 5: Avancé-spéculatif).

### 3.1 Branches principales

| Branche | Contenu type | Débloque |
|---|---|---|
| **Propulsion (liquide)** | Moteurs kérosène/LOX, hypergoliques, hydrolox, méthalox | Étages, ISP, poussée |
| **Propulsion (solide)** | Boosters d'appoint, missiles dérivés | Coûts réduits, moins fiable |
| **Propulsion avancée** | Statoréacteurs, nucléaire thermique (NERVA-like), ionique/électrique | Missions longue distance, satellites |
| **Structures & Réservoirs** | Alliages Al, Al-Li, composites carbone, réservoirs communs | Masse à sec, capacité ergols |
| **Avionique & Guidage** | Gyroscopes, inertiel, GPS/GNSS, informatique embarquée, IA de vol | Précision orbitale, autonomie |
| **Aérodynamique** | Coiffes, ailerons de grid, contrôle vectoriel de poussée | Stabilité, réentrée |
| **Matériaux & Thermique** | Boucliers thermiques ablatifs, PICA-X-like, tuiles réutilisables | Réentrée, réutilisabilité |
| **Récupération & Réutilisabilité** | Parachutes, atterrissage propulsif, ailes (spaceplane), SSTO | Réduction coût/lancement |
| **Payload & Satellites** | Charges utiles, télécoms, observation, stations, habitats | Types de contrats disponibles |
| **Production Industrielle** | Chaînes d'assemblage, automatisation usine, qualité composants | Vitesse de build, coûts, fiabilité de base |

### 3.2 Logique de déblocage
- **Graduel et ramifié** : chaque branche démarre visible mais grisée ; les nœuds suivants ne s'éclairent qu'après prérequis (tech + parfois un jalon de mission réussie).
- **Coût double** : Points de Recherche (génériques) + Points de branche (spécialisés, gagnés en faisant des missions dans ce domaine — ex: tu gagnes des points "Récupération" en réussissant des atterrissages, pas juste en dépensant des RP).
- **Nœuds de convergence** : certains nœuds avancés (SSTO, retour habité) nécessitent des prérequis dans 3-4 branches différentes simultanément — ça force une vraie planification stratégique, pas un rush linéaire.
- **Obsolescence douce** : une tech ancienne reste utilisable mais son "score fiabilité de base" décroît avec le temps si tu ne la mets pas à jour (cf. section 6).

---

## 4. PAYS JOUABLES — avantages / inconvénients

Objectif : asymétrie réelle, pas cosmétique. Voici une proposition de base (tu peux trancher/ajuster) :

| Pays | Avantage | Inconvénient | Identité |
|---|---|---|---|
| **URSS/Russie** | Recherche rapide et peu chère, boosters solides/hypergoliques excellents | Fiabilité de base plus basse, opinion publique peu impactante (donc moins de malus réputation domestique, mais aussi moins de bonus) | Quantité > qualité, "brutalisme efficace" |
| **USA** | Budget R&D élevé, excellent en avionique/informatique | Coûts de production élevés, opinion publique très volatile (un échec médiatisé fait très mal) | Prestige et pression médiatique |
| **France** | Bonus en propulsion cryogénique et coopération internationale (contrats multi-pays facilités) | Budget de base plus faible, dépend fortement des contrats export | Ingénierie de niche, diplomatie spatiale |
| **Allemagne** | Bonus qualité composants (fiabilité de base +), industrie précise | R&D plus lente, aversion au risque politique (événements négatifs pèsent plus lourd) | Précision, lenteur assumée |
| **Chine** | Scalabilité industrielle énorme (coût par unité baisse vite avec le volume), rattrapage tech accéléré en fin de partie | Débute avec un désavantage tech de départ, accès limité à certains marchés export au début | Montée en puissance, long jeu |
| **Royaume-Uni** | Excellent en électronique/payload/satellites | Programme propulsion faible historiquement (malus recherche propulsion) | Spécialiste orbital, dépend de partenaires |
| **Japon** | Fiabilité de composants très élevée, bonus qualité constante | Croissance lente, budget domestique contraint | Rigueur, zéro tolérance à l'échec |
| **Inde** | Coût de lancement le plus bas du jeu, excellent rapport qualité/prix | Tech de pointe plus lente à obtenir, avionique en retard | Efficience, "space on a budget" |
| **Acteur privé (générique, jouable en fin de campagne libre)** | Pas de contraintes diplomatiques, contrats flexibles avec n'importe quel pays, itération ultra-rapide | Pas de financement étatique garanti — dépend à 100% des contrats et investisseurs, risque de faillite | New Space, disruption |

**Mécanique transversale** : chaque pays a une "doctrine" qui influence aussi les **événements aléatoires** (ex: l'URSS a plus d'événements "purge politique / changement de priorité soudain", les USA plus d'événements "commission d'enquête publique après un échec").

---

## 5. ÉVÉNEMENTS POLITIQUES & SCIENTIFIQUES

**Déclenchement** : aléatoire mais pondéré par contexte — c'est le point clé pour que ça reste "cohérent avec la progression" :
- Poids influencé par : ère technologique actuelle, doctrine du pays, réputation actuelle, tensions géopolitiques simulées (course à l'espace binaire ou multipolaire selon l'ère), et historique récent (un échec récent augmente la probabilité d'un événement "commission d'enquête").

**Catégories d'événements** :
1. **Politiques** — changement de gouvernement (révision budget ±), traité international (ex: interdiction de certains essais), embargo technologique ciblant un pays concurrent ou toi-même, crise diplomatique ouvrant/fermant des marchés de contrats.
2. **Scientifiques** — découverte externe accélérant une branche (ex: quelqu'un d'autre publie une avancée matériaux, tu peux la "rattraper" moins cher), accident chez un concurrent qui redistribue des contrats vers toi, percée récupérable via espionnage industriel (avec risque réputation si détecté).
3. **Économiques** — crise budgétaire globale, boom de la demande satellite (télécoms/observation), fluctuation du prix des matériaux.
4. **Internes** — grève dans une usine (perte de production temporaire), démission d'un ingénieur clé (perte de bonus temporaire sur une branche), scandale de sécurité.

**Effets** : toujours à double tranchant — jamais un événement purement positif ou négatif sans choix. Le joueur a généralement 2-3 réponses possibles (ex: "financer une enquête indépendante" vs "étouffer l'affaire" après un échec) avec des conséquences différées sur réputation/fiabilité/lore.

---

## 6. FIABILITÉ, RÉPUTATION, ÉCHECS

C'est le cœur systémique du jeu — trois métriques distinctes mais interconnectées.

### 6.1 Fiabilité technique (par fusée, calculée à l'assemblage)
Un **pourcentage de fiabilité** calculé dynamiquement à partir de :
- Fiabilité de base de chaque composant (dépend de la tech, de son ancienneté/obsolescence, du pays qui l'a produit, de la qualité industrielle de l'usine).
- **Interfaces entre étages** : chaque jonction (étage inférieur/supérieur, séparation de coiffe, largage de booster) ajoute un risque propre — plus tu empiles d'étages, plus il y a de points de défaillance (logique et réaliste).
- **Facteur "maturité"** : un design réutilisé plusieurs fois avec succès gagne un bonus de fiabilité cumulatif ("heritage design") ; un design flambant neuf part avec un malus ("vol inaugural").
- **Marge d'ingénierie vs délai** : le joueur peut choisir de "presser" un design (moins de tests, sortie plus rapide, fiabilité réduite) ou de "roder" (tests supplémentaires, plus cher/lent, fiabilité augmentée) — un vrai dilemme temps/argent/risque.

Affichage : une **jauge décomposée** (pas juste un chiffre unique) montrant la contribution de chaque sous-système, pour que le joueur comprenne où investir.

### 6.2 Réputation / Confiance commerciale (globale, évolutive)
- Deux axes séparés : **Réputation étatique** (tes propres autorités/opinion publique domestique) et **Confiance internationale/commerciale** (clients privés et étatiques étrangers).
- Un échec fait plus mal si le contrat était public/médiatisé ; un échec discret (essai interne) pèse peu.
- La confiance commerciale conditionne : le prix que les clients acceptent de payer, l'accès à certains contrats premium, la disponibilité d'assurances/réassurance (mécanique optionnelle : plus ta confiance est basse, plus l'assurance de lancement coûte cher).
- Récupération lente et volontaire : missions "de démonstration" à faible risque, transparence sur les enquêtes d'échec, partenariats avec des pays à forte réputation.

### 6.3 Conséquences d'un échec
- **Échec partiel** (mise en orbite ratée, payload endommagé) : malus modéré, perte partielle du paiement contrat.
- **Échec total** (explosion) : malus réputation fort, perte de matériel, possible événement "enquête" déclenché, et **impact lore** — l'échec est journalisé avec un nom, une cause identifiée (ou non — enquête à mener), et reste consultable.
- **Blacklist temporaire** : en dessous d'un seuil de confiance avec un pays/client donné, ce marché se ferme temporairement (pas définitivement, sauf cas extrême).

---

## 7. ÉCONOMIE & CONTRATS

- **Deux flux de revenus** : financement étatique (fixe, dépend du budget national simulé, soumis aux événements politiques) + contrats (missions à la commande, publics et privés).
- **Missions étatiques** : objectifs de prestige national (premier satellite, premier homme en orbite, etc.), moins rémunérateurs mais debloquent des bonus de réputation domestique et parfois des sauts technologiques gratuits.
- **Acteurs privés** (par pays, avec leurs propres besoins) : télécoms, observation Terre, tourisme spatial en fin de partie — plus rémunérateurs mais exigeants sur la fiabilité (clauses de pénalité en cas d'échec).
- **Concurrence IA crédible** : 3-5 agences concurrentes qui ont leur propre arbre tech, leur propre réputation, et qui peuvent te voler des contrats si tu es trop cher/peu fiable. Elles réagissent à tes échecs (récupèrent tes contrats perdus) et à tes succès (accélèrent leur propre R&D pour rattraper).

---

## 8. CARTE & BÂTIMENTS

- Carte nationale (ou multi-sites en fin de partie) avec emplacements pour : **pas de tir** (plusieurs, spécialisés par taille de fusée), **usines de composants** (par branche tech), **centre de contrôle/avionique**, **labo de R&D**, **entrepôt logistique**, **centre de formation** (personnel), plus tard **site de récupération** (mer/terre pour les boosters réutilisables).
- Contraintes géographiques crédibles : proximité équateur = bonus delta-v gratuit, proximité côte = récupération en mer facilitée, zones sismiques = malus fiabilité usine.
- Logistique visible : les composants doivent être transportés entre usine et pas de tir — goulots d'étranglement gérables (améliorer routes/rail) plutôt que juste un chiffre abstrait.

---

## 9. LORE

- Un **journal d'agence** généré dynamiquement : chaque lancement, échec, événement politique s'inscrit dans une chronologie narrative consultable (façon almanach/wiki interne).
- Chaque échec majeur reçoit un nom de code et une "fiche d'incident" — enquête, cause probable, mesures correctives — que le joueur peut retrouver plus tard, ce qui donne une vraie mémoire au monde du jeu.
- Fiches biographiques légères pour des ingénieurs/directeurs clés recrutables (bonus de branche), avec un historique qui évolue (un ingénieur peut devenir "légendaire" après plusieurs succès, ou être écarté après un scandale).
- Ambiance inspirée de l'histoire spatiale réelle sans être un reskin 1:1 — univers alternatif crédible, un peu comme Bureau d'Études pour l'aviation.

---

## 10. DIRECTION ARTISTIQUE & UI

- **Vue carte** : style illustré semi-stylisé (pas photoréaliste), avec animation d'ambiance sur le site (fumée d'usine, activité du pas de tir, météo dynamique) — cohérent avec ton approche "diorama vivant" sur Bureau d'Études.
- **Vue assemblage fusée** : interface modulaire type "exploded view" avec code couleur par branche tech, feedback visuel immédiat de la fiabilité par section.
- **Lancement** : séquence cinématique courte mais dynamique (caméra, effets), pas un simulateur de vol complet — l'enjeu dramatique doit venir du **suspense du résultat**, pas du pilotage.
- **UI générale** : moderne, sombre avec accents par pays/faction, progressive disclosure (les nouveaux joueurs ne voient pas tout l'arbre d'un coup), dashboards contextuels plutôt que menus empilés.

---

## 11. PROPOSITION TECHNIQUE (aligné avec ton stack)

- **Moteur** : Godot 4 (cohérent avec Bureau d'Études), 2D pour carte/UI, éventuellement 2.5D pour la vue assemblage fusée.
- **Architecture données** : arbre tech et composants définis en Resources/JSON externes (facilement extensible sans recompiler), simulation de fiabilité en système découplé (testable indépendamment de l'UI).
- **Scope MVP réaliste** : 1 pays jouable complet, 3 branches tech (Propulsion liquide, Structures, Avionique), système fiabilité fonctionnel, 1 concurrent IA simple, boucle contrat→lancement→conséquence complète. Le reste (10 pays, lore complet, tous les événements) vient en itérations post-MVP.

---

## 12. SYSTÈME DE GRILLE DE CONSTRUCTION

*Décision verrouillée le 10/07/2026.*

Le placement libre est remplacé par une **grille limitée** — la gestion de l'espace devient une vraie contrainte stratégique, pas un détail cosmétique.

### 12.1 Paramètres
- **Grille de départ** : 12×12 cases.
- **Taille de case** : 4 unités (cohérent avec l'échelle du prototype 3D — un pas de tir moyen occupe environ 3 cases de large).
- **Extension** : uniquement via **achat de parcelles** contre budget. Pas de prérequis technologique — un joueur riche peut s'étendre vite, un joueur pauvre reste à l'étroit même en fin de partie. Coût croissant par palier (ex : bloc de 4×4 cases adjacent, prix multiplié par ~1,4 à chaque achat) pour éviter qu'un joueur en surplus budgétaire n'annule complètement la contrainte.

### 12.2 Empreintes des bâtiments (en cases)

| Bâtiment | Empreinte |
|---|---|
| Pas de tir · Petit | 2×2 |
| Pas de tir · Moyen | 3×3 |
| Pas de tir · Lourd | 4×4 |
| Usine (Propulsion/Structures/Avionique) | 2×2 |
| Labo R&D | 2×2 |
| Entrepôt logistique | 2×2 |
| Centre de contrôle | 2×2 |
| Centre de formation | 2×2 |

*(Ajustable à l'implémentation — sert de point de départ pour équilibrer la pression spatiale dès le grid 12×12.)*

### 12.3 Spécification technique (pour implémentation)
- **Structure de données** : grille 2D, chaque case = `{occupied: bool, buildingId: string|null}`. Une extension de terrain ajoute des cases au même array (offset géré via coordonnées globales, pas des grilles séparées).
- **Placement** : le clic sur le terrain convertit la position monde en coordonnées de case (snap), vérifie que **toutes** les cases de l'empreinte sont libres ET dans une zone possédée, puis pose le bâtiment centré sur son empreinte.
- **Fantôme de placement** : affiche l'empreinte complète en surbrillance case par case (vert = toutes libres, rouge = au moins une case occupée ou hors zone possédée), pas juste un halo autour d'un point.
- **Zones non possédées** : visuellement distinctes (grisées/désaturées, non cliquables pour la construction) avec un indicateur "Acheter cette parcelle — € X" au survol.
- **Modèles préfaits** : chaque type de bâtiment référence un modèle (`.glb`) + son empreinte dans un seul fichier de config (ex. `buildings.json`), pour ajouter facilement de nouveaux bâtiments sans toucher au code de placement.

---

## 13. QUESTIONS OUVERTES POUR TOI

1. Vue tactique du lancement : cinématique scriptée ou un minimum d'interactivité (choix de timing d'allumage, etc.) ?
2. Échelle de temps : temps réel avec vitesse variable (façon Rimworld) ou tour par tour par "campagne/mission" ?
3. Multi-site (plusieurs pas de tir simultanés en fin de partie) — priorité MVP ou post-MVP ?
4. Un mode carrière solo suffit, ou tu vises un mode "sandbox" sans contraintes de pays dès le départ ?

Dis-moi sur quoi tu veux qu'on creuse en premier — je pencherais pour verrouiller le MVP (section 11) et la mécanique de fiabilité (section 6) avant tout, vu que c'est le cœur systémique du jeu.
