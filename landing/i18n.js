// Page d'accueil : traduction anglaise (le français est écrit dans index.html). Langue : ?lang=, choix mémorisé, sinon le français.
(function () {
  'use strict';
  var EN = {
    "Navigation principale": "Main navigation",
    "Pied de page": "Footer",
    "Tarifs : tableau et toile avec les dessins d’enfants | Atelier Gribouille": "Prices: canvas and print of children’s drawings | Atelier Gribouille",
    "Tableau avec les dessins de vos enfants | Atelier Gribouille": "A canvas of your children’s drawings | Atelier Gribouille",
    "Atelier Gribouille — les dessins d’enfants deviennent des œuvres d’art": "Atelier Gribouille — children’s drawings become works of art",
    "Une toile composée de dessins d’enfants découpés et collés, accrochée au mur d’un salon": "A canvas made of cut-out children’s drawings, hanging on a living-room wall",
    "L’atelier en 25 secondes : les dessins importés, découpés et composés en tableau, puis imprimés et encadrés ou collés à la main": "The studio in 25 seconds: the drawings imported, cut out and composed into an artwork, then printed and framed or glued by hand",
    "Que faire des dessins de ses enfants ?": "What can I do with my children’s drawings?",
    "Choisissez les plus beaux, scannez-les ou prenez-les en photo, puis réunissez-les dans une œuvre à accrocher. L’atelier la compose gratuitement, et vous pouvez garder les originaux ou les coller vous-même sur la toile.": "Pick the best ones, scan or photograph them, then gather them into an artwork to hang. The studio composes it for free, and you can keep the originals or glue them onto the canvas yourself.",
    "Comment transformer un dessin d’enfant en tableau ?": "How do I turn a child’s drawing into a canvas?",
    "Importez les dessins dans l’atelier : il les détoure comme avec des ciseaux et propose huit compositions avec les dessins. Choisissez-en une, ajustez-la, puis téléchargez le fichier haute définition ou commandez le tableau imprimé et encadré.": "Import the drawings into the studio: it cuts them out as if with scissors and offers eight compositions using the drawings. Pick one, adjust it, then download the high-definition file or order the printed, framed artwork.",
    "Combien coûte un tableau avec les dessins de mes enfants ?": "How much does a canvas of my children’s drawings cost?",
    "Composer est gratuit. Le fichier haute définition coûte 14,90 €. Imprimée et livrée en France métropolitaine, l’œuvre coûte dès 29 € sur papier premium et dès 59 € encadrée. Le kit à réaliser soi-même, avec les dessins originaux, est à 89 €.": "Composing is free. The high-definition file costs €14.90. Printed and delivered in mainland France, the artwork starts at €29 on premium paper and €59 framed. The do-it-yourself kit, with the original drawings, is €89.",
    "Faut-il un scanner ?": "Do I need a scanner?",
    "Nos huit conseils pour bien photographier un dessin": "Our eight tips for photographing a drawing well",
    "Comment bien photographier un dessin avec un téléphone ?": "How do I photograph a drawing well with a phone?",
    "Lumière du jour, flash éteint, pas d’ombre sur la feuille. Le dessin à plat sur un fond uni (des livres sur les coins s’il gondole). Le téléphone bien parallèle à la feuille, une marge tout autour, un seul dessin par photo. Mise au point sur le dessin, objectif essuyé. Depuis l’atelier sur téléphone, « Photographier un dessin » vous guide en direct : la visée dit si la feuille est trouvée, bien cadrée, nette et bien éclairée.": "Daylight, flash off, no shadow on the sheet. The drawing flat on a plain background (books on the corners if it curls). The phone parallel to the sheet, a margin all around, one drawing per photo. Focus on the drawing, lens wiped. From the studio on a phone, “Photograph a drawing” guides you live: the viewfinder says whether the sheet is found, well framed, sharp and well lit.",
    "Les huit conseils en détail": "The eight tips in detail",
    "bien photographier un dessin avec un téléphone": "photographing a drawing well with a phone",
    "Non : une photo prise au téléphone suffit. L’atelier retire la table ou le sol autour du dessin et égalise l’éclairage. Pour un grand format, un scan à 300 dpi donne les traits les plus nets.": "No: a phone photo is enough. The studio removes the table or floor around the drawing and evens out the lighting. For a large format, a 300 dpi scan gives the sharpest lines.",
    "Combien de dessins peut-on réunir sur une toile ?": "How many drawings can go on one canvas?",
    "De quelques dessins à plusieurs dizaines. Le curseur « Nombre de dessins » choisit combien en garder, des plus beaux aux autres ; certaines propositions (Galerie, Cabinet de curiosités, Pop art) n’en retiennent qu’une sélection. Vous pouvez ensuite en retirer, en remettre, les déplacer et retoucher leur découpe.": "From a few drawings to several dozen. The “Number of drawings” slider chooses how many to keep, from the best ones down; some proposals (Gallery, Cabinet of curiosities, Pop art) keep only a selection. You can then remove some, put them back, move them and touch up their cut-out.",
    "Que deviennent les dessins que j’importe ?": "What happens to the drawings I import?",
    "Ils restent dans votre navigateur. Si vous créez un compte gratuit, vos compositions sont gardées dans votre espace, hébergé en Europe, et vous pouvez tout supprimer à tout moment. Les dessins ne servent à rien d’autre qu’à votre œuvre.": "They stay in your browser. If you create a free account, your compositions are kept in your space, hosted in Europe, and you can delete everything at any time. The drawings are used for nothing but your artwork.",
    "Est-ce une bonne idée de cadeau ?": "Is it a good gift idea?",
    "C’est l’un des cadeaux les plus touchants pour des grands-parents, pour la fête des mères ou des pères, ou pour Noël. Prévoyez quelques jours pour l’impression et la livraison d’un tableau encadré ; le fichier haute définition se télécharge tout de suite.": "It is one of the most touching gifts for grandparents, for Mother’s or Father’s Day, or for Christmas. Allow a few days for printing and delivery of a framed artwork; the high-definition file downloads right away.",
    "Tableau de dessins d’enfants, composition Paysage : ciel, milieu et sol": "Canvas of children’s drawings, Landscape composition: sky, middle and ground",
    "Tableau de dessins d’enfants, composition Frise : les dessins à la suite, en bande": "Canvas of children’s drawings, Frieze composition: the drawings in a row, as a band",
    "Tableau de dessins d’enfants, composition Nuage : dispersés sur un fond uni": "Canvas of children’s drawings, Cloud composition: scattered on a plain background",
    "Tableau de dessins d’enfants, composition Tournesol : en spirale depuis le cœur": "Canvas of children’s drawings, Sunflower composition: in a spiral from the heart",
    "Tableau de dessins d’enfants, composition Courtepointe : en patchwork": "Canvas of children’s drawings, Quilt composition: as a patchwork",
    "Tableau de dessins d’enfants, composition Cabinet de curiosités : en rangées": "Canvas of children’s drawings, Cabinet of curiosities composition: in rows",
    "Tableau de dessins d’enfants, composition Galerie : un dessin par cadre": "Canvas of children’s drawings, Gallery composition: one drawing per frame",
    "Questions fréquentes": "Frequently asked questions",
    "Tout ce qu’on nous demande avant de transformer les dessins en tableau.": "Everything people ask us before turning the drawings into a canvas.",
    "Encore des idées pour leurs dessins :": "More ideas for their drawings:",
    "que faire des dessins de ses enfants ? 9 idées": "what to do with your children’s drawings? 9 ideas (in French)",
    "Idées": "Ideas",
    "Atelier Gribouille — Les dessins d’enfants deviennent des œuvres d’art": "Atelier Gribouille — Children’s drawings become works of art",
    "Scannez les dessins de vos enfants : l’atelier les découpe et compose une œuvre unique, à imprimer ou à réaliser à la main avec les originaux.": "Scan your children’s drawings: the studio cuts them out and composes a unique artwork, to print or to make by hand with the originals.",
    "Chez vous": "At home",
    "Comment ça marche": "How it works",
    "Les styles": "The styles",
    "Ouvrir l’atelier": "Open the studio",
    "Les dessins d’enfants deviennent": "Children’s drawings become",
    "des œuvres d’art": "works of art",
    "Scannez ou prenez en photo les dessins qui s’accumulent. L’atelier les découpe comme avec des ciseaux et compose une œuvre unique : à imprimer, ou à réaliser à la main avec les dessins originaux, pour l’accrocher chez vous.": "Scan or photograph the drawings piling up. The studio cuts them out as if with scissors and composes a unique artwork: to print, or to make by hand with the original drawings, and hang at home.",
    "Créer mon œuvre": "Create my artwork",
    "Création imprimée à partir de vos dessins": "Printed creation from your drawings",
    "Collage avec les dessins originaux": "Collage with the original drawings",
    "Voir un exemple": "See an example",
    "Gratuit pour composer. Les dessins restent les vôtres : tout se passe dans votre navigateur, et dans votre compte si vous en créez un.": "Free to compose. The drawings remain yours: everything happens in your browser, and in your account if you create one.",
    "Une toile composée de dessins d’enfants découpés et collés, accrochée au mur d’un salon aux moulures blanches": "A canvas made of cut-out, glued children’s drawings, hanging on the wall of a living room with white mouldings",
    "Découpés et collés sur toile": "Cut out and glued on canvas",
    "Tous leurs dessins, une seule œuvre": "All their drawings, one artwork",
    "Imprimés et encadrés": "Printed and framed",
    "Le guide personnalisé imprimé et les gabarits de découpe à l’échelle : 45 €": "The printed personalised guide and scale cutting templates: €45",
    "Au choix : la toile vierge sur châssis à la taille de l’œuvre (dès 17 €), la colle et le vernis (11 €), les pinceaux (6 €)": "Optional: the blank stretched canvas at the artwork’s size (from €17), glue and varnish (€11), brushes (€6)",
    "Le kit DIY": "The DIY kit",
    "Livré chez vous : le guide personnalisé imprimé et les gabarits de découpe à l’échelle. Vous utilisez vos dessins originaux": "Delivered to you: the printed personalised guide and scale cutting templates. You use your original drawings",
    "+ Toile vierge sur châssis": "+ Blank stretched canvas",
    "À la taille de l’œuvre : 17 € jusqu’au 30 × 40, 22 € jusqu’au 40 × 50, 27 € jusqu’au 50 × 70, 35 € jusqu’au 60 × 90, 45 € jusqu’au 70 × 100, 59 € jusqu’au 100 × 100, 79 € au-delà": "At the artwork’s size: €17 up to 30 × 40, €22 up to 40 × 50, €27 up to 50 × 70, €35 up to 60 × 90, €45 up to 70 × 100, €59 up to 100 × 100, €79 beyond",
    "dès 17 €": "from €17",
    "+ Colle et vernis": "+ Glue and varnish",
    "Colle vinylique et vernis de finition": "PVA glue and finishing varnish",
    "+ Pinceaux": "+ Brushes",
    "Deux pinceaux plats, pour la colle et le vernis": "Two flat brushes, for glue and varnish",
    "Le kit DIY complet 50 × 70": "The complete DIY kit 50 × 70",
    "Guide imprimé, gabarits, toile 50 × 70 cm, colle, vernis et pinceaux": "Printed guide, templates, 50 × 70 cm canvas, glue, varnish and brushes",
    "Dans leur chambre": "In their bedroom",
    "Dans votre salon": "In your living room",
    "Une création imprimée et encadrée, faite des dessins d’enfants, accrochée au-dessus d’une étagère de chambre d’enfant": "A printed, framed creation made of children’s drawings, hanging above a shelf in a child’s bedroom",
    "Une création imprimée et encadrée, faite des dessins d’enfants, accrochée au-dessus d’un buffet de salon": "A printed, framed creation made of children’s drawings, hanging above a living-room sideboard",
    "Accrochée chez vous, elle raconte leur enfance": "Hanging at home, it tells the story of their childhood",
    "Dans la chambre, le salon ou l’entrée : l’œuvre encadrée, à sa taille réelle, chez vous.": "In the bedroom, the living room or the hallway: the framed artwork, at its real size, in your home.",
    "Dans la chambre d’enfant": "In the child’s bedroom",
    "Tableau encadré, passe-partout et cadre métal · au-dessus des étagères à jouets": "Framed print, mount and metal frame · above the toy shelves",
    "Tableau de dessins d’enfants encadré, au-dessus des étagères à jouets d’une chambre d’enfant": "Framed artwork made of children’s drawings, above the toy shelves of a child’s bedroom",
    "Dans le salon": "In the living room",
    "Grand format, cadre bois clair et passe-partout · au-dessus du buffet": "Large format, light wood frame and mount · above the sideboard",
    "Grand tableau de dessins d’enfants encadré, au-dessus du buffet d’un salon ensoleillé": "Large framed artwork made of children’s drawings, above the sideboard of a sunny living room",
    "Dans l’entrée": "In the hallway",
    "Cadre noir et passe-partout sur un mur vert sauge · au-dessus d’une console": "Black frame and mount on a sage green wall · above a console table",
    "Tableau de dessins d’enfants au cadre noir, sur le mur vert sauge d’une entrée, au-dessus d’une console": "Artwork made of children’s drawings in a black frame, on the sage green wall of a hallway, above a console table",
    "Trois gestes, et c’est fait": "Three steps, and it’s done",
    "Aucune compétence en retouche. L’atelier fait le travail de patience, vous gardez les choix qui comptent.": "No editing skills needed. The studio does the patient work, you keep the choices that matter.",
    "Importez les dessins": "Import the drawings",
    "Un PDF du scanner, des photos de téléphone, même posées sur la table ou le parquet : l’atelier retire la surface et ne garde que le dessin.": "A PDF from the scanner, phone photos, even taken on the table or the floor: the studio removes the surface and keeps only the drawing.",
    "L’atelier compose": "The studio composes",
    "Les sujets sont découpés au millimètre et posés sur les pages peintes. Huit styles sont proposés ; vous déplacez, tournez, ajustez.": "The subjects are cut out to the millimetre and laid on the painted pages. Eight styles are proposed; you move, rotate, adjust.",
    "Ne jetez plus les dessins de vos enfants : réunissez-les en une œuvre à accrocher. Photo, découpe automatique, 8 compositions au choix. Gratuit pour composer.": "Don’t throw away your children’s drawings: gather them into an artwork to hang. Photo, automatic cut-out, 8 compositions to choose from. Free to compose.",
    "Imprimez, ou réalisez-la avec les originaux": "Print it, or make it with the originals",
    "Voir un exemple de guide de découpe et de collage (PDF)": "See a sample cutting and gluing guide (PDF, in French)",
    "Un fichier haute définition pour l’impression. Ou le guide de création pour la faire à la main avec les vrais dessins.": "A high-definition file for printing. Or the making-of guide to do it by hand with the real drawings.",
    "Huit manières de raconter les mêmes dessins": "Eight ways to tell the same drawings",
    "Chaque import donne huit propositions, toujours avec les dessins. Choisissez-en une, puis faites-la vôtre.": "Every import gives eight proposals, always with the drawings. Pick one, then make it yours.",
    "Composition Paysage": "Landscape composition",
    "Paysage": "Landscape",
    "ciel, milieu, sol": "sky, middle, ground",
    "Composition Frise": "Frieze composition",
    "Frise": "Frieze",
    "une bande, les dessins à la suite": "one band, the drawings in a row",
    "Composition Nuage": "Cloud composition",
    "Nuage": "Cloud",
    "dispersés sur un fond uni": "scattered on a plain ground",
    "Composition Tournesol": "Sunflower composition",
    "Tournesol": "Sunflower",
    "spirale depuis le cœur": "spiral from the heart",
    "Composition Courtepointe": "Quilt composition",
    "Courtepointe": "Quilt",
    "patchwork, un médaillon par carreau": "patchwork, one medallion per square",
    "Composition Cabinet de curiosités": "Cabinet of curiosities composition",
    "Cabinet de curiosités": "Cabinet of curiosities",
    "les plus beaux, en rangées": "the finest, in rows",
    "Composition Galerie": "Gallery composition",
    "Galerie": "Gallery",
    "un dessin par cadre": "one drawing per frame",
    "Pop art": "Pop art",
    "cases de couleurs vives": "bright colour squares",
    "Tableau de dessins d’enfants, composition Pop art : un dessin par case de couleur vive": "Canvas of children’s drawings, Pop art composition: one drawing per bright colour square",
    "Fait pour durer, comme les souvenirs": "Made to last, like memories",
    "Les dessins sont relus dans leur définition d’origine au moment d’exporter : un scan à 300 dpi donne une toile nette, même en grand format. Rien n’est lissé, rien n’est redessiné : ce sont bien leurs traits.": "The drawings are re-read at their original definition when exporting: a 300 dpi scan gives a sharp canvas, even in large formats. Nothing is smoothed, nothing is redrawn: these are truly their lines.",
    "Commencer maintenant": "Start now",
    "Export JPEG, PNG ou PDF à l’échelle, 300 dpi, aux tailles de toiles et de cadres du commerce.": "JPEG, PNG or to-scale PDF export, 300 dpi, in shop canvas and frame sizes.",
    "Guide de création en PDF pour la version à la main, avec les dessins originaux : plan de pose à l’échelle 1, ordre de collage, trait de coupe de chaque dessin.": "PDF making-of guide for the handmade version, with the original drawings: 1:1 layout plan, gluing order, cut line for each drawing.",
    "Un compte gratuit pour retrouver compositions et exports sur tous vos appareils.": "A free account to find compositions and exports on all your devices.",
    "Vos dessins restent à vous, dans votre espace, hébergés en Europe.": "Your drawings remain yours, in your own space, hosted in Europe.",
    "Les grands souvenirs commencent par un gribouillage": "Great memories start with a scribble",
    "Essayer avec des dessins d’exemple": "Try with sample drawings",
    "Créativité": "Creativity",
    "Tendresse": "Tenderness",
    "Savoir-faire": "Craftsmanship",
    "L’atelier": "The studio",
    "Confidentialité": "Privacy",
    "Contact": "Contact",
    "Instagram": "Instagram",
    "Langue / Language": "Language",
    // page tarifs
    "Tarifs — Atelier Gribouille": "Pricing — Atelier Gribouille",
    "Offre": "Offer",
    "Ce qui est compris": "What is included",
    "Prix": "Price",
    "Composer est gratuit. Votre tableau de dessins d’enfants en fichier HD dès 14,90 €, imprimé et encadré dès 79 €, ou à réaliser vous-même avec les originaux (kit DIY 89 €).": "Composing is free. Your canvas of children’s drawings as an HD file from €14.90, printed and framed from €79, or to make yourself with the originals (DIY kit €89).",
    "Tarifs": "Pricing",
    "À télécharger dès 14,90 €, à accrocher dès 79 €, à réaliser vous-même dès 24,90 €.": "To download from €14.90, to hang from €79, to make yourself from €24.90.",
    "Composer est gratuit.": "Composing is free.",
    "Le reste est simple": "The rest is simple",
    "Importez, composez et prévisualisez autant que vous voulez. Vous ne payez que lorsque vous voulez emporter votre œuvre : en fichier, imprimée chez vous, ou à réaliser vous-même avec les dessins originaux.": "Import, compose and preview as much as you like. You only pay when you want to take your artwork home: as a file, printed and delivered, or to make yourself with the original drawings.",
    "À télécharger": "To download",
    "Mon œuvre HD": "My HD artwork",
    "14,90 €": "€14.90",
    "Une composition en haute définition (300 dpi), prête à imprimer où vous voulez": "One composition in high definition (300 dpi), ready to print wherever you like",
    "JPEG, PNG ou PDF à l’échelle, aux tailles de toiles et de cadres du commerce": "JPEG, PNG or to-scale PDF, in shop canvas and frame sizes",
    "Corrections et nouveaux téléchargements inclus pendant 30 jours": "Corrections and new downloads included for 30 days",
    "Avec le guide de découpe et de collage à l’échelle, pour la réaliser vous-même avec les originaux : 24,90 €.": "With the to-scale cutting and gluing guide, to make it yourself with the originals: €24.90.",
    "Composer mon œuvre": "Compose my artwork",
    "Notre préféré": "Our favourite",
    "À accrocher · dès 59 €": "To hang · from €59",
    "Tableau encadré 50 × 70": "Framed print 50 × 70",
    "129 €": "€129",
    "Affiche premium encadrée, prête à accrocher": "Premium poster, framed, ready to hang",
    "Livraison standard incluse en France métropolitaine": "Standard delivery included in mainland France",
    "Le fichier HD offert avec chaque commande": "The HD file included with every order",
    "Aussi en 21 × 30, 30 × 40, 40 × 50 et 70 × 100, sur papier seul ou encadré : grille ci-dessous.": "Also in 21 × 30, 30 × 40, 40 × 50 and 70 × 100, on paper alone or framed: see the table below.",
    "Avec ou sans passe-partout, au même prix : sans, l’œuvre remplit le cadre (un A4 dans le 21 × 30) ; avec, elle est imprimée à la taille en dessous (un A4 dans le 30 × 40, un 30 × 40 dans le 40 × 50, un 40 × 50 dans le 50 × 70, un 50 × 70 dans le 70 × 100).": "With or without a mount, at the same price: without, the artwork fills the frame (an A4 in the 21 × 30); with, it is printed one size down (an A4 in the 30 × 40, a 30 × 40 in the 40 × 50, a 40 × 50 in the 50 × 70, a 50 × 70 in the 70 × 100).",
    "Commander": "Order",
    "Imprimée et livrée chez vous": "Printed and delivered to your door",
    "Prix TTC, livraison standard incluse en France métropolitaine. Le fichier HD est inclus avec chaque commande.": "Prices include VAT and standard delivery in mainland France. The HD file is included with every order.",
    "Taille": "Size",
    "Papier premium, sans cadre": "Premium paper, unframed",
    "Encadré, prêt à accrocher": "Framed, ready to hang",
    "29 €": "€29",
    "49 €": "€49",
    "99 €": "€99",
    "39 €": "€39",
    "79 €": "€79",
    "69 €": "€69",
    "59 €": "€59",
    "109 €": "€109",
    "89 €": "€89",
    "199 €": "€199",
    "169 €": "€169",
    "Chaque tableau imprimé est préparé à partir de vos scans relus en pleine définition : les traits restent nets, même en grand format. Autres tailles et formats beaux-arts sur demande.": "Every print is prepared from your scans re-read at full definition: the lines stay sharp, even in large formats. Other sizes and fine-art formats on request.",
    "Questions fréquentes": "Frequently asked questions",
    "Dois-je payer pour essayer ?": "Do I have to pay to try?",
    "Non. Importer, composer, retoucher et prévisualiser l’œuvre sur la toile ou dans une photo de votre salon est gratuit, sans limite de temps.": "No. Importing, composing, editing and previewing the artwork on the canvas or in a photo of your living room is free, with no time limit.",
    "Que signifie « par composition » ?": "What does “per composition” mean?",
    "Vous payez une fois pour une composition donnée. Pendant 30 jours, vous pouvez la corriger et la retélécharger autant que nécessaire, sans abonnement.": "You pay once for a given composition. For 30 days you can correct it and download it again as often as needed, with no subscription.",
    "Puis-je faire imprimer le fichier ailleurs ?": "Can I have the file printed elsewhere?",
    "Oui. Le fichier HD est à vous : 300 dpi, aux dimensions exactes des toiles et cadres du commerce, avec un PDF à l’échelle si vous préférez.": "Yes. The HD file is yours: 300 dpi, at the exact dimensions of shop canvases and frames, with a to-scale PDF if you prefer.",
    "Les dessins originaux sont-ils abîmés ?": "Are the original drawings damaged?",
    "Pour les tableaux imprimés, jamais : seuls les scans sont utilisés. Avec le kit DIY, c’est vous qui découpez et collez les originaux : ne coupez que ceux que vous voulez voir sur la toile.": "For prints, never: only the scans are used. With the DIY kit, you cut out and glue the originals yourself: only cut the ones you want on the canvas.",
    "Livrez-vous hors de France ?": "Do you deliver outside France?",
    "Les tarifs affichés incluent la livraison standard en France métropolitaine. Pour l’Europe, écrivez-nous : nous établissons un devis de transport.": "The prices shown include standard delivery in mainland France. For Europe, write to us: we will quote the shipping.",
    "Et pour un cadeau ?": "What about a gift?",
    "Le tableau encadré 50 × 70 est pensé pour ça : prêt à accrocher, livré protégé. Indiquez-nous une adresse de livraison différente lors de la commande.": "The 50 × 70 framed print is made for that: ready to hang, delivered protected. Give us a different delivery address when ordering.",
    "Commencez par composer, c’est gratuit": "Start by composing, it’s free",
    // kit DIY
    "Pour la réaliser vous-même avec les originaux : le guide de découpe à 24,90 €, ou le kit complet avec toile et fournitures à 89 €.": "To make it yourself with the originals: the cutting guide at €24.90, or the complete kit with canvas and supplies at €89.",
    "Réalisée par vous, avec les originaux": "Made by you, with the originals",
    "Vous composez dans l’atelier, puis vous découpez et collez les vrais dessins vous-même. Deux façons de s’y mettre.": "You compose in the studio, then cut out and glue the real drawings yourself. Two ways to get started.",
    "Mon atelier DIY": "My DIY studio",
    "Le fichier HD et le guide de création personnalisé en PDF : taille de la toile, plan de pose à l’échelle 1, ordre de collage et, pour chaque dessin, sa fiche de découpe avec le trait de coupe et ses cotes": "The HD file and the personalised making-of guide as a PDF: canvas size, 1:1 layout plan, gluing order and, for each drawing, its cutting sheet with the cut line and measurements",
    "24,90 €": "€24.90",
    "Le kit DIY 50 × 70": "The DIY kit 50 × 70",
    "Un après-midi en famille, et une œuvre unique faite de leurs vrais traits. Livraison standard incluse en France métropolitaine pour le kit.": "One family afternoon, and a unique artwork made of their real lines. Standard delivery included in mainland France for the kit.",
    "Commander le kit": "Order the kit",
    "Composer d’abord": "Compose first",
    // carte kit DIY
    "À réaliser vous-même · dès 24,90 €": "To make yourself · from €24.90",
    "Vous découpez et collez vos dessins originaux, livraison incluse": "You cut out and glue your original drawings, delivery included",
    "Guide seul, en PDF avec le fichier HD : 24,90 €.": "Guide alone, as a PDF with the HD file: €24.90.",
    "Un seul achat par composition, sans abonnement. Le fichier est à vous : imprimez-le où vous voulez.": "One purchase per composition, no subscription. The file is yours: print it wherever you like.",
    "Du téléphone à l’ordinateur": "From phone to computer",
    "Photographiez sur le téléphone, composez sur l’ordinateur": "Photograph on your phone, compose on your computer",
    "Pas besoin de scanner : l’atelier ouvre l’appareil photo du téléphone et vous dit si chaque photo est bonne. Vous retrouvez ensuite l’œuvre sur l’ordinateur, sur grand écran, pour la peaufiner tranquillement.": "No scanner needed: the studio opens your phone’s camera and tells you whether each photo is good. You then find the artwork on your computer, on a big screen, to fine-tune it at leisure.",
    "Ouvrez l’atelier sur l’ordinateur, avec le même compte.": "Open the studio on your computer, with the same account.",
    "Il vous propose de reprendre l’œuvre là où vous l’avez laissée : déplacez, agrandissez, choisissez le cadre, puis commandez.": "It offers to pick up the artwork where you left off: move, enlarge, choose the frame, then order.",
    "Sur le téléphone, connectez-vous avec votre compte gratuit.": "On your phone, sign in with your free account.",
    "Il garde vos photos et l’œuvre en cours automatiquement.": "It keeps your photos and the artwork in progress automatically.",
    "Touchez « Photographier un dessin ».": "Tap “Photograph a drawing”.",
    "Cadrez la feuille : l’atelier vérifie qu’elle est entière, nette et bien éclairée, et vous dit quand prendre la photo.": "Frame the sheet: the studio checks that it is whole, sharp and well lit, and tells you when to take the photo.",
    "L’atelier sur le téléphone, qui vérifie la photo d’un dessin, et la même œuvre ouverte sur l’ordinateur": "The studio on a phone, checking the photo of a drawing, and the same artwork open on a computer",
  };

  var KEY = 'atelier-gribouille:lang';
  function pick() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) { /* ignoré */ }
    if (q === 'fr' || q === 'en') { try { localStorage.setItem(KEY, q); } catch (e) { /* ignoré */ } return q; }
    try { var v = localStorage.getItem(KEY); if (v === 'fr' || v === 'en') return v; } catch (e) { /* ignoré */ }
    // sans choix explicite, le français (langue d'origine du site, et celle que les moteurs de
    // recherche doivent indexer) ; un bandeau ou le bouton FR / EN propose l'anglais
    return 'fr';
  }
  var lang = pick();
  function translate() {
    var ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
    var walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName.toLowerCase() === 'svg' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    var texts = [], n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 1) {
        ATTRS.forEach(function (a) { var v = n.getAttribute(a); if (v && EN[v] !== undefined) n.setAttribute(a, EN[v]); });
        if (n.tagName === 'META') { var c = n.getAttribute('content'); if (c && EN[c] !== undefined) n.setAttribute('content', EN[c]); }
      } else texts.push(n);
    }
    texts.forEach(function (t) {
      var raw = t.nodeValue, key = raw.replace(/\s+/g, ' ').trim();
      if (EN[key] === undefined) return;
      t.nodeValue = raw.match(/^\s*/)[0] + EN[key] + raw.match(/\s*$/)[0];
    });
    document.querySelectorAll('img[data-src-en]').forEach(function (im) { im.src = im.getAttribute('data-src-en'); if (im.getAttribute('data-srcset-en')) im.srcset = im.getAttribute('data-srcset-en'); });
    document.querySelectorAll('svg[aria-label]').forEach(function (s) { var v = s.getAttribute('aria-label'); if (EN[v] !== undefined) s.setAttribute('aria-label', EN[v]); });
    document.querySelectorAll('a[href^="atelier/"]').forEach(function (a) { a.href = a.getAttribute('href') + (a.getAttribute('href').indexOf('?') >= 0 ? '&' : '?') + 'lang=en'; });
    document.documentElement.lang = 'en';
    // la version anglaise a sa propre adresse (?lang=en), déclarée aux moteurs par hreflang
    var canon = document.querySelector('link[rel="canonical"]');
    if (canon) { var u = new URL(canon.href); u.searchParams.set('lang', 'en'); canon.href = u.toString(); }
    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) { var o = new URL(ogUrl.content); o.searchParams.set('lang', 'en'); ogUrl.content = o.toString(); }
    var loc = document.querySelector('meta[property="og:locale"]');
    if (loc) loc.content = 'en_GB';
  }
  function wire() {
    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-lang') === lang);
      b.setAttribute('aria-pressed', b.getAttribute('data-lang') === lang ? 'true' : 'false');
      b.onclick = function () {
        var next = b.getAttribute('data-lang');
        if (next === lang) return;
        try { localStorage.setItem(KEY, next); } catch (e) { /* ignoré */ }
        var url = new URL(location.href); url.searchParams.set('lang', next); location.replace(url.toString());
      };
    });
  }
  function run() { if (lang === 'en') translate(); wire(); }
  if (document.body) run(); else document.addEventListener('DOMContentLoaded', run);
})();
