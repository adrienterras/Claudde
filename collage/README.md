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
     150 × 50), et les cadres IKEA aux formats photo standard (30 × 40, 40 × 50, 50 × 70, 61 × 91,
     70 × 100, carré 50 × 50 ; l'œuvre se fait alors sur un carton à la taille de la vitre). On peut
     imposer l'une d'elles : l'application dit alors si le papier suffit ;
   - chaque page de fond est utilisée UNE SEULE FOIS et EN ENTIER, **sans être découpée** : la feuille
     est collée telle quelle, les pages se chevauchent et ce qui dépasse de la toile se rogne à la pose ;
     seule une page plus grande que la toile est réduite, et son surplus déchiré en lambeaux ;
   - **le style de l'œuvre de référence** : le fond n'est fait que de pages franchement peintes ou
     colorées (une feuille blanche avec un petit dessin, ou un sujet net entouré de papier, reste une
     découpe) ; les feuilles pâles (crayon gris, texte) sont mises de côté par défaut — c'est signalé
     dans le panneau (numéros), sur le cartel et sur la couverture du guide — et un réglage permet de
     les coller en fond ; les pages de fond restent entières ;
   - **photos sur un sol ou une table** : quand une image (ou une page de scan de téléphone, sans
     taille physique) montre le dessin posé sur du parquet, du bois, du carrelage ou un plan de
     travail, la surface est reconnue à la bordure (teinte bois ou neutre, unie ou structurée par des
     joints), puis retirée : le dessin est détouré en suivant sa forme, sur un fond blanc. C'est
     signalé sur la vignette (« détouré »), dans le panneau (avec un bouton pour garder la photo
     entière) et sur la fiche de découpe ;
   - **densité** (curseur sous l'aperçu de l'œuvre, avec le nombre de dessins utilisés) : le curseur
     règle le nombre de sujets posés, des plus forts aux plus faibles, de 20 % au minimum jusqu'à tous ;
   - **densité au maximum** : tous les dessins chargés entrent dans l'œuvre — plus de plafond de
     couverture, un sujet sans place libre se pose au moins mauvais endroit, et les feuilles pâles
     rejoignent le fond ; la rotation des découpes est fixe (réglage retiré) ;
   - chaque dessin découpé apporte son sujet principal, plus un ou deux sujets secondaires seulement
     s'ils sont grands (≥ 7 cm) et colorés ; les découpes gardent une marge de papier généreuse
     (≈ 0,6 cm) qui les fait ressortir comme des autocollants ; elles couvrent au plus ~45 % de la toile
     et n'empilent jamais : les sujets sans place restent en attente (pointillés dans la liste) ;
   - **composition « Paysage »** : les pages de fond sont réparties en trois bandes selon leur valeur et
     leur couleur (claires et froides en haut, sombres et chaudes en bas), posées en tuiles presque
     droites qui se chevauchent, le sol par-dessus le milieu, le milieu par-dessus le ciel ; les éventuels lambeaux
     restent dans la bande de leur page ;
   - **export PDF à l'échelle** : une page de la taille exacte de la toile (1 cm = 1 cm), chaque page
     de fond posée tournée comme une image JPEG, les découpes et papiers déchirés en PNG avec leur
     transparence, les cadres de la galerie, le plomb et les traits en vecteurs ; images à 150 dpi
     au plus. Les scans restent des images : un dessin d'enfant ne se vectorise pas sans le trahir ;
   - **mode « Fond seul »** (bouton près du zoom) : on ne voit que le fond peint et les pages de fond,
     que l'on déplace, tourne, met devant ou derrière, retourne ou retire à sa guise ; « Tout voir »
     ramène les découpes. Les pages restent entières et ne servent qu'une fois (pas de duplication) ;
   - **rendu à plat** : aucune ombre portée sur les papiers ni sur les découpes, comme un collage vu de face ;
   - **placement des sujets** : carte de charge visuelle du fond (les sujets cherchent une zone calme et
     un contraste clair / foncé), respiration autour des pièces maîtresses, petits éléments groupés en
     constellations près d'une grande pièce, rotation retenue ;
   - **direction artistique par Claude** (page publiée) : Claude regarde tous les dessins, reconnaît
     chacun, choisit fond ou découpe, zone (ciel / milieu / sol), pièces maîtresses, et propose un
     titre affiché sous l'œuvre. Sans Claude, des règles intégrées prennent le relais ;
   - **fond de toile** : au choix, la toile nue (lin) ou un aplat d'acrylique dans les teintes
     classiques du commerce (blanc de titane, jaune de Naples, ocre, cadmiums, terres, verts, bleus,
     violet, gris de Payne, noir de Mars) ; il couvre toute la toile et permet une œuvre aérée quand
     il n'y a pas assez de dessins ; par défaut, l'app conseille pour chaque proposition la teinte
     qui fait le mieux ressortir les dessins (contraste de clarté avec la couleur d'ensemble des
     éléments, teinte plutôt opposée à la dominante, teintes calmes favorisées) ; la Galerie fait exception : fond blanc fixe, sans couleur ni
     effet peinture ni finition toile ; l'aplat est rendu avec un vrai effet de peinture (coups de brosse en deux couches,
     traces des poils, couche inégale), à l'écran, dans les exports et dans le PDF ; le guide indique
     la couleur à peindre ; le choix est mémorisé ;
   - **orientation de la toile au choix**, paysage ou portrait, pour la taille automatique comme pour
     les toiles du commerce (un 30P devient 65 × 92 cm en portrait) ; le choix est mémorisé ;
   - **cinq propositions, cinq styles**, à chaque fois :
     *Paysage* (ciel, milieu, sol, comme une grande toile de famille),
     *Tournesol* (tout tourne en spirale d'or autour des pièces maîtresses, au centre),
     *Courtepointe* (un patchwork : les pages de fond posées bord à bord, presque droites, en
     alternant claires et foncées comme un damier cousu ; une découpe posée en médaillon au centre
     de chaque carreau, les plus grandes sur les plus grands carreaux),
     *Galerie* (une grille régulière de cases carrées cernées d'un trait noir fin de 0,8 mm, un sujet
     par case, le nombre de cases suivant le curseur de densité,
     comme une planche de personnages encadrée : l'app retient les sujets les plus adaptés, un par
     dessin, et le plus grand nombre de cases que la toile permet à taille réelle — le nombre de
     dessins dépend donc de la toile),
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

## Mise en ligne

L'application est un site statique (aucun serveur, les scans restent dans le navigateur). Le
workflow `.github/workflows/pages.yml` publie le dossier `collage/` sur GitHub Pages à chaque
push de la branche de l'application. Adresse : https://adrienterras.github.io/Claudde/

Sans la fenêtre Claude, la direction artistique par Claude n'est pas disponible : l'application
compose avec ses règles intégrées.
