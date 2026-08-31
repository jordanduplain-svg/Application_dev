# CARTEL — Prompt Claude Code v1 (référence unique)

> Tycoon de **conception**, de **logistique** et de **conséquence**.
> Tu conçois un produit par vrais arbitrages chimiques (les effets ÉMERGENT des choix),
> tu le distribues sur un graphe mondial (sous-marins, go-fast, avions, mules), tu blanchis
> un argent qui pèse et qui accuse — et un jour ton produit déclenche une épidémie que tes
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

**Boucle** : concevoir → produire → router → vendre → blanchir → recruter → le monde répond →
itérer. En acte III, une boucle parallèle s'ajoute : contenir ou laisser brûler, aider ou saboter.

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

## 3. Le graphe — carte & logistique (acte II)

**La carte est un graphe, pas un terrain.** Aucun pathfinding, aucune tuile, aucune 3D.

### Nœuds

```json
{ "id": "port_sud", "type": "production|transit|marche",
  "population": 4.2, "poids_instabilite": 0.08,
  "capacite_labo": 0, "pression_locale": 0.3 }
```

`poids_instabilite` = combien ce nœud pèse dans l'instabilité mondiale. Somme des poids = 1.0.

### Arêtes (routes)

```json
{ "de": "port_sud", "vers": "marche_nord", "mode": "sous_marin",
  "capacite_kg": 2000, "cout_fixe": 400000, "cout_par_kg": 12,
  "delai_sem": 3, "visibilite_par_voyage": 1.0, "p_saisie_base": 0.04 }
```

### Les quatre modes (les seuls — `ponytail:`)

| Mode | Capacité | Coût | Délai | Visibilité | Saisie |
|---|---|---|---|---|---|
| **Mules** | très faible | très bas | lent | très basse, diffuse | élevée mais indolore |
| **Go-fast** | moyenne | bas | très rapide | **haute** | moyenne |
| **Avion** | moyenne-haute | moyen | rapide | moyenne — exige un contact corrompu actif | basse |
| **Sous-marin** | très haute | **très élevé** | très lent | très basse | très basse, catastrophique |

Un voyage = une décision : `(route, produit, kg)`. Le joueur ne pilote rien.

### Saisies

```
p_saisie = p_saisie_base × (1 + visibilite/100) × (1 − protection_contact)
```

Saisie = cargaison perdue + `+8` visibilité + le nœud d'arrivée entre en `pression_locale` haute
pendant 8 semaines.

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

Deux trésoreries distinctes :

| | Sert à | Contrainte |
|---|---|---|
| `cash_sale` | rien directement | **occupe de la place**, **produit de la visibilité**, se transporte |
| `cash_propre` | tout : labos, routes, équipes, recherche, salaires | rare |

```
visibilite_hebdo += (cash_sale / 1_000_000) × k_cash
```

### Canaux de blanchiment (`data/blanchiment.json`)

```json
{ "id": "commerce_facade", "capacite_sem": 80000, "taux": 0.72,
  "cout_mise_en_place": 250000, "visibilite_sem": 0.4, "p_gel": 0.01 }
```

Chaque canal a une **capacité hebdomadaire plafonnée**. C'est le point clé : la capacité de
blanchiment croît **linéairement** (un canal à la fois, chacun coûteux) pendant que les revenus
croissent **exponentiellement** (dépendance + expansion).

> **Tu ne peux pas blanchir assez vite. Jamais.** C'est la courbe de difficulté du jeu, et elle
> monte toute seule — aucun tuning nécessaire.

Le cash sale physique est aussi **stocké dans des nœuds** et se déplace par les mêmes routes.
Une saisie peut prendre l'argent, pas seulement le produit.

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
sont grillés 12 semaines. Tu peux payer pour qu'il se taise. Très cher, jamais garanti.

---

## 7. La visibilité (jauge 1/3)

Le niveau d'attention que les autorités te portent. **0-100.**

```
visibilite += traces_hebdo − decroissance
traces_hebdo = signature_produit × kg_produits_sem
             + Σ_routes visibilite_par_voyage × voyages
             + saturation_marche          -- part de marché > 60 % sur un segment
             + (cash_sale / 1e6) × k_cash
             + evenements (arrestations, saisies, trahisons)
             + Σ_nœuds infection[n] × k_epidemie          -- ACTE III uniquement
decroissance = 2.0 × capacite_institutionnelle            -- voir §9
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

### Modules nouveaux (les seuls)

`sim/graphe.gd` (nœuds, arêtes, voyages, saisies) · `sim/blanchiment.gd` ·
`sim/epidemie.gd` (propagation, nettoyage, instabilité dérivée) · `sim/remede.gd`

---

## 14. Données

```
data/
  constants.json      -- toutes les constantes d'équilibrage, zéro dans le code
  calibration.json    -- 3 produits de référence, tolérance 5 %
  precurseurs.json    -- 4 familles fictives
  procedes.json       -- arbre de recherche (12 nœuds max — ponytail:)
  graphe.json         -- nœuds + arêtes
  segments.json       -- marchés et critères pondérés
  blanchiment.json    -- canaux
  equipes.json        -- extermination
  lieutenants.json    -- archétypes recrutables
  rivaux.json
  events.json         -- 12
  remede.json         -- taux de base, actions d'aide et de sabotage
```

---

## 15. Ordre de construction — jalons

**Règle absolue : le harnais d'équilibrage passe au vert AVANT de commencer le jalon suivant.**
C'est la seule règle de ce document qui n'est pas négociable. Elle est reprise de
`bureau-etudes`, où elle a fonctionné — ce qui y a coûté cher, c'est le PÉRIMÈTRE (dix
sous-systèmes sur vingt-trois ans simulés), pas la discipline de mesure.

| # | Jalon | Contenu | Jouable ? |
|---|---|---|---|
| **0** | **Le harnais** | `balance.gd` et `bots.gd` PORTÉS depuis bureau-etudes (§16), `run.gd`, CI | — |
| **1** | **Le labo** | conception (dont `instabilite_neuro`), 1 nœud, 1 marché, économie simple | **oui** |
| **2** | **Le graphe** | nœuds, 4 modes de route, voyages, saisies, visibilité | **oui** |
| **3** | **L'argent sale** | double trésorerie, canaux, cash physique | **oui — c'est ici que le jeu devient le tien** |
| **4** | **Les hommes** | bras droits, loyauté, ambition, trahison, arrestations | oui |
| **5** | **L'épidémie** | propagation, équipes, instabilité mondiale | oui |
| **6** | **Le remède** | jauge, aide/sabotage, les 4 fins, épilogues | **complet** |

Si le développement s'arrête au jalon 3, **il reste un jeu fini et vendable.** C'est le but de
cet ordre.

---

## 16. Cibles d'équilibrage

### Bots (`tests/bots.gd`)

| Bot | Comportement |
|---|---|
| `discret` | petit volume, produit propre, jamais d'épidémie |
| `industriel` | gros volume, produit puissant, aide le remède quand ça dérape |
| `opportuniste` | laisse brûler, nettoie uniquement ses nœuds rentables |
| `accelerateur` | sabote activement le remède, vise `L'HÉRITIER` |

### Cibles (`tests/balance.gd`) — 100 graines × 4 bots

Reprendre telles quelles les conventions déjà éprouvées dans `bureau-etudes/tests/balance.gd`
(nombre de graines réglable en argument, verdict de mortalité de démarrage, écart de richesse
en plus du taux de victoire). **Ce harnais est mûr : le porter, pas le réinventer.**

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

4. CHAQUE BOT REMPLIT SON RÔLE
   les bots ne sont PAS quatre stratégies joueur symétriques. `discret` est un
   profil-témoin : il doit finir pauvre et survivant. `accelerateur` doit atteindre
   L'HÉRITIER ≥ 30 % du temps ou il ne mesure rien.
   ↳ la cible est « conforme à son rôle », jamais « gagne autant que les autres »

5. LES QUATRE FINS SONT ATTEINTES
   chacune ≥ 5 % des campagnes, tous bots confondus

6. LA COURSE EST UNE VRAIE COURSE
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
  seulement qu'il ne casse rien. La validation est un playtest.
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
- **4 modes de transport, pas douze.** Chacun occupe un coin distinct de l'espace
  capacité/coût/délai/visibilité. Un cinquième serait redondant.
- **2 rivaux.** Ils ne font pas faillite avant l'acte III.
- **12 procédés de recherche maximum.** Au-delà, la R&D se dilue et les bots deviennent illisibles.
- **Pas de multijoueur, pas de co-op.** Le genre s'y prête ; le périmètre non.
- **Pas de carte dessinée.** Un graphe lisible, des nœuds, des arêtes, des chiffres.
- **Chimie entièrement fictive.** Contrainte permanente, pas une étape de polish.

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
