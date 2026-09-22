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
| **I — Le laboratoire** | départ | 1 zone, 1 marché. Concevoir, produire, vendre. |
| **II — Le réseau** | premier nœud distant ouvert | Graphe, argent sale, bras droits, visibilité. |
| **III — La conséquence** | première épidémie déclarée | Instabilité, extermination, remède, fourche. |

**Boucle** : concevoir → produire → **acheter un engin** → router → vendre → blanchir →
**corrompre** → recruter → le monde répond → itérer. En acte III, une boucle parallèle s'ajoute : contenir ou laisser brûler, aider ou saboter.

**Vérité du design** : tout ce qui rapporte te rend visible. Tout ce qui te protège coûte ce que
tu aurais investi ailleurs. Il n'existe aucune configuration sans dette.

---

## 2. Le produit — conception (cœur, acte I)

Même moteur que `bureau-etudes/sim/aircraft.gd` : des paramètres bruts, des specs qui **émergent**.
Aucun curseur ne contrôle directement une spec affichée.

### Paramètres de conception (ce que le joueur règle)

| Paramètre | Plage | Nature |
|---|---|---|
| `famille_precurseurs` | 4 familles fictives | choix discret : coût, disponibilité, traçabilité |
| `purete_visee` | 0.30 – 0.99 | continu |
| `rendement` | 0.20 – 0.95 | continu — antagoniste de la pureté |
| `complexite_procede` | 1 – 5 | paliers — débloqués par recherche |
| `coupe` | 0.0 – 0.7 | dilution ajoutée après production |
| `stabilisation` | 0 – 3 | additifs fictifs, coûteux |

### Specs émergentes (ce que le joueur lit)

```
puissance        = purete × (1 − coupe) × k_famille                     -- ce qui se vend
cout_unitaire    = f(famille, purete², 1/rendement, complexite)         -- pureté chère en carré
debit_kg_sem     = capacite_labo × rendement × (1 − 0.12 × complexite)
signature        = tracabilite_famille × (1 + 0.5 × complexite) − 0.15 × stabilisation
fiabilite_lot    = 1 − variance(purete, complexite, competence_chimiste)
dependance       = puissance^1.3 × (1 − coupe)                          -- fidélise la demande
instabilite_neuro = clamp(puissance^2.2 − 0.4 × stabilisation − seuil_famille, 0, 1)
```

**`instabilite_neuro` est l'axe le plus important du jeu.** Il est affiché dès la première minute,
il ne fait rien pendant tout l'acte I, et il est la cause de l'acte III.

> **Il doit exister au jalon 1.** Leçon mesurée sur `bureau-etudes` : un axe ajouté après coup
> dans un système déjà calibré force à compenser au mauvais endroit, jusqu'à saturation du
> levier. Un sous-système se vérifie sur TOUS les axes qu'il produit, dès qu'il existe.

Le joueur voit `instabilite_neuro` monter avec la puissance. La puissance se vend deux à trois
fois plus cher. Il pousse quand même. Tout le jeu est dans cette phrase.

### Calibration obligatoire

Trois produits de référence en `data/calibration.json`, tolérance 5 %, testés dans `tests/run.gd` :
un produit de rue bon marché, un produit haut de gamme, un produit extrême (`instabilite_neuro > 0.8`).
Toute modification des formules casse ce test avant de casser l'équilibrage.

---

## 2bis. La recherche — trois branches

**Réemploi de `bureau-etudes/sim/research.gd`, tel quel.** Seules les données changent.

### Pas de monnaie de recherche

La recherche se paie en **`cash_propre` + temps**. Aucun point d'ADN, aucun jeton, aucune
troisième bourse — ce serait une conversion déguisée et ça contredirait la règle du papier (§5).

Conséquence voulue : **le rythme de la recherche est étranglé par le blanchiment.** Un joueur
assis sur 40 M$ sales ne recherche pas plus vite qu'un joueur pauvre. C'est le même goulot que
tout le reste, et il n'a pas fallu l'inventer.

### Les trois branches

Elles correspondent exactement aux trois piliers du jeu — et aux trois jalons qui les ouvrent.

| Branche | Ouvre au | Débloque | Acte |
|---|---|---|---|
| **Chimie** | jalon 1 | familles de précurseurs, paliers de `complexite_procede`, stabilisation, plafonds de `purete_visee` | I |
| **Logistique** | jalon 2 | engins, capacités, `−usure`, `−p_saisie`, classes d'arêtes nouvelles (haute mer, corridors aériens) | II |
| **Influence** | jalon 3 | paliers de contacts, capacité et taux de blanchiment, contre-espionnage (`+decroissance` de visibilité), fiabilité d'élimination | II-III |

**7 nœuds par branche, 21 au total.** C'est une révision du plafond de §17 (12), et elle a un
coût qu'il faut nommer : **plus de nœuds = un espace de stratégies plus large = des bots plus
difficiles à lire.** La raison du plafond d'origine reste valable ; 21 est le maximum qui tient
encore dans un harnais à 4 bots, et il ne doit pas augmenter ensuite.

Si §19.3 est adopté (le remède fabricable par le joueur), il devient le 8ᵉ nœud de Chimie —
terminal, ruineux, et le seul qui n'ouvre pas un choix mais une fin.

### Ce que la recherche ne fait jamais

- Elle ne donne **aucun bonus numérique direct** (« +10 % de rendement »). Elle **ouvre des
  choix** : un précurseur de plus, un palier de complexité, un engin. L'arbitrage reste dans
  l'écran de conception (§2), il ne remonte pas dans l'arbre.
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

**Réemploi direct de `bureau-etudes/sim/market.gd`, formules inchangées.** Seules les données changent.

```
qualite_s     = Σ_i poids_i × clamp(spec_i / besoin_ref_i, 0, 1.4)
f_prix        = (prix_median_segment / prix)^1.2
f_confiance   = 0.7 + 0.6 × fiabilite_livraison          -- remplace f_repu
f_delai       = 1 / (1 + 0.15 × semaines_rupture)
attractivite  = qualite_s × f_prix × f_confiance × f_delai
part_cible    = attractivite² / Σ attractivite²
part_reelle  += (part_cible − part_reelle) × 0.20
ventes        = demande_trim × part_reelle, plafonné par le stock livré sur place
```

### Segments (`data/segments.json`)

| Segment | Critères pondérés | Volume | Prix |
|---|---|---|---|
| `rue` | coût .45, disponibilité .30, puissance .25 | énorme | bas |
| `milieu` | puissance .40, fiabilité .35, coût .25 | moyen | moyen |
| `haut_de_gamme` | pureté .50, fiabilité .30, discrétion .20 | faible | **très élevé** |

**La dépendance** modifie la demande : `demande_t+1 += dependance × ventes_t × k_fidelite`,
plafonnée. Un produit très addictif fait croître son propre marché — jusqu'à ce qu'il le tue.

### Rivaux

Deux cartels, mêmes formules que le joueur, budget R&D simulé, seed. Ils meurent en acte III
quand l'instabilité de leur nœud d'origine dépasse 0.6. `ponytail:` pas de faillite avant l'acte III.

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
| `ambition` 0-1 | haute ambition + basse loyauté = **trahison** (part avec un nœud et son stock) |

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

### Déclenchement

Chaque trimestre, pour chaque nœud-marché où le joueur a vendu :

```
p_declenchement = clamp((instabilite_neuro − 0.55) × kg_ecoules_trim / 1000, 0, 0.15)
```

Sur seed. **Certaines campagnes n'en voient jamais.** Ce n'est pas une cinématique.

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

Trois jauges, une matrice. Toutes atteignables, aucune scriptée.

### Le remède atteint 100 (instabilité restée < 80)

- `visibilite < 40` → **L'ANONYME.** Le monde guérit. Tu es riche. Personne ne saura jamais.
- `visibilite ≥ 40` → **LE PROCÈS.** Le monde guérit, et il te juge. La pire des deux.

### L'instabilité atteint 100 (remède mort à 80)

- `visibilite < 40` → **L'HÉRITIER.** Tu possèdes les seuls sous-marins, avions et routes qui
  fonctionnent encore. Tu n'as rien conquis — tu es simplement le dernier à pouvoir livrer.
- `visibilite ≥ 40` → **LE COUPABLE.** Nommé, traqué, dans un monde mort. Tu as tout gagné et
  il n'y a plus personne pour l'acheter.

### Fins courtes

`cash_propre < 0` pendant 8 semaines → **faillite** (absorbé par un rival).
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

Trois onglets, 7 nœuds chacun (§2bis). Structure Plague Inc, contenu Cartel.

Chaque nœud affiche **avant l'achat** : son coût en `cash_propre`, sa durée en semaines, et
**ce qu'il ouvre** — jamais un pourcentage abstrait. « Débloque le sous-marin classe II », pas
« +15 % de capacité logistique ». C'est la même règle que §2bis : la recherche ouvre des choix,
elle ne distribue pas des bonus.

Deux contraintes :

- **Les branches non ouvertes sont visibles et grisées dès le jalon 1**, avec leur condition
  d'ouverture. Le joueur doit savoir que Logistique et Influence existent avant de pouvoir y
  toucher — c'est ce qui donne à l'acte I une direction, et l'acte I en manque cruellement
  (§19.1).
- **Aucune recherche en cours n'est annulable sans perte.** C'est un engagement de trésorerie
  propre, et le propre est la ressource rare du jeu.

### 12bis.5 — L'écran de conception

Inchangé par rapport à `bureau-etudes/game/design/blueprint.gd` : les six paramètres à gauche,
les sept specs émergentes à droite, recalcul en direct.

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

**Godot 4.7, GDScript.** Reprise intégrale des conventions de `bureau-etudes` :

- `sim/` = fonctions **statiques et pures** sur `(state: Dictionary, data: Dictionary)`.
  Aucun accès aux scènes. Déterministe sur seed.
- `game/` = UI seulement. Aucune règle de jeu.
- `data/` = tout le contenu en JSON. **Aucun nombre d'équilibrage dans le code.**
- `tests/` = headless, exécutables en CI.

### Réemploi de `bureau-etudes`

| Source | Devient | Effort |
|---|---|---|
| `sim/market.gd` | marchés, segments, parts, inertie | **données seulement** |
| `sim/research.gd` | procédés, modes de transport, contacts | **tel quel** |
| `sim/engineers.gd` | bras droits + équipes d'extermination | + `loyaute`, `ambition` |
| `sim/reputation.gd` | visibilité | inverser le signe |
| `sim/raids.gd`, `accidents.gd` | saisies, descentes, arrestations | même forme |
| `sim/production.gd` | capacité des labos | **tel quel** |
| `sim/economy.gd` | trésorerie | **dédoubler : sale / propre** |
| `sim/rng.gd`, `state.gd`, `sim.gd`, `events.gd` | socle | **tel quel** |
| `sim/aircraft.gd` `specs()` | `sim/produit.gd` `specs()` | structure gardée, contenu réécrit |
| `game/design/blueprint.gd` | écran de conception | labels |
| `game/market_ui/marche.gd` | écran marché | **tel quel** |
| `tests/balance.gd`, `bots.gd` | le harnais | **corriger d'abord — voir §16** |

### Le modèle d'actif — un seul struct pour trois systèmes

Engins, contacts corrompus et commerces-façade sont **le même objet vu sous trois angles**.
Un module, trois fichiers de données — pas trois modules.

```gdscript
{ "id": "...", "type": "vehicule|contact|commerce",
  "noeud": "port_sud",
  "cout_achat": 0, "cout_sem": 0,
  "devise": "propre|sale",          # vehicule → propre, contact → sale
  "visibilite_sem": 0.0,
  "usure": 0.0,                     # vehicule uniquement
  "p_perte_sem": 0.0,               # découverte (contact), gel (commerce)
  "effets": { } }
```

La maintenance et le vieillissement viennent de `production.gd`, déjà écrit et testé dans
`bureau-etudes`. Écrire ce système trois fois est l'erreur à ne pas commettre.

### Modules nouveaux (les seuls)

`sim/actifs.gd` (parc, contacts, commerces : achat, entretien, usure, perte) ·
`sim/graphe.gd` (nœuds, arêtes, voyages, saisies, pannes) ·
`sim/epidemie.gd` (propagation, nettoyage, instabilité dérivée) · `sim/remede.gd`

`sim/blanchiment.gd` et un hypothétique `sim/parc.gd` **n'existent pas** : ce sont des cas
d'usage de `sim/actifs.gd`.

---

## 14. Données

```
data/
  constants.json      -- toutes les constantes d'équilibrage, zéro dans le code
  calibration.json    -- 3 produits de référence, tolérance 5 %
  precurseurs.json    -- 4 familles fictives
  procedes.json       -- arbre de recherche : 3 branches × 7 nœuds (§2bis)
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
propre porte, écrite dans `balance.gd` **le jour où le sous-système naît** — jamais
rétro-ajoutée. Un axe mesuré trop tard est la faute qui a coûté `bureau-etudes`, appliquée
cette fois à la mesure au lieu du modèle.

| # | Jalon | Durée | Contenu | Porte | Bots | Jouable ? |
|---|---|---|---|---|---|---|
| **0** | **Le harnais** | 1-2 j | `balance.gd`, `bots.gd`, `run.gd`, CI — **portés**, pas réécrits | **levier connecté** | — | — |
| **1** | **Le labo** | 2-3 sem | conception (dont `instabilite_neuro`), 1 nœud, 1 marché, trésorerie simple, **branche Chimie** (§2bis) | 1, 2, 3, **7** | 2 | **oui** |
| **2** | **Le graphe & le parc** | 4-5 sem | nœuds, arêtes, **les 5 engins**, usure, entretien, pannes, saisies, visibilité, **branche Logistique** | + **8, 9, 15** | 2 | **oui** |
| **3** | **L'argent sale** | 2-3 sem | double trésorerie **non fongible** (§5), les deux bourses au HUD (§12bis), commerces, **corruption**, **élimination**, cash physique, **branche Influence** | + **10, 11, 16, 17, 18** | 3 | **oui — jeu fini et vendable** |
| **4** | **Les hommes** | 2 sem | bras droits, loyauté, ambition, trahison, arrestations, équipages | + **12** | 3 | oui |
| **5** | **L'épidémie** | 3-4 sem | propagation, équipes, instabilité mondiale | + **13, 14** | 4 | oui |
| **6** | **Le remède** | 2-3 sem | jauge, aide/sabotage, les 4 fins, épilogues | **§16 en entier** | 4 | **complet** |
| **7** | **Le playtest** | ouverte | des humains, pas des bots | qualitatif | humains | — |

**Jalons 0→3 : ~9 à 13 semaines. Jalons 0→6 : ~16 à 22 semaines.** Estimations sur un rythme
soutenu, à pondérer par le temps réellement disponible. **Le jalon 5 est celui qui glissera** :
c'est le seul système sans équivalent dans `bureau-etudes`.

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

### Bots (`tests/bots.gd`)

| Bot | Comportement | Disponible à partir de |
|---|---|---|
| `discret` | petit volume, produit propre, jamais d'épidémie | jalon 1 |
| `industriel` | gros volume, produit puissant, aide le remède quand ça dérape | jalon 1 |
| `opportuniste` | laisse brûler, nettoie uniquement ses nœuds rentables | jalon 3 |
| `accelerateur` | sabote activement le remède, vise `L'HÉRITIER` | jalon 5 |

Lancer un bot avant que son système existe produit du bruit qu'on prendra pour un signal.
`opportuniste` et `accelerateur` restent donc hors du harnais jusqu'à leurs jalons respectifs.

### Conventions

Reprendre telles quelles les conventions déjà éprouvées dans `bureau-etudes/tests/balance.gd`
(nombre de graines réglable en argument, verdict de mortalité de démarrage, écart de richesse
en plus du taux de victoire). **Ce harnais est mûr : le porter, pas le réinventer.**

### Cibles permanentes — mesurables dès le jalon 1

```
1. MORTALITÉ GLOBALE LISIBLE
   faillites bot entre 15 % et 35 %

2. MORTALITÉ DE DÉMARRAGE BORNÉE
   < 10 % des campagnes meurent avant la semaine 104
   ↳ garde-fou anti-régression, PAS une cible à atteindre

3. AUCUNE DOMINATION
   taux de victoire max ≤ 60 %  OU  écart de richesse médiane ≤ 15 %
   ↳ le OU est délibéré : gagner 76 % de photo-finish en finissant 11 % plus riche
     est une égalité, pas une domination. Le taux de victoire seul ne distingue pas
     un écrasement d'un départage.
   ↳ au jalon 1-2, se mesure entre les DEUX bots présents

7. ÉCART SUR instabilite_neuro                              [JALON 1]
   industriel ≥ 0.50, discret ≤ 0.25, sur la médiane des graines
   ↳ vérifie que l'axe DISCRIMINE alors qu'il ne fait encore rien.
     C'est la cible la plus importante du projet : un axe non mesuré à sa
     naissance devient un levier qu'on découvre mort deux ans plus tard.
```

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
19. AUCUNE BRANCHE MORTE                                    [JALON 3]
    chaque branche de recherche reçoit ≥ 20 % des dépenses de R&D
    d'au moins un bot, sur la médiane
    ↳ une branche que personne n'ouvre est 7 nœuds de contenu mort et
      7 nœuds d'équilibrage à maintenir pour rien
```

### Cibles de l'acte III — jalons 5 et 6

```
13. L'ÉPIDÉMIE ARRIVE                                       [JALON 5]
    déclenchée dans ≥ 80 % des campagnes de industriel, ≤ 20 % de discret
    ↳ l'aléa décide QUAND, pas SI — voir §19

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

5. LES QUATRE FINS SONT ATTEINTES                           [JALON 6]
   chacune ≥ 5 % des campagnes, tous bots confondus

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

Nombre de graines **réglable en argument** (`-s res://tests/balance.gd -- 20`), défaut 100.
20 pour itérer (~2 min), 100 pour valider un jalon. À 10 minutes la boucle, l'équilibrage
devient impraticable et on se met à deviner au lieu de mesurer.

---

## 17. Simplifications assumées (`ponytail:`)

Volontairement absents. Chacun est une ligne à ajouter plus tard, pas une dette cachée.

- **Aucun combat, aucune arme, aucun contrôle direct d'unité.** Le joueur décide, il ne pilote pas.
- **Aucune conquête post-effondrement.** `L'HÉRITIER` est un épilogue calculé, pas une phase.
- **2 rivaux.** Ils ne font pas faillite avant l'acte III.
- **21 procédés de recherche maximum** (3 branches × 7 — §2bis). Révisé depuis 12. Au-delà,
  la R&D se dilue et les bots deviennent illisibles ; 21 est ce qui tient encore dans un
  harnais à 4 bots.
- **Aucune monnaie de recherche.** La recherche se paie en `cash_propre`. Un jeton de type
  ADN serait une conversion déguisée et contredirait la règle du papier (§5).
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

## 19. Suggestions non tranchées

**Ces cinq points ne sont PAS adoptés.** Ils sont consignés ici parce que deux cibles de §16
en dépendent, et qu'un document qui cache ses dépendances est pire qu'un document incomplet.
Chacun se tranche par un oui ou un non, pas par une discussion.

### 19.1 — La dette de départ ⚠️ *dont dépendent les cibles 1 et 2 au jalon 1*

L'acte I n'a **aucune horloge**. L'acte III en a trois (visibilité, instabilité, remède),
l'acte II en a une (le blanchiment qui décroche). Le jalon 1 est donc un système où rien ne
pousse, et **sans pression aucune campagne ne fait faillite** — les cibles 1 et 2 ne
mesureraient rien.

Correctif proposé : tu commences **endetté** envers quelqu'un qu'on ne voit jamais,
remboursable en semaine N. Même fonction que « mai 1940 » dans `bureau-etudes` : une date qui
rend chaque semaine coûteuse. Le prêteur devient le premier événement de l'acte II — il ne
veut plus d'argent, il veut un nœud.

Coût : un champ dans `state`, un événement, une fin courte.

**Si ce point est refusé, il faut une autre horloge d'acte I, ou retirer les cibles 1 et 2
du jalon 1.**

### 19.2 — L'épidémie garantie ⚠️ *dont dépend la cible 13*

`p_declenchement ≤ 0.15` par trimestre : certaines campagnes ne voient jamais l'acte III.
C'est le sujet du jeu, et c'est le seul élément qui le distingue d'un marché encombré.

Correctif proposé : une **charge cachée** qui intègre `instabilite_neuro × kg_écoulés` dans le
temps. L'aléa décide **quand** on franchit le seuil, pas **si**. Le joueur prudent déclenche
tard, le joueur avide déclenche tôt, les deux voient l'acte III.

Et si quelqu'un reste vraiment sous le seuil toute la partie, ça mérite une fin plutôt qu'une
absence de fin : **L'ARTISAN** — riche, jamais inquiété, un produit auquel le monde a survécu.
Cinquième case de la matrice, elle récompense la retenue et rend les quatre autres lisibles
par contraste.

**La cible 13 (« l'épidémie arrive ») est inatteignable sans ce correctif.**

### 19.3 — Le remède fabricable par le joueur

Il a la formule. Personne n'est mieux placé pour faire l'antidote que celui qui a fait le
produit. Une branche de R&D ruineuse dans `sim/produit.gd` qui fait progresser `remede`
**sans passer par `capacite_institutionnelle`** — donc la seule voie qui fonctionne encore
au-dessus d'instabilité 80. Le point de non-retour devient une porte à un seul jeu de clés.

Réemploi pur : même écran de conception, objectif inversé.

### 19.4 — Le traître devient le troisième rival

Aujourd'hui la trahison coûte « un nœud et son stock » : une perte comptable, oubliée en dix
semaines. Un lieutenant qui trahit devrait devenir un **rival nommé**, avec la recette du
joueur figée au moment de la trahison, pour le reste de la partie.

Coût : un slot dans `rivaux.json` initialisé à l'exécution. Effet : la seule punition du jeu
dont on se souvient six mois plus tard.

### 19.5 — Le catalogue plutôt qu'une recette unique

Les trois segments ont des critères orthogonaux (`rue` veut du coût, `haut_de_gamme` veut de
la pureté). Avec une seule recette active, le joueur choisit un segment et abandonne les
autres — deux tiers de `market.gd` ne servent à rien.

Deux ou trois recettes simultanées, et le piège devient vivant : `haut_de_gamme` est
mécaniquement la recette à plus forte `instabilite_neuro` (`puissance^2.2`). **Le segment le
plus rentable est la bombe.** C'est déjà dans les formules ; il manque la possibilité de tenir
les deux à la fois pour que l'arbitrage existe.

Bonus : rend utilisable le vieillissement du catalogue de `bureau-etudes`, déjà écrit et testé.

---

## 20. Ce que ce document a appris en route

Trace des corrections apportées à la v1, pour ne pas les refaire.

- **Le parc n'existait pas.** Les routes étaient des arêtes tarifées ; on n'achetait rien, on
  n'entretenait rien, une saisie ne coûtait qu'une cargaison. §3bis corrige.
- **La corruption était un fantôme.** `protection_contact` apparaissait dans la formule de
  saisie, l'avion « exigeait un contact actif », un événement parlait d'un contact qui double
  son prix — mais **aucun moyen d'en acquérir un n'était défini nulle part**. §5bis corrige.
- **§16 était une porte de fin déguisée en porte par jalon.** Les cibles 5 et 6 exigent le jeu
  complet ; la règle « vert avant le jalon suivant » était donc inapplicable aux jalons 1 à 4.
  §15 et §16 échelonnent.
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
