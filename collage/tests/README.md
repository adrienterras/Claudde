# Tests d'Atelier Gribouille

Tests de bout en bout avec [Playwright](https://playwright.dev), sur des **images de synthèse**
(`fixtures/`, générées par `make_fixtures.py` : personnages géométriques, page peinte, lignes de
crayon, feuille sur un parquet dessiné). Aucun dessin d'enfant n'est dans le dépôt.

```bash
cd collage
npm install                      # une fois
npx playwright install chromium  # une fois (navigateur de test)
npm test                         # toute la suite
npx playwright test ui           # une suite
npm run test:headed              # en regardant le navigateur
```

Un navigateur déjà installé peut être utilisé avec `CHROMIUM_PATH=/chemin/vers/chrome npm test`.

| Fichier | Ce qui est vérifié |
| --- | --- |
| `ui.spec.js` | parcours simple à la première visite (sections repliées, réglages avancés fermés, choix mémorisé), capteur d'erreur global, mise en page téléphone |
| `extract.spec.js` | analyse d'une page : découpe, deux sujets, page peinte = fond, page pâle = texte, photo sur parquet détourée, pas de faux positif sur feuille blanche |
| `import.spec.js` | import d'images et de PDF, noms et classement, page pâle mise de côté, fichier illisible signalé, changement de rôle et de taille |
| `compose.spec.js` | six propositions, sélection de chaque style, Galerie sans chevauchement, nouvelles propositions et densité, Scène dans la toile, fiche du dessin à la sélection |
| `export.spec.js` | 300 dpi par défaut, téléchargement JPEG et PDF réels, relecture haute définition puis libération, guide de création |
| `save.spec.js` | sauvegarde, rechargement, réouverture à l'identique, suppression en deux temps |
| `i18n.spec.js` | version anglaise : `?lang=en`, choix mémorisé, retour au français par le sélecteur ; aucun texte dynamique sans traduction après un import complet |

`npm test` lance d'abord `tests/i18n-check.js`, qui compare les textes français de l'interface au
dictionnaire anglais de `js/i18n.js` et échoue s'il manque une traduction.

Chaque test échoue aussi si la page lève une erreur non rattrapée. Le workflow
`.github/workflows/tests.yml` lance la suite à chaque push et à chaque pull request.
