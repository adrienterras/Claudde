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
   Un clic sur un dessin ouvre son détail : rôle (découpe / fond / ignoré), **orientation** de la feuille
   (automatique, droite, couchée à droite, tête en bas, couchée à gauche ; en automatique, une page de
   fond trop haute pour la toile est couchée) et **taille réelle** de la feuille
   (A5, A4, A3, A2 ou autre) — c'est cette taille qui compte, puisque les dessins sont collés à
   taille réelle. Sans information dans le fichier, la taille est estimée à partir du scan
   (le scan médian est supposé A4) ; elle n'est arrondie à un format standard que si la feuille en a
   les proportions. Un bandeau **« Tailles à vérifier »** liste les feuilles douteuses (bandes, rouleaux,
   très grands ou très petits formats) avec un champ pour saisir leur plus grand côté : c'est cette
   taille qui fixe celle du dessin dans l'œuvre.
3. **Composition** : l'application propose elle-même une œuvre faite UNIQUEMENT des dessins,
   de TOUS les dessins, et **à leur taille réelle** : rien n'est réduit ni agrandi, puisque l'œuvre
   sera réalisée avec les originaux. C'est la toile qui s'adapte :
   - **plan de couverture** : l'application choisit les dessins qui font le meilleur fond (pages peintes
     bord à bord **en larges aplats colorés** — la part peinte, la couleur et le « calme » de la page,
     mesuré comme la part de surface sans variation locale, se multiplient ; une page chargée de petits
     motifs reste une découpe —, grandes, sujet peu découpable) et en passe juste assez en fond pour que
     les découpes restent aérées ; la **toile prend la taille du fond** (avec 15 % de recouvrement),
     dans les proportions choisies (paysage, carré, portrait), et les trois toiles du commerce les plus
     proches sont proposées avec leur taux de couverture. La liste des toiles ne contient que des tailles
     réellement vendues : formats français normalisés Figure / Paysage / Marine (20F 73 × 60 … 120F
     195 × 130), dont ceux vendus chez Cultura (gamme Monali : 20F, 25F, 30M, 40F, 50F, 50P, 60F),
     et les toiles 3D carrées et panoramiques Cultura (80 × 80, 100 × 100, 100 × 50, 120 × 40,
     150 × 50). On peut imposer l'une d'elles : l'application dit alors si le papier suffit ;
   - chaque page de fond est utilisée UNE SEULE FOIS et EN ENTIER : un grand morceau déchiré, et le
     reste de la page déchiré en lambeaux qui bouchent les trous ; le papier peut déborder du bord ;
   - chaque dessin découpé apporte son sujet principal et ses autres sujets colorés ; une feuille pâle
     (crayon gris, texte) est toujours un papier de fond ;
   - **composition « Paysage »** : les pages de fond sont réparties en trois bandes selon leur valeur et
     leur couleur (claires et froides en haut, sombres et chaudes en bas), posées en tuiles presque
     droites qui se chevauchent, le sol par-dessus le milieu, le milieu par-dessus le ciel ; les lambeaux,
     larges, restent dans la bande de leur page ;
   - **placement des sujets** : carte de charge visuelle du fond (les sujets cherchent une zone calme et
     un contraste clair / foncé), respiration autour des pièces maîtresses, petits éléments groupés en
     constellations près d'une grande pièce, rotation retenue ;
   - **direction artistique par Claude** (page publiée) : Claude regarde tous les dessins, reconnaît
     chacun, choisit fond ou découpe, zone (ciel / milieu / sol), pièces maîtresses, et propose un
     titre affiché sous l'œuvre. Sans Claude, des règles intégrées prennent le relais ;
   - **trois propositions, trois styles**, à chaque fois :
     *Paysage* (ciel, milieu, sol, comme une grande toile de famille),
     *Tournesol* (tout tourne en spirale d'or autour des pièces maîtresses, au centre),
     *Cabinet de curiosités* (sur la même toile, les plus beaux dessins exposés droits, en rangées,
     sans chevauchement : ceux qui n'y tiennent pas restent disponibles) ;
     un clic ouvre la proposition pour la retoucher, « Trois nouvelles propositions » en tire d'autres.
4. **Exporter** en JPEG ou PNG, jusqu'à 300 dpi pour l'impression sur toile.
**Voir l'œuvre de près** : pincement à deux doigts, molette (sans pièce sélectionnée) ou pincement du
   pavé tactile, double-tap sur une zone vide, boutons − / + / ajuster ; glisser une zone vide pour se
   déplacer ; bouton plein écran, pratique sur téléphone.
5. **Retoucher une découpe** : bouton « Retoucher » (ou double-clic sur une pièce de l'œuvre, ou ciseaux
   sur la vignette d'une pièce). Éditeur plein écran avec zoom (molette, pincement, + / −), gomme,
   pinceau « restaurer » qui remet le dessin d'origine (y compris autour de la découpe initiale),
   défaire / refaire (Ctrl+Z), retour à la découpe d'origine. Le trait de coupe magenta est affiché
   en direct ; en validant, la pièce est mise à jour dans les trois propositions sans bouger sur la toile.
6. **Guide de création (PDF)** pour réaliser l'œuvre avec les originaux :
   - couverture (taille de la toile, matériel, mode d'emploi), **plan de pose** quadrillé tous les 10 cm
     avec le numéro de chaque élément ;
   - **étapes de collage** dans l'ordre (lambeaux de fond, grandes pages, puis découpes) : mini-carte
     de l'œuvre avec l'élément en couleur, case de la grille, position du centre en cm, rotation ;
   - **fiches de découpe**, une par dessin original : le scan avec ses traits de coupe magenta
     numérotés, une règle en cm sur les bords et les cotes de chaque morceau (taille, distance aux
     bords), à reporter sur l'original avant de découper.

## Fonctionnement

- `js/extract.js` : estimation de la couleur du papier sur les bords, recadrage sur la feuille quand le scan
  a des marges, détection des traits, dilatation + remplissage des trous (forme « ciseaux »),
  composantes connexes → pièces, blanchiment du papier et ravivage des couleurs.
- `js/compose.js` : tout est exprimé en centimètres sur la toile ; fond peint procédural, pages collées
  (recadrées, jamais agrandies), placement des découpes par score de composition, rendu et finition.
- `js/app.js` : interface, édition interactive, export haute résolution.
- `js/editor.js` : éditeur de découpe (masque en pixels de la page, historique, zoom tactile).
- `js/guide.js` : génération du guide de création (pages dessinées à 150 dpi, assemblées en PDF).
- `assets/` : éléments de la charte Atelier Gribouille (monogramme détouré, motif de crayons, pictogrammes).
  Palette : craie #F8F5EF, lin #DCCBB8, blush #D9A7A0, argile #C26F56, olive #6B6F4E ; typographies
  Playfair Display et Montserrat.
- `vendor/` : [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (Apache 2.0) pour lire les PDF,
  [jsPDF](https://github.com/parallax/jsPDF) 2.5 (MIT) pour écrire le guide.
