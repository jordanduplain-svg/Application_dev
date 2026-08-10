# CLAUDE.md — Freelance-ops

## Pont vers Wiki-Brain

Ce projet est tracé dans le wiki personnel sous `[[Freelance-ops]]`
(vault : `C:/Users/jorda/Documents/ObsidianVault`). Fork de `[[Carreer-ops]]`
(dossier original conservé intact, ne pas y toucher).

**Avant de répondre à toute question non triviale sur ce projet**, interroge d'abord le cerveau :

```bash
cd C:/Users/jorda/Documents/ObsidianVault
graphify query "Freelance-ops : <ta question>" --backend ollama --model qwen2.5-coder:7b
```

Si la page `[[Freelance-ops]]` n'existe pas encore, propose à l'utilisateur de l'ingérer via `/wiki-brain ingest`.

## Contexte projet

App desktop Electron mono-utilisateur de prospection freelance : scraping de
leads ciblés par secteur (artisans, agences immobilières, PME…), génération
d'emails de prospection et suivi des réponses.
100 % local : SQLite + secrets via trousseau Windows, aucun cloud.

- **Stack** : Electron + React + TypeScript + Vite, Prisma + SQLite, IPC typé, electron-builder
- **Démarrage** : `pnpm dev` (Electron en dev), `pnpm build:win` (.exe)
- **Arbo** : `apps/desktop/{electron,src,renderer,prisma}` + `packages/shared` (contrat IPC)

Voir `README.md` pour les détails de configuration utilisateur (Profil, Réglages, Campagnes).

## Règles de session

À la fin de chaque session non triviale sur ce projet, suis les règles Wiki-Brain (cf. CLAUDE.md global) :
mets à jour la page `[[Freelance-ops]]` avec les décisions/apprentissages, ajoute une entrée dans `log.md`.
