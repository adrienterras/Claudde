# Mesure d'audience

Le site et l'application utilisent **Plausible Analytics** : sans cookie, sans identifiant
personnel, hébergé dans l'Union européenne, et exempté de bandeau de consentement par la CNIL.
Le code est en place ; il reste à créer le compte pour que les données arrivent.

## Mise en place (10 minutes)

1. Créer un compte sur <https://plausible.io> (essai gratuit 30 jours, puis à partir de 9 €/mois ;
   choisir la région **EU** à l'inscription).
2. « Add a website » avec le domaine `ateliergribouille.art` (fuseau Europe/Paris). Ignorer
   l'étape d'installation du script : il est déjà dans les pages.
3. Dans les réglages du site Plausible, onglet **Goals**, ajouter les événements personnalisés
   envoyés par l'application : `Import`, `Exemple`, `Proposition`, `Export`, `Sauvegarde`,
   `Inscription`. Les propriétés (style, type d'export, qualité, fichiers, via) apparaissent dans
   l'onglet *Properties* une fois reçues.
4. Ouvrir le site : la première visite apparaît dans le tableau de bord en quelques secondes.

## Ce qui est mesuré

- Page d'accueil et application : visites, pages vues, sources, pays, appareil (agrégés).
- Dans l'application : compteurs d'usage, jamais de contenu : nombre de fichiers importés
  (plafonné à 50), style choisi, type et qualité d'export, sauvegardes, inscriptions (par
  e-mail, Google ou Facebook).
- Rien n'est envoyé depuis `localhost`, les tests ni l'artefact de démonstration (pas de
  configuration `analytics`).

## Désactiver ou changer d'outil

- Application : vider `analytics` dans `collage/config.js`.
- Accueil : retirer la ligne `<script … plausible.io …>` de `landing/index.html`.
- Instance Plausible auto-hébergée : ajouter `host: 'https://votre-instance'` dans `analytics`
  et remplacer l'URL du script de l'accueil.
- Pensez à mettre à jour la section « Mesure d'audience » de `collage/confidentialite.html`.
