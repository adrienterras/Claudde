# Atelier Gribouille

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
3. **Composition** : l'application propose elle-même une œuvre faite UNIQUEMENT des dessins,
   et de TOUS les dessins (chacun apparaît au moins une fois) :
   - les pages peintes (et les dessins au crayon gris) sont collées en grands papiers déchirés ;
     les trous restants sont comblés de petits lambeaux pris dans ces pages ;
   - chaque dessin découpé apporte son sujet principal et ses autres sujets colorés ;
   - **une seule échelle** pour tous, calculée pour que tout tienne sur la toile ;
   - **direction artistique par Claude** (page publiée) : Claude regarde tous les dessins, reconnaît
     chacun, choisit fond ou découpe, zone (ciel / milieu / sol), pièces maîtresses, et propose un
     titre affiché sous l'œuvre. Sans Claude, des règles intégrées prennent le relais ;
   - **trois propositions, trois styles**, à chaque fois :
     *Paysage* (ciel, milieu, sol, comme une grande toile de famille),
     *Tournesol* (tout tourne en spirale d'or autour des pièces maîtresses, au centre),
     *Cabinet de curiosités* (chaque dessin exposé droit, en rangées, sur papier blanc) ;
     un clic ouvre la proposition pour la retoucher, « Trois nouvelles propositions » en tire d'autres.
4. **Exporter** en JPEG ou PNG, jusqu'à 300 dpi pour l'impression sur toile.

## Fonctionnement

- `js/extract.js` : estimation de la couleur du papier sur les bords, recadrage sur la feuille quand le scan
  a des marges, détection des traits, dilatation + remplissage des trous (forme « ciseaux »),
  composantes connexes → pièces, blanchiment du papier et ravivage des couleurs.
- `js/compose.js` : tout est exprimé en centimètres sur la toile ; fond peint procédural, pages collées
  (recadrées, jamais agrandies), placement des découpes par score de composition, rendu et finition.
- `js/app.js` : interface, édition interactive, export haute résolution.
- `vendor/` : [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (licence Apache 2.0) pour lire les PDF.
