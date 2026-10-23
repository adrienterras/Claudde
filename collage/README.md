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
   `?mode=impression` ou `?mode=toile` depuis l'accueil et la page Tarifs, sinon les deux cartes au
   milieu de l'atelier vide — à la première visite et après « Commencer une nouvelle œuvre », aucune
   carte présélectionnée (`emptyChoice(false)` retire la marque ; le dernier type reste le réglage
   interne jusqu'au clic) ; une carte choisie (ou `?mode=` depuis l'accueil), les cartes et
   « Voir un exemple » laissent la place aux boutons d'import au milieu (`#empty-import` : déposer ;
   photographier sur téléphone ; « Changer de type d'œuvre » ramène les cartes — `emptyChoice`),
   l'étape Importer du menu restant là pour ajouter des dessins ensuite ; une fois l'œuvre commencée,
   le type d'œuvre ne change plus ; mode gardé avec chaque sauvegarde et chaque brouillon).
   - **Création imprimée à partir de vos dessins** (atelier « impression » dans le code : `mode=impression` ; le produit s'appelle « tableau imprimé ») : l'œuvre est composée à la taille exacte de l'impression d'un des
     **cinq cadres du commerce** (`PRINT_FRAMES` : 21 × 30, 30 × 40, 40 × 50, 50 × 70, 70 × 100 ; seule liste
     proposée ; pour une nouvelle œuvre, le cadre suit le nombre de dessins à sa première composition :
     30 × 40 jusqu'à 4 dessins, 50 × 70 au-delà, puis il ne change plus de lui-même ; un ancien réglage est
     ramené au cadre le plus proche). Un choix « Sans /
     Avec passe-partout » à côté du cadre (mémorisé, repris par la mise en scène) fixe la taille
     d'impression : sans, elle remplit le cadre (A4 dans le 21 × 30) ; avec, elle prend la taille en
     dessous (13 × 18, A4, 30 × 40, 40 × 50, 50 × 70) et la composition est refaite à cette taille. Les dessins
     réduits d'un même facteur pour y tenir (`scale()` = `state.printScale`, `computePrintScale`) qui
     **suit le curseur de densité** : les sujets retenus (les plus forts d'abord, autant que le
     curseur en demande, comme à la pose) doivent couvrir la part de l'affiche que le curseur fixe,
     si bien que le nombre de dessins posés grandit pas à pas avec le curseur (plus on en demande,
     plus ils sont réduits) ; le curseur fixe le nombre de **dessins** sur l'œuvre (`printKeep`,
     linéaire et pages de fond comprises : à mi-course, la moitié des dessins, comme le dit
     « N sur M » ; en bas, les pages et une découpe ; en haut, tout — les découpes sont retenues dans
     l'ordre de la pose, les plus fortes d'abord, jusqu'au nombre de dessins voulu, un dessin
     pouvant avoir plusieurs découpes) et la surface
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
     Produits : impression livrée (papier d'art ou encadrée ; pas d'impression sur toile pour l'instant) et fichier HD ; pas de
     guide de création ; finition toile cachée. Le **fond est toujours un aplat de couleur,
     parfaitement uni** (`o.flat` : ni coups de brosse ni grain de toile, `comp.paint = false`), pas de
     toile nue (la teinte conseillée s'applique d'office) mais un choix « sans couleur » (fond blanc
     pur, `GROUND_WHITE`, proposé seulement dans cet atelier), blanc fixe en Galerie. Par-dessus, les
     **pages très colorées peintes en larges étendues** (paysage, ciel, mer : plus de 55 % de la
     feuille peinte, couleur franche, larges aplats calmes, ou rôle « fond » donné par Claude) se
     collent en fond d'office, toutes (`printBg` dans `planCoverage`) ; les autres pages sont des
     découpes ; le rôle « fond » se choisit aussi à la main. Chaque pièce posée s'agrandit ou se réduit à la
     main (poignée carrée au coin haut droit, touches + et − de 10 % ; plus de boutons Agrandir /
     Réduire dans la barre d'outils : on agrandit directement sur l'œuvre ; la barre se limite à
     Défaire, Refaire, Devant, Derrière, Retoucher et Retirer — plus de Miroir ni de Dupliquer, les
     copies et miroirs des œuvres déjà faites se gardent ; une petite poubelle au coin haut gauche du
     dessin sélectionné le retire de l'œuvre, comme Retirer ou Suppr — `trashHandlePos`),
     comme en Galerie ; `L.scale` est gardé avec la mise en place.
   - **Collage avec les dessins originaux** (atelier « toile » dans le code : `mode=toile`) : les dessins à leur **taille réelle** (échelle 1) sur un **châssis entoilé vendu chez
     Cultura** (`CULTURA` : châssis coton économiques, Monali 3D 40 mm, Monali classiques F / P / M et
     carrés ; seule liste proposée), pour réaliser l'œuvre soi-même avec les originaux : guide DIY ou
     kit DIY (l'offre « Atelier Signature », collage fait par l'atelier, a été retirée).
     La toile est **conseillée d'office** (`pickCanvas`) : chaque toile Cultura est jugée sur le fond
     (les pages colorées la couvrent avec un franc chevauchement, sans manquer de papier), l'air laissé
     aux découpes (curseur), sa proportion (classique en tête, bande en dernier), sa taille par rapport
     à la surface idéale à taille réelle et sa gamme ; les styles qui ont leur propre format (Frise,
     Galerie, Nuage, Scène) prennent la toile Cultura la plus proche du leur (`nearestCultura`), et la
     liste suit la proposition affichée. Dès que le client choisit une toile dans la liste
     (`state.formatManual`), son choix est gardé pour toutes les propositions, jusqu'à une nouvelle
     œuvre ou un changement d'atelier ; une composition rouverte garde sa toile.
1. **Compte requis pour photographier, pas pour importer** (quand les comptes sont actifs,
   `config.js`) : sans être connecté, on peut voir et manipuler l'exemple (« Voir un exemple »,
   `?exemple`) et importer ses propres dessins (zone d'import, glisser-déposer, sélecteur de
   fichiers) ; photographier depuis l'atelier, exporter ou commander ouvre la fenêtre
   de connexion ou d'inscription (`requireAccount`), puis l'action demandée reprend d'elle-même une
   fois connecté. Une phrase sous la zone d'import le dit aux visiteurs non connectés.
1. **Importer** les scans : PDF multipages, JPG ou PNG (glisser-déposer), ou **photographier les
   dessins depuis l'atelier** (`js/camera.js`, bouton « Photographier un dessin » au-dessus de la
   zone de dépôt, sur téléphone et tablette — largeur ≤ 860 px, ou tout écran tactile (`html.touch`,
   iPad en paysage compris : la visée y reste en plein écran) ; pas sur un ordinateur sans écran
   tactile — et quand le navigateur donne accès à l'appareil photo ; les conseils de prise de vue sont dans les questions fréquentes de l'accueil) : pendant la visée, chaque image est jugée et l'écran
   ne donne qu'**une consigne à la fois**, la plus importante (« Rapprochez-vous un peu », « Tenez le
   téléphone à plat, au-dessus du dessin »… ou « Prêt : prenez la photo ») — feuille trouvée (`Extract.findSheet`) et bien cadrée (assez grande,
   sans toucher le bord), téléphone parallèle à la feuille (côtés opposés de même longueur, angles
   droits), netteté et lumière égale (`Quality.sharpness`, `Quality.lighting`, mêmes seuils qu'à
   l'import), exposition (papier assez clair, sans reflets) ; le quadrilatère de la feuille est
   tracé sur la vidéo, vert, orange ou rouge. La photo prise (pleine définition : `ImageCapture`
   quand il existe, sinon l'image de la vidéo) est jugée de la même façon, avec en plus sa
   définition (grand côté de la feuille en pixels : 140 dpi pour un A4, `Camera.PX`) : bonne ou
   correcte, elle est **gardée d'office** (un éclair, « ✓ Photo gardée » avec « Annuler ») et la visée
   continue ; à reprendre, elle s'affiche avec sa raison et un conseil, « Reprendre » ou « Garder
   quand même ». En bas, comme un appareil photo : « Fermer » / « Importer (N) » à gauche, le
   déclencheur rond au centre, la dernière photo gardée avec le nombre à droite ; « Importer » fait
   entrer les photos dans l'atelier comme des fichiers importés. Rien ne quitte l'appareil.
   Si l'autorisation n'arrive pas (20 s), si elle est refusée, ou si la vidéo ne s'affiche pas (6 s
   sans image : iPhone en économie d'énergie, caméra prise par une autre application), un message le
   dit avec « Relancer la vidéo » (une lecture dans un geste) et, toujours, « Prendre la photo avec
   l'appareil du téléphone » : un champ de fichier `capture="environment"` qui ouvre l'appareil photo
   natif ; ses photos sont gardées et importées comme les autres. Sur téléphone et tablette, la
   visée demande 2560 × 1920 (assez pour un A4 à 150 dpi, sans peser sur la mémoire) ; 4K sur ordinateur.
2. **Dessins** (dans la colonne, les étapes vont dans l'ordre Importer, Tailles — le choix de la toile ou du
   cadre se fait avant les propositions —, Propositions, Dessins, Exporter, et en tête, sans numéro, Mes œuvres ; mêmes onglets
   sur téléphone ; section Dessins : les vignettes y sont groupées par type — *Arrière-plan* les fonds,
   *Premier plan* les découpes, *Non utilisé* les ignorés et ceux retirés de l'œuvre (`retireIfUnused` :
   plus aucune de leurs découpes ni de leurs pages dessus, ils n'y reviennent pas en recomposant ;
   Défaire les remet ; remis en Découpe ou en Fond depuis leur fiche, ils reviennent sur l'œuvre
   affichée sans la recomposer — `putBack` : sujets dans les places libres, page au centre —, de
   même par le bouton « + » de leur vignette (`addToArt` : dans le rôle d'avant leur retrait, sinon
   celui de l'atelier ; un pas de Défaire), et
   leurs vignettes restent en couleurs normales) — sans badge de rôle ; les vignettes et images de
   l'atelier ne se glissent pas (déposée sur l'œuvre, une vignette était réimportée) ; la fiche d'un dessin
   change son rôle) : chaque page est classée automatiquement
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
   Avant la découpe, l'**éclairage est égalisé** (`Extract.flatten`) : la couleur du papier est
   estimée case par case (1/100 de la page), les ombres d'un pli ou d'un bord sont ramenées au blanc
   et ne sont plus prises pour du dessin. Une case n'est retenue comme papier que si elle est lisse,
   pas trop sombre (≥ 62 % du papier voisin) et si sa teinte suit son assombrissement (une ombre fonce
   et se réchauffe ; une feutrine bleue, un lavis gris foncé ou un aplat pâle ne sont pas du papier) ;
   rien n'est corrigé sur une page sans papier blanc visible (≥ 30 % des cases). Un gris neutre resté
   à moins de 30 du papier n'est pas un trait (les traits de couleur pâle gardent leurs seuils).
   Un clic sur un dessin ouvre son détail : rôle (découpe / fond / ignoré), **luminosité, contraste et
   saturation** (−50 à +50,
   réglés dans la fenêtre de retouche pour une découpe, dans la fiche pour une page de fond ;
   appliqués à l'œuvre, aux vignettes et à l'export ; mémorisés par dessin, « Rétablir » revient au
   scan). **« Ajuster automatiquement »** les règle d'après les pixels réellement collés :
   papier éclairci jusqu'au blanc (s'il y en a assez de visible, jamais assombri), traits pâles foncés
   d'un tiers, couleurs ternes ravivées (jamais sur le crayon gris, avec retenue si le papier a une
   teinte) ; voir `Compose.autoTone`
   ; pour une page de fond, **« Recadrer la page »** (`js/crop.js`) : la page entière s'affiche avec
   un cadre à tirer par les coins et les bords, ou à déplacer (au clavier : flèches, Maj+flèches pour
   sa taille) ; « Toute la page » prend la feuille entière, « Rétablir » le cadrage d'origine (la page
   moins un liseré de 1,5 %). Le cadre est gardé par dessin (`d.crop`, fractions de la page droite,
   tourné avec elle), dans les sauvegardes, et repris à l'export haute définition ; la page de fond
   en est refaite. Sur l'œuvre et dans les autres propositions, la page garde son échelle et la
   partie gardée reste à sa place (au centre de sa case dans la Galerie) ; Défaire le reprend
   (`fitPageLayers`). La fiche et la vignette montrent la page recadrée.
   et **taille réelle** de la feuille
   (A5, A4, A3, A2 ou autre) — c'est cette taille qui compte, puisque les dessins sont collés à
   taille réelle. Sans information dans le fichier, la taille est estimée à partir du scan
   (le scan médian est supposé A4) ; elle n'est arrondie à un format standard que si la feuille en a
   les proportions. Dans la section Tailles, un bloc liste **la taille de chaque feuille à vérifier**
   (lue dans le scan ou estimée), avec A5 / A4 / A3 (la taille actuelle surlignée) et un champ pour
   saisir son plus grand côté : c'est cette taille qui fixe celle du dessin dans l'œuvre ; une taille
   touchée ou saisie est confirmée, la feuille quitte la liste, qui disparaît quand tout est vérifié. Les feuilles douteuses (bandes, rouleaux, très grands ou très
   petits formats, photos) viennent en tête, marquées, sous le titre **« Tailles à vérifier »** ; sans
   feuille douteuse, le titre est « Taille des dessins ». Ce bloc (et l'alerte de la section Propositions)
   n'existe qu'en collage avec les originaux : en tableau imprimé, les dessins sont réduits au cadre
   et seule leur taille relative compte (`renderUncertain`, relancé au changement de mode).
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
     alors signalé dans le panneau et sur la couverture du guide) ou de les coller en
     fond ; les pages de fond restent entières ;
   - **cartel** : sous l'œuvre, petit et centré (`placeLabel`, à la hauteur du bas de l'œuvre sur
     ordinateur ; au-dessus du tiroir sur téléphone, avec le titre seulement), le type de proposition
     et la taille de l'impression (« Frise · impression 29,7 × 21 cm ») ou de la toile, avec le titre
     de l'œuvre s'il y en a un ;
   - **astuce de la zone d'édition** (`#edit-hint`, `editHint`) : sur l'œuvre affichée, tant que rien
     n'est sélectionné, « Cliquez sur un des dessins pour le modifier » (téléphone : « Touchez un des
     dessins pour le modifier ») ; elle revient à chaque ouverture d'une œuvre (import,
     réouverture, rechargement) et disparaît au premier dessin touché ;
   - **œuvre affichée** gardée d'elle-même dans le navigateur (dessins, réglages, mise en place) et
     **rouverte automatiquement** quand on actualise ou rouvre la page ; « commencez une nouvelle
     œuvre » la range dans Mes œuvres (rien n'est effacé, pas de confirmation). Chaque dessin est relu à la résolution de travail qu'il avait (elle dépend du
     nombre de dessins importés d'un coup), pour retrouver exactement la même page — jamais plus que
     ce que l'appareil porte : une œuvre faite sur ordinateur et rouverte sur un téléphone voit ses
     pages réduites (`restoreAnalysis(sv, maxLong)` : page, masques, pièces et repères au même
     facteur ; les retouches suivent, par leur rapport de page) ; une retouche
     dont la page ne correspond plus (proportions, empreinte 16 × 16) n'est pas rejouée — la
     découpe automatique est gardée et c'est signalé ;
   - un fichier **déjà importé** (même contenu, même renommé « … 2.JPG ») n'est pas ajouté une
     deuxième fois ;
   - **panier** : un CTA « Commander » bien en vue (sur ordinateur, en bas à droite de l'œuvre, juste
     au-dessus de la barre de zoom ; sur
     téléphone, petit, avec l'icône d'un sac, en bas à gauche de l'œuvre au-dessus du curseur, à l'opposé des outils) ouvre le choix du produit pour la composition affichée (avec
     un lien vers le panier s'il contient déjà des articles) ; le panier s'ouvre par le bouton « Panier » en haut à
     droite de la zone d'édition, en face de « Mettre en scène » (ordinateur, dès qu'il contient un article) ou par l'icône du chariot dans l'en-tête (téléphone, toujours
     présente, avec le compteur en pastille) ; la composition affichée (« Commander », pas d'icône panier sur les propositions) ou
     la composition en cours (étape Exporter) s'ajoute au panier avec le produit choisi, au catalogue de la page Tarifs, selon
     l'atelier : impression (encadrée : couleur du cadre — bois clair, bois foncé, bois noir, bois blanc ou
     métal, celle de la mise en scène par défaut — et avec ou sans passe-partout, avec en clair la taille du
     cadre et celle de l'impression, `printSizeOf` ; fichier HD 14,90 €, impression papier / encadrée / toile en 21 × 30,
     30 × 40, 40 × 50, 50 × 70 ou 70 × 100, 29 à 199 €, la taille proposée étant le cadre de la composition) ou toile (guide DIY 24,90 €, kit DIY à options : base 45 € (guide imprimé et gabarits, livrés) + toile vierge sur châssis à la taille de l'œuvre (17 à 79 € selon la surface, `KIT_CANVAS`) + colle et vernis 11 € + pinceaux 6 €, cochés d'office, le kit complet 50 × 70 à 89 € (`kitPrice`, options gardées avec l'article)),
     et la quantité. À gauche des options (au-dessus sur téléphone), **la mise en scène de l'article
     choisi** (`drawCartScene`, même dessin que « Mettre en scène » : `paintRoom`) : le tableau à la
     taille d'impression choisie, encadré (couleur du cadre, passe-partout) ou sur papier, l'œuvre
     entière dedans (marge blanche si ses proportions diffèrent) ; le fichier HD, le guide ou le kit :
     l'œuvre à sa taille. Elle suit chaque changement d'option ; l'image prend toute la hauteur de
     la fenêtre (carrée sur téléphone), cadrée plus près du mur que « Mettre en scène » (`spec.fill`). La composition y est figée telle
     quelle (mise en place, retouches, réglages) dans IndexedDB, ses images partagées avec le
     brouillon ; la liste est dans localStorage et survit au rechargement. **Connecté, le panier est le
     même sur tous les appareils** : chaque article est une composition du compte marquée `meta.cart`
     (produit, finition, taille, quantité ; images dans le dossier de la composition), absente de « Mes
     compositions » tant qu'elle n'est pas commandée ; la liste locale est alignée sur le compte à la
     connexion, à l'ouverture du panier et avant la commande (les articles ajoutés hors connexion y
     partent, ceux retirés ailleurs disparaissent), quantité et retrait sont répercutés aussitôt, et la
     commande renomme la composition sans la renvoyer ; déconnecté, seuls les articles locaux restent. Le panier (bouton en haut,
     avec le nombre d'articles) permet de changer les quantités, de retirer un article, de « Revoir »
     une composition dans l'atelier ; « Commander » (compte demandé) enregistre chaque composition
     dans le compte sous la référence de la commande (AG-AAMMJJ-XXXX), garde la commande dans
     l'historique local et ouvre le message de commande (bonjour@atelier-gribouille.com) avec le
     récapitulatif. Le paiement en ligne n'est pas encore branché ;
   - **Mes œuvres** : chaque œuvre s'enregistre d'elle-même pendant qu'on travaille (2,5 s après le
     dernier changement), il n'y a rien à sauvegarder. L'œuvre affichée est le brouillon (`DRAFT_ID`,
     rouvert au rechargement) ; les autres sont rangées dans IndexedDB sous leur identifiant
     (`rec.work`, `state.workId`), leurs images dans le magasin commun (`FILES_STORE`, chaque image et
     chaque découpe écrites une fois, sous une clé stable). « Nouvelle œuvre » ou l'ouverture d'une autre
     œuvre range celle affichée (`shelveCurrent`) ; une œuvre ne s'efface que par la corbeille de la
     liste (en deux temps), dans ce navigateur et dans le compte. Chaque œuvre garde les dessins
     (images d'origine), leurs réglages (rôle, taille, orientation, luminosité, contraste et
     saturation, photo sur un sol, sujets gardés), la **découpe telle quelle** de chaque dessin (sa page
     de travail en JPEG et le masque de chaque pièce, retouches comprises, rangés dans une planche PNG :
     `savedOf`, identifiée par `pack`, gardée d'une réouverture à l'autre) et la mise en place exacte
     (chaque pièce et page, position, rotation, échelle, cadres, fond). La liste (section « Mes
     œuvres », onglet Compte sur téléphone) montre l'œuvre affichée en tête (« en cours »), puis les
     autres de la plus récente à la plus ancienne (« commandée », « sur cet appareil » : pas encore
     dans le compte) ; un toucher rouvre une œuvre telle quelle, sans nouvelle analyse, la version la
     plus récente l'emportant (celle du navigateur si elle est à jour : rien à télécharger). « Dupliquer
     cette œuvre » (étape Exporter) en ajoute une copie à la liste, sans compte. Une œuvre commandée,
     ou un article du panier « revu », se rouvre en copie (`beginCopy`) : elle ne devient une nouvelle
     œuvre qu'au premier changement, la commande reste telle quelle. Une œuvre rouverte reste épinglée
     jusqu'à « nouvelles propositions » ou un changement de réglage. Les pièces
     rouvertes sont rebâties depuis la page et les masques sauvegardés (`restoreAnalysis`), jamais
     redécoupées : une découpe automatique améliorée entre-temps ne change pas une œuvre déjà faite
     (seule la haute définition à l'export réanalyse le fichier d'origine, et garde la version de
     travail si la page retrouvée diffère). Les sauvegardes d'avant (sans page ni masques, `v` absent)
     sont relues avec la découpe automatique de l'époque, `js/extract-legacy.js`, chargé à la demande,
     et leurs retouches rejouées par rang de pièce ; une fois enregistrées de nouveau, elles passent
     au format autonome. Les anciennes compositions sauvegardées et l'ancienne œuvre en cours
     (d'avant « Mes œuvres ») apparaissent dans la liste comme des œuvres (`migrateDraft`) ;
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
     permet (de 1400 à 2800 px de grand côté ; sur téléphone, de 900 à 2000 px, avec un budget fixe
     de 110 Mo pour toutes les pages : Safari sur iPhone plafonne la mémoire totale des canvas et,
     au-delà, rend des canvas vides sans rien dire — vignettes et pages noires), calculée d'après le
     nombre de pages ; l'analyse des sujets se fait sur une grille réduite, mais les découpes
     et les pages de fond gardent cette résolution à l'écran ; sur téléphone, une page rouverte ne
     garde pas son image d'origine en mémoire (relue du fichier au besoin, `originalOf`), les
     vignettes libèrent leur canvas et le cache du fond est plus léger ;
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
     de la toile), un dessin par case réduit s'il le faut, jamais agrandi ; la grille « même bord des
     quatre côtés » (`squareGrid`) n'est retenue que si ses cases ne sont pas nettement plus petites
     que celles de la grille centrée ordinaire (sur un cadre imposé, elle pouvait donner des cases de
     3,8 cm dans un bord de 8 cm) ; la marge entre un dessin et sa case suit la taille des cases
     (12 %, entre 0,25 et 1,6 cm), pour qu'un dessin ne se réduise jamais à un point ; en « taille
     adaptée aux dessins », la toile est dimensionnée pour la grille elle-même (cases au 75e centile
     des tailles, grand côté plafonné à 130 cm) et non pour les pages de fond ;
   - **composition « Paysage »** : les pages de fond sont réparties en trois bandes selon leur valeur et
     leur couleur (claires et froides en haut, sombres et chaudes en bas), posées en tuiles presque
     droites qui se chevauchent, le sol par-dessus le milieu, le milieu par-dessus le ciel ; les éventuels lambeaux
     restent dans la bande de leur page ;
   - **export PDF à l'échelle** : une page de la taille exacte de la toile (1 cm = 1 cm), chaque page
     de fond posée tournée comme une image JPEG, les découpes et papiers déchirés en PNG avec leur
     transparence, les cadres de la galerie, le plomb et les traits en vecteurs ; images à 300 dpi
     au plus. Les scans restent des images : un dessin d'enfant ne se vectorise pas sans le trahir ;
   - **pages de fond à même l'œuvre** : un clic qui ne touche aucune découpe attrape la page de fond
     dessous (`hitAt` → `hitBg`), que l'on déplace, tourne ou redimensionne comme une découpe, le fond
     redessiné en direct pendant le geste ; le **mode « Fond seul »** (bouton près du zoom) reste
     pour voir les pages sans les découpes : on les déplace, tourne, met devant ou derrière, retourne
     ou retire à sa guise ; « Tout voir » ramène les découpes. Les pages restent entières et ne servent qu'une fois (pas de duplication).
     Une page que l'on redimensionne (poignée carrée ou touches + et −, en Affiche et en
     Galerie) passe devant les autres pages : agrandie sous elles, on ne verrait que son cadre. Les pages
     retouchées à la main (déplacées, tournées, retournées, redimensionnées) gardent leur place et leur
     taille quand la composition est refaite (curseur de densité, format, nouveau dessin) ; les autres
     pages suivent la nouvelle proposition ;
   - **mise en scène** (sur ordinateur, fenêtre ouverte par le bouton « Mettre en scène » de la zone
     d'édition, avec la pièce en premier puis, dans l'ordre de la section Tailles du téléphone, la taille de
     l'œuvre (et, dessous, la taille d'impression qui en découle), le passe-partout sous son titre,
     l'orientation, puis le cadre, le téléchargement et un bouton « Commander l'œuvre » ; sur
     téléphone, dans la section Tailles, sous le titre « Mise en scène », sans répéter la taille, le
     passe-partout et l'orientation choisis juste au-dessus) : trois pièces au choix
     (mémorisé, la chambre d'enfant par défaut) : le salon, une chambre d'enfant ou une entrée au mur vert sauge (photo `assets/hall.webp`,
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
     dominante froide → métal, claire → bois foncé, sinon bois clair. Le cadre montré est celui choisi
     dans Tailles ; le choix « Sans / Avec passe-partout » y est le même (il change la taille
     d'impression, donc la composition), et le passe-partout se voit dès que l'ouverture du cadre
     dépasse l'œuvre (une composition rouverte d'un ancien format prend le plus petit des quatre
     cadres où elle tient). « Télécharger la mise en scène » enregistre l'image en
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
   - **Mes œuvres suivent le compte** : connecté, chaque œuvre part d'elle-même dans le compte
     (`Account.cloud.workPut`, 15 s après le dernier changement sur ordinateur, 6 s sur téléphone, ou
     dès que la page passe en arrière-plan) : une ligne `compositions` au même identifiant que l'œuvre
     (`meta.work`) et un dossier `<utilisateur>/<œuvre>/` où chaque image (et chaque planche de
     découpes) n'est envoyée qu'une fois, nommée d'après sa clé ; les fichiers qui ne servent plus
     sont effacés (y compris ceux d'une ancienne sauvegarde ou de l'ancien brouillon unique). Les
     photos prises au téléphone sont ainsi dans le compte quand on passe à l'ordinateur. Un
     enregistrement identique (`printOf`) n'est ni réécrit ni renvoyé, et une œuvre rouverte sert de
     référence (`state.workBaseline`) : la relire ne la renvoie pas. Une ligne d'état discrète sous la
     puce du compte (`#cloud-sync`, `workStatus` ; téléphone : onglets Importer et Compte) dit où
     l'œuvre est enregistrée (« ✓ Enregistrée dans votre compte (14:32) », « sur cet appareil »…).
     Le compte n'est lu qu'à l'arrivée et à la connexion (`checkWorks` : la liste, sans les fiches
     complètes) et au retour sur la page après plus de 2 minutes d'absence (`checkCurrentWork` : la
     seule date de l'œuvre affichée) ; à l'arrivée sur un appareil où rien n'est affiché (nouvel
     appareil, navigateur vidé), la plus récente se rouvre d'elle-même, sauf après « nouvelle œuvre »
     (`atelier.nouvelle`) ou une arrivée `?nouveau` / `?exemple`. Les œuvres faites ici avant de se
     connecter, jamais envoyées nulle part, partent dans le compte à la connexion. Si l'œuvre affichée
     a été changée sur un autre appareil (date du compte différente de celle connue ici,
     `atelier.oeuvres-vues`), un bandeau en haut de la scène le dit (`#work-newer`, avec l'appareil et
     l'heure) : « Ouvrir cette version » la rouvre, « Garder celle-ci » renvoie celle d'ici ; rien ne
     part ni ne vient pour elle tant qu'on n'a pas choisi. Après une réception, la copie d'ici n'est
     pas renvoyée (pas de ping-pong entre appareils) ;
   - **couleur du fond** : le nuancier (`#ground`) est le dernier bloc de la section Propositions
     (hors des réglages avancés), et une pastille de la couleur actuelle, en tête de la barre de zoom
     près de l'œuvre, ouvre la même palette juste à côté (`#ground-pop`, reste ouverte pour essayer
     plusieurs teintes, se ferme d'un appui ailleurs ou avec Échap) ; une teinte s'applique tout de
     suite à l'œuvre affichée (`applyGround`, mise en place gardée), les deux nuanciers restent
     d'accord ; en Galerie (fond blanc fixe), le même nuancier règle la **couleur du trait** des cases
     (`state.frameColor`, `setFrameColor`, `comp.frameColor` peint par `renderBg` et dans le PDF ;
     'auto' = l'encre noire ; ni « toile nue » ni « blanc » pour un trait ; libellés « Couleur du
     trait » dans la section et sur la pastille) ;
   - **Galerie et Pop art en tableau imprimé seulement** : en collage, ils ne sont pas proposés
     (`activeStyles`) — sauf pour une œuvre rouverte dans ce style, qui garde sa place ;
   - **« Mettre en scène » en haut à gauche** de la zone d'édition sur ordinateur, sous la barre
     d'outils (celle qui commence par Défaire) ; `layoutLabel` n'a plus à le placer ; un second
     bouton (`#scene-open-side`) l'ouvre aussi depuis la section Tailles, sous l'orientation ; sur
     ordinateur, cette section n'a plus le choix du passe-partout (il se fait dans la mise en scène) ;
   - **collage et mise en scène** : pas de scène « entrée » (la chambre d'enfant la remplace si elle
     était mémorisée, `sceneRoom`) ; sur ordinateur, la fenêtre de mise en scène n'a ni taille ni
     orientation (elles se règlent dans la section Tailles) ;
   - **téléphone, après un import** : l'onglet Tailles s'ouvre (et non Propositions), tiroir déplié en grand ;
   - **fiche d'un dessin dans le flux** : entre la phrase de la section Dessins et les dessins, elle
     ne flotte plus au-dessus de la liste (plus de `position: sticky`) ;
   - **tableau imprimé : pas de taille réelle dans la fiche** : les dessins y sont réduits pour tenir
     dans le cadre, la fiche d'un dessin ne propose donc ni les feuilles A5…A2 / Autre, ni la phrase sur
     la taille lue ou estimée (`renderDetail`, `printMode()`) ; l'orientation, le rôle et la retouche
     restent ;
   - **tableau imprimé : la taille ne refait pas l'œuvre** : changer de cadre ou de passe-partout met
     l'œuvre affichée à la nouvelle taille telle quelle (`keepPrintComp` → `fitCompTo` : places en
     proportion, dessins et pages à la même échelle, cadre noté sur la composition) et changer
     d'orientation la tourne d'un quart de tour (`turnComp`) ; les autres propositions sont recomposées
     à la nouvelle taille. En atelier Toile, la composition est refaite comme avant ;
   - **toutes les sections repliées par défaut** (ordinateur) : à l'arrivée et à chaque nouvelle œuvre,
     toutes les étapes sont repliées et rien n'est mémorisé (`collapsibleSections`) ; un import ouvre
     Tailles et Propositions et replie Importer ; Dessins ne s'ouvre que d'un clic sur un dessin de
     l'œuvre (`showDrawingOf`) ou sur son titre ;
   - **pas d'orientation dans la fiche** : l'orientation d'une feuille reste automatique
     (`effectiveOrient`) ; la pièce se tourne sur l'œuvre, par la barre d'outils ;
   - **tous les dessins par défaut** : le curseur de nombre de dessins part au maximum (nouvelle
     visite, « nouvelle œuvre ») ; l'exemple garde ce réglage, une œuvre rouverte reprend le sien ;
   - **sans œuvre, rien autour de l'accueil vide** : ni barre d'outils ni barre de zoom (`#zoom-bar`)
     tant qu'aucune composition n'est affichée ; sur téléphone, le tiroir est baissé (`stage-full`,
     seule sa barre d'onglets reste) à l'arrivée et après « nouvelle œuvre », pour que l'accueil et le
     choix du type d'œuvre prennent tout l'écran ; il remonte sur Importer avec le choix d'une carte
     (ou d'un onglet), et avec les premiers dessins (`setStageFull`) ; l'étape Importer ne propose plus l'exemple ni
     « commencer une nouvelle œuvre » en phrases (le bouton « Voir un exemple » de l'accueil vide et le
     bouton « Commencer une nouvelle œuvre » suffisent : au-dessus du titre « 01 Importer » sur
     ordinateur, sous le consentement de détourage dans Importer sur téléphone — `placeNewWork`) ;
   - **fond de toile** : au choix, la toile nue (lin ; en Impression, « sans couleur » : blanc pur) ou un aplat d'acrylique dans les teintes
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
     effet peinture ni finition toile (son nuancier règle la couleur du trait des cases) ; l'aplat est rendu avec un vrai effet de peinture (coups de brosse en deux couches,
     traces des poils, couche inégale), à l'écran, dans les exports et dans le PDF ; le guide indique
     la couleur à peindre ; **toute nouvelle création part en couleur automatique** (conseillée
     selon la composition), une œuvre rouverte (brouillon, Mes œuvres) reprend la sienne ;
   - **orientation de la toile au choix**, paysage ou portrait, pour la taille automatique comme pour
     les toiles du commerce (un 30P devient 65 × 92 cm en portrait) ; toute nouvelle création part en
     portrait, une œuvre rouverte garde la sienne ;
   - **six propositions en collage, sept en tableau imprimé** (Paysage sélectionné par défaut), à chaque fois :
     *Paysage* (ciel, milieu, sol, comme une grande toile de famille),
     *Tournesol* (tout tourne en spirale d'or autour des pièces maîtresses, au centre),
     *Courtepointe* (un patchwork : les pages de fond posées bord à bord, presque droites, en
     alternant claires et foncées comme un damier cousu ; une découpe posée en médaillon au centre
     de chaque carreau, les plus grandes sur les plus grands carreaux, les suivantes là où les pages
     ne couvrent pas la toile ; sans page de fond — atelier Impression, ou que des découpes — les
     découpes elles-mêmes font les carreaux : rangées pleine largeur, chaque pièce ajustée à sa
     rangée sans jamais être agrandie, le nombre de rangées choisi pour remplir la hauteur),
     *Galerie* (tableau imprimé seulement ; une grille régulière de cases carrées cernées d'un trait
     fin de 0,8 mm, noir ou de la couleur choisie dans le nuancier du fond, un sujet
     par case, le nombre de cases suivant le curseur de densité, comme une planche de personnages
     encadrée ; ce style est fait pour l'impression : un dessin trop grand pour sa case est réduit,
     jamais agrandi, si bien qu'au maximum du curseur tous les dessins tiennent, quelle que soit la
     toile ; un dessin sélectionné s'agrandit ou se réduit par pas de 10 % avec deux boutons de la
     barre d'outils, visibles seulement en Galerie ; les dessins y restent tels quels, comme dans les
     autres styles ; le guide signale la réduction, c'est le seul style qui ne respecte
     pas la taille réelle),
     *Cabinet de curiosités* (sur la même toile, les plus beaux dessins exposés droits, en rangées,
     sans chevauchement : ceux qui n'y tiennent pas restent disponibles),
     *Pop art* (tableau imprimé seulement, comme la Galerie : la toile en grille de cases bord à bord,
     `comp.tiles`, chacune peinte d'une couleur vive — la plus éloignée de la couleur du dessin, jamais
     celle de ses voisines de gauche et du dessus — avec un dessin au centre, au plus à sa taille réelle ;
     à partir de 4 dessins, un dessin différent par case, les plus beaux, autant que le curseur en
     demande (16 au plus) ; de 1 à 3, le plus beau répété en 2 × 2 ; les cases sont peintes par
     `renderBg`, en vecteurs dans le PDF, gardées avec la mise en place et suivent un changement de
     cadre ou d'orientation ; « Nouvelles propositions » tire d'autres couleurs),
     *Village* (plus proposé, remplacé par le Pop art : une œuvre déjà faite dans ce style se rouvre
     telle quelle ; son patchwork venait des grandes zones de couleur des dessins, `Compose.colorPatches`),
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
4. **Exporter** en JPEG ou PNG, à 300 dpi par défaut pour l'impression.

Des dessins d'exemple peuvent être proposés sans être chargés d'office : s'ils sont fournis avec la
page ou présents dans `samples/manifest.json` (`{ "base": "samples/", "pages": [{ "file", "name",
"sizeCm"? }] }`) à côté de l'app, un bouton « Essayer avec les dessins d'exemple » apparaît sous la
zone d'import et dans l'écran d'accueil ; sans ce dossier, rien n'est proposé. Le dossier `samples/` du
dépôt contient un jeu de 19 dessins de synthèse (14 sujets au feutre et au crayon, 5 pages peintes),
générés par `samples/make_samples.py` : aucun auteur, aucune donnée personnelle, aucun dessin d'enfant réel.

**Comptes utilisateurs** (optionnels) : inscription et connexion par Google ou e-mail (mot de
passe, ou lien de connexion sans mot de passe), gestion du compte (nom affiché, e-mail, mot de passe,
déconnexion, suppression définitive en deux clics, lien « mot de passe oublié »). Quand les comptes
sont actifs, télécharger une œuvre et créer le guide demandent d'être
connecté (la fenêtre de connexion s'ouvre et l'action reprend d'elle-même après la connexion) ; les
œuvres s'enregistrent d'elles-mêmes dans le compte (Mes œuvres), avec les images des dessins en haute
définition et les retouches, et chaque export (JPEG, PNG, PDF, guide) y est gardé aussi, listé sous « Mes exports »
avec retéléchargement et suppression. Tout se retrouve depuis n'importe quel appareil. Le service est Supabase (Auth + Storage,
hébergement en Europe), piloté depuis `js/account.js` ; les règles d'accès (`supabase/schema.sql`)
limitent chaque compte à ses propres lignes et fichiers, et la fonction `delete_account` permet à
l'utilisateur d'effacer lui-même tout son compte. Sans réglage dans `config.js`, rien n'apparaît et
l'app fonctionne comme avant. Mise en place pas à pas dans `docs/COMPTES.md` ; page de
confidentialité à relire dans `confidentialite.html`.

Le parcours simple tient en trois étapes (importer, choisir une proposition, télécharger) : les
réglages de composition (orientation, toile, fond, feuilles pâles) sont repliés sous « Réglages
avancés », le guide de création replié sous l'étape Exporter (qualité et type de fichier restent
visibles au-dessus du bouton de téléchargement) ; sur ordinateur, toutes les sections sont repliées à
l'arrivée et pour une nouvelle œuvre, l'import ouvre Tailles et Propositions et replie Importer (rien
n'est mémorisé).
**Voir l'œuvre de près** : pincement à deux doigts, molette (sans pièce sélectionnée) ou pincement du
   pavé tactile, double-tap sur une zone vide, boutons − / + / ajuster ; glisser une zone vide pour se
   déplacer ; bouton plein écran, pratique sur téléphone.
5. **Retoucher une découpe** : bouton « Retoucher » (ou double-clic sur une pièce de l'œuvre, ou ciseaux
   sur la vignette d'une pièce). Éditeur en fenêtre sur ordinateur (`.ed-card`, même voile que la mise
   en scène, croix `#ed-close` = fermer sans enregistrer, Échap aussi) et plein écran sur téléphone,
   avec zoom (molette, pincement, + / −), gomme,
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

## Accessibilité au clavier

- **L'œuvre** se prend avec Tab (`#canvas`, `role="application"`, mode d'emploi dans son nom
  accessible) : Page suivante / Page précédente choisissent un dessin (dans l'ordre de lecture,
  découpes puis pages de fond ; annoncé par une zone `aria-live` : « chat, 2 sur 9 »), les flèches
  le déplacent de 0,5 cm (Maj : 2 cm), R / Maj+R le tournent de 5°, + et − changent sa taille de
  10 %, Entrée ouvre la retouche de sa découpe, Suppr (ou Retour arrière, seulement quand l'œuvre a le
  focus) le retire, Échap le désélectionne ; Ctrl+Z / Ctrl+Maj+Z (ou Ctrl+Y) défont et refont.
- **Les vignettes** de la section Dessins sont des boutons (Entrée ou Espace ouvre la fiche,
  `aria-pressed` pour celle ouverte) ; celles des pièces découpées ont un bouton qui retire ou remet la
  pièce, à côté de celui de la retouche.
- **Les fenêtres** (`role="dialog"`, `aria-modal`) : le focus y entre à l'ouverture, Tab et Maj+Tab
  bouclent à l'intérieur (Échap y est donc toujours reçu) et, à la fermeture, le focus revient au
  bouton qui l'avait ouverte (`dialogFocus`).
- **La retouche** : E (gomme), R (restaurer), W (baguette), H (déplacer), [ et ] (taille du pinceau),
  Espace maintenu (déplacer la vue), Entrée (valider), Échap (fermer).
- **L'aide** (`#shortcuts`) : la touche ? ou le lien « Raccourcis clavier » du pied de la colonne
  (masqué sur téléphone et tablette) ouvre la liste de ces raccourcis.
- **La structure** pour les lecteurs d'écran : le titre de chaque étape contient le bouton qui la
  replie (`button.step-toggle`, `aria-expanded`) ; une fiche de « Mes œuvres » s'ouvre par un bouton
  posé dessus (`button.saved-open`), sans contrôle imbriqué ; les groupes de dessins ont un titre h3 ;
  les finitions de cadre du panier sont des `role="radio"` ; sur téléphone, l'en-tête est un `<header>`
  avec le titre de niveau 1. Sur le site, les deux `<nav>` sont nommées (« Navigation principale »,
  « Pied de page »). Les contrastes et les couleurs ne sont pas modifiés.

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
peut suffire en A6 et pas en A3. Affichage : pastille sur la vignette, les titres seuls dans la
fiche du dessin (raison et conseil en infobulle, `qualityBlock`), bandeau « N dessins risquent d’être flous » dans Propositions, rappel dans
Exporter. Rien n’est jamais bloqué. Sous l’alerte de la fiche, « Importer une meilleure version »
(`replaceDrawing`) : le nouveau fichier prend la place du dessin dans la liste et sur l’œuvre — chaque
découpe posée est remplacée par celle du nouveau dessin au même endroit de la feuille, au même centre,
avec la même inclinaison et la même taille ; une page de fond garde son cadrage ; le dessin garde sa
taille réelle, son rôle et son orientation, et les autres dessins ne bougent pas.

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
- `js/crop.js` : recadrage d'une page de fond (cadre à poignées, clavier, « Toute la page », « Rétablir »).
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
présentation du concept avec, en tête, la vidéo de présentation en 16:9, bord à bord sur toute la
largeur de la page (25 s, muette, lue une fois : la bande se replie ensuite pour laisser la place
au héros — titre, boutons, photo de la toile dans le salon) : le réel Instagram vertical (hors
dépôt) fournit l'animation — sa zone visuelle est recadrée image par image et posée à droite à même
le fond, bords nets —, ses légendes sont réécrites à gauche en Playfair aux mêmes instants ; son
gros plan sur la toile est réincrusté dans l'écran de l'ordinateur, sans zoom (correspondance
mesurée par corrélation, `tools/accueil-video-zoom.json`), et sa fin est remplacée par le tableau
encadré (`tools/accueil-video-tableau.jpg`, tiré du réel) accroché dans la chambre d'enfant de
l'atelier, sans carton de fin ; rendue par `landing/tools/accueil-video.py` (Pillow + ffmpeg +
scipy, polices du site) en français et en anglais (`img/accueil-video-fr.mp4`, `-en.mp4`,
1280 × 720, affiche `accueil-video-poster.webp`, option `--hd` pour une 1920 × 1080) ;
`accueil-video.js` choisit la version selon la langue, lance la lecture d'office (retentée au
premier geste si le téléphone la refuse) et replie la bande à la fin —, puis comment ça marche, le téléphone, les sept styles, la promesse, les œuvres
accrochées dans des pièces illustrées, et les questions) à la racine, et
l'application sous `/atelier/` (`?exemple` charge le jeu d'exemple d'office). Adresse :
https://ateliergribouille.art (domaine personnalisé
réglé dans Settings → Pages ; l'adresse https://adrienterras.github.io/Claudde/ y redirige). Le dossier
`coming-soon/` contient la page « Ouverture prochaine » autonome, à héberger ailleurs si besoin.
Réglages GitHub nécessaires une fois : Settings → Pages → Source « GitHub Actions », et la
branche de l'application autorisée dans l'environnement github-pages (« Deployment branches » sans
restriction) ; sinon chaque exécution échoue en quelques secondes, sans journal.

Sans la fenêtre Claude, la direction artistique par Claude n'est pas disponible : l'application
compose avec ses règles intégrées.
