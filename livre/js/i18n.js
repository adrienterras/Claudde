/*
 * Le livre de dessins — langues. Le français est la langue source (index.html et js/book.js) ;
 * `tr('texte')` ou tr`texte ${valeur}` renvoie la traduction anglaise quand l'anglais est choisi.
 * Même moteur et même choix de langue que l'atelier (clé partagée dans le navigateur).
 */
(function () {
  'use strict';

  const EN = {
    "Atelier Gribouille — le livre de dessins": "Atelier Gribouille — the drawing book",
    "Rassemblez les dessins de vos enfants dans un vrai livre : couverture, légendes, mise en page soignée, et un PDF prêt à imprimer en 300 dpi.": "Gather your children’s drawings in a real book: a cover, captions, a careful layout, and a print-ready 300 dpi PDF.",
    "Accueil Atelier Gribouille": "Atelier Gribouille home",
    "Le livre de dessins": "The drawing book",
    "Rassemblez les dessins de vos enfants dans un vrai livre, comme un album photo : une couverture, une page par dessin ou plusieurs, leurs titres et leurs dates. Le PDF se fait imprimer chez un service d’albums photo ou à la maison.": "Gather your children’s drawings in a real book, like a photo album: a cover, one drawing per page or several, their titles and their dates. The PDF can be printed by a photo book service or at home.",
    "Importer les dessins": "Import the drawings",
    "Reprendre": "Resume",
    "Oublier": "Forget",
    "Déposez vos scans ou vos photos": "Drop your scans or photos",
    "PDF de plusieurs pages, JPG ou PNG · un dessin par page": "Multi-page PDF, JPG or PNG · one drawing per page",
    "Pas de scans sous la main ?": "No scans at hand?",
    "Essayer avec les dessins d’exemple": "Try the sample drawings",
    "Ajoutez d’autres dessins, ou": "Add more drawings, or",
    "commencez un nouveau livre": "start a new book",
    "Le livre": "The book",
    "Titre": "Title",
    "Sous-titre": "Subtitle",
    "Format": "Size",
    "A4 portrait · 21 × 29,7 cm": "A4 portrait · 21 × 29.7 cm",
    "A4 paysage · 29,7 × 21 cm": "A4 landscape · 29.7 × 21 cm",
    "Carré · 21 × 21 cm": "Square · 21 × 21 cm",
    "Grand carré · 30 × 30 cm": "Large square · 30 × 30 cm",
    "Dessins par page": "Drawings per page",
    "Un": "One",
    "Deux": "Two",
    "Quatre": "Four",
    "Papier": "Paper",
    "Couleur du papier": "Paper colour",
    "Titres et dates sous les dessins": "Titles and dates under the drawings",
    "Numéros de page": "Page numbers",
    "Les dessins": "The drawings",
    "Retoucher le dessin": "Edit the drawing",
    "Outil": "Tool",
    "Recadrer": "Crop",
    "Gomme": "Eraser",
    "Taille": "Size",
    "Défaire (Ctrl+Z)": "Undo (Ctrl+Z)",
    "Défaire": "Undo",
    "Tout le dessin": "Whole drawing",
    "Dessin d’origine": "Original drawing",
    "Tirez les coins ou les bords du cadre ; glissez à l’intérieur pour le déplacer.": "Drag the corners or edges of the frame; drag inside it to move it.",
    "Passez sur ce qu’il faut effacer : la gomme peint la couleur du papier du dessin.": "Brush over what should go: the eraser paints the colour of the drawing’s paper.",
    "Annuler": "Cancel",
    "Valider": "Apply",
    "Le dessin retouché n’a pas pu être enregistré sur cet appareil.": "The edited drawing could not be saved on this device.",
    "Ce dessin n’a pas pu être ouvert pour la retouche sur cet appareil.": "This drawing could not be opened for editing on this device.",
    "Recadrer ou gommer": "Crop or erase",
    "L’ordre de la liste est celui du livre. Donnez un titre et une date ou un âge à chaque dessin. Le crayon recadre le dessin ou gomme une zone ; l’étoile choisit le dessin de la couverture.": "The order of the list is the order of the book. Give each drawing a title and a date or an age. The pencil crops the drawing or erases an area; the star picks the cover drawing.",
    "Imprimer": "Print",
    "Qualité": "Quality",
    "Impression · 300 dpi": "Print · 300 dpi",
    "Fichier léger · 150 dpi": "Light file · 150 dpi",
    "Fond perdu 3 mm": "3 mm bleed",
    "Télécharger le livre (PDF)": "Download the book (PDF)",
    "Un PDF, une page par page du livre, couverture comprise. Les services d’albums photo l’acceptent tel quel ; à la maison, imprimez-le en recto verso. Le fond perdu ajoute 3 mm autour de chaque page, comme le demandent la plupart des imprimeurs.": "One PDF, one page per page of the book, cover included. Photo book services accept it as is; at home, print it double-sided. The bleed adds 3 mm around each page, as most printers ask.",
    "L’atelier des œuvres": "The artwork studio",
    "Accueil": "Home",
    "Confidentialité": "Privacy",
    "Vos dessins restent sur votre appareil : rien n’est envoyé.": "Your drawings stay on your device: nothing is uploaded.",
    "Un livre pour tous leurs dessins.": "A book for all their drawings.",
    "Importez les dessins : le livre se compose de lui-même, page après page. Réglez ensuite le titre, l’ordre et les légendes.": "Import the drawings: the book lays itself out, page after page. Then set the title, the order and the captions.",
    "Reprendre le livre en cours": "Resume the book in progress",
    "Voir un exemple": "See an example",
    "A4 portrait": "A4 portrait",
    "A4 paysage": "A4 landscape",
    "carré 21 × 21 cm": "21 × 21 cm square",
    "grand carré 30 × 30 cm": "30 × 30 cm large square",
    "blanc": "white",
    "ivoire": "ivory",
    "lin": "linen",
    "vert sapin": "fir green",
    "lecteur PDF indisponible": "PDF reader unavailable",
    "Lecture des fichiers…": "Reading the files…",
    "Le fichier « {0} » n’a pas pu être lu.": "The file “{0}” could not be read.",
    "Aucun dessin lisible : choisissez des PDF, JPG ou PNG.": "No readable drawing: choose PDF, JPG or PNG files.",
    "Lecture du dessin {0} / {1}…": "Reading drawing {0} / {1}…",
    "Le dessin « {0} » n’a pas pu être lu (image trop grande pour cet appareil ?).": "The drawing “{0}” could not be read (image too large for this device?).",
    "Nos plus beaux dessins": "Our finest drawings",
    "Fait avec Atelier Gribouille · ateliergribouille.art": "Made with Atelier Gribouille · ateliergribouille.art",
    "Couverture": "Cover",
    "4e de couverture": "Back cover",
    "Page blanche": "Blank page",
    "Page {0}": "Page {0}",
    "Pages {0} – {1}": "Pages {0} – {1}",
    "« {0} » · {1} pages · {2} · {3} dessins": "“{0}” · {1} pages · {2} · {3} drawings",
    "couverture": "cover",
    "Titre du dessin": "Drawing title",
    "Titre du dessin {0}": "Title of drawing {0}",
    "Date ou âge · mars 2025, 5 ans": "Date or age · March 2025, age 5",
    "Date ou âge du dessin {0}": "Date or age of drawing {0}",
    "Avancer d’une place": "Move up one place",
    "Reculer d’une place": "Move down one place",
    "Tourner d’un quart de tour": "Rotate a quarter turn",
    "Mettre en couverture": "Put on the cover",
    "Retirer du livre": "Remove from the book",
    "Ce dessin n’a pas pu être tourné sur cet appareil.": "This drawing could not be rotated on this device.",
    " (fond perdu compris)": " (bleed included)",
    "{0} pages de {1} × {2} cm{3}, couverture comprise.": "{0} pages of {1} × {2} cm{3}, cover included.",
    "1 dessin sera un peu flou à cette taille : un scan en 300 dpi sera plus net.": "1 drawing will be slightly blurry at this size: a 300 dpi scan will be sharper.",
    "{0} dessins seront un peu flous à cette taille : un scan en 300 dpi sera plus net.": "{0} drawings will be slightly blurry at this size: a 300 dpi scan will be sharper.",
    "Livre de dessins": "Drawing book",
    "livre de dessins": "drawing book",
    "La bibliothèque PDF n’a pas pu être chargée. Rechargez la page.": "The PDF library could not be loaded. Reload the page.",
    "Mise en page {0} / {1}…": "Laying out page {0} / {1}…",
    "Livre prêt : {0} ({1} Mo).": "Book ready: {0} ({1} MB).",
    "Le PDF n’a pas pu être créé sur cet appareil. Choisissez « Fichier léger · 150 dpi » et réessayez.": "The PDF could not be created on this device. Choose “Light file · 150 dpi” and try again.",
    "Livre en cours retrouvé : {0} dessins, {1}.": "Book in progress found: {0} drawings, {1}.",
    "Réouverture du livre…": "Reopening the book…",
    "Réouverture du livre : {0} / {1}…": "Reopening the book: {0} / {1}…",
    "Chargement des dessins d’exemple…": "Loading the sample drawings…",
    "Les dessins de Léa": "Lea’s drawings",
    "Un exemple, avec des dessins de démonstration": "An example, with demonstration drawings",
    "Les dessins d’exemple n’ont pas pu être chargés. Importez vos scans ci-dessus.": "The sample drawings could not be loaded. Import your scans above.",
    "Commencer un nouveau livre ? Les dessins et les légendes de celui-ci seront effacés.": "Start a new book? The drawings and captions of this one will be erased.",
    "soleil": "sun",
    "maison": "house",
    "chat": "cat",
    "arc en ciel": "rainbow",
    "bonhomme": "little man",
    "fleur": "flower",
    "arbre": "tree",
    "bateau": "boat",
    "coeurs": "hearts",
    "papillon": "butterfly",
    "voiture": "car",
    "oiseau": "bird",
    "soleil et bonhomme": "sun and little man",
    "escargot": "snail",
  };

  const KEY = 'atelier-gribouille:lang';
  const LANGS = ['fr', 'en'];

  function pick() {
    let q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) { /* ignoré */ }
    if (LANGS.includes(q)) { try { localStorage.setItem(KEY, q); } catch (e) { /* ignoré */ } return q; }
    try { const v = localStorage.getItem(KEY); if (LANGS.includes(v)) return v; } catch (e) { /* ignoré */ }
    return /^fr\b/i.test(navigator.language || '') ? 'fr' : 'en';
  }

  const lang = pick();
  const dict = lang === 'en' ? EN : null;
  const missing = new Set();

  function lookup(key) {
    if (!dict) return key;
    const v = dict[key];
    if (v === undefined) { missing.add(key); return key; }
    return v;
  }

  // tr('texte') ou tr`texte ${valeur}` : la clé est le texte français, les expressions deviennent {0}, {1}…
  function tr(strs, ...vals) {
    if (typeof strs === 'string') return lookup(strs);
    let key = strs[0];
    for (let i = 1; i < strs.length; i++) key += '{' + (i - 1) + '}' + strs[i];
    return lookup(key).replace(/\{(\d+)\}/g, (m, i) => (vals[i] === undefined || vals[i] === null ? '' : String(vals[i])));
  }

  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  function translateDom(root) {
    if (!dict) return;
    root = root || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          const tag = n.tagName;
          return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'svg' || tag === 'SVG' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const texts = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 1) {
        ATTRS.forEach((a) => { const v = n.getAttribute(a); if (v && dict[v] !== undefined) n.setAttribute(a, dict[v]); });
        if (n.tagName === 'META' && n.getAttribute('name') === 'description' && dict[n.getAttribute('content')] !== undefined) n.setAttribute('content', dict[n.getAttribute('content')]);
      } else texts.push(n);
    }
    texts.forEach((t) => {
      const raw = t.nodeValue;
      const key = raw.replace(/\s+/g, ' ').trim();
      const v = dict[key];
      if (v === undefined) return;
      const lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
      t.nodeValue = lead + v + tail;
    });
    document.documentElement.lang = lang;
  }

  function set(next) {
    if (!LANGS.includes(next) || next === lang) return;
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignoré */ }
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url.toString());
  }

  // Le sélecteur de langue : boutons [data-lang] présents dans la page
  function wireSwitch() {
    document.querySelectorAll('[data-lang]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false');
      b.classList.toggle('on', b.dataset.lang === lang);
      b.onclick = () => {
        // le livre en cours est gardé avant de recharger la page dans l'autre langue
        const book = window.LivreGribouille;
        if (book && book.state.drawings.length) { book.saveMeta().then(() => set(b.dataset.lang)); return; }
        set(b.dataset.lang);
      };
    });
  }

  window.tr = tr;
  window.I18n = {
    lang,
    locale: lang === 'fr' ? 'fr-FR' : (/^en-/.test(navigator.language || '') ? navigator.language : 'en-GB'),
    tr,
    translate: translateDom,
    set,
    missing: () => Array.from(missing),
    has: (key) => !dict || dict[key] !== undefined,
    dict: EN,
  };

  if (document.body) { translateDom(); wireSwitch(); }
  else document.addEventListener('DOMContentLoaded', () => { translateDom(); wireSwitch(); });
})();
