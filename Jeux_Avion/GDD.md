# BUREAU D'ÉTUDES — Prompt Claude Code v2 (référence unique, remplace la v1)
> Tycoon de conception ET de marché aéronautique. France, 1925-1940.
> Tu conçois des avions par vrais arbitrages d'ingénierie (les perfs ÉMERGENT des choix),
> tu les vends sur un marché vivant contre des rivaux qui vendent aussi, tu recherches,
> tu produis, tu bâtis une réputation — et l'horloge tourne vers mai 1940.
>
> Ce document est LA source de vérité. En cas de conflit avec toute autre instruction, il gagne.
---
# PARTIE I — LE JEU
## 1. Arche & boucle
**1925 → mai 1940.** 1 tick = 1 semaine (~780 ticks, campagne 8-12 h, temps continu pausable ×1/×2/×4).
L'arc : l'âge d'or civil (records, courses, la Ligne) → la crise de 1929 qui assèche le civil →
la bascule militaire post-1933 → l'urgence 1938-40. Tes avions passent des unes des journaux
aux rapports d'état-major.
**Boucle** : observer le marché → concevoir (blueprint) → prototyper/essayer → produire et
fixer un prix (segments civils) ou concourir (records, courses, AO militaires) → encaisser,
recruter, rechercher → le marché et les rivaux répondent → itérer, jusqu'au verdict de mai 1940.
**Vérité du design** : on ne peut pas être partout. Pionnier sur une techno = suiveur sur les
autres. Dominer un segment = en abandonner d'autres aux rivaux. Chaque campagne est une
trajectoire d'entreprise différente.
## 2. Le marché (LE nouveau cœur — modèle exact)
### Segments
**Marchés de volume** (ventes continues, allocation trimestrielle) :
| segment | demande/an (courbe data) | critères pondérés (annoncés en jeu) |
|---|---|---|
| ligne_postale | 18 (1925) → 30 (1930) → 15 (1933) → 10 (1937) | fiabilité .40, autonomie .30, coût .20, vitesse .10 |
| transport_civil | 25 (1925) → 70 (1929) → 20 (1931) → 55 (1937) | coût .30, fiabilité .25, capacité .25, réputation civile .20 |
| export_militaire | 15 (1925) → 35 (1933) → 90 (1937) → 140 (1939) | vitesse .30, armement .25, coût .25, réputation militaire .20 |
**Marchés d'événement** (winner-takes-most, scriptés/datés) : records & raids, courses
(Coupe Deutsch etc.), **AO militaires français** (7 sur la période, dominants après 1933 —
volumes énormes, cahiers des charges contradictoires, mécanique de la v1 conservée).
### Allocation des ventes (sim/market.gd — formules exactes)
Chaque trimestre, pour chaque segment de volume, pour chaque produit au catalogue (joueur ET rivaux) :
```
qualité_s   = Σ_i poids_i × clamp(spec_i / besoin_ref_i(année), 0, 1.4)
f_prix      = (prix_médian_segment / prix)^1.2          # élasticité
f_repu      = 0.7 + 0.6 × réputation_domaine            # réputation 0-1
f_délai     = 1 / (1 + 0.15 × trimestres_carnet)         # délais de livraison dissuadent
attractivité = qualité_s × f_prix × f_repu × f_délai
part_cible_p = attractivité_p² / Σ_q attractivité_q²     # k=2 accentue les écarts
part_réelle_p += (part_cible_p − part_réelle_p) × 0.20   # inertie : clients fidèles, 20%/trim
ventes_p     = round(demande_trim × part_réelle_p), plafonné par capacité de production
   → surplus non livré = carnet de commandes ; au-delà de 4 trimestres d'attente,
     les commandes s'annulent et retournent au marché (les rivaux les ramassent)
```
Un produit vieillit : ses specs deviennent relativement faibles quand `besoin_ref(année)` monte
(le marché exige plus chaque année). Vendre un design de 1927 en 1934, c'est possible — pas cher,
segment postal — mais un rival moderne te grignote. Le joueur DOIT renouveler son catalogue.
### Les rivaux (2 maisons, vivantes mais simples — Ponytail)
"**Blochard**" (agressif : prix bas, volume, suiveur techno rapide) et "**Marane**" (prestige :
qualité, pionnier occasionnel, lent). Chacune :
- catalogue de produits générés par SON niveau techno (mêmes formules avion que le joueur)
- trésorerie simulée en gros : revenus = leurs ventes réelles × marge fixe ; budget R&D = 25%
  des revenus → leur niveau techno progresse (avec seed : parfois Marane sort le pas variable
  avant tout le monde, parfois non — variance entre campagnes)
- renouvellent un produit quand sa part chute sous 15% de leur pic
- Leurs specs sont PUBLIQUES seulement après révélation (Salon, courses, presse) — avant : rumeurs.
- Pas de faillite des rivaux en v2 (simplification assumée : ils encaissent des revers, ralentissent).
### Écran Marché
Parts de marché par segment (barres empilées trimestrielles), volumes, prix médians, ton carnet
de commandes, catalogue rivaux révélé, tendance de demande (flèche + une ligne de contexte :
"La crise assèche les commandes civiles"). C'est le tableau de bord du tycoon — lisible en 5 secondes.
## 3. Production & prix
- **Ateliers de série** : capacité en appareils/trimestre. Paliers d'investissement
  (4 → 10 → 24 /trim). L'agrandissement coûte cher et prend des semaines — anticiper la demande
  fait partie du jeu (agrandir en 1937 pour les commandes de 1938).
- **Prix** : fixé par produit, modifiable à tout moment. Marge = prix − coût_unitaire (formule avion).
  Guerre des prix possible contre Blochard — mais lui a des coûts plus bas.
- **Ligne de produit** : max 4 produits actifs au catalogue (au-delà : retirer un modèle). Ponytail
  ET réalisme (un bureau d'études des années 30 ne tient pas 6 programmes).
## 4. Conception (repris v1 §2, inchangé sur le fond)
Les formules d'émergence (Vmax, charge alaire, maniabilité, plafond, autonomie, fiabilité, coûts,
délais) sont conservées TELLES QUELLES depuis la v1, avec le **test de calibration obligatoire**
sur 3 avions de référence (biplan 1925 ~290 km/h avec moteurs d'époque, transition 1935 ~450,
moderne 1939 ~530 — ajuster la première référence à l'an 1925). S'y ajoutent :
- specs civiles dérivées : **capacité** (passagers/charge ≈ f(masse_vide, formule)) et
  **coût d'exploitation** (≈ conso + fiabilité) pour les segments transport/postal.
- Le MÊME écran blueprint sert tout : concevoir un postal robuste ou un racer, c'est le même
  système avec des curseurs poussés ailleurs. Aucun système parallèle.
## 5. Recherche (remplace les déblocages datés de la v1)
**Arbre de 12 nœuds**, débloqués par affectation d'ingénieurs + argent :
monocoque métal · capot NACA · hélice pas variable · train rentrant · suralimentation ·
volets d'atterrissage · cockpit fermé · instruments de vol sans visibilité · radio embarquée ·
canon-moteur · réservoirs largables · soufflerie interne (méta : révèle Cd0 exact avant proto).
**Mécanique pionnier/suiveur** (le cœur stratégique) : chaque techno a une date "état de l'art
mondial" (data). Chercher AVANT : coût ×3, durée ×2 → mais avantage exclusif réel sur le marché
et les AO tant que les rivaux n'ont pas suivi. Chercher APRÈS : coût ×0.6 (les revues techniques,
les brevets expirés). Les rivaux suivent leur propre rythme (budget R&D simulé + seed).
Être pionnier partout = faillite. Suiveur partout = grignoté. Choisir SES paris = la partie.
## 6. Réputation (le marketing émergent)
Deux jauges 0-1 : **civile** et **militaire**. Alimentées par : records/raids réussis, victoires
en course, livraisons fiables (ou pas : crash en service = −), Salon du Bourget, victoires d'AO.
Actions payantes légères (3 max) : sponsoriser un raid tiers, encart presse aéro, stand premium
au Salon. Un record transatlantique réussi vaut dix campagnes de presse ; un pilote célèbre tué
dans ton avion en efface vingt. Le marketing EST le gameplay public — pas un menu à part.
## 7. Records, raids & courses (le glamour 1925-1933)
- **Raids scriptés + libres** : tu affectes un avion (souvent conçu pour : autonomie !) + un pilote.
  Réussite = f(autonomie vs distance, fiabilité, météo seed). Réussite → réputation +grosse, presse.
  Échec → avion perdu, pilote disparu 50%. Décision morale et financière à chaque fois.
- **Courses datées** (Coupe Deutsch 1933-36…) : pure Vmax + fiabilité sur la durée de l'épreuve,
  duel public contre les racers des rivaux. Victoire = réputation + prime.
- Après 1935, ces événements se raréfient — le monde a d'autres soucis. La transition est diégétique.
## 8. Ingénieurs, pilotes, bureau vivant
Repris v1 (§5-6) intégralement : 3 compétences, traits, moral, marché du recrutement, diorama en
coupe à 3 paliers (Atelier → Bureau → Institut), postes = grille (étage 2 marche prêt), micro-animations
budget fermé de 12. S'ajoutent : **2 pilotes d'essai/raid nommés** (stats : culot, célébrité),
recrutables, mortels, avec lignes d'épilogue garanties.
## 9. Économie
Trésorerie unique. Entrées : ventes trimestrielles (marché), primes AO/courses/records, acomptes
série militaire. Sorties : salaires hebdo, prototypes, recherche, ateliers, locaux, actions de
réputation. Faillite = trésorerie < 0 pendant 8 semaines → rachat par Blochard (game over narratif).
La crise de 1929-32 est LE test central : demande civile ÷3, il faut traverser (réserves, postal
résilient, ou pari export militaire précoce).
## 10. Événements (16, historiquement ancrés — effets chiffrés toujours affichés avant choix)
1. **1926 — La Ligne s'étend** (Casablanca-Dakar) : gros contrat postal si un avion qualifie.
2. **1927 — Lindbergh** : le monde s'enflamme. Demande transport +40% 3 ans, raids transatlantiques débloqués.
3. **1928 — Ton pilote propose l'Atlantique Sud** : A: financer (gloire ou deuil) / B: refuser (il part chez Marane).
4. **1929 — Octobre, Wall Street** : narration. La demande civile commence sa chute (courbe data).
5. **1931 — Faillites en chaîne** : un client annule son carnet. A: poursuivre (frais, relation) / B: encaisser.
6. **1932 — Dumping de Blochard** : il casse les prix sur le transport. A: suivre (marge nulle) / B: monter en gamme.
7. **1933 — Janvier, Berlin** : bandeau tension apparaît. Demande export militaire commence à monter.
8. **1934 — Doctrine ministérielle change** en plein AO (v1 conservé).
9. **1935 — Ton motoriste livre en retard** (v1 conservé : attendre vs remotoriser).
10. **1936 — Grèves de juin** : production et études gelées 4 semaines. Pas de choix.
11. **1936 — Nationalisations** : l'État veut tes ateliers de série. A: accepter (cash massif, capacité
    plafonnée ensuite) / B: refuser (relation ministère −15, AO plus durs).
12. **1937 — Salon du Bourget** (v1 conservé : vitrine vs discrétion, révélation des specs).
13. **1937 — Guerre d'Espagne** : si tes avions exportés y volent → données réelles (fiabilité +, réputation
    militaire +, mais controverse presse civile −). Sinon : narration.
14. **1938 — Munich** : commandes de panique, AO urgence, demande export ×1.5.
15. **1938 — Débauchage** (v1 conservé).
16. **1939 — Mobilisation** : un ingénieur appelé (v1 conservé) + le marché civil FERME (demande → ~0).
Règles : jamais 2 événements le même mois ; cooldown ; certains uniques.
## 11. Mai 1940 — résolution
Repris v1 §9 (score par famille en service vs benchmark Bf 109E, fragments d'épilogue modulaires),
enrichi : l'épilogue raconte AUSSI la trajectoire d'entreprise (la maison qui a traversé la crise
par le postal, celle qui a parié sur l'export…) et le destin des rivaux. ~35 fragments.
Verdict 4 niveaux. Seed affiché + "Rejouer ce destin".
---
# PARTIE II — TECHNIQUE (repris v1 §10-12, ajouts marqués ➕)
## 12. Stack & performance iGPU (contrainte dure)
**Godot 4.x stable, GDScript typé statiquement, warnings = erreurs.**
- Renderer **Compatibility** (gl_compatibility) — conçu pour GPU intégrés, recommandé 2D. PAS Forward+.
- Résolution de base **640×360**, upscale entier (`canvas_items`, integer scaling).
- **Cible : 60 fps constants sur Intel UHD 620 / Vega 3, 4 Go RAM.** <300 Mo RAM, <150 Mo disque, <5 s chargement HDD.
- Zéro Light2D, UN shader max (cyanotype blueprint, désactivable). Ambiances = frames de sprites.
- Tick sim sur Timer découplé du rendu ; `_process` sur ≤2 nœuds ; zéro allocation par tick
  (tableaux préalloués) ; aucun nœud créé pendant le jeu (pooling instancié à l'init).
- ➕ L'allocation de marché (tous segments × produits) tourne au TRIMESTRE, pas par tick — coût CPU nul en pratique.
- Atlas par écran, textures ≤2048, TileMapLayer pour le décor.
- Options : cap FPS 30/60/∞, VSync, "mode économie" (coupe les 12 animations d'ambiance).
## 13. Architecture
```
res://
  sim/                    # PUR. Aucun Node, aucun signal, aucun randi() moteur. Testable headless.
    rng.gd  state.gd  aircraft.gd  research.gd ➕  market.gd ➕  production.gd ➕
    reputation.gd ➕  contracts.gd  engineers.gd  economy.gd  events.gd  sim.gd
  game/
    main.tscn/gd (SimClock, routage, save)  office/  design/  market_ui/ ➕
    contracts_ui/  research_ui/ ➕  events_ui/  end/  ui/
  data/                   # JSON : moteurs, composants, défauts, segments+courbes de demande ➕,
                          # technos+dates état-de-l'art ➕, rivaux ➕, AO, événements, constants.json
  narrative/fr.json  tests/run.gd  art/
```
Règles v1 conservées : sim/ ignore Godot ; UI → intentions → `sim.apply()` ; state 100% JSON ;
un commentaire-raison par fichier ; 2 autoloads max ; AUCUNE constante d'équilibrage en dur.
## 14. Anti-bugs
Tests headless (`godot --headless -s res://tests/run.gd`) :
- calibration 3 avions de référence (±5%) — garde-fou n°1
- déterminisme double-run seedée (hash JSON identique) ; save/load roundtrip
- ➕ marché : conservation (Σ parts = 1 ±ε chaque trimestre), aucune vente négative, carnet cohérent
- ➕ campagne bot × N sans NaN/négatif absurde ; chaque événement × chaque choix sur fixture
- assertions fin de tick (NaN guards, bornes moral/parts/trésorerie)
- un seul point de mutation du state (sim.tick / sim.apply)
---
# PARTIE III — DESIGN (repris v1 §13-15, ajouts marqués ➕)
DA intégrale conservée : bureau chaud pixel art (palette 24 couleurs, bois miel/papier crème/laiton/
vert lampe) × blueprint cyanotype froid (#123C5E, lignes #E9F1F4, laiton = seul pont chromatique).
Police pixel avec accents français COMPLETS (critère de done). Diorama 3 paliers, 12 animations max,
jour/nuit par palette swap. Blueprint : silhouette procédurale par calques + specs live + cartouche.
➕ **Écran Marché** : mêmes codes que le blueprint (papier technique, chiffres tabulaires mono) mais
sur papier crème — c'est un rapport commercial d'époque, pas un dashboard moderne. Parts de marché
en barres empilées pleines (couleur par maison : toi laiton, Blochard gris acier #5A6B75 ➕ (ajout
palette autorisé), Marane bordeaux #7A3B47 ➕). Interdits absolus maintenus : pas de camembert 3D,
pas de néon, pas de gradient lisse.
➕ **Presse** : les grands moments (record, victoire de course, crash célèbre, krach) produisent une
UNE de journal plein écran (gabarit unique, titre gros, 2 colonnes de texte court) — c'est le feedback
de réputation ET la respiration narrative. 1 gabarit, N contenus (Ponytail).
UX v1 conservée (2 écrans principaux + panneaux, pause auto sur événements, effets chiffrés avant
chaque choix, tooltips pédagogiques, tout à la souris) ; ➕ 3e écran principal : Marché.
Narration v1 conservée (voix sobre, pilotes nommés avec épilogue garanti, bandeau mensuel diégétique).
---
# PARTIE IV — EXÉCUTION
## 15. Ordre de développement
1. sim/ complet + tests verts (calibration d'abord, marché ensuite)
2. ➕ Équilibrage par simulation : 3 bots (glouton-civil, pionnier-militaire, équilibré) × 100
   campagnes → vérifier : la crise de 29 tue 20-50% des bots mal préparés — mesuré SUR LA FENÊTRE 1929-34 et non sur le total des 23 ans (l'assertion portait sur le total, elle ne mesurait donc pas ce qu'elle annonçait) ; plafond relevé de 35 % au playtest n°7 (bug de report de part au renouvellement rival) ; faillites globales 15-35 % (plafond 30→35 : le conseil versait ~400 k£ de primes fantômes par partie) ; aucune stratégie ne
   gagne >60% du temps ; les rivaux finissent avec 40-70% du marché cumulé. Ajuster data/, pas le code.
3. Écran blueprint (le hook) → 4. Écran marché + boucle vente/prix/production → 5. AO + économie
   → 6. Diorama + ingénieurs → 7. Recherche + événements + presse → 8. Fin 1940 + épilogues
   → 9. Passe perf iGPU + a11y + 5 campagnes manuelles
## 16. Critères de done (mesurables)
- [ ] Tests headless verts (calibration ±5%, déterminisme, save/load, conservation du marché)
- [ ] Simulation : distribution des fins conforme (§15.2) ; faillites bot aléatoire 15-30%
- [ ] 60 fps scène de stress (bureau plein + marché ouvert) en Compatibility, `_process` ≤ 2 nœuds
- [ ] Zéro Light2D, ≤1 shader, zéro allocation/tick au profiler, 640×360 net en upscale entier
- [ ] Les rivaux vendent : leurs parts évoluent visiblement, ils sortent ≥3 nouveaux produits
      par campagne, être pionnier sur une techno se voit dans les parts sous 4 trimestres
- [ ] Chaque choix affiche ses effets chiffrés avant validation ; chaque défaite (AO, parts perdues)
      est explicable par l'écran comparatif
- [ ] Accents français OK partout ; aucune couleur hors palette (grep hex) ; commentaire-raison
      par fichier ; 2 autoloads max ; zéro constante d'équilibrage en dur
- [ ] Mode économie jouable et lisible ; campagne complète 8-12 h ; une session s'interrompt et
      se reprend sans perte (auto-save)
---
*v2 — Un marché vivant, des rivaux qui vendent, quinze ans pour bâtir une maison avant l'orage.*
