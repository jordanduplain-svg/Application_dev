# Politique de sécurité

Ce projet manipule, en cible, des données de santé (catégorie sensible RGPD) et des
informations sur le personnel. Une vulnérabilité peut donc avoir un impact réel sur des
personnes. Merci de prendre le signalement au sérieux et de respecter la procédure
ci-dessous.

## Versions supportées

Le projet est en phase de fondations. Tant que la version `0.x` est en cours, **seule la
branche par défaut (`main`)** est couverte par les correctifs de sécurité.

## Signaler une vulnérabilité

**Ne créez pas d'issue publique** pour une vulnérabilité. Elle reste visible dans
l'historique git même après suppression.

À la place, utilisez l'un des canaux privés suivants :

1. **GitHub Security Advisories** : depuis la page du dépôt → onglet *Security* →
   *Report a vulnerability*. C'est le canal recommandé — il garantit la confidentialité
   et trace la procédure.
2. **Email** : à compléter par le mainteneur une fois le dépôt publié sur GitHub.

Merci d'inclure dans votre signalement :

- une description de la vulnérabilité,
- les étapes de reproduction (proof of concept apprécié, mais non requis),
- l'impact estimé (confidentialité / intégrité / disponibilité, surface concernée),
- la version / le commit affecté,
- vos coordonnées pour un retour.

## Engagement de réponse

- **Accusé de réception** : sous 72 heures ouvrées.
- **Évaluation initiale** : sous 7 jours.
- **Correctif** : selon la sévérité ; un correctif critique (RCE, fuite massive de
  données) est traité en priorité absolue.
- **Divulgation coordonnée** : nous publions une *security advisory* GitHub avec mention
  du reporter (sauf demande contraire) une fois le correctif livré et un délai raisonnable
  écoulé pour permettre aux déploiements de mettre à jour.

## Périmètre

**Dans le périmètre :**

- Vulnérabilités du code applicatif (back, front, scripts).
- Vulnérabilités introduites par des dépendances directes que nous pouvons mettre à jour.
- Mauvaise configuration **par défaut** (ex. valeur d'exemple acceptée en production).

**Hors périmètre :**

- Vulnérabilités d'instances tierces (votre déploiement, votre fournisseur cloud).
- Mauvaises configurations de votre propre déploiement (vous êtes responsable de votre
  RGPD, AIPD, durcissement réseau, sauvegardes).
- Vulnérabilités théoriques sans impact concret démontrable.

## Bonnes pratiques pour les déploiements

Pour les organisations qui hébergent ce projet :

- **Tournez les secrets régulièrement** (`JWT_SECRET`, `FIELD_ENCRYPTION_KEY`,
  `OIDC_CLIENT_SECRET`).
- **Sauvegardes chiffrées** de la base, testées régulièrement.
- **Mises à jour** : suivez les *security advisories* GitHub du dépôt.
- **AIPD/DPIA** réalisée avant mise en production.
- **Journalisation** : conservez les audit logs (port `AuditLogger`) selon votre politique
  de conservation.
