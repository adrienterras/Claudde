# Atelier Collage

Application web qui transforme des dessins d'enfants scannés en une œuvre d'art façon collage
(pages peintes en fond, sujets découpés « aux ciseaux » disposés par-dessus).

## Utilisation

Tout se passe dans le navigateur, aucune image n'est envoyée sur internet.

```sh
cd collage && python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

1. **Importer** les scans : PDF multipages, JPG ou PNG (glisser-déposer).
2. **Dessins** : chaque page est classée automatiquement
   - *fond* : page entièrement peinte → papier collé en arrière-plan ;
   - *découpe* : dessin sur papier → sujets détourés avec une marge de papier blanc.
   Un clic sur un dessin ouvre son détail : rôle (découpe / fond / ignoré) et **taille réelle** de la feuille
   (A5, A4, A3, A2 ou autre). Sans information dans le fichier, la taille est estimée à partir du scan
   (le scan médian est supposé A4) : vérifiez-la, c'est elle qui fixe la taille du dessin dans l'œuvre.
3. **Composition**
   - **Échelle des dessins** : un facteur unique appliqué à *tous* les dessins, qui gardent donc leurs
     proportions réelles les uns par rapport aux autres. Rien n'est agrandi ou réduit individuellement.
     En automatique, environ cinq feuilles de fond tiennent sur la largeur de la toile.
   - **Paysage** : un fond peint (ciel, ocre, terre) aux couleurs tirées des dessins ; les pages peintes
     y sont collées une seule fois chacune (ciel en haut, terre en bas, pans déchirés au milieu).
   - Placement des sujets selon des règles de composition : sujets posés au sol / flottants,
     points forts (tiers), équilibre des masses, couleurs voisines variées, profondeur.
     Les sujets pâles (crayon gris, texte) passent après les sujets colorés ; ce qui ne tient pas à
     l'échelle choisie reste disponible (pointillés dans la liste des pièces).
   - Sur l'œuvre : glisser pour déplacer, poignée ↻ ou molette pour tourner (la taille reste fixée
     par l'échelle), barre d'outils pour devant/derrière/miroir/dupliquer/retirer.
   - Finition toile : grain et léger vignettage pour unifier l'ensemble.
4. **Exporter** en JPEG ou PNG, jusqu'à 300 dpi pour l'impression sur toile.

## Fonctionnement

- `js/extract.js` : estimation de la couleur du papier sur les bords, recadrage sur la feuille quand le scan
  a des marges, détection des traits, dilatation + remplissage des trous (forme « ciseaux »),
  composantes connexes → pièces, blanchiment du papier et ravivage des couleurs.
- `js/compose.js` : tout est exprimé en centimètres sur la toile ; fond peint procédural, pages collées
  (recadrées, jamais agrandies), placement des découpes par score de composition, rendu et finition.
- `js/app.js` : interface, édition interactive, export haute résolution.
- `vendor/` : [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (licence Apache 2.0) pour lire les PDF.
