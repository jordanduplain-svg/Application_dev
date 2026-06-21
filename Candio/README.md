# Candidatures — App desktop locale

Outil personnel d'automatisation de candidatures spontanées, à usage
mono-utilisateur. 100 % local : SQLite + secrets chiffrés via le trousseau
Windows. Aucun service cloud.

## Démarrage

```powershell
pnpm install
pnpm dev          # Lance Electron en mode développement
```

Au premier lancement, ouvrir l'app puis :
1. **Profil** — renseigner identité + adresse d'envoi + importer le CV (PDF).
2. **Réglages** — saisir la clé OpenAI, la config SMTP (Gmail : mot de passe
   d'application), et IMAP pour la détection des réponses.
3. **Campagnes** — créer une campagne, ajouter des entreprises (manuel ou
   CSV), générer les emails, prévisualiser, envoyer.

## Build du .exe

```powershell
pnpm build:win    # produit dist/Candidatures Setup x.y.z.exe
```

## Stack

- Electron + React + TypeScript + Vite (via electron-vite)
- Prisma + SQLite (un fichier dans userData)
- IPC Electron typé (contrat partagé dans `packages/shared`)
- Task-runner en mémoire (pas de Redis)
- electron-builder pour l'installeur Windows

## Arborescence

```
apps/desktop/
├─ electron/           Process principal + preload + handlers IPC
├─ src/                Logique métier (services, tâches de fond, lib)
├─ renderer/           UI React (Vite)
├─ prisma/             Schéma + migrations SQLite
└─ electron-builder.yml
packages/shared/       Contrat IPC + schémas Zod (source-only)
```

## Format CSV d'import d'entreprises

Une ligne d'en-têtes obligatoire. Colonnes reconnues (ordre indifférent) :
`name, contactEmail, website, contactName, contactRole`.
Les lignes sans nom ou sans email valide sont ignorées.
