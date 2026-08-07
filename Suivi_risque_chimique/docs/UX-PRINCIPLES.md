# Principes UX — contrat d'interface

> Exigence posée par le propriétaire du projet avant le premier écran : l'interface doit
> être **vraiment intuitive**. Pas "jolie", pas "moderne" — intuitive. Ce document est le
> contrat que chaque écran doit respecter. Toute PR d'UI se relit avec cette grille.

## Qui sont les utilisateurs (et ce que ça impose)

Les utilisateurs ne sont **pas des informaticiens**. Ce sont :

- un **responsable HSE** qui jonglait jusqu'ici avec des Excel — il connaît son métier
  (produits, secteurs, CMR), pas les apps web ;
- une **RH** qui veut vérifier des affectations ;
- un **médecin du travail** qui veut la fiche d'une personne, vite ;
- un **manager d'atelier** qui consulte ponctuellement, parfois sur tablette ;
- un **opérateur** qui se connecte une fois par an pour voir sa propre fiche.

Conséquence : l'app doit être utilisable **sans formation, sans manuel, sans tutoriel**.
Si un écran a besoin d'être expliqué, l'écran est raté.

## Les 10 règles

1. **Une tâche par écran.** Chaque écran répond à UNE question de l'utilisateur
   ("qui est exposé à quoi ?", "que voit cette personne ?", "mon import est-il passé ?").
   Pas d'écrans fourre-tout à onglets multiples.

2. **Le vocabulaire du métier, jamais le nôtre.** On écrit "produit", "secteur",
   "degré d'exposition", "fiche de Mme X" — jamais "entité", "record", "item", "sync",
   "upsert", "mapping" (dans l'UI de config, "correspondance des colonnes"). Les codes
   d'erreur techniques n'apparaissent jamais à l'écran.

3. **3 clics maximum vers n'importe quelle information.** Depuis l'accueil :
   dashboard → ligne → fiche individuelle. Recherche globale accessible partout
   (une seule barre, comprend noms, secteurs, produits).

4. **L'état du système est toujours visible et en français.** Dernier import : quand,
   depuis quelle source, combien de lignes, combien d'anomalies. Jamais de spinner muet :
   on dit ce qu'on fait ("Import du fichier RH en cours… 1 200 lignes lues").

5. **Les erreurs disent quoi faire, pas ce qui a planté.** Mauvais exemple : "Erreur 422 :
   validation failed". Bon exemple : "3 lignes du fichier ont une date de fin antérieure à
   la date de début — voir la liste, corriger le fichier source, puis relancer l'import."
   Chaque message d'erreur contient l'action suivante.

6. **Les valeurs par défaut font le bon choix.** Le dashboard s'ouvre filtré sur ce qui
   compte (expositions en cours, pas l'historique). Les exports proposent le bon format
   selon le destinataire choisi. L'utilisateur ne configure que s'il veut dévier.

7. **Zéro état vide muet.** Premier lancement : pas un tableau vide, mais "Aucune donnée
   pour l'instant — importez votre premier fichier" avec le bouton qui va bien. Recherche
   sans résultat : suggestion ("vérifiez l'orthographe, ou cherchez par secteur").

8. **Ce qui est dangereux se voit, ce qui est anodin s'efface.** Hiérarchie visuelle
   pilotée par le risque : un CMR 1A avec exposition forte se repère en un coup d'œil
   (sans dépendre de la couleur seule — accessibilité). Les colonnes secondaires sont
   visuellement en retrait.

9. **Chaque rôle voit une interface à SA mesure.** L'opérateur qui consulte sa fiche voit
   une page simple et lisible — pas le dashboard HSE avec 13 colonnes. Le menu ne montre
   jamais une entrée à laquelle le rôle n'a pas droit (le backend filtre déjà ; l'UI ne
   doit même pas faire envie).

10. **Imprimable et exportable sans surprise.** Ce qu'on voit à l'écran est ce qui sort
    en PDF/Excel. Pas de colonnes qui disparaissent ou apparaissent à l'export.

## Parcours critiques à soigner en priorité

Ces trois parcours seront testés "sans les mains" (un utilisateur qui découvre doit y
arriver seul) :

1. **HSE, premier jour** : se connecter → importer un Excel → associer les colonnes →
   voir le dashboard rempli. C'est LE parcours d'adoption ; s'il accroche, le produit est
   mort. La correspondance des colonnes doit proposer des suggestions automatiques
   (détection des noms proches) que l'utilisateur valide, plutôt qu'un formulaire vide.

2. **Médecin du travail** : chercher une personne → ouvrir sa fiche → exporter le
   nominatif. Moins de 30 secondes.

3. **Opérateur** : se connecter → comprendre sa propre fiche sans aide. La fiche
   individuelle s'écrit en langage humain ("Vous avez été exposé au Toluène entre 2021 et
   2024, degré modéré"), pas en tableau brut.

## Process de design (rappel du brief, section 14)

1. Construire la première version de l'écran.
2. Passe **Impeccable** (layout, typographie).
3. Passe **Emil Kowalski** (interactions, ressenti).
4. **Taste Skill** si l'ensemble reste générique.

Les trois skills s'installent **au niveau du projet** au moment où on attaque l'UI
(étape 6 du MVP) — pas avant, pas globalement.

## Anti-objectifs

- Pas de dashboard "tableau de bord BI" avec 15 widgets — c'est un outil de traçabilité,
  pas un jouet pour la direction.
- Pas d'animations décoratives. Le mouvement n'existe que pour expliquer (transition qui
  montre d'où vient un panneau).
- Pas de dark patterns, pas de gamification, pas de notifications non sollicitées.
- Pas de densité à la Excel par défaut : la densité est un choix de l'utilisateur
  (toggle confort/compact), pas une fatalité.
