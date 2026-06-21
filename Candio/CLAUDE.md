# CLAUDE.md — Carreer-ops

## Pont vers Wiki-Brain

Ce projet est tracé dans le wiki personnel sous `[[Carreer-ops]]`
(vault : `C:/Users/jorda/Documents/ObsidianVault`).

**Avant de répondre à toute question non triviale sur ce projet**, interroge d'abord le cerveau :

```bash
cd C:/Users/jorda/Documents/ObsidianVault
graphify query "Carreer-ops : <ta question>" --backend ollama --model qwen2.5-coder:7b
```

Si la page `[[Carreer-ops]]` n'existe pas encore, propose à l'utilisateur de l'ingérer via `/wiki-brain ingest`.

## Contexte projet

App desktop Electron mono-utilisateur d'automatisation de candidatures spontanées.
100 % local : SQLite + secrets via trousseau Windows, aucun cloud.

- **Stack** : Electron + React + TypeScript + Vite, Prisma + SQLite, IPC typé, electron-builder
- **Démarrage** : `pnpm dev` (Electron en dev), `pnpm build:win` (.exe)
- **Arbo** : `apps/desktop/{electron,src,renderer,prisma}` + `packages/shared` (contrat IPC)

Voir `README.md` pour les détails de configuration utilisateur (Profil, Réglages, Campagnes).

## Règles de session

À la fin de chaque session non triviale sur ce projet, suis les règles Wiki-Brain (cf. CLAUDE.md global) :
mets à jour la page `[[Carreer-ops]]` avec les décisions/apprentissages, ajoute une entrée dans `log.md`.
