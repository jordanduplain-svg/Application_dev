# CLAUDE.md — Bureau d'études

**La source de vérité est [GDD.md](GDD.md) (prompt v2). En cas de conflit, il gagne —
SAUF sur le cadre : pivot propriétaire (playtest n°4, juillet 2026) vers l'ANGLETERRE
1922-1945 (étape 11 ci-dessous). Sur les dates, noms, monnaie (£) et cadre, l'étape 11
supplante le GDD en attendant sa v3.**

## Commandes

- Tests headless (obligatoires avant de conclure toute session) :
  `./tools/Godot_v4.7-stable_win64_console.exe --headless --path . -s res://tests/run.gd`
- Harnais d'équilibrage (§15.2, ~3 min 30, exit 0 = cibles atteintes) :
  `./tools/Godot_v4.7-stable_win64_console.exe --headless --path . -s res://tests/balance.gd`
- Traceur de diagnostic (1 campagne/stratégie, 1 ligne/an) : `... -s res://tests/trace.gd`
- Smoke UI headless : `... --headless -s res://tests/ui.gd` ; capture d'écran réelle (rendu,
  écrit capture.png) : `... -s res://tests/capture.gd` ; jouer : `... --path .`
- Godot 4.7 portable vit dans `tools/` (gitignoré). Éditeur : `Godot_v4.7-stable_win64.exe --path .`

## Règles non négociables

- `sim/` est PUR : aucun Node, aucun signal, aucun randi() moteur. State 100 % JSON (tout en float —
  un int diverge au save/load). Mutation uniquement via `sim.gd` (tick/appliquer).
- Toute itération de Dictionary qui accumule ou décide passe par `Etat.cles_triees()` (déterminisme
  après relecture JSON, qui trie les clés).
- AUCUNE constante d'équilibrage en dur : tout vient de `data/*.json`. On ajuste data/, pas le code.
- Save/load : équivalence à epsilon (round-trip texte JSON non bit-exact dans Godot) ;
  déterminisme bit-exact seulement en mémoire.
- GDScript typé, warnings stricts (voir project.godot). Un commentaire-raison par fichier.

## État d'avancement (§15 du GDD)

1. ✅ sim/ + tests verts (calibration ±5 %, déterminisme, save/load, conservation marché, campagnes bot)
2. ✅ Équilibrage par simulation — cibles atteintes (run 24) : glouton-civil 35 % de faillites
   (27 pts dans la fenêtre 29-34, médiane 1933), faillites globales 16 %, victoires 52/48/0,
   rivaux 68 % du marché cumulé. Ajouts sim pendant cette étape : coût de production payé à la
   livraison (marge = prix − coût, c'était un bug), aléa de demande trimestriel seedé
   (`alea_demande`), entretien d'atelier par palier (`entretien_atelier_sem`).
3. ✅ Écran blueprint (`game/`) — coquille (horloge Timer, zéro `_process`, auto-save
   user://sauvegarde.json, barre date/trésorerie/vitesses ×1/×2/×4) + écran conception :
   contrôles d'ingénierie, specs émergentes live, silhouette procédurale `_draw()` par calques
   (biplan/monoplan, moteur radial/ligne, train, cockpit, armement), cartouche. UI 100 % en code
   (pas de .tscn à la main sauf main.tscn minimal), thème compact police 9 (le défaut à 16
   déborde du viewport 360). Zéro shader, zéro autoload.
4. ✅ Écran marché (`game/market_ui/marche.gd`) — barres empilées par maison (vous laiton,
   Blochard gris acier, Marane bordeaux) sur 12 trimestres d'historique, flèche de tendance +
   ligne de contexte (nouvelle clé `contexte` dans segments.json, narratif pas équilibrage),
   demande/prix médian, gamme joueur (prix SpinBox → intention, retrait), atelier (agrandir),
   catalogue rival « specs : rumeurs » (révélation = étape 7). Routage Bureau/Marché dans la
   barre de main.gd ; rafraîchi au trimestre et à l'affichage. `tests/capture.gd` produit
   aussi capture_marche.png (campagne seedée 8 ans).
5. ✅ AO militaires + économie (`sim/contracts.gd`, `data/contracts.json`, `game/contracts_ui/ao.gd`) —
   7 programmes datés 1927-1939 à cahiers contradictoires, notation façon marché (ratios clampés
   pondérés × f_repu) mais pondération réputation PROPRE aux AO (constants `ao.repu_base/repu_k`
   0.85/0.30 : un concours juge le prototype plus que la marque, sinon le joueur ne gagne jamais) ;
   zéro RNG (flux aléatoire du marché intact). Victoire → acompte 30 % + série livrée en PRIORITÉ
   sur la capacité (hook dans Marche.trimestre), solde 70 % par appareil. Rivaux : alignent leur
   chasseur d'export générique → le joueur gagne les AO non-chasseur par SUR-MESURE (c'est le
   gameplay) ; CA rival crédité d'un bloc (trésorerie « en gros »). Seuil → concours infructueux
   (M4 1934 le sera souvent, historique). Équilibrage revalidé : pionnier-militaire passe de 0 %
   à 53 % de victoires, toutes cibles §15.2 tenues. Migration sauvegarde : clé "ao" ajoutée au
   chargement dans main.gd.
6. ✅ Diorama + ingénieurs (`sim/engineers.gd`, `data/engineers.json`, `game/office/equipe.gd`) —
   3 compétences (études/recherche/atelier), traits (+1 assorti), moral (baisse dans le rouge,
   remonte sinon, multiplie les points), affectation par poste. Effets RÉELS branchés :
   recherche accélérée (`research.tick_hebdo` prend data), remise proto plafonnée
   (`sim._lancer_produit`), capacité d'atelier bonifiée avec floor (`production.capacite`).
   Marché du recrutement seedé (3 candidats/26 sem, vivier qui s'améliore avec les années,
   budget fermé 12 postes, indemnité de licenciement). Diorama en coupe : 3 étages
   Atelier→Bureau→Institut ouverts par l'effectif ou l'affectation, pastilles animées (bob
   1 px sur Timer 0.5 s si visible), moral visible (tête rouge < 0.5). Rééquilibrage après
   coup (les bonus adoucissaient trop la crise : 35 %→6 % de faillites glouton) : bonus
   halvés en data, trésorerie départ 362 k→352 k, frais fixes 2 500→2 650 F/sem → cibles
   §15.2 re-atteintes (glouton 25 %, global 17 %, victoires 44/48/8). Migration sauvegarde
   dans main.gd (clé "recrutement", ingénieurs sans "comp" → équipe de départ). REPORT :
   les 2 pilotes nommés (culot, célébrité) arrivent avec records/raids à l'étape 7.
7. ✅ Recherche UI + événements + presse + records/raids (`sim/events.gd`, `sim/raids.gd`,
   `data/events.json`, `data/raids.json`, `game/research_ui/recherche.gd`, overlays dans main.gd) —
   16 événements datés déterministes (un seul en attente, cooldown, fenêtre de condition 1 an,
   choix A/B avec effets chiffrés DANS les libellés data, pause auto, `choix_bot` pour les
   campagnes automatiques) ; effets génériques data-driven (demande_mult temporaires, gels
   production/études prorata trimestre, plafond atelier, révélation specs rivales au Salon,
   retraits d'ingénieurs/pilote...). Raids (autonomie/fiabilité/culot, RNG seulement à l'action
   joueur : avion perdu, pilote 50 %) + Coupes Deutsch (Vmax×fiab vs rivaux, forfait auto entre
   rivaux à la clôture) ; 2 pilotes nommés (Vidal, Berthaud) recrutables, salaires en éco.
   Presse : 1 gabarit (L'AÉROPHILE), file state["presse"], une plein écran. Écran Recherche
   (12 technos, coût/durée effectifs pionnier/suiveur, gel affiché) ; bouton AO → « Concours »
   (+ section pilotes/épreuves/palmarès). 5 écrans : Bureau/Marché/Concours/Équipe/Recherche.
8. ✅ Fin 1940 + épilogues (`sim/end.gd` pur, `narrative/fr.json`, `game/end/fin.gd`) —
   score du meilleur export EN SERVICE vs benchmark Bf 109E (data `fin.benchmark`), composite
   modernité/livraisons/réputations (poids et seuils en data), verdict 4 niveaux + faillite ;
   ~35 fragments modulaires (trajectoire d'entreprise depuis l'historique marché, atelier,
   labo, AO, épreuves, rivaux, caisse, équipe, moral) ; lignes pilotes GARANTIES via
   `state["memorial"]` (rempli par raids.gd à la disparition) ; graine affichée, « Rejouer
   ce destin » (même graine) / « Nouveau destin » — nouveau state écrit puis
   `reload_current_scene()` (tous les écrans repartent proprement).
9. ✅ Passe perf + a11y (à un reste humain près, voir ci-dessous) — audit §16 conforme :
   0 hex hors palette, 0 `_process`, 0 shader, 0 Light2D, 0 autoload, raison d'être par
   fichier, dernières constantes d'équilibrage passées en data (raids, moral candidat).
   Police pixel **Pixel Operator 8** (CC0, `art/`, accents français complets) en
   default_font du thème de main, rendue sans antialiasing, grille 8/16/32 partout ;
   barre compactée (titre supprimé, « Labo », vitesses 1 caractère), libellés marché
   raccourcis, cartouche élargi. Options ⚙ (cap FPS 30/60/∞, VSync, mode économie qui
   coupe le bob du diorama) dans user://options.json. Rafraîchissement trimestriel limité
   à l'écran visible. `tests/perf.gd` : 314 nœuds, 0 `_process` (verdict structurel ; les
   FPS d'une fenêtre d'arrière-plan sont throttlés par l'OS et ne prouvent rien).
   RESTE HUMAIN : 5 campagnes manuelles + confirmation 60 fps fenêtre au premier plan.
10. ✅ Passe confort (audit externe) — 6 bugs + 6 manques traités, aucune cible §15.2 bougée :
    migration de sauvegarde complétée (`brevets`/`graine`/`tresorerie_hist` — sans `graine`,
    « Rejouer ce destin » lisait une clé absente sur les vieux saves) ; la pause auto d'un
    événement/d'une une REND la vitesse choisie (`_vitesse_prec`) au lieu de laisser le joueur
    recliquer ×4 seize fois par campagne ; `Cartes.armer` — LE bouton destructif à deux clics,
    qui se DÉSARME seul après 4 s (armé à vie, il n'est plus une garde mais un piège) — sur
    « Nouvelle partie », « Licencier », « Retirer » ; capacité de référence `cap_ref` figée
    après le gel et avant consommation, partagée par l'allocation et le facteur délai (les
    clients jugeaient le carnet du joueur à l'aune d'une capacité que la grève lui avait ôtée ;
    invisible pour les bots, qui ne subissent pas de gel — balance bit-identique avant/après) ;
    intention `supprimer_design` + bouton « purger les brouillons » (chaque lancement refusé
    laissait un design orphelin à vie dans le save). Ajouts : 3 emplacements de sauvegarde
    (`user://sauvegarde_N.json`, slot dans options.json, l'ancien fichier unique devient le 1) ;
    raccourcis Espace/1/2/3/Tab/Échap dans `_input` — PAS `_unhandled_key_input`, le focus du
    Viewport avale Tab avant, d'où le garde-fou « un LineEdit a la main » qui protège aussi les
    chiffres ; `game/ui/sons.gd`, deux sons SYNTHÉTISÉS (aucun asset audio au dépôt) : clic de
    navigation, alerte grave au basculement dans le rouge (le compte à rebours de faillite était
    purement visuel, invisible en ×4) ; courbe de trésorerie dans le livret comptable (même
    référence de tableau que `state["tresorerie_hist"]`, la sim y ajoute, la courbe redessine).
    NOTE : la ligne d'équilibrage « recalé étape 7 : 54/41/5 » plus bas est PÉRIMÉE — mesure
    réelle du harnais aujourd'hui : victoires 33/8/59, glouton 23 %, global 19 %, rivaux 67 %.
    RESTE : distribution (export presets + CI de build), toujours absente.
11. ⏳ Pivot Angleterre 1922-1945 (playtest n°4, plan en 5 étapes : ① cadre, ② chiffres
    visibles recherche/conception, ③ options de construction + archétypes, ④ notifs presse
    concours/courses, ⑤ rivaux réactifs). Étape ① en cours, squelette posé :
    `Etat.AN0 = 1922.0` (SEULE ancre temporelle, remplace tous les `1925.0` codés en dur),
    fin mai 1945 (`fin.tick` 1214, sentinelle `"mai_1945"`), benchmark Fw 190 D (700 km/h,
    4 armes, 12 000 m), `livraisons_cible` 450. Anglicisation par NOMS AFFICHÉS seulement —
    clés internes inchangées (saves, tests, `rep_marane_militaire`…) : rivaux Bristow
    (ex-Blochard) / Marlowe (ex-Marane), moteurs Rolls-Royce/Bristol/Napier (+ `rr_eagle`
    1919 OBLIGATOIRE : à 1922 aucun moteur n'existait, l'init des rivaux plantait ; +4
    moteurs de guerre Merlin 45/61, Hercules VI, Griffon 65), AO = « Spécification F.9/27… »
    + 3 programmes de guerre (F.19/40 Bataille, B.11/41 lourd, F.6/43 haute altitude),
    courses King's Cup (+1938), pilotes Tremayne/Whitfield, fondateurs Hartley/Whitcombe/
    Clarke (liste aussi dans end.gd), presse THE AEROPLANE, monnaie affichée £ (montants
    NON rescalés — pur relabel, zéro impact balance). Événements : 20 (16 réécrits
    britanniques + 1923 Empire, 1940 Dunkerque/Bataille/Blitz, 1942 usines US, 1944 V1) ;
    mobilisation : gel civil 270 sem (fini = la reprise 1944-45 peut s'afficher).
    Courbes étendues 1922→1945 (guerre : export ×2.5, civil ~0). PIÈGE APPRIS : à
    prix unitaire d'AO FIXE, un vainqueur dont le coût de production dépasse le prix
    se ruine en livrant (solde 70 % < coût, atelier réquisitionné → revenu marché nul
    4 trimestres) — les bots ne candidatent plus au-dessus du prix (discipline de coût,
    bots.gd) ; à l'inverse, EMPILER des produits jumeaux sur un segment AUGMENTE la part
    de maison (a² par produit, somme par maison) — ne pas « corriger » l'empilement des
    bots, c'était rationnel (vécu : glouton 50 %→100 % de faillites avec renouvellement
    forcé). ÉQUILIBRAGE 23 ANS ATTEINT (exit 0, toutes cibles §15.2, mesuré APRÈS
    l'étape 12 complète) : glouton 27 % (crise 18 %), global 15 %, victoires 52/47/1
    (pionnier/equilibre/glouton), rivaux 43 %. Leviers finaux : trésorerie départ 420 k,
    entretien palier 2 à 4 000, moteur 1919 fiab 0.74 (pivot rép. 0.72 !), postal
    [[1922,28],[1926,30], creux 18], transport [[1925,36],[1927,48], creux 27/24],
    pricing bots pionnier 1.30 / equilibre 1.26 (LE levier victoires : bascule complète
    entre 1.26 et 1.27), pionnier seuil_recherche 400 k→250 k après discipline AO,
    fièvre glouton close 1929.8, la bouée civile Imperial 1931 (44 %→25 % à elle seule).
    Tests run.gd/ui.gd/capture.gd recalés (gardes de boucle, pilotes, 1250 ticks). Étape ② FAITE (chiffres visibles) :
    `Avion.delta_feature` (specs avec/sans, pur — l'affichage ne peut pas se
    désynchroniser des formules) + `Avion.fiab_composantes` (moteur/équipements/
    cellule/surcharge, sommées puis clampées par specs) ; écran Bureau : delta chiffré
    sous CHAQUE case d'équipement recalculé à chaque changement + ligne « fiab = moteur
    76 · équip. −4 · … » sous les specs ; écran Labo : ligne d'effet « sur un chasseur
    type » par techno (réf. de l'année, structure métal pour rivetage/cabine sinon delta
    nul, texte dédié monocoque/soufflerie) ; formateur partagé `Criteres.resume_delta`
    (3 effets significatifs + surcoût). Test ui.gd recalé (n à 2n lignes au Labo).
    Étape ③ FAITE (options + archétypes) : 3 équipements nouveaux — `soute_bombes`
    (cd0 −0.0015 SEULEMENT si charge > 0, sinon min-max gratuit pour les chasseurs),
    `tourelle_defensive` (+1 arme, cd0 +0.002, mania −6), `armes_ailes` (+2 armes qui
    pèsent/coûtent/traînent par les canaux génériques existants) ; technos 1932/34/35
    marquées `rivaux_ignorent` (flag data lu par `market._prochaine_techno`, remplace le
    cas spécial soufflerie) — les rivaux n'y touchent pas : l'arsenal sur-mesure reste
    l'arme du joueur ET leur progression techno reste identique (pas de re-déséquilibre).
    Archétypes (`data/archetypes.json`, clé state `archetypes` + migration main.gd +
    `Recherche.verifier_archetypes` appelée à la fin de recherche ET à l'achat de
    licence) : combo de technos complet → une de presse « UNE FORMULE EST NÉE » +
    préréglage chargeable au Bureau (OptionButton sous le nom, moteur = meilleur de
    l'année, tous les contrôles resynchronisés). 3 archétypes : chasseur moderne
    (monocoque+pas variable+train), bombardier lourd (monocoque+soute+tourelle),
    courrier de grande ligne (capot+cockpit+gonio). Silhouette : trappe de soute en
    pointillés, anneau de tourelle. Test `_test_archetypes` dans run.gd.
    Étape ④ FAITE (annonces) : TOASTS discrets en bas à droite à l'ouverture de chaque
    concours/course/raid (demande joueur : PAS de une plein écran pour ça — la une reste
    réservée aux événements à choix). Détection côté UI dans main.gd (`_verifier_annonces`
    compare les listes publiques `Contrats.ouverts`/`Raids.ouvertes` à `_annonces_vues`,
    initialisée aux ouvertures courantes au chargement pour ne pas re-toaster) : zéro clé
    de state, zéro migration, zéro impact sim. Cartes papier 190 px, 3 max, disparition
    après 8 s (timer d'arbre, pas de `_process`), `MOUSE_FILTER_IGNORE` partout.
    Étape ⑤ FAITE (rivaux réactifs, retour « ils ne concurrencent pas ») — 3 mécanismes
    déterministes dans `market._rivaux_reagir` (appelé au trimestre après l'allocation)
    + riposte dans `_rivaux_renouveler`, constantes dans rivals.json `regles` :
    (1) PRIX : rabot `prix_pas` 3 %/trim quand la part joueur du segment dépasse celle
    du produit rival, remontée sinon — borné [cout×(1+marge_min 5 %), cout×(1+marge_prix
    maison)] ; (2) CAPACITÉ vivante `riv["capacite"]` (nouvelle clé state, .get partout
    pour les vieux saves) : +1/trim si carnet cumulé > 2× capacité, plafond 12 ;
    (3) RIPOSTE : part joueur > 50 % du segment + produit rival > 2 ans → renouvellement
    anticipé. Test `_test_rivaux_reactifs` (rabot, plancher de marge, capacité). Vu en
    campagne : produits rivaux 24 → 32, trésoreries bot en baisse — c'est le but.
12. ⏳ Après-pivot (demande joueur : les 4 propositions + du contenu). FAIT :
    (a) ESSAIS EN VOL — `sim/essais.gd` + `data/essais.json` : prototyper (proto payé,
    défauts tirés SEEDÉS À L'ACTION comme les raids — flux marché intact, bots exemptés :
    `lancer_produit` reste LEUR chemin, l'économie du harnais ne bouge pas) → campagne de
    `delai_semaines` (spec Études, enfin utilisée) → défauts révélés à la fin (proba data
    + k_features + k_surcharge) → corriger (coût+semaines, un à la fois) / mettre en
    service (specs tarées par les défauts non corrigés) / abandonner. Clé state `essais`
    (+migration), intentions prototyper/corriger_defaut/abandonner_essais/mettre_en_service,
    section ESSAIS EN VOL au Bureau (maj hebdo si écran visible), mode d'emploi réécrit.
    (b) COMMANDES SPÉCIALES CIVILES — même mécanique que les AO (`domaine`/`segment` en
    data, défaut militaire/export : les 10 programmes existants inchangés) : réputation,
    rival candidat et livraisons du domaine ; 5 clients nommés 1924-1938 (Imperial
    Airways ×2, GPO, Qantas, British Airways — celui de 1931 est une bouée de crise
    délibérée). Bots : candidature par segment du concours + discipline de coût.
    (c) FOURNÉE DE CONTENU — 6 moteurs (Kestrel V 1931, Mercury VIII 1936, Twin Wasp
    1941, Vulture 1941 et Sabre II 1943 = MOTEURS-PIÈGES puissants/infiables marqués
    `bots_ignorent` dans engines.json, lu par `meilleur_moteur` : la naïveté « puissance
    brute » des automates les choisirait, le dilemme est pour le joueur) ; 2 technos
    (réservoirs auto-obturants 1940 → fiab +3 pts ; hélices contrarotatives 1944,
    requiert tripale → η +0.02) branchées par les canaux existants ; 2 archétypes
    (intercepteur de haute altitude : monocoque+turbo+pressu ; chasseur-bombardier :
    armes d'ailes+soute+train).
    (d) LICENCES DE CELLULES — ❌ RETIRÉ du jeu au playtest n°7 (décision propriétaire :
    « enlève la possibilité de vendre tes avions aux concurrents, ça déséquilibre »).
    Historique, pour ne pas la réinventer : vendre les plans d'un produit à une maison
    donnait une prime immédiate + 6 % de royalties, le rival retoolant sa ligne du segment
    en clone de vos specs. Trois rustines successives n'ont pas suffi — rente répétable
    (ledger `licences_vendues` à vie), puis prime forfaitaire encaissable avec un avion
    poubelle (gate sur `qualite_segment`), puis prime plate malgré le gate (pente sur
    l'écart de qualité). Le fond du problème restait : un revenu à quatre chiffres, hors
    marché, disponible dès 1922, contre une contrepartie (armer un rival) que le joueur
    peut choisir d'ignorer sur un segment qu'il abandonne. SUPPRIMÉ : intention,
    `Marche.vendre_licence`/`prime_licence`/`avantage_licence`, royalties du clone dans
    `_allouer`, clé state `licences_vendues`, constantes `licence_cellule`, l'UI du Marché,
    les chaînes EN. Ne PAS confondre avec ce qui reste : licences de BREVET de technos
    (`research.gd`) et PRODUCTION sous licence de guerre (13-k), intactes. Balance
    inchangée par construction (les bots n'ont jamais vendu de licence).
    (e) JAUGE MINISTÈRE — `state["ministere"]` 0..1 (départ 0.5 neutre, +migration) :
    pondère la note des Spécifications militaires SEULEMENT (`_f_ministere` 0.9→1.1,
    appliqué aussi à l'estimation publique note_produit — l'UI ne ment pas) ; victoire
    militaire +0.05 ; ≥ seuil_faveur 0.7 → acompte bonifié +10 pts (le solde s'ajuste,
    total conservé) ; effet générique `ministere` dans les événements (doctrine 1934,
    shadow scheme ±0.12, Espagne) ; encart AIR MINISTRY sur l'écran Concours.
    Test `_test_licence_ministere` (prime/clone/royalties/double-vente refusée,
    note 0.74→0.85 selon jauge, refus du shadow scheme → refroidissement).
    ÉQUILIBRAGE FINAL : exit 0 (chiffres à l'étape 11). RESTE HUMAIN : 5 campagnes
    manuelles de playtest (essais en vol, rivaux réactifs, moteurs-pièges, licences).
13. ✅ Passe audit + retours playtest n°5 (session longue, tout revalidé au harnais).
    (a) BUGS CORRIGÉS — `Etat.valider()` gardé derrière `OS.is_debug_build()` (les
    `assert` sautent en build exporté : sans le garde, le parcours NaN/bornes tournait
    pour rien à chaque tick sans plus rien vérifier) ; migration `main.gd` blindée contre
    un `ingenieurs` vide ; échec d'écriture de sauvegarde signalé (`push_warning` + toast,
    plus de silence) ; un prototype en essais ne re-toastait plus « en essais en vol » à
    chaque reprise (`_annonces_vues` semé aussi avec `essai_debut_`) ; `market.gd` :
    `_produits_du_segment` rendu public (`produits_du_segment`), l'écran marché n'accédait
    plus un helper « privé » d'un autre script ; **bug majeur** : l'écran Bureau ne se
    rafraîchissait qu'au trimestre — un archétype/une techno débloqué en pause n'apparaissait
    qu'en rechargeant la partie (retour joueur direct) → `_montrer_ecran` rafraîchit
    maintenant le Bureau à chaque affichage, comme les 4 autres écrans.
    (b) I18N NATIF GODOT — `game/ui/i18n.gd` : le FRANÇAIS reste la langue source (les
    msgid SONT le texte français, locale "fr" = identité, zéro chaîne perdue) ; une
    langue étrangère charge `narrative/ui_<lang>.json` (msgid→msgstr) dans un
    `Translation` runtime via `TranslationServer.add_translation` + `set_locale`,
    purgé (`TranslationServer.clear()`) à chaque bascule pour ne pas laisser une table
    active sous la mauvaise locale après un aller-retour dans le même process (bug vécu
    et corrigé). Libellés statiques auto-traduits (natif `tr()` sur les Control) ; TOUTES
    les chaînes formatées et `draw_string` de `game/**` wrappées en `tr(...)` (fonctions
    statiques : `TranslationServer.translate(...)`, pas de `self`). `narrative/ui_en.json` :
    ~220 entrées, anglais complet du chrome UI ; parité des spécificateurs `%` vérifiée
    (clé vs valeur) pour qu'aucun `template % [...]` ne puisse planter en EN. Le contenu
    DATA (événements, technos, épilogues, unes) reste en français — `sim/` est PUR, ne
    peut pas appeler `tr()` (dépendance moteur + locale contaminerait le state sauvegardé) ;
    localisation du contenu = chantier séparé, non fait.
    (c) ÉCRAN OPTIONS — plein écran (`DisplayServer.window_set_mode`), volume (bus
    maître, `AudioServer.set_bus_volume_db`/`set_bus_mute`), sélecteur de langue
    (rechargement de scène au changement, `I18n.appliquer` avant toute construction
    d'UI dans `_ready`).
    (d) CI — `.github/workflows/ci.yml` : télécharge Godot 4.7 headless, lance
    `run.gd` + `ui.gd` + `balance.gd` sur push/PR (exit code fait foi). Reste : export
    presets / build d'artefact release, non fait.
    (e) FIABILITÉ DES ÉQUIPEMENTS, retour joueur (« pourquoi une techno de 1922 coûte
    aussi cher en fiab qu'une de 1940 ? ») — `Avion.fiab_composantes` (aircraft.gd) :
    le malus par équipement reste PLEIN pendant une grâce (`fiab_maturite_grace_ans`
    7 ans, une techno neuve est inéprouvée), PUIS décroît sur `fiab_maturite_ans`
    (6 ans) jusqu'à un PLANCHER PROPRE À CHAQUE ÉQUIPEMENT (`fiab_plancher` en data,
    features_avion) : une radio mûre tombe à 0.2, un turbocompresseur reste à 0.8 — le
    dilemme lourd/léger reste réel, l'avionique légère mûrie cesse de punir. PIÈGE
    VÉCU : un premier essai avait aussi ajouté un POIDS de malus par équipement
    (`"fiab"` en data, radio/instruments/gonio/PA/démarreur à 0.25-0.4) — ça buffait
    la fiabilité des RIVAUX (qui montent toute l'avionique) de ~11 pts de faillites
    glouton en crise, jamais revalidé isolément avant d'empiler d'autres systèmes.
    RETIRÉ (les planchers de maturité suffisent au ressenti joueur ; le poids était un
    levier d'équilibrage caché, pas un vrai besoin de gameplay). Leçon : un levier de
    fiabilité qui touche AUSSI les rivaux doit être mesuré seul avant d'empiler quoi
    que ce soit d'autre par-dessus.
    (f) ACCIDENTS EN SERVICE — `sim/accidents.gd`, nouveau module sim pur, appelé
    après `Marche.trimestre` : sous `accidents.pivot_fiab` (0.65 — VOLONTAIREMENT
    en dessous du pivot réputation 0.72, sinon un avion juste-en-dessous-de-la-moyenne
    crashait aussi), un produit livré risque l'accident (proba ∝ manque de fiabilité
    × livrées du trimestre, seedé à l'action comme les raids, zéro tirage RNG au-dessus
    du pivot — testé) : une de presse, réputation du domaine −4 pts, carnet ×0.5. La
    fiabilité devient enfin viscérale, pas juste un multiplicateur de note marché.
    (g) COMMANDES À ULTIMATUM — 3 programmes fenêtre courte + cahier serré dans
    `contracts.json` (même mécanique AO/civile existante) : GPO courrier de Noël des
    Indes 1933 (6 mois), crise de Munich 1938 (5 mois, 40 chasseurs), navette de
    l'Atlantique 1942 (guerre, transport longue distance). Il faut concevoir POUR,
    pas recycler un design existant.
    (h) CONSEIL D'ADMINISTRATION — `sim/conseil.gd` : mandats datés (livraisons,
    trésorerie, victoire de concours) qui mettent l'entreprise sous échéance même
    riche. Tenu → rallonge de capital versée en `autres_cumules`. Manqué → dividende
    forcé (`dividende_part` 2 % de la caisse) + réputation civile ET militaire −0.5 pt.
    PIÈGE VÉCU (x2) : les mandats de crise (1926-1934) achevaient le bot glouton
    pendant la dépression → déplacés POST-crise (1935+), la tension reste mais ne
    frappe plus l'entreprise déjà à terre. Encart « LE CONSEIL » sur l'écran Concours
    avec progression chiffrée (`Conseil.progression`).
    (i) PARTENARIAT MOTORISTE EXCLUSIF — `Sim.remise_moteur`/`moteur_interdit` (sim.gd,
    autorité posée sur `nouveau_design`, jamais côté UI) : signer Rolls-Royce OU
    Bristol (data `motoriste.marques`, `engines.json` a désormais un champ `marque`
    par moteur) donne −15 % sur leurs moteurs À VIE, mais l'autre grande maison
    disparaît du catalogue de moteurs disponibles au Bureau (Napier et Pratt & Whitney
    restent libres). Irréversible, bouton armé.
    (j) L'INGÉNIEUR DE GÉNIE — `engineers.json` : R. J. Mitchell (fenêtre 1929-1932)
    et S. Camm (1935-1938) apparaissent en tête du vivier de recrutement dans leur
    fenêtre (annoncés par la presse une seule fois, `state["genies_annonces"]`), trait
    Visionnaire (`bonus: 2` — le champ `bonus` du trait est maintenant paramétrable en
    data, défaut 1). Pas embauché dans la fenêtre → parti pour toujours.
    (k) PRODUCTION SOUS LICENCE (guerre) — `data/contracts.json` clé `sous_licence` (2
    offres 1940/1943) + `Sim._accepter_sous_licence`/`sous_licences_ouvertes` : construire
    l'avion d'un rival pour l'Air Ministry, série prioritaire à l'atelier (même file que
    les contrats AO), cash net par appareil, fiabilité posée AU PIVOT réputation → ZÉRO
    impact sur la jauge (testé) — le filet de sécurité sans gloire pour une gamme dépassée.
    (l) VARIANTES « MK II » — `nouveau_design` accepte `design["variante_de"]` = uid
    d'un design existant ; la sim vérifie la parenté de cellule (formule/structure/
    surface identiques, sinon refus) et pose `design["variante"] = true`, lu par
    `Avion.specs` : prototype ×0.4, études ×0.5 (`variante_proto_mult`/`variante_delai_mult`).
    Moteur et équipements restent libres — re-motoriser une cellule connue, la vraie
    histoire des lignées (Spitfire I→IX). Bureau : sélecteur « Variante de » qui
    verrouille formule/structure/surface (UI seulement, la sim est déjà la garde-fou).
    (m) ASSURANCE-FLOTTE — case dans l'écran Direction : prime hebdo par produit au
    catalogue (`assurance_prime_sem_par_produit`, économie.gd), amortit un accident
    (rep −2 au lieu de −4, carnet ×0.75 au lieu de ×0.5). Le calcul qui parle : flotte
    fragile → ça vaut le coup, flotte saine → argent jeté.
    (n) GRÈVES INTERNES — `engineers.gd tick_hebdo` : moral d'équipe moyen sous
    `greve_moral_seuil` pendant `greve_sem_seuil` semaines consécutives (14 en pratique,
    calé pour ne toucher que le JOUEUR négligent, pas les bots qui n'ont ni équipe
    dynamique ni exposition longue au rouge) ET trésorerie positive (achever un
    mourant n'est pas du gameplay) → `gels.production` +4 semaines, une de presse,
    cooldown 78 sem. Le moral cesse d'être un simple multiplicateur de bonus.
    (o-bis) BRADAGE CORRIGÉ (playtest : « il en reste 3 à livrer et on les brade alors qu'on
    les a pas produits ? ») — la recette payait `(carnet + stock) × prix × 0.5` SANS jamais
    déduire de coût de production : le carnet n'ayant jamais été construit, c'était du profit
    pur (et un exploit : gonfler le carnet puis brader). Nouveau `Sim.recette_bradage` (public,
    PARTAGÉ avec le bouton du Marché pour qu'il ne puisse pas annoncer autre chose que ce qui
    est versé) : le STOCK part au prix d'occasion (il a été payé à la construction), le CARNET
    n'est plus vendu mais CÉDÉ → seulement `marge_unitaire × 0.5` par commande. Le bouton
    s'affiche aussi quand il n'y a que du stock. Test recalé avec hangar ET carnet.
    (o) BRADAGE COLONIAL — intention `brader_flotte` (`Sim._brader_flotte`) : retire
    un produit ET solde son carnet + stock aux compagnies coloniales à moitié prix
    cash immédiat, contre réputation du domaine −2 pts. La porte de sortie payante
    pour une gamme vieillissante, au lieu du retrait à perte sèche pure.
    (p) HANGAR / MARCHÉ DE L'OCCASION AVEC INVENTAIRE — le vrai chantier de
    possession : `state["stock"]` (uid → appareils en hangar) et `state["stock_commande"]`
    (commandes en attente). Bouton « +5 au hangar » par produit → `Marche._produire_stock`
    construit sur la capacité d'atelier RESTANTE (après séries d'État), payé à la
    construction, AVANT la production à la commande normale. Au marché, le hangar
    LIVRE EN PREMIER sans consommer de capacité (`_allouer` : `du_stock` puis
    `via_atelier`) — un carnet couvert par du stock améliore le facteur délai
    (`f_delai`, le stock compte comme livraison immédiate). Retirer/brader un produit
    liquide aussi son stock au tarif occasion. C'est le lissage de production qui
    manquait ; les bots n'y touchent pas (neutre au harnais).
    (q) CONTRATS D'ENTRETIEN — case dans Direction : revenu récurrent par appareil
    ENCORE EN SERVICE (`Marche.flotte_en_service`, livraisons des 3 dernières années)
    × fiabilité — la fiabilité paie une 2e fois. Revers testé : un accident sur flotte
    sous contrat coûte le DOUBLE de malus réputation (`accidents.gd`).
    (r) EMPRUNT BANCAIRE — `state["emprunt"]`, plafond adossé à la réputation
    (`Sim.plafond_banque`), intérêts hebdo (`economy.gd`, 0.15 %/sem). Événement
    `1931_rappel_pret` (condition `a_emprunt`) : en pleine crise, refuser de payer le
    rééchelonnement (20 000 £) fait exiger toute la dette SÈCHE de la trésorerie
    (effet générique `rappel_pret` dans `events.gd`). Tension de début de partie,
    drame de crise.
    (s) FILIALE COLONIALE — investissement 1.5 M£ (`Sim._fonder_filiale`, à vie) → 5e
    emplacement de catalogue (`Sim.max_produits`, lu partout où `eco.max_produits`
    servait avant) + 2 commandes captives/trimestre sur le civil le plus récent. Le
    puits à argent de fin de partie.
    (t) ÉCRAN DIRECTION (6e onglet) — `game/direction/direction.gd` : rapatrie tout
    le stratégique/financier jadis entassé dans la colonne COMMERCE du Marché
    (devenue illisible) — 4 cartes en 2 colonnes (Marque & réputation + publicité,
    Assurance & entretien, Banque, Engagements à vie = motoriste + filiale). Le
    Marché redevient l'opérationnel pur (gamme, atelier, concurrence).
    (u) REFONTE ÉCRAN LABO — `research_ui/recherche.gd` : la liste ne montre plus le
    mur de texte d'effets sous chaque techno (retour « c'est moche ») ; un clic sur
    le nom ouvre un VOLET de détail à droite (comme les équipements du Bureau) —
    tableau aligné (`GridContainer`, vert=mieux/rouge=moins bien) des effets sur un
    chasseur type, statut, coût/durée effectifs, brevets, boutons Lancer/Licence.
    (v) REFONTE ÉCRAN ÉQUIPE — diorama : vrai bâtiment (toit, sol, postes de travail
    meublés par étage) au lieu de 3 barres nues ; registre : puces de compétences
    colorées (É/R/A, assorties aux étages du diorama) avec INFOBULLE (« Études :
    niveau 3/5 ») et LÉGENDE explicite sous le titre ÉQUIPE (retour « c'est pas
    clair », É/R/A seuls étaient cryptiques) ; barre de moral (vert/miel/rouge) au
    lieu du texte « moral 100 % » répété partout.
    (w) VOLET ÉQUIPEMENTS DU BUREAU — le mur de cases à cocher grisées aux 3/4 est
    devenu un bouton « Choisir… (k monté(s) / n recherchés) » qui ouvre un volet à
    droite ne listant QUE les technos déjà acquises (les verrouillées n'y figurent
    plus du tout, elles n'ont plus besoin d'être vues).
    (x) ARCHÉTYPES RETUNÉS — bombardier lourd (surface 55→60, carburant 1400→2100 kg,
    charge 1100→1300 : colle enfin aux Spécifications B, autonomie 1438→2066 km) ;
    intercepteur haute altitude (surface 18→15.5 : +21 km/h, s'épanouit avec les
    moteurs 1942+ face au F.6/43) ; courrier grande ligne (carburant 950→1200 :
    autonomie 1451→1803 km, note marché 0.86→0.91). Mesurés par sonde `Avion.specs`
    + `Marche.qualite_segment` à leur époque réaliste de déblocage, pas devinés.
    ÉQUILIBRAGE FINAL (après ~16 itérations de chasse à la régression — chaque
    nouveau système validé isolément puis recombiné) : exit 0, glouton-civil 30 %
    (crise 17 %), faillites globales 18 %, victoires 52/48/0, rivaux 46 % du marché.
    Migration state complète (`motoriste`, `sous_licences`, `genies_annonces`,
    `conseil`, `assurance`, `moral_bas_sem`, `greve_dernier_tick`, `stock`,
    `stock_commande`, `entretien_flotte`, `emprunt`, `filiale`). RESTE HUMAIN :
    campagnes de playtest sur tout le lot (hangar, entretien, banque, filiale,
    conseil, motoriste, génies, sous-licence, variantes, grèves, bradage), export/
    build (CI ne fait que tester).
14. ⏳ Passe pédagogie (infobulles) + chantier lisibilité Concours (demande joueur :
    « il faut rajouter des trucs pour expliquer » + capture de l'écran Concours
    montrant un mur de chiffres illisible après résolution d'AO).
    (a) INFOBULLES — `tooltip_text` posé sur les contrôles peu explicites de tous les
    écrans, PAS de nouveau système : `game/contracts_ui/ao.gd` (ligne OUVERT, chaque
    ligne de critère, note estimée, bouton Candidater, fiche pilote, bouton
    Tenter/Courir — texte différencié raid vs course, ligne séries en cours),
    `game/office/equipe.gd` (OptionButton poste, Licencier/Recruter, label effets),
    `game/research_ui/recherche.gd` (règle pionnier/suiveur sur l'entête, statut
    PIONNIER/breveté, bouton Licence), `game/market_ui/marche.gd` (Retirer, Brader,
    ligne livré/carnet, ligne hangar, bouton +5, ligne licence). Aucun impact sim,
    aucune clé state.
    (b) CROIX DE FERMETURE SUR LES TOASTS — `main.gd _toast()` : la carte passe de
    `mouse_filter = IGNORE` à `PASS` (sinon la croix ne reçoit jamais le clic — le
    filtre `IGNORE` fait traverser TOUT, y compris les enfants cliquables), le label
    reste `IGNORE` pour ne pas bloquer le jeu dessous, nouveau bouton ✕ dans une
    `HBoxContainer` (`pressed.connect(func(): carte.queue_free())`).
    (c) BACKEND PRÊT POUR LA COMPARAISON BUREAU↔AO — `sim/contracts.gd` : extraction
    de `note_specs(state, data, id_ao, specs_p)` (prend des specs BRUTES, pas un
    produit du catalogue) à partir de l'ancien corps de `note_produit`, qui délègue
    maintenant à `note_specs` (refactor pur, comportement identique — permet de noter
    un design EN COURS de conception, avant paiement du prototype).
    RESTE (ni l'un ni l'autre testé/branché côté UI, à finir avant la prochaine
    passe équilibrage) :
    — Écran Concours (`game/contracts_ui/ao.gd`) : toujours un mur de chiffres à la
    résolution (`_remplir_resolution` construit une ligne unique par candidat, une
    seule couleur pour tous les ratios). Refonte prévue : groupes ouvert (détail
    complet, actionnable) / à venir (compact) / résolu (replié, à déplier), et
    couleur PAR critère (vert/rouge par ratio) au lieu d'une couleur de ligne.
    — Bureau (`game/design/blueprint.gd`) : volet « COMPARER À UN APPEL D'OFFRES »
    posé (geometry identique au volet équipements, bouton déclencheur sous
    `_note_marche`, hook de rafraîchissement live dans `_recalculer()`), mais
    `_maj_liste_ao()` (remplir l'OptionButton depuis `Contrats.ouverts`) et
    `_maj_comparaison_ao()` (appeler `Contrats.note_specs` sur les specs live et
    afficher les ratios par critère) restent À ÉCRIRE — le volet s'ouvre vide.
    PIÈGE À NE PAS RE-FAIRE : un `PanelContainer` avec `mouse_filter = IGNORE` fait
    traverser aussi ses enfants cliquables — un bouton dans une carte à clics
    ignorés ne reçoit jamais l'événement, il faut `PASS` sur le conteneur et
    `IGNORE` seulement sur les éléments purement décoratifs/textuels.

Retour playtest n°6 (demande joueur : « en 1934 tout coûte de la fiab, on ne peut pas
utiliser ce qu'on recherche ; la maturité à 7 ans c'est hyper long ») — DEUX vérités
mesurées au harnais : (1) la maturité est basée sur l'ÂGE de la techno → un joueur de
FRONTIÈRE est toujours sur du récent → malus plein permanent, la maturité ne récompense
QUE celui qui gèle un vieux design, donc jamais le joueur qui progresse ; (2) alléger le
malus fiab de l'avionique est un buff quasi PUR des RIVAUX, pas du joueur-bot : le
`_design_rival` (market.gd) monte TOUTE l'avionique débloquée, alors que le glouton
(`bots.gd _produit`) ne monte que capot/pas-variable/train/cockpit/volets — AUCUNE des
radio/instruments/gonio/PA. Test isolé (avionique poids fiab 0.5, sans compensation) :
glouton 30 %→42 % (crise 17→30, HORS cible) — les rivaux dopés écrasent le glouton.
CORRECTIF LIVRÉ (data-only, cibles §15.2 re-tenues, exit 0) : `constants.json`
features_avion `"fiab": 0.5` sur radio_embarquee/instruments_vol/radio_gonio/
pilote_automatique/cockpit_ferme (avionique légère qui ne stresse pas la cellule ;
train/suralim/turbo gardent leur malus plein) — le code lisait déjà `fc_f.get("fiab", 1.0)`
(aircraft.gd), l'affichage delta_feature se réajuste seul ; COMPENSÉ par un nerf rival
de qualité `biais_qualite` Bristow −0.05→−0.075, Marlowe 0.06→0.035 (dimensionné sur le
~0.035 fiab que l'allègement offrait aux rivaux). Résultat : glouton 32 % (crise 27),
faillites globales 18 %, victoires 48/0/52 (equilibre/glouton/pionnier), rivaux 46 %.
LEÇON : un levier de fiabilité qui touche l'avionique buffe les rivaux (qui la montent
toute) BIEN plus que les bots stratégiques (curatés) — toujours compenser côté rival
(`biais_qualite`), pas côté trésorerie bot.
PUIS, MÊME SESSION, MATURITÉ ANCRÉE SUR L'ÉPOQUE (fait, exit 0, ZÉRO compensation
supplémentaire) : `aircraft.gd fiab_composantes` ne calcule plus la maturité sur l'âge de
la techno (`annee_av − date_etat_art`, qui taxait à vie le joueur de frontière toujours sur
du récent) mais sur le CALENDRIER : `progres = max(0, annee_design − fiab_maturite_epoque)`,
`fiab_maturite_epoque` 1936 (remplace `fiab_maturite_grace_ans`, retiré de data ET du code).
Sémantique : c'est l'INDUSTRIE qui mûrit — un équipement monté sur un design conçu en 1940
est fiable même flambant neuf, la R&D récompense enfin celui qui progresse. Ancre 1936 = un
an après la fin de crise (tick 676) → tout design d'annee < 1936 reste à malus plein →
crise §15.2 intacte (glouton crise 27 %, inchangé). Planchers per-feature conservés (radio
0.2, turbo/train 0.6 → dilemme lourd/léger survit à la maturation). `progres` est per-design
(hors boucle features), plus de dépendance à `data["technos"][f]`. Effet joueur : un train
rentrant passe de ~1.9 à ~1.1 pt de malus sur un design de 1940 (et une techno NEUVE de 1940
en profite aussi, ce que l'âge ne donnait jamais). Agrégat harnais quasi inchangé (glouton
32→33 %, globales 18→19 %, victoires 48/0/52, rivaux 46 %) — les faillites late-game sont
~0, donc fiabiliser le late-game ne coûte rien à l'équilibre. run.gd vert (déterminisme,
save/load, calibration). Aucun texte UI stale (le Labo n'affichait pas la maturité).
PUIS, MÊME SESSION, AVIONIQUE MALUS→0→BONUS (demande joueur : « c'est pas logique qu'un
radio soit en négatif ; je veux un malus halvé au début qui remonte à 0 puis passe à +1/+2 »)
— `aircraft.gd fiab_composantes` : deux familles d'équipement. AVIONIQUE (5 features avec
`fiab_bonus_max` en data : radio_embarquee, instruments_vol, radio_gonio, pilote_automatique,
cockpit_ferme) → `lerpf(-malus_plein, fiab_bonus_max, clampf(progres/fiab_bonus_span,0,1))` :
pénalité de jeunesse (poids halvé, système capricieux) qui remonte à 0 PUIS devient un BONUS
(aide éprouvée = vol plus sûr) — −1 pt à 1936, ~0 vers 1939, +2 pt à 1945 (`fiab_bonus_span` 9,
`fiab_bonus_max` 0.02). MÉCANIQUE LOURDE (train, turbo, suralim… : pas de `fiab_bonus_max`) →
inchangée, malus qui décroît vers son plancher mais JAMAIS positif (un train reste un risque
à vie). Crise intacte : design d'annee < 1936 → progres 0 → −malus_plein = le malus halvé
d'avant (harnais exit 0, glouton 33 %/crise 27 %, global 19 %, victoires 48/0/52, rivaux 46 %,
IDENTIQUE — le bonus post-1936 ne touche pas les faillites late-game ~0). DÉGâT UI ÉVITÉ : le
delta `%+d pt fiab` (criteres_ui.DELTAS_AFFICHES) force déjà le signe → un bonus s'affiche
« +2 pt fiab » ; le delta est calculé à `design["annee"]` (année courante) donc il SUIT la
courbe. BUG CORRIGÉ au passage : `blueprint.rafraichir()` (trimestre + affichage écran)
reconstruisait les cases d'équipement avec des deltas VIDES sans rappeler `_recalculer()` — une
année écoulée sur le Bureau laissait les chiffres fiab figés sur l'ancienne année (trompeur au
choix d'équipement) → `rafraichir()` termine maintenant par `if _pret: _recalculer()`. run.gd +
ui.gd verts.
ENFIN, MÊME SESSION, MATURITÉ = TEMPS DEPUIS TA RECHERCHE (modèle C, demande joueur : « je
croyais que rechercher une tech améliorait sa fiabilité ; les malus sont trop élevés pour les
faire mûrir en ne construisant que des avions plus récents ») — la maturité n'est plus le
calendrier (modèle B, ancre 1936) mais `annee_design − ton_année_de_recherche` de CHAQUE
équipement. Récompense de chercher TÔT (le pionnier gagne 52→56 % au harnais — sa R&D précoce
paie enfin en fiabilité). ARCHI (sim reste PUR : `Avion.specs` ne lit pas le state) :
`state["recherche"]["annees"]` = {techno: année de recherche}, rempli aux 2 points d'entrée dans
`faites` (research.gd `acheter_licence` + `tick_hebdo`) ; `sim._nouveau_design` TAMPONNE
`design["mat_features"]` = {f: max(0, annee_design − annees[f])} avant `specs` → figé dans le
design comme le reste des specs, round-trip save/load OK (dict de floats). `aircraft.fiab_composantes`
lit `progres = design["mat_features"].get(f, FALLBACK)`, FALLBACK = calendrier `max(0, annee −
epoque)` : les RIVAUX (designs non tamponnés, `_design_rival` ne passe pas par `_nouveau_design`)
restent sur le modèle B — invisible au joueur, ZÉRO modif market.gd, une migration en moins. Le
Bureau injecte `mat_features` de TOUTES les technos acquises dans `_recalculer` avant `specs` (pas
seulement montées, sinon le delta d'un équipement à cocher partirait sur le fallback). Migration
main.gd : vieux saves sans `annees` → backfill `date_etat_art` (« recherchée à sa disponibilité »,
faute de reconstruire). Bots (bots.gd `_produit` → `Sim.appliquer(nouveau_design)`) tamponnés
automatiquement → le harnais mesure bien le modèle C côté joueur. Crise INTACTE sans compensation
(glouton crise 27→26 %) : pendant 1929-34 les bots n'ont pas tenu leurs technos assez longtemps
(seuil_recherche) pour qu'elles mûrissent → la protection est naturelle, plus besoin de l'ancre.
Harnais exit 0 (glouton 32 %, global 18 %, victoires 44/0/56, rivaux 46 %), run.gd + ui.gd verts.
`fiab_maturite_epoque` (1936) ne sert plus qu'au fallback rival ; les spans `fiab_maturite_ans`
(6) / `fiab_bonus_span` (9) sont désormais comptés en ANS-DEPUIS-TA-RECHERCHE.
PUIS, MÊME SESSION, 4 RETOURS JOUEUR ENCHAÎNÉS (tous exit 0, harnais + run.gd + ui.gd) :
(A) VARIANTE ASSOUPLIE — `sim.gd _nouveau_design` ne rejette plus que la FORMULE différente
(biplan/monoplan) ; structure ET surface peuvent changer, mais le rabais proto/études est
DÉGRESSIF (`Sim.variante_mults`, `variante_structure_devi` 0.5) : tamponné dans le design
(`variante_proto_mult`/`variante_delai_mult`), lu par `Avion.specs` (défaut 1.0 = neuf). Le
Bureau déverrouille structure/surface sur variante et recalcule le rabais live. Motif : rester
coincé sur bois/petite aile enfermait le joueur dans des malus fiab (structure + surcharge)
incorrigibles. JOUEUR SEUL (bots/rivaux n'usent pas de variantes) → zéro impact harnais ;
test run.gd recalé (formule refusée, structure/surface acceptées + rabais dégressif > plancher).
(B) COÛT D'ÉQUIPEMENT DÉGRESSIF AVEC LA COMMUNALITÉ — `aircraft.gd specs` : chaque équipement
coûte `lerp(1.0, cout_maturite_plancher 0.6, age/cout_maturite_span 14)` où age = annee_design −
date_etat_art (CALENDRIER, l'industrie qui banalise = distinct de la FIABILITÉ liée à ta recherche).
Le bleeding-edge coûte plein, le répandu est bon marché. Harnais quasi inchangé (glouton 32→31 %,
crise 26→25) — pendant la crise l'équipement n'est pas assez vieux pour être bien moins cher.
(C) CHARGE UTILE → COÛT STRUCTUREL — `cout_unitaire += charge_utile × cout_par_kg_charge` (10) :
porter plus exige une cellule renforcée, ça se paie (retour « le carburant/la charge ne changent
pas le prix »). Coût SEUL, pas de masse (la charge pèse déjà via masse_totale) ; carburant hors
prix (exploitation). Durcit la crise civile (glouton crise 25→28 %, TOTAL 34 % — dans la cible
mais FRÔLE le plafond 35 : lever `cout_par_kg_charge` si un futur changement stacke) ; pionnier
militaire (charge 0) descend à 18 %. victoires 45/0/55, globales 17 %, rivaux 47 %.
(D) ÉTIQUETTE D'OBSOLESCENCE (UI pure) — `market.gd diagnostic_segment` (note + critère le plus
en retard, HORS chemin chaud de l'allocation qui n'alloue pas de dict) ; pastille sur chaque
produit de la gamme au Marché (`marche.gd _maj_gamme`) : 🔴 OBSOLÈTE < `note_obsolete` 0.7,
🟡 vieillissant < `note_pointe` 1.0, 🟢 à la pointe, infobulle « note X %, autonomie à Y % des
attentes ». CORRIGÉ APRÈS PLAYTEST : la note du badge EXCLUT le critère `reputation` et est
renormalisée sur les seuls critères de CONCEPTION. Symptôme : un avion neuf de 1922 s'affichait
« vieillissant » — en début de partie la maison est inconnue, la réputation est au plancher face
à une réf. de 0.5, ce qui plombait la note de ~0.10. Le tell était que le POSTAL restait vert :
c'est le seul segment SANS critère de réputation (transport 0.20, export 0.18). Le badge juge
l'AVION, pas la notoriété ; la renormalisation rend « 100 % » comparable entre segments (sans
elle le transport, dont 20 % du poids partait en réputation, était structurellement plus sévère).
`qualite_segment` (le vrai calcul de parts) garde la réputation, il n'a PAS bougé.
2e PASSE (le joueur revoyait « vieillissant » sur un avion neuf) : une note basse a DEUX causes
qu'il ne faut pas confondre — l'avion a vieilli pendant que les attentes montaient, OU il est neuf
mais INADAPTÉ au segment. Cas mesuré par sonde : un transport de 1922 (armement 0) vendu en
`export_militaire` marque 0.00 sur l'armement (22 % du poids) → note 0.79, alors que le MÊME
transport vendu en transport fait 1.21 et qu'un chasseur neuf en export fait 1.16. Le badge
départage donc par l'ÂGE du produit (`age_recent_ans` 3) : récent + note basse → « inadapté au
segment » ; ancien + note basse → « vieillissant » / « OBSOLÈTE ». Sans ce partage l'étiquette
accusait la vétusté là où le vrai problème était le mauvais marché.
3e PASSE (« mon avion est vieillissant mais je ne vois aucune baisse de commandes ») : les deux
signaux étaient JUSTES, ils mesurent juste des choses différentes — l'étiquette est ABSOLUE (vs
les attentes de l'époque), la part de marché est RELATIVE (vs les rivaux). Un design de 1922 en
1929 est réellement dépassé, mais garde 42 % parce que Bristow et Marlowe le sont autant. La
tooltip affiche donc maintenant la note du MEILLEUR RIVAL du segment (`produits_du_segment` +
`diagnostic_segment`) et dit explicitement « devant / derrière », avec le rappel que la note se
compare à l'époque et les ventes aux concurrents. NB : l'absence de chute des commandes en 1929
est correcte de toute façon — la demande transport PIQUE à 70/an en 1929 avant de tomber à 27 en
1931 (−61 %) : c'est la courbe de data qui exécute le krach, pas l'événement.
Rappel confirmé au joueur : l'obsolescence EXISTE déjà (les réf. de segment montent
1922→1939, un design figé décroche → `qualite_segment` baisse → `_attractivite` baisse →
part de marché au carré → se vend moins) ; l'étiquette ne fait que la RENDRE VISIBLE.
(E) MANIABILITÉ ENFIN UTILE + TRAÎNÉE FUSELAGE (retour joueur : « tu dis que la maniabilité
joue dans les concours mais je vois aucun critère », « la surface joue beaucoup trop sur la
vitesse ») — LES DEUX N'ÉTAIENT QU'UN SEUL PROBLÈME : la maniabilité n'était critère que dans
1 programme sur 18 (`1927_jockey`) et AUCUN segment, donc agrandir l'aile ne rapportait RIEN et
le curseur de surface n'était qu'un curseur de vitesse. Corrigé en deux temps.
① Poids réel : critère `maniabilite` ajouté au segment `export_militaire` (poids 0.12, pris
surtout sur vitesse 0.30→0.25 — ce qui allège AUSSI le poids de la surface) et aux chasseurs de
l'entre-deux-guerres `1930_c1` (0.15) / `1936_chasseur` (0.10) ; PAS aux intercepteurs tardifs
(F.19/40, F.6/43) — à partir de 1940 la doctrine juge vitesse et plafond, pas le combat
tournoyant (historique + limite la casse). Réf. qui DÉCROÎT (55 en 1922 → 45 en 1939) : l'agilité
comptait plus à l'époque des biplans. Tous les poids revérifiés à somme 1.0 (script python).
② `aircraft.gd` : la traînée parasite n'est plus TOUTE proportionnelle à la surface d'aile —
`aire_trainee = cd0×surface + aire_parasite_fixe` (0.30 m² de plaque plane équivalente :
fuselage/moteur/train, qui ne dépendent pas de l'aile). Avant, rétrécir l'aile donnait de la
vitesse quasi gratuite. `cd0_base` recalé (biplan 0.04→0.023, monoplan 0.03→0.011) → calibration
tenue (285/447/508 km/h, ±5 %). MESURÉ par sonde `Avion.specs` : doubler l'aile (21→45 m²)
coûtait −22 % de vitesse et −22 % d'autonomie, désormais −14.7 % et −15 %. Harnais exit 0
(glouton 34 %, globales 17 %, victoires 42/1/57, rivaux 46 %) sans compensation.
(F) ANTI-SNOWBALL RIVAL (retour joueur : « en 1937 je domine absolument tout, où sont passés
les concurrents ? » — 87/90/100 % de parts) — DIAGNOSTIC : la R&D rivale était financée par le
SEUL CA (`rd_pool += ca_trim × marge × rd_part_rivale`), donc prendre le marché une fois coupait
leur R&D, qui coupait leur CA : spirale de la mort, aucun retour possible. Aggravé par la part
de marché au CARRÉ qui transforme un petit écart de note en raz-de-marée. Le harnais était
AVEUGLE à ça : il mesure les rivaux contre des BOTS médiocres (rivaux à 45-47 %), jamais contre
un humain qui taille ses designs. CORRECTIF (`market.gd _rivaux_rd`) : (1) PLANCHER
`rd_plancher_trim` 12 000 £/trim — une maison d'aviation ne cesse pas de chercher parce qu'elle
a perdu un marché (contrats d'État, autres activités) ; (2) SURSAUT — si la part joueur MOYENNE
tous segments (`_part_joueur_globale`, uid joueur = préfixe "p") dépasse `sursaut_seuil` 0.55,
l'apport est ×`sursaut_mult` 2.5 : l'Air Ministry refuse un fournisseur unique (logique du
shadow scheme, déjà dans le jeu). DORMANT AU HARNAIS par construction (les bots ne dominent
jamais) → campagnes run.gd BIT-IDENTIQUES et harnais inchangé au chiffre près. Test dédié
`_test_rd_plancher_sursaut` (technos toutes données au rival pour qu'il n'achète rien et qu'on
mesure l'apport pur, pas le solde après dépense).
(G) SUR-MESURE DE VOILURE, SYMÉTRIQUE (suite de (F) : « les deux peuvent se cumuler ? » — oui) —
`Marche.meilleure_surface(data, nom_seg, design)` : recherche déterministe (zéro RNG) de la taille
de voilure qui maximise `qualite_segment`, facteurs en data (`surmesure_facteurs`). La réputation
est constante entre candidats (elle ne dépend pas de la voilure) → sans effet sur l'argmax, on la
passe à 0. Appelée par `_design_rival` ET par `bots.gd _produit`.
LEÇON MAJEURE (2 faux départs mesurés) : donner le sur-mesure aux SEULS rivaux envoie le glouton
de 34 % à 54 % de faillites et le pionnier à 64 % de victoires — et `biais_qualite` ne rattrape
que jusqu'à 37 % (plafond 35) avant de SATURER. Diagnostic : ça ne mesurait pas la fragilité du
glouton mais un HANDICAP MÉCANIQUE fraîchement créé — les bots ont des surfaces CODÉES EN DUR
(`bots.gd _produit` : postal 30 / transport 45 / export 18, soit exactement les archétypes
rivaux), donc laisser les rivaux optimiser et pas les bots les rend structurellement inférieurs.
Un vrai joueur CHOISIT sa voilure (il lit la note marché) : les deux camps doivent pouvoir le
faire. Symétrie rétablie → glouton 54 %→27 % SANS toucher `biais_qualite` (resté −0.075 / 0.035).
Restait alors : globales 13 % (plancher 15) et pionnier 62 % de victoires (plafond 60), parce que
l'optimisation généralisée solidifie tout le monde et profite surtout à l'export. UN SEUL levier a
corrigé les deux : réduire l'amplitude de recherche `surmesure_facteurs` de [0.7…1.3] à
[0.85, 1.0, 1.15] (±15 %, plus réaliste pour l'itération d'un bureau d'études). FINAL exit 0 :
crise glouton 32 %, globales 17 %, victoires 46/1/53, rivaux 46 %. RÈGLE À RETENIR : toute
capacité de conception donnée aux rivaux doit être donnée aux bots dans le même commit, sinon on
mesure l'asymétrie et pas l'effet — et on compense au mauvais endroit (`biais_qualite`) jusqu'à
saturation.
(K) DÉFAILLANCE RÉDHIBITOIRE — le jeu n'incitait pas à renouveler sa gamme (retour joueur).
MESURÉ par sonde `qualite_segment` sur un transport de 1922 laissé figé, face à un neuf de
chaque année : rapport 0.86 en 1930 ET en 1939 (au carré 0.74) — un avion de DIX-SEPT ans
gardait les trois quarts de l'attrait d'un modèle neuf, et le décrochage PLAFONNAIT dès 1930.
CAUSE : la note est une somme pondérée bornée à `clamp_qualite` 1.4, donc un design peut
BANQUER du surplus sur un critère facile pour masquer un effondrement sur un critère vital —
le vieux coucou n'emportait que 3 passagers là où le marché en voulait 18 (ratio 0.17) mais se
refaisait sur son coût d'exploitation dérisoire (plafonné à 1.4). CORRECTIF (`qualite_segment`) :
la note est multipliée par une pénalité `min sur les critères de clampf(ratio/critique_seuil,
critique_plancher, 1.0)` — un critère de CONCEPTION effondré n'est plus rachetable. Réputation
exclue (juge la MAISON, pas l'avion, et serait au plancher en début de partie) ; seuls les
critères de poids ≥ `critique_poids_min` 0.15 comptent. DOSAGE, 3 points mesurés (le mécanisme
frappe surtout les BOTS EN CRISE, qui n'ont pas le cash pour renouveler — réaliste mais mortel) :
seuil 0.6/plancher 0.4 → glouton 46 % ❌ ; 0.5/0.6 → 37 % ❌ ; **0.45/0.72 → 33 % ✅**. Effet
retenu : un design de 1922 garde ~38 % de l'attrait d'un neuf en 1939 au lieu de 74 % — la
pression au renouvellement DOUBLE, et 1926 reste inchangé (le début de partie n'est pas puni,
seule la vraie vétusté l'est). FINAL exit 0 : glouton 33 %, globales 19 %, victoires 41/1/58,
rivaux 60 %.
(J) DISCIPLINE D'ÉQUIPEMENT RIVALE — la vraie cause du snowball (retour joueur : « j'écrase à
nouveau la concurrence », export 86 %). DIAGNOSTIC par décomposition de `_attractivite` sur la
capture : le joueur vendait 210 k£ contre un prix médian de 422 k£ → `f_prix = (422/210)^1.2 ≈
2.31`, soit ×5.3 une fois la part AU CARRÉ. Il gagnait par le PRIX, pas par la qualité. Et les
rivaux ne pouvaient pas suivre : leur rabot de prix bute sur `coût × marge_min`, or
`_design_rival` montait TOUT l'équipement débloqué sans jamais peser son coût (23 % du poids à
l'export) → avions sur-équipés, chers, invendables. MÊME ASYMÉTRIE QUE LA VOILURE, à l'envers :
les bots ont toujours eu des listes d'équipement CURATÉES (`bots.gd _produit`), les rivaux non.
CORRECTIF : boucle gloutonne déterministe en fin de `_design_rival` — on retire tout équipement
dont l'ABSENCE améliore `qualite_segment`. Rattrapage de parité, pas un buff. EFFET MESURÉ :
part rivale 46 % → 60 %, trésorerie médiane des bots en forte baisse — les rivaux deviennent
enfin des concurrents. Recalage : le seul dépassement était pionnier 61 % de victoires (plafond
60) ; `biais_qualite` est NON MONOTONE sur le glouton (à −0.090/0.020 il monte à 40 % de
faillites : moins de pression rivale → il prend plus de marché avant la crise → sur-agrandit son
atelier → s'effondre plus fort), donc interpolation entre les deux points mesurés → −0.078 /
0.032. FINAL exit 0 : glouton 31 %, globales 19 %, victoires 42/1/57, rivaux 60 %.
(I) ÉCONOMIE D'UN CONCOURS VISIBLE AVANT DE CANDIDATER (playtest 1933 : « 22 livrés, marge
−649 508 £, j'ai pas compris ») — le joueur avait gagné B.9/32 (prix FIXE 270 k£/appareil) avec
un bombardier excellent donc CHER : coût 316 k£ → −46 k£ par appareil sur les 18, et −127 k£ de
TRÉSORERIE à chaque livraison (le solde n'est que 70 % = 189 k£, l'acompte ayant déjà été
encaissé et dépensé). C'est le piège documenté à l'étape 11, sauf que les BOTS ont une discipline
de coût (`bots.gd` : pas de candidature si `cout_unitaire > prix_unitaire`) et que le JOUEUR
n'avait aucun avertissement — asymétrie injuste. CORRECTIF UI (zéro impact sim) : ligne
« Économie » sous le sélecteur de candidature, recalculée à chaque changement de produit —
prix payé, votre coût, marge par appareil × volume ; ROUGE « ⚠ À PERTE » si coût > prix, MIEL
« ⚠ Trésorerie : le solde ne couvre pas la fabrication » si `solde < coût` (contrat rentable au
total mais qui saigne à chaque livraison — le cas le plus vicieux, invisible sans ça). Nouveau
`Contrats.part_acompte_de` PUBLIC, partagé sim/UI (même principe que `Sim.recette_bradage`) pour
que l'aperçu ne puisse pas diverger de ce que la sim versera ; `_resoudre` l'appelle désormais
au lieu de recalculer l'acompte en local.
(H-bis) HANGAR VISIBLE (même trou, retour joueur : « on dirait qu'ils sont produits instant,
sans les payer ni les mettre dans le fil de production ») — le mécanisme était CORRECT
(`_produire_stock` construit sur la capacité restante ET débite `cout_unitaire`), mais aucun
compteur ne le montrait : la capacité se consommait sans rien afficher. `market.gd` écrit
`state["stock_produit_trim"]` = {uid: construits du trimestre} ; le total d'atelier l'inclut
(« dont N pour le hangar ») et la ligne du produit affiche « N construits ce trim. ». Infobulle
réécrite pour dire à quoi sert le hangar : livraison IMMÉDIATE sans consommer la capacité du
trimestre (on livre donc plus que son palier) + meilleur `f_delai` → meilleure part de marché.
(H) SÉRIES D'ÉTAT ENFIN VISIBLES (retour joueur : « je gagne un concours, les avions sont produits
mais on ne les voit nulle part — livré 0, même pas dans le total ») — CAUSE : le contrat ne
mémorisait pas le produit vainqueur (`uid_g` calculé pour lire les specs puis JETÉ), donc aucune
UI ne pouvait attribuer la série ; et le total d'atelier disait « (hors séries) » faute de mieux,
alors que la série consomme la MÊME capacité (en priorité). CORRECTIF (comptabilité + affichage,
zéro impact équilibrage) : `contracts.gd` stocke `"produit"` dans le contrat et `livrer_trimestre`
écrit `state["ao"]["livrees_trim"]` = {uid: appareils du trimestre} — posé sur le STATE et non sur
le contrat, sinon un contrat achevé ce trimestre-là emporte sa dernière livraison en disparaissant
(`restants`). `marche.gd` : la ligne produit additionne les séries (« livré 6 · … · dont 6 en série
d'État ») et le total d'atelier les INCLUT. Vieux saves : `.get("livrees_trim", {})` et
`.get("produit", "")` → aucune migration.

Retour playtest n°7 (2 bugs, run.gd + ui.gd verts, harnais non rejoué : les bots ne
vendent pas de licence et ne passent pas par les essais → neutre par construction).
(1) SEGMENT VOLÉ PAR LE DESIGN SUIVANT — `blueprint.gd _sur_servir` lisait le segment ET
le prix DANS LE PANNEAU au moment de la mise en service, or la campagne d'essais dure des
mois pendant lesquels le joueur dessine autre chose : un postal sorti d'essais entrait au
catalogue en `transport_civil` (vécu). Les deux sont désormais FIGÉS dans le design au
paiement du prototype (`payload["segment"]`/`["prix"]` dans `_sur_lancer`, relus depuis
`state["designs"]`), repli sur le panneau pour les vieux saves → aucune migration ; le
segment figé s'affiche entre crochets sur chaque ligne d'ESSAIS EN VOL.
(2) LICENCE DE CELLULE — deux rustines (gate sur la qualité de la cellule, puis prime
proportionnelle à l'écart calé par sonde) puis SUPPRESSION de la mécanique sur décision
propriétaire : voir 12-(d), qui garde l'historique complet et la liste de ce qui a été retiré.
(9) LES CONCOURS N'AVAIENT PAS LA DÉFAILLANCE RÉDHIBITOIRE (retour « je gagne les critères
d'un concours avec un avion vieillissant, c'est normal ? » — non). `Contrats._noter` était une
simple somme pondérée de ratios clampés : le joueur emportait Imperial Airways 1931 avec
`capacité 0.44` (critère à 25 % du cahier des charges, il emportait moins de la MOITIÉ de
l'exigence) en banquant sur `autonomie 1.40` et `coût 1.40`, tous deux plafonnés. Or un cahier
des charges est PLUS exigeant qu'un marché ouvert, pas moins — l'incohérence datait de (K),
qui n'avait posé la pénalité que dans `Marche.qualite_segment`. CORRECTIF : même pénalité,
mêmes constantes (`critique_seuil`/`critique_plancher`/`critique_poids_min`) dans `_noter` —
pas de nouvelles clés data, une seule règle à comprendre pour le joueur. Mesuré sur son save :
Imperial Airways 1.01 → 0.92 (à égalité avec Marlowe au lieu de +9 pts), et un CHASSEUR
candidatant sur un cahier « capacité » tombe à 0.55-0.67 au lieu de flirter avec 1.0 — le
recyclage opportuniste d'un design inadapté cesse de payer. HARNAIS : exit 0, et la marge
perdue en (8) revient (glouton 50 % → 47 %, globales 26 %, victoires 58/1/41, rivaux 63 %).
(8) RENOUVELER SA GAMME N'ÉTAIT PAS RENTABLE (suite de (7), retour « mon Airbus est
vieillissant et je domine par le prix ; peut-être que le prix des nouveaux avions est trop
haut, ou que le vieillissement ne pèse pas assez »). D'ABORD LE CONSTAT QUI CORRIGE LA
PERCEPTION : après (7) le joueur était à 30/36/39 % de parts sur les 3 segments — la PARITÉ
à 3 maisons est 33 %, le marché était donc équilibré ; ce qu'il lisait comme domination
(« Vous 4 · Bristow 1 · Marlowe 1 ») ce sont des LIVRAISONS, conséquence de son atelier
palier 2 (13/trim contre 7 et 6) — son investissement, pas un bug. MAIS ses deux hypothèses
étaient bonnes, mesurées sur son save de 1930 : (a) refaire le MÊME avion en 1930 avec ses
11 technos ne gagnait que +2 à +3 % de note pour +25 % de coût unitaire et ~300 k£ de
prototype → garder un design de 1922 était RATIONNEL ; (b) son transport de 1922 emportait
4 passagers là où le marché en voulait 9.2 (ratio 0.43) et ne perdait que 14 % d'attractivité,
parce qu'il se refaisait sur son coût d'exploitation (ratio 1.44, plafonné à 1.40). Le
garde-fou (K) existait mais son `critique_seuil` 0.45 était réglé POUR PROTÉGER LE GLOUTON
sous l'ancien plafond de 35 % de faillites — plafond relevé à 50 % en (7), donc la contrainte
avait disparu. CORRECTIF : `critique_seuil` 0.45 → 0.50 ; `critique_plancher` laissé à 0.72.
LA SÉPARATION DES DEUX EST LE POINT CLÉ (pénalité = `clamp(ratio/seuil, plancher, 1)`) : le
SEUIL frappe le vieillissement ordinaire (ratio ~0.4-0.5, cas du joueur), le PLANCHER ne joue
que sous `seuil × plancher` — des critères écroulés bien plus bas, c'est-à-dire les bots
ruinés en crise. Mesuré : 0.5/0.6 → glouton 58 % ❌ ; **0.5/0.72 → glouton 50 %, globales
27 %, victoires 54/0/46, rivaux 64 %, exit 0** ; effet joueur, transport de 1922 : note
0.86 → 0.77 (l'export et le postal ne bougent pas — aucun critère sous le seuil). ⚠ MARGE
NULLE : le glouton est PILE au plafond de 50 %. Tout renforcement futur des rivaux ou de
l'obsolescence devra être compensé, et PAS par `frais_fixes_sem` (mesuré contre-productif
en (7) : plus riche avant la crise, le glouton sur-agrandit et meurt plus).
(7) LA VRAIE CAUSE DE LA DOMINATION : LA PART DE MARCHÉ NE SUIVAIT PAS LA MAISON. Le
correctif (6) ne changeait RIEN à la part du joueur — contrefactuel sur son save, courbes
identiques à la décimale (50/41/36/35/34/34 avec et sans), seuls les compteurs de technos
bougeaient. Diagnostic refait à la racine en décomposant `_attractivite` sur le save :
en 1932 les attractivités (0.78 / 0.79 / 0.74) donnaient bien des parts 33/32/34 — formule
respectée — mais en 1928 les mêmes 0.83 / 0.92 / 0.83 donnaient 73/14/11. L'écart venait de
`_allouer` : quand un rival RENOUVELLE son produit, l'ancien uid disparaît de `parts` (« produits
disparus : on retire leurs parts »), le neuf repart de ZÉRO et la part effacée est renormalisée
sur les survivants — donc sur le JOUEUR. Courbe trimestrielle mesurée : 32 % → **76 % en un
trimestre** en 1935 (les deux rivaux renouvelaient), puis retour à 32 % en 4 ans (inertie 20 %/trim).
Autrement dit : UN CONCURRENT QUI SE MODERNISE OFFRAIT LE MARCHÉ À SON RIVAL. Correctif :
`_rival_lancer_produit` retourne son uid et `_rivaux_renouveler` reporte la part de l'ancien
produit sur le neuf, à hauteur de `part_reprise_renouv` (un modèle neuf perd une partie de sa
clientèle, pas toute). DOSAGE MESURÉ des deux côtés — pic de part joueur (transport, post-1932)
vs faillites du glouton : 0 % → pic 76 %, glouton 33 % ; 15 % → 64 % ; 25 % → 59 %, glouton 37 % ;
50 % → 48 %, glouton 47 %. Tentative de compensation par `frais_fixes_sem` 2800→2500 : ÉCHEC
et contre-productif (glouton 47 %→55 %) — non-monotonie déjà connue, plus riche avant la crise
il sur-agrandit son atelier. DÉCISION PROPRIÉTAIRE : report 50 % et PLAFOND DE LA CIBLE §15.2
RELEVÉ de 35 % à 50 % (balance.gd + GDD, raison écrite dans les deux) — les 35 % avaient été
calibrés AVEC le bug, ils mesuraient une subvention, pas une difficulté. LEÇON MÉTHODE : le
contrefactuel (même save, avec/sans correctif) est ce qui a évité de livrer (6) comme réponse
à une question à laquelle il ne répondait pas ; et quand des parts observées contredisent la
formule, c'est l'INERTIE ou la RENORMALISATION qu'il faut regarder, pas les facteurs.
(6) « JE DOMINE TOUJOURS AUTANT » — LA VRAIE CAUSE DU SNOWBALL : LE MUR TECHNO. Après (F)
plancher/sursaut de R&D, (G) sur-mesure symétrique et (J) discipline d'équipement, le joueur
tenait encore 75 % du postal et 73 % du transport en 1928. Diagnostic fait sur SA sauvegarde
(clé de la session) : joueur 7 technos, rivaux 2 — avec 668 k£ et 1.13 M£ DORMANTS dans leurs
pools. Ils avaient l'argent et pas le droit de le dépenser : `_rivaux_rd` n'autorise l'achat
que si `annee >= date_etat_art` (SUIVEURS PURS), or le joueur paie des paris PIONNIERS (×4
coût, ×2 durée) et prend deux ans d'avance définitifs. Le sursaut anti-snowball, lui, ne
s'armait jamais : `_part_joueur_globale` moyennait sur TOUS les segments, export compris où
le joueur est absent → (75+73+0)/3 = 49 % < `sursaut_seuil` 0.55. DEUX CORRECTIFS :
(a) TRÉSOR DE GUERRE — au-delà de `pionnier_tresor_mult` (3) fois le prix du pari, un rival
finance la recherche EN AVANCE au lieu de thésauriser ; le tirage `Rng.reel` est conservé À
L'IDENTIQUE (même nombre d'appels, donc même flux — seule la DÉCISION change), condition
indispensable pour que les campagnes du harnais restent comparables. (b) `_part_joueur_globale`
ne compte que les segments où le joueur est PRÉSENT (part > 0). MESURE sur la sauvegarde du
joueur, 1928 → 1934 designs joueur figés : rivaux 2 → 6 technos en un an puis 15/20 en 1934,
part joueur 74 % → 50 % → 41 % → 34 %. CALAGE DU SEUIL AU HARNAIS (4 runs, la tension est
UNIQUE : plus les rivaux rattrapent leur retard techno, plus le glouton civil meurt en
crise) — mult 3 : glouton 31 % ✅ mais globales 14 % ❌ et pionnier 71 % de victoires ❌ ;
mult 5 : glouton 37 % ❌, reste ✅ ; mult 6 : glouton 39 % ❌, reste ✅ ; **mult 4 : exit 0,
glouton 33 % (crise 26), globales 18 %, victoires 44/1/55, rivaux 60 %**. Les deux rivaux de
la partie du joueur restent au-dessus du seuil (Bristow 5.6×, Marlowe 9.4× le prix du pari)
→ le correctif mord bien sur SA partie. LEÇON : quand un rival accumule un pool qu'il ne
dépense pas, ce n'est pas un problème d'argent mais de DROIT DE DÉPENSER — chercher la
condition qui bloque, pas le robinet qui alimente.
(5) « L'ÉQUIPE N'A AUCUN EFFET » (retour : « j'embauche un chercheur et ma recherche en
cours ne diminue pas ») — les 3 bonus s'appliquaient bel et bien (`research.tick_hebdo`
retire `1 + bonus` POINT par semaine ; `sim.prototyper` passe la remise d'études à
`Essais.prototyper` ; `production.capacite` prend le bonus d'atelier), mais AUCUN écran ne
montrait le résultat : le Labo affichait `en_cours` en POINTS sous le libellé « sem
restantes » (embaucher ne bougeait donc pas le chiffre) et le Bureau affichait
`specs.cout_proto` au TARIF PLEIN alors que la sim débitait la remise. Corrigé côté
AFFICHAGE seulement : `recherche.gd _semaines(points)` = `ceil(points / (1 + bonus))` aux
4 emplacements (durée annoncée, en cours, détail) — vérifié par sonde, 13 % → 61 % de bonus
fait passer une techno de 43 à 30 semaines à l'instant de l'embauche ; `blueprint.gd`
applique la remise d'études à la ligne Prototype et au message de lancement. Aucune règle
de sim touchée. LEÇON (3e fois cette session, cf. (1) et (4)) : un chiffre d'UI qui n'est
pas dérivé de la MÊME formule que la sim finit par mentir — ici il ne mentait pas sur la
valeur mais sur l'UNITÉ (points ≠ semaines), ce qui a suffi à faire croire à une mécanique
morte.
(4) FAUX AVERTISSEMENT DE TRÉSORERIE SUR LES CONCOURS (« ça m'avertit alors que je serais
en positif ?!? ») — l'aperçu Économie de `ao.gd` alertait dès que le SOLDE par appareil
(70 %) passait sous le coût de fabrication, ce qui est le cas NORMAL d'un acompte de 30 %.
Or l'algèbre tue le cas : acompte − avance cumulée = vol×prix×p − vol×(coût − prix×(1−p))
= vol×(prix − coût) = LA MARGE TOTALE. Donc dès que le contrat est rentable, l'acompte
couvre TOUJOURS l'avance de fabrication, et la branche « ⚠ Trésorerie » ne pouvait
qu'affoler à tort (vérifié sur 3 cas dont l'Imperial Airways du joueur : 6 × 165 000 £ à
150 990 £ de coût → acompte 297 000 £, avance 212 940 £, jamais dans le rouge). Branche
SUPPRIMÉE, remplacée par une ligne grise qui explique le flux (acompte à la signature,
solde par livraison contre coût de fabrication). Le seul vrai danger reste le « ⚠ À PERTE »
(coût > prix), qui lui est conservé. LEÇON : un avertissement dérivé d'une inégalité doit
être vérifié par l'algèbre avant d'être écrit — celui-ci était vacant depuis sa création.
(3) « MON POSTAL A DISPARU » — FAUX BUG DE SIM, VRAI BUG D'ORDRE D'AFFICHAGE. Diagnostic
fait sur la VRAIE sauvegarde du joueur (`user://sauvegarde_1.json`, lue directement) puis en
rendant l'écran Marché dessus headless : les deux produits étaient bien dans `catalogue`
(p8 postal, p10 transport) et bien RENDUS — mais `Etat.cles_triees` trie en TEXTE, donc
« p10 » passe AVANT « p8 » : le nouveau produit s'insère au-dessus de l'ancien, prend sa
place à l'écran et pousse le premier sous le pli de la colonne (262 px, viewport 432).
`marche.gd _maj_gamme` trie désormais par uid NUMÉRIQUE (ordre de création) — un nouvel
avion s'ajoute EN BAS, les lignes existantes ne bougent plus. La sim garde `cles_triees`
partout (déterminisme) ; c'est l'AFFICHAGE qui doit suivre le temps. Même piège latent
partout où une liste d'uid est montrée au joueur (essais, catalogue rival) au-delà de 10
entrées. MÉTHODE À REPRENDRE : quand un joueur signale une disparition, lire son save avant
de soupçonner la sim — 3 des 4 pistes de code envisagées ici étaient fausses.
(3) ASYMÉTRIE DE DÉPART, MESURÉE PUIS ASSUMÉE (retour « les rivaux lancent sur tous les
segments et ne sont jamais en retard à cause des défauts, moi un seul avion ») — le constat
est EXACT : `_rival_lancer_produit` ne coûte rien, ne passe ni par un prototype ni par les
essais, et les rivaux couvrent les 3 segments (6 produits) dès le 1er trimestre ; sonde
bots : le joueur reste à UN produit jusqu'en 1929, trésorerie 130-190 k£ contre ~240 k£ le
prototype. ESSAI FAIT : facturer l'OUVERTURE d'un segment sur le `rd_pool` rival (état déjà
existant, 1er segment gratuit pour que le marché ne soit pas vide en 1922). RÉSULTAT MESURÉ
à 150 k / 60 k / 25 k / 12 k £ : dans TOUS les cas la trésorerie joueur de 1923 passe de
191 k£ à 780-995 k£ (×4-5) et l'économie reste inflatée jusqu'en 1932 — un trimestre de
marché dégarni se capitalise via la part de marché AU CARRÉ, et le rd_pool amputé retarde
AUSSI leurs technos (double nerf). REVERTÉ, commentaire-garde laissé dans
`_rivaux_renouveler` : la couverture rivale dès 1922 est PORTEUSE, c'est elle qui tient les
premières années — ne pas la retirer sans re-calibrer §15.2. Les réponses du jeu à « je ne
peux faire qu'un avion » existent déjà et sont à MONTRER, pas à ajouter : variante Mk II
(prototype ×0.4), emprunt bancaire, acompte 30 % d'un concours ; et le « jamais de défauts »
rival est déjà payé abstraitement par `biais_qualite` (Bristow −0.078, Marlowe +0.035).

(10) LIVRE DES COMPTES (7e onglet, demande joueur après la faillite de 1936 : « un vrai livre
des comptes avec les charges et les recettes détaillées par année ») — `sim/comptes.gd` :
`state["comptes"]` = {année → {poste → montant}}, alimenté par `Comptes.note(state, poste,
montant)` posé À CÔTÉ des 26 écritures de trésorerie de la sim. DEUX écritures séparées et non
un guichet unique : un journal incomplet reste un bug d'AFFICHAGE, un guichet unique bogué
serait un bug d'ÉCONOMIE. 16 postes (ventes, contrats, entretien, épreuves, brevets, occasion,
banque, conseil / production, charges, prototypes, recherche, atelier, équipe, publicité,
événements). GARDE-FOU DE JUSTESSE, devenu assertion de `ui.gd` : trésorerie de départ + somme
de TOUTES les lignes = trésorerie réelle (écart 0 £ sur 12 ans simulés) — si un futur mouvement
d'argent oublie de se journaliser, le test tombe. Écran `game/comptes/comptes.gd` : courbe de
trésorerie, exercice détaillé (RECETTES / DÉPENSES triées du plus gros au plus petit, totaux,
résultat), puis la liste de tous les exercices cliquables. RETIRÉ : le pop-up 📒 de main.gd
(8 trimestres, non sauvegardé, tout dans un « autres » fourre-tout) et son bouton de barre ;
la classe interne `Courbe` est extraite en `game/ui/courbe.gd` (deux appelants désormais).
Migration `"comptes": {}`. Harnais rejoué : exit 0, chiffres inchangés (le journal n'écrit que
des compteurs). PIÈGE GDSCRIPT : l'insertion automatique des appels a mis 3 lignes à la mauvaise
indentation → « Could not preload resource script » sur les scripts DÉPENDANTS, jamais sur le
fautif ; le message ne nomme pas le vrai coupable, il faut relire les patchs.

(11) PRESSION DE MILIEU/FIN DE PARTIE (retour playtest n°7 : « les deux seules difficultés
sont de sortir un avion avant le 1er trimestre et le concours ruineux ; la crise est facile ;
je domine facilement »). DEUX MÉCANIQUES, choisies avec le propriétaire.
(a) RATTRAPAGE TECHNO — `market._rivaux_rd` : un rival cesse d'être un SUIVEUR PUR dès qu'il
compte `regles.retard_pionnier` (3) technos de retard SUR LE JOUEUR ; il paie alors le pari
pionnier au lieu d'attendre l'état de l'art. Ne s'arme QUE si le joueur mène (un joueur qui ne
cherche pas ne le voit jamais) ; le tirage `Rng.reel` est conservé à l'identique (même nombre
d'appels). Harnais : chiffres INCHANGÉS au point près (47/26/58/63) — les bots ne prennent
jamais assez d'avance techno pour l'armer, il ne mord que contre un humain.
(b) FUSION DES RIVAUX (`market._fusion`, appelée au trimestre) — au-delà de `fusion.seuil_part`
(0.5) de part joueur moyenne sur les segments TENUS, pendant `fusion.trimestres` (8) trimestres
CONSÉCUTIFS et à partir de `fusion.annee_min` (1930), Bristow et Marlowe deviennent
Bristow-Marlowe : capacités, caisses de R&D, technos (union) et réputations (le max) cumulées,
plafond `capacite_max` 20, une une de presse. Maison déclarée en data avec `fusion_only: true`
— `Etat.nouvelle_partie` la saute à l'init, donc tous les lecteurs (`data["rivals"]["maisons"][m]`)
fonctionnent sans une ligne de code en plus. Clé state `fusion_compteur` (+migration), remise à
zéro dès que la domination retombe. Gardes posées là où deux maisons étaient supposées :
`events.gd` (effet `rep_marane_militaire`), `end.gd` (épilogue), `marche.gd` (légende, couleurs
et histogramme lus depuis l'état).
PIÈGE MESURÉ, à ne pas refaire : la 1re version ne gardait que le MEILLEUR appareil par segment
(« une fusion rationalise ») — ça RETIRE un concurrent du marché, puisque la part se calcule au
carré PAR PRODUIT puis se somme par maison : deux avions moyens pèsent plus que le meilleur des
deux seul. Le harnais l'a vu en un run (pionnier 41 % → 61 % de victoires, cible ratée).
Correctif : on conserve les DEUX gammes entières (6 produits), les uid ne bougent pas, la table
des parts n'a rien à rattraper — et `_rivaux_renouveler` boucle désormais sur TOUS les appareils
d'un segment (sinon le second ne serait jamais renouvelé ; comportement bit-identique pour une
maison normale, qui n'en a qu'un). RÈGLE GÉNÉRALE : toute mécanique qui RETIRE un produit rival
du marché est un cadeau au joueur — la mesurer avant de la croire neutre.
FINAL exit 0 : glouton 46 %, globales 26 %, victoires 53/1/46, rivaux 63 %. Test `_test_fusion`
(seuil abaissé dans un `data` DUPLIQUÉ pour tester la mécanique et non le déclencheur ; vérifie
capacité cumulée, somme des parts = 1, et que la maison fusionnée vit encore 3 ans après).

(12) CONSEIL D'ADMINISTRATION RÉPARÉ (retour « j'explose leurs demandes facilement » : mandat
« 120 appareils avant 1938 » affiché 313/120). BUG : `Conseil.progression` lisait
`stats["livraisons"]`, le compteur DEPUIS 1922 — le mandat était rempli le jour de son
annonce. Correctif : base relevée à l'ouverture (`conseil.bases[id]`), on ne compte que ce
qui est livré PENDANT ; et cible ADAPTATIVE = `max(socle, cadence historique × durée du
mandat)` (`conseil.exigence` 1.0) — un objectif absolu est dérisoire pour une grande maison
et hors d'atteinte pour un bureau qui démarre.
CE QUE LA MESURE A RÉVÉLÉ : ces mandats étaient une SUBVENTION FANTÔME de ~400 k£ par partie
(deux primes acquises d'avance), et l'équilibrage §15.2 était calibré AVEC. Correction faite,
glouton 46 % → 74 % de faillites. Six runs pour comprendre, dont deux idées « raisonnables »
mesurées CONTRE-PRODUCTIVES : clémence aux maisons dans le rouge (aucun effet, 61 %) et primes
réduites (72 % — le glouton RÉUSSIT le mandat de 1935 et vivait de sa prime). Ce qui a marché :
socles ramenés à l'échelle d'une fenêtre (120→70, 320→160) et surtout MANDAT DE GUERRE CHANGÉ
DE NATURE — `type: "tresorerie"` (500 k£ en caisse en 1943) au lieu d'un volume de livraisons,
parce qu'une maison civile dont le marché s'évapore en 1939 ne peut AUCUNEMENT l'atteindre
(mesuré : 13-16 appareils livrés en 1939-43 contre 346-404 pour les autres stratégies).
DEUXIÈME BUG TROUVÉ EN CHEMIN, dans le harnais lui-même : la cible « la crise tue 20-50 % des
mal préparés » assertait le taux de faillite TOTAL sur 23 ans, alors que le taux propre à la
fenêtre 1929-34 était calculé, affiché… et jamais testé. Un mandat raté en 1943 comptait donc
comme une mort de la crise de 29. `balance.gd` teste désormais `faillites_glouton_crise` et
affiche les deux chiffres ; le plafond des faillites GLOBALES passe de 30 à 35 % (raison
écrite dans balance.gd et le GDD : les 30 % incluaient la prime fantôme).
FINAL exit 0 : crise 34 %, total 56 %, globales 31 %, victoires 53/0/47, rivaux 63 %.
LEÇON DE MÉTHODE (2e fois cette session après le report de part) : quand un correctif fait
exploser une cible, la première question n'est pas « comment compenser » mais « QU'EST-CE QUE
CETTE CIBLE MESURAIT RÉELLEMENT ». Deux fois sur deux, elle mesurait un bug.

(13) BUREAU D'ÉTUDES MOTEURS (demande joueur : « on pourrait pas faire nos moteurs ? »).
`sim/motors.gd` : fonder le département (900 k£, écran Direction) puis concevoir ses moteurs
au Labo — 4 contrôles (cylindrée 8-45 L, ligne/radial, suralimentation, soin de fabrication)
dont émergent les MÊMES champs qu'un moteur du commerce (engines.json), passage au banc
d'essai (coût + semaines, un projet à la fois), puis homologation au catalogue du Bureau.
EXCLUSIF DU PARTENARIAT MOTORISTE dans les deux sens (intégrer OU sous-traiter). ARCHI : les
specs du moteur maison sont TAMPONNÉES dans le design (`design["moteur_specs"]`, même patron
que `mat_features`) — `aircraft.gd` reste pur et ne connaît pas le state ; `sim._nouveau_design`
accepte un moteur du state comme du data. ÉQUILIBRAGE MESURÉ AVANT L'UI (le réflexe qui a
évité un exploit) : en 1936 un 36 L maison sortait 994 cv contre 860 au Merlin, plus fiable
ET 70 k£ moins cher — strictement dominant. Deux correctifs data : pénalité de DÉMESURE
(`cyl_saine` 24 L, −0.9 pt de fiabilité par litre au-delà — l'histoire du Vulture et du Sabre,
déjà modélisés en moteurs-pièges au catalogue) et `cout_par_litre` 2600 → 4200 (le catalogue
tourne à ~250 £/cv, un moteur maison tombait à 130 : l'économie visée est la marge du
motoriste, ~15-20 %, pas la moitié du prix). Résultat : le département achète du PRIX et du
SUR-MESURE, pas de la supériorité — dépasser le meilleur moteur du commerce fait passer sous
le pivot d'accident. Harnais : chiffres INCHANGÉS (les bots n'en fondent pas — neutre par
construction, comme les essais en vol). Test `_test_moteurs` (exclusivité ×2, unicité du banc,
cycle complet, pente de démesure, tampon des specs).

(14) HANGAR TOUT-OU-RIEN (retour « +5 au hangar les met en atelier sans rien faire d'autre »).
`market._produire_stock` calculait `construire = min(commande, capacité)` puis abandonnait la
commande ENTIÈRE si la trésorerie ne couvrait pas le lot (`if treso < cout: continue`) : cinq
appareils à 150 k£ pièce = 750 k£ d'un coup, sinon ZÉRO construit et la commande restait « en
atelier » indéfiniment, sans un mot. Correctif : `construire = min(construire, floor(treso /
cout_unitaire))` — on construit ce qu'on peut payer. UI : la ligne dit désormais pourquoi rien
ne sort (`rien construit : trésorerie < N £ l'unité`) ou, à défaut, le prix unitaire à prévoir.
NB au passage, ce n'est PAS un bug : un appareil construit peut disparaître du hangar le
trimestre même — `_produire_stock` tourne avant `_allouer`, et le stock sert le carnet en
priorité (c'est sa raison d'être). Test dans run.gd : 5 commandés, de quoi en payer 2 → 2
construits, 3 restants. Harnais inchangé (les bots ne commandent jamais de stock).

(15) SPECS FIGÉES AVEC UN MOTEUR MAISON (retour immédiat après la livraison de 13) — au
Bureau, bouger un curseur ne changeait plus rien dès qu'un moteur maison était sélectionné.
CAUSE : `Avion.specs` lit le moteur dans `design["moteur_specs"]` (tampon) et, à défaut, dans
`data["engines"]` ; or SEULE la sim posait ce tampon (`_nouveau_design`). L'écran, lui, appelle
`Avion.specs` en direct à chaque mouvement de curseur avec un design NON tamponné → dictionnaire
vide → le calcul avorte et les libellés gardent leur dernière valeur. Correctif : `blueprint.
_recalculer` tamponne `moteur_specs` comme il tamponne déjà `mat_features` (et l'efface quand le
moteur redevient un moteur du commerce) ; même garde dans `silhouette.gd`, qui lisait aussi
`data["engines"][...]` sans filet et crachait une erreur par frame. LEÇON (la même que pour les
deltas d'équipement) : tout ce qui s'affiche doit passer par le MÊME chemin de calcul que la sim,
tampons compris — un nouveau champ de design est un contrat que l'UI doit honorer aussi.
Test `ui.gd` sur un ÉTAT DÉDIÉ (poser du cash sur l'état partagé cassait l'assertion du livre
des comptes : le journal ne peut pas expliquer de l'argent sorti de nulle part — le garde-fou
a fait son travail dès le premier essai).

(16) MOTEUR MAISON : PRIX AU CHEVAL + RÉÉVALUATION DES FICHES (retour « mon moteur est super
cher comparé au Napier Lion » puis « on dirait que les modifs ne sont pas appliquées »).
DEUX BUGS DISTINCTS. (a) ASSIETTE DE FACTURATION : `cout = cylindrée × cout_par_litre` alors
que la puissance PAR LITRE double entre 1922 (13 cv/l) et 1945 (38) — un moteur maison était
donc ruineux au début (303 £/cv en 1930) et bradé à la fin (135 £/cv en 1944), quand le
catalogue du commerce tient 211-270 £/cv sur toute la période. La veille j'avais « corrigé »
la domination d'un 36 L en DOUBLANT le prix au litre : mauvais levier, le problème n'était
pas le tarif mais l'assiette. Correctif : `cout = puissance × cout_par_cv` (165 £/cv, ×1.45
à soin maximal) → 165 £/cv à soin 0 (fiab 0.80), 202 à soin 0.5 (0.86), 239 à soin 1.0 (0.92)
= le prix du commerce contre une fiabilité qu'on n'y achète pas. `suralim_cout` 1.2 → 1.05
(sa puissance est déjà facturée). Ce qui empêche l'abus : mes moteurs sont MOINS denses en
puissance que le catalogue — égaler les 450 cv du Napier Lion de 1924 demande 33 L au lieu de
ses 24, soit +60 kg et la pénalité de démesure.
(b) FICHES FIGÉES : un moteur homologué stocke ses specs (dont le prix) dans le state — le
correctif ne valait donc que pour les moteurs FUTURS, et le joueur lisait un tarif que plus
aucune règle ne produisait (mesuré sur son save : Neptune 486 cv à 182 700 £, soit 375 £/cv).
`Moteurs.reevaluer_prix` (appelée à la reprise d'une sauvegarde, main.gd) recalcule le SEUL
coût aux constantes courantes — puissance, masse et fiabilité ne bougent pas, c'est un moteur
qui existe. Son Neptune : 182 700 → 108 256 £. Les nouvelles fiches mémorisent leur `projet`
(cylindrée, architecture, suralimentation, soin) ; pour les anciennes, le soin se DÉDUIT de la
fiabilité (fiab = base + soin×pente − stress − démesure, les autres termes étant calculables)
— exact, 78 % retrouvés sur son moteur. LEÇON : toute donnée dérivée figée dans le state
(specs de moteur, de produit, de design) échappe aux correctifs d'équilibrage ; soit on
mémorise de quoi la recalculer, soit on assume qu'elle est historique.

(17) 4e PALIER D'ATELIER, l'usine de l'ombre (demande joueur : « une dernière extension pour
absorber les commandes de fin de jeu », puis « fais-la plus chère, j'ai 28 M£ en caisse »).
ZÉRO ligne de code : `paliers_atelier` / `cout_palier` / `delai_palier_sem` /
`entretien_atelier_sem` sont des tableaux et tout est borné par `paliers.size()` (production.gd
ET bots.gd). Valeurs : 64 appareils/trim, 8 000 000 £, 30 semaines de chantier, 45 000 £/sem
d'entretien (585 k£/trimestre, À VIE). L'entretien est le vrai design : il transforme
l'agrandissement en PARI — 11,7 M£ sur les cinq dernières années si la guerre ne remplit pas
les carnets. Effet de bord recherché : à 8 M£ le bot glouton (1-2 M£ de trésorerie) ne peut
PAS l'acheter, donc le piège documenté (un bot plus riche sur-agrandit et meurt davantage) ne
peut pas se déclencher.

(18) TROIS MÉCANIQUES DE FIN DE PARTIE (retour playtest n°7, run complet : « fini à 75 M£,
plus de challenge sinon produire en masse et remporter les concours »). Demande propriétaire :
les trois d'un coup.
(a) IMPÔT SUR LES BÉNÉFICES DE GUERRE — `sim/impots.gd`, Excess Profits Duty (100 % au UK en
1940). Au passage d'année, l'exercice CLOS est lu dans le journal comptable (`Comptes.totaux`)
et 80 % du résultat au-delà de `franchise` (3.5 M£) part au Trésor, plafonné à la trésorerie
disponible (l'impôt empêche l'accumulation, il ne provoque pas la faillite). Poste `impots` au
livre des comptes. On taxe un PROFIT, pas un capital : lire le journal et non `tresorerie` est
ce qui rend la règle juste.
(b) BOMBARDEMENTS + DISPERSION — `sim/bombardements.gd` : de 1940 à 1944, risque trimestriel
`base + capacité × par_appareil_capacite` (une usine de 64 appareils se voit de loin), dégâts
en SEMAINES qui amputent `Production.capacite` au prorata du trimestre. Parade : disperser les
chaînes (2.5 M£, écran Direction) — risque ×0.35, dégâts ×0.4 — à acheter AVANT, comme
Supermarine après la destruction de Woolston. RNG tiré SEULEMENT quand le risque existe : les
campagnes d'avant 1940 restent bit-identiques.
(c) ALLOCATION D'ATELIER — `state["alloc_marche"]` (0..1, défaut 0 = comportement historique) :
la part réservée au marché est mise de côté AVANT `Contrats.livrer_trimestre`, donc la priorité
d'État n'est plus absolue. Son prix : `Contrats._patience` — au-delà de `patience_trim` (4)
trimestres, une série en retard coûte réputation ET faveur du ministère à CHAQUE trimestre.
Curseur au Marché, visible dès qu'une série est en cours.
CE QUE LE HARNAIS A RÉVÉLÉ (4 runs d'isolement, et un DÉFAUT DE MÉTRIQUE de plus) : chaque
mécanique prise seule faisait « échouer » la cible « aucune stratégie ne gagne >60 % » — raids
seuls 64 %, impôt seul 69 % — ET LE DOSAGE N'Y CHANGEAIT RIEN (raids adoucis : 64 % identique ;
impôt à 45 % au lieu de 80 % : 69 % identique). Cause : équilibré et pionnier terminent à 6 %
de trésorerie l'un de l'autre, et l'impôt les rapproche encore (45.19 vs 45.30 MF, soit 0.2 %).
Le compte de victoires départage alors un PHOTO-FINISH : il bascule sur du bruit, et signale
« domination » précisément quand les stratégies deviennent égales — l'inverse de son intention.
CORRECTIF (décision propriétaire) : la cible teste désormais DEUX conditions — victoires > 60 %
ET écart de richesse > `ECART_DOMINATION` (15 %) entre le champion et le meilleur des autres.
Une vraie domination (gagner souvent et finir bien plus riche) reste détectée ; une égalité ne
sonne plus l'alarme. Le harnais affiche l'écart à chaque run. FINAL exit 0, les trois mécaniques
actives : crise 34 %, globales 31 %, victoires 69/0/31 avec un écart de richesse de −1 % (le
« champion » finit plus PAUVRE que son rival — la démonstration du défaut de métrique).
BOTS : `tests/bots.gd _dispersion` achète la parade dès qu'ils ont 3× le prix, deux ans avant
les premiers raids — toute capacité donnée au joueur doit l'être aux bots dans le même commit
(règle déjà apprise au sur-mesure de voilure ; je l'ai oubliée et le harnais me l'a rappelée).
LEÇON : quand plusieurs dosages différents donnent le MÊME résultat, ce n'est pas un problème
d'équilibrage — c'est la métrique qui est binaire ou mal posée.

(19) PLAFOND D'ATELIER TEMPORAIRE + LIBELLÉ HONNÊTE (retour « le clic pour agrandir ne
fonctionne pas, j'ai l'argent pourtant » puis « pourquoi bloquer l'extension de la ligne,
je savais pas que cela allait donner cela »). Le joueur avait accepté le plan de
nationalisation de 1936 (800 000 £ + faveur du ministère) SANS savoir qu'il renonçait À VIE
à tout agrandissement — la contrepartie était dans le corps de l'événement, pas dans le
libellé du bouton, et l'écran ne rappelait jamais l'engagement ensuite. Trois défauts, trois
correctifs. (a) Le plafond devient une ÉCHÉANCE : `eco.plafond_atelier_sem` (260 = 5 ans),
`state["plafond_atelier_fin"]` posée par `events.gd`, et deux helpers PUBLICS dans
production.gd (`plafond_actif` / `plafond_reste_sem`) que TOUS les lecteurs utilisent —
`agrandir`, le Marché, la Direction, `end.gd` — au lieu de relire le booléen chacun de son
côté. Justification de fond : le shadow scheme est un dispositif de guerre, pas une
expropriation ; et depuis le 4e palier à 8 M£ (17), condamner l'usine condamnait la fin de
partie. (b) Le libellé du bouton porte la contrepartie (« Accepter : 800 000 £ + faveur du
ministère, mais aucun agrandissement d'atelier pendant 5 ans ») — une option irréversible se
juge sur le bouton, pas dans un paragraphe. (c) Le blocage est VISIBLE là où on le subit :
Marché et Direction affichent les semaines restantes, et le bouton d'agrandissement se grise
avec le montant manquant quand c'est la trésorerie qui bloque (avant, un clic sans effet et
aucune explication). MIGRATION : les vieux saves n'ont qu'un booléen ; l'échéance est
reconstituée depuis la DATE de l'événement en data (scan de `capacite_plafonnee`) et NON
depuis la reprise — le joueur récupère exactement les 5 ans promis (vérifié sur son save :
gel jusqu'en 1941.7, 179 semaines restantes en 1938.25). Harnais inchangé (les bots ne
subissent pas cet événement) : exit 0, crise 34 %, globales 31 %, victoires 69 %/écart −1 %,
rivaux 63 %. LEÇON : un coût qui ne s'affiche qu'au moment où il mord n'est pas un
arbitrage, c'est un piège — le prix d'une option doit être lisible AVANT le clic et
rappelé TANT QU'il court.

Retour playtest n°8 (partie complète jusqu'en mai 1945, 49,4 M£ en caisse : « l'équilibrage
n'a pas fonctionné, je m'en mets plein les poches »). DIAGNOSTIC FAIT SUR LE SAVE (méthode déjà
éprouvée : lire le journal comptable AVANT de soupçonner une formule) — trésorerie = 420 k£ +
somme des résultats annuels, donc le livre des comptes dit exactement d'où vient l'argent :
+208 k£ sur 1922-1935 (quatorze ans pour rien), +26,8 M£ sur 1936-1941, +44,0 M£ sur 1942-43,
−24,5 M£ en 1944 (série d'État à prix fixe livrée sous le coût — le piège documenté à l'étape 11,
qui a AUSSI annulé l'impôt de 1945). CA cumulé 694,9 M£, marge brute 19,6 %, 1 932 appareils.
LE POINT CLÉ : 27 M£ étaient déjà en caisse fin 1941, c'est-à-dire avant que l'impôt ne morde.
QUATRE CAUSES, dans l'ordre de contribution.
(1) LE FACTEUR PRIX N'ÉTAIT PAS BORNÉ — la vraie cause. `_attractivite` calculait
`f_prix = pow(prix_median / prix, 1.2)` sans plafond, et la part se prend AU CARRÉ : un appareil
vendu 3× moins cher que la médiane valait ×3.9 d'attrait, donc ×15 de part. Or la pénalité
d'obsolescence (K) est BORNÉE (`critique_plancher` 0.72, soit −28 % maxi) — inversion
structurelle : un design vieux est vieux PARCE QU'il est léger et peu équipé, donc son
obsolescence baisse son COÛT plus vite qu'elle ne baisse son attrait, et vendre du dépassé pas
cher devenait la stratégie dominante. Vérifié sur le save : p21, un transport de 1931 à
224 km/h, tenait 92,2 % du transport civil en 1945 face à un rival de 433 km/h — parce qu'il
coûtait 240 k£ à fabriquer contre 786 k£. Idem p40 (1938) à 54 % de l'export. CORRECTIF :
`clamp_prix` 2.0 (data) + `minf` dans `_attractivite` — le prix reste un levier, il cesse d'être
LE levier. Test `_test_clamp_prix` (médiane ×1.5 avantage encore, ×20 bute à ×2.0).
(2) PLUS PERSONNE NE POUVAIT LE CONTESTER — les rivaux fusionnés plafonnaient à 20 appareils/trim
(`fusion.capacite_max`) contre les 64 du joueur au 4e palier, sur un marché export qui demande
250 appareils/an en 1943 : le joueur pouvait fournir le segment ENTIER à lui seul, donc son prix
n'était jamais contesté (23 M£ de R&D dormaient dans leur caisse — ils avaient l'argent, pas les
chaînes). L'étape 17 avait ajouté le 4e palier sans jamais relever le plafond d'en face.
CORRECTIF : `capacite_max` 16→24, `fusion.capacite_max` 20→48.
(3) L'IMPÔT ARRIVAIT APRÈS LA BATAILLE — fenêtre 1940+ et franchise 3,5 M£/AN, soit 21 M£ de
profit exonéré par construction sur six ans ; les 23,6 M£ engrangés en 1936-40 passaient intacts.
CORRECTIF : `annee_debut` 1940→1937 (historiquement juste : National Defence Contribution UK
1937) et `franchise` 3,5 M£→1 M£. Contrefactuel statique sur le save du joueur : 35,8 M£ → 48,4 M£
d'impôt (+12,6 M£).
(4) L'ATELIER N'A JAMAIS EU DE RENDEMENT DÉCROISSANT — entretien marginal par appareil
supplémentaire : 6 500 £ (palier 2), 4 790 £ (palier 3), 13 810 £ (palier 4), contre 122 000 à
245 000 £ de marge unitaire. CORRECTIF : `entretien_atelier_sem[3]` 45 k→100 k/sem.
LEVIER MORT AU HARNAIS, MESURÉ (sonde jetable `tests/probe_palier.gd`, 20 graines × 3 stratégies) :
palier final atteint = équilibré 3 (20/20), glouton 2 (19/20), pionnier 3 (13/20) — **aucun bot
n'achète JAMAIS le 4e palier**. Le blocage n'est pas l'argent (l'équilibré finit à 33 M£) mais la
condition de carnet de `bots.gd _expansion` (`carnet > exp_carnet × 32`). Les runs à 130 k et à
100 k sont donc sortis BIT-IDENTIQUES : cette valeur est un réglage purement joueur, que le
harnais ne peut pas arbitrer. Retenu 100 k (le contrefactuel statique sur le save du joueur donne
+20,9 M£ d'entretien sur ses 7,3 ans de possession, contre +32,3 M£ à 130 k).
⚠ ALLER-RETOUR À NE PAS REFAIRE : j'ai d'abord annoncé ce levier neutre (juste), puis attribué à
lui les 35 % de faillites du pionnier militaire (faux), avant que deux sondes ne tranchent.
LEÇON DOUBLE : « les bots ne peuvent pas se le payer » ET « c'est ce levier qui a bougé la
cible » sont deux hypothèses à MESURER ; et une sonde jetable de 25 lignes tranche en une minute
ce qu'un run de harnais à 100 graines ne dit pas.
ATTRIBUTION MESURÉE ENSUITE (sonde `probe_attrib.gd` : pionnier SEUL — ÷3 de temps machine —
100 graines × 5 variantes de data mutées EN MÉMOIRE, un seul process, aucune édition de fichier
entre les runs) :
  tout ON 35 % / 35,35 M£ · sans A 35 % / 34,73 · sans B 35 % / 35,58 · sans C 35 % / 42,72 ·
  baseline (A+B+C off) 35 % / 42,75  (faillites % · trésorerie médiane des survivants)
DEUX ENSEIGNEMENTS. (1) LES 35 % SONT PRÉ-EXISTANTS — ils sont déjà là dans la baseline, aucun
des quatre leviers ne les a causés. Je les avais comparés au « pionnier 1 % » de la ligne
d'équilibrage de l'étape 7, que ce fichier signale lui-même comme PÉRIMÉE : **citer un chiffre
obsolète comme référence au lieu de mesurer la baseline** est l'erreur de méthode de la session.
(2) C EST LE SEUL LEVIER QUI TOUCHE L'ÉCONOMIE DES BOTS (42,7 → 35,4 M£, −17 %, l'effet visé) ;
A et B sont INVISIBLES au harnais (±2 %, dans le bruit) — et c'est correct par construction : A
vise un exploit humain (les bots ne bradent pas de designs obsolètes, leurs listes d'équipement
sont curatées), B vise un endgame dominé par un humain (les bots ne dominent jamais assez pour
que le plafond de fusion morde). COROLLAIRE À RETENIR : le harnais ne peut pas VALIDER un
correctif anti-exploit-joueur, seulement vérifier qu'il ne casse rien — la validation de A et B
est un playtest, pas un exit code.
FINAL exit 0 : crise glouton 34 % (total 59 %), faillites globales 32 %, victoires 61/0/39
(équilibre/glouton/pionnier), écart de richesse −5 %, rivaux 65 %. Trésorerie médiane de fin
de partie ~45 M£ → 33,7 / 35,4 M£ (−25 %), c'est l'objet même de la passe.
CONTREFACTUEL SUR SA PARTIE (statique, trajectoire figée — donc majorant) : C aurait repris
12,6 M£ de plus, D 32,3 M£ d'entretien supplémentaire sur les 7,3 ans où il a possédé le
4e palier, et A aurait effondré ses 92 %/54 % de parts. Les quatre ensemble le ramenaient
sous zéro : un joueur humain qui achète le 4e palier TÔT et le remplit à 60 % est désormais
en perte sèche. C'est le « pari » voulu à l'étape 17, mais le dosage de D reste à confirmer
en playtest.

Retour playtest n°9 (partie post-passe n°8 : 25,0 M£ au lieu de 49,4 — « plus challengeante mais
toujours autant de tune »). CE QUI A FREINÉ, lu au journal : l'entretien du 4e palier (charges
942 k£ en 1938 → 5,54 M£/an dès 1940, ~36 M£ sur sept ans) et la capacité rivale (Bristow-Marlowe
à 28/trim détient 100 % du transport civil, contre 13/trim et 8 % la partie d'avant). L'impôt n'a
repris que 15,2 M£ contre 35,8 : les profits étant devenus PLATS (meilleur exercice 9,1 M£ contre
33,7), la franchise annuelle et les années à perte l'annulent souvent.
CE QUI FUIT ENCORE, mesuré par sonde de décomposition sur le save (qualité, `f_prix` brut vs
clampé, pire critère, par produit) : ses trois produits dominants sont BUTÉS au clamp (brut 2,88
à 3,22) et surtout **son chasseur de 1941 à 346 km/h note MIEUX (1.04) que le chasseur rival de
1944 à 566 km/h (0.99)**. Décomposition : il perd 0,088 sur la vitesse et 0,055 sur l'armement,
mais gagne 0,193 sur le seul critère de coût (ratio 1,61 → BUTÉ à `clamp_qualite` 1.4, soit 0,322
du total contre 0,129 au rival). LE PRIX BAS EST DONC COMPTÉ DEUX FOIS : une fois comme critère
de qualité, une fois comme `f_prix`. La pénalité rédhibitoire ne rattrape rien (pire ratio 0,56,
au-dessus de `critique_seuil` 0.5).
DEUX CORRECTIFS ESSAYÉS, LES DEUX MAUVAIS, MESURÉS ET REVERTÉS (sonde 4 variantes × 2 stratégies
riches × 100 graines ; les témoins reproduisent le harnais au centième, ce qui valide la sonde) :
  ni l'un ni l'autre  équilibre 33.67 M£ · pionnier 35.35 · part rivale 62 %
  clamp_prix 1.5      équilibre 40.71 (+21 %) · pionnier 36.24 · part rivale 56 %
  poids coût 0.23→0.10  équilibre 44.88 (+33 %) · pionnier 39.81 · part rivale 54 %
  les deux            équilibre 45.05 · pionnier 40.96 · part rivale 54 %
(1) BAISSER LE POIDS DU CRITÈRE COÛT pousse tout le monde vers le HAUT DE GAMME, et le haut de
gamme veut dire des marges ABSOLUES plus grosses : +33 % de trésorerie bot. L'inverse du but.
(2) BAISSER `clamp_prix` À 1.5 ENRICHIT AUSSI LES BOTS (+21 %) et affaiblit les rivaux (62→56 %) —
contre-intuitif jusqu'à ce qu'on relise `_rivaux_reagir` : un rival qui perd du terrain rabote son
prix de 3 %/trim jusqu'à `coût × 1,05`, donc **dans un segment contesté c'est le RIVAL l'acteur
bon marché**, et son `f_prix` légitime vit entre 1,5 et 2,0. À 2.0 le clamp ne mord que les cas
extrêmes (le joueur à 2,9-3,2) ; à 1.5 il désarme le mécanisme de reconquête rival. `clamp_prix`
2.0 n'est donc PAS un réglage à descendre : c'est un plafond anti-exploit, pas un curseur.
RÈGLE QUI EN SORT : un levier qui touche l'attractivité touche les DEUX camps, et le camp qu'on
croit viser n'est pas toujours celui qui l'utilise le plus. Vérifier QUI est réellement bon marché
dans un segment avant de taxer le bon marché.
(3) PLAFOND PAR CRITÈRE — LIVRÉ, et c'est la 3e mesure du MÊME phénomène. `qualite_segment` et
`diagnostic_segment` lisent `crit.get("clamp", cm["clamp_qualite"])` ; `segments.json` porte
`"clamp": 1.0` sur le seul critère de coût de l'export : être moins cher que la référence cesse
de RAPPORTER au-delà de la référence, mais être CHER coûte toujours (asymétrie vérifiée par
`_test_clamp_prix` : coût ×0.5 → 0.965 = coût à la réf → 0.965, coût ×2 → 0.850). Mesure :
équilibre 33.67 → 40.71 M£ (+21 %), pionnier 35.35 → 37.83, rivaux et glouton INCHANGÉS
(crise 34 %, globales 32 %, exit 0).
LA CAUSE COMMUNE AUX TROIS ÉCHECS, enfin nommée : les bots taillent leur voilure avec
`Marche.meilleure_surface`, qui MAXIMISE `qualite_segment` — donc tout levier qui réduit la
récompense du bon marché déplace leur optimum vers des avions plus gros et plus chers, et comme
ils facturent un POURCENTAGE FIXE (coût × 1.24-1.30), un avion plus cher = une marge ABSOLUE
plus grosse. **La racine de « le joueur finit riche » n'est donc pas le critère de coût : c'est
que la marge est un pourcentage d'un coût qui quadruple sur la campagne** (300 k£ en 1931 →
1.28 M£ en 1945). Tout levier d'ATTRACTIVITÉ enrichit tout le monde. Les seuls leviers qui ont
réellement réduit la trésorerie sont d'une autre famille : le VOLUME (capacité rivale), un COÛT
FIXE QUI SUIT LA TAILLE (entretien d'atelier, ~36 M£ sur la partie du joueur) et l'IMPÔT.
COMPENSATION ESSAYÉE PUIS RETIRÉE : `entretien_atelier_sem[2]` (palier 3) 11 000 → 18 000 £/sem,
choisi parce que la sonde des paliers montre que l'équilibré atteint le palier 3 dans 20/20
campagnes et le pionnier dans 13/20, mais que le glouton s'arrête au palier 2 — donc ça ponctionne
les deux stratégies riches en épargnant le glouton, au bord de sa cible de crise. Prédiction juste
sur le SIGNE (glouton 34 % inchangé au point près) mais l'AMPLITUDE est dérisoire : −0.97 M£
(−2,4 %) au lieu des −5,5 M£ estimés, parce que les bots n'atteignent le palier 3 que TARD
(5-7 ans de possession, pas 15). Il faudrait ~60 k£/sem pour payer le +21 %, soit plus de la
moitié du palier 4 pour la moitié de la capacité : absurde. RETIRÉ (un réglage qui fait 2 % n'est
pas une compensation, c'est un nombre magique de plus).
DÉCISION : le plafond par critère est CONSERVÉ malgré le +21 % bot, et c'est un arbitrage assumé,
pas une mesure. Motif : le harnais ne peut pas voir l'exploit visé (les bots ne pilotent pas une
gamme figée de 1937 ; le joueur, si), la pathologie corrigée est exactement ce dont il s'est
plaint sur deux playtests, et toutes les cibles §15.2 passent. Statique sur son save : p52
1.04 → 0.95, p42 0.99 → ~0.90, b62 inchangé (ratio de coût 0.56, sous le plafond). À VALIDER EN
PLAYTEST — même statut que (A) et (B) de la passe n°8.
ÉTAT FINAL : équilibre 39.7-40.7 M£, pionnier 36.9-37.8, crise glouton 34 %, globales 32 %,
victoires 75/0/25, écart +8 %, rivaux 62 %, exit 0.

Retour playtest n°10 (partie post-passe n°9 : 12,26 M£ — 25,0 puis 49,4 les deux précédentes).
CE QUI FAIT LE TRAVAIL, lu au journal : entretien du 4e palier ~33 M£ sur 1939-44 (5,59 M£/an),
impôt 16,9 M£, et RÉPUTATION EFFONDRÉE (civile 0,49, militaire 0,37 contre 0,55/0,58) parce que
le joueur a remis `alloc_marche` à 1,0 — l'atelier ne livre rien à l'État, `Contrats._patience`
ponctionne, et son `f_repu` tombe à 0,921 contre 1,016 au rival. Le mécanisme fonctionne.
Résultats annuels : 1922-1934 = −301 k£ (TREIZE ans pour rien), 1938 = −5,25 M£ (4e palier 8 M£
+ dispersion 2,5 M£), 1942 = +14,58 M£ (pic), 1943 = −13,22 M£ dont 82 % d'impôt (10,87 M£ assis
sur 1942), marge brute 1943 tombée à 5,9 % contre 26 % en 1942.
STRUCTURE DE SA PARTIE : CINQ produits, TOUS sur `export_militaire` (79,8 % du segment) ; les
deux segments civils sont à 100 % aux rivaux. Décomposition (refs 1945, médiane 765 k£) :
  p22 1930 348 km/h 2 armes 234 k£ → q 0.774  f_prix 3.18→2.00 BUTÉ  part 25,8 %
  p43 1937 374      3      272 k£ → q 0.847  f_prix 2.65→2.00 BUTÉ  part 30,6 %
  p67 1944 653      6    1 057 k£ → q 0.811  f_prix 0.52          part  1,1 %
  b63 1943 623      5      750 k£ → q 1.004  f_prix 0.97          part 10,3 %
TROIS CONSTATS. (1) le plafond par critère de la passe n°9 a fonctionné exactement comme annoncé
(ratios de coût 1.92 et 1.66 ramenés à 1.0, −0.09 de qualité chacun). (2) ils gagnent UNIQUEMENT
par `f_prix` buté : leur qualité est inférieure à celle du rival, la mécanique dit correctement
que ce sont de mauvais avions, et ×2 d'attrait = ×4 de part efface le verdict. (3) **BUG
CONCEPTUEL, à l'envers de l'intention** : le SEUL avion moderne du joueur était puni par la
défaillance rédhibitoire À CAUSE DE SON COÛT (ratio 0.4256 / seuil 0.5 = 0.851 sur toute la note),
parce que le critère `cout` pèse 0.23 ≥ `critique_poids_min`. Or cette pénalité dit « un critère
de CONCEPTION effondré ne se rachète pas » — la réputation en est exclue pour cette raison, et un
PRIX n'est pas une conception non plus. Le jeu punissait donc DEUX fois l'avion cher (`f_prix` +
pénalité) et ZÉRO fois l'avion obsolète (pénalité 1.0). (4) le joueur FIXE SA PROPRE MÉDIANE :
5 produits sur 7 du segment, et la médiane (765 k£) est son p50 qui ne fait que 7 % de part —
garder des modèles chers et peu vendus gonfle le rabais des modèles bon marché.
TROIS CORRECTIFS LIVRÉS.
(A) `hors_penalite: true` en data (lu par `qualite_segment`) exclut le coût de la pénalité
rédhibitoire, comme la réputation. p67 : pénalité 0.851 → 1.0, qualité 0.811 → 0.953. Les
obsolètes ne bougent pas — leur pénalité valait déjà 1.0. PREMIER levier de la série qui soit
asymétrique dans le bon sens.
(B) référence de coût réactualisée : [[1922,160000],[1925,180000],[1939,330000],[1942,550000],
[1945,780000]] — elle valait 450 k£ en 1944 alors qu'un chasseur CONFORME coûte 750 k£ (rival) à
1 057 k£ (p67) dans l'économie du jeu elle-même. Asymétrique par construction : les avions bon
marché sont déjà butés au `clamp` 1.0, donc ils ne gagnent RIEN ; seuls les chers y gagnent
(p67 +0.072, rival +0.092).
(C) PLAFOND DE PRIX CONDITIONNEL À LA CONFORMITÉ — `plafond = 1 + (clamp_prix − 1) ×
clampf(qualite, 0, 1)` dans `_attractivite`. Casser les prix ne paie à plein que si l'appareil
tient les attentes de l'époque. Ça règle l'objection qui avait tué la baisse de `clamp_prix` à la
passe n°9 (elle désarmait la guerre des prix des rivaux, qui sont CONFORMES donc gardent ×2.0) :
le plafond dépend de la conformité, pas du camp. p22 ×2.00 → ×1.774, p43 → ×1.847.
EFFET CALCULÉ À LA MAIN sur son save (le shell était indisponible pour la sonde) : part joueur
76,8 % → 71,2 %, p22 24,3 → 19,9 %, p67 1,8 → 3,0 %, rivaux 23,2 → 28,8 %. Correction de CAP,
pas révolution : q 0.774 achète encore ×1.77, donc si on veut casser la stratégie il faudra une
fonction plus mordante que le linéaire dans (C) — à MESURER, pas à supposer.
TESTS : `_test_clamp_prix` reformulé pour tester la PROPRIÉTÉ du plafond (×20 == ×200, et jamais
au-dessus du plafond absolu) et non sa VALEUR, qui dépend maintenant de la qualité — un test qui
écrit le réglage en dur est solidaire de l'équilibrage au lieu de la règle. Ajout de deux
vérifications : coût ×8 laisse la pénalité à 1.0, armement ÷8 la fait mordre. run.gd VERT.
HARNAIS : exit 0, toutes les cibles. Glouton crise 34 % INTACT, globales 32 %, victoires 80/0/20,
écart +10 %. Coût : équilibre 40.71 → 42.35 M£ (+4,0 %), pionnier 37.83 → 38.59, part rivale
62 → 59 %.
ISOLEMENT DE (C) — un run à `clamp_prix_conformite` 0 (le cadran, ajouté en data pour ne pas
laisser la forme `clampf(qualite,0,1)` en dur dans le code) donne A+B SEULS : équilibre 41.98,
pionnier 38.19, rivaux 58 %. Donc **(C) est quasi gratuit** (+0,9 %, dans le bruit) et rend même
1 point aux rivaux ; **ce sont (A) et (B) qui les affaiblissent** (62 → 58 %) et enrichissent les
bots de 3,1 %. MON HYPOTHÈSE ÉTAIT L'INVERSE et la mesure l'a corrigée. Explication, qui rectifie
le modèle : les rivaux ne sont PAS les chers du harnais — ils rabotent leur prix jusqu'à
`coût × 1.05` et strippent leur équipement (discipline de la passe (J)), donc **ce sont les BOTS
qui construisent cher**. (A) et (B) profitent par construction à qui construit cher : dans le
harnais les bots, sur le save du joueur son p67 moderne. Même règle, bénéficiaire opposé selon la
partie — cohérent avec la passe n°9 où baisser `clamp_prix` avait affaibli les rivaux pour la
même raison. COROLLAIRE : les +3,1 % sont le PRIX SÉMANTIQUE de cesser de punir l'avion cher ;
ce n'est pas un effet de bord à compenser, c'est la règle qu'on a voulue.
(A) et (B) n'ont pas été isolés l'un de l'autre (rendements décroissants : +3,1 % au total, toutes
cibles tenues, et les deux corrigent un défaut réel — un prix n'est pas une conception, et une
référence de coût à 450 k£ quand l'avion conforme en coûte 750 k£ est périmée).
TEST RÉPARÉ EN CHEMIN : `plafond conditionnel` calculait sa propre arithmétique (`1 + (plafond−1)
× 0.5`) au lieu de passer par `_attractivite` — il serait resté vert avec la conditionnalité
débranchée. Réécrit sur un `data` dupliqué, cadran 0 vs 1, sur un appareil médiocre buté :
0.249 → 0.141. Un test qui recalcule la formule au lieu d'appeler le code ne teste rien.

Retour playtest n°11 — LA PARTIE SANS EFFORT, le témoin qui manquait (« évalue cette partie où
je n'ai même pas fait d'effort pour gagner »). Verdict rendu par le jeu : « UN PILIER DE
L'AVIATION BRITANNIQUE », score 0.81, **25,7 M£** — soit DEUX FOIS la partie précédente jouée
sérieusement (12,26 M£). Le moindre effort payait mieux, et le grand livre dit pourquoi :
contrats d'État **189,5 M£** contre ~66 M£, parce que `alloc_marche` 0.95 au lieu de 1.0 a suffi
à éviter `Contrats._patience` → réputation militaire **0.976** (contre 0.37) et ministère 0.84.
La voie « gagner les concours et tenir le ministère » rapporte donc ~3× la domination
commerciale : c'est la voie VOULUE, mais elle n'était pas dosée.
DÉCOMPOSITION DU MARCHÉ (export 1945, sonde) : le joueur tenait **93,6 %** du segment avec des
appareils de 1933-1938 face à des chasseurs rivaux à 641 km/h.
  p28 1933 364 km/h 3 armes → q 0.95  f_prix 1.14  part 32,7 %
  p30 1934 319      2      → q 0.87  f_prix 1.38  part 40,5 %
  p43 1938 409      2      → q 0.85  f_prix 1.00  part 20,4 %
  b62 1944 641      5      → q 1.08  f_prix 0.43  part  3,2 % (×2)
POINT CLÉ : **aucun f_prix n'était buté** — ce n'était plus l'exploit du plafond. Trois mécanismes
composés : (1) avec 3 produits sur 5 le joueur FIXE LA MÉDIANE (446 k£ = son propre p43), donc les
rivaux à 905 k£ écopent d'un f_prix de 0.43 — inonder un segment de modèles bon marché n'avantage
pas le joueur, ça AFFAME ses concurrents ; (2) `f_repu` 1.286 contre ~1.06 (réputation 0.976) ;
(3) l'empilement (a² par produit, sommé par maison).
LA FAILLE, PRÉCISE : le p30 volait à 51 % de la vitesse attendue et portait 50 % de l'armement
exigé — et sa pénalité rédhibitoire valait **1.0**, aucune, parce que `critique_seuil` valait 0.50
et que son pire ratio était EXACTEMENT 0.50. Un appareil à la moitié du cahier des charges était
réputé acceptable. Troisième partie d'affilée où ce seuil ratait d'un cheveu l'avion qu'il devait
sanctionner.
CORRECTIF : `critique_seuil` 0.50 → **0.70**. PREMIER LEVIER DE LA SÉRIE QUI VA DANS LE BON SENS
SUR TOUS LES AXES (exit 0) : équilibre 42.35 → **39.28 M£** (−7,2 %), pionnier 38.59 → **35.32**
(−8,5 %), part rivale 59 → **62 %**, faillites globales 32 → **27 %**, glouton crise 34 → 36 %
(cible 20-50) et glouton TOTAL 59 → **46 %** — il va mieux, pas moins bien.
POURQUOI ÇA MARCHE LÀ OÙ LES CINQ AUTRES ONT ÉCHOUÉ : tous les leviers précédents (poids du coût,
`clamp_prix`, plafond par critère, `hors_penalite`, référence de coût) touchaient l'ATTRACTIVITÉ,
donc renchérissaient les avions — et à marque fixe un avion plus cher = une marge absolue plus
grosse, d'où +21 à +33 % de trésorerie bot à chaque fois. `critique_seuil` ne renchérit rien : il
DÉVALUE le périmé. C'est la première fois qu'on frappe l'obsolescence sans toucher au prix.
⚠ NE PAS CONFONDRE SEUIL ET PLANCHER (la doc s'en méfiait à tort) : la mesure mémorisée
« 0.5/0.6 → glouton 58 % ❌ » concernait le PLANCHER. Le SEUIL est un levier distinct et bien plus
sûr — la pénalité vaut `clamp(ratio/seuil, plancher, 1)`, donc le seuil décide QUI est puni et le
plancher COMBIEN. À seuil 0.70 le p30 du joueur (ratio 0.50) donne 0.714 et bute sur le plancher
0.72 : c'est le PLANCHER qui limite désormais, pas le seuil. Si 0.70 ne suffit pas au playtest,
c'est le plancher qu'il faut descendre — et LÀ le glouton est en jeu.
EFFET STATIQUE SUR SON SAVE : p30 q 0.87 → 0.63, p43 0.85 → 0.61, p28 0.95 → 0.80, rival b62
INCHANGÉ à 1.08 (tous ses ratios sont au-dessus de 1) → part joueur 93,6 % → ~87 %, rivaux
6,4 % → ~13 %. Correction réelle, pas révolution : le reste de la domination vient de la maîtrise
de la MÉDIANE et de la réputation, non traitées.
PUIS DEUX CORRECTIFS DEMANDÉS DANS LA FOULÉE.
(d) MÉDIANE PAR MAISON — `_allouer` calculait `prix_median` sur TOUS les produits du segment, donc
une maison qui en alignait 3 sur 5 la FIXAIT (elle valait exactement le prix du joueur) et
étranglait le `f_prix` de ses concurrents, tombé à 0.43 : inonder un segment de modèles bon marché
n'avantageait pas son auteur, ça AFFAMAIT les autres. Désormais une voix par maison — médiane de
SES prix, puis médiane des maisons (helper `_mediane`, deux appelants). HARNAIS NEUTRE au chiffre
près (39.27/35.38, crise 36 %, globales 27 %, rivaux 62 %, exit 0) : dans le harnais chaque maison
n'a qu'un ou deux produits par segment, donc la médiane par maison ≈ la médiane brute. Elle ne mord
que sur l'EMPILEMENT, qui est un comportement de joueur — même statut d'anti-exploit invérifiable
au harnais que le clamp de prix et la capacité rivale.
INTERACTION NON PRÉVUE, qui rend le correctif net-positif : relever la médiane avantagerait AUSSI
le joueur, sauf que le PLAFOND CONDITIONNEL (n°10-C) le bride — ses appareils à qualité 0.63-0.80
plafonnent à ×1.63-1.80 là où le rival conforme garde ×2.00. Statique sur son save, les deux
correctifs (`critique_seuil` 0.70 + médiane par maison) cumulés : médiane 446 k£ → 652 633 £,
f_prix rival 0.43 → 0.68, part joueur 93,6 % → ~85 %, rivaux 6,4 % → 15,2 %.
(e) SEUILS DU VERDICT — `legende` 0.82 → 0.88, `pilier` 0.58 → 0.72, `sous_traitant` 0.32 → 0.50,
et surtout `livraisons_cible` 450 → 1800 : à 450 le joueur livrait 1975 appareils (4,4× la cible),
donc ces 20 % du score étaient ACQUIS à quiconque survivait — ce n'était plus un objectif mais un
cadeau. Campagne de test de run.gd : « pilier 0.70 » → « sous_traitant 0.58 », les seuils
discriminent enfin.
(f) MODERNITÉ BRIDÉE PAR LA CAPACITÉ LA PLUS FAIBLE — les seuils seuls ne déclassaient PAS le
joueur (score 0.810 inchangé). Diagnostic : ce n'était pas le poids de la modernité (0.45) mais sa
FORMULE. `_modernite` faisait une moyenne pondérée de trois ratios (0.5 vmax + 0.3 armement +
0.2 plafond), et une moyenne compresse un écart catastrophique en un score honorable : son meilleur
chasseur d'export, un p28 de 1933 à 364 km/h face aux 700 du Fw 190 D (52 % de la vitesse, 75 % de
l'armement, 76 % du plafond), marquait 0.637. CORRECTIF, le même remède que `critique_seuil` au
marché : `× clampf(min(ratios), fin.modernite_plancher 0.35, 1.0)`. Son p28 : 0.637 × 0.52 →
modernité **0.331**, score total 0.810 → **0.673**, verdict « pilier » → **« UN HONNÊTE
SOUS-TRAITANT »**. Le reste du score (livraisons, réputations) est intact et mérité. Campagne de
test run.gd : 0.58 → 0.51, toujours sous_traitant. ZÉRO impact équilibrage — `end.gd` n'est pas
dans le chemin du harnais (qui teste faillites, trésorerie et parts, jamais un verdict), donc
aucun run nécessaire.
⚠ CE QUE LES SEUILS SEULS NE FAISAIENT PAS : le score du joueur restait 0.810, donc « pilier ».
Décomposition — modernité 0.45 × 0.636 = 0.286 · livraisons 0.20 × 1.0 = 0.200 · rép. militaire
0.20 × 0.976 = 0.195 · rép. civile 0.15 × 0.857 = 0.129. Son verdict est en grande partie MÉRITÉ
(1 975 appareils, réputation militaire 0.98). Ce qui ne le punit pas assez n'est pas le seuil mais
le POIDS de la modernité (0.45) : une flotte de 1934 à 0.636 ne coûte que 0.16 face à une flotte
neuve. Levier disponible si on veut qu'une gamme périmée soit disqualifiante :
`poids_verdict.modernite` 0.45 → 0.55-0.60 en reprenant sur livraisons et rép. civile (une ligne
de data, zéro impact équilibrage). NON FAIT — ça change ce que le jeu déclare récompenser, c'est
une décision propriétaire.
RESTE : 85 % de part avec des avions de 1933 reste LE symptôme ; la trésorerie n'en est que la
conséquence. Ce qui porte encore cette domination : la réputation (f_repu 1.286 contre 1.06) et
l'empilement (a² par produit, sommé par maison), ni l'un ni l'autre traités.

Passe OUTILLAGE + EMPILEMENT (audit externe du harnais, session suivante).
AUDIT REÇU, TRIÉ CONTRE LE CODE avant d'agir — 2 points sur 3 retenus.
(1) REJETÉ : « tu n'as pas 3 stratégies, tu en as 1 ; le glouton à 1 % de victoires est une
stratégie morte ». Prémisse FAUSSE : `grep -rn "glouton_civil|pionnier_militaire|strategies"
game/` ne retourne RIEN — ce ne sont pas des archétypes jouables mais des fixtures de
`tests/bots.gd`. Le glouton est le bot imprudent que la crise DOIT tuer à 20-50 % : ses
faillites SONT la cible §15.2, pas un défaut. Le verdict proposé (échec si une strat gagne
< 10 %) aurait exigé de rendre le bot suicidaire compétitif, donc de casser la crise.
(2) SUR-LECTURE : la « falaise déterministe de 1924 » (min = médiane = max chez l'équilibré).
C'est un échantillon de DEUX faillites sur 100. Distribution réelle mesurée sur 300 campagnes :
9 morts avant 1926, soit 3 % — un mode de mort qui existe, pas une falaise. MAIS l'intuition
sous-jacente est juste : ces 3 % n'étaient assertés NULLE PART et se confondaient avec les
morts de crise dans « faillites globales ».
(3) EXACT : le verdict « aucune domination » passe par un OU (`victoires <= 0.60 or ecart <=
ECART_DOMINATION`), donc 76 % de victoires passe grâce à un écart de richesse de +11 %.
L'exemption avait été ajoutée pour un photo-finish à 0,2 % d'écart ; à +11 % elle est trop
large. NON CORRIGÉ — le resserrer met la cible au rouge et ouvre une chasse à l'équilibrage,
c'est une décision propriétaire.
LIVRÉ côté OUTILLAGE (aucun impact jeu, assumé comme tel) : `n_graines` réglable par argument
(`-s res://tests/balance.gd -- 20`, ~2 min au lieu de 10 — une boucle de 10 min rend
l'équilibrage impraticable) ; verdict « mortalité de démarrage » séparé (`ANNEE_DEMARRAGE`
1926, `SEUIL_PRECOCE` 0.10) — mesuré à 3 %, seuil posé en GARDE-FOU anti-régression et non en
cible : on ajoute la mesure avant d'en faire une contrainte.
PUIS L'EMPILEMENT, la dernière cause identifiée et jamais traitée. Sonde de contrefactuels sur
le save : retirer le cumul faisait passer le joueur de 63,9 % à 51,1 % de l'export avec
seulement DEUX produits (13 points). La réputation, elle, jouait CONTRE lui dans cette partie
(militaire 0.118, la pire des trois maisons) — la neutraliser le RENFORÇAIT de 5 points : ce
n'est pas un levier à raboter, c'est un système qui fonctionne.
CORRECTIF : `empilement_maison` en data (1.0 = comportement historique, vérifié bit-identique)
— le n-ième modèle d'une maison sur un segment voit son poids multiplié par `empilement^(n-1)`.
Le POIDS (a² amorti) est stocké une fois et réutilisé pour la somme ET pour la part de chaque
produit — sinon les parts ne somment plus à 1.
DOSAGE MESURÉ (30 graines, boucle courte), et LA MINE DOCUMENTÉE EST RÉELLE :
  1.0 (témoin) équilibre 39.38 · glouton crise 30 % / total 40 % · rivaux 61 %
  0.85          équilibre 37.81 · glouton crise 40 % / total 50 % · rivaux 62 %  ✅
  0.7           équilibre 33.43 · glouton crise 47 % / total 83 % · globales 38,7 % ❌
À 0.7 le glouton s'effondre exactement comme l'étape 11 l'avait vu : sans empilement il n'a pas
la caisse pour renouveler. RETENU 0.85. VALIDATION 100 graines, exit 0 : équilibre 39.28 →
**37.00 M£** (−5,8 %), pionnier 35.32 → **33.63** (−4,8 %), part rivale 62 → **63 %**, glouton
crise 39 %, globales 28 %, victoires 76/0/24, écart +10 %.
LEÇON DE MÉTHODE : un audit externe se trie CONTRE LE CODE, pas contre l'intuition. Deux de ses
trois constats reposaient sur une lecture du harnais sans ouvrir `game/` ni compter les
échantillons — mais le troisième était exact et personne dans le projet ne l'avait vu.

Retour playtest n°12 — HORIZON DE RECHERCHE (« en début de jeu, acheter des techs de 1935
était possible pour pas cher »). CONSTAT VÉRIFIÉ : `research.gd` traitait le pari pionnier comme
un BOOLÉEN (`annee < date_etat_art` → `cout *= 4`). Être en avance d'UN an coûtait donc le même
multiplicateur qu'en avance de TREIZE. Avec 420 k£ de départ on achète en 1922 : roues carénées
(1929) 100 k, démarreur (1930) 120 k, cockpit fermé (1931) 120 k — trois technos des années 30
dès les premières semaines.
HYPOTHÈSE DU JOUEUR (« les rendre proportionnellement chers réduirait la trésorerie ») : MESURÉE
FAUSSE. Surcoût linéaire `mult = 4 + par_an × avance`, dosé à 0 / 0.3 / 0.6 :
  équilibre 37.81 M£ aux TROIS dosages, à la décimale — le bot riche ne fait AUCUN pari pionnier.
  pionnier 27 % → 57 % → 83 % de faillites ; cible « globales » ratée dès 0.3.
Avec une franchise de 3 ans (le pari d'un ou deux ans reste à ×4), 0.5 passe les cibles mais le
bot chercheur tombe encore à 43 % de faillites et 20 → 7 % de victoires : on transforme une
stratégie en piège, exactement le reproche de l'audit sur le glouton. REVERTÉ, dials supprimés.
CORRECTIF RETENU — une BORNE, pas un prix : `pionnier_horizon_ans` 8 (0 = pas d'horizon).
`Recherche.lancer` refuse une techno dont `date_etat_art` dépasse l'année courante de plus de
8 ans. On ne conçoit pas en 1922 ce que l'industrie ne saura faire qu'en 1935 ; le rivetage
affleurant (1935) et les armes d'ailes deviennent inaccessibles au départ, le capot NACA (1929)
reste ouvert. NEUTRE AU HARNAIS aux deux dosages testés (8 et 5 ans) : chiffres IDENTIQUES au
témoin (37.00 / 33.63 / 76-0-24 / rivaux 63 %, exit 0) — les bots ne cherchent jamais à plus de
5 ans d'avance, donc l'horizon ne mord QUE sur le joueur. Même profil anti-exploit que
`clamp_prix` et la médiane par maison.
LEÇON : quand un exploit vient d'une VARIABLE non bornée (ici l'avance), la borne est souvent
meilleure que le prix. Renchérir frappe proportionnellement TOUS les usages, y compris
légitimes ; borner ne frappe que l'abus. Troisième fois de la session que la borne bat le prix
(cf. `clamp_prix`, plafond par critère).
TEST `_test_horizon_recherche` (trésorerie mise à 9e9 pour que l'argent ne soit JAMAIS ce qui
bloque : sinon le test passerait au vert pour la mauvaise raison). PIÈGE RÉSOLU EN CHEMIN :
`_test_brevets` recherchait `cockpit_ferme` (1931) depuis 1922 — désormais hors horizon. L'horloge
y est avancée de 4 ans AVANT la pose du brevet ; l'avancer après le faisait expirer (il est posé
à `tick + 208`, et 4 ans = 208 semaines).

Retour playtest n°13 — AUDIT COMPLET D'UNE PARTIE (15,46 M£, verdict « pilier » 0.855,
14 concours gagnés sur 18, réputation militaire 1.000, `alloc_marche` 0.00).
⚠ ERREUR DE MÉTHODE À NE PAS REFAIRE : j'ai d'abord conclu « le marché fonctionne enfin » sur
la photo du DERNIER trimestre (joueur 46,2 %, rivaux 53,8 %). Le joueur a corrigé — « je venais
de sortir un chasseur et de virer tous les autres » — et l'HISTORIQUE lui donne raison : part
joueur tous segments 33 % (1922) → 68 % (1932) → 71 % (1937) → **81 % (1940)** → 66 % (1941).
Les 46 % étaient un creux de renouvellement. **Un cliff instantané ne mesure pas une domination :
lire `marche[seg]["historique"]`, jamais `parts`.**
CAUSE MESURÉE — SPIRALE DE CAPACITÉ : joueur 64/trim (4e palier), rival fusionné figé à
**13/trim**, alors que `fusion.capacite_max` valait 48. Le plafond n'a jamais servi : dans
`_rivaux_reagir`, un rival ne gagne de la capacité que si SON PROPRE carnet dépasse
`exp_carnet_mult` × sa capacité. Le joueur prend le marché → leur carnet reste vide → ils ne
grandissent pas → il prend encore plus. EXACTEMENT le défaut de leur R&D corrigé à l'étape (F),
jamais répercuté sur les chaînes.
CORRECTIF — SECOND SOURCE : `mobilisation_capacite` (rivals.json, 0 = inactif) ; un rival
rattrape jusqu'à `mob` × la capacité du PREMIER producteur, indépendamment de son carnet. Un
ministère de l'Air ne laisse pas un fournisseur unique tenir l'industrie (shadow factories
1936-1940). PREMIÈRE FORMULATION JETÉE : « grandir quand la demande dépasse la capacité de
l'industrie » — ne déclenche JAMAIS, la demande totale (150/an en 1940) est bien SOUS la
capacité (308/an). Le problème n'est pas que l'industrie ne sait pas produire, c'est qu'UNE
maison détient tout l'outil : c'est la CONCENTRATION qu'il faut mesurer, pas la pénurie.
DOSAGE (30 graines) : 0.0 équilibre 37.81 / rivaux 62 % · **0.5 → 36.05 / 64 %** · 0.75 → 35.42 /
67 % mais glouton total 77 % et globales 34 % (plafond 35, trop près du bord). RETENU 0.5.
VALIDATION 100 graines, exit 0 : équilibre 36.48 M£, pionnier 33.39, rivaux 64 %, glouton crise
39 %, globales 30 %, victoires 75/0/25, écart +9 %. Effet harnais MODESTE et c'est attendu — les
bots ne dépassent pas le palier 3 (32/trim), donc le rattrapage vise 16, niveau qu'ils
atteignaient déjà par leur carnet. **La mécanique ne mord que face à un 4e palier**, situation
du joueur : son rival passe de 13 à ~32/trim.
ALERTE DE SÉRIE DÉFICITAIRE (`main.gd _alerter_series_deficitaires`, appelée au trimestre) :
l'avertissement « ⚠ À PERTE » de l'écran Concours ne se voit qu'AU MOMENT DE CANDIDATER, or une
série de 120 appareils se livre sur deux ans — le joueur ne découvrait la saignée qu'au bilan
annuel. Désormais un toast par trimestre : « ⚠ F.6/43 livré à perte : 209 000 £ par appareil,
47 restants (soit 9 823 000 £ à venir) ». Lecture seule, zéro clé de state, zéro impact sim.
`-marge` et non `marge` : « à perte : -209 000 £ » serait un double négatif.
CONTRATS D'ÉTAT SOUS-PAYÉS — CONSTATÉ, NON CORRIGÉ (décision propriétaire : « j'ai déjà trop
d'argent »). `1940_bataille` paie 300 k£ quand un chasseur conforme de 1940 en coûte 440 k
(−21,0 M£ d'exposition sur 150 appareils) ; `1943_altitude` paie 450 k pour un cahier à 640 km/h
qui, MESURÉ par sonde (chasseur sobre, Sabre II) coûte **934 352 £** — exposition −21,2 M£.
Cumul −45,7 M£, ce qui explique les −40,3 M£ de 1944 (dont 23,0 M£ d'impôt). ORIGINE : la
référence de coût du marché a été réactualisée à la passe n°10 (450 k → 780 k en 1945) SANS
toucher à `contracts.json` — avant, `1943_altitude` payait 106 % du coût conforme, il en paie
72 %. RÉGRESSION ASSUMÉE : ces concours de guerre sont désormais des PIÈGES, rendus LISIBLES par
l'alerte trimestrielle. Ne pas candidater est le bon jeu — c'est ce que fait `bots.gd`.
TROIS ISSUES EXAMINÉES ET ÉCARTÉES : relever `prix_unitaire` (enrichit le joueur) ; baisser les
exigences (un chasseur de haute altitude de 1943 à 470 km/h casse la vraisemblance) ; coût majoré
à `max(prix, coût × 1.05)` (historiquement juste mais ajoute de l'argent). Proposition joueur
« ajouter un moteur qui fasse le taf » : ÉCARTÉE sur mesure — le catalogue moteur est cohérent à
242-272 £/cv sur toute la période, un moteur remplissant le cahier dans son budget devrait coûter
deux fois moins cher au cheval que tous les autres (outlier qui déséquilibrerait tout le jeu), et
en 1943 la cellule et l'équipement pèsent autant que le moteur.

Retour playtest n°14 — LE DÉPARTEMENT MOTEURS ÉTAIT MEILLEUR MOTORISTE QUE ROLLS-ROYCE.
DÉCLENCHEUR : remarque du joueur « je n'ai utilisé le Sabre qu'une seule fois », alors que je
venais d'accuser les moteurs-pièges (`bots_ignorent`) de porter sa domination de 1941-1943.
VÉRIFICATION sur ses designs : de 1936 à 1940 il vole sur `mm33`/`mm39`/`mm42` — SES PROPRES
moteurs. Le catalogue n'y était pour rien. Sans sa remarque, je corrigeais le mauvais système.
CAUSE : `kg_par_litre` était une CONSTANTE (13.5) alors que `cv_par_litre` monte de 13 à 38 avec
l'époque. La masse au cheval d'un moteur maison décroissait donc mécaniquement — 1.038 kg/cv en
1922, 0.436 en 1940, 0.355 en 1945 — pendant que le catalogue stagne entre 0.442 et 0.602. **À
partir de 1939 le moteur maison était le plus léger du jeu**, et un moteur léger c'est de la
vitesse et du plafond gratuits. MESURE À PUISSANCE ÉGALE, même cellule (sonde) :
  1936  catalogue 0.547 kg/cv · maison 0.563 — avion : égalité (les garde-fous marchent)
  1940  catalogue 0.602 · maison 0.436 — avion : +305 m de plafond, +5 pts de fiab, −28 k£
  1943  catalogue 0.491 · maison 0.383 — avion : −6 pts de fiab (la démesure mord bien)
L'équilibrage de l'étape 13 avait vérifié la PUISSANCE et le COÛT du département (deux
correctifs : démesure au-delà de `cyl_saine`, `cout_par_cv`). Jamais la MASSE. La fenêtre
1938-1942 était donc ouverte, et c'est elle qui porte les 69-83 % de part du joueur.
CORRECTIF : `kg_par_litre` devient une COURBE comme `cv_par_litre` — un moteur plus gavé exige
une construction plus robuste. [[1922,13.5],[1936,14.0],[1940,16.4],[1945,18.0]], calée pour que
le maison reste toujours légèrement PLUS LOURD que le meilleur du catalogue de son époque
(kg/cv maison : 1.038 → 0.583 → 0.529 → 0.474). `_interp` aussi dans `reevaluer_prix`, qui
reconstruit la cylindrée depuis la masse à l'année du moteur. RÉSULTAT MESURÉ : 1936 maison
0.584 contre 0.547 (plus lourd) ; 1940 +129 m et +3 pts au lieu de +305 m et +5 pts ; 1943
égalité de masse et −10 pts de fiabilité. Il reste au département un avantage de PRIX (−20 k£)
et un peu de fiabilité — exactement ce que l'étape 13 disait vouloir : « le département achète
du prix et du sur-mesure, pas de la supériorité ».
PUIS LA FIABILITÉ, second volet du même déséquilibre (mesuré après la masse). `fiab_base` 0.80
+ `fiab_par_soin` 0.12 donnait un plafond de 0.92 quand le catalogue culmine à 0.84. Sonde
« fiabilité atteignable vs meilleur du catalogue de l'époque » (le `<<` marque un dépassement) :
  1930  catalogue 0.80 · maison 0.92 à soin 1.0 ET **0.86 à soin 0.5** — il dépassait même en bâclant
  1936  catalogue 0.80 · maison 0.90 / 0.84
  1940  catalogue 0.80 · maison 0.85 / 0.79
  1943  catalogue 0.84 · maison 0.83 — seule époque où il ne dépassait pas
De 1930 à 1940, +5 à +12 points sur le meilleur moteur du commerce. Les `mm33` et `mm39` du
joueur étaient tous deux à 0.88.
CORRECTIF : `fiab_base` 0.80 → **0.72**. DOSAGE COMPARÉ : à 0.68 le département n'est plus
supérieur à RIEN (0.80 en 1930 puis toujours en dessous) — combiné à la correction de masse il
devient inférieur sur tous les axes sauf le prix, et payer 900 k£ + un banc n'a plus de sens :
du contenu mort. À 0.72 l'arc est juste — 0.84 contre 0.80 en 1930 (le commerce est médiocre),
0.82 en 1936, 0.77 en 1940, 0.75 en 1943 : **l'industrie te rattrape puis te dépasse**, ce qui
crée une vraie décision de milieu de partie (continuer ses moteurs ou repasser au catalogue).
NEUTRE AU HARNAIS PAR CONSTRUCTION : `Moteurs.specs` n'est appelé que pour un moteur maison, et
les bots n'en fondent jamais (exit 0, chiffres dans le bruit).
LEÇON : un sous-système optionnel se vérifie sur TOUS les axes qu'il produit. L'étape 13 avait
contrôlé puissance et coût, laissant masse ET fiabilité non bornées — deux avantages gratuits
qui ont porté la domination du joueur pendant douze ans sans qu'aucun test ne s'en aperçoive.
CONTENU : Bristol Centaurus 1943 (2000 cv, 1150 kg, fiab 0.80, 252 £/cv). Le drapeau
`bots_ignorent` laissait les rivaux à 1615 cv en 1943, seule année où le Sabre II n'a pas de
concurrent autorisé — écart mesuré +69 km/h (et +84 en 1941 face au Vulture). Avec le
Centaurus les rivaux passent de 642 à 690 km/h, l'écart tombe à +21 km/h comme en 1944, et le
piège redevient un vrai arbitrage (180 cv de plus contre 9 points de fiabilité).
⚠ TROIS BUGS LATENTS DU HARNAIS exposés par ce seul ajout de contenu, tous verts depuis des
mois pour de mauvaises raisons :
(1) `_test_raids` indexait `palmares[size-1]` sans vérifier qu'une tentative avait eu lieu —
index −1 dès que l'état du monde change. Désormais un échec explicite si l'épreuve n'est pas
tentée. (2) TROIS fixtures montaient `Etat.cles_triees(data["engines"])[0]`, soit « le premier
moteur par ORDRE ALPHABÉTIQUE » : `centaurus` passant en tête, elles collaient un 2000 cv de
1943 sur un biplan en bois de 1925. Remplacé par `"rr_eagle"` explicite dans run.gd, ui.gd et
capture.gd. RÈGLE : **une fixture ne désigne JAMAIS une donnée par sa position dans une liste
triée** — l'ordre alphabétique n'a aucun rapport avec le sens, il change à chaque ajout de
contenu, et le test se met à mesurer autre chose sans jamais devenir rouge.
BUG D'UI CORRIGÉ (signalé par le joueur, capture à l'appui) : l'alerte de série déficitaire
ajoutée au playtest n°13 comparait `solde_unitaire` (60-70 % du prix, l'acompte étant déjà
encaissé) au coût des 100 % — elle criait « à perte » sur une série à +33 835 £/appareil.
C'est EXACTEMENT le faux avertissement déjà corrigé au playtest n°7 (point (4)), réintroduit
par moi dans une autre fonction sans relire ma propre documentation. Le contrat mémorise
désormais `prix_unitaire` à la signature (`part_acompte_de` ne pouvait pas servir : il
recalculerait la jauge ministère d'aujourd'hui, pas celle du jour de la signature).

Retour playtest n°3 (pivot de direction artistique, demande propriétaire : « ça fait vieux ») :
abandon de la police pixel au profit de la fonte lisse par défaut du moteur (antialiasée,
re-rendue net par le stretch canvas_items), habillage « rétro moderne » : canevas charbon
(ENCRE) fourni par main, contenu sur cartes arrondies ombrées (`game/ui/cartes.gd`, LA
fabrique partagée), boutons pastilles plats (actif = laiton), onglets fantômes dans la barre,
champs clairs arrondis, curseurs laiton, tailles de texte passées de 8 à 9. Les écrans ne
peignent plus de fond propre. PixelOperator8.ttf reste dans art/ mais n'est plus chargé. Viewport de design passé
de 640×360 à 768×432 (la grille pixel n'impose plus rien) pour que les colonnes denses
(Bureau) tiennent sans défiler ; défilement vertical ajouté en filet sur les colonnes
Bureau et Concours ; la piste d'un HSlider stylé n'a d'épaisseur QUE par les content
margins de sa stylebox « slider » (sinon invisible).

Retours playtest n°2 : fenêtre rognée aux tailles non multiples de 640×360 (l'upscale
« integer » arrondit AU-DESSUS et rogne) → stretch passé en « fractional » (net aux tailles
entières, dégradé gracieux entre-deux) ; bouton « Nouvelle partie » dans le panneau ⚙
(armé en deux clics) ; attentes du marché (« Jugé sur : … ») affichées par segment sur
l'écran Marché, avec autowrap (sinon la ligne pousse la colonne droite hors écran).
Retour du premier playtest (« injouable : on ne sait pas produire/vendre, pas de revenu ») →
trois boucles de feedback ajoutées : NOTE MARCHÉ live sur l'écran Bureau (critères pondérés
du segment + note via `Marche.qualite_segment`, publique — le joueur sait si l'avion se
vendra AVANT de payer le prototype) ; bilan du trimestre dans la barre (« Trim. : N livrés ·
X F », rouge si zéro — l'allocation trimestrielle était invisible) ; mode d'emploi à la
première partie via la une de journal (boucle de jeu, seuil de faillite, conseil ×4).

Reports connus (assumés) : pas de phase d'essais en vol au lancement produit (voir `ponytail:`
dans sim.gd) ; Marane domine les concours ENTRE IA (les candidats bots ne taillent pas leurs
designs sur le cahier — le sur-mesure est l'arme du joueur, cf. test BN3 0.98 vs 0.58) ;
les bots ne courent ni ne raident (forfait → rivaux, gain réduit `repu_forfait_mult`) ;
« relation ministère » réduite à un malus de rep militaire ; une de presse à 1 colonne
(ABANDONNÉ : les corps font 1-2 phrases par design, 2 colonnes seraient vides) ;
le diorama reste en pastilles (le pixel art d'ambiance fin serait un chantier d'assets,
pas de code) ; le CA rival d'une
victoire d'AO est crédité d'un bloc sans consommer leur capacité (`ponytail:` dans contracts.gd) ;
les événements (étape 7) brancheront doctrine 1934 et relation ministère sur les AO ;
police pixel + layout fin de l'écran blueprint (liste équipements en scroll 1 ligne) = étape 9.
Pièges Godot appris : la min-width d'un container REMONTE jusqu'au parent ancré — un label
à texte variable dans la barre du haut élargissait la colonne racine et donc TOUS les écrans
frères dès la première vente (remède : texte variable sur sa propre ligne + ellipse, et repli
par défaut dans chaque `_etiquette`, cf. marche.gd) ; un contrôle ancré `PRESET_CENTER`
grandit vers la droite/le bas par défaut → `grow_horizontal/vertical = GROW_DIRECTION_BOTH`
pour une carte centrée ; une nouvelle ressource (police .ttf) exige une passe
`--headless --import` avant tout run `-s` (sinon `load()` échoue et l'écran avorte en
silence) ; les `_ready()` qui posent `theme = th` écrasent un theme assigné avant
`add_child` — la police d'un thème doit venir d'un PARENT (résolution montante) ;
une police pixel a une chasse plus large : re-vérifier tous les débordements par capture ;
`trait` est un mot RÉSERVÉ en GDScript 4.7 (nom de variable interdit) ;
une classe interne ne voit pas les constantes du script englobant (re-preload dedans) ;
un SpinBox avec `min_value=1` et `step=1000` snappe toute valeur à
1 + k×1000 (mettre min 0 et laisser la sim borner) ; un helper nommé comme une fonction native (`maxi`) = erreur de parse ;
pendant `_initialize` d'un SceneTree `-s`, `add_child` ne déclenche pas `_ready` (attendre une
frame) ; une erreur runtime dans `_initialize` avorte avant `quit()` → process bloqué et sortie
perdue dans le buffer → toujours poser un chien de garde `create_timer` AVANT les tests UI ;
un `SceneTreeTimer` (`get_tree().create_timer(...)`) appartient à l'ARBRE, pas au nœud : si sa
lambda capture un nœud libéré entre-temps (carte de toast élaguée > 3, bouton armé dont l'écran
se rafraîchit), il rejoue quand même et le moteur crache « Lambda capture at index 0 was freed.
Passed null instead » EN BOUCLE (un `is_instance_valid` garde du crash mais PAS du log) — remède :
un `Timer` NŒUD ENFANT du nœud géré (`carte.add_child(minuteur)`), il meurt avec lui et ne rejoue
jamais (cf. `main.gd _toast`, `cartes.gd armer`).
Équilibrage (recalé étape 7 : 54/41/5, glouton 32 %, global 17 %, rivaux 68 %) : les événements
à multiplicateurs de demande doivent rester quasi symboliques (les courbes data portent DÉJÀ
boom et réarmement — Lindbergh à ×1.4 avait effondré les faillites du glouton) ; le pionnier
meurt enfin un peu (1 %, 1937.9). Leviers sensibles : `tresorerie_depart` (±5 k = ±5 pts),
`frais_fixes_sem` (2 800 : +150 ≈ +5-8 pts de faillites globales), pricing des bots
(FALAISE : équilibré viable à 1.24, 41 % de morts précoces à 1.22), pondération réputation
des AO, `repu_victoire_rival`/`repu_forfait_mult` (sans eux, boule de neige : Marane gagnait
7 AO sur 7 et les rivaux engraissaient aux courses par forfait — payé par le pionnier).
Le glouton ne gagne jamais au critère trésorerie (cohérent avec le profil).
