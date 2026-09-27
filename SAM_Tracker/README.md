<p align="center"><img src="assets/icon.png" width="96" alt=""></p>

# SAM.gov Tracker

> Application Windows qui repère, parmi les appels d'offres du gouvernement fédéral américain
> publiés sur **[SAM.gov](https://sam.gov)**, ceux qui correspondent à un métier
> (marketing, communication, branding, web design et développement, design logiciel…),
> et les présente triés, lisibles et à jour.

---

## Installation

Windows 10 ou 11. Aucun droit administrateur.

**Coller cette commande dans PowerShell** (menu Démarrer > « PowerShell ») :

```powershell
irm https://raw.githubusercontent.com/jordanduplain-svg/Application_dev/main/SAM_Tracker/install.ps1 | iex
```

Elle installe Python (version officielle de python.org) s'il n'est pas déjà présent,
télécharge la dernière version de l'application dans `%LOCALAPPDATA%\Programs\SAM Tracker`,
crée les raccourcis sur le Bureau et dans le menu Démarrer, puis lance l'application
(une à deux minutes, connexion internet nécessaire). Elle fonctionne même quand le
**Contrôle intelligent des applications** de Windows 11 bloque les programmes non signés
(erreur 4551) : l'application tourne avec Python, qui est signé. Pour **mettre à jour**, relancer la même
commande. Pour **désinstaller** : Paramètres Windows > Applications > SAM Tracker.

**Autre méthode, avec un installateur classique** (si ce contrôle n'est pas actif sur le PC) :
télécharger `SAM-Tracker-Setup-x.y.z.exe` sur la page
**[Releases](https://github.com/jordanduplain-svg/Application_dev/releases)** (dernière
version **SAM Tracker**) et double-cliquer dessus.

> L'application n'est pas signée par un certificat payant : Windows peut afficher
> « Windows a protégé votre ordinateur ». Cliquer sur **Informations complémentaires**,
> puis **Exécuter quand même**.

## Pourquoi ce projet

SAM.gov publie chaque jour des milliers d'avis de marchés publics (plus de 40 000 en ligne à
un instant donné). Le site ne permet pas de suivre simplement un domaine d'activité : il faut
refaire les mêmes recherches, relire des annonces très longues, écarter les doublons (chaque
modification d'une offre est republiée comme un nouvel avis) et vérifier à la main si la date
limite est passée.

**SAM.gov Tracker automatise ce tri** : un clic récupère la liste du jour, l'application note
chaque offre selon des mots-clés pondérés, ne garde que celles qu'on peut encore remporter, et
les affiche de la plus pertinente à la moins pertinente. Tout reste sur l'ordinateur : pas de
compte, pas de clé d'API, aucun service externe en dehors du téléchargement des données
publiques de SAM.gov.

## Ce que fait l'application

- **Téléchargement du fichier public quotidien** de SAM.gov (environ 240 Mo), uniquement
  quand il a changé.
- **Score par mots-clés pondérés** : 135 mots-clés par défaut (marketing, communication,
  branding, web design, développement web, design logiciel…). Un mot-clé dans le titre compte
  double. Les mots trop fréquents (« website ») peuvent être limités au titre, et des mots
  d'exclusion écartent le bruit (« radio », « command »…).
- **Offres encore ouvertes uniquement** par défaut : date limite comparée à l'heure exacte
  (fuseau horaire de New York), avis archivés et marchés déjà attribués masqués. Les offres
  anciennes mais toujours ouvertes sont gardées.
- **Pas de doublons** : toutes les versions d'une même offre (amendements, republications)
  sont regroupées sous la plus récente, avec l'historique des versions.
- **Tri et filtres** : par score ou par date, type d'avis, période de publication
  (30, 90, 180 jours ou sans limite), score minimum, recherche plein texte.
- **Descriptions lisibles** : découpage en paragraphes, sections en gras, mots-clés
  surlignés.
- **Décisions de l'utilisateur prioritaires** : une offre écartée ou gardée à la main n'est
  jamais modifiée par les mises à jour suivantes, et reste récupérable.
- **Page Réglages** pour modifier les mots-clés, leurs poids et les règles de sélection, sans
  toucher à un fichier.

## Utilisation

1. Lancer **SAM Tracker** depuis le menu Démarrer (ou l'icône du Bureau).
   L'application s'ouvre dans sa propre fenêtre.
2. Sur le **Dashboard**, cliquer sur **Run the tool**. Le premier lancement télécharge
   les données (une à deux minutes), les suivants sont plus rapides.
3. Consulter les offres dans **Offers** : cliquer sur une ligne pour lire le détail,
   **Discard** pour l'écarter (récupérable dans **Discarded**).
4. Ajuster les mots-clés dans **Settings**. Les changements s'appliquent au lancement suivant.
5. Le bouton **Quit**, en haut à droite, ferme complètement l'application.

| Page | Contenu |
| --- | --- |
| **Offers** | Offres dont le score atteint le minimum, ou gardées / restaurées à la main |
| **Filtered out** | Offres écartées par l'outil (score trop faible ou mot exclu). **Keep** en récupère une |
| **Discarded** | Offres écartées à la main. **Restore** en récupère une |
| **Settings** | Mots-clés, poids, mots exclus, score minimum, durées |

**Mise à jour** : installer la nouvelle version par-dessus l'ancienne, les réglages et les
offres sont conservés. **Désinstallation** : Paramètres Windows > Applications > SAM Tracker.
**Données** : `%LOCALAPPDATA%\SAM Tracker` (conservé après désinstallation, à supprimer pour
repartir de zéro).

---

## Développement

Python 3.11 ou plus récent. Le dépôt contient plusieurs projets : ces commandes ne
récupèrent que le dossier `SAM_Tracker`.

```powershell
git clone --filter=blob:none --sparse https://github.com/jordanduplain-svg/Application_dev.git
```

```powershell
cd Application_dev; git sparse-checkout set SAM_Tracker; cd SAM_Tracker
```

```powershell
python -m venv .venv; .venv\Scripts\python -m pip install -r requirements-dev.txt
```

Lancer les tests, puis l'application depuis les sources :

```powershell
.venv\Scripts\python -m pytest
```

```powershell
.\start_app.bat
```

Depuis les sources, l'application utilise le port **8766** (8765 pour la version installée,
les deux peuvent donc coexister). Les réglages sont dans `settings.yaml` (créé à partir de
`config.yaml`, les réglages par défaut livrés à tous) et les données dans `data/`.
La variable `SAM_TRACKER_HOME` permet d'utiliser un autre dossier.

### Construire l'installateur

```powershell
.venv\Scripts\pyinstaller sam_tracker.spec --noconfirm
```

```powershell
& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" /DAppVersion=1.0.2 installer.iss
```

L'installateur est écrit dans `Output\`. La seconde étape nécessite
[Inno Setup 6](https://jrsoftware.org/isinfo.php).

### Publier une version

1. Changer `__version__` dans `app/__init__.py` (par exemple `1.1.0`), puis commit.
2. `git tag sam-tracker-v1.1.0` puis `git push origin sam-tracker-v1.1.0`.

GitHub Actions (`.github/workflows/sam-tracker.yml`, à la racine du dépôt) lance les tests,
construit l'application et l'installateur, et publie `SAM-Tracker-Setup-1.1.0.exe` dans une
nouvelle release. Les tests tournent aussi à chaque modification de ce dossier.

## Stack

- Python 3.12, Flask (serveur local) et JavaScript sans framework pour l'interface
- SQLite pour le stockage, avec fonctions de fenêtrage pour le regroupement des versions
- PyInstaller (exécutable) et Inno Setup (installateur par utilisateur, français / anglais)
- pytest (99 tests), GitHub Actions pour les tests et les releases

## Arborescence

```
SAM_Tracker/
├─ install.ps1            Installation sans Setup.exe (commande PowerShell)
├─ launcher.py            Point d'entrée : démarre le serveur local une seule fois, ouvre la fenêtre
├─ app/
│  ├─ main.py             Routes web uniquement
│  ├─ pipeline.py         Téléchargement → score → enregistrement
│  ├─ runner.py           Exécute le pipeline en arrière-plan, avec statut en direct
│  ├─ fetcher.py          Téléchargement du CSV SAM.gov (source de données)
│  ├─ parser.py           Lignes du CSV → objets Offer (seul endroit qui connaît les colonnes)
│  ├─ scorer.py           Correspondance des mots-clés
│  ├─ text_format.py      Mise en forme des descriptions
│  ├─ repository.py       Tout l'accès SQLite
│  ├─ config.py           Réglages et emplacement des fichiers
│  ├─ single_instance.py  Une seule copie de l'application à la fois
│  ├─ templates/          Pages HTML (Jinja)
│  └─ static/             CSS (couleurs en variables) et JavaScript
├─ config.yaml            Réglages par défaut (les 135 mots-clés)
├─ tests/                 Tests pytest
├─ assets/                Icône de l'application
├─ tools/make_icon.py     Génération de l'icône
├─ sam_tracker.spec       Recette PyInstaller
└─ installer.iss          Recette Inno Setup
```

Pour ajouter une source de données : dans `app/fetcher.py`, écrire une classe avec un `name`
et une méthode `fetch(self, since, report)` qui renvoie des objets `Offer`, puis l'enregistrer
dans `get_source()`.
