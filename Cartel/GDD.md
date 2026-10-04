# CARTEL — Prompt Claude Code v2 (référence unique)

> Tycoon de **conception**, de **logistique** et de **conséquence**.
> Tu conçois un produit par vrais arbitrages chimiques (les effets ÉMERGENT des choix),
> tu le distribues avec une flotte que tu possèdes et que tu entretiens (jet-skis, vedettes,
> go-fast, avions, sous-marins), tu achètes ou tu fais taire les gens qui peuvent t'arrêter,
> tu blanchis un argent qui pèse et qui accuse — et un jour ton produit déclenche une épidémie que tes
> propres routes propagent.
>
> Trois jauges gouvernent tout : **visibilité**, **instabilité mondiale**, **remède**.
> Tu finis riche et inconnu, jugé, effacé, ou propriétaire de ce qu'il reste du monde.
>
> Ce document est LA source de vérité. En cas de conflit avec toute autre instruction, il gagne.
> Titre de travail. Substance **entièrement fictive** — aucune chimie réelle, ni dans les
> données, ni dans le texte, ni dans l'UI. C'est une contrainte de design autant que de
> prudence : une chimie inventée place les arbitrages là où le jeu en a besoin.

---

# PARTIE I — LE JEU

## 1. Arche & boucle

**1 tick = 1 semaine.** Campagne ~8-12 h, temps continu pausable ×1/×2/×4. Pas de date
historique : l'horloge est interne (semaine 1 → fin), l'arc est causal, pas calendaire.

**Trois actes, non annoncés au joueur — ils émergent des jauges :**

| Acte | Déclencheur | Ce qui change |
|---|---|---|
| **I — Le laboratoire** | départ | 1 zone, 1 marché. Concevoir, produire, vendre. **L'horloge est la dette** (§1bis). |
| **II — Le réseau** | premier nœud distant ouvert | Graphe, argent sale, bras droits, visibilité. |
| **III — La conséquence** | première épidémie déclarée | Instabilité, extermination, remède, fourche. |

**Boucle** : concevoir → produire → **acheter un engin** → router → vendre → blanchir →
**corrompre** → recruter → le monde répond → itérer. En acte III, une boucle parallèle s'ajoute : contenir ou laisser brûler, aider ou saboter.

**Vérité du design** : tout ce qui rapporte te rend visible. Tout ce qui te protège coûte ce que
tu aurais investi ailleurs. Il n'existe aucune configuration sans dette.

---

## 1bis. La dette — l'horloge de l'acte I

L'acte III a trois horloges (visibilité, instabilité, remède). L'acte II en a une : le
blanchiment qui décroche. **L'acte I n'en avait aucune** — rien ne poussait, donc rien ne
mourait, donc les cibles 1 et 2 de §16 ne mesuraient rien au jalon 1.

### La règle

**Tu commences endetté.** Une somme empruntée à quelqu'un qu'on ne voit jamais, remboursable
en une fois à la **semaine 60**. `data/constants.json` : `dette_montant`, `dette_echeance`.

```
si semaine == dette_echeance et cash_propre < dette_montant :
    → fin courte : SAISIE
```

Elle se rembourse en **argent propre** — donc elle force à vendre, et vendre force à être
visible. C'est la première fois que le joueur rencontre la vérité du design de §1, et elle
arrive avant qu'il ait un réseau pour s'y cacher.

### Ce qu'elle produit

- **Une date.** Même fonction que « mai 1940 » dans `bureau-etudes` : chaque semaine coûte
  quelque chose parce qu'une date existe.
- **Une raison de s'étendre.** L'échéance est calibrée pour être **atteignable sur un seul
  marché, mais serrée.** Le joueur qui reste au labo y arrive ; le joueur qui veut de la marge
  ouvre un nœud. C'est ce qui fait basculer vers l'acte II sans jamais l'imposer.
- **Une trajectoire pour `discret`.** Le bot témoin rembourse et s'arrête là. C'est ce qui le
  rend pauvre et survivant plutôt que cassé.

### Le créancier revient

Une fois remboursé, il ne disparaît pas — il devient le **premier événement de l'acte II** :
il ne veut plus d'argent, il veut un nœud. Refuser coûte de la visibilité ; accepter coûte un
nœud et un lieutenant imposé.

`ponytail:` **le créancier n'est jamais montré, jamais nommé, jamais un personnage.** C'est une
ligne dans un tableau et une échéance. Lui donner un visage serait une quête, et une quête est
un système narratif que ce jeu n'a pas.

---
## 2. Le produit — conception (cœur, acte I)

Même moteur que `bureau-etudes/sim/aircraft.gd` : des paramètres bruts, des specs qui **émergent**.
Aucun curseur ne contrôle directement une spec affichée.

### Paramètres de conception (ce que le joueur règle)

| Paramètre | Plage | Nature |
|---|---|---|
| `famille_precurseurs` | 4 familles fictives | choix discret : coût, disponibilité, traçabilité |
| `purete_visee` | 0.30 – 0.99 | continu — plafond reculé par recherche |
| `rendement` | 0.20 – 0.95 | continu — antagoniste de la pureté ; plafond reculé par recherche |
| `complexite_procede` | 1 – 5 | paliers — débloqués par recherche |
| `coupe` | 0.0 – 0.7 | dilution ajoutée après production ; plafond reculé par recherche |
| `stabilisation` | 0 – 3 | additifs fictifs, coûteux — paliers débloqués par recherche |
| `marquage` | 0 – 2 | aucun / tampon / marque — paliers débloqués par recherche |
| `forme` | brute, cristaux, gel, galets | choix discret — options débloquées par recherche |
| `agent` (de coupe) | neutre, enrobant, exaltant | choix discret — options débloquées par recherche |
| `cadence` | standard, petits lots, gros lots | choix discret — options débloquées par recherche |

**Les quatre derniers sont nés pour la grille de recherche** (§2bis) : les six bornes d'origine
étaient toutes ouvertes par une case, et en ajouter sans nouveau choix aurait été un bonus
déguisé. Chacun a une **option neutre** (aucun marquage, forme brute, agent neutre, cadence
standard) qui ne porte aucun nombre et sert de défaut : une recette qui les ignore — rivaux,
références, bots — garde des specs bit-identiques. Leurs arbitrages (`data/conception.json`) :

| Choix | Gagne | Perd |
|---|---|---|
| Marquage | dépendance (le client reconnaît ce qui lui plaît) | signature (on reconnaît ta maison) |
| Cristaux | signature | coût, un peu de débit |
| Gel | coût, débit | signature, régularité |
| Galets | régularité | coût, débit |
| Agent enrobant | la coupe dilue moins la puissance | régularité, à proportion de la coupe |
| Agent exaltant | dépendance, à proportion de la coupe | instabilité neuro — on peut charger vite sans viser haut |
| Petits lots | régularité | débit |
| Gros lots | débit | régularité |

`src/tests/run.ts` vérifie qu'aucune option n'est dominée par une autre sur les sept specs dans
tous les contextes (comme les familles), et `data/calibration.json` porte leurs ordres
d'intention (« les cristaux signent moins que la forme brute »).

### Specs émergentes (ce que le joueur lit)

```
puissance        = purete × (1 − coupe) × k_famille                     -- ce qui se vend
cout_unitaire    = f(famille, purete² / complexite^k, 1/rendement, complexite) × (1 − coupe)
debit_kg_sem     = capacite_labo × rendement × (1 − k × complexite) / (1 − coupe)
signature        = tracabilite_famille × (1 + k × complexite) − k × stabilisation
regularite_lot   = 1 − variance(purete, complexite, RENDEMENT, competence_chimiste)
dependance       = puissance^k × (1 − coupe)                            -- fidélise la demande
instabilite_neuro = clamp(puissance^k − k × stabilisation − seuil_famille, 0, 1)
```

**`regularite_lot` n'est pas la qualité, c'est la constance d'un lot à l'autre.** Viser 0,50 de
pureté, presque tous les lots tombent juste ; viser 0,99, c'est viser une cible minuscule et la
rater plus souvent. Elle s'appelait `fiabilite_lot`, et le mot faisait lire « plus pur = moins
fiable » comme une incohérence. Infobulle de l'écran de conception : « Viser haut, c'est rater
plus souvent. »

*Les coefficients vivent dans `data/constants.json` et ne sont pas recopiés ici — les chiffres
d'une formule écrite dans un document périment exactement comme ceux d'un commentaire.*

### Chaque curseur doit avoir un arbitrage — mesuré, pas supposé

**La première version de ces formules avait trois curseurs sur six qui n'en avaient pas.** Un
parcours de l'espace de conception (972 contextes) l'a montré en une ligne chacun :

- **`complexite` n'améliorait RIEN.** Coût plus cher, débit plus bas, signature plus haute,
  régularité plus basse — quatre specs dégradées, aucune améliorée. La bonne réponse était
  toujours 1. Le nœud `procede_deux_etapes` (160 000 $) ne débloquait qu'une dégradation, et
  `colonne_seche` l'exigeait : **on forçait le joueur à acheter une dégradation pour atteindre
  la pureté maximale.**
- **`rendement` ne coûtait RIEN.** Le monter baissait le coût et montait le débit, point. La
  bonne réponse était toujours le maximum.
- **`coupe` ne rapportait rien à l'acte I** — elle diluait la puissance contre une instabilité
  qui ne fait encore rien — et il lui manquait la seule chose que le mot décrit.

**Ce qui a été ajouté, et d'où chaque terme vient :**

| Curseur | Ce qu'il gagne | D'où ça vient |
|---|---|---|
| `complexite` | divise le carré de la pureté | l'arbre de §2bis le disait déjà : `colonne_seche` exige `procede_deux_etapes`. L'intention « un procédé complexe PERMET la haute pureté » existait dans l'arbre et pas dans la formule. |
| `coupe` | multiplie les kilos vendables, divise le coût par kilo | ce que le mot décrit. Aucune constante : les deux effets sortent du même fait arithmétique, et puissance × volume reste constant — un échange pur qualité contre quantité. |
| `rendement` | se paie en variance de lot | pousser un procédé, c'est le pousser tout court. `regularite_lot` est la spec que `milieu` et `haut_de_gamme` pondèrent le plus fort : le rendement s'arbitre contre le segment visé. |

**À complexité 1 et sans coupe, rien ne bouge** : c'est ce qui garantit qu'un joueur qui ne
touche pas à ces curseurs garde exactement le jeu d'avant.

`src/tests/run.ts` parcourt désormais l'espace et **échoue si un curseur n'a pas de contrepartie
qui compte** : bouger le curseur dans chaque sens doit améliorer au moins une spec d'**1 % de
son étendue**. Le seuil est celui que `comparer.ts` utilise déjà pour « un mouvement qui
compte ». La première version exigeait seulement un gain non nul : elle attrapait un zéro exact
et laissait passer un terme symbolique — `k_variance_rendement` divisé par 2500 restait vert.
Le seuil a été posé après mesure : la contrepartie réelle la plus mince (baisser la
stabilisation) est à ~3 %, le terme symbolique à 0,01 %. Il passe entre les deux. Le rapport
imprime la contrepartie la plus mince à chaque exécution, pour qu'on voie la marge.

C'est le pendant du levier un étage plus haut. Le levier garde les constantes
(« est-ce que ça bouge ? ») ; ce test garde les choix (« y a-t-il une raison de bouger le
curseur ? »). Les constantes qui portaient ces trois défauts bougeaient toutes des métriques :
le levier les déclarait vertes, à juste titre, et ne pouvait rien voir.

**`instabilite_neuro` est l'axe le plus important du jeu.** Il est affiché dès la première minute,
il ne fait rien pendant tout l'acte I, et il est la cause de l'acte III.

> **Il doit exister au jalon 1.** Leçon mesurée sur `bureau-etudes` : un axe ajouté après coup
> dans un système déjà calibré force à compenser au mauvais endroit, jusqu'à saturation du
> levier. Un sous-système se vérifie sur TOUS les axes qu'il produit, dès qu'il existe.

Le joueur voit `instabilite_neuro` monter avec la puissance. La puissance se vend deux à trois
fois plus cher. Il pousse quand même. Tout le jeu est dans cette phrase.

### Calibration obligatoire

### Le catalogue — plusieurs recettes à la fois

**Jusqu'à 3 recettes actives simultanément.** Chacune a ses six paramètres, ses sept specs, sa
ligne de production et son segment visé.

Sans catalogue, le joueur choisit un segment et abandonne les deux autres — deux tiers de
`market.gd` (§4) ne servent alors à rien, et les critères pondérés des segments deviennent
décoratifs.

**Ce que le catalogue rend jouable :** les trois segments ont des critères orthogonaux — `rue`
veut du coût, `haut_de_gamme` veut de la pureté. Les servir tous les trois demande des recettes
différentes, donc des lignes de production différentes, donc des coûts fixes que le joueur
n'aura pas les moyens de tripler tôt.

**Le piège, qui est déjà dans les formules :** `instabilite_neuro = puissance^2.2 − …`, et
`haut_de_gamme` est le segment qui exige la plus forte pureté. **La recette la plus rentable
est mécaniquement celle qui charge le plus vite** (§8). Le joueur qui diversifie vers le haut
de gamme accélère son propre acte III sans avoir rien choisi de tel.

Le vieillissement du catalogue vient de `bureau-etudes` — déjà écrit, déjà testé : une recette
qui n'est pas renouvelée perd son attractivité à mesure que les rivaux rattrapent.

`ponytail:` **3 recettes maximum.** Au-delà, l'écran de conception devient un tableur et les
bots produisent des combinaisons illisibles.
### Calibration obligatoire (suite)

**Quatre** produits de référence en `data/calibration.json`, tolérance 5 %, testés dans
`src/tests/run.ts`. Toute modification des formules casse ce test avant de casser l'équilibrage.

La quatrième est née d'un audit, et elle mérite d'être expliquée : la référence « haut de
gamme » était **stabilisée**, donc elle lisait `instabilite_neuro = 0.000` — elle montrait
l'**inverse** du piège décrit plus haut. Or à l'acte I l'instabilité ne fait rien, donc un
joueur rationnel ne paie pas la stabilisation. Les deux versions sont désormais côte à côte :

| Référence | `instabilite_neuro` | `cout_unitaire` |
|---|---|---|
| Rue — bon marché, coupé | 0.000 | 1 344 |
| **Haut de gamme — ce qu'un joueur construit vraiment** | **0.775** | **17 256** |
| Haut de gamme stabilisé — ce que coûte la sécurité | 0.000 | 19 056 |
| Extrême — l'acte III en bouteille | 0.872 | 26 470 |

Le piège tient dans l'écart entre les deux lignes du milieu : **1 800 $/kg pour ne pas
charger**, et rien dans l'acte I qui pousse à les payer.

---

## 2bis. La recherche — une grille d'hexagones, trois branches

**Écrit, pas porté** — `src/sim/recherche.ts`. §13 a tranché : on ne reprend de `bureau-etudes` que
le socle et le marché, et son `research.gd` portait un modèle de brevets et de concours qui n'a
rien à faire ici.

**Réécrit en grille, à la Plague Inc.** La première version était un arbre de prérequis à
chantier unique — coût, durée, un nœud à la fois. C'est l'arbre techno de n'importe quel tycoon,
et il ressemblait trop au jeu d'avion dont ce projet sort. La recherche prend maintenant la
**forme** de Plague Inc (grille, adjacence, coût croissant, achat instantané) et garde le
**fond** de Cartel (argent propre, ouverture de choix).

### Deux prix : l'argent propre et le savoir-faire

Une case se paie en **`cash_propre`** (avec l'inflation) **et en savoir-faire de son bras**.

**Le savoir-faire s'apprend en produisant**, et **chaque bras n'apprend que de ses propres
curseurs** : le bras Pureté/Procédé apprend quand on produit près du plafond de pureté ou de
complexité, le bras Volume près de celui du rendement ou de la coupe, le bras Familles en
produisant avec la famille la plus avancée qu'on ait (ou près du plafond de stabilisation).
On cherche la pureté en poussant la pureté — et le joueur « rue » apprend le volume.

- **Trois réserves séparées, et pas une.** Une réserve unique alimentée par n'importe quel
  curseur aurait permis de pousser la coupe, le curseur le moins cher, pour acheter de la pureté.
  Avec des réserves par bras, aucune direction n'est récompensée plus qu'une autre — et la pureté
  garde son seul vrai prix, l'instabilité neuro (§2), au lieu d'en recevoir une seconde prime.
- **Par semaine, pondéré par la part de capacité utilisée**, pas par kilo. Le kilo est plus
  réaliste (la courbe d'apprentissage industrielle suit le volume cumulé) mais il donnerait aux
  gros producteurs une boule de neige que rien ne compense. Un petit labo plein apprend aussi vite
  qu'une usine pleine ; un labo à l'arrêt n'apprend rien.
- **Proximité en rampe** : on n'apprend rien sous 80 % de la plage d'un curseur, tout en butée.
  Un plafond encore égal à son minimum (complexité 1, stabilisation 0 au départ) n'apprend rien.
- **Pas d'inflation sur le savoir-faire** : le temps passé à l'apprendre freine déjà.
- **Il ne s'échange jamais contre de l'argent**, dans aucun sens. C'est la différence avec un
  point d'ADN, et c'est ce qui le garde hors de la règle du papier (§5) : ce n'est pas une
  troisième bourse, c'est de l'expérience. `src/tests/run.ts` vérifie qu'apprendre ne touche aucune
  bourse et que chaque bras n'apprend que de ses curseurs.

**Ce que la mesure montre** : l'argent borne les premières cases (la dette), le savoir-faire
borne les dernières. Le coût en savoir-faire de l'Extraction azurite ne mord jamais pour les
témoins — un an de Verdal en a appris bien plus — et le levier le déclare saturé par la dette.

Conséquence voulue : **le rythme de la recherche est étranglé par le blanchiment.** Un joueur
assis sur 40 M$ sales ne recherche pas plus vite qu'un joueur pauvre. C'est le même goulot que
tout le reste, et il n'a pas fallu l'inventer.

### La grille

- **Adjacence.** Chaque branche est une grille d'hexagones autour d'un centre. Une case est
  achetable si elle **touche** le centre ou une case déjà acquise. Il n'y a pas de prérequis :
  on trace son chemin.
- **Achat instantané.** Pas de chantier, pas de durée : payée, la case ouvre sa borne pour la
  conception de la semaine même. On peut en acheter plusieurs d'affilée.
- **Coût croissant.** Chaque case acquise dans une branche renchérit toutes les suivantes de la
  même branche (`inflation_par_acquis`, linéaire). C'est l'inflation qui remplace la durée comme
  frein de la montée, et c'est elle qui fait le choix : **pas « lequel d'abord » mais « où je me
  spécialise »**. Une case prise par curiosité rend toutes les autres plus chères.
- **Raccourcis.** Les veines sont posées côte à côte : on peut atteindre une case par une veine
  voisine sans passer par la case précédente de la sienne. Les bornes se prennent au plus large,
  donc un raccourci donne exactement la borne de la case atteinte.
- **Pas de dé-évolution, pas de mutation aléatoire** — pour l'instant. Les deux existent chez
  Plague Inc et se grefferaient sans rien casser ; on les ajoutera si la grille en a besoin.

### Les trois branches

Elles correspondent exactement aux trois piliers du jeu — et aux trois jalons qui les ouvrent.

| Branche | Ouvre au | Débloque | Acte |
|---|---|---|---|
| **Chimie** | jalon 1 | familles de précurseurs, plafonds de pureté, de rendement et de coupe, paliers de complexité et de stabilisation | I |
| **Logistique** | jalon 2 | engins, capacités, `−usure`, `−p_saisie`, classes d'arêtes nouvelles (haute mer, corridors aériens) | II |
| **Influence** | jalon 3 | paliers de contacts, capacité et taux de blanchiment, contre-espionnage (`+decroissance` de visibilité), fiabilité d'élimination | II-III |

**Une vingtaine de cases par branche, comme Plague Inc** (décision de l'utilisateur). C'est une
seconde révision du plafond de §17, et son coût était nommé avant de la prendre : **plus de
cases = un espace de stratégies plus large = des bots plus difficiles à lire.** Il s'est vu dès
la Chimie : deux témoins prennent 7 cases sur 27, et les vingt autres dorment au levier, chacune
datée du profil qui la réveillera (`src/tests/levier.ts`, `DORMANTES`). Les effets des jonctions,
eux, sont mesurés : les références « Choix » de `data/calibration.json` les exercent.

**La Chimie a un 20ᵉ hexagone** : le remède fabricable par le joueur (§10) — terminal, ruineux,
et le seul de la grille qui n'ouvre pas un choix mais une fin. Il arrive au jalon 5.

### Ce qui existe aujourd'hui — `data/procedes.json`, Chimie, 27 cases

**Seule la Chimie est écrite** : le remède arrive avec l'acte III, Logistique avec le parc,
Influence avec l'argent sale. Écrire leurs cases maintenant produirait des constantes que rien ne
peut bouger — du bruit qu'on prendrait pour un signal.

Trois bras doubles autour du centre, à 120° l'un de l'autre. Chaque bras porte deux veines qui
se touchent sur toute leur longueur :

| Bras | Veine | Cases, du centre vers le bord | Ouvre |
|---|---|---|---|
| **Pureté / Procédé** | Pureté | Filtration → Raffinage court → Recristallisation → Colonne sèche | pureté max 0,70 → 0,80 → 0,90 → 0,99 |
| | Procédé | Deux étapes → Reflux → Cascade → Synthèse continue | complexité max 2 → 3 → 4 → 5 |
| **Familles / Stabilisation** | Familles | Extraction azurite → Synthèse corymbe → Culture noctal | les trois familles |
| | Stabilisation | Liant gris → Liant ambré → Matrice froide | stabilisation max 1 → 2 → 3 |
| **Volume** | Rendement | Cuves larges → Cuves en série | rendement max 0,85 → 0,95 |
| | Coupe | Charges neutres → Charges lourdes | coupe max 0,50 → 0,70 |

**Et les cases de jonction** — plusieurs arbres qui se rejoignent, comme chez Plague Inc. Elles
sont posées dans les creux entre les bras, là où deux bras se touchent, et ouvrent les quatre
choix de conception de §2 :

| Jonction | Entre | Cases | Ouvre |
|---|---|---|---|
| Formes | Procédé et Familles | Galets · Cristallisation · Gélification | les trois formes |
| Marquage | au bout des Familles | Tampon de maison → Marque | marquage 1 → 2 |
| Cadences | Pureté et Coupe | Petits lots · Gros lots | les deux cadences |
| Agents | Volume et Stabilisation | Agent enrobant · Agent exaltant | les deux agents |

**27 cases** en tout pour la Chimie (le remède fera la 28ᵉ).

Les coûts de base, les coordonnées et l'inflation vivent dans `data/procedes.json`, pas ici.

Ce que les voisinages veulent dire : **un procédé complexe permet la haute pureté** (les deux
veines se touchent — c'était le prérequis `colonne_seche ← procede_deux_etapes` de l'arbre) ;
**la route défensive mène au Noctal** (la Matrice froide touche la Culture noctal) ;
**rendement et coupe sont les deux leviers du volume de rue**.

**Kit de départ** : Verdal seul, pureté ≤ 0,60, rendement ≤ 0,75, complexité 1, coupe ≤ 0,30,
aucune stabilisation. Les deux bornes neuves (rendement, coupe) sont posées là où aucun témoin
ne les touche : la trajectoire de `discret` est donc bit-identique à celle d'avant la grille.

**La liste de ce qu'une case peut ouvrir est FERMÉE** — `famille`, `purete_max`,
`rendement_max`, `complexite_max`, `coupe_max`, `stabilisation_max` — et `src/tests/run.ts` la
vérifie contre les données, avec la connexité de la grille. C'est ce qui rend vraie la phrase
« aucun bonus numérique direct » : elle ne se casse pas dans le code, elle se casse dans une
ligne de JSON, en silence, et aucune cible ne le verrait.

### Le coût gate le DÉPART, l'inflation gate la MONTÉE

**La dette de l'acte I (§1bis) mange tout le budget de recherche de la première année.** Un
profil qui ne veut pas se faire saisir ne pose sa première case qu'autour de l'échéance. Ce
n'est pas un défaut, c'est une contrainte lisible — année 1 pour survivre et payer, année 2
pour investir.

**Le critère, posé avant de choisir les coûts et hérité de l'arbre : une branche doit être
grimpable dans la durée de vie du profil qui la grimpe, avec du temps pour jouer le résultat.**
L'arbre l'avait raté une fois (la recette cible d'`industriel` existait cinq semaines sur 260,
une branche décorative pour le seul profil qui l'utilise). La grille le tient ; le chiffre ne
s'écrit pas ici, il se lit : `trace.ts 7 industriel 13` note chaque case achetée et la
semaine de la fin.

### Ce que la recherche ne fait jamais

- Elle ne donne **aucun bonus numérique direct** (« +10 % de rendement »). Elle **ouvre des
  choix** : un précurseur de plus, un palier de complexité, un curseur qui va plus loin, un
  engin. L'arbitrage reste dans l'écran de conception (§2), il ne remonte pas dans la grille.
  C'est l'autre emprunt à Plague Inc qu'on refuse : là-bas, un symptôme change les stats ;
  ici, c'est l'écran de conception qui joue ce rôle, et il est le cœur du jeu.
- Elle n'est **jamais** un prérequis de survie. Une partie entière est jouable sans rien
  rechercher — plus pauvre, plus discrète, parfaitement viable. C'est la trajectoire du bot
  `discret`, et c'est ce qui l'empêche d'être un bot cassé plutôt qu'un témoin.

---

## 3. Le graphe, le parc & la logistique (acte II)

**La carte est un graphe, pas un terrain.** Aucun pathfinding, aucune tuile, aucune 3D.

### Nœuds

```json
{ "id": "port_sud", "type": "production|transit|marche",
  "population": 4.2, "poids_instabilite": 0.08,
  "capacite_labo": 0, "pression_locale": 0.3,
  "activite_economique": 0.6 }
```

`poids_instabilite` = combien ce nœud pèse dans l'instabilité mondiale. Somme des poids = 1.0.
`activite_economique` = plafond de blanchiment local (§5).

### Arêtes (routes)

```json
{ "de": "port_sud", "vers": "marche_nord", "classe": "maritime_court",
  "distance": 2, "p_saisie_base": 0.04 }
```

**Une arête ne porte plus ni capacité, ni coût, ni délai.** Elle décrit une liaison et son
niveau de risque. Ce qui la parcourt est un **engin que tu possèdes** — c'est lui qui porte
la capacité, le coût, le délai et la visibilité.

Classes d'arêtes : `maritime_court` (côtier) · `maritime_long` (haute mer) ·
`fluvial` · `terrestre` · `aerien`. Chaque engin déclare les classes qu'il peut emprunter.

---

## 3bis. Le parc — ce que tu achètes et ce que tu entretiens

**Tu n'achètes pas un voyage, tu achètes un engin. Une saisie te prend l'engin.**

C'est la différence entre un tarif et un bien, et c'est ce qui fait de la logistique un
système de gestion plutôt qu'un menu de prix.

### Les cinq engins (`data/vehicules.json`)

| Engin | Achat | Entretien/sem | Capacité | Délai | Visib. passive | Visib./voyage | Équipage | Classes |
|---|---|---|---|---|---|---|---|---|
| **Jet-ski** | très bas | quasi nul | minuscule | très rapide | **0** | très basse | **0** | `maritime_court`, `fluvial` |
| **Vedette rapide** | bas | bas | faible | rapide | basse | basse | 1 | `maritime_court`, `fluvial` |
| **Go-fast** | moyen | moyen | moyenne | **très rapide** | moyenne | **haute** | 2 | `maritime_court`, `maritime_long` |
| **Avion** | élevé | **élevé** | moyenne-haute | rapide | **haute au sol** | moyenne | 2 | `aerien` — **exige un contact actif** |
| **Sous-marin** | **écrasant** | **écrasant** | très haute | très lent | quasi nulle | quasi nulle | **4-6** | `maritime_long` |

> **Frontière jet-ski / vedette** (`ponytail:` — décision de périmètre assumée) :
> le jet-ski n'a **aucun équipage** et ne franchit que les arêtes de `distance ≤ 1`.
> La vedette a un pilote et une portée normale. Si cette frontière s'efface à l'usage,
> les deux fusionnent — un engin dont on ne peut pas énoncer la différence en une phrase
> est de la décoration.

### Combien d'engins ?

**Autant qu'on peut en payer.** Un engin acheté est une **instance** : son propre `id`, sa
propre `usure`, son propre nœud d'attache. Trois go-fast sont trois objets distincts, dont
l'un peut être neuf, l'autre à bout et le troisième saisi la semaine dernière.

**Aucun plafond n'est codé.** Il y en a trois, et ils sont tous économiques :

| Frein | Comment il mord |
|---|---|
| **L'entretien** | il est hebdomadaire, en argent propre, et le propre est la ressource rare (§5) |
| **La visibilité passive** | `Σ visibilite_passive` — chaque unité compte, une flotte est voyante à quai |
| **L'équipage** | chaque engin réclame des hommes, donc des salaires et de la loyauté (§6) |

Et un quatrième, indirect mais décisif : **un engin de plus n'augmente le revenu que si le
blanchiment peut absorber ce qu'il rapporte.** Le sixième sous-marin d'un joueur saturé ne
produit que du liquide sale immobilisé et de la visibilité. Le plafond réel de la flotte n'est
pas dans `vehicules.json`, il est dans `commerces.json`.

C'est le même mécanisme que partout ailleurs dans ce document : la limite n'est jamais une
règle, c'est une conséquence.
### Usure et entretien

```
usure[v]        += k_usure_engin × voyages_sem
cout_entretien   = cout_base × (1 + 2.0 × usure)
p_panne_voyage   = clamp(usure² × k_panne, 0, 0.35)
```

Entretien payé chaque semaine en **argent propre**. Entretien sauté → `usure` monte deux fois
plus vite.

**Une panne est un échec moins cher que la police** : cargaison perdue, engin immobilisé
`n` semaines, **aucune visibilité gagnée, aucune saisie**. L'arbitrage « payer l'entretien
ou accepter le risque » est donc un vrai calcul, pas une évidence.

### Saisies

```
p_saisie = p_saisie_base × (1 + visibilite/100) × (1 − protection_contact)
```

Saisie = **l'engin est perdu** + cargaison perdue + `+8` visibilité + le nœud d'arrivée entre
en `pression_locale` haute pendant 8 semaines. Le « catastrophique » du sous-marin cesse
d'être un adjectif : c'est la perte du plus gros actif du jeu.

### Ce que le parc coûte en plus de l'argent

- **L'équipage lie le parc aux hommes (§6).** Un sous-marin, ce sont 4 à 6 hommes qui savent
  où il va. Masse salariale, et surtout exposition à la loyauté : l'engin le plus discret du
  jeu est celui qui a le plus de bouches. Réemploi direct de `engineers.gd`.
- **La flotte est visible à quai.** `visibilite_hebdo += Σ visibilite_passive`. Cinq
  sous-marins ne sont discrets qu'en mer.
- **Le jet-ski est le premier pas hors du labo.** Zéro équipage, zéro visibilité passive,
  capacité ridicule. Il rend le jalon 2 jouable dès la première heure de jeu.

### Position

Chaque engin a un **nœud d'attache**. Le repositionnement est **automatique** et coûte du
délai. `ponytail:` **aucun pilotage manuel de flotte** — gérer une flotte à la main est un
jeu entier à lui seul, et c'est exactement le genre d'ajout qui a coûté `bureau-etudes`.

Un voyage reste une décision : `(arête, engin, produit, kg)`. Le joueur ne pilote rien.

---

## 4. Les marchés

**Port au scalpel de `bureau-etudes/sim/market.gd`, formules inchangées** (§13 : ~590 lignes
gardées sur 989, le reste jeté ou réécrit). Seules les données changent.

```
qualite_s     = Σ_i poids_i × clamp(porte_i(spec_i / besoin_ref_i), 0, 1.4)
porte_i(r)    = 0                         si r <= seuil_i        -- SEUIL, voir plus bas
              = r × (r − seuil_i)/(1 − seuil_i)   si seuil_i < r < 1
              = r                         si r >= 1
f_prix        = (prix_median_segment / prix_du_joueur_DANS_CE_SEGMENT)^exposant_segment
f_confiance   = 0.7 + 0.6 × fiabilite_livraison          -- remplace f_repu
f_delai       = 1 / (1 + 0.15 × semaines_rupture)
attractivite  = qualite_s × f_prix × f_confiance × f_delai
part_cible    = attractivite² / Σ attractivite²
part_reelle  += (part_cible − part_reelle) × 0.20
ventes        = demande_trim × part_reelle, plafonné par le stock livré sur place
```

### Le seuil — ce qui rend un segment EXCLUSIF

**Ajouté après mesure.** Sans lui le ratio est linéaire : un produit à la moitié de la
référence obtient la moitié du crédit. Conséquence mesurée au jalon 1 : un produit de rue à
**pureté 0,45 tenait 30 % du segment `haut_de_gamme`**, à parité avec un produit à 0,95 sur
trois maisons. Les « critères orthogonaux » annoncés plus haut ne l'étaient pas — ils étaient
des préférences, pas des portes.

Le `seuil` est **optionnel et par critère**, défaut 0 (= comportement linéaire). Seuls les
critères qui doivent être exclusifs en portent un ; aujourd'hui c'est la pureté du
`haut_de_gamme`, à 0,70.

**C'est une rampe et pas une coupure.** Sous le seuil le critère vaut zéro, entre le seuil et
la référence le crédit monte progressivement, au-dessus rien ne change. Une coupure nette
ferait basculer un produit entier sur un millième de pureté — et ce document a appris à ses
dépens (§16, l'équilibrage du jalon 1) qu'une falaise n'est pas un réglage.

**Effet, et ce qu'il faut en retenir** : le seuil rend le `haut_de_gamme` exclusif — le
producteur à haute pureté y reprend une part majoritaire au producteur de rue, et l'écart de
richesse entre les deux profils-témoins se resserre. Aucune fixture ni aucun seuil de verdict
n'a été touché pour l'obtenir : c'est le marché qui a changé, pas le juge.

*Le chiffre du jour se lit en lançant `src/tests/balance.ts`, et la forme en balayant
`segments.segments.haut_de_gamme.criteres.0.seuil`. Cette phrase portait deux mesures et un
verdict (« la cible 3 passe au vert ») : le verdict est devenu faux quand la cible a gagné son
terme de survie, et les deux chiffres étaient exprimés dans une unité — l'instantané de
richesse — que §16 a remplacée par une intégrale. Trois façons de vieillir dans une seule
phrase, dans le document qui sert de source de vérité.*

### Segments (`data/segments.json`)

| Segment | Critères pondérés | Volume | `niveau_prix` | `exposant_prix` |
|---|---|---|---|---|
| `rue` | coût .45, disponibilité .30, puissance .25 | énorme | 1.0 (référence) | 1.5 — court après le rabais |
| `milieu` | puissance .40, régularité .35, coût .25 | moyen | 1.25 | 1.1 |
| `haut_de_gamme` | pureté .50, régularité .30, discrétion .20 | faible | **1.6** | 0.45 — n'écoute presque pas |

### UN PRIX PAR SEGMENT — §19.6, et c'est ce qui rend ce marché opérant

**Le joueur pose un prix par segment**, pas un prix unique. Un prix nul l'en retire : se
retirer d'un marché est une décision, prise avec le même curseur que d'y entrer.

`niveau_prix` et `exposant_prix` ne disent pas la même chose et les deux sont nécessaires :
le premier est le **niveau** (quel prix est normal ici), le second la **sensibilité** (de
combien un écart de prix déplace les parts). Le haut de gamme paie 1,6× et ne regarde
presque pas le prix (0.45) : c'est là que la marge se prend. La rue paie la référence et
court après le rabais (1.5) : c'est là que le volume est.

**Sans cela, tout ce qui précède était décoratif** — mesuré, pas supposé, voir §16. Le
joueur est limité par son stock à tous les trimestres ; avec un prix unique, un kilo
rapportait la même chose partout, donc les parts de marché ne décidaient de rien. Depuis,
`rue.niveau_prix` est la **2ᵉ constante la plus sensible du jeu** sur 114, et
`milieu.niveau_prix` fait basculer des **fins de campagne** — ce qu'aucune constante de
marché n'avait jamais fait.

`ponytail:` **les rivaux gardent un prix unique.** Leur marge est leur stratégie entière ;
trois marges par cartel serait un système de pilotage de rival que personne ne demande.

**La dépendance** modifie la demande : `demande_t+1 += dependance × ventes_t × k_fidelite`,
plafonnée. Un produit très addictif fait croître son propre marché — jusqu'à ce qu'il le tue.

### Rivaux

Deux cartels, mêmes formules que le joueur, budget R&D simulé, seed. Ils meurent en acte III
quand l'instabilité de leur nœud d'origine dépasse 0.6. `ponytail:` pas de faillite avant l'acte III.

**Un troisième emplacement est réservé, vide au départ.** Un lieutenant qui trahit (§6) le
remplit : il devient un rival **nommé**, avec la recette du joueur **figée au moment de la
trahison**, le nœud qu'il a emporté, et son stock. Il joue ensuite avec les mêmes formules que
les deux autres.

Coût technique : un emplacement dans `rivaux.json` initialisé à l'exécution. Effet : la
trahison cesse d'être une perte comptable oubliée en dix semaines. Un rival qui vend ton
produit d'il y a trois ans est une punition qui se lit sur la carte pendant tout le reste de
la partie — et qui vieillit, puisque sa recette ne bouge plus.

---

## 5. L'argent — le vrai problème

**L'argent sale n'est pas un score. C'est un passif.**

### La règle du papier

`cash_sale` **ne peut jamais être dépensé en tant que tel.** Il n'achète rien qui laisse une
trace écrite : pas de bien enregistré, pas de contrat, pas de virement, pas de salaire déclaré.
Il n'est pas une monnaie faible — il est une **monnaie séparée**, et le jeu ne les additionne
jamais, nulle part.

La ligne de partage n'est pas la morale, c'est **l'existence d'un document** :

| | `cash_propre` — il y a un papier | `cash_sale` — il n'y en a pas |
|---|---|---|
| **Achète** | labos, **engins**, commerces-façade, recherche, équipes d'extermination | **corruption** (§5bis), **élimination** (§5ter), précurseurs au marché noir |
| **Paie** | entretien du parc, salaires déclarés | rétributions hebdomadaires des contacts |
| **Ne peut pas** | — | acheter un actif, payer un entretien, financer la R&D, recruter un lieutenant |

Un sous-marin a un acte de vente, un vendeur et un compte à créditer : il exige du propre.
Un douanier n'a rien de tout ça : il exige du sale, et il refuserait un virement.

> **Aucun bouton ne convertit l'un en l'autre.** Le blanchiment n'est pas une transaction,
> c'est un **débit hebdomadaire plafonné** (voir plus bas). Un joueur qui a 40 M$ sales et
> 0 $ propre ne peut rien faire d'autre qu'attendre — et payer chaque semaine la visibilité
> que ce tas produit. C'est exactement la situation que le jeu cherche à créer.

Deux trésoreries distinctes, jamais fongibles :

| | Sert à | Contrainte |
|---|---|---|
| `cash_sale` | corruption, élimination, marché noir — **rien d'enregistré** | **occupe de la place**, **produit de la visibilité**, **se transporte physiquement** |
| `cash_propre` | tout ce qui a un papier | **rare** — son seul robinet est le blanchiment, plafonné |

```
visibilite_hebdo += (cash_sale / 1_000_000) × k_cash
```

### Le circuit fermé

C'est l'affirmation centrale du jeu, et elle se tient sans tuning :

```
        ┌──────────────────────────────────────────────┐
        │                                              │
    PARC ──(coûte du PROPRE chaque semaine)────────┐   │
        │                                          │   │
        └──(produit du SALE)──> BLANCHIMENT ───────┘   │
                                   ▲  plafonné         │
                                   │                   │
  CORRUPTION / ÉLIMINATION ──(consomment du SALE)──────┘
        │
        └──(baissent la VISIBILITÉ, qui fait monter leur propre prix)
```

**Ta flotte réclame du propre. Seul le blanchiment fabrique du propre. Le blanchiment est
plafonné. La corruption est la seule chose qui brûle du sale en quantité — et son prix suit
ta visibilité, que la flotte fait monter.**

Aucune boucle n'a de sortie gratuite.

### Commerces-façade (`data/commerces.json`)

Un commerce est un **actif posé sur un nœud** (même modèle que le parc et les contacts —
voir §5ter) : il s'achète, il coûte un loyer hebdomadaire, il peut être perquisitionné et gelé.

| Commerce | Achat | Capacité/sem | Taux | Visib./sem | Gel/sem |
|---|---|---|---|---|---|
| Laverie / bar | bas | très faible | 0.65 | 0.2 | 0.5 % |
| Restaurant / garage | moyen | faible | 0.72 | 0.4 | 1 % |
| Construction / immobilier | élevé | moyenne | 0.80 | 0.8 | 2 % |
| Import-export | très élevé | **haute** | 0.85 | **1.5** | 3 % |
| Banque complice | écrasant | très haute | 0.92 | 0.6 | **5 %** |

**La capacité dépend du nœud** — tu ne blanchis pas 2 M$/semaine dans une laverie de village :

```
capacite_reelle = capacite_base × activite_economique[n] × (1 − 0.5 × pression_locale[n])
```

Ça rattache le blanchiment au graphe. Un nœud riche et calme est une ressource stratégique
distincte d'un nœud producteur.

> **Tu ne peux pas blanchir assez vite. Jamais.** La capacité de blanchiment croît
> **linéairement** (un commerce à la fois, chacun coûteux, chacun plafonné par son nœud)
> pendant que les revenus croissent **exponentiellement** (dépendance + expansion).
> C'est la courbe de difficulté du jeu, et elle monte toute seule.

Le cash sale physique est **stocké dans des nœuds** et se déplace par les mêmes engins.
Une saisie peut prendre l'argent, pas seulement le produit.

---

## 5bis. La corruption — acheter les gens

Des contacts qu'on **acquiert et qu'on entretient**, payés en **liquide sale**.

C'est la seule sortie à grande échelle du `cash_sale`, et c'est ce qui empêche le blanchiment
d'être le seul robinet du jeu.

### Les contacts (`data/contacts.json`)

| Contact | Achat | Rétribution/sem | Effet | Découverte/sem |
|---|---|---|---|---|
| **Douanier** | bas | bas | `−p_saisie` sur un nœud | 2 % |
| **Pilote de port** | bas | bas | débloque les arêtes maritimes d'un nœud | 2 % |
| **Officier de marine** | moyen | moyen | `−p_saisie` sur toutes les arêtes maritimes d'une zone | 1.5 % |
| **Chef de police** | élevé | élevé | **+ décroissance de visibilité**, alerte avant descente | 1 % |
| **Juge** | très élevé | très élevé | un lieutenant arrêté ressort ; `−20` visibilité, une fois | 0.8 % |
| **Politique** | écrasant | écrasant | protège une **zone entière**, cumulable avec tout | 0.5 % |

L'**avion** exige un contact actif sur le nœud de départ (§3bis). C'est le seul engin dont la
disponibilité dépend d'un autre système.

### Les trois propriétés qui rendent la corruption vivante

**a) Le prix monte avec ta visibilité.**
```
cout_sem_reel = cout_sem_base × (1 + visibilite / 50)
```
Plus tu es exposé, plus ta protection coûte cher — ils facturent le danger. Anti-boule-de-neige
automatique, sans tuning, exactement le même mécanisme que le plafond de blanchiment.

**b) La découverte frappe au pire moment.** Un contact découvert est arrêté : `+15` visibilité,
protection perdue **instantanément**, nœud en `pression_locale` haute. Tu perds ton bouclier
précisément quand tu es le plus voyant. Plus le contact est haut placé, plus la découverte
est rare — et plus elle est dévastatrice.

**c) Ça se paie en sale.** Un empire qui ne corrompt pas étouffe sous son propre liquide.

---

## 5ter. L'élimination — faire disparaître les gens

L'autre façon de traiter une personne. **Espérance négative, variance élevée.**

C'est délibéré : l'élimination ne doit jamais être une optimisation. C'est ce qu'on fait
quand on est déjà en train de perdre.

### Cibles

Toute personne qui **produit de la visibilité** : un journaliste sur ta piste, un juge non
corrompu, un témoin, un lieutenant arrêté qui va parler (§6), un contact découvert, le
lieutenant d'un rival.

### Coût

Argent **sale** + **un lieutenant `securite` mobilisé** 2 semaines + un risque d'arrestation
sur ce lieutenant. Aucune élimination n'est gratuite, et aucune n'est anonyme en interne :
tes hommes savent.

### Résolution — aléatoire sur seed

Trois issues, dont la distribution dépend de la **notoriété** de la cible :

| Issue | Effet |
|---|---|
| **Propre** | menace supprimée, `−X` visibilité |
| **Bavure** | menace **toujours là**, `+2X` visibilité, `pression_locale` haute 10 sem. |
| **Martyr** | menace supprimée, `+3X` visibilité, `pression_locale` haute 20 sem., un événement de presse se déclenche |

```
p_bavure  = 0.20 + 0.10 × notoriete
p_martyr  = 0.05 + 0.35 × notoriete
p_propre  = 1 − p_bavure − p_martyr
X         = k_elimination × notoriete
```

**Plus la cible est publique, plus l'espérance est mauvaise.** Supprimer un témoin anonyme est
rentable en moyenne. Supprimer un juge ne l'est jamais — mais c'est parfois la seule action
disponible quand `visibilite > 85` et qu'il reste quatre semaines au compte à rebours.

> C'est le seul système du jeu dont l'espérance est **volontairement négative**. Un système à
> espérance positive serait spammé par les bots et par les joueurs, et deviendrait la réponse
> à tout. Celui-ci doit rester un pari de désespoir.

### Ce que ça laisse

Un compteur `eliminations` dans `state`, **jamais affiché comme un score**. Il n'a qu'un seul
usage : l'épilogue (§11). `LE PROCÈS` et `LE COUPABLE` l'énumèrent nommément. C'est trois
lignes de code et c'est la seule fois où le jeu dit au joueur ce qu'il a fait.

---
## 6. Les hommes — bras droits

**Réemploi de `bureau-etudes/sim/engineers.gd`** (compétences, moral, traits, recrutement,
affectation), plus deux attributs :

| Attribut | Effet |
|---|---|
| `loyaute` 0-1 | baisse si moral bas, si non payé, si un autre monte trop vite |
| `ambition` 0-1 | haute ambition + basse loyauté = **trahison** (part avec un nœud, son stock, et ta recette) |

### Postes

`chimie` (qualité et variance du produit) · `logistique` (délais, capacité, −p_saisie) ·
`finance` (capacité de blanchiment ×) · `securite` (−visibilité, contre-espionnage) ·
`nœud` (un lieutenant gouverne un nœud : sa compétence en fixe le rendement local)

### Arrestation

Un lieutenant arrêté parle avec `p = 1 − loyaute`. S'il parle : **+20 visibilité**, ses nœuds
sont grillés 12 semaines.

Deux réponses, aucune sûre : **payer pour qu'il se taise** (très cher, jamais garanti) ou
**le faire disparaître** (§5ter — espérance négative, et tes autres hommes l'apprendront).

---

## 7. La visibilité (jauge 1/3)

Le niveau d'attention que les autorités te portent. **0-100.**

```
visibilite += traces_hebdo − decroissance
traces_hebdo = signature_produit × kg_produits_sem
             + Σ_engins visibilite_par_voyage × voyages   -- l'engin, pas l'arête (§3bis)
             + Σ_actifs visibilite_sem                    -- flotte à quai, commerces, contacts
             + saturation_marche          -- part de marché > 60 % sur un segment
             + (cash_sale / 1e6) × k_cash
             + evenements (arrestations, saisies, pannes, trahisons, éliminations)
             + Σ_nœuds infection[n] × k_epidemie          -- ACTE III uniquement
decroissance = (2.0 + bonus_contacts) × capacite_institutionnelle   -- §5bis, §9
```

| Palier | Nom affiché | Effet |
|---|---|---|
| 0-30 | **Inconnu** | rien |
| 30-60 | **Repéré** | `p_saisie` ×1.5, un rival peut te vendre |
| 60-85 | **Identifié** | descentes ciblées sur labos et lieutenants |
| 85-100 | **Traqué** | perte d'un nœud par trimestre, compte à rebours |

**Le renversement de l'acte III** : jusque-là, la visibilité vient de tes choix. Après l'épidémie,
elle vient de l'infection — tu ne la contrôles plus, tu paies seulement pour la freiner.

---

## 8. L'épidémie (acte III)

### Déclenchement — la charge

**L'aléa décide QUAND, pas SI.** C'est la différence entre un jeu dont l'acte III est le sujet
et un jeu dont l'acte III est un bonus que certains joueurs ne verront jamais.

Une **charge cachée** s'accumule, une par nœud-marché où le joueur a vendu :

```
charge[n] += max(0, instabilite_neuro − 0.55) × kg_ecoules_sem × k_charge
p_declenchement_trim = clamp(charge[n] / seuil_charge, 0, 1)
```

Sur seed. La graine décide de la **date** du franchissement — tôt, tard, sur tel nœud plutôt
que tel autre. Elle ne décide plus de son existence.

| Le joueur | Ce qui se passe |
|---|---|
| pousse la puissance | la charge monte vite, l'épidémie arrive tôt, il a encore de l'argent pour la combattre |
| reste prudent | la charge monte lentement, l'épidémie arrive tard, il a un réseau à perdre |
| reste **sous `instabilite_neuro` 0.55** | la charge ne monte **jamais** — pas d'acte III, et c'est une stratégie, pas un bug |

**La charge n'est jamais affichée.** Le joueur lit `instabilite_neuro` dans l'écran de
conception (§2) et il lit ses tonnages. Il a tout ce qu'il faut pour savoir. Lui montrer une
barre « progression vers l'épidémie » transformerait une conséquence en objectif.

Ce n'est pas une cinématique : le déclenchement est un événement local sur un nœud, pas une
bascule mondiale.

### Propagation — sur ton propre graphe

```
infection[n] += croissance_interne + importe − nettoyage

croissance_interne = infection[n] × r × (1 − infection[n])          -- logistique, r ≈ 0.10/sem
importe            = Σ_arêtes_entrantes kg_transites × instabilite_neuro × k_vecteur
nettoyage          = Σ capacite_equipes[n]
infection[n]        = clamp(infection[n], 0, 1)
```

**Tes routes sont le vecteur.** Le réseau construit pendant quarante heures est ce qui tue le monde.
Plus tu commerces, plus vite ça se répand. Arrêter de commercer = faillite.

### Effets locaux

`infection[n] > 0.3` → demande −50 % · `> 0.6` → demande 0, labo perdu, route coupée ·
`> 0.9` → nœud mort, définitif.

### Équipes d'extermination (`data/equipes.json`)

Recrutement et salaire via `engineers.gd`, mais affectées à un **nœud**.

```json
{ "id": "equipe_lourde", "capacite_nettoyage_sem": 0.04,
  "salaire_sem": 45000, "cout_recrutement": 900000 }
```

Coût délibérément **écrasant** : chaque équipe payée est un labo non construit. C'est là que se
joue la fourche, et elle se joue en euros, pas en menu.

---

## 9. L'instabilité mondiale (jauge 2/3)

**Valeur dérivée. Aucun état supplémentaire.**

```
instabilite = 100 × Σ_n infection[n] × poids_instabilite[n]
capacite_institutionnelle = max(0, 1 − instabilite / 80)
```

| Palier | Le monde | Toi |
|---|---|---|
| 0-20 | rumeurs, faits divers | rien |
| 20-40 | crise sanitaire, frontières fermées | routes ×1.4 en coût |
| 40-60 | états d'urgence | **`decroissance` de visibilité baisse — mais `p_saisie` aussi** |
| 60-80 | premiers États tombent | **tes rivaux meurent, les frontières s'ouvrent** |
| 80-100 | le monde d'avant a disparu | tu es la seule logistique fonctionnelle |

**Le mécanisme vicieux** : l'instabilité tue tes clients ET tes poursuivants. Chaque point détruit
ton marché et desserre l'étau. Un seul chiffre rend deux stratégies opposées jouables.

Le joueur qui laisse brûler ne choisit jamais « le mal » dans un menu. Il constate que le chaos
est devenu son meilleur outil, un point de pourcentage à la fois.

---

## 10. Le remède (jauge 3/3)

Progression 0-100 de la communauté scientifique mondiale vers un remède.

```
progres_remede += taux_base × urgence × capacite_institutionnelle × (1 + aide − sabotage)

urgence                   = instabilite / 100
capacite_institutionnelle = max(0, 1 − instabilite / 80)
```

### La troisième voie — le fabriquer soi-même

Le joueur a la formule. Personne n'est mieux placé pour concevoir l'antidote que celui qui a
conçu le produit.

**20ᵉ hexagone de la grille Chimie** (§2bis) : terminal, ruineux, et le seul de la grille qui n'ouvre
pas un choix mais une fin. Une fois pris, il ouvre une ligne de R&D dédiée :

```
progres_remede += contribution_joueur          -- SANS capacite_institutionnelle
```

**C'est la seule voie qui fonctionne encore au-dessus d'instabilité 80.** Le point de
non-retour cesse d'être un mur : il devient une porte dont le responsable de l'effondrement
détient la seule clé.

Ce que ça coûte : un budget propre écrasant, pendant des dizaines de semaines, alors même que
l'instabilité détruit les marchés qui alimentent ce budget. Plus le joueur attend, plus c'est
cher et moins il a de revenus. Il n'y a pas de moment confortable pour s'y mettre.

Réemploi pur : même écran de conception qu'au §2, mêmes paramètres, objectif inversé.

### La fenêtre — la propriété la plus importante du jeu

Le produit `urgence × capacite_institutionnelle` culmine **exactement à instabilité = 40**
et tombe à **zéro à instabilité = 80**.

```
vitesse
du remède  │        ╱‾‾╲
           │      ╱      ╲
           │    ╱          ╲
           │  ╱              ╲
           └────────────────────╲──────  instabilité
           0      40             80    100
                  ▲               ▲
              optimum      point de non-retour
```

Trop peu d'instabilité : personne ne finance. Trop : il n'y a plus de laboratoires.
**Au-delà de 80, le monde ne peut plus se sauver.** Le joueur qui franchit ce seuil a choisi,
qu'il le sache ou non.

### Les actions du joueur

| Action | Effet | Coût |
|---|---|---|
| **Aider** — livrer des échantillons, financer des labos, fuiter la formule | `aide` +0.4 à +1.5 | **+15 à +40 visibilité** — seul le créateur sait ça |
| **Saboter** — racheter les précurseurs des labos, corrompre, désinformer | `sabotage` +0.3 à +0.8 | argent, un lieutenant mobilisé, risque d'arrestation |
| **Ne rien faire** | — | le remède court à sa vitesse propre |

Aider te dénonce. Saboter te ruine et t'expose à l'arrestation. **Il n'y a pas d'option gratuite.**

---

## 11. Les fins

Trois jauges, une matrice, **six fins**. Toutes atteignables, aucune scriptée.

### Le remède atteint 100 (instabilité restée < 80)

- `visibilite < 40` → **L'ANONYME.** Le monde guérit. Tu es riche. Personne ne saura jamais.
- `visibilite ≥ 40` → **LE PROCÈS.** Le monde guérit, et il te juge. La pire des deux.

### L'instabilité atteint 100 (remède mort à 80)

- `visibilite < 40` → **L'HÉRITIER.** Tu possèdes les seuls sous-marins, avions et routes qui
  fonctionnent encore. Tu n'as rien conquis — tu es simplement le dernier à pouvoir livrer.
- `visibilite ≥ 40` → **LE COUPABLE.** Nommé, traqué, dans un monde mort. Tu as tout gagné et
  il n'y a plus personne pour l'acheter.

### Le remède atteint 100 par la R&D du joueur (§10)

- **LE BIENFAITEUR.** Le monde guérit parce que celui qui l'a rendu malade a payé pour le
  soigner. Personne ne fera jamais le lien entre les deux — ou tout le monde, selon la
  visibilité, qui ne change pas la fin mais en change la dernière ligne.

### Aucune épidémie déclenchée (`instabilite_neuro` resté sous le seuil)

- **L'ARTISAN.** Riche, jamais inquiété, un produit auquel le monde a survécu. Ce n'est pas une
  absence de fin : c'est la seule qui récompense la retenue, et elle rend les quatre autres
  lisibles par contraste. Un joueur qui l'obtient a joué le jeu, pas contourné l'acte III.

### Fins courtes

`cash_propre < 0` pendant 8 semaines → **faillite** (absorbé par un rival).
Dette non remboursée à l'échéance (§1bis) → **saisie**.
`visibilite = 100` pendant 4 semaines → **arrestation**.
Trahison de tous les lieutenants → **destitution**.

**Ce que l'épilogue énumère** : l'état du réseau, les nœuds morts, la fortune finale — et le
compteur `eliminations` (§5ter), nommément. Jamais affiché pendant la partie, jamais présenté
comme un score. C'est la seule fois où le jeu dit au joueur ce qu'il a fait.

> **L'épilogue est un verdict, pas une phase.** Aucun mode post-apocalyptique, aucun 4X.
> Un texte calculé sur l'état du réseau, comme « mai 1940 » dans `bureau-etudes`.

---

## 12. Événements

**12 événements** (`data/events.json`), effets chiffrés **toujours affichés avant le choix**,
mêmes mécaniques que `bureau-etudes/sim/events.gd`.

Répartition : 4 en acte I-II (un précurseur interdit, un contact corrompu qui double son prix,
un lieutenant qui exige un nœud, un rival qui propose un partage), 4 au basculement (premier
cas déclaré, un journaliste remonte une piste, un lieutenant comprend, l'OMS fictive appelle
à l'aide), 4 en acte III (un État propose une amnistie contre ta coopération, un labo public
demande un échantillon, un rival veut fuir avec ta formule, l'armée ferme un corridor).

L'événement d'amnistie est le seul qui **nomme la fourche à voix haute** — et il n'arrive
qu'après que le joueur l'ait déjà choisie par ses dépenses.

---

## 12bis. L'interface

`game/` ne contient aucune règle (§13). Mais deux choses sont des **règles que l'UI doit
rendre impossibles à oublier** : la non-fongibilité des deux monnaies, et le fait que le
réseau du joueur est le vecteur de l'épidémie.

> **Ce document spécifie la STRUCTURE de l'information, pas le style.** Ce que chaque écran
> doit contenir, ce qu'il ne doit jamais faire, et pourquoi. La direction artistique — palette,
> typographie, ambiance, icônes — se décide ailleurs et n'a pas à être devinée ici.

### 12bis.0 — La référence : Plague Inc, son chrome et pas sa structure

Plague Inc a la même colonne vertébrale que Cartel : une carte qui se contamine, une jauge de
remède qui court après le joueur, un arbre à trois branches. L'emprunt est légitime, et il est
**partiel**.

**Ce qu'on prend :**

| Élément | Chez Plague Inc | Chez Cartel |
|---|---|---|
| Barre de jauges en haut, permanente | infectés / morts / remède | **visibilité / instabilité / remède** |
| La carte comme écran d'accueil | le monde, des pays qui rougissent | **le graphe, des nœuds qui s'infectent** |
| Clic sur une entité = panneau latéral | pays : population, climat | **nœud : labo, stocks, cash sale, infection, équipes** |
| Fil d'actualité en bas | titres de presse | **presse, saisies, arrestations, rumeurs** |
| Arbre en onglets, nœuds à débloquer | Transmission / Symptômes / Capacités | **Chimie / Logistique / Influence** (§2bis) |

**Ce qu'on ne prend pas :** chez Plague Inc, **tout** se joue sur la carte, et l'arbre est le
seul verbe du jeu. Chez Cartel, la carte n'est qu'un écran parmi plusieurs — le cœur de
l'acte I est l'**écran de conception** (§2), qui n'a aucun équivalent chez Plague Inc. Une UI
qui ferait tout passer par la carte enterrerait le meilleur système du jeu sous son décor.

**Le risque à connaître :** une interface trop fidèle fait lire le jeu comme un clone de
Plague Inc où l'on jouerait la drogue. Ce n'est pas le jeu, et ce n'est pas la promesse de §18.
Garde-fou : **l'écran de conception apparaît dans la première minute de jeu et dans la première
capture d'écran**, avant la carte.

### 12bis.1 — Le HUD permanent

Trois jauges, deux bourses, une horloge. Rien d'autre, et rien qui les additionne.

```
┌─────────────────────────────────────────────────────────────────────┐
│ VISIBILITÉ ████░░░░ 41 Repéré │ INSTABILITÉ ██░░ 18 │ REMÈDE ░░ 6 % │
├────────────────────────────┬────────────────────────────────────────┤
│  PROPRE      4 200 000 $   │  SALE      38 400 000 $                │
│  ▸ entretien  −310 000/sem │  ▸ +2.1 visibilité/sem                 │
│  ▸ blanchi    +180 000/sem │  ▸ réparti sur 6 nœuds                 │
└────────────────────────────┴────────────────────────────────────────┘
```

**Les jauges instabilité et remède sont affichées dès la semaine 1**, à zéro, inertes. Même
raison que `instabilite_neuro` (§2) : un axe qui apparaît au milieu de la partie est un axe que
le joueur subit. Un axe présent depuis le début est un axe qu'il a vu monter.

### 12bis.2 — L'écran carte (accueil)

Le graphe. Chaque nœud porte, lisible sans clic : son type, sa part de marché, et **sa couleur
d'infection**. Chaque arête active porte le flux qui la parcourt et l'engin qui l'assure.

**C'est la capture d'écran qui vend le jeu** (§18) : la contamination qui remonte les arêtes
que le joueur a construites lui-même. Si `infection[n]` n'est pas lisible d'un coup d'œil au
jalon 5, la page Steam n'a rien à montrer.

Clic sur un nœud → panneau latéral : labo, stocks, **cash sale immobilisé sur place**,
commerces, contacts actifs, infection, équipes affectées.

### 12bis.3 — Les deux bourses

**Jamais un chiffre de fortune totale. Nulle part.** Pas dans le HUD, pas dans l'écran de fin,
pas dans une infobulle.

Trois informations obligatoires à côté du stock sale, en permanence :

1. **ce qu'il coûte en visibilité cette semaine** — le passif est chiffré, pas sous-entendu
2. **où il est** — il est physique, stocké dans des nœuds (§5), transporté par les mêmes engins
3. **à quelle vitesse il s'écoule** — le débit de blanchiment réellement utilisé

**L'argent propre est un nombre. L'argent sale est une carte.** C'est la distinction visuelle
qui porte tout le système. Un tas coincé dans un nœud sous `pression_locale` haute est un
problème de logistique, pas de comptabilité.

**Chaque prix déclare sa monnaie.** Aucune étiquette n'est neutre. Un bouton indisponible n'est
jamais seulement grisé — il dit **pourquoi**, **combien il manque**, et **en combien de
semaines** :

```
[ Sous-marin classe II — 12 400 000 $ PROPRE ]
  ✗ il vous manque 8 200 000 $ propres
    (38 400 000 $ sales en attente — 180 000 $/sem blanchis, soit ~46 semaines)
```

Cette dernière ligne est la plus importante de l'interface. Elle transforme une frustration
(« je ne peux pas acheter ») en **lecture d'une contrainte** (« mon goulot est le blanchiment,
pas la vente »). C'est le moment où le joueur comprend le jeu.

**L'écran de blanchiment est un débit, pas un guichet.** Pas de champ de saisie, pas de bouton
« convertir ». Une jauge de capacité utilisée / disponible, commerce par commerce, avec le
plafond du nœud à côté. Quand c'est saturé — presque toujours (§5) — l'écran le dit en clair :
**« saturé depuis 23 semaines »**.

### 12bis.4 — L'écran recherche

Trois onglets, une grille d'hexagones chacun (§2bis). Structure Plague Inc, contenu Cartel.

Chaque case affiche **avant l'achat** : ses deux prix — `cash_propre` du jour (inflation
comprise) et savoir-faire de son bras — et **ce qu'elle ouvre** — jamais un pourcentage abstrait. « Débloque la famille Corymbe »,
« pureté jusqu'à 0,90 », pas « +15 % de qualité ». C'est la même règle que §2bis : la recherche
ouvre des choix, elle ne distribue pas des bonus.

**Trois jauges de savoir-faire**, une par bras, en tête de l'onglet, chacune avec ce qui la
remplit (« produire près du plafond de pureté ou de complexité »). Elles n'apparaissent pas dans
le HUD : ce n'est pas une bourse.

Quatre états lisibles d'un coup d'œil : **acquise**, **achetable** (elle touche une case
acquise), **trop chère** (avec la phrase de §12bis.3 : combien il manque, en combien de
semaines), **hors d'atteinte** (elle ne touche encore rien). Survoler une case montre ce que son
achat renchérit : le prix de toutes les autres cases de la branche monte d'un cran.

Trois contraintes :

- **Les branches non ouvertes sont visibles et grisées dès le jalon 1**, avec leur condition
  d'ouverture. Le joueur doit savoir que Logistique et Influence existent avant de pouvoir y
  toucher — c'est ce qui donne à l'acte I une direction, et l'acte I a maintenant la sienne (§1bis).
- **Aucun achat n'est annulable.** C'est un engagement de trésorerie propre, et le propre est la
  ressource rare du jeu. Un bouton de confirmation suffit ; un bouton d'annulation mentirait.
- **Une case achetée renvoie à l'écran de conception.** Chez Plague Inc, un symptôme change les
  stats sur place ; ici, la case ouvre un curseur ailleurs. Sans ce lien (« nouveau : famille
  Corymbe → concevoir »), la grille aurait l'air de ne rien faire.

### 12bis.5 — L'écran de conception

Les dix paramètres à gauche — les six curseurs d'origine, puis les quatre choix de conception
(marquage, forme, agent, cadence) — les sept specs émergentes à droite, recalcul en direct.
Chaque option verrouillée dit quelle case de la grille l'ouvre. `regularite_lot` s'affiche
« Régularité du lot — constance d'un lot à l'autre ».

**`instabilite_neuro` y est affiché dès la première minute, inerte pendant tout l'acte I.**
C'est la contrainte la plus importante du document (§2), et elle est autant une contrainte
d'interface que de modèle : un axe qu'on n'a pas vu monter est un axe qu'on subit.

### 12bis.6 — Conséquence de vente

Les trois jauges, les deux bourses et l'écran de conception doivent être lisibles sur les
captures (§18). « Riche en argent qu'on ne peut pas dépenser » est une situation que personne
n'a mise sur une capture Steam, et elle se comprend en une seconde.

---

# PARTIE II — TECHNIQUE

## 13. Architecture

**TypeScript, Node 24 ; l'interface en web, empaquetée par Electron pour Steam.** Les
conventions de `bureau-etudes` restent intégralement en vigueur :

- `src/sim/` = fonctions **pures** sur `(state, data)`. Aucun accès à l'interface ni au
  disque — elles tournent telles quelles dans le navigateur d'Electron. Déterministe sur seed.
  `src/sim/disque.ts` est la seule exception, côté Node : lire `data/*.json` et hacher un state.
- `src/ui/` (à venir) = interface seulement. Aucune règle de jeu.
- `data/` = tout le contenu en JSON. **Aucun nombre d'équilibrage dans le code.**
- `src/tests/` = le harnais, exécutable en CI (`node src/tests/run.ts`, `levier.ts`, `balance.ts`…).

### Le portage Godot → TypeScript — pourquoi, et comment il a été validé

**Pourquoi.** Cartel est un jeu d'INTERFACE — panneaux, jauges, graphe, grille — et ses écrans
se dessinent sur Claude Design, qui produit du HTML. En Godot, chaque maquette devait être
reconstruite en nœuds `Control` ; en web, elle devient du quasi-code. Steam accepte une
application Electron (les fonctions Steam passent par `steamworks.js`). La seule perte réelle
est la console (Switch, PlayStation, Xbox n'acceptent pas de jeu web) — un renoncement assumé
par l'utilisateur, au jalon 1, quand `game/` n'existait pas encore et que le changement ne
coûtait que la simulation et le harnais.

**Comment il a été validé — par la mesure, pas par la relecture.**

1. **Un essai d'abord** : `produit.gd` porté seul et comparé au bit près sur 11 740 recettes.
   Tout identique sauf deux specs, à 1 et 2 ULP — `pow()` n'est pas calculé par la même
   bibliothèque dans les deux moteurs. La comparaison a aussi attrapé la seule vraie
   différence de langage : `Math.trunc(-0.3)` vaut **-0** en JavaScript, `int()` vaut 0 en
   GDScript (`src/sim/gd.ts` reproduit les primitives de Godot à la lettre).
2. **Puis des campagnes entières** : quatre bots, trois graines, 260 semaines, comparés
   semaine par semaine — bourses, jauge, stock, flux aléatoire, cases, savoir-faire, parts de
   marché. **Les douze campagnes sont identiques au bit près.**
3. **Puis le harnais** : `balance` (100 graines × 4 bots) et `levier` (216 constantes)
   rendent les MÊMES chiffres que sous Godot, et `balayage` la même courbe.

**Ce que ça a apporté au passage** : la simulation tourne environ 8 fois plus vite par tick ;
le levier est repassé de 4 à 6 graines (il était descendu à 4 pour tenir le budget de
`perf`), et le mode diff de `trace` — cassé sous Godot depuis que le levier balaie tous les
fichiers de données, sans qu'aucun test ne le lance avec une constante — remarche et passe
dans le smoke de la CI.

**Ce qui ne survit pas au portage : l'identité bit à bit avec Godot.** Elle ne servait qu'à
valider ; TypeScript est désormais la référence, et Godot a quitté le dépôt.

### Réemploi de `bureau-etudes` — LE SOCLE, PLUS LE MARCHÉ

**Décision tranchée : on reprend la plomberie et UN modèle, pas douze.** La v1 de ce tableau
reprenait douze modules « tel quel » ou « données seulement ». Annulé — sauf le marché, pour
la raison écrite plus bas, et à condition de le porter au scalpel.

**Ce qui a été mesuré avant de trancher**, parce que la question se mesure au lieu de se
discuter : les 1 815 lignes des modules candidats contiennent **trois** littéraux décimaux
non triviaux en dehors des commentaires — `/ 4.0` (trimestres dans l'année), `13.0`
(semaines dans un trimestre), `-999.0` (sentinelle « jamais arrivé »). Trois conversions
d'unités. **L'équilibrage de `bureau-etudes` n'aurait donc pas suivi** : la règle « aucun
nombre d'équilibrage dans le code » y a tenu, et les `0.43`, `1.4`, `0.851` qu'on lit dans
ces fichiers sont tous dans des commentaires qui racontent des mesures.

Ce n'est donc pas l'équilibrage qui est refusé, **c'est le MODÈLE** — l'opinion de design
qu'un fichier porte avec lui, et l'historique de rustines qui va avec.

**Une exception, et elle se justifie en une ligne : le marché.** §4 a déjà adopté ce
modèle formule par formule — `attractivite = qualite_s × f_prix × f_confiance × f_delai`,
`part_cible = attractivité² / Σ attractivité²`, inertie 0.20. Refuser le fichier en gardant
les formules, ce serait payer la réécriture sans acheter la sécurité, et se donner
rendez-vous avec des bugs que ce code a déjà rencontrés et corrigés (le renouvellement rival
qui redistribuait la clientèle gratuitement, entre autres — ses commentaires en tiennent le
journal).

| Source | Devient | Effort |
|---|---|---|
| `sim/rng.gd`, `state.gd`, `sim.gd` | socle | **tel quel** — ✅ fait |
| `sim/economy.gd` | les deux trésoreries | **dédoubler : sale / propre** — ✅ fait |
| `sim/reputation.gd` | `sim/visibilite.gd` | inverser le signe — ✅ fait |
| `sim/events.gd` | événements | **tel quel** |
| `sim/raids.gd`, `accidents.gd` | saisies, descentes, arrestations | même forme |
| `sim/market.gd` | marchés, segments, parts, inertie, rivaux | **port au scalpel — voir ci-dessous** |
| `tests/run.gd`, `balance.gd`, `bots.gd` | le harnais | **portés** — ✅ fait |

**Le marché se porte au scalpel, pas au `cp`.** Sur ses 989 lignes :

| | lignes | quoi |
|---|---|---|
| **jeté d'emblée** | ~290 | concours AO, brevets, fusion des rivaux, filiale coloniale, contrats d'entretien de flotte, dimensionnement de voilure |
| **réécrit** | ~100 | `_design_rival` et les bouts qui pensent en avions |
| **gardé** | ~590 | `_allouer`, `qualite_segment`, `_attractivite`, l'inertie, la réaction et le renouvellement des rivaux, leur R&D |

**Tout le reste s'écrit ici.** `research.gd`, `engineers.gd`, `production.gd`, `aircraft.gd`,
et les écrans `blueprint.gd` et `marche.gd` ne sont plus des sources : des références qu'on
relit, jamais des fichiers qu'on copie. Le prix de cette décision est au §15, et il est réel.

**Ce qui rend le port du marché plus sûr qu'il ne l'était dans `bureau-etudes` :** le harnais
existe AVANT lui. `bureau-etudes` a accumulé ses rustines parce que rien ne les voyait venir ;
ici `levier.ts` dira si les constantes de `segments.json` sont branchées, `balance.ts` si les
rivaux tiennent leur part, `trace.ts` pourquoi. Porter un modèle sous un harnais qui marche
est plus sûr que d'en écrire un neuf sans aucune mesure préalable.

**Où le risque est vraiment**, et il n'est pas dans le port : la boucle de §4
`demande_t+1 += dependance × ventes_t × k_fidelite`. Un produit qui fait grandir son propre
marché n'a d'équivalent nulle part — c'est une rétroaction positive, elle divergera ou ne
fera rien, et c'est elle qui mérite la méfiance.

### Le modèle d'actif — un seul struct pour trois systèmes

Engins, contacts corrompus et commerces-façade sont **le même objet vu sous trois angles**.
Un module, trois fichiers de données — pas trois modules.

```ts
{ "id": "...", "type": "vehicule|contact|commerce",
  "noeud": "port_sud",
  "cout_achat": 0, "cout_sem": 0,
  "devise": "propre|sale",          # vehicule → propre, contact → sale
  "visibilite_sem": 0.0,
  "usure": 0.0,                     # vehicule uniquement
  "p_perte_sem": 0.0,               # découverte (contact), gel (commerce)
  "effets": { } }
```

La maintenance et le vieillissement s'écrivent **une fois** dans `src/sim/actifs.ts` et servent
les trois. Écrire ce système trois fois est l'erreur à ne pas commettre — c'était vrai quand
`production.gd` devait le fournir tout fait, ça l'est davantage maintenant qu'il faut
l'écrire soi-même.

### Modules nouveaux (les seuls)

`src/sim/actifs.ts` (parc, contacts, commerces : achat, entretien, usure, perte) ·
`src/sim/graphe.ts` (nœuds, arêtes, voyages, saisies, pannes) ·
`src/sim/epidemie.ts` (propagation, nettoyage, instabilité dérivée) · `src/sim/remede.ts`

`src/sim/blanchiment.ts` et un hypothétique `src/sim/parc.ts` **n'existent pas** : ce sont des
cas d'usage de `src/sim/actifs.ts`.

---

## 14. Données

```
data/
  constants.json      -- équilibrage, zéro nombre dans le code
                         (dont dette_montant, dette_echeance, k_charge, seuil_charge)
  calibration.json    -- 3 produits de référence, tolérance 5 %
  precurseurs.json    -- 4 familles fictives
  conception.json     -- les quatre choix de conception (§2) : marquage, formes, agents, cadences
  procedes.json       -- grille de recherche (§2bis) — ✅ Chimie, 27 cases ; les deux
                         autres branches naissent avec leurs systèmes
  graphe.json         -- nœuds + arêtes (classes, distances, risque)
  vehicules.json      -- les 5 engins : capacité, coût, entretien, usure, équipage
  contacts.json       -- les 6 contacts corrompus
  commerces.json      -- les 5 commerces-façade
  elimination.json    -- notoriétés des cibles, distribution des issues
  segments.json       -- marchés et critères pondérés
  equipes.json        -- extermination
  lieutenants.json    -- archétypes recrutables
  rivaux.json
  events.json         -- 12
  remede.json         -- taux de base, actions d'aide et de sabotage
```

`blanchiment.json` a disparu : il est devenu `commerces.json`, sous le modèle d'actif commun.

---

## 15. Ordre de construction — jalons

**Règle absolue : le harnais d'équilibrage passe au vert AVANT de commencer le jalon suivant.**
C'est la seule règle de ce document qui n'est pas négociable. Elle est reprise de
`bureau-etudes`, où elle a fonctionné — ce qui y a coûté cher, c'est le PÉRIMÈTRE (dix
sous-systèmes sur vingt-trois ans simulés), pas la discipline de mesure.

**Corollaire, ajouté après coup et tout aussi contraignant :** les cibles de §16 sont
**échelonnées**. Les cibles 5 et 6 exigent le jeu complet ; les appliquer au jalon 1 est
impossible, et prétendre le contraire vide la règle de son sens. Chaque jalon porte sa
propre porte, écrite dans `balance.ts` **le jour où le sous-système naît** — jamais
rétro-ajoutée. Un axe mesuré trop tard est la faute qui a coûté `bureau-etudes`, appliquée
cette fois à la mesure au lieu du modèle.

| # | Jalon | Durée | Contenu | Porte | Bots | Jouable ? |
|---|---|---|---|---|---|---|
| **0** | **Le harnais** | ✅ **fait** | `run.ts`, `levier.ts`, `balance.ts`, `bots.ts`, `perf.ts`, `trace.ts`, `comparer.ts`, CI — **portés**, pas réécrits | **levier connecté** ✅ | — | — |
| **1** | **Le labo** | **3-4 sem** | conception (dont `instabilite_neuro`), 1 nœud, **le marché de §4 porté au scalpel** (§13) + la boucle de dépendance, trésorerie simple, **la dette** (§1bis), **branche Chimie** (§2bis) | 2, **7** (1 et 3 → jalon 2, voir §16) | 2 | **oui** |
| **2** | **Le graphe & le parc** | **5-7 sem** | nœuds, arêtes, **les 5 engins**, usure, entretien, pannes, saisies, visibilité, **branche Logistique** (recherche et production **écrites ici**), **le catalogue de 3 recettes** (§2) | + **1, 3**, 8, 9, 15 | 2 | **oui** |
| **3** | **L'argent sale** | 2-3 sem | double trésorerie **non fongible** (§5), les deux bourses au HUD (§12bis), commerces, **corruption**, **élimination**, cash physique, **branche Influence** | + **10, 11, 16, 17, 18** | 3 | **oui — jeu fini et vendable** |
| **4** | **Les hommes** | **3 sem** | bras droits, loyauté, ambition, trahison, arrestations, équipages | + **12** | 3 | oui |
| **5** | **L'épidémie** | 3-4 sem | propagation, équipes, instabilité mondiale | + **13, 14** | 4 | oui |
| **6** | **Le remède** | 2-3 sem | jauge, aide/sabotage, les 4 fins, épilogues | **§16 en entier** | 4 | **complet** |
| **7** | **Le playtest** | ouverte | des humains, pas des bots | qualitatif | humains | — |

**Jalons 0→3 : ~10 à 14 semaines. Jalons 0→6 : ~18 à 24 semaines.** Estimations sur un rythme
soutenu, à pondérer par le temps réellement disponible.

**Ces chiffres ont monté, et c'est la décision de §13 qui les a fait monter.** La v1 annonçait
9-13 et 16-22 en supposant que `market.gd`, `research.gd`, `production.gd` et `engineers.gd`
arrivaient tout faits. Le marché est finalement porté (au scalpel, pas réécrit), mais les
trois autres s'écrivent ici : +1 semaine au jalon 1 (le port et la boucle de dépendance),
+1-2 au jalon 2 (recherche et production), +1 au jalon 4 (les bras droits). Une estimation qui
suppose une décision annulée est pire que pas d'estimation.

**Le jalon 2 est le plus lourd** — le graphe, le parc, plus deux modules à écrire.
**Le jalon 5 reste celui qui glissera** : propagation et instabilité n'ont d'équivalent nulle
part, ni dans `bureau-etudes` ni ailleurs dans ce document.

Si le développement s'arrête au jalon 3, **il reste un jeu fini et vendable** : conception,
réseau, flotte, corruption, blanchiment. C'est le but de cet ordre, et l'ajout du parc le
renforce au lieu de le repousser.

### Jalon 0 — le seul test qui compte

Porter le harnais, puis **casser volontairement une constante de 30 % dans `constants.json`
et vérifier qu'un verdict passe au rouge.** Si rien ne bouge, le levier est débranché et
l'équilibrage se fera dans le vide pendant six mois. C'est la règle de méthode de §16
(« un résultat bit-identique n'est pas une confirmation ») appliquée au harnais lui-même,
avant qu'il ne mesure quoi que ce soit.

### Phase 7 — le playtest humain

§16 l'écrit noir sur blanc : *un harnais de bots ne valide pas un correctif anti-exploit
joueur.* Ce que les bots ne verront jamais :

- la stratégie dégénérée que le premier joueur trouvera en deux heures
- si la fourche de l'acte III **se ressent** comme un choix ou comme une fatalité
- si `instabilite_neuro` est lu par un humain, ou ignoré parce qu'il ne fait rien pendant
  trois heures

La cible n'est pas chiffrée, elle est qualitative : **le joueur dit-il « j'ai fait ça » ou
« le jeu m'a fait ça » ?** Les quatre fins ne valent que si la réponse est la première.

---

## 16. Cibles d'équilibrage

### Bots (`src/tests/bots.ts`)

| Bot | Comportement | Disponible à partir de |
|---|---|---|
| `discret` | petit volume, produit propre, jamais d'épidémie | jalon 1 |
| `industriel` | gros volume, produit puissant, aide le remède quand ça dérape | jalon 1 |
| `grossiste` | la rue en gros : coupé, haut rendement, gros lots, agent exaltant — ne regarde pas sa jauge | jalon 1 (choix de conception) |
| `orfevre` | petit volume haut de gamme qui se protège de tout : stabilisation, cristaux, petits lots, tampon | jalon 1 (choix de conception) |
| `opportuniste` | laisse brûler, nettoie uniquement ses nœuds rentables | jalon 3 |
| `accelerateur` | sabote activement le remède, vise `L'HÉRITIER` | jalon 5 |

Lancer un bot avant que son système existe produit du bruit qu'on prendra pour un signal.
**L'inverse est vrai aussi** : un système qui existe sans profil pour le jouer est un angle mort.
`grossiste` et `orfevre` sont nés le jour où la grille a gagné ses cases de jonction (§2bis) —
vingt cases sur vingt-sept ne servaient alors à aucun témoin. Leur intention est écrite dans
`src/tests/bots.ts` avant toute mesure. Ce qu'ils ont dit dès la première mesure : la rue en gros
sur Verdal, sans se couvrir, se faisait arrêter en un an et demi, et la cible 2 (mortalité de
démarrage) est passée au rouge. Le jeu a été ajusté, pas le témoin (`visibilite.k_volume`,
voir `data/constants.json`).
`opportuniste` et `accelerateur` restent donc hors du harnais jusqu'à leurs jalons respectifs.

### Conventions

Reprendre telles quelles les conventions déjà éprouvées dans `bureau-etudes/src/tests/balance.ts`
(nombre de graines réglable en argument, verdict de mortalité de démarrage, écart de richesse
en plus du taux de victoire). **Ce harnais est mûr : le porter, pas le réinventer.**

**LES TABLEAUX DE MESURES DE CETTE SECTION SONT DES RELEVÉS DATÉS, PAS L'ÉTAT COURANT.**
Le code du projet interdit depuis longtemps qu'un commentaire porte un chiffre mesuré : il
garde le raisonnement et nomme la commande, parce que le chiffre périme et que personne ne
relit un commentaire. **La règle n'avait jamais été appliquée à ce document**, qui est
pourtant la source de vérité — et une seule session y a ajouté quatre tableaux. L'un d'eux
était déjà irreproductible : il exprimait l'écart de richesse en instantané, unité que la
cible 3 a depuis remplacée par une intégrale.

Chaque tableau porte donc ce qui l'a produit et dans quelle unité. Il raconte ce qu'une
décision a changé — un fait historique, qui reste vrai. Il ne dit pas où en est le jeu
aujourd'hui, ce qui se lit en lançant `src/tests/balance.ts`.

**LA PORTÉE PAR BOT — mesure d'abord, verdict au jalon 2.** `src/tests/levier.ts` demande « au
moins une métrique bouge » en mettant les bots en commun : une constante qui secoue un seul
profil passe au vert, et l'autre joue à un jeu dont ce levier n'existe pas. C'est le même
refuge que celui fermé sur la jauge de visibilité, rouvert un étage plus haut.

Cette mesure a servi **le jour même où elle a été ajoutée** : elle disait que `discret` ne
sentait que 20 des 92 leviers de campagne, ce qui a mené au diagnostic du marché décoratif
et à §19.6. Après correction : **91 sur 95**. Le chiffre exact est imprimé à chaque
exécution et n'est pas recopié ici.

Ce n'est toujours pas un verdict, et le refus reste délibéré : §16 dit « on ajoute la MESURE
avant d'en faire une CONTRAINTE ». Il le devient au jalon 2, quand les cinq derniers écarts
auront été regardés un par un — un profil qui ne se fait jamais arrêter ne DOIT pas sentir
les constantes d'arrestation, et un verdict aveugle à cette distinction serait un poteau
qu'on déplace. Les six constantes qui ne bougent que les specs de référence sont comptées à part :
ce sont des constantes de conception (§2), aucune campagne ne peut les atteindre, et les
confondre avec un angle mort accuserait les bots d'une chose dont ils ne peuvent rien.

### Cibles permanentes — mesurables dès le jalon 1

```
1. MORTALITÉ GLOBALE LISIBLE
   faillites bot entre 15 % et 35 %
   ↳ mesurable au jalon 1 parce que la dette (§1bis) donne une horloge à l'acte I
   ↳ ⚠ CORRIGÉ PAR LA MESURE : PAS avant le jalon 2. Voir plus bas.

2. MORTALITÉ DE DÉMARRAGE BORNÉE
   < 10 % des campagnes meurent avant la semaine 104
   ↳ garde-fou anti-régression, PAS une cible à atteindre

3. AUCUNE DOMINATION
   (taux de victoire max ≤ 60 %  OU  écart de richesse MOYENNE ≤ 15 %)
   ET écart de SURVIE entre bots < 80 points
   ↳ le OU est délibéré : gagner 76 % de photo-finish en finissant 11 % plus riche
     est une égalité, pas une domination. Le taux de victoire seul ne distingue pas
     un écrasement d'un départage.
   ↳ ⚠ LE TERME DE SURVIE EST UN ET, ajouté après mesure. Le OU avalait le vrai rouge
     autant que le faux : `discret` survit à 100 %, `industriel` est arrêté dans 100 %
     des campagnes, et la cible imprimait « aucune domination : victoires max 100 % »
     parce que l'écart de richesse, pris semaine 200, tombe 27 semaines avant que le
     perdant meure. Aucun écart de richesse ne rachète 0 % contre 100 % de survie.
   ↳ la richesse se mesure en INTÉGRALE — le propre moyen tenu jusqu'à la date, pas
     sa valeur ce jour-là. Depuis §2bis un bot sort 280 000 $ d'un coup pour un nœud,
     et l'instantané mesurait la semaine du paiement. RELEVÉ du jour où la métrique a
     changé (`balayage.ts colonne_seche.cout_propre 200000 420000 6 20`) : l'instantané
     balayait de +376 à +1133 % puis repartait à +181 %, six fois d'amplitude et un
     demi-tour ; l'intégrale descendait de +109 à +99 %, monotone. Le point échantillonnait
     un accident de trésorerie. Ce relevé compare DEUX MÉTRIQUES entre elles, ce que la
     commande ne refait plus : elle n'imprime que celle qui a gagné.
   ↳ CE N'EST PAS UN DOUBLON DE LA CIBLE 1, qui regarde la mortalité MOYENNE : un jeu
     réglé pour que l'imprudent meure une fois sur deux et le prudent jamais afficherait
     25 % — dans la fourchette, au vert — en n'ayant qu'un seul chemin jouable.
   ↳ au jalon 1-2, se mesure entre les DEUX bots présents

23. LA RECHERCHE N'EST PAS UN PÉAGE                          [JALON 1]
    un profil qui ne cherche RIEN survit dans >= 80 % de ses campagnes
    ↳ écrite le jour où §2bis est née, jamais rétro-ajoutée
    ↳ c'est la seule phrase de §2bis qui puisse devenir fausse en SILENCE :
      un arbre qui devient obligatoire ne se voit nulle part ailleurs, et les
      cibles 1 et 3 resteraient vertes pendant que le jeu perd sa voie pauvre
    ↳ ne s'applique qu'aux bots à zéro nœud — ce sont eux qui la testent

7. ÉCART SUR instabilite_neuro                              [JALON 1]
   industriel ≥ 0.50, discret ≤ 0.25, sur la médiane des graines
   ↳ vérifie que l'axe DISCRIMINE alors qu'il ne fait encore rien.
     C'est la cible la plus importante du projet : un axe non mesuré à sa
     naissance devient un levier qu'on découvre mort deux ans plus tard.
```

### Le marché ne décidait rien — mesuré, diagnostiqué, corrigé (§19.6)

Écrit après la dixième passe de critique du harnais, et c'est la plus grosse correction que
ce document ait reçue de la mesure. **Le constat ci-dessous est celui d'AVANT §19.6** ; ce
que sa correction a produit est en fin de section.

**Le joueur est limité par son STOCK à 100 % des trimestres**, sur les deux profils-témoins
et sur toutes les graines mesurées : `vendu = stock`, toujours. Il ne rencontre jamais sa
demande — `discret` en sert 34 %, `industriel` 60 %. Et comme le prix du joueur est **un
seul nombre pour les trois segments**, la recette vaut `stock × prix` quel que soit
l'acheteur.

Conséquence : les parts de marché sont décoratives pour la recette. `attractivite`,
`qualite_s`, `f_prix`, l'inertie, les parts au carré, les exposants par segment et le seuil
d'exclusivité déplacent des parts — **aucune issue de campagne**. Les trois segments sont,
économiquement, un seul segment.

**Ce n'est pas un problème de taille de marché**, et c'est la mesure qui l'a tranché contre
l'hypothèse de départ. En réduisant toutes les demandes ensemble :

```
RELEVÉ — avant §19.6 (prix unique) · 20 graines × 2 bots · écart en INSTANTANÉ de richesse,
unité abandonnée depuis (la cible 3 compare une intégrale) : non reproductible tel quel.
échelle    ×1.0   ×0.9   ×0.8   ×0.7   ×0.6   ×0.5   ×0.4   ×0.3   ×0.2
le marché bride `discret`    0 %    0 %    1 %    4 %   22 %   50 %   78 %   96 %  100 %
écart de richesse (cible 3) +11 %  +18 %  +27 %  +42 %  +61 % +276 % +224 %  +91 %  +66 %
```

C'est une **pente** et non une falaise : le marché atteint le profil prudent en dessous de
×0.6. Mais il détruit la cible 3 en chemin, et même à ×0.2 le joueur ne sert que 77 % de sa
demande — parce qu'il est bridé ailleurs (sa part de capacité, son débit de blanchiment),
jamais par le marché. **Le chiffre de `data/` qui devait arbitrer cette question n'existe
pas.** La capacité du labo ne l'arbitre pas non plus : balayée de 40 à 200 kg/sem, elle est
un **plateau** au-delà de 80.

Ce qui manque est ailleurs, et ce document le disait déjà sans le voir : le tableau des
segments ci-dessus donne à chacun un **niveau de prix** (`rue` : bas ; `haut_de_gamme` : très
élevé) que la simulation n'implémente pas. Avec un prix par segment et un joueur limité par
son stock, **où vont les kilos devient la décision** — et le marché mord sans qu'on touche à
une seule demande.

#### Ce que la correction a produit

Tranché en §19.6 : un prix par segment, et un `niveau_prix` par segment dans `data/`. Livré
en deux temps — le mécanisme d'abord, à résultat **bit-identique** (les trois prix posés
égaux reproduisent exactement le comportement d'avant), puis la différenciation seule. Deux
changements mêlés n'auraient rien mesuré.

```
RELEVÉ — §19.6, avant/après le prix par segment · portée par `src/tests/levier.ts`, le reste par
`src/tests/balance.ts`. Les compteurs du jour s'impriment à chaque exécution.
                                        avant        après
leviers de campagne sentis par `discret`   20 / 92     91 / 95
                        hors de portée      78 %          5 %
`rue.niveau_prix`                            —      2ᵉ constante la plus sensible sur 114
fins de campagne basculées par le marché     0        oui (`milieu.niveau_prix`)
tas de sale médian de `discret`           714 k$       3,0 M$
visibilité médiane de `discret`              0,0         50,5
```

**Le refuge est fermé.** Les cinq leviers qui restent hors de portée de `discret` sont
nommables et défendables : l'échéance de la dette et les trois constantes d'arrestation ne
l'atteignent pas parce qu'il rembourse et ne se fait pas prendre, et `corymbe.disponibilite`
parce qu'il travaille le Verdal. Ce n'est plus un trou systémique, c'est un profil.

**Deux choses ont cassé en chemin, et les deux gardes les ont attrapées.** Le garde
`_soutenable` des bots lisait le prix le plus BAS en se croyant prudent : prudent sur la
production, mais sa phrase parle du TAS, et le tas grossit au prix encaissé. La mortalité
est passée de 50 % à 100 % en une mesure. Il lit désormais le prix pondéré par les segments
qu'il sert, comme `_ecoulable` lit leur volume. Et `SEMAINE_COMPARAISON` s'est retrouvée
APRÈS la première mort (remontée de la semaine 227 à 185) : la garde `jalon_douteux` a crié
que l'écart de richesse comparait l'instantané d'un mort, et la date a été **remesurée à
170**, pas relue.

**`SATUREES` est désormais vide, et c'est le mécanisme qui l'a vidée.** `los_hermanos.marge`
y était parce que le rabais de ce cartel butait sur `plafond_prix` dans les deux sens. Les
médianes de segment se sont mises à bouger avec le prix du joueur, la constante s'est remise
à mordre, et la vérification à double sens a fait échouer la porte en exigeant le retrait.
Sixième exemption que ce mécanisme retire tout seul.

### L'ordre de service était porté par l'alphabet

Les trois segments puisent dans le **même stock**, donc le premier servi se sert et le
dernier mange la pénurie. Cet ordre était celui de `sort()` sur les clés — `haut_de_gamme`,
`milieu`, `rue`. Mesuré en l'inversant : `industriel` perd **54 106 $** semaine 200 et
l'écart de la cible 3 passe de +11 % à +13 %, soit deux points sur les quinze du seuil.
Renommer `rue` en `bas_de_gamme` aurait changé l'économie.

Il est maintenant déclaré dans `data/segments.json:ordre_service`, sous forme de **liste**.
Écrit d'abord en trois nombres (`priorite_service: 1/2/3`), il s'est fait refuser par la
porte du jalon 0 en trois lignes : perturbés d'un cran entier ils s'égalisaient, le nom
tranchait, l'ordre ne changeait jamais — **trois leviers débranchés**. Un rang n'est pas une
grandeur. C'est `src/tests/run.ts` qui le garde honnête, par un test de couverture : la liste
doit nommer exactement les segments.

### Ce que §2bis a coûté aux témoins — mesuré

La recherche ne change rien pour qui ne cherche pas : **`discret` est identique au dollar
près**, ne pose aucun nœud, survit à 100 % — la cible 23 tient, et c'est la promesse centrale
de §2bis.

Pour `industriel`, le coût est lourd et il faut le nommer. Sa recette cible (corymbe, pureté
0,95, complexité 2) est **interdite au départ** : il commence en verdal à 0,60, c'est-à-dire
tout près du témoin prudent, et grimpe. Or le verdal est le précurseur le plus traçable
(0,55 contre 0,28 au corymbe) et le plus disponible (1,0 contre 0,78) — donc **plus de traces
sur plus de kilos**. À plein régime, soixante semaines de verdal coûtent 78 semaines de vie :

```
RELEVÉ — §2bis, avant/après la branche Chimie · 100 graines × 2 bots
                                   avant §2bis    après
mort de `industriel`                  sem 187     sem 109
nœuds posés                                 —     sem 56, 70, 76, 82, 98
instabilite_neuro (cible 7)             0.667     0.667 — tenue 11 semaines
`SEMAINE_COMPARAISON` remesurée           170     95
```

**L'ordre de recherche est une stratégie, et la mesure a corrigé le mien.** J'avais mis la
pureté en tête, en me disant que le plafond de 0,60 bridait plus fort. Il restait alors 50
semaines sur le verdal et se faisait arrêter **semaine 62**. En prenant la famille d'abord,
sa signature tombe de moitié dès la semaine 70. C'est la différence entre un témoin qui joue
mal — son droit — et un témoin qui joue bête, jamais.

**Une constante est tombée en dormance par effet de bord.** `marche.plafond_fidelite` mordait
à 3 % sur les seules campagnes longues d'`industriel` ; il meurt 78 semaines plus tôt et n'y
arrive plus. Aucune mécanique n'a été débranchée : c'est la durée de vie des témoins qui a
changé. La baseline se remesure, elle ne se cite pas.

**La butée de famille était décidée par `sort()`, et son accident était heureux.** Quand un
joueur demande une famille verrouillée, `src/sim/produit.ts` le ramène en butée. Cette butée
était `ouvertes[0]` après tri alphabétique : `industriel`, qui vise le corymbe, recevait donc
l'azurite entre ses semaines 56 et 70 — par chance, parce que « a » vient avant « v ». En la
déclarant (`famille_defaut`, stable), il repartait sur le précurseur le plus traçable et
mourait dix semaines plus tôt. **Les deux comportements étaient des accidents.** La butée
reste déclarée — c'est un filet, pas un chemin de jeu — et c'est le BOT qui choisit
maintenant, en relisant sa propre liste de recherche à l'envers : il prend la dernière
famille qu'il a ouverte sur son chemin. Un joueur fait de même, et son écran ne lui propose
que ce qu'il a ouvert (§12bis).

**Et la portée de `discret` est retombée de 5 % à 16 % hors d'atteinte** — 18 leviers sur 110.
Les 13 nouveaux sont tous des constantes de recherche, et il ne cherche rien. Ce n'est pas un
trou, c'est la définition du profil ; c'est exactement pourquoi cette mesure n'est pas encore
un verdict.

### Ce que les trois contreparties de §2 ont coûté aux témoins — mesuré

```
RELEVÉ — les curseurs de §2 reçoivent leur contrepartie · 100 graines × 2 bots
                                         avant       après
mort de `industriel`                    sem 109     sem 162
`discret` (coupe 0.35, comme avant)     survit      arrêté sem 150 — cible 23 ROUGE
`discret` (coupe ramenée à 0)           survit      survit — cible 23 verte
calibration : échelle des coûts           —         −34 à −60 % selon la recette
```

**`industriel` vit 53 semaines de plus**, parce qu'il payait sa complexité 2 pour rien et
qu'elle lui rapporte enfin : elle rend sa pureté 0,95 moins chère.

**`discret` s'est retrouvé en contradiction avec lui-même.** Sa recette portait une coupe de
0,35, choisie à l'époque où couper était un handicap pur — elle voulait dire « produit de rue
bon marché » et rien d'autre. Couper est devenu un levier de VOLUME : 54 % de kilos en plus, une
jauge à 103, arrêté semaine 150, et la cible 23 — « la recherche n'est pas un péage » — au rouge.
Un témoin « petit volume, produit propre » qui coupe à 35 % se contredit. Sa coupe est revenue à
zéro. **La cible 23 qui repasse au vert est la conséquence, pas la raison** : c'est l'intention
écrite du témoin qui a été restaurée, et la cible l'a constaté.

**La calibration a été remesurée, et c'est dangereux.** Le modèle de coût a changé délibérément,
donc l'échelle a baissé ; les puissances et les instabilités n'ont pas bougé d'un chiffre. Mais
une calibration qu'on réaligne sur ce que le code produit ne peut plus jamais échouer — c'est
le poteau qu'on déplace. `src/tests/run.ts` vérifie donc EN PLUS les **ordres**, qui expriment
l'intention et qu'aucune remesure ne satisfait toute seule : familles strictement croissantes
en coût, en puissance et en instabilité ; rue < haut de gamme < extrême.

**Les `ref` du segment `rue` ont été réancrées.** La coupe a déplacé l'échelle de coût et de
débit sous ces références, calibrées sur l'ancienne : le meilleur produit de rue atteignait
exactement le plafond théorique, avec dix recettes à égalité au sommet — le segment ne
départageait plus par la qualité. J'avais remesuré `calibration.json` et oublié
`segments.json`, qui encode la même échelle. Le réancrage retenu est le plus petit qui décolle
le segment du plafond (coût 2200 → 1760, débit 22 → 27,5) : il ramène son maximum au niveau
d'avant les contreparties. `milieu` et `haut_de_gamme` étaient restés sous le plafond et n'ont
pas été touchés. Effet mesuré : `industriel` vit cinq semaines de plus, aucune cible ne change
de verdict.

**`los_hermanos.marge` a fait un aller-retour dans `SATUREES`.** Entrée la première fois parce
que le rival le moins cher n'est jamais la médiane de trois maisons ; retirée par le mécanisme
quand §19.6 a fait bouger les médianes ; revenue quand la baisse des coûts a recreusé l'écart.
Balayée de 0,8 à 3,2 — un facteur quatre — elle ne déplace pas une seule issue : **la stratégie
de prix du rival le moins cher est décorative** dans le jeu actuel. Constat de design, qui
attend le catalogue du jalon 2.

### Les cibles 1 et 3 attendent le jalon 2 — mesuré, pas supposé

Écrit après l'équilibrage du jalon 1, et c'est une correction de ce document par la mesure.

**Tout ce qui existe à l'acte I est LISSE.** Le tas d'argent sale est une intégrale, le bruit
de demande s'y moyenne, la date d'arrestation est donc identique à la semaine près sur cent
graines. Conséquence directe : la mortalité ne prend pas de valeurs intermédiaires. Balayage
de `visibilite.k_cash_sale` de 0.60 à 1.30 en huit points :

```
0.60 → mortalité  0 %                        (la jauge ne tue jamais)
0.70 → mortalité 50 %, mort médiane sem 260  (elle tue toujours)
1.30 → mortalité 50 %, mort médiane sem 215  (seule la DATE glisse)
```

Il n'y a **aucune valeur** donnant 15-35 %. Ce n'est pas un réglage manqué, c'est l'absence
d'un **risque grumeleux** : saisies, descentes, pannes (§3bis, §7 — `raids.ts` et
`accidents.ts`, jalon 2). Tant qu'ils manquent, la cible 1 ne peut valoir que 0 %, 50 % ou
100 %, et la cible 3 tombe avec elle (un bot qui meurt à toutes les graines n'a pas de
richesse médiane, donc l'écart n'existe pas).

**Ce que ça change concrètement :** au jalon 1, la porte est **2 et 7**. Les cibles 1 et 3
restent écrites, mesurées et imprimées à chaque exécution — elles ne sont simplement pas
tenables avant que le parc n'apporte de quoi mourir autrement qu'à l'heure dite.

**La leçon de méthode, qui vaut plus que la correction :** ces cibles ont été *atteintes*
un moment, en déplaçant `k_cash_sale` jusqu'à ce que personne ne meure. Le jeu était alors
pire — l'`industriel` finissait à 92 de visibilité sur 100 sans jamais être arrêté, la
menace centrale de l'acte II réduite à un décor. **Une cible verte obtenue en éteignant ce
qu'elle mesure est pire qu'une cible rouge.** C'est le poteau qu'on déplace pour passer,
nommé en §16, et il a fallu le planter deux fois pour le reconnaître.

### Cibles du parc et du graphe — jalon 2

```
8. LES CINQ ENGINS SONT VIVANTS
   chaque engin est acheté par un bot dans ≥ 10 % des graines
   ↳ un engin sous 10 % est de la décoration : soit ses données sont fausses,
     soit il est vraiment redondant et il faut l'assumer en ponytail:
   ↳ c'est ici que se tranche la fusion jet-ski / vedette (§3bis)

9. LA VISIBILITÉ RESPIRE
   industriel franchit 60 (« Identifié ») dans 40-80 % des graines
   ↳ < 40 % : la jauge ne mord pas · > 80 % : elle est subie, pas pilotée

15. LE PARC PÈSE
    l'entretien de la flotte = 15-40 % des dépenses PROPRES à mi-partie
    ↳ < 15 % : posséder des engins n'est pas une décision, c'est un achat unique
    ↳ > 40 % : le jeu est une simulation de garage
```

### Cibles de l'argent, de la corruption et de l'élimination — jalon 3

```
10. L'ÉTAU SE RESSERRE TOUT SEUL
    ratio cash_sale / cash_propre croissant sur la médiane, semaines 60 → 150,
    sans tuning
    ↳ c'est l'affirmation centrale de §5 — si elle est fausse, la courbe de
      difficulté du jeu n'existe pas

11. LES FAILLITES SONT VARIÉES
    aucune cause unique > 60 % des faillites
    ↳ si tout le monde meurt de saisie, le blanchiment est cosmétique

16. LA CORRUPTION CONSOMME
    le stock de cash_sale de industriel N'EST PAS monotone croissant
    ↳ s'il l'est, la corruption est trop bon marché ou trop rare : le sale
      n'a pas de sortie et §5 est un dessin, pas un circuit

17. LES CONTACTS SE FONT PRENDRE
    1 à 4 découvertes de contact par campagne sur la médiane
    ↳ 0 : le risque est décoratif · > 4 : c'est un impôt, pas un pari

18. L'ÉLIMINATION RESTE UN PARI DE DÉSESPOIR
    un bot variant qui élimine systématiquement NE gagne PAS plus qu'industriel
    ↳ espérance volontairement négative (§5ter). Si le spam d'éliminations
      gagne, le système devient la réponse à tout et remplace la corruption.
    ↳ c'est la seule cible du harnais qui teste une NON-stratégie
```

```
21. LE TRAÎTRE PÈSE                                         [JALON 4]
    un rival issu d'une trahison survit ≥ 40 semaines dans la médiane
    des campagnes où il apparaît
    ↳ s'il meurt aussitôt, la punition redevient comptable

22. LE CATALOGUE EST UTILISÉ                                [JALON 1]
    industriel tient ≥ 2 recettes actives dans ≥ 50 % des graines,
    et la recette de plus forte instabilite_neuro vise haut_de_gamme
    ↳ si une seule recette suffit, les segments de §4 sont décoratifs
    ↳ la seconde moitié vérifie que le piège est bien là où on croit

19. AUCUNE BRANCHE MORTE                                    [JALON 3]
    chaque branche de recherche reçoit ≥ 20 % des dépenses de R&D
    d'au moins un bot, sur la médiane
    ↳ une branche que personne n'ouvre est une vingtaine de cases de contenu
      mort et autant de constantes d'équilibrage à maintenir pour rien
```

### Cibles de l'acte III — jalons 5 et 6

```
13. L'ÉPIDÉMIE ARRIVE                                       [JALON 5]
    déclenchée dans ≥ 80 % des campagnes de industriel, ≤ 20 % de discret
    ↳ atteignable parce que la charge (§8) rend le déclenchement certain
      au-dessus du seuil : l'aléa décide QUAND, pas SI

14. LA PROPAGATION SUIT LE RÉSEAU                           [JALON 5]
    corrélation positive entre le nombre d'arêtes actives d'un bot et sa
    vitesse d'instabilité
    ↳ si elle est nulle, la phrase de vente du jeu est fausse dans le code.
      Elle se mesure, elle ne se suppose pas.

4. CHAQUE BOT REMPLIT SON RÔLE                              [JALON 6]
   les bots ne sont PAS quatre stratégies joueur symétriques. `discret` est un
   profil-témoin : il doit finir pauvre et survivant. `accelerateur` doit atteindre
   L'HÉRITIER ≥ 30 % du temps ou il ne mesure rien.
   ↳ la cible est « conforme à son rôle », jamais « gagne autant que les autres »

5. LES SIX FINS SONT ATTEINTES                              [JALON 6]
   chacune ≥ 5 % des campagnes, tous bots confondus
   ↳ L'ARTISAN comprise : c'est la fin de discret, et si elle n'est jamais
     atteinte, le bot témoin ne témoigne de rien
   ↳ LE BIENFAITEUR comprise : voir la cible 20

20. LA TROISIÈME VOIE EST UN PARI, PAS UNE SORTIE                [JALON 6]
    le remède fabriqué par le joueur aboutit dans 5-20 % des campagnes
    de industriel
    ↳ < 5 % : trop cher, c'est un nœud d'arbre mort
    ↳ > 20 % : c'est la sortie de secours universelle et la fourche
      de l'acte III n'existe plus

6. LA COURSE EST UNE VRAIE COURSE                           [JALON 6]
   le remède aboutit dans 30-60 % des campagnes
   ↳ < 30 % : l'épidémie est inévitable, le joueur n'a pas d'agentivité
   ↳ > 60 % : l'acte III est décoratif
```

### Méthode — les règles qui coûtent le plus cher quand on les oublie

Toutes vécues sur `bureau-etudes`. Elles valent plus que les seuils ci-dessus.

- **On ajoute la MESURE avant d'en faire une CONTRAINTE.** Un verdict posé sur une intuition
  non mesurée devient un poteau qu'on déplace ensuite pour passer.
- **n < 10 ne prouve rien.** Deux faillites à la même date ne sont pas une falaise
  déterministe, c'est un échantillon de deux points.
- **Un bot est une fixture, pas un joueur.** Un profil-témoin qui perd fait son travail.
- **Un résultat bit-identique après un changement de 20 % n'est pas une confirmation,
  c'est un levier débranché** — aller le vérifier.
- **La baseline se remesure**, elle ne se cite pas depuis une note ancienne.
- **Un harnais de bots ne valide pas un correctif anti-exploit joueur**, il vérifie
  seulement qu'il ne casse rien. La validation est un playtest (§15, phase 7).
- **Un audit externe se trie contre le code, pas contre l'intuition.** Deux faux positifs
  sont particulièrement attirants et ont été produits deux fois par deux relecteurs
  différents : « cette stratégie est morte » (c'était un témoin) et « il y a une falaise
  déterministe » (c'était n = 2).

### Vitesse du harnais

Nombre de graines **réglable en argument** (`-s res://tests/balance.ts 20`), défaut 100.
20 pour itérer (~2 min), 100 pour valider un jalon. À 10 minutes la boucle, l'équilibrage
devient impraticable et on se met à deviner au lieu de mesurer.

---

## 17. Simplifications assumées (`ponytail:`)

Volontairement absents. Chacun est une ligne à ajouter plus tard, pas une dette cachée.

- **Aucun combat, aucune arme, aucun contrôle direct d'unité.** Le joueur décide, il ne pilote pas.
- **Aucune conquête post-effondrement.** `L'HÉRITIER` est un épilogue calculé, pas une phase.
- **2 rivaux simulés + 1 emplacement de traître.** Ils ne font pas faillite avant l'acte III.
- **3 recettes actives maximum.** Au-delà, l'écran de conception devient un tableur.
- **Pas de plafond de flotte.** On achète autant d'engins qu'on peut en entretenir ; les trois
  freins sont économiques, jamais une règle.
- **Une vingtaine de cases de recherche par branche** (§2bis, grille à la Plague Inc). Révisé
  deux fois : 12 au total, puis 22, puis une vingtaine par branche sur décision de
  l'utilisateur. Le coût est connu et accepté : les bots deviennent plus durs à lire, et la
  grille Chimie a déjà onze cases dormantes au levier. Ce plafond-là ne doit plus monter.
- **Aucune monnaie de recherche convertible.** La recherche se paie en `cash_propre` et en
  savoir-faire, qui s'apprend en produisant et ne s'achète ni ne se vend (§2bis). Un jeton de
  type ADN échangeable serait une conversion déguisée et contredirait la règle du papier (§5).
- **Pas de multijoueur, pas de co-op.** Le genre s'y prête ; le périmètre non.
- **Pas de carte dessinée.** Un graphe lisible, des nœuds, des arêtes, des chiffres.
- **Chimie entièrement fictive.** Contrainte permanente, pas une étape de polish.
- **Aucun pilotage manuel de flotte.** Les engins ont un nœud d'attache, le repositionnement
  est automatique et coûte du délai. Gérer une flotte à la main est un jeu entier à lui seul.
- **5 engins, pas quinze.** Chacun occupe un coin distinct de l'espace
  capacité/coût/délai/visibilité/équipage. La frontière jet-ski / vedette est la seule
  fragile, et la cible 8 la tranchera par la mesure.
- **Pas de scène d'élimination.** Une décision, un tirage, un texte. Aucune représentation.
- **Aucun bouton de conversion sale → propre.** Le blanchiment est un débit hebdomadaire
  plafonné, jamais un guichet. Un joueur riche en sale et sec en propre doit attendre.

---

## 18. Contrainte commerciale à connaître dès le jour 1

Le thème interdit toute publicité payante — Meta, Google et TikTok bannissent le contenu
drogue. La découverte passera par la page Steam, les tags, la presse spécialisée et le
bouche-à-oreille.

Deux conséquences concrètes sur le développement :

1. **Le crochet doit être dans la première capture d'écran.** « Sim de cartel » est un terrain
   encombré. « Ton produit déclenche l'épidémie, et elle remonte tes propres routes » ne l'est
   pas. Les trois jauges doivent être visibles et lisibles sur chaque capture.
2. **Ouvrir la page Steam au jalon 2**, pas à la fin. Les wishlists prédisent la première
   semaine, et elles s'accumulent pendant que le reste se construit.

Prévoir également que certains pays refusent la classification aux jeux jugés promouvoir
l'usage de drogues illégales. La substance fictive et l'absence totale de chimie réelle sont
la meilleure protection disponible, et elles ne coûtent rien au design.

---

## 19. Décisions tranchées

**Les cinq points sont tranchés et intégrés au corps du document.** Cette section ne garde que
la trace de ce qui a été décidé et pourquoi. Il n'y a plus de dépendance en suspens : chaque
cible de §16 est portée par un système qui existe.

### 19.1 — La dette de départ — ✅ ADOPTÉ, voir §1bis

Tranché. L'acte I a son horloge : dette remboursable en semaine 60, en argent propre, fin
courte `SAISIE` si l'échéance passe. Le créancier revient en acte II réclamer un nœud.
Les cibles 1 et 2 de §16 sont désormais mesurables au jalon 1.

### 19.2 — L'épidémie garantie — ✅ ADOPTÉ, voir §8 et §11

Tranché. Le tirage par trimestre est remplacé par une **charge cachée** : l'aléa décide quand
le seuil est franchi, plus s'il l'est. Un joueur qui reste sous `instabilite_neuro` 0.55 ne
déclenche jamais rien — et obtient **L'ARTISAN**, cinquième fin. La cible 13 est désormais
atteignable, et la cible 5 passe de quatre à cinq fins.

### 19.3 — Le remède fabricable par le joueur — ✅ ADOPTÉ, voir §10 et §2bis

Tranché. 20ᵉ hexagone, terminal, de la grille Chimie. Il alimente `progres_remede` **sans passer par
`capacite_institutionnelle`**, donc c'est la seule voie qui fonctionne encore au-dessus
d'instabilité 80. Sixième fin : **LE BIENFAITEUR**. Encadré par la cible 20 — 5 à 20 % des
campagnes de `industriel`, sinon c'est soit un nœud mort, soit une sortie de secours qui
annule la fourche de l'acte III.

### 19.4 — Le traître devient le troisième rival — ✅ ADOPTÉ, voir §4 et §6

Tranché. Emplacement réservé dans `rivaux.json`, rempli à l'exécution par un lieutenant qui
trahit, avec la recette du joueur figée à cet instant. Cible 21 : il doit survivre ≥ 40
semaines, sinon la punition redevient une ligne comptable.

### 19.5 — Le catalogue plutôt qu'une recette unique — ✅ ADOPTÉ, voir §2

Tranché. Jusqu'à 3 recettes actives simultanément. Cible 22 : deux recettes au moins chez
`industriel` dans la moitié des graines, et vérification que la recette la plus chargée en
`instabilite_neuro` est bien celle du haut de gamme — le piège doit être là où le document
prétend qu'il est.

### 19.6 — Un prix par segment — ✅ ADOPTÉ, voir §4 et §16

Tranché par le designer après mesure. Le joueur pose **un prix par segment** ; un prix nul
l'en retire. Le niveau que chaque segment tolère vit dans `data/segments.json:niveau_prix`,
comme déclaration du tableau de §4 — donc balayé par `src/tests/levier.ts` comme le reste, et
non comme un réglage de témoin.

**C'est la décision qui rend le marché opérant.** Avec un prix unique, un kilo rapportait la
même chose partout et les parts de marché ne décidaient de rien (§16). Les deux autres
formes envisagées ont été écartées : « un seul prix, et on gèle le marché » aurait demandé
de déclarer dormantes une trentaine de constantes jusqu'au jalon 2 ; « le prix posé par le
segment » aurait retiré une décision au joueur pour économiser trois lignes.

---

## 19bis. Décisions de design EN ATTENTE — elles appartiennent au designer

§19 dit qu'il n'y a plus de dépendance en suspens. C'est vrai des systèmes ; ça ne l'est pas
de tous les **chiffres de rythme**. Ceux-ci ont une valeur qui marche, posée pendant
l'équilibrage par celui qui implémentait, et qui n'est l'expression d'aucune intention
écrite. Ils sont listés ici plutôt que laissés dans `constants.json` comme s'ils étaient
tranchés.

### `visibilite.k_cash_sale` — combien de temps tient l'imprudent ?

**Valeur posée : 0.35.** Ce qu'elle produit : un producteur à plein régime qui ne se couvre
de rien est arrêté **semaine 227 sur 260**, soit ~33 semaines de traque jouables.

Ce que le balayage dit (`-s res://tests/balayage.ts visibilite.k_cash_sale 0.25 0.55 7`) :

```
0.25 → mort sem 244
0.35 → mort sem 227                    ← posé ici
0.45 → mort sem 214
0.55 → mort sem 204
```

**Troisième remesure de cette constante, et à chaque fois pour la même raison.** Elle est
passée de 1.0 à 0.5 quand `k_volume` a corrigé §1, puis de 0.5 à 0.35 quand le seuil de §4
a rendu son segment au producteur haut de gamme — il vend davantage, son tas grossit plus
vite, et l'arrestation est remontée à la semaine 209. Cette constante ne porte pas une
valeur, elle porte une INTENTION (~230 semaines) : toute mécanique qui change le débit
d'argent sale la déplace, et il faut la remesurer plutôt que la relire.

Il n'y a pas de bon chiffre à trouver : il y a un **rythme à choisir**. 0.5 est un pari sur
« assez tôt pour que le joueur ait le temps de réagir, assez tard pour qu'il ait cru s'en
sortir ». Un autre pari est légitime, et c'est une décision de design, pas d'implémentation.

**Les deux termes de §7 se partagent un budget.** `k_volume` (ce que l'activité coûte) et
`k_cash_sale` (ce que le tas coûte) alimentent la même jauge contre la même décroissance.
`k_volume` n'est PAS en attente — sa valeur sort d'une affirmation écrite de §1 (« tout ce
qui rapporte te rend visible ») qui était fausse à 0.012, où la production pesait 4 % de la
décroissance. Mais l'avoir corrigée a déplacé le rythme, et `k_cash_sale` a dû être
redescendue de 1.0 à 0.5 pour retenir l'intention ci-dessus. **Retoucher l'un oblige à
remesurer l'autre.**

`ponytail:` la jauge n'a pas d'équilibre, elle a un **seuil** : sous ~0.24 de `k_volume`
elle reste clouée à zéro pour toujours, au-dessus elle monte sans fin. Ce qui créera un
vrai point de repos, c'est la décroissance achetable des contacts (§5bis, jalon 3). D'ici
là, le joueur prudent est posé sur l'arête — 2 ou 41 de jauge selon des écarts minimes
ailleurs — et c'est une propriété du jeu d'aujourd'hui, pas un réglage à trouver.

`ponytail:` tant que cette ligne est ici, la valeur est **provisoire** — et personne n'a le
droit de la tourner pour faire passer une cible de §16.

---

## 20. Ce que ce document a appris en route

Trace des corrections apportées à la v1, pour ne pas les refaire.

- **Le réemploi promettait plus qu'il ne pouvait tenir.** §13 v1 reprenait douze modules de
  `bureau-etudes`, dont `market.gd` et ses 989 lignes. Vérification faite avant de trancher :
  l'équilibrage n'aurait PAS suivi (trois littéraux non triviaux en code sur 1 815 lignes,
  tous des conversions d'unités) — mais le modèle, si, avec l'historique de ses rustines.
  Décision : **le socle seulement**, plus **le marché**, qui est l'exception qui se justifie —
  §4 avait déjà adopté ses formules une par une, et refuser le fichier en gardant les formules
  aurait payé la réécriture sans acheter la sécurité. Il se porte au scalpel : ~590 lignes
  gardées sur 989. §13, §4 et §15 corrigent, et le planning passe de 16-22 à **18-24 semaines**.
  Le coût est réel et il est écrit ; c'est la condition pour qu'il soit un choix et pas une
  surprise.
- **La méfiance était au bon endroit, pas sur le bon objet.** Ce qu'il y avait à craindre
  dans `market.gd` n'était ni ses chiffres (mesurés : absents du code) ni ses formules
  (mesurées : déjà adoptées par §4), c'est la boucle que §4 lui AJOUTE —
  `demande_t+1 += dependance × ventes_t × k_fidelite`. Une rétroaction positive sans
  équivalent nulle part, qui divergera ou ne fera rien. Le harnais du jalon 0 existe pour
  s'en apercevoir au jalon 1 et pas au jalon 5.
- **Le parc n'existait pas.** Les routes étaient des arêtes tarifées ; on n'achetait rien, on
  n'entretenait rien, une saisie ne coûtait qu'une cargaison. §3bis corrige.
- **La corruption était un fantôme.** `protection_contact` apparaissait dans la formule de
  saisie, l'avion « exigeait un contact actif », un événement parlait d'un contact qui double
  son prix — mais **aucun moyen d'en acquérir un n'était défini nulle part**. §5bis corrige.
- **§16 était une porte de fin déguisée en porte par jalon.** Les cibles 5 et 6 exigent le jeu
  complet ; la règle « vert avant le jalon suivant » était donc inapplicable aux jalons 1 à 4.
  §15 et §16 échelonnent.
- **L'acte I n'avait pas d'horloge.** Trois horloges en acte III, une en acte II, zéro au
  jalon 1 : rien ne poussait, donc rien ne mourait, donc les cibles 1 et 2 ne mesuraient rien.
  §1bis (la dette) corrige — c'était §19.1.
- **L'acte III pouvait ne jamais arriver.** Un tirage à 15 % par trimestre laissait des
  campagnes entières sans épidémie, c'est-à-dire sans le sujet du jeu. §8 (la charge) rend le
  déclenchement certain au-dessus du seuil, et §11 ajoute **L'ARTISAN** pour le joueur qui
  reste dessous — c'était §19.2.
- **Une seule recette à la fois rendait §4 décoratif.** Trois segments aux critères
  orthogonaux, un seul produit : le joueur en choisissait un et abandonnait les autres. §2 (le
  catalogue) corrige, et fait apparaître le piège qui était déjà dans les formules — le segment
  le plus rentable est celui qui charge le plus vite (§8).
- **La trahison était une perte comptable.** « Part avec un nœud et son stock », oublié en dix
  semaines. §4 et §6 en font un rival nommé qui joue ta recette d'il y a trois ans.
- **Le point de non-retour était un mur sans porte.** Au-dessus d'instabilité 80 le remède est
  mort, et le joueur n'avait plus qu'à regarder. §10 (la troisième voie) lui laisse une clé,
  et c'est la sienne.
- **Le `cash_sale` n'avait pas de sortie.** Il ne pouvait qu'être blanchi à débit plafonné,
  donc s'accumuler. Corruption et élimination lui en donnent une, et ferment le circuit de §5.
- **La non-fongibilité était implicite.** Deux trésoreries étaient décrites, mais rien ne
  disait que le sale ne s'achète rien d'enregistré. La règle du papier (§5) la rend explicite,
  et §12bis en fait une contrainte d'interface : les deux bourses ne sont jamais additionnées,
  aucun prix n'est affiché sans sa monnaie, aucun bouton indisponible n'est muet.
- **Le document n'avait aucune spécification d'interface.** §13 posait `game/` = UI sans
  règles, mais aucun écran n'était décrit. §12bis couvre les cinq écrans, et pose la référence
  Plague Inc en disant explicitement ce qu'on lui emprunte (le chrome) et ce qu'on ne lui
  emprunte pas (la structure — chez lui tout se joue sur la carte, ici non).
- **La recherche n'était qu'une ligne.** « `procedes.json` — arbre de recherche (12 nœuds max) »
  et rien d'autre : ni branches, ni monnaie, ni ce qu'elle débloque. §2bis la définit, et
  tranche le seul piège de l'emprunt à Plague Inc — **pas de points d'ADN**, la recherche se
  paie en propre, donc son rythme est étranglé par le blanchiment comme tout le reste.
- **Le marché ne décidait rien, et trois passes de critique ne l'avaient pas vu.** Neuf
  critiques successives ont porté sur le harnais — ses exemptions, ses commentaires, ses
  compteurs — pendant que la simulation vendait 100 % du stock à un prix unique, ce qui rend
  décoratifs les 262 lignes de §4. Un harnais peut être irréprochable et ne rien mesurer :
  ce qu'il surveillait était vrai, et sans importance. La leçon n'est pas « critiquer moins »,
  c'est **changer d'étage** — les défauts d'un outil se trouvent en le lisant, ceux d'un jeu
  en le mesurant.
- **Une règle de jeu vivait dans un `sort()`.** L'ordre de service des segments décidait qui
  mange la pénurie, et il était donné par l'alphabet des clés — 54 000 $ et deux points de la
  cible 3. Le code ne mentait pas : il ne disait rien, ce qui est pire, parce qu'un silence
  ne se relit pas. Tout ce qui décide doit être **déclaré quelque part où un test regarde**.
- **Un rang n'est pas une grandeur.** L'ordre de service, écrit d'abord `priorite_service:
  1/2/3`, a été refusé par la porte du jalon 0 : perturbés d'un cran ils s'égalisaient, le
  nom tranchait, l'ordre ne changeait jamais. Le levier a rejeté ma propre addition en trois
  lignes, ce qui est exactement son travail. Une liste se garde par un test de couverture,
  pas par un balayage.
- **Un test qui crie faux est pire qu'un test absent.** L'élargissement du test des commandes
  citées a d'abord accusé trois lignes parfaitement saines, parce que son contexte persistait
  d'une ligne à l'autre. Un test qui crie faux se fait désactiver ; celui qui se tait, au
  moins, ne coûte que ce qu'il ne trouve pas.
- **Une colonne du document n'était pas implémentée, et c'est elle qui bloquait tout.** §4
  donnait depuis toujours un niveau de prix à chaque segment (`rue` : bas, `haut_de_gamme` :
  très élevé) ; la simulation n'avait qu'un prix. Trois mesures ont cherché la réponse dans
  la taille du marché et dans la capacité du labo — une pente qui détruisait la cible 3, un
  plateau — avant que la relecture du tableau donne la réponse. **Ce document savait déjà.**
  Un écart entre ce qui est écrit et ce qui est codé ne se voit pas en lisant le code.
- **Livrer un mécanisme et son réglage séparément est ce qui rend la mesure lisible.** Le
  prix par segment a été livré d'abord à résultat BIT-IDENTIQUE (les trois prix posés
  égaux), puis différencié seul. Les deux mêlés, on n'aurait su attribuer ni la mortalité à
  100 % ni les 91 leviers réveillés. Le premier temps ne mesure rien — c'est précisément à
  ça qu'il sert.
- **Un garde peut se tromper « du bon côté » sur la mauvaise grandeur.** `_soutenable`
  lisait le prix le plus bas : prudent sur la production, mais sa phrase parle du tas
  d'argent sale, et le tas grossit au prix encaissé. Le bot gagnait 1,6× ce qu'il croyait et
  la mortalité a doublé. La prudence n'est pas une direction, c'est une direction **sur une
  grandeur nommée**.
- **Une branche de recherche peut être décorative pour le seul profil qui la grimpe.** Écrite
  d'un jet, la Chimie posait son dernier nœud cinq semaines avant l'arrestation du bot qui la
  montait : 50 semaines d'arbre pour cinq semaines de jeu. C'est le levier débranché de §16,
  un étage plus haut — pas une constante que rien ne lit, mais un SYSTÈME que personne
  n'atteint. Le critère qui manquait : **une branche doit tenir dans la durée de vie du profil
  qui la grimpe, avec du temps pour jouer le résultat.**
- **J'ai tourné trois fois un nombre de fixture avant de m'en apercevoir.** La garde de dette
  des bots a eu trois versions (immobiliser la dette / projeter le blanchiment / projeter
  depuis la première rentrée), dont deux réfutées par la mesure, et `src/tests/bots.ts` interdit
  en toutes lettres de tourner ses nombres. La version retenue est la plus bête des trois.
  Sa conséquence — pas de recherche avant la semaine 60 — n'est pas un défaut du garde : c'est
  un **constat sur le jeu**, §1bis contre §2bis, et il appartient à ce document.
- **Le premier trimestre est un désert de trésorerie**, et deux gardes s'y sont cassées. On
  fabrique treize semaines avant la première vente (§4 trimestriel contre §2 hebdomadaire),
  donc on ne blanchit rien et les précurseurs se paient en propre. Toute projection qui
  l'ignore surestime d'un trimestre entier.
- **Une fixture écrivait dans le state du jeu, et ça partait dans les sauvegardes.**
  `src/tests/bots.ts` rangeait un mémo (`cout_pose`) dans l'état, que la sérialisation emportait
  et que l'empreinte de déterminisme hachait — §13 dit que `sim/` est le seul à y écrire.
  Rien ne l'a vu pendant une manche entière parce que **rien ne regardait la FORME de
  l'état**, seulement ses valeurs. `src/tests/run.ts` compare désormais les clés du state après
  une campagne de chaque bot à celles que `Etat.nouvelle_partie` déclare ; la garde vaudra
  aussi pour `game/` le jour où un écran voudra y mémoriser un repli d'interface.
- **J'ai écrit l'aveu à la place du test.** Mon commentaire dans `run.ts` annonçait « ce test
  ne garde PAS l'arithmétique de `src/sim/recherche.ts` » — et le test manquant n'a jamais été
  écrit. Cent dix lignes de simulation neuve n'étaient exercées que par la survie des bots,
  c'est-à-dire par un signal qui aurait aussi bien pu venir d'ailleurs. Un aveu dans un
  commentaire n'est pas une dette enregistrée : personne ne relit un commentaire.
- **Un test élargi peut rester aveugle à ce qu'il vient d'être élargi pour couvrir.**
  `save/load` a été étendu aux deux bots puis a annoncé « 0 en cours de chantier » : il
  sauvegardait à un tick fixe où le bot était entre deux nœuds. Il cherche maintenant le
  moment, et **échoue s'il n'en trouve aucun**. Un test qui ne dit rien doit le dire.
- **Le mécanisme anti-péremption était périmé.** `JALON_COURANT` est resté à 0 pendant tout le
  jalon 1 — donc la seule chose qui faisait expirer les dérogations datées tournait sur une
  date que personne ne maintenait, dans le fichier dont le commentaire dit « une dérogation
  sans date n'est pas une dérogation, c'est une suppression ». **Deux erreurs s'annulaient** :
  ce nombre était trop bas et le jalon déclaré d'`empilement_maison` trop tôt. La première
  mise à jour a fait rougir la porte, ce qui est la seule preuve qu'elle savait refuser — et
  la re-justification a révélé que **le catalogue de §2 n'était daté dans aucun jalon** de
  §15. Une exemption bien datée force un trou de planning à se montrer.
- **Une dérogation qui vit hors du mécanisme n'est surveillée par personne.** La CI portait
  un `continue-on-error` avec « à retirer au jalon 1, en même temps que `src/sim/produit.ts` » :
  échéance dépassée d'un jalon entier, dans le fichier que personne n'ouvre sauf quand la CI
  rougit. Elle avait raison par accident — la dérogation reste justifiée, mais par §16 et
  jusqu'au jalon 2, pas par ce qu'elle disait. Elle porte maintenant un `jalon:` que
  `src/tests/run.ts` confronte à `JALON_COURANT`, comme les dormantes du levier.
- **Un test que rien ne lance est vert pour toujours**, et c'est la forme la plus silencieuse
  de test mort : pire qu'un test cassé, qui au moins crie. Tout script de `tests/` qui étend
  `SceneTree` doit désormais apparaître dans un workflow, sinon `run.ts` échoue.
- **La règle « aucun chiffre mesuré dans un commentaire » n'avait jamais été appliquée à ce
  document.** Dix passes l'ont imposée au code — `balayage.ts`, `levier.ts`, `balance.ts`, le
  lanceur, la CI — pendant qu'une seule session ajoutait ici quatre tableaux de mesures, dont
  un déjà irreproductible (il exprimait l'écart de richesse en instantané, unité remplacée
  depuis par une intégrale). §4 est allé plus loin : il affirmait « la cible 3 passe au vert »
  alors qu'elle est rouge. **La source de vérité était le seul artefact non surveillé.** Les
  tableaux portent maintenant ce qui les a produits et dans quelle unité : un relevé daté
  reste vrai, c'est le confondre avec l'état courant qui ne l'est pas.
- **Une énumération dans un commentaire pourrit comme un chiffre.** L'en-tête de `balance.ts`
  annonçait « cibles 1, 2 et 3 » pendant que le fichier en tenait cinq — les deux autres
  étaient arrivées le jour de leur axe, exactement comme la règle l'exige, et l'en-tête ne les
  avait pas vues passer. Il garde la RÈGLE et laisse `verdicts()` produire la liste.
- **Trois fichiers frères, une phrase fausse, une seule corrigée.** `trace.ts` et
  `comparer.ts` ont affirmé pendant des mois ne pas être dans la CI, qui les lance deux fois
  chacun ; la même phrase avait été corrigée dans `balayage.ts` sans que personne aille voir
  ses voisins. C'était une contradiction entre deux fichiers du dépôt, donc lisible par une
  machine — et elle a survécu à douze passes de relecture. `src/tests/run.ts` la refuse désormais.
  Corollaire assumé : le contrôle cherche une chaîne littérale, donc les commentaires qui
  racontent l'histoire ne la recopient pas, sous peine de se dénoncer eux-mêmes.
- **Trois curseurs de conception sur six n'avaient qu'une bonne position, et 3217 lignes de
  harnais ne pouvaient pas le voir.** `complexite` dégradait quatre specs et n'en améliorait
  aucune ; `rendement` en améliorait deux et n'en dégradait aucune ; `coupe` ne rapportait rien
  à l'acte I. Le levier les déclarait verts, à juste titre : les constantes qui les portent
  bougent toutes des métriques. **Il testait les constantes ; rien ne testait les choix.** Le
  défaut était dans les formules elles-mêmes — le seul étage que douze passes de critique
  n'avaient jamais regardé, parce qu'elles relisaient le harnais.
- **L'intention était déjà écrite, dans l'arbre et pas dans la formule.** `colonne_seche` exige
  `procede_deux_etapes` : quelqu'un avait décidé qu'un procédé complexe permettait la haute
  pureté. La formule ne le savait pas. Quand deux parties d'un même document disent deux choses,
  la plus récente n'a pas forcément raison — ici c'était l'arbre.
- **Un changement de design fait apparaître les fixtures qui encodaient l'ancien.** La coupe de
  `discret` voulait dire « bon marché » sous un modèle, et « gros volume » sous le suivant. Rien
  dans le code n'avait bougé : c'est le SENS du nombre qui avait changé sous lui.
- **Un test qui exige « pas zéro » accepte n'importe quel epsilon.** Le test de conception
  attrapait un curseur sans contrepartie, mais un coefficient divisé par 2500 le laissait vert —
  et c'est justement la régression réaliste, celle de quelqu'un qui baisse un coefficient pour
  régler autre chose. Un garde-fou doit avoir un seuil, et ce seuil doit venir de la mesure.
- **Deux leçons écrites sont revenues en une passe** : le compteur qui relit ses propres
  messages, documenté comme anti-pattern 260 lignes plus haut dans le même fichier, et une
  seconde vérité — des recettes recopiées dans le test qui garde l'intention de la calibration.
  Elles sont corrigées, et l'intention d'ordre vit maintenant dans `calibration.json`, lue par
  `id`. La leçon d'une leçon : **quand elle revient, elle mérite une garde, pas un paragraphe.**
- **Remesurer une échelle, c'est remesurer TOUT ce qui l'encode.** Le changement de modèle de
  coût a été propagé à `calibration.json` et oublié dans `segments.json`, dont les `ref` portent
  la même échelle. Un fichier de données qui contient des nombres en dollars ou en kilos est
  calibré sur une échelle, même quand rien ne le dit.
- **Un système bien mesuré peut quand même avoir la mauvaise forme.** L'arbre de recherche
  passait tous ses tests, tenait son critère de durée, et ressemblait au jeu d'avion dont ce
  projet sort : l'utilisateur l'a vu, aucun harnais ne le pouvait. Le passage en grille a gardé
  les règles (argent propre, liste fermée des ouvertures, jamais un péage) et changé la forme.
  Les deux bornes neuves ont été posées hors de portée des témoins pour que le changement de
  forme se mesure seul — deux changements mélangés n'auraient rien mesuré.
- **Un garde-fou peut coûter plus que ce qu'il garde.** La vérification de fin de tick
  construisait le chemin de chaque valeur de l'état pour un message d'erreur qui ne sortait
  jamais : la moitié du coût d'un tick. Elle n'a été vue que le jour où le levier a franchi son
  budget de `perf.ts` — et la tentation était de relever le budget. Le profil a montré l'endroit ;
  deux passes (une rapide sans chaînes, une détaillée seulement en cas d'échec) ont rendu le
  tick moins cher qu'avant les ajouts, au même verdict.
- **On valide un portage par la mesure, et en commençant petit.** Le passage de Godot à
  TypeScript s'est fait en trois marches — un module comparé au bit près, puis des campagnes
  entières semaine par semaine, puis le harnais complet — et chaque marche a été franchie
  avant d'écrire la suivante. La première a payé tout de suite : `-0` contre `0`, invisible à
  l'affichage, aurait déplacé un clamp ailleurs et n'aurait jamais été cherché. Un portage
  relu « attentivement » sans comparateur n'est pas validé, il est espéré.
