# Le livre de dessins (`livre/`, publié sous `/livre/`)

Second atelier, séparé de l'atelier des œuvres : les dessins deviennent les pages d'un livre à
imprimer, comme un album photo.

## Ce que fait l'utilisateur

1. **Importer** des scans (PDF de plusieurs pages, JPG, PNG) ou les dessins d'exemple.
2. **Le livre** : titre, sous-titre, format (A4 portrait, A4 paysage, carré 21 cm, carré 30 cm),
   un, deux ou quatre dessins par page, couleur du papier, légendes et numéros de page.
3. **Les dessins** : ordre (flèches), titre et date ou âge de chaque dessin, quart de tour,
   dessin de couverture (étoile), retrait.
4. **Imprimer** : PDF 300 dpi (ou 150 dpi, plus léger), fond perdu de 3 mm en option.

## Le livre produit

- Page 1 : couverture (titre, sous-titre, dessin choisi). Puis les pages intérieures, numérotées.
  Une page blanche s'ajoute si besoin pour un nombre de pages pair, puis la 4e de couverture.
- Sur une page à plusieurs dessins, la grille (lignes ou colonnes) est choisie pour que les
  dessins soient les plus grands possible ; aucun dessin n'est déformé ni rogné.
- La mise en page est calculée en centimètres une seule fois et sert à l'aperçu (SVG) comme au
  PDF (jsPDF) : l'aperçu est fidèle. Les textes utilisent Times et Helvetica, les polices
  intégrées aux PDF, dans l'aperçu comme dans le fichier.
- Les dessins sont gardés en JPEG d'au plus 3600 px de côté (2600 px sur téléphone) ; au moment
  du PDF, chacun est réduit à la définition utile pour sa place (300 ou 150 dpi). Un message
  prévient quand un dessin passera sous 150 dpi.

## Technique

- Fichiers : `livre/index.html`, `livre/style.css`, `livre/js/book.js`, `livre/js/i18n.js`.
- Réutilise depuis l'atelier, par `../atelier/` : pdf.js, jsPDF, `config.js` et la mesure
  d'audience (`Atelier.track('Livre', { etape })`), les dessins d'exemple et les icônes.
- Livre en cours gardé dans IndexedDB (base `atelier-gribouille-livre`) : chaque dessin est écrit
  une fois, le reste (ordre, légendes, réglages) est léger. Proposé à la visite suivante.
- Pas de compte ni d'envoi : tout reste dans le navigateur.
- Traductions : `livre/js/i18n.js`, vérifiées par `collage/tests/livre-i18n-check.js` (lancé
  avant les tests). Tests de bout en bout : `collage/tests/livre.spec.js` ; le serveur de test
  sert `/livre/` et `/atelier/` comme en ligne.
- Déploiement : `.github/workflows/pages.yml` copie `livre/` dans `_site/livre/`.
