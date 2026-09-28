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
   - *fond* : page entièrement peinte → utilisée en arrière-plan (papiers déchirés) ;
   - *découpe* : dessin sur papier → sujets détourés avec une marge de papier blanc.
   Un clic change le rôle (découpe → fond → ignoré). Les pièces découpées peuvent être retirées ou remises.
3. **Composition** : format (100×70 cm, etc.), type de fond (paysage ciel/milieu/sol, mosaïque, papier uni),
   densité, rotation, ombres. « Nouvelle composition » tire une nouvelle disposition.
   Sur l'œuvre : glisser pour déplacer, poignée ↻ ou molette pour agrandir/tourner (Maj + molette = rotation),
   barre d'outils pour devant/derrière/miroir/dupliquer/retirer.
4. **Exporter** en JPEG ou PNG, jusqu'à 300 dpi pour l'impression sur toile.

## Fonctionnement

- `js/extract.js` : estimation de la couleur du papier sur les bords, recadrage sur la feuille quand le scan
  a des marges, détection des traits, dilatation + remplissage des trous (forme « ciseaux »),
  composantes connexes → pièces, blanchiment du papier et ravivage des couleurs.
- `js/compose.js` : génération du fond (bandes ou mosaïque de papiers aux bords déchirés), placement des
  découpes en limitant les chevauchements, rendu avec ombres portées.
- `js/app.js` : interface, édition interactive, export haute résolution.
- `vendor/` : [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (licence Apache 2.0) pour lire les PDF.
