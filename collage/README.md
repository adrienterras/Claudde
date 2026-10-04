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
     découpe) ; les feuilles pâles (crayon gris, texte) sont mises de côté par défaut, sauf celles
     où Claude reconnaît un vrai sujet (nuage, bonhomme au crayon), découpées comme les autres ; un
     réglage permet de toutes les découper (les pages d'écriture seule, aux lignes de texte
     régulières, restant de côté) ou de les coller en fond (c'est
     alors signalé dans le panneau, sur le cartel et sur la couverture du guide) ou de les coller en
     fond ; les pages de fond restent entières ;
   - **compositions sauvegardées** (section « Mes compositions ») : « Sauvegarder cette composition »
     enregistre dans le navigateur (IndexedDB) les dessins (images d'origine), leurs réglages (rôle,
     taille, orientation, photo sur un sol, sujets gardés) et la mise en place exacte (chaque pièce et
     page, position, rotation, échelle, cadres, fond) ; la liste permet de rouvrir une composition
     telle quelle, sans nouvelle analyse, ou de la supprimer ; une composition rouverte reste
     épinglée jusqu'à « nouvelles propositions » ou un changement de réglage ;
   - **photos sur un sol ou une table** : quand une image (ou une page de scan de téléphone, sans
     taille physique) montre le dessin posé sur du parquet, du bois, du carrelage ou un plan de
     travail, une photo posée sur une page blanche (PDF d'un scanner de téléphone, marges A4) est
     d'abord rognée à la photo elle-même (cadre dense, bords non blancs), puis la surface est
     reconnue à la bordure (teinte bois, même très saturée comme un chêne
     verni, ou neutre ; unie, ou structurée par des joints qui se prolongent au-delà du dessin), et le
     dessin doit être une forme pleine qui occupe au moins 6 % de la photo (des traits sur une feuille
     de couleur ne le sont pas) ; une feuille photographiée de près, qui touche les bords, est
     acceptée si un bord entier montre encore la surface, dont la couleur est alors lue hors du
     papier ; le bois clair pris pour du papier et relié au bord est rendu à la surface ; la surface
     est alors retirée : le dessin est détouré en suivant sa forme, sur un fond blanc. C'est
     signalé sur la vignette (« détouré »), dans le panneau (avec un bouton pour garder la photo
     entière) et sur la fiche de découpe ; la détection tourne sur toutes les pages (un scan à plat a
     une bordure blanche et n'est pas concerné) ; si elle ne reconnaît pas la surface, le bouton
     « Retirer le fond autour du dessin » force le détourage d'après la couleur de bordure ;
   - **densité** (curseur sous l'aperçu de l'œuvre, avec le nombre de dessins utilisés) : le curseur
     règle le nombre de sujets posés, des plus forts aux plus faibles, de 20 % au minimum jusqu'à tous ;
   - **densité au maximum** : tous les dessins chargés entrent dans l'œuvre — plus de plafond de
     couverture, un sujet sans place libre se pose au moins mauvais endroit, et les feuilles pâles
     rejoignent le fond ; la rotation des découpes est fixe (réglage retiré) ;
   - chaque dessin découpé apporte son sujet principal et tous ses autres éléments qui ressemblent
     à un sujet (au moins 3 cm, même peu colorés : nuages au crayon, petits personnages) ; Claude,
     s'il est disponible, regarde ensuite chaque élément un par un et écarte les fragments (taches,
     bords de feuille, texte seul) ; le contour de chaque découpe est calculé en haute résolution
     (jusqu'à 1800 px de côté) avec un seuil d'encre à deux niveaux : les zones pâles (crayon léger,
     couleurs claires, dégradés) reliées à un trait net restent dans le dessin, le grain du papier non ;
     la coupe suit le dessin à quelques millimètres (≈ 3 mm sur un A4)
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
   - **mise en scène** (section 05) : une photo de la pièce (salon, chambre…), et l'œuvre active
     apparaît sur le mur, avec une ombre douce et sa tranche ; on la déplace, on la redimensionne
     (molette ou pincement) et on tire ses quatre coins pour suivre la perspective du mur
     (homographie) ; **placement automatique** : l'app repère le mur dégagé (plus grande zone unie et
     claire, de la couleur dominante des surfaces planes), pose l'œuvre en son milieu à hauteur de
     regard et l'incline selon les lignes du plafond et du sol mesurées sur la photo ; dans la page
     publiée, Claude regarde la photo et propose le placement ; export en JPEG à la résolution de la
     photo ; la photo reste sur l'appareil ;
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
   - **six propositions, six styles** (Paysage sélectionné par défaut), à chaque fois :
     *Paysage* (ciel, milieu, sol, comme une grande toile de famille),
     *Tournesol* (tout tourne en spirale d'or autour des pièces maîtresses, au centre),
     *Courtepointe* (un patchwork : les pages de fond posées bord à bord, presque droites, en
     alternant claires et foncées comme un damier cousu ; une découpe posée en médaillon au centre
     de chaque carreau, les plus grandes sur les plus grands carreaux),
     *Galerie* (une grille régulière de cases carrées cernées d'un trait noir fin de 0,8 mm, un sujet
     par case, le nombre de cases suivant le curseur de densité, comme une planche de personnages
     encadrée ; ce style est fait pour l'impression : un dessin trop grand pour sa case est réduit,
     jamais agrandi, si bien qu'au maximum du curseur tous les dessins tiennent, quelle que soit la
     toile ; un dessin sélectionné s'agrandit ou se réduit par pas de 10 % avec deux boutons de la
     barre d'outils, visibles seulement en Galerie ; les dessins y restent tels quels, comme dans les
     autres styles ; le cartel et le guide signalent la réduction, c'est le seul style qui ne respecte
     pas la taille réelle),
     *Cabinet de curiosités* (sur la même toile, les plus beaux dessins exposés droits, en rangées,
     sans chevauchement : ceux qui n'y tiennent pas restent disponibles),
     *Scène* (une scène est une sélection : au plus 18 sujets, les plus nets et colorés, un sujet
     reconnu par Claude passant devant, sans feuilles de texte ni fragments ; le reste attend dans le
     panneau, à ajouter d'un clic ; la toile automatique se calcule sur cette sélection ; une vraie
     scène d'après ce que Claude a vu dans chaque dessin, sa « place » : les pages
     de ciel à plat le long du bord haut avec ce qui vole posé dessus, les pages d'horizon entre ciel
     et sol, une ligne de sol où tout ce qui est debout pose les pieds, arbres et décors derrière,
     personnages devant, le premier plan (herbe, prairies) couché sur le bord bas, le sous-sol et les
     pages de terre enfoncés dans le bord bas ; tous les sujets entrent, en rangées serrées entre
     horizon et sol quand la largeur manque ; en format automatique, la toile grandit (même
     proportion, jusqu'à 2,2 fois) pour que le sol tienne en deux rangées ; sans Claude, la pose et
     la forme servent, tout se tenant au sol sauf les nuages ; choisir la Scène déclenche le regard
     de Claude sur chaque élément découpé pas encore vu, puis Claude compose lui-même la scène : il
     reçoit chaque élément avec sa taille réelle et la toile en cm, et rend la position, l'inclinaison
     et le plan de chacun, avec un titre, comme une illustration de livre pour enfants, d'après un
     croquis de la toile (ciel, horizon, ligne de sol, premier plan) et en gardant 10 à 18 éléments ;
     l'app vérifie ensuite que les pieds restent sur le sol et que seul ce qui vole est au ciel ; cette
     mise en place est gardée jusqu'au prochain import ou aux « nouvelles propositions ») ;
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
Réglages GitHub nécessaires une fois : Settings → Pages → Source « GitHub Actions », et la
branche de l'application autorisée dans l'environnement github-pages (« Deployment branches » sans
restriction) ; sinon chaque exécution échoue en quelques secondes, sans journal.

Sans la fenêtre Claude, la direction artistique par Claude n'est pas disponible : l'application
compose avec ses règles intégrées.
