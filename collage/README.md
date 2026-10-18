# Atelier Gribouille

Application web qui transforme des dessins d'enfants scannés en une œuvre d'art façon collage
(pages peintes en fond, sujets découpés « aux ciseaux » disposés par-dessus).

## Utilisation

Tout se passe dans le navigateur, aucune image n'est envoyée sur internet.

```sh
cd collage && python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

0. **Choisir l'atelier** : deux ateliers dans la même page (`state.mode`, mémorisé dans le navigateur,
   `?mode=impression` ou `?mode=toile` depuis l'accueil et la page Tarifs, cartes de choix dans
   l'atelier vide, bascule en haut de la colonne à tout moment, mode gardé avec chaque sauvegarde).
   - **Tableau imprimé à partir de vos photos** (atelier « impression » dans le code : `mode=impression` ; le produit s'appelle « tableau imprimé ») : l'œuvre est composée à la taille exacte d'un **cadre standard du marché**
     (`FRAMES` : 18 × 24 à 70 × 100, A4, A3, carrés 30 à 50 ; seule liste proposée), les dessins
     réduits d'un même facteur pour y tenir (`scale()` = `state.printScale`, `computePrintScale`) qui
     **suit le curseur de densité** : les sujets retenus (les plus forts d'abord, autant que le
     curseur en demande, comme à la pose) doivent couvrir la part de l'affiche que le curseur fixe,
     si bien que le nombre de dessins posés grandit pas à pas avec le curseur (plus on en demande,
     plus ils sont réduits) ; le curseur fixe le nombre de sujets (`printCount` : de 12 % des
     sujets en bas à tous en haut, lentement d'abord, pour garder de grands dessins) et la surface
     qu'ils demandent ensemble (`printCover` : de 90 % à 140 % de l'affiche, ils se chevauchent et
     la remplissent à toute position du curseur) ; la pose reçoit ce nombre (`o.count`) sans
     plafond de couverture ; jamais au-delà de leur taille réelle. Après la pose : en Nuage et en Paysage sans page de fond, les dessins se partagent toute la
     surface (`relaxItems`, relaxation de Lloyd pondérée par leur taille) ; puis, sauf Galerie,
     Cabinet, Frise et Scène, l'ensemble est agrandi tant qu'il tient (au plus 1,6 fois, jamais
     au-delà de la taille réelle des dessins) et ses positions étirées jusqu'aux bords (`fillFrame`). Dessins réduits
     à moins de 60 % (`o.spread`) : Paysage abandonne les zones ciel / milieu / sol et la ligne
     de sol, les sujets se répartissent sur toute l'affiche, bien espacés. Les pages de fond ont
     leur propre réduction (`state.bgScale`, `computeBgScale`) : elles couvrent l'affiche en se
     chevauchant, la plus grande entière, sans dépasser deux fois l'échelle des découpes.
     Produits : impression livrée (papier d'art, encadrée, toile imprimée) et fichier HD ; pas de
     guide de création ; finition toile cachée. Le **fond est toujours un aplat de couleur,
     parfaitement uni** (`o.flat` : ni coups de brosse ni grain de toile, `comp.paint = false`), pas de
     toile nue (la teinte conseillée s'applique d'office), blanc fixe en Galerie. Par-dessus, les
     **pages très colorées peintes en larges étendues** (paysage, ciel, mer : plus de 55 % de la
     feuille peinte, couleur franche, larges aplats calmes, ou rôle « fond » donné par Claude) se
     collent en fond d'office, toutes (`printBg` dans `planCoverage`) ; les autres pages sont des
     découpes ; le rôle « fond » se choisit aussi à la main. Chaque pièce posée s'agrandit ou se réduit à la
     main (poignée carrée au coin haut droit, boutons Agrandir / Réduire de 10 %, touches + et −),
     comme en Galerie ; `L.scale` est gardé avec la mise en place.
   - **Collage avec les dessins originaux** (atelier « toile » dans le code : `mode=toile`) : les dessins à leur **taille réelle** (échelle 1) sur un **châssis entoilé vendu chez
     Cultura** (`CULTURA` : châssis coton économiques, Monali 3D 40 mm, Monali classiques F / P / M et
     carrés ; seule liste proposée), pour réaliser l'œuvre avec les originaux : guide DIY, kit DIY, ou
     **Atelier Signature** (collage fait à la main par l'atelier : 490 € jusqu'à 75 cm, 690 € au-delà).
     La toile est **conseillée d'office** (`pickCanvas`) : chaque toile Cultura est jugée sur le fond
     (les pages colorées la couvrent avec un franc chevauchement, sans manquer de papier), l'air laissé
     aux découpes (curseur), sa proportion (classique en tête, bande en dernier), sa taille par rapport
     à la surface idéale à taille réelle et sa gamme ; les styles qui ont leur propre format (Frise,
     Galerie, Nuage, Scène) prennent la toile Cultura la plus proche du leur (`nearestCultura`), et la
     liste suit la proposition affichée. Dès que le client choisit une toile dans la liste
     (`state.formatManual`), son choix est gardé pour toutes les propositions, jusqu'à une nouvelle
     œuvre ou un changement d'atelier ; une composition rouverte garde sa toile.
1. **Compte requis pour importer** (quand les comptes sont actifs, `config.js`) : sans être
   connecté, on peut voir et manipuler l'exemple (« Voir un exemple », `?exemple`) ; importer ses
   propres dessins (zone d'import, glisser-déposer, prise de photo) ouvre la fenêtre de connexion
   ou d'inscription (`importLocked`, `requireAccount`), puis l'import demandé reprend de lui-même
   une fois connecté. Une phrase sous la zone d'import le dit aux visiteurs non connectés.
1. **Importer** les scans : PDF multipages, JPG ou PNG (glisser-déposer), ou **photographier les
   dessins depuis l'atelier** (`js/camera.js`, bouton « Photographier un dessin », quand le
   navigateur donne accès à l'appareil photo) : pendant la visée, chaque image est jugée et l'écran
   dit si la photo sera bonne — feuille trouvée (`Extract.findSheet`) et bien cadrée (assez grande,
   sans toucher le bord), téléphone parallèle à la feuille (côtés opposés de même longueur, angles
   droits), netteté et lumière égale (`Quality.sharpness`, `Quality.lighting`, mêmes seuils qu'à
   l'import), exposition (papier assez clair, sans reflets) ; le quadrilatère de la feuille est
   tracé sur la vidéo, vert, orange ou rouge. La photo prise (pleine définition : `ImageCapture`
   quand il existe, sinon l'image de la vidéo) est jugée de la même façon, avec en plus sa
   définition (grand côté de la feuille en pixels : 140 dpi pour un A4), puis gardée ou reprise ;
   les photos gardées entrent dans l'atelier comme des fichiers importés. Rien ne quitte l'appareil.
2. **Dessins** : chaque page est classée automatiquement
   - *fond* : page entièrement peinte → papier collé en arrière-plan ;
   - *découpe* : dessin sur papier → sujets détourés avec une marge de papier blanc, **comme aux
     ciseaux** : les traits distants de moins de ≈ 6 % de la page font un même sujet, un contour
     ouvert est contourné sans entrer dans chaque creux, puis la coupe suit le dessin à ≈ 3 mm, avec
     un contour **lisse** : les petites dents et encoches (≈ 2 mm) sont gommées et les angles
     arrondis, sans jamais entamer l'encre (≈ 1 mm de papier garanti autour d'elle). Un dessin
     qui **sort de la feuille** n'est plus coupé net le long du bord de la page : chaque tronçon où
     la découpe touche le bord devient un dôme (demi-ellipse qui touche le bord en son milieu,
     profondeur 35 % de sa longueur, au plus ≈ 4 % du grand côté ; tronçons à moins de ≈ 6 mm
     fusionnés), et les fines pointes restées au ras du bord sont retirées (`roundPageEdges`).
     Une page couverte de peinture (la découpe principale engloberait plus de la moitié de la page,
     moins de la moitié de papier visible) est un fond, pas une découpe géante aux bords déchiquetés ;
     une feuille au **fond majoritairement blanc** est toujours une découpe (ses personnages et ses
     objets sont posés sur l'œuvre), jamais une page de fond, sauf rôle choisi à la main. Une page
     « pontée » (lignes d'écriture, carreaux ou cadre dessiné reliés par la fermeture, intérieur
     bouché) est refermée de moins loin, sans boucher les grands trous : les sujets se séparent.
     Photographiée sur un mur ou une table de la couleur du papier (surface claire sans papier
     distinct), la feuille est traitée comme un scan : le retrait de surface ne garderait que l'encre
     et perdrait un short noir, donc les jambes (`removeSurface`, porte `feuille≈surface`). Les seuils
     d'encre s'adaptent au dessin : sur un scan propre un crayon pâle reste séparé du grain du
     papier, et si la première passe ne trouve que des miettes éparses, une seconde passe à seuils
     plus bas relie les traits de plus loin. Les toutes petites pièces ternes (ombre d'un pli, bord
     de feuille) sont écartées.
     **Découpe apprise des retouches** (`Extract.learnCut`) : chaque retouche de découpe faite à la
     main est comparée à la découpe automatique de la même pièce ; la marge de papier gardée autour
     de l'encre (mesurée sur le contour retouché), la sensibilité aux traits pâles (zones restaurées
     pleines d'encre faible : plus sensible ; zones effacées pleines de traces grises : moins) et
     les traits reliés (un sujet voisin effacé, coloré : rayon de fermeture réduit) en sont déduits.
     Ces préférences servent aux analyses suivantes, sont mémorisées dans le navigateur
     (`atelier.decoupe`), affichées dans la section Dessins (« Découpe apprise de vos retouches »,
     avec « Revenir à la découpe d'office ») et proposées tout de suite aux autres dessins du lot
     (« Appliquer aux N autres dessins », qui refait leurs découpes puis les propositions ; les
     dessins déjà retouchés et les objets détourés sont gardés tels quels). Les préférences sont
     figées sur chaque dessin au moment de son analyse et sauvegardées avec lui : ses réanalyses
     (haute définition, orientation, « découpe automatique » dans la retouche, réouverture d'une
     œuvre) retrouvent exactement les mêmes pièces, et les retouches y sont rejouées au bon rang.
     **Retouches partagées** (`js/collect.js`, option à l'import, décochée par défaut) : chaque
     retouche est aussi envoyée (dessin recadré, découpe automatique, découpe corrigée, fiche JSON)
     dans le bucket et la table `retouches` de Supabase, en écriture seule, sans nom de fichier ni
     identifiant (voir docs/COMPTES.md). **Apprentissage global** (`tools/apprendre.js`, workflow
     « Apprentissage de la découpe », chaque semaine) : ces exemples servent à rejouer la découpe
     de l'atelier avec différents réglages et à retenir ceux qui rapprochent le plus les découpes
     automatiques des découpes corrigées (IoU moyen, descente par coordonnées, validation croisée) ;
     les réglages retenus deviennent les réglages d'office de tous les utilisateurs
     (`js/cut-learned.js`, chargé avant `extract.js`), à partir de 20 exemples et si le gain se
     confirme ; rapport dans `docs/APPRENTISSAGE.md`. Étape suivante, à quelques centaines
     d'exemples : un petit modèle de segmentation embarqué.
   Avant la découpe, l'**éclairage est égalisé** (`Extract.flatten`) : la couleur du papier est
   estimée case par case (1/100 de la page), les ombres d'un pli ou d'un bord sont ramenées au blanc
   et ne sont plus prises pour du dessin. Une case n'est retenue comme papier que si elle est lisse,
   pas trop sombre (≥ 62 % du papier voisin) et si sa teinte suit son assombrissement (une ombre fonce
   et se réchauffe ; une feutrine bleue, un lavis gris foncé ou un aplat pâle ne sont pas du papier) ;
   rien n'est corrigé sur une page sans papier blanc visible (≥ 30 % des cases). Un gris neutre resté
   à moins de 30 du papier n'est pas un trait (les traits de couleur pâle gardent leurs seuils).
   Un clic sur un dessin ouvre son détail : rôle (découpe / fond / ignoré), **orientation** de la feuille
   (automatique, droite, couchée à droite, tête en bas, couchée à gauche ; en automatique, une page de
   fond trop haute pour la toile est couchée), **luminosité, contraste et saturation** (−50 à +50,
   réglés dans la fenêtre de retouche pour une découpe, dans la fiche pour une page de fond ;
   appliqués à l'œuvre, aux vignettes et à l'export ; mémorisés par dessin, « Rétablir » revient au
   scan). **« Ajuster automatiquement »** les règle d'après les pixels réellement collés :
   papier éclairci jusqu'au blanc (s'il y en a assez de visible, jamais assombri), traits pâles foncés
   d'un tiers, couleurs ternes ravivées (jamais sur le crayon gris, avec retenue si le papier a une
   teinte) ; voir `Compose.autoTone`
   et **taille réelle** de la feuille
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
     réellement vendues, à partir de l'A4 : les toiles courantes des grandes surfaces et du web
     (24 × 30, 30 × 40, 40 × 40, 40 × 50, 50 × 50, 50 × 70, 60 × 60, 60 × 80, 80 × 80, 70 × 100,
     100 × 50, 100 × 100, 80 × 120, 120 × 40, 90 × 120), les cadres IKEA aux formats photo standard
     (21 × 30, 30 × 40, 40 × 50, 50 × 50, 50 × 70, 61 × 91, 70 × 100, taille de la vitre sans
     passe-partout ; l'œuvre se fait alors sur un carton à cette taille) et les formats beaux-arts
     normalisés Figure / Paysage / Marine (20F 73 × 60 … 120F 195 × 130). On peut imposer l'une
     d'elles : l'application dit alors si le papier suffit ;
   - chaque page de fond est utilisée UNE SEULE FOIS et EN ENTIER, **sans être découpée** : la feuille
     est collée telle quelle, les pages se chevauchent et ce qui dépasse de la toile se rogne à la pose ;
     seule une page plus grande que la toile est réduite, et son surplus déchiré en lambeaux ;
   - **le style de l'œuvre de référence** : le fond n'est fait que de pages franchement peintes
     (plus de la moitié de la feuille couverte) ; une feuille au fond blanc, même avec un grand
     dessin coloré, est découpée, jamais collée entière derrière ; les feuilles pâles (crayon gris,
     texte) sont mises de côté par défaut, sauf celles où Claude reconnaît un vrai sujet (nuage,
     bonhomme au crayon), découpées comme les autres ; en montant le curseur elles entrent, découpées
     (les pages d'écriture seule, aux lignes de texte régulières, restant de côté) ; un réglage
     permet de toutes les découper ou de les coller en fond (c'est
     alors signalé dans le panneau, sur le cartel et sur la couverture du guide) ou de les coller en
     fond ; les pages de fond restent entières ;
   - **œuvre en cours** gardée d'elle-même dans le navigateur (dessins, réglages, mise en place) et
     **rouverte automatiquement** quand on actualise ou rouvre la page ; « commencez une nouvelle
     œuvre » l'efface. Chaque dessin est relu à la résolution de travail qu'il avait (elle dépend du
     nombre de dessins importés d'un coup), pour retrouver exactement la même page ; une retouche
     dont la page ne correspond plus (proportions, empreinte 16 × 16) n'est pas rejouée — la
     découpe automatique est gardée et c'est signalé ;
   - un fichier **déjà importé** (même contenu, même renommé « … 2.JPG ») n'est pas ajouté une
     deuxième fois ;
   - **panier** : un CTA « Commander » bien en vue (sous la barre d'outils sur ordinateur, dans
     l'en-tête sur téléphone, avec le compteur) ouvre le panier s'il contient des articles, sinon le
     choix du produit pour la composition affichée ; chaque proposition (bouton sur sa vignette) ou
     la composition en cours (étape Exporter) s'ajoute au panier avec le produit choisi, au catalogue de la page Tarifs, selon
     l'atelier : impression (fichier HD 14,90 €, impression papier / encadrée / toile en 30 × 40,
     50 × 70 ou 70 × 100, 39 à 199 €) ou toile (guide DIY 24,90 €, kit DIY 50 × 70 89 €, Atelier
     Signature 490 ou 690 €), et la quantité. La composition y est figée telle
     quelle (mise en place, retouches, réglages) dans IndexedDB, ses images partagées avec le
     brouillon ; la liste est dans localStorage et survit au rechargement. Le panier (bouton en haut,
     avec le nombre d'articles) permet de changer les quantités, de retirer un article, de « Revoir »
     une composition dans l'atelier ; « Commander » (compte demandé) enregistre chaque composition
     dans le compte sous la référence de la commande (AG-AAMMJJ-XXXX), garde la commande dans
     l'historique local et ouvre le message de commande (bonjour@atelier-gribouille.com) avec le
     récapitulatif. Le paiement en ligne n'est pas encore branché ;
   - **compositions sauvegardées** (section « Mes compositions ») : « Sauvegarder cette composition »
     enregistre dans le navigateur (IndexedDB) les dessins (images d'origine), leurs réglages (rôle,
     taille, orientation, luminosité, contraste et saturation, photo sur un sol, sujets gardés), la
     **découpe telle quelle** de chaque dessin (sa page de travail en JPEG et le masque de chaque pièce,
     retouches comprises, rangés dans une planche PNG : `savedOf`) et la mise en place exacte (chaque
     pièce et page, position, rotation, échelle, cadres, fond) ; la liste permet de rouvrir une
     composition telle quelle, sans nouvelle analyse, ou de la supprimer ; une composition rouverte
     reste épinglée jusqu'à « nouvelles propositions » ou un changement de réglage. Les pièces
     rouvertes sont rebâties depuis la page et les masques sauvegardés (`restoreAnalysis`), jamais
     redécoupées : une découpe automatique améliorée entre-temps ne change pas une œuvre déjà faite
     (seule la haute définition à l'export réanalyse le fichier d'origine, et garde la version de
     travail si la page retrouvée diffère). Les sauvegardes d'avant (sans page ni masques, `v` absent)
     sont relues avec la découpe automatique de l'époque, `js/extract-legacy.js`, chargé à la demande,
     et leurs retouches rejouées par rang de pièce ; une fois sauvegardées de nouveau, elles passent
     au format autonome ;
   - **feuille photographiée** (table, mur, nappe, bois) : la feuille est cherchée avant tout le
     reste (`Extract.findSheet`). Le papier est une plage claire et peu saturée bornée de tous côtés
     par un contour franc (le bord de la feuille et son ombre), même quand la surface a presque sa
     couleur (mur clair) : on remplit le papier depuis l'intérieur sans franchir les contours (trois
     tolérances de couleur, de la plus large à la plus stricte), on bouche les cases fermées par les
     traits, on ajuste un quadrilatère sur l'enveloppe convexe (meilleur quadrilatère parmi ses
     sommets, puis chaque bord réajusté par une droite robuste sur le contour voisin de
     l'enveloppe). Garde-fous : la surface, lue sur la bordure de la photo hors de la feuille, doit
     être bois ou peu saturée et d'une seule couleur (un cadre dessiné au crayon n'en est pas une),
     ne pas contenir de papier de la couleur de la feuille (une plage de ciel cernée d'arbres n'est
     pas une feuille), et chaque bord du quadrilatère doit être suivi par un contour franc ou par le
     bord de la plage. La feuille est alors **redressée** (perspective corrigée, homographie) et
     recadrée juste à l'intérieur de son bord ; ses bords redressés ne doivent pas montrer la
     surface. Une forme libre (feuille découpée, froissée) posée sur un bois devient un objet dont
     la silhouette entière est la pièce. Signalé sur la vignette (« redressé ») et dans la fiche,
     avec un bouton pour garder la photo entière ; une feuille redressée est ensuite traitée comme
     un scan (elle peut être un fond). Si aucune feuille n'est trouvée, la détection de surface
     ci-dessous prend le relais ;
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
     est alors retirée : le dessin est détouré en suivant sa forme, sur un fond blanc. Le bord de
     l'objet est repris à pleine résolution (≈ 1600 px) le long du contour, d'après les couleurs de
     l'objet et de la surface (apprise sur le pourtour de la photo), avec une extension mesurée aux
     parties de l'objet de la couleur du sol. Un **objet découpé** (forme libre : cœur, bougie,
     ovale…) devient lui-même la pièce, papier blanc compris ; une feuille rectangulaire garde son
     dessin à découper. C'est
     signalé sur la vignette (« détouré »), dans le panneau (avec un bouton pour garder la photo
     entière) et sur la fiche de découpe ; la détection tourne sur toutes les pages (un scan à plat a
     une bordure blanche et n'est pas concerné) ; si elle ne reconnaît pas la surface, le bouton
     « Retirer le fond autour du dessin » force le détourage d'après la couleur de bordure ;
   - **nombre de dessins** (curseur « Nombre de dessins » sous l'aperçu de l'œuvre, avec le compte des dessins utilisés) : le curseur
     règle le nombre de sujets posés, des plus forts aux plus faibles, de 20 % au minimum jusqu'à tous ;
   - **curseur au maximum** : tous les dessins chargés entrent dans l'œuvre — plus de plafond de
     couverture, un sujet sans place libre se pose au moins mauvais endroit, et les feuilles pâles
     sont découpées comme les autres ; la rotation des découpes est fixe (réglage retiré) ;
   - **résolution d'import** : chaque page est conservée à la plus haute résolution que l'appareil
     permet (de 1400 à 2800 px de grand côté, 2000 sur téléphone), calculée d'après le nombre de pages
     et la mémoire disponible ; l'analyse des sujets se fait sur une grille réduite, mais les découpes
     et les pages de fond gardent cette résolution à l'écran ;
   - **export haute définition (300 dpi par défaut, tous formats)** : au moment d'exporter, chaque
     dessin dont une découpe ou une page de fond serait agrandie est relu depuis son fichier d'origine
     (image telle quelle, ou page du PDF rendue à la résolution nécessaire, jusqu'à 6500 px de côté) et
     analysé de la même façon ; les découpes et pages ainsi obtenues remplacent les versions de travail
     le temps du rendu, puis sont libérées. La seule limite est le fichier d'origine : un scan à 300 dpi
     ou une photo de 12 Mpx donne du 300 dpi réel, un PDF compressé par l'application de scan non.
     Les sauvegardes gardent la source en haute définition (image d'origine, ou page de PDF à 3508 px),
     si bien qu'une composition rouverte s'exporte avec la même qualité. Sur ordinateur, l'image
     exportée peut atteindre 180 Mpx (130 × 90 cm à 300 dpi) ; sur téléphone, 12 Mpx (limite de Safari) ;
   - chaque dessin découpé apporte son sujet principal et tous ses autres éléments qui ressemblent
     à un sujet (au moins 3 cm, même peu colorés : nuages au crayon, petits personnages) ; Claude,
     s'il est disponible, regarde ensuite chaque élément un par un et écarte les fragments (taches,
     bords de feuille, texte seul) ; le contour de chaque découpe est calculé en haute résolution
     (à la résolution de la page, jusqu'à 3000 px de côté) avec un seuil d'encre à deux niveaux : les zones pâles (crayon léger,
     couleurs claires, dégradés) reliées à un trait net restent dans le dessin, le grain du papier non ;
     la coupe suit le dessin à quelques millimètres (≈ 3 mm sur un A4)
     (≈ 0,6 cm) qui les fait ressortir comme des autocollants ; elles couvrent au plus ~45 % de la toile
     et n'empilent jamais : les sujets sans place restent en attente (pointillés dans la liste) ;
   - **composition « Galerie »** : grille de cases carrées toujours complète (jamais une dernière rangée
     moins remplie : le nombre de cases est ramené à la grille complète la plus proche des proportions
     de la toile), un dessin par case réduit s'il le faut, jamais agrandi ; en « taille adaptée aux
     dessins », la toile est dimensionnée pour la grille elle-même (cases au 75e centile des tailles,
     grand côté plafonné à 130 cm) et non pour les pages de fond ;
   - **composition « Paysage »** : les pages de fond sont réparties en trois bandes selon leur valeur et
     leur couleur (claires et froides en haut, sombres et chaudes en bas), posées en tuiles presque
     droites qui se chevauchent, le sol par-dessus le milieu, le milieu par-dessus le ciel ; les éventuels lambeaux
     restent dans la bande de leur page ;
   - **export PDF à l'échelle** : une page de la taille exacte de la toile (1 cm = 1 cm), chaque page
     de fond posée tournée comme une image JPEG, les découpes et papiers déchirés en PNG avec leur
     transparence, les cadres de la galerie, le plomb et les traits en vecteurs ; images à 300 dpi
     au plus. Les scans restent des images : un dessin d'enfant ne se vectorise pas sans le trahir ;
   - **mode « Fond seul »** (bouton près du zoom) : on ne voit que le fond peint et les pages de fond,
     que l'on déplace, tourne, met devant ou derrière, retourne ou retire à sa guise ; « Tout voir »
     ramène les découpes. Les pages restent entières et ne servent qu'une fois (pas de duplication) ;
   - **mise en scène** (sur ordinateur, fenêtre ouverte par le bouton « Mettre en scène » de la zone
     d'édition, avec le choix de la pièce, de la taille et de l'orientation de l'œuvre, du passe-partout et le
     téléchargement ; sur téléphone, dans la section Tailles, sous le titre « Mise en scène ») : trois pièces au choix
     (mémorisé) : le salon, une chambre d'enfant ou une entrée au mur vert sauge (photo `assets/hall.webp`,
     console d'environ 190 × 75 cm et lampe de 45 cm, soit 4,8 px par cm, carte de lumière
     `assets/hall-lumiere.webp`) ; la chambre (photo de face `assets/chambre.webp`, échelle estimée
     d'après le mobilier : étagère basse de 55 cm, paniers de 33 cm, lampe et ours de 30 cm, soit 3,1 px
     par cm sur le mur ; l'œuvre est accrochée au-dessus de l'étagère, sous la suspension, avec la carte
     de lumière `assets/chambre-lumiere.webp`). Dans le salon, l'œuvre active est accrochée dans un
     salon (photo de face `assets/salon.webp`), à sa taille réelle au-dessus d'un buffet : toile pour un
     collage avec les originaux, tableau encadré pour une impression (baguette fine et plate, comme un
     cadre du commerce : 1,5 cm, 0,9 cm pour le métal ; passe-partout blanc chaud à biseau blanc ;
     pas de reflet). Le cadre (bois clair, bois foncé,
     bois noir, bois blanc ou métal) se choisit dans un nuancier ; en « Auto » (par défaut, mémorisé),
     il est assorti aux couleurs de l'œuvre : sombre → bois blanc (bois noir avec passe-partout),
     dominante froide → métal, claire → bois foncé, sinon bois clair. Un choix « Sans /
     Avec passe-partout » (mémorisé) agrandit le cadre au plus petit format standard qui laisse 4 cm
     de marge autour de l'œuvre, avec des marges proches sur les côtés et en haut et en bas (une œuvre
     carrée garde un cadre carré) ; cadre sur mesure, 6 cm de marge, quand aucun format ne convient. « Télécharger la mise en scène » enregistre l'image en
     JPEG (2000 × 1500 px).
     L'échelle est estimée d'après les meubles (buffet d'environ 2,30 m × 46 cm, lampe de 45 cm, vase
     de 38 cm) : 3,9 px par cm sur le plan du mur. L'œuvre est centrée à 130 cm du sol, au moins 20 cm
     au-dessus du buffet et au-dessus de la lampe ou du vase quand elle s'étend jusqu'à eux ; le
     cadrage s'élargit avec sa taille. La plante détourée (`assets/salon-plante.webp`) passe devant
     l'œuvre, et la lumière du mur (`assets/salon-lumiere.webp`, soleil et ombres des feuilles) se pose
     sur elle ;
   - **rendu à plat** : aucune ombre portée sur les papiers ni sur les découpes, comme un collage vu de face ;
   - **placement des sujets** : carte de charge visuelle du fond (les sujets cherchent une zone calme et
     un contraste clair / foncé), respiration autour des pièces maîtresses, petits éléments groupés en
     constellations près d'une grande pièce, rotation retenue ;
   - **direction artistique par Claude** (page publiée) : Claude regarde tous les dessins, reconnaît
     chacun, choisit fond ou découpe, zone (ciel / milieu / sol), pièces maîtresses, et propose un
     titre affiché sous l'œuvre. Sans Claude, des règles intégrées prennent le relais ;
   - **l'œuvre en cours suit le compte** : connecté, le brouillon est aussi envoyé dans le compte
     (`Account.cloud.draftPut`, une quinzaine de secondes après le dernier changement, ou dès que la
     page passe en arrière-plan) : une ligne `compositions` marquée `draft` (une seule par compte,
     remplacée à chaque envoi, absente de la liste des compositions) et un dossier fixe
     `<utilisateur>/brouillon/` où chaque image (et chaque planche de découpes) n'est envoyée qu'une
     fois, nommée d'après sa clé de brouillon ; les fichiers qui ne servent plus sont effacés. À
     l'arrivée, connecté (`checkCloudDraft`) : sans œuvre en cours dans ce navigateur, ou si elle est
     plus ancienne et déjà envoyée, l'œuvre du compte se rouvre d'elle-même ; si l'œuvre d'ici est
     plus récente elle reste ; si elle n'a jamais été envoyée (faite sans compte), celle du compte
     est seulement proposée (« Reprendre »). « Oublier cette œuvre » l'efface des deux côtés ;
   - **couleur du fond à portée de main** : une pastille de la couleur actuelle, en tête de la barre
     d'outils près de l'œuvre (à droite sur téléphone, en bas sur ordinateur), ouvre la palette juste
     à côté (`#ground-pop`) ; une teinte s'applique tout de suite, la palette reste ouverte pour en
     essayer d'autres et se ferme d'un appui ailleurs ou avec Échap ; elle reste synchronisée avec
     le nuancier des réglages avancés ; sans objet en Galerie (fond blanc fixe) ;
   - **fond de toile** : au choix, la toile nue (lin) ou un aplat d'acrylique dans les teintes
     classiques du commerce (blanc de titane, jaune de Naples, ocre, cadmiums, terres, verts, bleus,
     violet, gris de Payne, noir de Mars) ; il couvre toute la toile et permet une œuvre aérée quand
     il n'y a pas assez de dessins ; par défaut, l'app conseille pour chaque proposition la teinte
     qui fait le mieux ressortir l'œuvre (`pickGround`) : la palette de chaque pièce et de chaque
     page de fond est lue (`paletteOf` : clarté de ce qu'on voit papier compris, clarté et
     saturation de l'encre, teintes de l'encre en douze secteurs) et chaque teinte du nuancier est
     notée — contraste de clarté avec les dessins (et un peu avec leur encre), pas de confusion
     avec une couleur très présente à clarté voisine, bonus pour la complémentaire des dominantes,
     fond peu saturé sous des dessins très colorés et teinte moyenne chaude sous des dessins pâles,
     teintes calmes favorisées ; la Galerie fait exception : fond blanc fixe, sans couleur ni
     effet peinture ni finition toile ; l'aplat est rendu avec un vrai effet de peinture (coups de brosse en deux couches,
     traces des poils, couche inégale), à l'écran, dans les exports et dans le PDF ; le guide indique
     la couleur à peindre ; **toute nouvelle création part en couleur automatique** (conseillée
     selon la composition), une œuvre rouverte (brouillon, composition sauvegardée) reprend la sienne ;
   - **orientation de la toile au choix**, paysage ou portrait, pour la taille automatique comme pour
     les toiles du commerce (un 30P devient 65 × 92 cm en portrait) ; le choix est mémorisé ;
   - **sept propositions, sept styles** (Paysage sélectionné par défaut), à chaque fois :
     *Paysage* (ciel, milieu, sol, comme une grande toile de famille),
     *Tournesol* (tout tourne en spirale d'or autour des pièces maîtresses, au centre),
     *Courtepointe* (un patchwork : les pages de fond posées bord à bord, presque droites, en
     alternant claires et foncées comme un damier cousu ; une découpe posée en médaillon au centre
     de chaque carreau, les plus grandes sur les plus grands carreaux, les suivantes là où les pages
     ne couvrent pas la toile ; sans page de fond — atelier Impression, ou que des découpes — les
     découpes elles-mêmes font les carreaux : rangées pleine largeur, chaque pièce ajustée à sa
     rangée sans jamais être agrandie, le nombre de rangées choisi pour remplir la hauteur),
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
4. **Exporter** en JPEG ou PNG, à 300 dpi par défaut pour l'impression sur toile.

Des dessins d'exemple peuvent être proposés sans être chargés d'office : s'ils sont fournis avec la
page ou présents dans `samples/manifest.json` (`{ "base": "samples/", "pages": [{ "file", "name",
"sizeCm"? }] }`) à côté de l'app, un bouton « Essayer avec les dessins d'exemple » apparaît sous la
zone d'import et dans l'écran d'accueil ; sans ce dossier, rien n'est proposé. Le dossier `samples/` du
dépôt contient un jeu de 19 dessins de synthèse (14 sujets au feutre et au crayon, 5 pages peintes),
générés par `samples/make_samples.py` : aucun auteur, aucune donnée personnelle, aucun dessin d'enfant réel.

**Comptes utilisateurs** (optionnels) : inscription et connexion par Google ou e-mail (mot de
passe, ou lien de connexion sans mot de passe), gestion du compte (nom affiché, e-mail, mot de passe,
déconnexion, suppression définitive en deux clics, lien « mot de passe oublié »). Quand les comptes
sont actifs, télécharger une œuvre, créer le guide et sauvegarder une composition demandent d'être
connecté (la fenêtre de connexion s'ouvre et l'action reprend d'elle-même après la connexion) ; les
compositions sont sauvegardées dans le compte, avec les images des dessins en haute définition et
les retouches, et chaque export (JPEG, PNG, PDF, guide) y est gardé aussi, listé sous « Mes exports »
avec retéléchargement et suppression. Tout se retrouve depuis n'importe quel appareil. Le service est Supabase (Auth + Storage,
hébergement en Europe), piloté depuis `js/account.js` ; les règles d'accès (`supabase/schema.sql`)
limitent chaque compte à ses propres lignes et fichiers, et la fonction `delete_account` permet à
l'utilisateur d'effacer lui-même tout son compte. Sans réglage dans `config.js`, rien n'apparaît et
l'app fonctionne comme avant. Mise en place pas à pas dans `docs/COMPTES.md` ; page de
confidentialité à relire dans `confidentialite.html`.

Le parcours simple tient en trois étapes (importer, choisir une proposition, télécharger) : les
réglages de composition (orientation, toile, fond, feuilles pâles) sont repliés sous « Réglages
avancés », le guide de création replié sous l'étape Exporter (qualité et type de fichier restent
visibles au-dessus du bouton de téléchargement), et les sections
Dessins est repliée à la première visite ; sur ordinateur, Importer se replie une fois ses propres dessins
importés (et se rouvre pour une nouvelle œuvre) (le choix de chacun est mémorisé).
**Voir l'œuvre de près** : pincement à deux doigts, molette (sans pièce sélectionnée) ou pincement du
   pavé tactile, double-tap sur une zone vide, boutons − / + / ajuster ; glisser une zone vide pour se
   déplacer ; bouton plein écran, pratique sur téléphone.
5. **Retoucher une découpe** : bouton « Retoucher » (ou double-clic sur une pièce de l'œuvre, ou ciseaux
   sur la vignette d'une pièce). Éditeur plein écran avec zoom (molette, pincement, + / −), gomme,
   pinceau « restaurer » qui remet le dessin d'origine (y compris autour de la découpe initiale),
   **baguette magique** (W) réglable en sensibilité : elle sélectionne la zone d'un seul tenant de
   couleur proche du point touché (voile bleu, contour sombre ; la sensibilité la recalcule en direct,
   « ＋ Ajouter » ou Maj + clic ajoute d'autres zones), puis « Gommer » (élargi d'un pixel, sans
   liseré ; touche Suppr) ou « Restaurer » l'applique à la découpe, « × » ou Échap désélectionne ;
   sur téléphone elle sélectionne au relâché d'un toucher immobile,
   défaire / refaire (Ctrl+Z), « Découpe automatique » (revient à la découpe faite par l'atelier), et panneau **« Lumière et couleurs »**
   (luminosité, contraste, saturation, ajustement automatique) avec aperçu direct. Le trait de coupe
   magenta est affiché en direct ; en validant, la pièce est mise à jour dans les trois propositions
   sans bouger sur la toile, et le réglage de lumière s'applique à tout le dessin (« Fermer sans
   enregistrer » l'oublie).
   Une pièce **dupliquée** sur l'œuvre est une copie indépendante : retoucher sa découpe ne touche ni
   l'originale ni les autres copies (la découpe de la copie est sauvegardée et rejouée à la réouverture).
6. **Guide de création (PDF)** pour réaliser l'œuvre avec les originaux :
   - couverture (taille de la toile, matériel, mode d'emploi), **plan de pose** quadrillé tous les 10 cm
     avec le numéro de chaque élément ;
   - **étapes de collage** dans l'ordre (lambeaux de fond, grandes pages, puis découpes) : mini-carte
     de l'œuvre avec l'élément en couleur, case de la grille, position du centre en cm, rotation ;
   - **fiches de découpe**, une par dessin original : le scan avec ses traits de coupe magenta
     numérotés, une règle en cm sur les bords et les cotes de chaque morceau (taille, distance aux
     bords), à reporter sur l'original avant de découper.

## Qualité pour l’impression (`js/quality.js`)

À l’import, chaque dessin est mesuré une fois, sans rien envoyer :

| Mesure | Comment | Alerte | Qualité insuffisante |
|---|---|---|---|
| Définition | pixels réels (pour un PDF, ceux de l’image qu’il contient) rapportés à la taille réelle | sous 140 dpi | sous 100 dpi |
| Compression | qualité JPEG estimée d’après les tables de quantification du fichier | sous 60 | sous 40 |
| Netteté | sur les bords les plus marqués, pente du contraste rapportée à son amplitude | sous 0,30 | sous 0,26 |
| Éclairage | pente de luminosité du papier d’un coin à l’autre, si elle est régulière (ombre, lampe) | au-dessus de 45 | au-dessus de 85 |

Seuils réglés sur de vrais scans de dessins (aucune alerte de netteté ni d’éclairage) et sur
leurs versions floues ou assombries. La définition suit la taille réelle choisie : la même image
peut suffire en A6 et pas en A3. Affichage : pastille sur la vignette, raison et conseil dans la
fiche du dessin, bandeau « N dessins risquent d’être flous » dans Propositions, rappel dans
Exporter. Rien n’est jamais bloqué.

## Fonctionnement

- `js/extract.js` : estimation de la couleur du papier sur les bords, recadrage sur la feuille quand le scan
  a des marges, détection des traits, dilatation + remplissage des trous (forme « ciseaux »),
  composantes connexes → pièces, blanchiment du papier et ravivage des couleurs.
- `js/compose.js` : tout est exprimé en centimètres sur la toile ; fond peint procédural, pages collées
  (recadrées, jamais agrandies), placement des découpes par score de composition, rendu et finition.
- `js/app.js` : interface, édition interactive, export haute résolution ; un capteur d'erreur global
  affiche toute erreur imprévue en haut de la page, avec son détail à copier pour la signaler.
- `tests/` : suite Playwright sur des images de synthèse (voir `tests/README.md`), lancée par
  `npm test` et, à chaque push, par le workflow `.github/workflows/tests.yml`.
- `js/i18n.js` : deux langues. Le français est la source (textes écrits en français dans `index.html`
  et dans les modules, via `tr('…')` ou tr`… ${valeur}`) ; le dictionnaire anglais est dans ce fichier.
  Langue choisie par `?lang=fr|en` (mémorisé), sinon le choix mémorisé, sinon celle du navigateur ;
  sélecteur FR / EN sous le logo. `node tests/i18n-check.js` vérifie qu'aucun texte n'est sans traduction.
- `js/analytics.js` : mesure d'audience sans cookies (Umami Cloud, gratuit), activée par `analytics` dans
  `config.js` ; quelques compteurs d'usage via `Atelier.track`. Voir `docs/ANALYTIQUE.md`.
- `js/editor.js` : éditeur de découpe (masque en pixels de la page, historique, zoom tactile).
- `js/guide.js` : génération du guide de création (pages dessinées à 150 dpi, assemblées en PDF).
- `assets/` : éléments de la charte Atelier Gribouille (monogramme détouré, motif de crayons, pictogrammes).
  Palette : craie #F8F5EF, lin #DCCBB8, blush #D9A7A0, argile #C26F56, olive #6B6F4E ; typographies
  Playfair Display et Montserrat.
- `vendor/` : [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (Apache 2.0) pour lire les PDF,
  [jsPDF](https://github.com/parallax/jsPDF) 2.5 (MIT) pour écrire le guide. Chargés à la demande
  (premier PDF importé, premier PDF exporté) : la page s'ouvre sans ces 680 Ko.

### Performances

Les optimisations ne changent aucun pixel :
- analyse : les boucles par pixel (distance aux formes, composantes, égalisation de la lumière,
  détection de la surface) calculent les mêmes valeurs, sans tableau créé par pixel ni test de bord
  au milieu des lignes ; un centile est trouvé par sélection plutôt que par un tri complet. Contrôle :
  empreinte de chaque page et de chaque découpe sur un jeu de vrais scans, identique avant et après ;
- propositions : la texture du papier (toujours la même) est calculée une fois ;
- glissement d'une pièce : seul le rectangle qu'elle quitte et celui qu'elle occupe sont redessinés,
  avec les mêmes opérations découpées au rectangle (test : image identique à un rendu complet).

## Mise en ligne

L'application est un site statique (aucun serveur, les scans restent dans le navigateur). Le
workflow `.github/workflows/pages.yml` publie le dossier `collage/` sur GitHub Pages à chaque
push de la branche de l'application. Le site publié a deux parties : la page d'accueil (`landing/`,
présentation du concept, œuvres accrochées dans des salons illustrés, les sept styles) à la racine, et
l'application sous `/atelier/` (`?exemple` charge le jeu d'exemple d'office). Adresse :
https://ateliergribouille.art (domaine personnalisé
réglé dans Settings → Pages ; l'adresse https://adrienterras.github.io/Claudde/ y redirige). Le dossier
`coming-soon/` contient la page « Ouverture prochaine » autonome, à héberger ailleurs si besoin.
Réglages GitHub nécessaires une fois : Settings → Pages → Source « GitHub Actions », et la
branche de l'application autorisée dans l'environnement github-pages (« Deployment branches » sans
restriction) ; sinon chaque exécution échoue en quelques secondes, sans journal.

Sans la fenêtre Claude, la direction artistique par Claude n'est pas disponible : l'application
compose avec ses règles intégrées.
