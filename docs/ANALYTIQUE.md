# Mesure d'audience

Le site et l'application utilisent **Umami** (offre Umami Cloud « Hobby », gratuite) : sans
cookie, sans identifiant personnel, exempté de bandeau de consentement par la CNIL. Le code est en
place ; il reste à créer le compte et à coller l'identifiant du site dans `collage/config.js`.

## Mise en place (10 minutes)

1. Créer un compte gratuit sur <https://cloud.umami.is/signup> (offre Hobby : 100 000 événements
   par mois, 3 sites, un an d'historique, largement suffisant pour démarrer).
2. « Add website » : nom *Atelier Gribouille*, domaine `ateliergribouille.art`.
3. Ouvrir le site créé → **Edit** → **Tracking code** : copier la valeur de `data-website-id`
   (une suite du type `3f2a…-…`). Ne pas copier le `<script>` entier : il est déjà dans les pages.
4. Dans `collage/config.js`, coller cet identifiant dans `analytics.websiteId`, puis pousser.
   Le même réglage sert à la page d'accueil (`landing/index.html` charge `atelier/config.js`).
5. Ouvrir le site : la visite apparaît dans le tableau de bord en temps réel.

Si Umami propose une autre région d'hébergement (`eu.umami.is`), choisir celle-ci et reporter
l'adresse dans `analytics.host`.

## Ce qui est mesuré

- Page d'accueil et application : visites, pages vues, sources, pays, appareils (agrégés).
- Dans l'application, des compteurs d'usage, jamais de contenu : `Import` (nombre de fichiers,
  plafonné à 50), `Exemple`, `Proposition` (style), `Export` (type et qualité), `Sauvegarde`,
  `Inscription` (via e-mail ou Google). Ils apparaissent dans l'onglet **Events** du
  tableau de bord, avec leurs propriétés.
- Rien n'est envoyé depuis `localhost`, les tests ni l'artefact de démonstration.

## Désactiver ou changer d'outil

- Vider `analytics.websiteId` dans `collage/config.js` : plus aucun script n'est chargé, ni sur
  l'accueil ni dans l'application.
- Plausible (payant, hébergé en Europe) est aussi pris en charge :
  `analytics: { provider: 'plausible', domain: 'ateliergribouille.art' }`.
- Pensez à mettre à jour la section « Mesure d'audience » de `collage/confidentialite.html`.
