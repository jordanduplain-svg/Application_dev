# Contribuer

Merci de votre intérêt pour ce projet. Avant tout : ce projet manipule (en cible) des
**données de santé** au sens RGPD. La rigueur attendue n'est donc pas la même que pour un
projet hobby.

## Avant de commencer

1. Lisez [`README.md`](README.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), et les
   ADR sous [`docs/adr/`](docs/adr/). C'est la feuille de route technique du projet.
2. Lisez [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
3. Pour signaler une vulnérabilité, voir [`SECURITY.md`](SECURITY.md). **Ne pas ouvrir
   d'issue publique.**

## Démarrage local

Pré-requis :

- Node.js ≥ 20.11
- pnpm ≥ 9
- Docker (pour Postgres + Adminer en dev)

```bash
git clone <url>
cd Suivi_risque_chimique
cp .env.example .env
# Adapter .env (JWT_SECRET et FIELD_ENCRYPTION_KEY OBLIGATOIRES)
docker compose up -d
pnpm install
pnpm test
```

## Règles dures (non négociables)

- **Aucune donnée réelle dans le dépôt.** Un hook pre-commit refuse les `.xlsx`, `.csv`,
  `.pdf` hors fixtures synthétiques explicites. Si vous trouvez le hook gênant, ne le
  bypassez pas — déplacez votre fichier dans `fixtures/synth/` ou
  `apps/backend/test/fixtures/` après avoir vérifié qu'il ne contient rien de réel.
- **Aucun secret dans le dépôt.** Variables d'environnement uniquement. Un secret
  accidentellement commit doit être révoqué immédiatement (pas suffisant de le retirer du
  HEAD).
- **Respect de la règle de dépendance de l'architecture hexagonale.** Un fichier de
  `domain/` ne peut PAS importer `infrastructure/` ou `interface/`. Le lint refuse, la PR
  ne passe pas.
- **Tests unitaires sur la logique métier.** Le calcul de durée, le mapping, les règles
  d'autorisation et l'anonymisation doivent avoir une couverture haute. Les bugs sur ces
  modules ont un impact réglementaire.
- **Pas de PII dans les logs, les URLs, les messages d'erreur.** Identifiants techniques
  seulement.
- **Reste focalisé sur le périmètre CMR.** Audits, qualité, environnement, EPI, etc. sont
  hors scope volontaire (cf. section 1 du brief). Une PR qui ajoute un module hors scope
  sera fermée.

## Conventions de code

- TypeScript strict partout. Pas de `any` sans commentaire justifiant.
- ESLint + Prettier appliqués (`pnpm lint`, `pnpm format`).
- Tests Vitest co-localisés (`*.test.ts` à côté du fichier testé) pour le domaine ; tests
  d'intégration sous `test/` pour l'infra.
- Commentaires : expliquent **pourquoi** le code fait ce qu'il fait, pas ce qu'il dit.
- Commits : message court à l'impératif, en français ou en anglais (les deux sont OK).
- Branches : `feat/<sujet>`, `fix/<sujet>`, `docs/<sujet>`, `refactor/<sujet>`.

## Process de PR

1. Ouvrez une issue d'abord pour les changements non triviaux — éviter qu'on travaille à
   contre-courant.
2. Petit, focalisé, testé. Une PR = un changement cohérent.
3. La PR doit :
   - passer le lint, le typecheck et les tests ;
   - mettre à jour la doc si elle touche à l'architecture ou à une décision structurante
     (créer un ADR si la décision est importante) ;
   - ne pas baisser la couverture des modules métier.
4. La revue se fait sur GitHub. Soyez patient — projet maintenu sur du temps personnel.

## Ajouter une décision d'architecture

Si votre changement modifie un choix structurant (stack, sécurité, modèle de données),
créez un ADR :

1. Copier le format d'un ADR existant (`docs/adr/0001-stack-and-tooling.md`).
2. Numéroter à la suite.
3. Statut initial : `Proposé`. L'ADR devient `Accepté` une fois la PR mergée.

## Questions

- Bug / feature : ouvrez une issue.
- Sécurité : voir `SECURITY.md`, surtout pas d'issue publique.
- Conformité juridique : posez la question en discussion, mais **ce projet ne donne pas de
  conseil juridique** — faites valider par un préventeur et un juriste.
