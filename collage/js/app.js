/* Atelier Gribouille — interface : import des scans, gestion des dessins, édition interactive et export. */
(function () {
  'use strict';

  // Résolution conservée pour chaque page scannée (plus grand côté) : la plus haute possible, selon
  // le nombre de pages et la mémoire de l'appareil, pour que les découpes gardent tout leur détail à
  // l'impression. Chaque page garde environ 1,6 toile pleine en mémoire (page, texture ou découpes).
  const SOURCE_MIN = 1400, SOURCE_CAP = 2800, SOURCE_CAP_PHONE = 2000;
  function sourceMax(nPages) {
    const mobile = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900;
    const mem = Math.min(8, navigator.deviceMemory || (mobile ? 4 : 8)); // Go
    const budget = mem * (mobile ? 0.05 : 0.1) * 1e9; // octets accordés aux pages
    const perPagePx = 1.6 * 4 * 0.71; // octets par pixel² de grand côté (format ≈ 1/√2)
    const long = Math.sqrt(budget / (Math.max(1, nPages) * perPagePx));
    return Math.round(Math.max(SOURCE_MIN, Math.min(mobile ? SOURCE_CAP_PHONE : SOURCE_CAP, long)));
  }
  const $ = (id) => document.getElementById(id);
  // Échappe toute donnée (nom de fichier, titre, réponse de Claude, ligne de la base) insérée dans du HTML.
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeData = (u) => (typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : '');

  // Capteur d'erreur global : une erreur imprévue (hors des zones déjà protégées) n'est jamais
  // silencieuse. Elle s'affiche en haut de la page, avec son détail à copier pour la signaler.
  (function errorCatcher() {
    const box = $('fatal');
    if (!box) return;
    const seen = new Set();
    let detail = '';
    const show = (what, err) => {
      const msg = (err && err.message) || (typeof err === 'string' ? err : '') || String(err || 'erreur inconnue');
      if (/ResizeObserver loop/.test(msg)) return; // avertissement bénin de certains navigateurs
      const stack = (err && err.stack) || '';
      const key = what + msg;
      if (seen.has(key)) return;
      seen.add(key);
      detail = `${what} : ${msg}\n${stack}\n\n${navigator.userAgent}\n${location.href}`;
      box.querySelector('.fatal-text').textContent = tr`Une erreur inattendue s’est produite (${msg}). L’app peut continuer ; si elle ne répond plus, rechargez la page. Le détail copié m’aide à corriger.`;
      box.hidden = false;
    };
    window.addEventListener('error', (e) => { if (e.message || e.error) show('Erreur', e.error || e.message); });
    window.addEventListener('unhandledrejection', (e) => show(tr('Promesse rejetée'), e.reason));
    $('fatal-close').onclick = () => { box.hidden = true; };
    $('fatal-reload').onclick = () => location.reload();
    $('fatal-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(detail); $('fatal-copy').textContent = tr('Détail copié'); }
      catch (e) { window.prompt(tr('Copiez ce détail :'), detail); }
    };
    window.AtelierErrors = { show, get detail() { return detail; } };
  })();

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = window.PDFJS_WORKER_SRC || 'vendor/pdf.worker.min.js';

  // Message affiché dans le panneau (les boîtes de dialogue du navigateur ne sont pas toujours disponibles).
  function notice(text) {
    const el = $('notice');
    el.textContent = text || '';
    el.hidden = !text;
  }

  const state = {
    drawings: [],   // { id, name, thumb, analysis, role, srcLong, origLong, physCm, sizeCm, sizeMode }
    current: null,  // dessin affiché dans le panneau de détail
    comp: null,
    seed: 1,
    selected: null,
    bgCache: null,
    zoom: { z: 1, px: 0, py: 0 }, // zoom de la vue sur l'œuvre
    seq: 0,
  };

  // Formats de feuille (plus grand côté, en cm)
  const SHEETS = [['A5', 21], ['A4', 29.7], ['A3', 42], ['A2', 59.4]];
  // Tailles de page PDF correspondant à un vrai format physique (plus grand côté, en points)
  // Formats physiques (points PDF) : [petit côté, grand côté]. Un scanner à plat produit des pages
  // à ces dimensions exactes ; un scan de téléphone donne des tailles quelconques.
  const PHYSICAL_PT = [[419.5, 595.3], [595.3, 841.9], [841.9, 1190.6], [1190.6, 1683.8], [612, 792], [612, 1008]];

  // ---------- Import ----------

  const tick = () => new Promise((r) => setTimeout(r, 0));
  const mobileQuery = window.matchMedia('(max-width: 860px)');

  function setProgress(done, total, label) {
    const p = $('progress');
    // pendant la réouverture d'une composition, la progression s'affiche sous « Mes compositions »
    // seulement : la barre du haut ferait sauter la page
    p.hidden = done >= total || !!state.restoring;
    p.querySelector('div').style.width = `${(100 * done) / Math.max(1, total)}%`;
    p.querySelector('span').textContent = label || `${done} / ${total}`;
    if (state.restoring && label && $('saved-status')) { const el = $('saved-status'); el.textContent = tr`Réouverture : ${label}`; el.hidden = false; }
  }

  async function pagesFromFile(file) {
    const pages = [];
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      // Gros scans (100 Mo et plus) : le fichier est lu en une fois, mais chaque page est rendue
      // à son tour à la résolution de travail, puis libérée, pour que la mémoire reste stable.
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        pages.push({
          name: `${file.name} — p.${i}`,
          source: { file, index: i - 1 },
          render: async (max) => {
            const page = await pdf.getPage(i);
            const vp0 = page.getViewport({ scale: 1 });
            const long = Math.max(vp0.width, vp0.height);
            const vp = page.getViewport({ scale: max / long });
            const c = Extract.makeCanvas(vp.width, vp.height);
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            // pixels réels de la page : ceux de la plus grande image qu'elle contient (un scan est
            // une image posée sur la page) ; une page sans image (vectorielle) n'a pas de limite
            let pxLong = null;
            try {
              const ops = await page.getOperatorList();
              const O = pdfjsLib.OPS;
              for (let k = 0; k < ops.fnArray.length; k++) {
                const fn = ops.fnArray[k], a = ops.argsArray[k];
                let im = null;
                if (fn === O.paintInlineImageXObject) im = a[0];
                else if (fn === O.paintImageXObject) {
                  const id = a[0];
                  if (typeof id === 'string') im = page.objs.has(id) ? page.objs.get(id) : (page.commonObjs.has(id) ? page.commonObjs.get(id) : null);
                }
                if (im && im.width && im.height) pxLong = Math.max(pxLong || 0, im.width, im.height);
              }
            } catch (e) { pxLong = null; }
            page.cleanup();
            // Un PDF de scanner à plat donne la vraie taille de la feuille ;
            // un scan de téléphone donne seulement une taille en pixels.
            const short = Math.min(vp0.width, vp0.height);
            const physical = PHYSICAL_PT.some(([a, b]) => Math.abs(short / a - 1) < 0.012 && Math.abs(long / b - 1) < 0.012);
            return { canvas: c, origLong: long, origShort: short, physCm: physical ? (long / 72) * 2.54 : null, pxLong };
          },
          release: () => pdf.destroy(),
        });
      }
    } else if ((file.type || '').startsWith('image/') || isHeic(file)) {
      pages.push({
        name: file.name,
        source: { file, index: 0 },
        render: async (max) => {
          // une image de plusieurs dizaines de Mo est décodée par le navigateur puis réduite
          // à la résolution de travail ; on ne garde jamais l'image complète en mémoire
          const src = await decodeImage(file);
          const c = Extract.scaleTo(src.img, max);
          const origLong = Math.max(src.w, src.h), origShort = Math.min(src.w, src.h);
          src.close();
          // Un scanner écrit sa résolution (150, 300, 600 dpi) dans le JPEG ou le PNG : elle donne
          // la taille réelle de la feuille. Les valeurs par défaut (72, 96) ne veulent rien dire.
          let dpi = null, jpegQ = null;
          try {
            const head = await file.slice(0, 256 * 1024).arrayBuffer();
            dpi = readDpi(head);
            if (window.Quality) jpegQ = Quality.jpegQuality(head);
          } catch (e) { dpi = null; }
          const physCm = dpi ? (origLong / dpi) * 2.54 : null;
          return { canvas: c, origLong, origShort, physCm: physCm && physCm >= 8 && physCm <= 150 ? physCm : null, physSource: physCm ? `${dpi} dpi` : null, pxLong: origLong, jpegQ };
        },
      });
    }
    return pages;
  }

  // Décode une image en respectant l'orientation EXIF. Les très grandes images passent par un
  // élément <img>, que le navigateur sait décoder sans tout garder en mémoire, sinon par ImageBitmap.
  // Les photos HEIC de l'iPhone arrivent telles quelles (sans conversion par le téléphone, qui
  // faisait patienter le sélecteur de photos) : Safari les décode, de préférence par <img>.
  const isHeic = (f) => /^image\/hei[cf]/i.test(f.type || '') || /\.hei[cf]$/i.test(f.name || '');
  async function decodeImage(file) {
    const viaImg = async () => {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => { img.src = ''; URL.revokeObjectURL(url); } };
      } catch (e) { URL.revokeObjectURL(url); throw e; }
    };
    const viaBitmap = async () => {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close && bmp.close() };
    };
    const [first, second] = file.size > 12e6 || isHeic(file) ? [viaImg, viaBitmap] : [viaBitmap, viaImg];
    try { return await first(); } catch (e) {
      console.warn('premier décodage impossible, second essai', e);
      return second();
    }
  }

  // Vignette ; en PNG pour les pièces découpées, qui ont un fond transparent.
  function thumbOf(canvas, max, png) {
    return Extract.scaleTo(canvas, max || 160).toDataURL(png ? 'image/png' : 'image/jpeg', 0.8);
  }

  // Résolution déclarée dans l'en-tête d'une image : JFIF (densité), EXIF (XResolution + unité) ou PNG (pHYs).
  // Renvoie des dpi plausibles pour un scanner, ou null.
  function readDpi(buf) {
    const b = new DataView(buf), n = b.byteLength;
    const plausible = (v) => (v >= 100 && v <= 1200 && Math.abs(v - 96) > 2 ? Math.round(v) : null);
    if (n > 24 && b.getUint32(0) === 0x89504e47) {
      // PNG : chunks ; pHYs = pixels par mètre
      for (let p = 8; p + 12 <= n;) {
        const len = b.getUint32(p), type = String.fromCharCode(b.getUint8(p + 4), b.getUint8(p + 5), b.getUint8(p + 6), b.getUint8(p + 7));
        if (type === 'pHYs' && b.getUint8(p + 16) === 1) return plausible(b.getUint32(p + 8) * 0.0254);
        if (type === 'IDAT' || type === 'IEND') return null;
        p += 12 + len;
      }
      return null;
    }
    if (n > 4 && b.getUint16(0) === 0xffd8) {
      let jfif = null;
      for (let p = 2; p + 4 <= n;) {
        if (b.getUint8(p) !== 0xff) break;
        const marker = b.getUint8(p + 1), len = b.getUint16(p + 2);
        if (marker === 0xda) break; // début des données
        if (marker === 0xe0 && p + 16 <= n && b.getUint32(p + 4) === 0x4a464946) {
          const units = b.getUint8(p + 11), x = b.getUint16(p + 12);
          if (units === 1) jfif = plausible(x); else if (units === 2) jfif = plausible(x * 2.54);
        }
        if (marker === 0xe1 && p + 14 <= n && b.getUint32(p + 4) === 0x45786966) {
          // EXIF : TIFF à p+10 ; XResolution (0x011a, RATIONAL) et ResolutionUnit (0x0128 : 2 = pouce, 3 = cm)
          const t = p + 10, le = b.getUint16(t) === 0x4949;
          const u16 = (o) => b.getUint16(o, le), u32 = (o) => b.getUint32(o, le);
          const ifd = t + u32(t + 4);
          if (ifd + 2 <= n) {
            const cnt = u16(ifd);
            let xres = null, unit = 2;
            for (let i = 0; i < cnt && ifd + 2 + i * 12 + 12 <= n; i++) {
              const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2);
              if (tag === 0x011a && type === 5) { const off = t + u32(e + 8); if (off + 8 <= n) { const den = u32(off + 4); xres = den ? u32(off) / den : null; } }
              if (tag === 0x0128) unit = u16(e + 8);
            }
            if (xres) { const v = plausible(unit === 3 ? xres * 2.54 : xres); if (v) return v; }
          }
        }
        p += 2 + len;
      }
      return jfif;
    }
    return null;
  }

  // Empreinte d'un fichier (taille + début du contenu) : reconnaît un fichier déjà importé, même
  // renommé (copie « … 2.JPG » faite par le téléphone ou l'ordinateur).
  async function fileKey(f) {
    try {
      const head = await f.slice(0, 512 * 1024).arrayBuffer();
      const h = await crypto.subtle.digest('SHA-1', head);
      return `${f.size}:${Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    } catch (e) { return `${f.size}:${f.name}`; }
  }

  /*
   * opts : { quiet, sample, longs } — longs[i] : résolution de travail (grand côté) imposée au
   * fichier i ; la réouverture d'une œuvre relit chaque dessin à la résolution qu'il avait, pour
   * retrouver exactement la même page (et donc replacer les retouches de découpe au bon endroit).
   */
  async function importFiles(files, sizes, opts) {
    let pages = [];
    if (!state.restoring && !(opts && opts.sample)) window.Atelier.track('Import', { fichiers: Math.min(files.length, 50) });
    state.sceneLayout = null;
    state.pinned = null;
    notice('');
    setProgress(0, 1, tr('Lecture des fichiers…'));
    const known = new Set(state.drawings.map((d) => d.fileKey).filter(Boolean));
    const twins = [];
    for (let fi = 0; fi < files.length; fi++) {
      const f = files[fi];
      try {
        const key = await fileKey(f);
        // un fichier déjà dans l'atelier n'est pas importé une deuxième fois (sauf à la réouverture)
        if (!state.restoring && known.has(key)) { twins.push(f.name); continue; }
        known.add(key);
        const ps = await pagesFromFile(f);
        ps.forEach((pg) => { pg.fileIndex = fi; pg.fileKey = key; });
        pages = pages.concat(ps);
      } catch (e) {
        console.error(e);
        notice(tr`Impossible de lire « ${f.name} ». Vérifiez qu’il s’agit d’un PDF, JPG ou PNG.`);
      }
    }
    if (twins.length) notice(twins.length === 1 ? tr`« ${twins[0]} » est déjà dans l’atelier (même fichier) : il n’a pas été ajouté une deuxième fois.` : tr`${twins.length} fichiers sont déjà dans l’atelier (mêmes fichiers) : ils n’ont pas été ajoutés une deuxième fois.`);
    const releases = new Set(pages.map((p) => p.release).filter(Boolean));
    const max = sourceMax(state.drawings.length + pages.length);
    const longs = (opts && opts.longs) || [];
    for (let i = 0; i < pages.length; i++) {
      setProgress(i, pages.length, tr`Analyse du dessin ${i + 1} / ${pages.length}…`);
      await tick();
      try {
        const want = longs[pages[i].fileIndex];
        const src = await pages[i].render(want > 0 ? want : max);
        // une image ou un scan de téléphone peut être une photo du dessin posé sur un sol ou une table
        Extract.removeSurface.debug = null;
        const analysis = Extract.analyze(src.canvas, 0, { photo: true });
        const photoDebug = Extract.removeSurface.debug;
        const d = {
          id: ++state.seq, name: pages[i].name, thumb: thumbOf(analysis.page), analysis, base: analysis, role: 'auto',
          orient: 'auto', orientDeg: 0,
          original: src.canvas, photo: analysis.photo || null, photoMode: 'auto', photoDebug,
          source: pages[i].source || null, // fichier d'origine : relu en haute définition à l'export
          fileKey: pages[i].fileKey || null,
          srcLong: Math.max(src.canvas.width, src.canvas.height), origLong: src.origLong, origShort: src.origShort || 1, physCm: src.physCm, physSource: src.physSource || (src.physCm ? 'PDF' : null),
          sizeCm: 29.7, sizeMode: 'auto',
          // qualité pour l'impression (voir js/quality.js) : pixels réels et mesures faites ici une fois
          pxLong: src.pxLong || null,
          q: Object.assign(window.Quality ? Quality.measure(src.canvas) : {}, { jpeg: src.jpegQ || null }),
        };
        preparePieces(analysis.pieces, d);
        loadSize(d);
        loadOrient(d);
        loadTone(d);
        if (sizes && sizes[d.name]) { d.sizeCm = sizes[d.name]; d.sizeMode = 'manual'; }
        state.drawings.push(d);
      } catch (e) {
        console.error(e);
        notice(tr`Le dessin « ${pages[i].name} » n’a pas pu être analysé (image trop grande pour cet appareil ?).`);
      }
    }
    releases.forEach((release) => { try { release(); } catch (e) { /* déjà libéré */ } });
    setProgress(1, 1);
    estimateSizes();
    state.drawings.forEach(ensureMaterial);
    curate();
    planCoverage();
    if (state.drawings.length) {
      ['drawings-section', 'sizes-section', 'compose-section', 'export-section', 'room-section'].forEach((id) => ($(id).hidden = false));
      $('empty').hidden = true;
      $('restart-offer').hidden = false;
      if (!state.restoring) selectTab('compose-section');
    }
    refreshLists();
    regenerate();
    clearHistory(); // les dessins ont changé : les anciens instantanés ne valent plus
    if (!(opts && opts.quiet)) artDirect();
  }

  /*
   * Taille réelle des feuilles.
   * Sans information physique, on suppose que les scans ont été faits à une distance
   * comparable : la taille en pixels est alors proportionnelle à la taille de la feuille.
   * Le scan « médian » est pris pour un A4, et chaque estimation est arrondie au format
   * standard le plus proche. L'utilisateur peut corriger dessin par dessin.
   */
  function estimateSizes() {
    const unknown = state.drawings.filter((d) => !d.physCm);
    const longs = unknown.map((d) => d.origLong).sort((a, b) => a - b);
    const median = longs.length ? longs[Math.floor(longs.length / 2)] : 1;
    // Étalonnage : les tailles saisies à la main sur des scans sans résolution connue servent de référence
    // aux autres (même scanner, même échelle). Prudence : il faut au moins deux références qui concordent
    // (à 15 % près) et correspondent à une résolution de scanner plausible ; une affiche de 90 cm
    // photographiée au téléphone, ou une seule feuille corrigée, ne doivent pas redimensionner tout l'import.
    const refs = unknown.filter((d) => d.sizeMode === 'manual' && d.origLong > 0 && d.sizeCm > 0)
      .map((d) => d.sizeCm / d.origLong)
      .filter((cmPx) => { const dpi = 2.54 / cmPx; return dpi >= 72 && dpi <= 1200; })
      .sort((a, b) => a - b);
    let calib = null;
    if (refs.length >= 2) {
      const med = refs[Math.floor(refs.length / 2)];
      if (refs.every((v) => Math.abs(v / med - 1) < 0.15)) calib = med;
    }
    state.drawings.forEach((d) => {
      d.uncertain = false;
      if (d.sizeMode !== 'auto') return;
      if (d.physCm) { d.sizeCm = d.physCm; return; }
      const est = calib ? d.origLong * calib : (d.origLong / median) * 29.7;
      const ratio = d.origLong / Math.max(1, d.origShort);
      const sheetLike = ratio > 1.15 && ratio < 1.75; // proportions plausibles d'une feuille
      // étalonnée, l'estimation est précise : on n'arrondit à un format standard qu'à 3 % près
      const snap = SHEETS.find(([, cm]) => Math.abs(est / cm - 1) < (calib ? 0.03 : 0.15));
      // on n'arrondit à un format standard que si la feuille en a les proportions ;
      // un rouleau, une bande ou un très grand format restent à leur estimation, à vérifier
      d.sizeCm = sheetLike && snap ? snap[1] : Math.round(est * 2) / 2;
      d.uncertain = calib ? false : !(sheetLike && snap) || est > 45 || est < 15;
      d.calibrated = !!calib;
      // Photo prise au téléphone (dessin posé sur un sol, une table) : le nombre de pixels dépend de la
      // distance de prise de vue, pas de la feuille. On reste entre A5 et A3 et on demande confirmation.
      if (d.photo && !calib) { d.sizeCm = Math.min(42, Math.max(15, d.sizeCm)); d.uncertain = true; }
    });
  }

  // Bandeau « tailles à vérifier » : les feuilles dont la taille n'a pas pu être reconnue.
  function renderUncertain() {
    const box = $('sizes-check');
    const list = state.drawings.filter((d) => d.uncertain && d.sizeMode === 'auto');
    box.hidden = !list.length;
    const alert = $('sizes-alert');
    if (alert) {
      alert.hidden = !list.length;
      alert.querySelector('span').textContent = list.length === 1 ? tr('1 dessin a une taille estimée : vérifiez-la pour un guide de découpe exact.') : tr`${list.length} dessins ont une taille estimée : vérifiez-les pour un guide de découpe exact.`;
    }
    if (!list.length) return;
    box.innerHTML = `<p class="sizes-title">Tailles à vérifier <small>(${list.length})</small></p>
      <p class="hint">${tr('Ces feuilles n’ont pas un format standard : indiquez leur plus grand côté, en cm. C’est ce qui fixe leur taille dans l’œuvre.')}</p>
      <div class="sizes-list"></div>`;
    const wrap = box.querySelector('.sizes-list');
    list.forEach((d) => {
      const row = document.createElement('label');
      row.className = 'sizes-row';
      row.innerHTML = `<img src="${d.thumb}" alt=""><span class="sizes-name">${tr`Dessin ${state.drawings.indexOf(d) + 1}`}<small>${d.photo ? tr`photo : ${fmt(d.sizeCm)} cm ?` : tr`estimé ${fmt(d.sizeCm)} cm`}</small></span>
        <span class="sizes-input"><span class="sizes-chips">${SHEETS.slice(0, 3).map(([n, cm]) => `<button type="button" data-cm="${cm}" title="${n} · ${fmt(cm)} cm">${n}</button>`).join('')}</span><input type="number" min="3" max="300" step="0.5" placeholder="${fmt(d.sizeCm).replace(',', '.')}" aria-label="${tr('Plus grand côté en cm')}"><em>cm</em></span>`;
      const apply = (cm) => {
        if (!(cm > 0)) return;
        d.sizeCm = cm;
        d.sizeMode = 'manual';
        saveSize(d);
        estimateSizes();
        state.pinned = null;
        refreshLists();
        regenerate();
      };
      const input = row.querySelector('input');
      input.onchange = () => apply(Number(input.value));
      row.querySelectorAll('[data-cm]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); apply(Number(b.dataset.cm)); }; });
      wrap.appendChild(row);
    });
  }

  const cmPerPx = (d) => d.sizeCm / d.srcLong;

  // Les tailles corrigées à la main sont mémorisées dans ce navigateur (clé : fichier + page).
  const sizeKey = (d) => `atelier-collage:taille:${d.name}:${Math.round(d.origLong)}`;
  function loadSize(d) {
    try {
      const v = Number(localStorage.getItem(sizeKey(d)));
      if (v > 0) { d.sizeCm = v; d.sizeMode = 'manual'; }
    } catch (e) { /* stockage indisponible : on garde l'estimation */ }
  }
  function saveSize(d) {
    try { localStorage.setItem(sizeKey(d), String(d.sizeCm)); } catch (e) { /* ignoré */ }
  }

  // ---------- Orientation des feuilles ----------

  const ORIENTS = [['auto', tr('Automatique')], ['0', tr('Droite, comme scannée')], ['90', tr('Couchée, haut à droite')], ['180', tr('Tête en bas')], ['270', tr('Couchée, haut à gauche')]];
  const orientKey = (d) => `atelier-gribouille:orientation:${d.name}:${Math.round(d.origLong)}`;
  function loadOrient(d) {
    try {
      const v = localStorage.getItem(orientKey(d));
      if (v && ORIENTS.some(([k]) => k === v)) d.orient = v;
    } catch (e) { /* stockage indisponible */ }
  }
  function saveOrient(d) {
    try { localStorage.setItem(orientKey(d), d.orient); } catch (e) { /* ignoré */ }
  }

  // ---------- Luminosité et contraste ----------

  // { b, c, s } en % (−50 à +50) : luminosité, contraste, saturation ; absent ou nul : le dessin tel que scanné
  const toneKey = (d) => `atelier-gribouille:tons:${d.name}:${Math.round(d.origLong)}`;
  const hasTone = (d) => !!(d.tone && (d.tone.b || d.tone.c || d.tone.s));
  // même rendu que l'œuvre (voir Compose.toned), pour les vignettes
  const toneFilter = (d) => (d && hasTone(d) ? `brightness(${1 + (d.tone.b || 0) / 100}) contrast(${1 + (d.tone.c || 0) / 100}) saturate(${1 + (d.tone.s || 0) / 100})` : '');
  const toneStyle = (d) => (hasTone(d || {}) ? ` style="filter: ${toneFilter(d)}"` : '');
  function loadTone(d) {
    try {
      const v = JSON.parse(localStorage.getItem(toneKey(d)) || 'null');
      if (v && (v.b || v.c || v.s)) d.tone = { b: Number(v.b) || 0, c: Number(v.c) || 0, s: Number(v.s) || 0 };
    } catch (e) { /* stockage indisponible */ }
  }
  function saveTone(d) {
    try {
      if (hasTone(d)) localStorage.setItem(toneKey(d), JSON.stringify(d.tone));
      else localStorage.removeItem(toneKey(d));
    } catch (e) { /* ignoré */ }
  }

  // Orientation retenue : celle de l'utilisateur, sinon droite, sauf une page de fond trop haute
  // pour la toile, qu'on couche.
  function effectiveOrient(d) {
    if (d.orient !== 'auto') return Number(d.orient);
    if (roleOf(d) !== 'texture' || !state.canvasSize) return 0;
    const page = d.base.page;
    const c = d.sizeCm / Math.max(page.width, page.height);
    const w = page.width * c, h = page.height * c;
    const { w: W, h: H } = state.canvasSize;
    if (h > H && w <= H && h <= W) return 90;
    return 0;
  }

  // Applique l'orientation : la page tournée devient la page de travail (découpes, fond, fiches).
  function applyOrientation(d) {
    const deg = effectiveOrient(d);
    if (deg === d.orientDeg) return false;
    d.orientDeg = deg;
    if (deg === 0) d.analysis = d.base;
    else {
      const a = Extract.rotated(d.base, deg);
      // la page tournée garde la découpe ou le fond décidés pour la page droite
      a.kind = d.base.kind;
      d.analysis = a;
    }
    d.thumb = thumbOf(d.analysis.page);
    preparePieces(d.analysis.pieces, d);
    if (d.analysis.pieces) curateDrawing(d);
    ensureMaterial(d);
    return true;
  }

  // Photo sur une surface : bascule entre le dessin détouré et la photo entière.
  // mode : 'auto' (sol reconnu automatiquement), 'force' (retrait demandé par l'utilisateur), 'keep' (photo entière)
  function setPhotoMode(d, mode) {
    if (!d.original || d.photoMode === mode) return;
    const a = Extract.analyze(d.original, 0, { photo: mode !== 'keep', force: mode === 'force' });
    if (mode !== 'keep' && !a.photo) { notice(tr('Impossible de séparer un dessin de cette image : le dessin doit occuper une partie seulement de la photo, le reste montrant la surface.')); d.photoDebug = Extract.removeSurface.debug; refreshLists(); return; }
    d.photoMode = mode;
    d.base = a; d.analysis = a; d.orientDeg = 0;
    d.photo = a.photo || null;
    d.thumb = thumbOf(a.page);
    preparePieces(a.pieces, d);
    if (a.pieces) curateDrawing(d);
    ensureMaterial(d);
    planCoverage();
    state.pinned = null;
    refreshLists();
    regenerate();
  }

  function applyOrientations() {
    let changed = false;
    state.drawings.forEach((d) => { if (applyOrientation(d)) changed = true; });
    if (changed) refreshLists();
  }

  function sheetName(cm) {
    const s = SHEETS.find(([, v]) => Math.abs(v - cm) < 0.05);
    return s ? s[0] : `${fmt(cm)} cm`;
  }

  const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString(I18n.locale);

  // ---------- Dessins & pièces ----------

  const ROLES = ['cutout', 'texture', 'off'];
  const ROLE_LABEL = { cutout: tr('découpe'), texture: tr('fond'), off: tr('ignoré') };
  const roleLabel = (d) => (roleOf(d) === 'off' && d.role === 'auto' ? tr('de côté') : ROLE_LABEL[roleOf(d)]);
  const asideDrawings = () => state.drawings.filter((d) => d.role === 'auto' && d.auto === 'off');

  // Rôle d'un dessin : choix de l'utilisateur, sinon celui du directeur artistique (Claude),
  // sinon celui de l'analyse d'image.
  function roleOf(d) {
    if (d.role !== 'auto') return d.role;
    // un dessin photographié sur un sol et détouré est toujours une découpe (jamais une page entière)
    if (d.photo && d.photoMode !== 'keep') return 'cutout';
    if (d.auto) return d.auto; // choix du plan de couverture
    if (d.ai) return d.ai.role === 'fond' ? 'texture' : 'cutout';
    // Un dessin au crayon gris (souvent avec du texte) se découpe mal : on le colle en page entière.
    if (d.analysis.kind === 'cutout' && pale(d)) return ($('pale') ? $('pale').value : 'aside') === 'decoupe' ? 'cutout' : 'texture';
    return d.analysis.kind;
  }

  /*
   * Plan de couverture : la toile doit être remplie en entier avec le papier disponible.
   * On note chaque dessin comme fond (page couverte de peinture, colorée, grande, sujet peu lisible)
   * et on passe en fond, par ordre de mérite, autant de dessins qu'il faut pour que la surface
   * des pages de fond dépasse la toile à l'échelle choisie.
   */
  function bgMerit(d) {
    const a = d.analysis;
    const painted = 1 - (a.paperFrac === undefined ? 0.5 : a.paperFrac); // part de la page peinte
    const t = a.texture || Extract.textureFrom(a.page);
    a.texture = t;
    const ps = a.pieces || [];
    const main = ps.reduce((x, b) => (!x || b.frac > x.frac ? b : x), null);
    const subject = main ? main.frac * (0.3 + main.colorful) : 0; // force du sujet à découper
    const ai = d.ai ? (d.ai.role === 'fond' ? 0.35 : -0.15 * (d.ai.importance || 1)) : 0;
    // un bon fond : peint en larges aplats colorés (calme), grand ; une page chargée de petits
    // motifs reste une découpe, où ses détails sont un atout
    const calm = t.calm === undefined ? 0.5 : t.calm;
    // le calme ne compte qu'allié à la couleur : une feuille blanche est calme mais n'est pas un fond
    const flatColour = painted * (0.4 + 0.6 * calm) * (0.3 + 1.2 * (t.colorful || 0));
    return flatColour * 1.8 + Math.min(1, d.sizeCm / 42) * 0.3 - subject * 1.5 + ai;
  }

  function pageAreaCm2(d) {
    const a = d.analysis.page;
    const c = cmPerPx(d);
    return a.width * c * a.height * c;
  }

  function paperAreas(drawings) {
    let bgArea = 0, pieceArea = 0;
    drawings.forEach((d) => {
      if (roleOf(d) === 'texture') { bgArea += pageAreaCm2(d); return; }
      if (roleOf(d) !== 'cutout') return;
      (d.analysis.pieces || []).filter((p) => p.enabled).forEach((p) => {
        const c = cmPerPx(d);
        let fill = 0;
        for (let i = 0; i < p.hit.data.length; i++) fill += p.hit.data[i];
        pieceArea += p.canvas.width * c * p.canvas.height * c * (fill / p.hit.data.length);
      });
    });
    return { bgArea, pieceArea };
  }

  /*
   * Plan de couverture, à taille réelle. Le papier de fond doit couvrir la toile avec 15 % de
   * recouvrement, et les découpes en couvrir environ la moitié (réglage « densité »).
   *  - toile automatique : on passe en fond, par ordre de mérite, juste assez de pages pour que
   *    le fond suffise aux découpes, et la toile prend la taille du fond ;
   *  - toile imposée : on passe en fond juste assez de pages pour la couvrir, et on dit s'il manque du papier.
   */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Densité au maximum : tous les dessins chargés doivent être pris en compte.
  const allIn = () => Number($('density').value) >= 1.79;

  function planCoverage() {
    const v = $('format').value;
    const auto = v.startsWith('auto:');
    const density = Number($('density').value);
    const cands = state.drawings.filter((d) => d.role === 'auto');
    cands.forEach((d) => { d.auto = null; });
    // une feuille pâle (crayon gris, texte) ne se découpe pas : elle est toujours un papier de fond
    // Sur l'exemple de référence, le fond n'est fait que de pages colorées : les feuilles pâles
    // (crayon gris, texte) sont mises de côté par défaut ; un réglage permet de les coller en fond.
    const paleOnes = cands.filter((d) => d.analysis.kind === 'cutout' && pale(d));
    // feuilles pâles : mises de côté par défaut ; au-delà de la mi-course du curseur de densité, elles
    // rejoignent le fond progressivement (les plus colorées d'abord), toutes au maximum
    const paleMode = $('pale') ? $('pale').value : 'aside';
    const t = (Number($('density').value) - 0.5) / 1.3;
    // une feuille pâle où Claude reconnaît un vrai sujet (nuage, bonhomme au crayon) se découpe
    // comme les autres ; les autres suivent le réglage
    const recognised = (d) => d.ai && d.ai.role === 'decoupe' && !d.ai.texte && d.ai.sujet;
    paleOnes.filter(recognised).forEach((d) => { d.auto = 'cutout'; ensureMaterial(d); });
    const paleLeft = paleOnes.filter((d) => !recognised(d));
    if (paleMode === 'decoupe') {
      // tout au crayon se découpe, sauf une page qui ne contient que de l'écriture (lignes de texte)
      let aside = 0;
      paleLeft.forEach((d) => {
        if (d.textOnly === undefined) d.textOnly = Extract.textOnly(d.analysis.page);
        const text = d.ai && d.ai.texte !== undefined ? d.ai.texte : d.textOnly;
        if (text && !allIn()) { d.auto = 'off'; aside++; } else { d.auto = 'cutout'; ensureMaterial(d); }
      });
      state.paleCount = aside;
    } else {
      const mode = allIn() ? 'fond' : paleMode;
      const share = mode === 'fond' ? 1 : clamp((t - 0.5) / 0.5, 0, 1);
      const nPaleLeft = Math.round(paleLeft.length * share);
      paleLeft.slice().sort((a, b) => (b.analysis.texture ? b.analysis.texture.colorful : 0) - (a.analysis.texture ? a.analysis.texture.colorful : 0))
        .forEach((d, i) => { d.auto = i < nPaleLeft ? 'texture' : 'off'; if (d.auto === 'texture') ensureMaterial(d); });
      state.paleCount = paleLeft.length;
    }
    // seules les pages franchement peintes ou colorées peuvent faire le fond (comme sur l'exemple) ;
    // une feuille blanche avec un petit dessin reste une découpe
    const bgEligible = (d) => {
      const a = d.analysis;
      const t = a.texture || (a.texture = Extract.textureFrom(a.page));
      const painted = 1 - (a.paperFrac === undefined ? 0.5 : a.paperFrac);
      // un sujet net et coloré (une bougie photographiée sur du parquet) reste une découpe
      const main = (a.pieces || []).reduce((x, b) => (!x || b.frac > x.frac ? b : x), null);
      if (a.kind === 'cutout' && (a.paperFrac || 0) >= 0.3 && main && main.frac > 0.25 && main.colorful > 0.35) return false;
      return painted >= 0.5 || (painted >= 0.33 && (t.colorful || 0) >= 0.3);
    };
    const rest = cands.filter((d) => !paleOnes.includes(d));
    rest.forEach((d) => { if (!bgEligible(d) || (d.photo && d.photoMode !== 'keep')) d.auto = 'cutout'; });
    const ranked = rest.filter(bgEligible).sort((a, b) => bgMerit(b) - bgMerit(a));
    const forcedBg = state.drawings.filter((d) => d.role === 'texture').reduce((sum, d) => sum + pageAreaCm2(d), 0);
    const minBg = ranked.length ? Math.min(ranked.length, Math.max(2, ranked.filter((d) => d.auto === 'texture' || d.analysis.kind === 'texture').length)) : 0;
    let chosen = { nBg: minBg, area: 7000 };
    if (auto) {
      const ratio = Number(v.slice(5)) || 1.4;
      const r = Math.max(ratio, 1 / ratio); // indépendant de l'orientation
      // la plus grande page de fond doit tenir entière sur la toile (on ne la découpe pas) :
      // surface minimale de toile pour que ses deux côtés y tiennent, au ratio choisi
      const bgMin = () => {
        let long = 0, short = 0;
        state.drawings.forEach((d) => {
          if (roleOf(d) !== 'texture') return;
          const a = d.analysis.page, c = cmPerPx(d);
          long = Math.max(long, Math.max(a.width, a.height) * c + 1);
          short = Math.max(short, Math.min(a.width, a.height) * c + 1);
        });
        return { long, short, area: Math.max((long * long) / r, short * short * r) };
      };
      for (let nBg = minBg; nBg <= ranked.length; nBg++) {
        ranked.forEach((d, i) => { d.auto = i < nBg ? 'texture' : 'cutout'; });
        const { bgArea, pieceArea } = paperAreas(state.drawings);
        const m = bgMin();
        const canvasArea = bgArea / 1.5; // les pages entières se chevauchent franchement (≈ 1/3 de recouvrement)
        chosen = { nBg, area: canvasArea, min: m };
        // assez de papier pour couvrir aussi la toile élargie par la plus grande page, et de la place pour les découpes
        if ((canvasArea >= m.area * 0.85 && pieceArea <= 0.5 * density * canvasArea) || nBg >= ranked.length) break;
      }
      state.canvasArea = Math.max(chosen.area, 900);
      state.bgMin = chosen.min;
      state.paperArea = paperAreas(state.drawings).bgArea;
      state.coverage = 1.5;
    } else {
      const [w, h] = v.split('x').map(Number);
      const canvasArea = w * h;
      let nBg = minBg;
      for (; nBg <= ranked.length; nBg++) {
        ranked.forEach((d, i) => { d.auto = i < nBg ? 'texture' : 'cutout'; });
        const { bgArea } = paperAreas(state.drawings);
        if (bgArea >= canvasArea * 1.3) break;
      }
      chosen = { nBg: Math.min(nBg, ranked.length) };
      ranked.forEach((d, i) => { d.auto = i < chosen.nBg ? 'texture' : 'cutout'; });
      state.coverage = paperAreas(state.drawings).bgArea / canvasArea;
    }
    ranked.forEach((d, i) => { d.auto = i < chosen.nBg ? 'texture' : 'cutout'; });
    ranked.forEach((d) => ensureMaterial(d));
  }

  function pale(d) {
    const ps = d.analysis.pieces || [];
    const main = ps.reduce((a, b) => (!a || b.frac > a.frac ? b : a), null);
    return !main || main.colorful < 0.1;
  }

  function ensureMaterial(d) {
    const a = d.analysis;
    const role = roleOf(d);
    if (role === 'cutout' && !a.pieces) {
      a.pieces = Extract.recut(a);
      preparePieces(a.pieces, d);
    }
    if (role === 'texture' && !a.texture) a.texture = Extract.textureFrom(a.page);
  }

  function preparePieces(pieces, d) {
    (pieces || []).forEach((p) => {
      p.id = ++state.seq;
      p.enabled = true;
      p.drawing = d;
      p.thumb = thumbOf(p.canvas, 120, true);
    });
  }

  /*
   * Tous les dessins entrent dans l'œuvre : chaque dessin découpé apporte son sujet principal
   * (sa plus grande pièce), plus ses autres sujets exploitables (colorés, pas des traits fins).
   */
  // Tous les sujets d'un dessin entrent par défaut : le principal (sa plus grande pièce) et chaque
  // autre élément qui ressemble à un sujet (coloré, au moins 4 cm) : personnages, nuages, soleils…
  // L'utilisateur peut en désactiver, et Claude écarte les fragments s'il a pu les regarder.
  function curateDrawing(d) {
    const ps = d.analysis.pieces || [];
    const main = ps.reduce((a, b) => (!a || b.frac > a.frac ? b : a), null);
    const c = cmPerPx(d);
    // (seuil large : un nuage au crayon gris ou un petit bonhomme sont peu colorés mais sont des sujets)
    const ar = (p) => p.canvas.width / p.canvas.height;
    const subject = (p) => p.frac > 0.002 && p.colorful >= 0.04 && Math.min(ar(p), 1 / ar(p)) > 0.12 && Math.max(p.canvas.width, p.canvas.height) * c >= 3;
    ps.forEach((p) => { p.enabled = subject(p); p.main = false; });
    if (main) { main.enabled = true; main.main = true; }
    // Claude a regardé chaque élément découpé : on garde tout ce qu'il reconnaît comme un vrai sujet
    // (personnage, nuage, soleil, animal…), même petit, et on écarte les fragments ; le sujet principal
    // reste si rien d'autre ne tient
    if (ps.some((p) => p.ai)) {
      ps.forEach((p) => { if (p.ai) p.enabled = p.ai.garder; });
      if (main && !ps.some((p) => p.enabled)) main.enabled = true;
    }
  }

  function curate() {
    state.drawings.forEach(curateDrawing);
  }

  // Un bon sujet : assez grand, coloré (les traits de crayon gris et les textes passent après),
  // et pas un simple trait fin.
  function eligible(p) {
    const ar = p.canvas.width / p.canvas.height;
    return p.frac > 0.006 && p.colorful >= 0.15 && Math.min(ar, 1 / ar) > 0.15;
  }

  function rank(p) {
    return Math.sqrt(p.frac) * Math.pow(p.colorful, 1.3);
  }

  function activePieces() {
    return state.drawings.filter((d) => roleOf(d) === 'cutout').flatMap((d) => d.analysis.pieces || []);
  }

  // Bandeau des feuilles mises de côté (pâles : crayon gris, texte), avec leurs numéros.
  function renderAside() {
    const box = $('aside-note');
    if (!box) return;
    const list = asideDrawings();
    box.hidden = !list.length;
    if (!list.length) return;
    const nums = list.map((d) => state.drawings.indexOf(d) + 1);
    box.innerHTML = `<b>${tr`${list.length} feuille${list.length > 1 ? 's' : ''} mise${list.length > 1 ? 's' : ''} de côté`}</b> ${tr`— pâles (crayon gris, texte), comme sur l’œuvre de référence : dessins n° ${nums.join(', ')}.`}
      ${tr('Elles n’apparaissent pas dans l’œuvre ni dans le guide. Pour les coller en fond, réglez « Feuilles pâles » ; pour en garder une en découpe, ouvrez-la et choisissez « découpe ».')}`;
  }

  // ---------- Qualité pour l'impression (js/quality.js) ----------

  const qualityOf = (d) => (window.Quality ? Quality.assess(Object.assign({}, d, { auto: d.auto })) : { level: 'ok', issues: [] });
  function qualityBadge(d) {
    if (roleOf(d) === 'off') return '';
    const q = qualityOf(d);
    if (q.level === 'ok') return '';
    return `<i class="q ${q.level}" title="${esc(q.issues.map((x) => x.title).join(' · '))}" aria-label="${esc(q.level === 'bad' ? tr('Qualité insuffisante pour l’impression') : tr('Qualité à vérifier'))}">!</i>`;
  }
  function qualityBlock(d) {
    const q = qualityOf(d);
    if (q.level === 'ok') return '';
    return `<div class="quality ${q.level}">${q.issues.map((x) => `<p><b>${esc(x.title)}</b> ${esc(x.text)}<br><span>${esc(x.tip)}</span></p>`).join('')}</div>`;
  }
  // bandeau dans Propositions et rappel au moment d'exporter
  function renderQuality() {
    const list = state.drawings.filter((d) => roleOf(d) !== 'off').map((d) => ({ d, q: qualityOf(d) })).filter((x) => x.q.level !== 'ok');
    const bad = list.filter((x) => x.q.level === 'bad').length;
    const box = $('quality-alert');
    if (box) {
      box.hidden = !list.length;
      box.classList.toggle('bad', bad > 0);
      box.querySelector('span').textContent = !list.length ? ''
        : bad ? (bad === 1 ? tr('1 dessin risque d’être flou à l’impression.') : tr`${bad} dessins risquent d’être flous à l’impression.`) + (list.length > bad ? ' ' + tr`${list.length - bad} autre(s) à vérifier.` : '')
          : (list.length === 1 ? tr('1 dessin a une qualité à vérifier pour l’impression.') : tr`${list.length} dessins ont une qualité à vérifier pour l’impression.`);
    }
    const note = $('export-quality');
    if (note) {
      note.hidden = !bad;
      note.textContent = bad ? tr`Attention : ${bad} dessin(s) de l’œuvre seront flous en impression. Remplacez-les par un scan à 300 dpi ou une photo d’origine, ou choisissez une impression plus petite.` : '';
    }
    state.qualityList = list.map((x) => x.d);
  }

  function refreshLists() {
    renderUncertain();
    renderAside();
    renderQuality();
    const dEl = $('drawings');
    dEl.innerHTML = '';
    state.drawings.forEach((d) => {
      const role = roleOf(d);
      const el = document.createElement('div');
      el.className = `thumb ${role}${state.current === d ? ' current' : ''}`;
      el.title = d.ai ? `${d.ai.sujet} — ${d.name}` : d.name;
      el.innerHTML = `<img src="${d.thumb}" alt=""${toneStyle(d)}><b class="tag ${role}">${roleLabel(d)}</b>${d.photo && d.photoMode !== 'keep' ? tr('<b class="tag photo" title="Photo sur un sol ou une table : fond retiré">détouré</b>') : ''}<i class="size${d.uncertain && d.sizeMode === 'auto' ? ' unsure' : ''}">${d.uncertain && d.sizeMode === 'auto' ? '? ' : ''}${sheetName(d.sizeCm)}</i>${qualityBadge(d)}`;
      el.onclick = () => {
        state.current = state.current === d ? null : d;
        // choisir un dessin dans la liste ne sélectionne rien sur l'œuvre (et retire la sélection en cours)
        if (state.selected) { state.selected = null; updateToolbar(); render(); }
        refreshLists();
        // téléphone : la fiche s'ouvre en haut du tiroir, agrandi pour qu'on la voie en entier
        if (state.current && mobileQuery.matches) {
          document.body.classList.remove('sheet-tall');
          document.body.classList.add('sheet-detail');
          const panel = document.querySelector('.panel'), box = $('detail');
          if (panel && box) setTimeout(() => { panel.scrollTo({ top: Math.max(0, box.offsetTop - 12), behavior: 'smooth' }); }, 60);
        }
      };
      dEl.appendChild(el);
    });
    $('drawings-count').textContent = `(${state.drawings.length})`;
    renderDetail();
    refreshPieces();
  }

  function renderDetail() {
    const box = $('detail');
    const d = state.current;
    box.hidden = !d;
    if (!d) return;
    const role = roleOf(d);
    const k = scale();
    const ar = d.analysis.page.width / d.analysis.page.height;
    const longOnArt = d.sizeCm * k;
    const [aw, ah] = ar >= 1 ? [longOnArt, longOnArt / ar] : [longOnArt * ar, longOnArt];
    const idx = state.drawings.indexOf(d), n = state.drawings.length;
    const std = SHEETS.find(([, cm]) => Math.abs(cm - d.sizeCm) < 0.05);
    const deg = d.orient === 'auto' ? (d.orientDeg || 0) : Number(d.orient);
    const orientName = (ORIENTS.find(([k]) => k === (d.orient === 'auto' ? 'auto' : String(deg))) || ORIENTS[0])[1];
    const main = mainPiece(d);
    box.innerHTML = `
      <button type="button" class="detail-close" aria-label="${tr('Fermer')}" title="${tr('Fermer')}">×</button>
      <img src="${d.thumb}" alt=""${toneStyle(d)}>
      <div>
        <p class="name">${d.ai ? `${esc(d.ai.sujet)} <small>· ${esc(d.ai.zone)}</small><br>` : ''}<small>${esc(d.name)}</small></p>
        <div class="detail-nav">
          <button type="button" data-nav="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="${tr('Dessin précédent')}" title="${tr('Dessin précédent')}"><svg class="ico"><use href="#i-prev"/></svg></button>
          <span>${tr`Dessin ${idx + 1} sur ${n}`}</span>
          <button type="button" data-nav="1" ${idx >= n - 1 ? 'disabled' : ''} aria-label="${tr('Dessin suivant')}" title="${tr('Dessin suivant')}"><svg class="ico"><use href="#i-next"/></svg></button>
        </div>
        <div class="seg">${ROLES.map((r) => `<button data-role="${r}" class="${r === role ? 'on ' + r : ''}">${ROLE_LABEL[r]}</button>`).join('')}</div>
        <div class="row stack">${tr('Taille réelle')}
          <div class="chips" role="group" aria-label="${tr('Taille réelle')}">
            ${SHEETS.map(([nm, cm]) => `<button type="button" data-cm="${cm}" class="${std && std[1] === cm ? 'on' : ''}" title="${nm} · ${fmt(cm)} cm">${nm}</button>`).join('')}
            <button type="button" data-cm="custom" class="${std ? '' : 'on'}">${tr('Autre…')}</button>
          </div>
        </div>
        <label class="row" data-custom ${std ? 'hidden' : ''}>${tr('Plus grand côté (cm)')}
          <input type="number" min="3" max="200" step="0.5" value="${fmt(d.sizeCm).replace(',', '.')}">
        </label>
        <div class="row">${tr('Orientation')}
          <span class="orient">
            <button type="button" data-rot="-90" aria-label="${tr('Tourner à gauche')}" title="${tr('Tourner à gauche')}"><svg class="ico"><use href="#i-rot-left"/></svg></button>
            <button type="button" data-rot="90" aria-label="${tr('Tourner à droite')}" title="${tr('Tourner à droite')}"><svg class="ico"><use href="#i-rot-right"/></svg></button>
            <button type="button" data-rot="auto" class="${d.orient === 'auto' ? 'on' : ''}" title="${esc(orientName)}">${tr('Auto')}</button>
          </span>
        </div>
        ${main ? '' : `<div class="tone" role="group" aria-label="${tr('Luminosité, contraste et saturation')}">
          ${[['b', tr('Luminosité')], ['c', tr('Contraste')], ['s', tr('Saturation')]].map(([k, label]) => `<label class="row"><span>${label}</span>
            <input type="range" min="-50" max="50" step="1" value="${(d.tone && d.tone[k]) || 0}" data-tone="${k}"><output>${toneText((d.tone && d.tone[k]) || 0)}</output></label>`).join('')}
          <div class="tone-actions">
            <button type="button" class="btn btn-sm tone-auto" data-tone-auto title="${tr('Régler luminosité, contraste et saturation d’après l’analyse du dessin')}"><svg class="ico"><use href="#i-spark"/></svg><span>${tr('Ajuster automatiquement')}</span></button>
            <button type="button" class="link" data-tone-reset ${hasTone(d) ? '' : 'hidden'}>${tr('Rétablir')}</button>
          </div>
          <p class="hint" data-tone-msg hidden></p>
        </div>`}
        ${main ? `<button type="button" class="btn btn-sm detail-edit" data-edit title="${tr('Découpe, lumière et couleurs')}"><svg class="ico"><use href="#i-scissors"/></svg><span>${tr('Retoucher le dessin')}</span></button>` : ''}
        <p class="hint photo">${d.photo
          ? tr`Photo sur ${d.photo.kind === 'bois' ? tr('du bois ou du parquet') : tr('un sol ou une table')} : le fond a été retiré et le dessin détouré. <button class="link" data-photo="keep">Garder la photo entière</button>`
          : d.photoMode === 'keep'
            ? tr('Photo gardée entière, avec le sol ou la table. <button class="link" data-photo="auto">Retirer le fond</button>')
            : tr('Dessin photographié sur un sol, une table, du bois ? <button class="link" data-photo="force">Retirer le fond autour du dessin</button>')}</p>
        ${qualityBlock(d)}
        <p class="hint">${d.sizeMode === 'auto' ? (d.physCm ? tr`Taille lue dans le scan (${d.physSource || 'PDF'}).` : d.calibrated ? tr('Taille déduite des feuilles que vous avez corrigées.') : tr('Taille estimée d’après le scan — corrigez-la si besoin.')) : tr('Taille saisie.')}
          ${tr`Sur l’œuvre : ${fmt(aw)} × ${fmt(ah)} cm, à sa taille réelle.`}</p>
      </div>`;
    box.querySelector('.detail-close').onclick = () => {
      state.current = null;
      refreshLists();
      // téléphone : le tiroir reprend sa hauteur normale et montre la liste
      if (mobileQuery.matches) { document.body.classList.remove('sheet-tall', 'sheet-detail'); const panel = document.querySelector('.panel'); if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' }); }
    };
    box.querySelectorAll('[data-photo]').forEach((b) => (b.onclick = () => setPhotoMode(d, b.dataset.photo)));
    box.querySelectorAll('[data-role]').forEach((b) => (b.onclick = () => {
      d.role = b.dataset.role;
      ensureMaterial(d);
      state.pinned = null; // la composition rouverte ne correspond plus aux dessins
      refreshLists();
      regenerate();
    }));
    box.querySelectorAll('[data-rot]').forEach((b) => (b.onclick = () => {
      const r = b.dataset.rot;
      d.orient = r === 'auto' ? 'auto' : String((((deg + Number(r)) % 360) + 360) % 360);
      saveOrient(d);
      state.pinned = null;
      regenerate();
      refreshLists();
    }));
    // dessin précédent / suivant, sans fermer la fiche
    box.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => {
      const next = state.drawings[idx + Number(b.dataset.nav)];
      if (!next) return;
      state.current = next;
      refreshLists();
      const nb = $('detail').querySelector(`[data-nav="${b.dataset.nav}"]`);
      if (nb && !nb.disabled) nb.focus({ preventScroll: true });
    }));
    // luminosité, contraste et saturation d'une page de fond (une découpe se règle dans la fenêtre
    // de retouche) : l'œuvre suit en direct, sans recomposer
    if (!main) {
      const applyTone = () => {
        const t = d.tone || {};
        box.querySelectorAll('[data-tone]').forEach((r) => { const v = t[r.dataset.tone] || 0; r.value = v; r.nextElementSibling.textContent = toneText(v); });
        box.querySelector('[data-tone-reset]').hidden = !hasTone(d);
        box.querySelector(':scope > img').style.filter = toneFilter(d);
        const th = $('drawings').children[state.drawings.indexOf(d)];
        if (th) th.querySelector('img').style.filter = toneFilter(d);
        state.bgCache = null;
        render();
      };
      const toneDone = () => { saveTone(d); refreshPieces(); refreshActiveThumb(); };
      box.querySelectorAll('[data-tone]').forEach((r) => {
        r.oninput = () => { d.tone = Object.assign({ b: 0, c: 0, s: 0 }, d.tone, { [r.dataset.tone]: Number(r.value) }); toneMsg(''); applyTone(); };
        r.onchange = toneDone;
      });
      const toneMsg = (txt) => { const m = box.querySelector('[data-tone-msg]'); m.textContent = txt; m.hidden = !txt; };
      box.querySelector('[data-tone-reset]').onclick = () => { delete d.tone; toneMsg(''); applyTone(); toneDone(); };
      box.querySelector('[data-tone-auto]').onclick = () => {
        const t = Compose.autoTone(toneSources(d));
        if (t.b || t.c || t.s) d.tone = t; else delete d.tone;
        toneMsg(hasTone(d) ? tr('Réglé d’après le dessin : blanc du papier, traits et couleurs. Ajustez à votre goût.') : tr('Ce dessin est déjà bien exposé : rien à corriger.'));
        applyTone();
        toneDone();
      };
    }
    const editBtn = box.querySelector('[data-edit]');
    if (editBtn) editBtn.onclick = () => editPiece(main);
    const custom = box.querySelector('[data-custom]');
    const setSize = (cm) => {
      if (!(cm > 0)) return;
      d.sizeCm = cm;
      d.sizeMode = 'manual';
      saveSize(d);
      estimateSizes();
      state.pinned = null;
      refreshLists();
      regenerate();
    };
    box.querySelectorAll('[data-cm]').forEach((b) => (b.onclick = () => {
      if (b.dataset.cm === 'custom') {
        box.querySelectorAll('[data-cm]').forEach((x) => x.classList.toggle('on', x === b));
        custom.hidden = false;
        custom.querySelector('input').focus();
        return;
      }
      setSize(Number(b.dataset.cm));
    }));
    custom.querySelector('input').onchange = (e) => setSize(Number(e.target.value));
  }

  // les pixels réellement collés : pièces découpées gardées, sinon la page de fond
  function toneSources(d) {
    const a = d.analysis;
    if (roleOf(d) === 'cutout' && a.pieces) {
      const ps = a.pieces.filter((p) => p.enabled !== false);
      if (ps.length) return ps.map((p) => p.canvas);
    }
    return [a.texture ? a.texture.canvas : a.page];
  }
  const toneText = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

  function mainPiece(d) {
    if (roleOf(d) !== 'cutout') return null;
    return (d.analysis.pieces || []).reduce((a, b) => (!a || b.canvas.width * b.canvas.height > a.canvas.width * a.canvas.height ? b : a), null);
  }

  function refreshPieces() {
    const pEl = $('pieces');
    pEl.innerHTML = '';
    const pieces = activePieces();
    pieces.forEach((p) => {
      const el = document.createElement('div');
      const unplaced = p.enabled && state.comp && !p.placed;
      el.className = `thumb${p.enabled ? '' : ' off'}${unplaced ? ' unplaced' : ''}`;
      el.title = !p.enabled ? tr('Retirée — cliquer pour l’ajouter') : unplaced ? tr('Pas de place à cette échelle — cliquer pour l’ajouter quand même') : tr('Dans l’œuvre — cliquer pour la retirer');
      el.innerHTML = tr`<img src="${p.thumb}" alt=""><button class="edit-piece" title="Retoucher la découpe" aria-label="Retoucher la découpe"><svg class="ico"><use href="#i-scissors"/></svg></button>`;
      el.querySelector('img').style.filter = toneFilter(p.drawing);
      el.onclick = () => togglePiece(p);
      el.querySelector('.edit-piece').onclick = (e) => { e.stopPropagation(); editPiece(p); };
      pEl.appendChild(el);
    });
    const inArt = state.comp ? state.comp.items.length : 0;
    $('pieces-count').textContent = tr`(${inArt} dans l’œuvre / ${pieces.length})`;
  }

  function togglePiece(p) {
    if (!state.comp) return;
    commit();
    const inArt = state.comp.items.some((L) => L.piece === p);
    if (inArt) {
      const L = state.comp.items.find((x) => x.piece === p);
      if (L && L.frame !== undefined) p.lastFrame = L.frame; // Galerie : pour remettre la pièce dans son cadre
      state.comp.items = state.comp.items.filter((L) => L.piece !== p);
      p.enabled = false;
      p.placed = false;
      if (state.selected && state.selected.piece === p) state.selected = null;
    } else {
      p.enabled = true;
      sizePiece(p, scale());
      state.selected = Compose.addPiece(state.comp, p, ++state.seq);
    }
    refreshPieces();
    render();
  }

  // ---------- Échelle ----------

  // Toile : soit un format imposé, soit une taille calculée d'après le papier disponible
  // (les dessins sont toujours à leur taille réelle : c'est la toile qui s'adapte).
  /*
   * Fond de toile : un aplat de peinture acrylique, dans les teintes classiques du commerce
   * (gammes Pébéo, Lefranc Bourgeois, Liquitex…). Il couvre toute la toile, ce qui permet une œuvre
   * aérée quand il n'y a pas assez de dessins pour tout recouvrir.
   */
  const PAINTS = [ // [nom, teinte, aptitude comme fond (les teintes calmes portent mieux les dessins)]
    [tr('Blanc de titane'), '#f4f2ec', 0.9], [tr('Jaune de Naples'), '#f2dc9a', 1.0], [tr('Jaune primaire'), '#f6cf1e', 0.4], [tr('Ocre jaune'), '#c8933a', 0.9],
    [tr('Orange de cadmium'), '#e8722a', 0.4], [tr('Rouge de cadmium'), '#c9322b', 0.5], [tr('Magenta primaire'), '#c8367d', 0.4], [tr('Rose'), '#e9a3b6', 0.6],
    [tr('Terre de Sienne brûlée'), '#8a4b2c', 0.8], [tr('Terre d’ombre brûlée'), '#5b3d2a', 0.9], [tr('Vert de vessie'), '#4f6a2a', 0.9], [tr('Vert émeraude'), '#1f8a5a', 0.6],
    [tr('Vert olive'), '#7a7b3f', 1.0], [tr('Bleu turquoise'), '#2e9fb5', 0.6], [tr('Bleu céruléum'), '#3f8fce', 0.7], [tr('Bleu primaire cyan'), '#1b7bc0', 0.5],
    [tr('Bleu outremer'), '#2a3d8f', 0.8], [tr('Bleu de Prusse'), '#1c2d4a', 1.0], [tr('Violet dioxazine'), '#4a2a6a', 0.7], [tr('Gris de Payne'), '#4b5561', 1.0],
    [tr('Noir de Mars'), '#1f1e1c', 0.8],
  ];
  const hexRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const hsl = (rgb) => {
    const [r, g, b] = rgb.map((v) => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return { h: 0, s: 0, l: l * 255 };
    const d = mx - mn;
    const s2 = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: s2, l: l * 255 };
  };

  /*
   * Couleur de fond conseillée pour une composition : celle qui fait ressortir les dessins.
   * On regarde la couleur d'ensemble des éléments (pondérée par leur surface) : le fond doit
   * contraster en clarté (fond sombre sous des papiers clairs, clair sous des papiers sombres),
   * se placer plutôt en face de la teinte dominante sur le cercle chromatique, et rester une
   * teinte calme. La Galerie n'est pas concernée : son fond reste blanc, fixe.
   */
  function pickGround(o, style) {
    let wsum = 0, r = 0, g = 0, b = 0, hx = 0, hy = 0, satW = 0;
    const add = (color, area, colorful) => {
      if (!color || !(area > 0)) return;
      const c = hsl(color);
      wsum += area; r += color[0] * area; g += color[1] * area; b += color[2] * area;
      const w = area * c.s * (colorful === undefined ? 1 : 0.5 + colorful);
      hx += Math.cos((c.h * Math.PI) / 180) * w; hy += Math.sin((c.h * Math.PI) / 180) * w; satW += w;
    };
    o.pieces.forEach((p) => add(p.color, p.wcm * p.hcm, p.colorful));
    o.textures.forEach((t) => add(t.color, t.wcm * t.hcm * 0.6, t.colorful));
    if (!wsum) return PAINTS[1];
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / wsum;
    const domHue = (Math.atan2(hy, hx) * 180) / Math.PI;
    const domStrength = Math.min(1, satW / wsum);
    let best = null;
    // Nuage et Frise : un fond clair et calme, les dessins doivent respirer dessus
    const light = style === 'nuage' || style === 'frise';
    PAINTS.forEach((paint) => {
      const c = hsl(hexRgb(paint[1]));
      if (light && c.l < 150) return;
      let score = Math.min(1, Math.abs(c.l - L) / 110) * 2 + paint[2] * 1.5;
      if (c.s > 0.25) {
        const d = ((c.h - domHue) * Math.PI) / 180;
        score += ((1 - Math.cos(d)) / 2) * 1.2 * domStrength;
      }
      if (!best || score > best.score) best = { paint, score };
    });
    return best.paint;
  }

  function groundPaint() {
    return state.ground && state.ground !== 'auto' ? PAINTS.find((c) => c[1] === state.ground) || null : null;
  }
  // 'auto' : la couleur conseillée pour chaque proposition ; '' : toile nue ; sinon une teinte
  function setGround(hex) {
    state.ground = hex === undefined ? 'auto' : hex;
    try { localStorage.setItem('atelier.ground', state.ground || 'none'); } catch (e) { /* ignoré */ }
    document.querySelectorAll('#ground button').forEach((b) => {
      const on = (b.dataset.hex || '') === (state.ground || '');
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    updateGroundName();
  }
  function updateGroundName() {
    const el = $('ground-name');
    if (state.comp && state.comp.style === 'galerie') { el.textContent = tr('blanc, fixe en Galerie'); return; }
    if (state.ground === 'auto') el.textContent = state.comp && state.comp.groundName ? tr`conseillé · ${state.comp.groundName}` : tr('conseillé selon la composition');
    else { const paint = groundPaint(); el.textContent = paint ? paint[0] : tr('toile nue'); }
  }
  function fillGround() {
    const box = $('ground');
    const mk = (name, hex) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.title = name; b.setAttribute('aria-label', name);
      b.dataset.hex = hex || '';
      if (hex) b.style.setProperty('--sw', hex); else b.className = 'none';
      b.onclick = () => { setGround(hex); regenerate(); };
      box.appendChild(b);
    };
    mk(tr('Couleur conseillée selon la composition'), 'auto');
    mk('Toile nue (lin, sans peinture)', '');
    PAINTS.forEach(([name, hex]) => mk(name, hex));
    box.querySelector('[data-hex="auto"]').className = 'auto';
    box.querySelector('[data-hex="auto"]').textContent = 'A';
    let saved = null;
    try { saved = localStorage.getItem('atelier.ground'); } catch (e) { /* ignoré */ }
    setGround(saved === 'none' ? '' : saved && PAINTS.some((c) => c[1] === saved) ? saved : 'auto');
  }

  // Orientation de la toile choisie par l'utilisateur : 'land' (paysage) ou 'port' (portrait).
  function canvasOrient() {
    return state.canvasOrient || 'land';
  }
  function setCanvasOrient(o) {
    state.canvasOrient = o;
    try { localStorage.setItem('atelier.canvasOrient', o); } catch (e) { /* ignoré */ }
    document.querySelectorAll('#canvas-orient button').forEach((b) => {
      const on = b.dataset.orient === o;
      b.classList.toggle('on', on); b.classList.toggle('ink', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    fillFormats();
  }

  function formatCm() {
    const v = $('format').value;
    const portrait = canvasOrient() === 'port';
    if (v.startsWith('auto:')) {
      const r0 = Number(v.slice(5));
      const ratio = portrait ? 1 / r0 : r0;
      const A = state.canvasArea || 7000;
      let w = Math.sqrt(A * ratio), h = Math.sqrt(A / ratio);
      // agrandie si besoin pour que la plus grande page de fond tienne entière
      // en gardant la proportion demandée (classique, allongée ou carrée) : la toile est agrandie
      // d'un même facteur dans les deux sens ; le fond peint couvre ce que le papier ne couvre pas
      const m = state.bgMin || { long: 0, short: 0 };
      const k = Math.max(1, m.long / Math.max(w, h), m.short / Math.min(w, h));
      w *= k; h *= k;
      return { w: Math.round(w), h: Math.round(h), auto: true };
    }
    const [a, b] = v.split('x').map(Number);
    const w = portrait ? Math.min(a, b) : Math.max(a, b), h = portrait ? Math.max(a, b) : Math.min(a, b);
    return { w, h, auto: false };
  }

  /*
   * Toiles réellement vendues (châssis entoilés), en cm, grand côté en premier.
   * - Formats français normalisés Figure / Paysage / Marine (toute enseigne beaux-arts :
   *   Cultura, Rougier & Plé, Le Géant des Beaux-Arts…). Cultura vend la gamme Monali
   *   dans ces formats jusqu'au 60F au moins.
   * - Toiles « 3D » carrées et panoramiques Monali (Cultura).
   */
  const STOCK = [
    // Toiles courantes (châssis entoilés vendus partout : grandes surfaces, Cultura, Action, web),
    // de l'A4 au 80 × 120 ; les plus fréquentes sont 40 × 50 et 50 × 70.
    ['toile', 30, 24, 'courant'], ['toile', 40, 30, 'courant'], ['toile carrée', 40, 40, 'courant'],
    ['toile', 50, 40, 'courant'], ['toile carrée', 50, 50, 'courant'], ['toile', 70, 50, 'courant'],
    ['toile carrée', 60, 60, 'courant'], ['toile', 80, 60, 'courant'], ['toile carrée', 80, 80, 'courant'],
    ['toile', 100, 70, 'courant'], ['toile panoramique', 100, 50, 'courant'], ['toile carrée', 100, 100, 'courant'],
    ['toile', 120, 80, 'courant'], ['toile panoramique', 120, 40, 'courant'], ['toile', 120, 90, 'courant'],
    // Cadres IKEA (RIBBA, HOVSTA, LOMVIKEN, FISKBO…) : formats photo standard, taille de la vitre
    // (sans passe-partout) ; l'œuvre se fait sur un carton ou un papier fort à cette taille.
    ['cadre', 30, 21, 'IKEA'], ['cadre', 40, 30, 'IKEA'], ['cadre', 50, 40, 'IKEA'], ['cadre carré', 50, 50, 'IKEA'],
    ['cadre', 70, 50, 'IKEA'], ['cadre', 91, 61, 'IKEA'], ['cadre', 100, 70, 'IKEA'],
    // Formats français normalisés Figure / Paysage / Marine (toute enseigne beaux-arts)
    ['20F', 73, 60, 'formats standards'], ['20P', 73, 54, 'formats standards'], ['20M', 73, 50, 'formats standards'],
    ['25F', 81, 65, 'formats standards'], ['25P', 81, 60, 'formats standards'], ['25M', 81, 54, 'formats standards'],
    ['30F', 92, 73, 'formats standards'], ['30P', 92, 65, 'formats standards'], ['30M', 92, 60, 'formats standards'],
    ['40F', 100, 81, 'formats standards'], ['40P', 100, 73, 'formats standards'], ['40M', 100, 65, 'formats standards'],
    ['50F', 116, 89, 'formats standards'], ['50P', 116, 81, 'formats standards'], ['50M', 116, 73, 'formats standards'],
    ['60F', 130, 97, 'formats standards'], ['60P', 130, 89, 'formats standards'], ['60M', 130, 81, 'formats standards'],
    ['80F', 146, 114, 'formats standards'], ['80P', 146, 97, 'formats standards'], ['80M', 146, 89, 'formats standards'],
    ['100F', 162, 130, 'formats standards'], ['100P', 162, 114, 'formats standards'], ['100M', 162, 97, 'formats standards'],
    ['120F', 195, 130, 'formats standards'], ['120P', 195, 114, 'formats standards'], ['120M', 195, 97, 'formats standards'],
  ];
  // les codes (20F, IKEA) restent tels quels, les noms communs sont traduits
  const stockWord = (w) => (/^[0-9A-Z]/.test(w) ? w : tr(w));
  const stockName = (t) => (canvasOrient() === 'port' ? `${stockWord(t[0])} · ${t[2]} × ${t[1]} cm` : `${stockWord(t[0])} · ${t[1]} × ${t[2]} cm`);

  // Les toiles du commerce les plus proches d'une taille calculée, dans la même orientation
  function nearestStock(w, h, n) {
    const land = w >= h;
    return STOCK.map((t) => {
      const [x, y] = land ? [t[1], t[2]] : [t[2], t[1]];
      return { t, w: x, h: y, d: Math.abs(x - w) / w + Math.abs(y - h) / h, area: x * y };
    }).sort((a, b) => a.d - b.d).slice(0, n || 1);
  }

  // Remplit le choix de toile avec les tailles réelles
  function fillFormats() {
    const sel = $('format');
    const current = sel.value;
    sel.querySelectorAll('optgroup').forEach((g) => g.remove());
    const groups = [
      [tr('Toiles courantes (grandes surfaces, Cultura, web)'), STOCK.filter((t) => t[3] === 'courant')],
      [tr('Cadres IKEA (RIBBA, HOVSTA, LOMVIKEN…), taille de la vitre'), STOCK.filter((t) => t[3] === 'IKEA')],
      [tr('Formats beaux-arts normalisés (F / P / M)'), STOCK.filter((t) => t[3] === 'formats standards')],
    ];
    groups.forEach(([label, list]) => {
      const g = document.createElement('optgroup');
      g.label = label;
      list.forEach((t) => {
        const o = document.createElement('option');
        o.value = `${t[1]}x${t[2]}`;
        o.textContent = stockName(t);
        g.appendChild(o);
      });
      sel.appendChild(g);
    });
    if (current) sel.value = current;
  }

  // Échelle automatique : comme dans l'œuvre de référence, environ cinq feuilles
  // de fond côte à côte sur la largeur de la toile.
  // Échelle automatique : la même pour tous, choisie pour que TOUS les sujets tiennent sur la toile
  // (ils en couvrent environ 60 %, les pages de fond et les lambeaux font le reste).
  // Les dessins sont toujours à leur taille réelle : l'échelle vaut 1.
  function scale() {
    return 1;
  }

  // Texte sous le choix de toile : taille calculée, papier disponible, couverture.
  function updateScaleLabel() {
    const f = formatCm();
    const { bgArea, pieceArea } = paperAreas(state.drawings);
    const nBg = state.drawings.filter((d) => roleOf(d) === 'texture').length;
    const aside = state.paleCount && !allIn() && ($('pale') ? $('pale').value : 'aside') !== 'fond' ? tr` ${state.paleCount} feuille${state.paleCount > 1 ? 's' : ''} pâle${state.paleCount > 1 ? 's' : ''} (crayon, texte) mise${state.paleCount > 1 ? 's' : ''} de côté.` : '';
    let txt;
    if (f.auto) {
      const near = nearestStock(f.w, f.h, 3).map((c) => tr`${stockWord(c.t[0])} ${c.w} × ${c.h} cm (${stockWord(c.t[3])}, fond ${Math.round((bgArea / c.area) * 100)} %)`);
      txt = tr`Toile calculée : ${f.w} × ${f.h} cm, pour que le fond (${nBg} pages colorées, ${fmt(bgArea / 1e4, 2)} m²) couvre tout en se chevauchant et que les découpes (${fmt(pieceArea / 1e4, 2)} m²) restent aérées. Toiles du commerce les plus proches : ${near.join(' · ')}. Choisissez-en une dans la liste pour composer dessus.`;
    } else {
      const cov = (state.coverage || 0) * 100;
      txt = cov >= 114
        ? tr`Toile de ${f.w} × ${f.h} cm : le fond (${nBg} pages) la couvre avec ${Math.round(cov - 100)} % de recouvrement.`
        : cov >= 100
          ? tr`Toile de ${f.w} × ${f.h} cm : le fond (${nBg} pages) la couvre tout juste (${Math.round(cov)} %) ; les déchirures laisseront de petits jours.`
          : tr`Toile de ${f.w} × ${f.h} cm : il manque du papier, le fond ne couvre que ${Math.round(cov)} % de la toile. Choisissez une toile plus petite ou « taille adaptée aux dessins ».`;
    }
    $('scale-info').textContent = txt + aside;
  }

  function sizePiece(p, k) {
    const c = cmPerPx(p.drawing) * k;
    p.wcm = p.canvas.width * c;
    p.hcm = p.canvas.height * c;
  }

  // ---------- Composition ----------

  // Où va chaque élément dans la scène : décision de Claude si disponible, sinon règles simples.
  const ZONES = ['ciel', 'milieu', 'sol'];
  const PLACES = ['ciel', 'horizon', 'sol', 'arriere', 'avant', 'soussol'];
  function direct(textures, pieces) {
    const noAi = textures.filter((t) => !t.drawing.ai);
    const sky = (t) => t.lum / 255 + (t.color[2] - t.color[0]) / 255;
    noAi.sort((a, b) => sky(b) - sky(a)).forEach((t, i) => {
      t.zone = i < noAi.length / 3 ? 'ciel' : i >= (2 * noAi.length) / 3 ? 'sol' : 'milieu';
    });
    textures.forEach((t) => {
      if (t.drawing.ai) { t.zone = t.drawing.ai.zone; t.importance = t.drawing.ai.importance; }
      // une page pâle (crayon gris, texte) fait un ciel de papier, tout dessous
      if ((t.colorful || 0) < 0.12) { t.zone = 'ciel'; t.importance = 0; }
      // place dans la scène : ciel, horizon ou terre
      const ap = t.drawing.ai && t.drawing.ai.place;
      t.place = ap === 'ciel' || ap === 'horizon' ? ap : ap === 'terre' || ap === 'sol' || ap === 'avant' || ap === 'soussol' ? 'terre' : (t.zone === 'ciel' ? 'ciel' : t.zone === 'sol' ? 'terre' : 'horizon');
    });
    const ranked = pieces.slice().sort((a, b) => rank(b) - rank(a));
    pieces.forEach((p) => {
      const ai = p.drawing.ai;
      if (p.ai) {
        // Claude a vu cet élément découpé lui-même : sa place, son importance
        p.place = p.ai.place;
        p.importance = p.ai.importance;
        p.grounded = p.place === 'sol' || p.place === 'arriere';
        p.zone = p.place === 'ciel' ? 'ciel' : p.place === 'horizon' ? 'milieu' : 'sol';
      } else if (ai) {
        p.zone = ai.zone;
        p.grounded = p.main ? ai.pose : false;
        p.importance = p.main ? ai.importance : 1;
        // place dans la scène : décision de Claude pour le sujet principal ; un second sujet de la même
        // page va au ciel seulement si la page est un ciel, sinon il se tient sur le sol
        p.place = p.main && PLACES.includes(ai.place) ? ai.place : p.main ? (ai.pose ? 'sol' : ai.zone === 'ciel' ? 'ciel' : ai.zone === 'sol' ? 'avant' : 'sol') : (ai.zone === 'ciel' ? 'ciel' : 'sol');
      } else {
        p.grounded = p.base > 0.55 && p.frac > 0.05;
        p.zone = p.grounded ? (p.frac > 0.3 ? 'sol' : 'milieu') : (p.frac < 0.06 ? 'ciel' : 'milieu');
        p.importance = ranked.indexOf(p) < 3 ? 3 : 1;
        // sans analyse : tout se tient sur le sol, sauf ce qui est franchement un ciel (petit, pâle, large)
        p.place = p.grounded ? 'sol' : (p.frac < 0.06 && p.colorful < 0.25 && p.canvas.width > p.canvas.height * 1.3) ? 'ciel' : 'sol';
      }
    });
  }

  function options() {
    const k = scale();
    const pieces = activePieces().filter((p) => p.enabled);
    pieces.forEach((p) => sizePiece(p, k));
    const textures = state.drawings
      .filter((d) => roleOf(d) === 'texture')
      .map((d) => {
        const t = d.analysis.texture;
        const c = cmPerPx(d) * k;
        return Object.assign({}, t, { drawing: d, wcm: t.canvas.width * c, hcm: t.canvas.height * c });
      });
    direct(textures, pieces);
    return {
      format: formatCm(),
      scale: k,
      density: Number($('density').value),
      rotation: 8, // rotation retenue des découpes (degrés) : réglage retiré, valeur fixe
      everything: allIn(), // densité au maximum : tous les dessins entrent dans l'œuvre
      densityT: (Number($('density').value) - 0.5) / 1.3, // position du curseur, de 0 à 1
      grain: $('grain').checked,
      ground: state.ground && state.ground !== 'auto' ? state.ground : null,
      groundName: groundPaint() ? groundPaint()[0] : null,
      seed: state.seed,
      textures,
      pieces,
    };
  }

  // Scène : la toile automatique grandit (même proportion) pour que tout ce qui se tient au sol
  // tienne en deux rangées au plus, et que ce qui vole ait sa place dans le ciel.
  // Une scène est une sélection : au plus une vingtaine d'éléments, les plus nets et colorés (un
  // sujet reconnu par Claude passe devant), sans feuilles de texte ni fragments.
  const SCENE_MAX = 18;
  function sceneSelection(o) {
    const score = (p) => (p.importance || 1) * 2 + (p.colorful || 0) * 2 + (p.ai ? 1.5 : 0) + (p.main ? 0.5 : 0) + Math.min(1, (p.wcm * p.hcm) / 500) * 0.5;
    const ok = (p) => (p.ai ? p.ai.garder : (p.colorful || 0) >= 0.12 && !(p.drawing.textOnly));
    return o.pieces.filter(ok).sort((a, b) => score(b) - score(a)).slice(0, SCENE_MAX);
  }
  function sceneFormat(o) {
    const f = o.format;
    const place = (p) => p.place || (p.grounded ? 'sol' : 'ciel');
    const sel = sceneSelection(o);
    const standing = sel.filter((p) => ['sol', 'arriere'].includes(place(p)));
    const flying = sel.filter((p) => place(p) === 'ciel');
    const needW = standing.reduce((a, p) => a + p.wcm, 0) / 2.5 * 0.92 + 4;
    const skyArea = flying.reduce((a, p) => a + p.wcm * p.hcm, 0) * 1.6;
    const needH = Math.sqrt(skyArea / 0.55 / (f.w / f.h));
    const k = Math.min(2.2, Math.max(1, needW / f.w, needH / f.h));
    return { w: Math.round(f.w * k), h: Math.round(f.h * k), auto: true };
  }

  // Toile « adaptée aux dessins » pour la Galerie : une grille complète dont les cases accueillent les
  // dessins à taille réelle (case au 75e centile des tailles : les quelques très grands sont réduits,
  // les autres ne paraissent jamais minuscules), sans dépendre des pages de fond.
  // Toile « adaptée aux dessins » pour la Frise : une bande panoramique, haute comme les pages peintes
  // (ou comme le plus grand sujet), assez longue pour aligner les sujets à la suite.
  function friseFormat(o) {
    const tallest = Math.max(0, ...o.textures.map((t) => t.hcm), ...o.pieces.map((p) => p.hcm * 1.3));
    const h = Math.max(30, Math.min(70, tallest * 1.15));
    const run = o.pieces.reduce((a, p) => a + p.wcm, 0) * 0.78 + 8;
    // avec des pages peintes, la bande ne dépasse pas leur longueur totale (chaque page n'est posée qu'une fois)
    const band = o.textures.length ? o.textures.reduce((a, t) => a + t.wcm, 0) + 2 : Infinity;
    const w = Math.max(h * 2.2, Math.min(h * 3.6, run, band));
    return { w: Math.round(w), h: Math.round(h), auto: true };
  }

  // Toile « adaptée aux dessins » pour le Nuage : de l'air autour de chaque sujet (les découpes couvrent
  // environ 30 % de la toile), dans la proportion choisie.
  function nuageFormat(o) {
    const f = o.format;
    const area = o.pieces.reduce((a, p) => a + p.wcm * p.hcm, 0) / 0.42;
    const ratio = f.w / f.h;
    let h = Math.sqrt(area / ratio), w = h * ratio;
    const k = Math.min(1, 130 / Math.max(w, h));
    return { w: Math.round(Math.max(30, w * k)), h: Math.round(Math.max(24, h * k)), auto: true };
  }

  function galleryFormat(o) {
    const f = o.format;
    const byDrawing = new Map();
    o.pieces.forEach((p) => { const m = Math.max(p.wcm, p.hcm); if (!byDrawing.has(p.drawing) || m > byDrawing.get(p.drawing)) byDrawing.set(p.drawing, m); });
    o.textures.forEach((t) => { const d = t.drawing || t; if (!byDrawing.has(d)) byDrawing.set(d, Math.max(t.wcm || 0, t.hcm || 0)); });
    const dims = [...byDrawing.values()].filter((v) => v > 0).sort((a, b) => a - b);
    if (!dims.length) return f;
    const g = Compose.galleryShape(Compose.galleryCount(dims.length, o), f.w / f.h);
    const M = 3, gap = 1.6, pad = 1.6;
    const side = dims[Math.min(dims.length - 1, Math.floor(dims.length * 0.75))] + 2 * pad;
    let w = 2 * M + g.cols * side + (g.cols - 1) * gap, h = 2 * M + g.rows * side + (g.rows - 1) * gap;
    // au-delà de 130 cm de grand côté, la toile est ramenée à cette taille (les dessins sont alors un peu réduits)
    const k = Math.min(1, 130 / Math.max(w, h));
    w *= k; h *= k;
    return { w: Math.round(w), h: Math.round(h), auto: true };
  }

  // Les styles proposés à chaque fois, avec tous les dessins.
  const STYLES = [
    { id: 'paysage', name: tr('Paysage'), hint: tr('ciel, milieu, sol') },
    { id: 'frise', name: tr('Frise'), hint: tr('une bande, les dessins à la suite') },
    { id: 'nuage', name: tr('Nuage'), hint: tr('dispersés sur un fond uni, bien droits') },
    { id: 'tournesol', name: tr('Tournesol'), hint: tr('spirale depuis le cœur') },
    { id: 'courtepointe', name: tr('Courtepointe'), hint: tr('patchwork, un médaillon par carreau') },
    { id: 'cabinet', name: tr('Cabinet de curiosités'), hint: tr('les plus beaux, en rangées') },
    { id: 'galerie', name: tr('Galerie'), hint: tr('grille de cadres, un dessin par case') },
  ];

  function regenerate() {
    if (!state.drawings.length) return;
    if (state.comp && !state.restoring) commit();
    planCoverage();
    state.canvasSize = formatCm();
    applyOrientations();
    updateScaleLabel();
    activePieces().forEach((p) => (p.placed = false));
    const o = options();
    state.proposals = STYLES.map((st, i) => {
      const so = Object.assign({}, o, { style: st.id, seed: o.seed + i * 7919 });
      if (st.id === 'scene') { so.pieces = sceneSelection(o); if (o.format.auto) so.format = sceneFormat(o); }
      if (st.id === 'galerie' && o.format.auto) so.format = galleryFormat(o);
      if (st.id === 'frise' && o.format.auto) so.format = friseFormat(o);
      if (st.id === 'nuage' && o.format.auto) so.format = nuageFormat(o);
      // Frise et Nuage montrent tous les dessins (ou presque) : le curseur de densité part plus haut
      if (st.id === 'frise' || st.id === 'nuage') so.densityT = Math.max(so.densityT, 0.8);
      if (st.id === 'scene' && state.sceneLayout) { so.sceneLayout = state.sceneLayout; if (o.format.auto) so.format = state.sceneLayout.format; }
      if (state.ground === 'auto' && st.id !== 'galerie') { const paint = pickGround(o, st.id); so.ground = paint[1]; so.groundName = paint[0]; }
      return { style: st, comp: Compose.generate(so) };
    });
    state.active = Math.min(state.active || 0, STYLES.length - 1);
    // une composition rouverte reste telle quelle tant qu'on ne demande pas d'autres propositions
    if (state.pinned) {
      const i = STYLES.findIndex((st) => st.id === state.pinned.style);
      if (i >= 0) { state.proposals[i].comp = state.pinned; state.active = i; }
    }
    state.comp = state.proposals[state.active].comp;
    renderProposals();
    state.selected = null;
    state.bgCache = null;
    refreshPieces();
    renderDetail();
    render();
    updateExportInfo();
    updateLabel();
  }

  // Réglages sans objet pour le style actif : la Galerie a un fond blanc, sans finition toile.
  function updateSettingsFor(comp) {
    const white = !!(comp && comp.style === 'galerie');
    // fond de toile : sans objet en Galerie (blanc, fixe)
    document.querySelectorAll('#ground button').forEach((b) => { b.disabled = white; });
    $('ground').classList.toggle('off', white);
    const g = $('grain');
    g.disabled = white;
    const lab = g.closest('label');
    lab.classList.toggle('off', white);
    lab.title = white ? tr('Fond blanc en Galerie : pas de finition toile') : '';
    let note = lab.querySelector('small');
    if (white && !note) { note = document.createElement('small'); note.textContent = tr(' — fond blanc'); lab.appendChild(note); }
    if (!white && note) note.remove();
  }

  // Cartel sous l'œuvre, comme au musée.
  function updateLabel() {
    const el = $('label');
    updateSettingsFor(state.comp);
    updateGroundName();
    $('density-bar').hidden = !state.comp;
    $('toolbar').hidden = !state.comp;
    const partial = $('partial-note');
    if (partial) partial.hidden = true;
    if (state.comp) {
      const c = state.comp;
      const used = new Set();
      c.items.forEach((L) => used.add(L.piece.drawing));
      state.drawings.forEach((d) => { if (d.analysis.texture && c.bg.some((L) => L.src === d.analysis.texture.canvas)) used.add(d); });
      $('density-note').textContent = tr`${used.size} dessin${used.size > 1 ? 's' : ''} sur ${state.drawings.length}${allIn() ? tr(' · tout') : ''}`;
      // styles qui ne retiennent qu'une sélection : on le dit, et on propose d'ajouter le reste
      const left = unusedDrawings();
      if (partial && c.total && left.length && !allIn()) {
        partial.hidden = false;
        // Galerie : le curseur de densité au maximum fait une case pour chaque dessin ; Cabinet : les
        // étagères sont pleines, on le dit sans proposer d'entasser
        const gallery = c.style === 'galerie';
        $('partial-add').hidden = !(gallery && Number($('density').value) < Number($('density').max));
        partial.querySelector('span').textContent = left.length === 1
          ? tr`Ce style met en valeur une sélection : 1 dessin n’est pas retenu${gallery ? '' : tr(' (plus de place sur les étagères)')}. Il reste disponible dans Dessins.`
          : tr`Ce style met en valeur une sélection : ${left.length} dessins ne sont pas retenus${gallery ? '' : tr(' (plus de place sur les étagères)')}. Ils restent disponibles dans Dessins.`;
      }
    }
    if (!state.comp) { el.hidden = true; return; }
    el.hidden = false;
    const st = STYLES.find((x) => x.id === state.comp.style) || STYLES[0];
    const t = titleFor(st.id);
    $('label-title').textContent = t ? `« ${t} »` : '';
    $('label-title').hidden = !t;
    const c = state.comp;
    const count = c.total ? tr`${c.kept} des ${c.total} dessins, les plus ${c.style === 'galerie' ? tr('adaptés') : tr('beaux')}` : tr`${state.drawings.filter((d) => roleOf(d) !== 'off').length} dessins d’enfants`;
    const aside = asideDrawings().length;
    $('label-meta').textContent = tr`${st.name} · collage de ${count}${aside ? tr` · ${aside} feuille${aside > 1 ? 's' : ''} pâle${aside > 1 ? 's' : ''} mise${aside > 1 ? 's' : ''} de côté` : ''} · ${fmt(c.W)} × ${fmt(c.H)} cm · ${c.reduced ? tr('dessins réduits pour tenir dans les cases (pour l’impression)') : tr('dessins à taille réelle')}`;
    renderAside();
  }

  function unusedDrawings() {
    const c = state.comp;
    if (!c) return [];
    const used = new Set();
    c.items.forEach((L) => used.add(L.piece.drawing));
    state.drawings.forEach((d) => { if (d.analysis.texture && c.bg.some((L) => L.src === d.analysis.texture.canvas)) used.add(d); });
    return state.drawings.filter((d) => roleOf(d) !== 'off' && !used.has(d));
  }
  // Galerie : une case par dessin quand la densité est au maximum
  function includeAll() {
    const d = $('density');
    d.value = d.max;
    d.dispatchEvent(new Event('change'));
  }

  function titleFor(styleId) {
    return (state.titles && state.titles[styleId]) || state.title || '';
  }

  // Vignettes des trois propositions ; un clic ouvre la proposition sur la toile pour la retoucher.
  function thumbOfComp(comp) {
    const s = 360 / comp.W;
    const c = Extract.makeCanvas(comp.W * s, comp.H * s);
    const x = c.getContext('2d');
    Compose.renderBg(x, comp, s, false);
    Compose.renderItems(x, comp, s, false);
    return c.toDataURL('image/jpeg', 0.8);
  }

  function renderProposals() {
    const box = $('proposals');
    box.innerHTML = '';
    (state.proposals || []).forEach((pr, i) => {
      const b = document.createElement('button');
      b.className = `proposal${i === state.active ? ' on' : ''}`;
      b.setAttribute('aria-pressed', i === state.active ? 'true' : 'false');
      const t = titleFor(pr.style.id);
      const sub = t ? `« ${esc(t)} »` : (pr.comp.total ? tr`${pr.comp.kept} dessins sur ${pr.comp.total}` : pr.style.hint);
      b.innerHTML = `<img src="${thumbOfComp(pr.comp)}" alt=""><b>${pr.style.name}</b><small>${sub}</small>`;
      b.onclick = () => selectProposal(i);
      box.appendChild(b);
    });
  }

  /*
   * Scène : au moment où on la choisit, Claude regarde chaque élément découpé qu'il n'a pas encore vu
   * (sujet, à garder, place), puis la composition est refaite. Sans Claude, la forme décide.
   */
  async function analyseForScene() {
    if (state.sceneBusy) return;
    const need = activePieces().some((p) => p.enabled && !p.ai) || !state.sceneLayout;
    if (!need) return;
    const sample = window.claude && window.claude.use ? await window.claude.use('sample') : null;
    if (!sample) { aiStatus(tr('Scène : sans Claude, les sujets sont placés d’après leur forme (tout au sol, nuages au ciel).')); return; }
    const limits = await sample.limits().catch(() => null);
    if (!limits || !limits.images) return;
    state.sceneBusy = true;
    try {
      const n = await directPieces(sample, limits);
      curate();
      planCoverage();
      const keep = state.active;
      if (n) { regenerate(); if (state.active !== keep) selectProposal(keep); }
      // puis Claude compose la scène lui-même : où va chaque élément, sur la toile
      const laid = await composeScene(sample, limits);
      if (laid) {
        aiStatus(tr`Scène composée par Claude : ${laid} éléments placés${state.sceneLayout.titre ? ` · « ${state.sceneLayout.titre} »` : ''}.`);
        regenerate();
        if (state.active !== keep) selectProposal(keep);
      } else aiStatus(tr`Scène : Claude a regardé ${n} éléments découpés et placé chacun (ciel, sol, premier plan…).`);
    } catch (e) {
      const why = { not_granted: tr('autorisation refusée'), rate_limited: tr('trop de demandes, réessayez plus tard'), refused: tr('demande refusée') }[e && e.code];
      aiStatus(tr`Scène : Claude n’a pas pu regarder les éléments${why ? ` (${why})` : ''} ; placement d’après la forme.`);
    } finally { state.sceneBusy = false; }
  }

  /*
   * Claude compose la scène : il reçoit chaque élément (découpe ou page de fond) avec sa taille
   * réelle, la toile en cm, et rend la position, l'inclinaison et le plan de chacun.
   */
  async function composeScene(sample, limits) {
    const o = options();
    const fmt = o.format.auto ? sceneFormat(o) : o.format;
    const W = fmt.w, H = fmt.h;
    const els = [];
    o.textures.forEach((t) => { if (t.wcm <= W * 0.6 && t.hcm <= H * 0.7) els.push({ kind: 'page', t, w: t.wcm, h: t.hcm, src: t.canvas, label: t.drawing.ai ? t.drawing.ai.sujet : tr('page peinte') }); });
    // on propose à Claude un peu plus que la sélection automatique : il choisit lui-même
    const cand = sceneSelection(Object.assign({}, o, { pieces: o.pieces })).concat(o.pieces.filter((p) => !sceneSelection(o).includes(p)).slice(0, 12));
    cand.forEach((p) => els.push({ kind: 'decoupe', p, w: p.wcm, h: p.hcm, src: p.canvas, label: p.ai ? p.ai.sujet : (p.drawing.ai ? p.drawing.ai.sujet : 'sujet') }));
    if (!els.length) return 0;
    const cap = Math.min(els.length, limits.images.maxCount * 30);
    const list = els.slice(0, cap);
    const nSheets = Math.min(limits.images.maxCount, Math.ceil(list.length / 24));
    const per = Math.ceil(list.length / nSheets);
    const sheets = [];
    for (let i = 0; i < list.length; i += per) sheets.push(await pieceSheet(list.map((e) => ({ p: { canvas: e.src } })).slice(i, i + per), i));
    aiStatus(tr`Claude compose la scène avec ${list.length} éléments…`);
    const inv = list.map((e, i) => tr`${i + 1}. ${e.kind === 'page' ? 'PAGE DE FOND' : tr('découpe')} « ${e.label} » ${e.w.toFixed(0)}×${e.h.toFixed(0)} cm`).join('\n');
    const prompt = `Tu es un artiste qui compose un collage : une scène de paysage faite UNIQUEMENT de dessins d'enfants, collés à leur taille réelle sur une toile de ${W} × ${H} cm (largeur × hauteur), fond peint uni.
Voici les ${list.length} éléments (planches contact : le numéro est en haut à gauche de chaque case), avec leur taille réelle en cm :
${inv}

Compose une BELLE scène cohérente, comme une illustration de livre pour enfants : un vrai paysage avec un ciel, un horizon, un sol, et des personnages et des animaux qui y vivent.

Croquis de la toile (y en cm, de haut en bas) :
- de 0 à ${Math.round(H * 0.35)} : le CIEL (pages de fond claires ou bleues à plat le long du bord haut, puis soleil, nuages, oiseaux)
- de ${Math.round(H * 0.35)} à ${Math.round(H * 0.6)} : l'HORIZON (collines, montagnes, mer, maisons au loin, arbres)
- vers ${Math.round(H * 0.78)} : la LIGNE DE SOL où les personnages et animaux posent les pieds (le bas de l'élément)
- de ${Math.round(H * 0.85)} à ${H} : le PREMIER PLAN (herbe, prairies, fleurs, eau et poissons), pages de fond brunes ou vertes en terre, enfoncées dans le bord bas

Règles :
- Une scène est une SÉLECTION : garde entre 10 et 18 éléments, les plus beaux et ceux qui font le paysage et ses habitants. Mets tous les autres dans "exclus" (pages de texte, feuilles au crayon sans sujet net, fragments, doublons).
- Les PAGES DE FOND sont des papiers peints entiers : elles font le décor (ciel, collines, terre, eau) et vont derrière tout le reste (plans 0 à 2). Elles peuvent dépasser des bords de la toile (ce qui dépasse sera rogné) et se chevaucher.
- Le ciel occupe le haut (environ le tiers supérieur), le sol le bas. Soleil, nuages, oiseaux, étoiles, arcs-en-ciel vont dans le ciel.
- Personnages, animaux, maisons, arbres, fleurs, véhicules se tiennent DEBOUT sur le sol : leurs pieds (bas de l'élément) posés sur une ligne de sol ou un peu au-dessus/au-dessous pour la profondeur. Les plus grands plutôt devant, les petits plus loin (plus haut, derrière). Un personnage ne flotte jamais dans le ciel.
- Poissons, bateaux et tout ce qui vit dans l'eau vont en bas, dans une zone d'eau. Herbe, prairies, bandes de fleurs se couchent au premier plan, en bas, devant.
- Rien n'est agrandi ni réduit. Les éléments peuvent se chevaucher un peu, mais ne cache jamais le visage ou le corps d'un personnage ou d'un animal ; répartis les sujets sur toute la largeur, en groupes qui racontent quelque chose (une famille devant la maison, les animaux près de l'arbre…).
- Les pages de fond retenues couvrent le ciel sur toute la largeur et la terre en bas ; pas de petite page isolée dans un coin.
- Coordonnées : x et y sont le CENTRE de l'élément en cm (0,0 en haut à gauche, x vers la droite, y vers le bas). rot : inclinaison en degrés (-20 à 20, 0 le plus souvent). plan : 0 (tout au fond) à 9 (tout devant).

Réfléchis à la scène avant de répondre, puis réponds uniquement avec ce JSON :
{"titre": "titre poétique court", "elements": [{"n": 1, "x": 45.0, "y": 60.0, "rot": 0, "plan": 5}, ...], "exclus": [numéros]}`;
    const res = await sample.json(prompt, { images: sheets, modelTier: 'default' });
    const items = Array.isArray(res && res.elements) ? res.elements : [];
    const excl = new Set((Array.isArray(res && res.exclus) ? res.exclus : []).map(Number));
    const num = (v, a, b, dflt) => (Number.isFinite(Number(v)) ? Math.max(a, Math.min(b, Number(v))) : dflt);
    let n = 0;
    const layout = { format: { w: W, h: H, auto: !!o.format.auto }, titre: String((res && res.titre) || '').slice(0, 80), pages: new Map(), pieces: new Map(), excluded: new Set() };
    items.forEach((it) => {
      const e = list[Number(it.n) - 1];
      if (!e || excl.has(Number(it.n))) return;
      const pos = { x: num(it.x, -e.w / 2, W + e.w / 2, W / 2), y: num(it.y, -e.h / 2, H + e.h / 2, H / 2), rot: (num(it.rot, -25, 25, 0) * Math.PI) / 180, plan: num(it.plan, 0, 9, e.kind === 'page' ? 1 : 5) };
      if (e.kind === 'page') layout.pages.set(e.t.canvas, pos); else layout.pieces.set(e.p, pos);
      n++;
    });
    list.forEach((e, i) => { if (excl.has(i + 1)) layout.excluded.add(e.kind === 'page' ? e.t.canvas : e.p); });
    if (!n) return 0;
    state.sceneLayout = layout;
    return n;
  }

  function selectProposal(i) {
    if (state.comp && i !== state.active) commit();
    state.active = i;
    // une composition rouverte reste épinglée tant qu'on la regarde ; en choisir une autre la libère,
    // sinon chaque réglage ramènerait à elle
    if (state.pinned && state.proposals[i] && state.proposals[i].style.id !== state.pinned.style) state.pinned = null;
    if (state.proposals[i]) window.Atelier.track('Proposition', { style: state.proposals[i].style.id });
    if (state.proposals[i] && state.proposals[i].style.id === 'scene') analyseForScene();
    state.zoom = { z: 1, px: 0, py: 0 };
    state.comp = state.proposals[i].comp;
    state.selected = null;
    state.bgCache = null;
    renderProposals();
    refreshPieces();
    updateToolbar();
    render();
    updateExportInfo();
    updateLabel();
  }

  // après une retouche, la vignette de la proposition active suit
  let thumbTimer = 0;
  // Ouvre le panneau du dessin dont vient une pièce ou une page de l'œuvre.
  const drawingOfLayer = (L) => (L.kind === 'piece' ? L.piece.drawing : L.src ? state.drawings.find((x) => x.analysis.texture && x.analysis.texture.canvas === L.src) : null);
  Compose.setTone((L) => { const d = drawingOfLayer(L); return d && d.tone; });
  function showDrawingOf(L) {
    const d = drawingOfLayer(L);
    if (!d || state.current === d) return;
    state.current = d;
    const sec = $('drawings-section');
    if (sec && sec.classList.contains('collapsed')) sec.querySelector(':scope > h2').click();
    refreshLists();
    const box = $('detail');
    if (box && !box.hidden && window.matchMedia('(min-width: 861px)').matches) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function refreshActiveThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      const img = document.querySelector('#proposals .proposal.on img');
      if (img && state.comp) img.src = thumbOfComp(state.comp);
    }, 300);
  }

  // ---------- Scène ----------

  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  let view = { s: 1, ox: 0, oy: 0, dpr: 1 };
  let raf = 0;

  function render() {
    if (!raf) raf = requestAnimationFrame(draw);
    scheduleDraft();
  }

  function draw() {
    raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth * dpr, ch = canvas.clientHeight * dpr;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingQuality = 'high';
    const comp = state.comp;
    updateToolbar();
    if (!comp) return;
    // sur téléphone, l'œuvre prend toute la largeur disponible
    const pad = (document.body.classList.contains('stage-full') ? 12 : mobileQuery.matches ? 8 : 36) * dpr;
    const fitS = Math.min((cw - 2 * pad) / comp.W, (ch - 2 * pad) / comp.H);
    // zone de l'œuvre trop petite (tiroir du téléphone agrandi) : rien à dessiner pour l'instant
    if (!(fitS > 0)) return;
    const Z = state.zoom;
    const s = fitS * Z.z;
    // on garde toujours un morceau de l'œuvre à l'écran
    const mx = Math.max(0, (comp.W * s - cw) / 2 + cw * 0.4), my = Math.max(0, (comp.H * s - ch) / 2 + ch * 0.4);
    Z.px = Math.max(-mx, Math.min(mx, Z.px));
    Z.py = Math.max(-my, Math.min(my, Z.py));
    const ox = (cw - comp.W * s) / 2 + Z.px, oy = (ch - comp.H * s) / 2 + Z.py;
    view = { s, ox, oy, dpr, fitS };
    const shadows = false; // pas d'ombre portée : papier collé à plat
    $('zoom-val').textContent = `${Math.round(Z.z * 100)} %`;

    if (state.bgMode) {
      // mode « fond seul » : les pages de fond se déplacent, on les dessine en direct, sans les découpes
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, comp.W * s, comp.H * s);
      ctx.clip();
      ctx.translate(ox, oy);
      Compose.renderBg(ctx, comp, s, false);
      Compose.renderFinish(ctx, comp, s);
      ctx.restore();
      drawSelection(ox, oy, s, dpr);
      return;
    }
    // fond mis en cache (il ne change pas pendant qu'on déplace les découpes),
    // à une résolution plafonnée pour rester léger quand on zoome fort
    const bs = Math.min(s, 4096 / comp.W, Math.sqrt(16e6 / (comp.W * comp.H)));
    if (!state.bgCache || Math.abs(state.bgCache.s - bs) > 1e-6 || state.bgCache.shadows !== shadows) {
      const c = Extract.makeCanvas(comp.W * bs, comp.H * bs);
      Compose.renderBg(c.getContext('2d'), comp, bs, shadows);
      state.bgCache = { canvas: c, s: bs, shadows };
    }

    // la toile accrochée au mur
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 10 * dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(ox, oy, comp.W * s, comp.H * s);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, comp.W * s, comp.H * s);
    ctx.clip();
    ctx.drawImage(state.bgCache.canvas, ox, oy, comp.W * s, comp.H * s);
    ctx.translate(ox, oy);
    Compose.renderItems(ctx, comp, s, shadows);
    Compose.renderFinish(ctx, comp, s);
    ctx.restore();

    drawSelection(ox, oy, s, dpr);
  }

  function drawSelection(ox, oy, s, dpr) {
    const L = state.selected;
    if (L) {
      ctx.save();
      ctx.translate(ox + L.x * s, oy + L.y * s);
      ctx.rotate(L.rot);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f49d1';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeRect((-L.w / 2) * s, (-L.h / 2) * s, L.w * s, L.h * s);
      ctx.setLineDash([]);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc((L.w / 2) * s, (L.h / 2) * s, 9 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `${11 * dpr}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↻', (L.w / 2) * s, (L.h / 2) * s);
      ctx.restore();
    }
  }

  function toComp(e) {
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * view.dpr, py = (e.clientY - r.top) * view.dpr;
    return { X: (px - view.ox) / view.s, Y: (py - view.oy) / view.s };
  }

  function handlePos(L) {
    const c = Math.cos(L.rot), s = Math.sin(L.rot);
    const hx = L.w / 2, hy = L.h / 2;
    return { x: L.x + hx * c - hy * s, y: L.y + hx * s + hy * c };
  }

  let drag = null;
  const touches = new Map(); // doigts / pointeurs posés sur la toile
  let pinch = null;
  let selectionBefore = null;

  // ---------- Zoom sur l'œuvre ----------

  function zoomAt(f, px, py) {
    const Z = state.zoom;
    const nz = Math.max(1, Math.min(8, Z.z * f));
    const k = nz / Z.z;
    // le point sous les doigts reste sous les doigts
    const r = canvas.getBoundingClientRect();
    const cx = (r.width * view.dpr) / 2, cy = (r.height * view.dpr) / 2;
    Z.px = px - cx - (px - cx - Z.px) * k;
    Z.py = py - cy - (py - cy - Z.py) * k;
    Z.z = nz;
    if (nz === 1) { Z.px = 0; Z.py = 0; }
    render();
  }

  function resetZoom() {
    state.zoom = { z: 1, px: 0, py: 0 };
    render();
  }

  function devicePoint(e) {
    const r = canvas.getBoundingClientRect();
    return { px: (e.clientX - r.left) * view.dpr, py: (e.clientY - r.top) * view.dpr };
  }

  function hitAt(p) {
    if (state.bgMode) {
      const bg = state.comp.bg;
      for (let i = bg.length - 1; i >= 0; i--) {
        const L = bg[i];
        if (L.paper) continue;
        const dx = p.X - L.x, dy = p.Y - L.y, c = Math.cos(L.rot), sn = Math.sin(L.rot);
        const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
        if (Math.abs(lx) <= L.w / 2 && Math.abs(ly) <= L.h / 2) return L;
      }
      return null;
    }
    const items = state.comp.items;
    for (let i = items.length - 1; i >= 0; i--) if (Compose.hitItem(items[i], p.X, p.Y)) return items[i];
    return null;
  }

  // Mode « fond seul » : on ne voit que les pages de fond, et on les déplace à sa guise.
  function setBgMode(on) {
    state.bgMode = !!on;
    state.selected = null;
    state.bgCache = null;
    document.body.classList.toggle('bg-mode', state.bgMode);
    const b = $('bg-mode');
    b.setAttribute('aria-pressed', state.bgMode ? 'true' : 'false');
    b.querySelector('span').textContent = state.bgMode ? tr('Tout voir') : tr('Fond seul');
    b.title = state.bgMode ? tr('Revenir à l’œuvre complète') : tr('Ne voir que le fond et déplacer ses pages');
    $('stage-tip').textContent = state.bgMode
      ? tr('Fond seul : glissez une page de fond pour la déplacer · poignée ou molette pour la tourner · « Tout voir » pour retrouver les découpes')
      : tr('Glissez une pièce pour la déplacer · poignée ou molette pour la tourner · pincez ou double-cliquez pour zoomer');
    render();
  }
  $('bg-mode').addEventListener('click', () => setBgMode(!state.bgMode));

  canvas.addEventListener('pointerdown', (e) => {
    if (!state.comp) return;
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, devicePoint(e));
    if (touches.size === 1) selectionBefore = state.selected;
    if (touches.size === 2) {
      state.selected = selectionBefore; // un pincement ne sélectionne rien
      // deuxième doigt : on annule le geste en cours et on passe au zoom
      if (drag && drag.mode === 'move') { drag.L.x = drag.x0; drag.L.y = drag.y0; }
      if (drag && drag.mode === 'rotate') drag.L.rot = drag.r0;
      drag = null;
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.px - b.px, a.py - b.py), mx: (a.px + b.px) / 2, my: (a.py + b.py) / 2 };
      render();
      return;
    }
    if (touches.size > 2) return;
    const p = toComp(e);
    const L = state.selected;
    if (L) {
      const h = handlePos(L);
      if (Math.hypot(h.x - p.X, h.y - p.Y) * view.s < 18 * view.dpr) {
        // la poignée tourne la pièce, sans changer sa taille : l'échelle reste juste
        drag = { mode: 'rotate', L, a0: Math.atan2(p.Y - L.y, p.X - L.x), r0: L.rot, snap: snapshot() };
        return;
      }
    }
    const hit = hitAt(p);
    if (hit) {
      state.selected = hit;
      drag = { mode: 'move', L: hit, dx: p.X - hit.x, dy: p.Y - hit.y, x0: hit.x, y0: hit.y, snap: snapshot() };
      // le panneau du dessin correspondant s'ouvre (taille, fond ou découpe, photo…)
      showDrawingOf(hit);
    } else {
      state.selected = null;
      // zone vide : on fait glisser la vue quand l'œuvre est zoomée
      if (state.zoom.z > 1) { const d = devicePoint(e); drag = { mode: 'pan', px: d.px, py: d.py }; canvas.style.cursor = 'grabbing'; }
    }
    render();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, devicePoint(e));
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.px - b.px, a.py - b.py), mx = (a.px + b.px) / 2, my = (a.py + b.py) / 2;
      state.zoom.px += mx - pinch.mx;
      state.zoom.py += my - pinch.my;
      zoomAt(d / Math.max(1, pinch.d), mx, my);
      pinch = { d, mx, my };
      return;
    }
    if (!drag) return;
    if (drag.mode === 'pan') {
      const d = devicePoint(e);
      state.zoom.px += d.px - drag.px;
      state.zoom.py += d.py - drag.py;
      drag.px = d.px; drag.py = d.py;
      render();
      return;
    }
    const p = toComp(e);
    const L = drag.L;
    if (drag.mode === 'move') {
      L.x = p.X - drag.dx;
      L.y = p.Y - drag.dy;
    } else {
      L.rot = drag.r0 + Math.atan2(p.Y - L.y, p.X - L.x) - drag.a0;
    }
    render();
  });

  const endDrag = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag && drag.mode !== 'pan') {
      if (drag.L && drag.L.kind === 'bg') state.bgCache = null;
      const moved = drag.mode === 'move' ? (drag.L.x !== drag.x0 || drag.L.y !== drag.y0) : drag.L.rot !== drag.r0;
      if (moved && drag.snap) { history.past.push(drag.snap); if (history.past.length > history.max) history.past.shift(); history.future = []; history.lastTag = null; updateHistoryButtons(); }
      refreshActiveThumb();
    }
    if (drag && drag.mode === 'pan') canvas.style.cursor = '';
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    if (!state.comp) return;
    e.preventDefault();
    const L = state.selected;
    // pincement sur pavé tactile (ctrl + molette) ou aucune pièce choisie : zoom sur l'œuvre
    if (e.ctrlKey || !L) {
      const d = devicePoint(e);
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), d.px, d.py);
      return;
    }
    commit('wheel');
    L.rot += e.deltaY * 0.002;
    render();
  }, { passive: false });

  // double-clic / double-tap : sur une pièce, on la retouche ; ailleurs, on zoome ou on revient
  canvas.addEventListener('dblclick', (e) => {
    if (!state.comp) return;
    const hit = hitAt(toComp(e));
    if (hit) { state.selected = hit; if (hit.kind === 'piece') editPiece(hit.piece); render(); return; }
    if (state.zoom.z > 1.05) resetZoom();
    else { const d = devicePoint(e); zoomAt(2.5, d.px, d.py); }
  });

  $('zoom-in').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(1.4, (r.width * view.dpr) / 2, (r.height * view.dpr) / 2); };
  $('zoom-out').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(1 / 1.4, (r.width * view.dpr) / 2, (r.height * view.dpr) / 2); };
  $('zoom-fit').onclick = resetZoom;
  $('zoom-full').onclick = () => {
    const on = document.body.classList.toggle('stage-full');
    $('zoom-full').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('zoom-full').title = on ? tr('Quitter le plein écran') : tr('Plein écran');
    state.bgCache = null;
    render();
  };

  // ---------- Retouche d'une découpe ----------

  function pieceName(p) {
    const d = p.drawing;
    const n = state.drawings.indexOf(d) + 1;
    const base = d.ai && d.ai.sujet ? d.ai.sujet.charAt(0).toUpperCase() + d.ai.sujet.slice(1) : `Dessin ${n}`;
    const ps = d.analysis.pieces || [];
    const name = ps.length > 1 ? tr`${base} · pièce ${ps.indexOf(p.copyOf || p) + 1}` : base;
    return p.copyOf ? tr`${name} · copie` : name;
  }

  /*
   * Une pièce dupliquée sur l'œuvre est une copie indépendante : même image au départ, mais sa
   * propre découpe — la retoucher ne change ni l'originale ni les autres copies. Les copies ne vivent
   * que dans la composition (pas dans la liste des pièces du dessin, ni dans les autres propositions).
   */
  function copyPiece(p) {
    const c = Object.assign({}, p, { copyOf: p.copyOf || p });
    delete c.hd;
    return c;
  }

  function editPiece(p) {
    if (!p || !p.src || !window.Editor) return;
    const d = p.drawing;
    Editor.open(p, {
      title: pieceName(p), onApply: applyPieceEdit,
      // lumière et couleurs : réglage du dessin entier, appliqué à la validation
      tone: d.tone, autoTone: () => Compose.autoTone(toneSources(d)),
      // la découpe d'office de cette pièce, recalculée sur la page (même ordre que les pièces du dessin)
      autoPiece: () => {
        const k = (d.analysis.pieces || []).indexOf(p.copyOf || p);
        return k >= 0 ? Extract.recut(d.analysis)[k] || null : null;
      },
      onTone: (t) => {
        if (t && (t.b || t.c || t.s)) d.tone = t; else delete d.tone;
        saveTone(d);
        state.bgCache = null;
        refreshLists();
        refreshActiveThumb();
        render();
      },
    });
  }

  // La pièce a changé de forme : on met à jour ses calques dans les trois propositions,
  // sans la déplacer sur la toile (le dessin reste exactement au même endroit).
  function applyPieceEdit(p, oldSrc, newSrc) {
    const dcx = newSrc.x + newSrc.w / 2 - (oldSrc.x + oldSrc.w / 2);
    const dcy = newSrc.y + newSrc.h / 2 - (oldSrc.y + oldSrc.h / 2);
    (state.proposals || []).forEach((pr) => pr.comp.items.forEach((L) => {
      if (L.piece !== p) return;
      const u = L.w / oldSrc.w; // cm sur la toile par pixel de page
      let sx = dcx * u;
      const sy = dcy * u;
      if (L.flip) sx = -sx;
      L.x += sx * Math.cos(L.rot) - sy * Math.sin(L.rot);
      L.y += sx * Math.sin(L.rot) + sy * Math.cos(L.rot);
      L.w = newSrc.w * u;
      L.h = newSrc.h * u;
    }));
    if (p.wcm) { p.wcm *= newSrc.w / oldSrc.w; p.hcm *= newSrc.h / oldSrc.h; }
    p.edited = true; // la retouche est sauvegardée avec la composition et rejouée à la réouverture
    p.thumb = thumbOf(p.canvas, 120, true);
    delete p.hd;
    refreshPieces();
    renderProposals();
    render();
  }

  /*
   * Historique : avant chaque action sur l'œuvre (déplacer, tourner, retourner, devant/derrière,
   * dupliquer, retirer, ajouter une pièce, changer de proposition, nouvelles propositions), on garde
   * un instantané de la mise en place ; Défaire et Refaire y naviguent. Les retouches de découpe
   * et les réglages des dessins (rôle, taille) n'en font pas partie.
   */
  const history = { past: [], future: [], max: 60, lastTag: null, lastAt: 0 };
  function snapshot() {
    const comp = state.comp;
    const enabled = new Map();
    activePieces().forEach((p) => enabled.set(p, !!p.enabled));
    return { comp, active: state.active, items: comp.items.map((L) => Object.assign({}, L)), bg: comp.bg.map((L) => Object.assign({}, L)), reduced: comp.reduced, enabled };
  }
  // tag : des actions répétées très vite (molette) ne font qu'un seul pas d'historique
  function commit(tag) {
    if (!state.comp || state.restoring) return;
    const now = Date.now();
    if (tag && history.lastTag === tag && now - history.lastAt < 800) { history.lastAt = now; return; }
    history.past.push(snapshot());
    if (history.past.length > history.max) history.past.shift();
    history.future = [];
    history.lastTag = tag || null; history.lastAt = now;
    updateHistoryButtons();
  }
  function restoreSnapshot(s) {
    const comp = s.comp;
    comp.items = s.items.map((L) => Object.assign({}, L));
    comp.bg = s.bg.map((L) => Object.assign({}, L));
    comp.reduced = s.reduced;
    s.enabled.forEach((on, p) => { p.enabled = on; });
    activePieces().forEach((p) => { p.placed = comp.items.some((L) => L.piece === p); });
    state.comp = comp;
    if (state.proposals && state.proposals[s.active] && state.proposals[s.active].style.id === comp.style) { state.proposals[s.active].comp = comp; state.active = s.active; }
    state.selected = null;
    state.bgCache = null;
    renderProposals();
    refreshPieces();
    updateToolbar();
    render();
    updateExportInfo();
    updateLabel();
    refreshActiveThumb();
  }
  function undo() {
    if (!history.past.length || !state.comp) return;
    history.future.push(snapshot());
    restoreSnapshot(history.past.pop());
    history.lastTag = null;
    updateHistoryButtons();
  }
  function redo() {
    if (!history.future.length || !state.comp) return;
    history.past.push(snapshot());
    restoreSnapshot(history.future.pop());
    history.lastTag = null;
    updateHistoryButtons();
  }
  function clearHistory() { history.past = []; history.future = []; history.lastTag = null; updateHistoryButtons(); }
  function updateHistoryButtons() {
    const u = document.querySelector('#toolbar [data-act="undo"]'), r = document.querySelector('#toolbar [data-act="redo"]');
    if (u) u.disabled = !history.past.length;
    if (r) r.disabled = !history.future.length;
  }

  function act(name) {
    if (name === 'undo') { undo(); return; }
    if (name === 'redo') { redo(); return; }
    const comp = state.comp, L = state.selected;
    if (!comp || !L) return;
    if (name !== 'edit') commit();
    if (L.kind === 'bg') {
      // page de fond : on la met devant ou derrière les autres pages, on la retourne, on la retire
      if (name === 'bigger' || name === 'smaller') {
        if (comp.style !== 'galerie') return;
        const k = name === 'bigger' ? 1.1 : 1 / 1.1;
        const f = clamp((L.scale || 1) * k, 0.1, 4);
        L.scale = f; L.w = L.pageW * f; L.h = L.pageH * f;
        comp.reduced = true;
        state.bgCache = null; updateLabel(); render();
        return;
      }
      const i = comp.bg.indexOf(L);
      if (name === 'front') { comp.bg.splice(i, 1); comp.bg.push(L); }
      if (name === 'back') { comp.bg.splice(i, 1); comp.bg.splice(comp.bg.findIndex((q) => !q.paper), 0, L); }
      if (name === 'flip') L.flip = !L.flip;
      if (name === 'del') { comp.bg.splice(i, 1); state.selected = null; }
      state.bgCache = null;
      refreshActiveThumb();
      render();
      return;
    }
    if (name === 'edit') { editPiece(L.piece); return; }
    // Galerie (impression) : la taille d'un dessin se règle à la main, par pas de 10 %
    if (name === 'bigger' || name === 'smaller') {
      if (comp.style !== 'galerie') return;
      const k = name === 'bigger' ? 1.1 : 1 / 1.1;
      const f = clamp((L.scale || 1) * k, 0.1, 4);
      L.scale = f; L.w = L.piece.wcm * f; L.h = L.piece.hcm * f;
      comp.reduced = comp.items.some((q) => (q.scale || 1) !== 1) || comp.bg.some((q) => (q.scale || 1) !== 1);
      updateLabel();
      render();
      return;
    }
    const i = comp.items.indexOf(L);
    if (name === 'front') { comp.items.splice(i, 1); comp.items.push(L); }
    if (name === 'back') { comp.items.splice(i, 1); comp.items.unshift(L); }
    if (name === 'flip') L.flip = !L.flip;
    if (name === 'dup') {
      const c = Object.assign({}, L, { piece: copyPiece(L.piece), x: L.x + L.w * 0.15, y: L.y + L.h * 0.15, rot: L.rot + 0.1 });
      comp.items.push(c);
      state.selected = c;
    }
    refreshActiveThumb();
    if (name === 'del') {
      comp.items.splice(i, 1);
      state.selected = null;
      if (!comp.items.some((q) => q.piece === L.piece)) { L.piece.placed = false; L.piece.enabled = false; }
      refreshPieces();
    }
    render();
  }

  function updateToolbar() {
    updateHistoryButtons();
    const L = state.selected;
    const gallery = !!(state.comp && state.comp.style === 'galerie');
    document.querySelectorAll('#toolbar button').forEach((b) => {
      if (b.classList.contains('history')) return;
      // sur une page de fond, ni duplication (chaque page ne sert qu'une fois) ni retouche de découpe
      b.disabled = !L || (L.kind === 'bg' && (b.dataset.act === 'dup' || b.dataset.act === 'edit'));
      // agrandir / réduire : seulement en Galerie, faite pour l'impression
      if (b.classList.contains('gallery-only')) b.hidden = !gallery;
    });
  }

  document.querySelectorAll('#toolbar button').forEach((b) => (b.onclick = () => act(b.dataset.act)));

  window.addEventListener('keydown', (e) => {
    if (window.Editor && Editor.isOpen()) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') act('del');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (e.key === 'Escape') {
      if (document.body.classList.contains('stage-full')) $('zoom-full').click();
      state.selected = null;
      render();
    }
  });

  window.addEventListener('resize', render);
  // la zone de l'œuvre change aussi de taille sans que la fenêtre bouge (tiroir du téléphone agrandi ou réduit)
  if (window.ResizeObserver) new ResizeObserver(() => render()).observe(canvas);

  // ---------- Export ----------

  // Les navigateurs de téléphone refusent les très grandes images (Safari : ~16 millions de pixels).
  const phone = () => navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 900;
  const MAX_PIXELS = () => (phone() ? 12e6 : 180e6); // 180 Mpx : une toile de 130 × 90 cm à 300 dpi

  function exportSize() {
    const comp = state.comp;
    const v = $('dpi').value;
    let w, h;
    if (v === 'screen') {
      const k = 2400 / Math.max(comp.W, comp.H);
      w = Math.round(comp.W * k); h = Math.round(comp.H * k);
    } else {
      const dpi = Number(v);
      w = Math.round((comp.W / 2.54) * dpi); h = Math.round((comp.H / 2.54) * dpi);
    }
    const cap = MAX_PIXELS();
    let capped = false;
    if (w * h > cap) { const f = Math.sqrt(cap / (w * h)); w = Math.round(w * f); h = Math.round(h * f); capped = true; }
    return { w, h, capped };
  }

  function updateExportNote() {
    const A = window.Account;
    const gated = !!(A && A.enabled && !A.user());
    const note = $('export-account'), free = $('export-free');
    if (note) note.hidden = !gated;
    if (free) free.hidden = !gated;
  }

  // Aperçu sans compte : l'image en 1200 px, avec un filigrane discret ; la haute définition et
  // la sauvegarde restent réservées au compte.
  async function exportPreview() {
    if (!state.comp) return;
    const btn = $('export-free');
    btn.disabled = true;
    try {
      const s = 1200 / Math.max(state.comp.W, state.comp.H);
      const c = Extract.makeCanvas(state.comp.W * s, state.comp.H * s);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      Compose.renderBg(x, state.comp, s, false);
      Compose.renderItems(x, state.comp, s, false);
      Compose.renderFinish(x, state.comp, s);
      x.save();
      x.globalAlpha = 0.28;
      x.fillStyle = '#1c1b15';
      x.font = `600 ${Math.round(c.width / 28)}px Montserrat, Arial, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.translate(c.width / 2, c.height / 2);
      x.rotate(-Math.PI / 9);
      const text = tr('aperçu · ateliergribouille.art');
      for (let k = -2; k <= 2; k++) x.fillText(text, 0, k * c.height / 3.2);
      x.restore();
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
      if (!blob) throw new Error('toBlob');
      if (await saveFile(blob, tr('apercu-atelier-gribouille.jpg'))) window.Atelier.track('Export', { type: 'apercu', qualite: 'apercu' });
    } catch (e) {
      console.error(e);
      notice(tr('L’aperçu n’a pas pu être produit sur cet appareil.'));
    } finally { btn.disabled = false; }
  }

  function updateExportInfo() {
    if (!state.comp) return;
    const { w, h, capped } = exportSize();
    const pdf = $('fmt').value === 'application/pdf';
    $('export-info').textContent = pdf
      ? tr`PDF d’une page de ${fmt(state.comp.W)} × ${fmt(state.comp.H)} cm, à l’échelle 1 : chaque papier posé à sa vraie place (images à ${Math.min(300, Math.round((w / state.comp.W) * 2.54))} dpi), cadres et traits en vecteurs.`
      : tr`${w} × ${h} px pour une toile de ${fmt(state.comp.W)} × ${fmt(state.comp.H)} cm${capped ? tr(' (taille limitée sur cet appareil)') : ''}`;
  }

  // Page publiée : le téléchargement passe par la demande d'enregistrement du visualiseur ;
  // en local, par un lien de téléchargement classique.
  function saveStatus(text) {
    const el = $('save-status');
    el.textContent = text || '';
    el.hidden = !text;
  }

  // Comment enregistrer un fichier ici : demande du visualiseur Claude, téléchargement direct, ou aperçu.
  async function saveMode() {
    if (!(window.claude && window.claude.use)) return { mode: 'anchor' };
    const dl = await Promise.race([window.claude.use('downloads'), new Promise((r) => setTimeout(() => r(null), 6000))]);
    return dl ? { mode: 'viewer', dl } : { mode: 'preview' };
  }

  // Un export (image, PDF, guide) est aussi gardé dans le compte quand l'utilisateur est connecté.
  async function recordExport(blob, filename) {
    window.Atelier.track('Export', { type: /\.pdf$/i.test(filename) ? (/guide/.test(filename) ? 'guide' : 'pdf') : 'image', qualite: $('dpi').value });
    const A = window.Account;
    if (!(A && A.enabled && A.user()) || !state.comp) return;
    try {
      saveStatus(tr('Enregistrement de l’export dans votre compte…'));
      const kind = /guide/.test(filename) ? 'guide' : /\.pdf$/i.test(filename) ? 'pdf' : /\.png$/i.test(filename) ? 'png' : 'jpg';
      const dpiV = $('dpi').value;
      const { w, h } = exportSize();
      const st = STYLES.find((x) => x.id === state.comp.style);
      await A.exports.put(blob, {
        name: filename, kind, dpi: kind === 'guide' ? 150 : (dpiV === 'screen' ? null : Number(dpiV)), width: kind === 'guide' ? null : w, height: kind === 'guide' ? null : h,
        thumb: thumbOfComp(state.comp), compName: (state.titles && state.titles[state.comp.style]) || (st ? st.name : ''),
      });
      saveStatus(tr`Fichier téléchargé et gardé dans votre compte (${Math.round(blob.size / 1024 / 1024 * 10) / 10} Mo).`);
      renderExports();
    } catch (e) {
      console.error(e);
      saveStatus(tr`Fichier téléchargé ; il n’a pas pu être gardé dans votre compte : ${e.message}`);
    }
  }
  // Quand les comptes sont actifs, exporter et sauvegarder demandent d'être connecté : la fenêtre
  // de connexion s'ouvre et l'action reprend d'elle-même une fois connecté.
  function requireAccount(label, fn) {
    return (...args) => {
      const A = window.Account;
      if (A && A.enabled && !A.user()) {
        state.afterSignIn = () => fn(...args);
        state.afterSignInLabel = label;
        if (window.openAccount) window.openAccount(tr`Connectez-vous ou créez un compte pour ${label}.`);
        return undefined;
      }
      return fn(...args);
    };
  }

  async function saveFile(blob, filename) {
    const { mode, dl } = await saveMode();
    if (mode === 'viewer') {
      saveStatus(tr('Confirmez l’enregistrement dans la fenêtre qui s’affiche…'));
      try {
        await dl.save({ filename, data: blob });
        saveStatus(tr`Enregistré : ${filename}`);
        return true;
      } catch (err) {
        const code = err && err.code;
        if (code === 'declined') { saveStatus(tr('Enregistrement annulé.')); return false; }
        if (code === 'too_large') { notice(tr('Fichier trop lourd pour cet appareil : choisissez « Écran » comme qualité.')); saveStatus(''); return false; }
        if (code === 'rate_limited') { notice(tr('Une demande d’enregistrement est déjà ouverte. Terminez-la, puis réessayez.')); saveStatus(''); return false; }
        // indisponible ici : on passe à l'aperçu
      }
    }
    if (mode === 'anchor') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      saveStatus(tr`Téléchargement lancé : ${filename}`);
      return true;
    }
    if (blob.type.startsWith('image/')) {
      showPreview(blob, filename);
      saveStatus(tr('Aperçu ouvert : enregistrez l’image depuis l’aperçu.'));
      return true;
    }
    notice(tr('L’enregistrement de fichiers n’est pas possible dans cette fenêtre. Ouvrez la page dans un navigateur (menu ⋯ ou Partager → Ouvrir dans le navigateur), le téléchargement y fonctionne.'));
    saveStatus('');
    return false;
  }

  // Aperçu de secours : l'image en grand, à enregistrer par appui long ou clic droit.
  function showPreview(blob, filename) {
    const box = $('preview');
    const img = $('preview-img');
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(blob);
    img.alt = filename;
    $('preview-name').textContent = `${filename} · ${Math.round(blob.size / 1024)} Ko`;
    box.hidden = false;
    document.body.classList.add('editing');
  }
  $('preview-close').onclick = () => { $('preview').hidden = true; document.body.classList.remove('editing'); };

  // Guide de création : planches de découpe à taille réelle et ordre de collage.
  async function exportGuide() {
    if (!state.comp) return;
    if (!window.Guide || !window.jspdf) { notice(tr('Le module de création du guide n’a pas pu se charger. Rechargez la page.')); return; }
    const btn = $('guide');
    const label = btn.querySelector('span');
    btn.disabled = true;
    state.selected = null;
    render();
    try {
      const st = STYLES.find((x) => x.id === state.comp.style) || STYLES[0];
      const res = await Guide.build(state.comp, {
        drawings: state.drawings.filter((d) => roleOf(d) !== 'off'),
        numberOf: (d) => state.drawings.indexOf(d) + 1,
        nameOf: (d) => {
          const n = state.drawings.indexOf(d) + 1;
          return d.ai && d.ai.sujet ? d.ai.sujet.charAt(0).toUpperCase() + d.ai.sujet.slice(1) : `Dessin ${n}`;
        },
        title: titleFor(st.id),
        styleName: st.name,
        aside: asideDrawings().map((d) => state.drawings.indexOf(d) + 1),
        onProgress: (t) => { label.textContent = t; },
      });
      label.textContent = tr('Enregistrement…');
      if (await saveFile(res.blob, tr('guide-de-creation-atelier-gribouille.pdf'))) await recordExport(res.blob, tr('guide-de-creation-atelier-gribouille.pdf'));
      $('guide-info').textContent = tr`${res.pages} pages : ${res.steps} étapes de collage, ${res.sheets} fiches de découpe sur les originaux.`;
    } catch (e) {
      console.error(e);
      notice(tr('Le guide n’a pas pu être créé sur cet appareil. Réessayez sur un ordinateur.'));
    } finally {
      btn.disabled = false;
      label.textContent = tr('Créer le guide de création');
    }
  }

  async function exportImage() {
    if (!state.comp) return;
    const btn = $('export');
    btn.disabled = true;
    btn.querySelector('span').textContent = tr('Préparation…');
    await tick();
    try {
      const { w } = exportSize();
      const s = w / state.comp.W;
      if ($('fmt').value === 'application/pdf') {
        saveStatus(tr('Assemblage du PDF…'));
        await tick();
        // les images du PDF restent à 300 dpi au plus : au-delà, le fichier devient énorme sans gain à l'impression
        const ps = Math.min(s, 300 / 2.54);
        await hydrateHD(state.comp, ps);
        const blob = await exportPdf(state.comp, ps);
        releaseHD();
        if (await saveFile(blob, 'oeuvre-atelier-gribouille.pdf')) await recordExport(blob, 'oeuvre-atelier-gribouille.pdf');
        return;
      }
      await hydrateHD(state.comp, s);
      saveStatus(tr('Rendu de l’image…'));
      await tick();
      const c = Extract.makeCanvas(state.comp.W * s, state.comp.H * s);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      const shadows = false; // pas d'ombre portée
      Compose.renderBg(x, state.comp, s, shadows);
      Compose.renderItems(x, state.comp, s, shadows);
      Compose.renderFinish(x, state.comp, s);
      const type = $('fmt').value;
      let blob = await new Promise((r) => c.toBlob(r, type, 0.92));
      if (!blob) {
        // l'appareil n'a pas pu fabriquer l'image : on réessaie deux fois plus petit
        const c2 = Extract.makeCanvas(c.width / 2, c.height / 2);
        c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height);
        blob = await new Promise((r) => c2.toBlob(r, type, 0.92));
        if (blob) saveStatus(tr`Image réduite à ${c2.width} × ${c2.height} px : cet appareil ne peut pas en produire une plus grande.`);
      }
      if (!blob) throw new Error('toBlob');
      const fname = `oeuvre-atelier-gribouille.${type === 'image/png' ? 'png' : 'jpg'}`;
      if (await saveFile(blob, fname)) await recordExport(blob, fname);
    } catch (e) {
      console.error(e);
      notice(tr('Export impossible à cette taille sur cet appareil. Choisissez « Écran » comme qualité et réessayez.'));
    } finally {
      releaseHD();
      btn.disabled = false;
      btn.querySelector('span').textContent = tr('Télécharger l’œuvre');
    }
  }

  /*
   * PDF à l'échelle : la page fait exactement la taille de la toile (1 cm = 1 cm). Chaque papier
   * et chaque découpe est une image posée à sa vraie place et sa vraie taille ; les cadres, le plomb
   * du vitrail et les traits de la constellation sont dessinés en vecteurs. Les scans restent des
   * images (on ne peut pas vectoriser un dessin d'enfant sans le trahir).
   */
  /*
   * Haute définition à l'export. Les pages sont analysées à une résolution de travail (jusqu'à 2800 px),
   * ce qui ne suffit pas toujours pour 300 dpi : au moment d'exporter, chaque dessin dont une découpe ou
   * une page de fond serait agrandie est relu depuis son fichier d'origine à la résolution nécessaire,
   * puis analysé de la même façon (la détection des sujets se fait sur une grille fixe : mêmes sujets,
   * même ordre). Les découpes et pages ainsi obtenues remplacent les versions de travail pendant le
   * rendu, puis sont libérées. Si la source n'a pas plus de pixels, rien ne change.
   */
  const HD_SOURCE_MAX = () => (phone() ? 4000 : 6500); // grand côté maximal relu (A3 à 300 dpi ≈ 5000 px)
  async function renderSource(source, max) {
    const pages = await pagesFromFile(source.file);
    const pg = pages[source.index];
    if (!pg) throw new Error(tr('page introuvable dans le fichier d’origine'));
    try { return await pg.render(max); } finally { new Set(pages.map((p) => p.release).filter(Boolean)).forEach((r) => { try { r(); } catch (e) { /* déjà libéré */ } }); }
  }
  // par dessin, le facteur d'agrandissement dont l'export a besoin par rapport à la résolution de travail
  function hdNeeds(comp, s) {
    const need = new Map();
    const bump = (d, r) => { if (d && d.source && r > 1.05) need.set(d, Math.max(need.get(d) || 1, r)); };
    comp.items.forEach((L) => { const p = L.piece; if (p && p.canvas) bump(p.drawing, (L.w * s) / p.canvas.width); });
    comp.bg.forEach((L) => {
      if (L.paper || !L.src || !L.sw) return;
      const d = state.drawings.find((x) => x.analysis.texture && x.analysis.texture.canvas === L.src);
      bump(d, (L.w * s) / L.sw);
    });
    return need;
  }
  async function hydrateHD(comp, s) {
    const need = hdNeeds(comp, s);
    let i = 0;
    for (const [d, r] of need) {
      i++;
      saveStatus(tr`Haute définition : dessin ${i} / ${need.size} relu depuis son fichier…`);
      await tick();
      try {
        const want = Math.ceil(d.srcLong * r);
        const max = Math.min(HD_SOURCE_MAX(), want);
        if (max <= d.srcLong * 1.05) continue; // la source n'a rien de plus à donner
        const src = await renderSource(d.source, max);
        const K0 = Math.max(src.canvas.width, src.canvas.height) / d.srcLong;
        if (K0 <= 1.05) continue;
        const mode = d.photoMode;
        let a = Extract.analyze(src.canvas, 0, { photo: mode !== 'keep', force: mode === 'force' });
        if (d.orientDeg) { const b = Extract.rotated(a, d.orientDeg); b.kind = a.kind; a = b; }
        const page = d.analysis.page;
        const K = a.page.width / page.width;
        // la page retrouvée doit être la même (même recadrage) : sinon on garde la version de travail
        if (K < 1.05 || Math.abs(a.page.width / a.page.height - page.width / page.height) > 0.03) continue;
        const pieces = comp.items.filter((L) => L.piece && L.piece.drawing === d);
        if (pieces.length) {
          if (!a.pieces) a.pieces = Extract.recut(a);
          pieces.forEach((L) => {
            const p = L.piece;
            const needLong = Math.ceil(Math.max(L.w, L.h) * s * 1.02);
            if (p.edited && p.src) {
              // pièce retouchée : la page haute définition est recoupée à l'endroit retouché et masquée
              // par la découpe retouchée (agrandie en douceur), pour garder exactement la retouche
              const bw = Math.max(1, Math.round(p.src.w * K)), bh = Math.max(1, Math.round(p.src.h * K));
              const crop = Extract.makeCanvas(bw, bh);
              crop.getContext('2d').drawImage(a.page, p.src.x * K, p.src.y * K, p.src.w * K, p.src.h * K, 0, 0, bw, bh);
              const img = Extract.enhance(crop, p.src.paper);
              const cx = img.getContext('2d');
              cx.globalCompositeOperation = 'destination-in';
              cx.imageSmoothingQuality = 'high';
              cx.drawImage(p.canvas, 0, 0, bw, bh);
              p.hd = Extract.scaleTo(img, needLong);
              return;
            }
            const k = (d.analysis.pieces || []).indexOf(p.copyOf || p);
            const hp = k >= 0 ? a.pieces[k] : null;
            if (!hp) return;
            const same = Math.abs(hp.frac - p.frac) < 0.03 && Math.abs(hp.canvas.width / hp.canvas.height - p.canvas.width / p.canvas.height) < 0.06;
            if (!same) return;
            p.hd = Extract.scaleTo(hp.canvas, needLong);
          });
        }
        const t = d.analysis.texture;
        if (t && comp.bg.some((L) => L.src === t.canvas)) {
          const ht = a.texture || Extract.textureFrom(a.page);
          t.canvas.hd = Extract.scaleTo(ht.canvas, Math.ceil(Math.max(t.canvas.width, t.canvas.height) * r * 1.02));
        }
      } catch (e) {
        console.warn(`Haute définition impossible pour « ${d.name} »`, e);
      }
    }
    if (need.size) saveStatus('');
  }
  function releaseHD() {
    if (state.comp) state.comp.items.forEach((L) => { if (L.piece) delete L.piece.hd; }); // copies comprises
    state.drawings.forEach((d) => {
      (d.analysis.pieces || []).forEach((p) => { delete p.hd; });
      if (d.analysis.texture) delete d.analysis.texture.canvas.hd;
    });
  }

  async function exportPdf(comp, s) {
    const { jsPDF } = window.jspdf;
    const W = comp.W, H = comp.H;
    const doc = new jsPDF({ unit: 'cm', format: [W, H], orientation: W >= H ? 'landscape' : 'portrait', compress: true });
    doc.setProperties({ title: 'Œuvre — Atelier Gribouille', creator: 'Atelier Gribouille', subject: `Collage ${fmt(W)} × ${fmt(H)} cm, ${comp.reduced ? tr('dessins réduits (impression)') : tr('dessins à taille réelle')}` });
    const ground = comp.ground || '#f8f5ef';
    doc.setFillColor(ground);
    doc.rect(0, 0, W, H, 'F');
    if (comp.ground) {
      // l'aplat de peinture avec ses coups de brosse, en une image pleine page (100 dpi suffisent)
      const gs = Math.min(s, 100 / 2.54);
      const gc = Extract.makeCanvas(Math.round(W * gs), Math.round(H * gs));
      Compose.renderGround(gc.getContext('2d'), comp, gs);
      doc.addImage(gc.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, W, H, undefined, 'FAST');
    }
    const layers = comp.bg.concat(comp.items);
    let n = 0;
    for (const L of layers) {
      n++;
      if (n % 3 === 0) { saveStatus(tr`Assemblage du PDF… ${n} / ${layers.length}`); await tick(); }
      if (L.kind === 'bg' && L.whole && !L.flip) {
        // page entière, bords droits : une image JPEG opaque, posée tournée (jsPDF pivote autour du
        // coin haut-gauche de l'image, dans le même sens que le canvas)
        const cw = Math.max(1, Math.round(L.w * s)), ch = Math.max(1, Math.round(L.h * s));
        const c = Extract.makeCanvas(cw, ch);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(Compose.toned(L.src, (drawingOfLayer(L) || {}).tone), L.sx, L.sy, L.sw, L.sh, 0, 0, cw, ch);
        const cs = Math.cos(L.rot), sn = Math.sin(L.rot);
        const tlx = L.x - (L.w / 2) * cs + (L.h / 2) * sn, tly = L.y - (L.w / 2) * sn - (L.h / 2) * cs;
        // jsPDF place une image tournée à partir de l'ordonnée « retournée » (H − y − h) : vérifié
        // en comparant les positions dans le PDF produit avec celles de la composition
        // (sans rotation, jsPDF n'applique pas ce retournement : coordonnées ordinaires)
        if (Math.abs(L.rot) < 1e-6) doc.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', tlx, tly, L.w, L.h, undefined, 'FAST');
        else doc.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', tlx, H - tly - L.h, L.w, L.h, undefined, 'FAST', (L.rot * 180) / Math.PI);
        continue;
      }
      // boîte englobante du calque (tourné), en cm, rognée à la toile
      const r = L.rot ? Math.hypot(L.w, L.h) / 2 : 0;
      const bw = L.rot ? 2 * r : L.w, bh = L.rot ? 2 * r : L.h;
      const x0 = Math.max(0, L.x - bw / 2), y0 = Math.max(0, L.y - bh / 2);
      const x1 = Math.min(W, L.x + bw / 2), y1 = Math.min(H, L.y + bh / 2);
      if (x1 - x0 < 0.05 || y1 - y0 < 0.05) continue;
      const c = Extract.makeCanvas(Math.max(1, Math.round((x1 - x0) * s)), Math.max(1, Math.round((y1 - y0) * s)));
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(-x0 * s, -y0 * s);
      Compose.drawLayer(ctx, L, s, false);
      // le papier de fond de la toile est opaque : en JPEG, plus léger ; le reste garde sa transparence
      const opaque = !!L.paper;
      const data = opaque ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
      doc.addImage(data, opaque ? 'JPEG' : 'PNG', x0, y0, x1 - x0, y1 - y0, undefined, 'FAST');
    }
    // vecteurs : cadres de la galerie, plomb du vitrail, traits de la constellation
    doc.setDrawColor(28, 27, 21);
    if (comp.frames) {
      doc.setLineWidth(comp.frameWidth || 0.3);
      comp.frames.forEach((f) => doc.rect(f.x, f.y, f.w, f.h, 'S'));
    }
    if (comp.lead) {
      doc.setLineWidth(comp.lead);
      doc.setLineJoin('round');
      comp.bg.forEach((L) => {
        if (!L.panel) return;
        const c = Math.cos(L.rot), sn = Math.sin(L.rot);
        const pts = (L.clip || [[-L.w / 2, -L.h / 2], [L.w / 2, -L.h / 2], [L.w / 2, L.h / 2], [-L.w / 2, L.h / 2]])
          .map(([x, y]) => [L.x + x * c - y * sn, L.y + x * sn + y * c]);
        const segs = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
        doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'S', true);
      });
    }
    if (comp.lines) {
      doc.setLineWidth(0.18);
      doc.setLineDashPattern([1.2, 0.8], 0);
      comp.lines.forEach(([x0, y0, x1, y1]) => doc.line(x0, y0, x1, y1));
      doc.setLineDashPattern([], 0);
    }
    return doc.output('blob');
  }

  // ---------- Mise en scène ----------

  // L'œuvre rendue pour la mise en scène (1600 px de côté, sans ombre), telle qu'elle est à l'instant
  function roomArtwork() {
    const comp = state.comp;
    const s = 1600 / Math.max(comp.W, comp.H);
    const c = Extract.makeCanvas(comp.W * s, comp.H * s);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    Compose.renderBg(x, comp, s, false);
    Compose.renderItems(x, comp, s, false);
    Compose.renderFinish(x, comp, s);
    return c;
  }
  function openRoom(file) {
    if (!state.comp || !window.Room) return;
    $('room-info').textContent = tr('Préparation de la mise en scène…');
    Room.open({
      file,
      artwork: roomArtwork,
      title: `${(STYLES.find((x) => x.id === state.comp.style) || STYLES[0]).name} · ${fmt(state.comp.W)} × ${fmt(state.comp.H)} cm`,
      onSave: (blob, name) => saveFile(blob, name),
      onError: () => notice(tr('Impossible de lire cette photo. Choisissez un JPG ou un PNG.')),
    });
    $('room-info').textContent = tr`Photo chargée. L’œuvre affichée est la proposition active (${fmt(state.comp.W)} × ${fmt(state.comp.H)} cm) ; changez de proposition puis rouvrez la photo pour en voir une autre.`;
    roomDirect();
  }

  // Dans la page publiée, Claude regarde la photo et place l'œuvre au milieu du mur dégagé, dans
  // la perspective du mur ; sinon, le placement automatique intégré (mur uni, lignes du sol et du plafond).
  async function roomDirect() {
    if (!(window.claude && window.claude.use)) return;
    try {
      await new Promise((r) => setTimeout(r, 400));
      const data = Room.photoDataUrl();
      if (!data) return;
      const sample = await window.claude.use('sample');
      const prompt = `Voici la photo d'une pièce. On veut y accrocher une toile de ${fmt(state.comp.W)} × ${fmt(state.comp.H)} cm (largeur × hauteur).
Trouve le mur dégagé le plus adapté (grande surface libre, au-dessus d'un canapé, d'un lit, d'une commode… ou simplement vide) et place la toile en son milieu, à hauteur de regard, dans la perspective du mur : si le mur est vu de biais, le côté le plus proche de l'appareil est plus haut que le côté éloigné, et les bords haut et bas de la toile suivent les lignes du plafond et du sol.
Taille plausible pour la pièce (une toile de ${fmt(state.comp.W)} cm de large est en général plus petite que le canapé ou le lit sous elle).
Réponds uniquement avec ce JSON, coordonnées normalisées de 0 à 1 par rapport à la photo (x vers la droite, y vers le bas), dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche :
{"oeuvre": [[x,y],[x,y],[x,y],[x,y]]}`;
      const res = await sample.json(prompt, { images: [data], modelTier: 'default' });
      const q = res && res.oeuvre;
      if (Array.isArray(q) && q.length === 4 && q.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((v) => typeof v === 'number' && v >= -0.2 && v <= 1.2))) {
        Room.setCorners(q);
        $('room-info').textContent += tr(' Placement proposé par Claude : ajustez les coins si besoin.');
      }
    } catch (e) {
      console.warn('placement par Claude indisponible', e);
    }
  }
  $('room-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) openRoom(f);
  });
  ['dragenter', 'dragover'].forEach((t) => $('room-drop').addEventListener(t, (e) => { e.preventDefault(); $('room-drop').classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => $('room-drop').addEventListener(t, (e) => { e.preventDefault(); $('room-drop').classList.remove('over'); }));
  $('room-drop').addEventListener('drop', (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) openRoom(f); });

  // ---------- Branchements ----------

  const drop = $('drop');
  // Les dessins apportés par l'utilisateur remplacent les dessins d'exemple : on ne mélange pas les deux.
  function importUserFiles(files) {
    if (!files.length) return;
    if (state.drawings.some((d) => d.sample)) {
      state.drawings = state.drawings.filter((d) => !d.sample);
      state.pinned = null; state.sceneLayout = null; state.current = null; state.selected = null;
      $('sample-note').hidden = true;
      importFiles(files).then(() => notice(tr('Les dessins d’exemple ont été retirés : place aux vôtres.')));
      return;
    }
    importFiles(files);
  }
  $('file').addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    importUserFiles(files);
  });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    importUserFiles(Array.from(e.dataTransfer.files));
  });
  // on accepte aussi un dépôt n'importe où sur la page
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    if (drop.contains(e.target)) return;
    e.preventDefault();
    importUserFiles(Array.from(e.dataTransfer.files));
  });

  $('generate').onclick = () => { state.seed = (Math.random() * 1e9) | 0; state.sceneLayout = null; state.pinned = null; regenerate(); if (state.proposals[state.active].style.id === 'scene') analyseForScene(); };
  ['format', 'pale', 'density', 'grain'].forEach((id) => $(id).addEventListener('change', () => { state.pinned = null; regenerate(); }));
  $('fmt').addEventListener('change', updateExportInfo);
  document.querySelectorAll('#canvas-orient button').forEach((b) => b.addEventListener('click', () => { setCanvasOrient(b.dataset.orient); state.pinned = null; regenerate(); }));
  try { const o = localStorage.getItem('atelier.canvasOrient'); if (o === 'port' || o === 'land') setCanvasOrient(o); } catch (e) { /* ignoré */ }
  $('dpi').addEventListener('change', updateExportInfo);
  $('export').onclick = requireAccount(tr('télécharger votre œuvre'), exportImage);
  $('export-free').onclick = exportPreview;
  $('sizes-alert-go').onclick = () => {
    const sec = $('sizes-section');
    if (mobileQuery.matches) selectTab('sizes-section'); else if (sec._expand) sec._expand();
    const box = $('sizes-check');
    if (box) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  $('partial-add').onclick = includeAll;
  $('quality-alert-go').onclick = () => {
    const d = (state.qualityList || [])[0];
    if (!d) return;
    const sec = $('drawings-section');
    if (mobileQuery.matches) selectTab('drawings-section'); else if (sec._expand) sec._expand();
    state.current = d;
    refreshLists();
    const box = $('detail');
    if (box) setTimeout(() => box.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  };
  $('guide').onclick = requireAccount(tr('créer le guide'), exportGuide);

  // ---------- Direction artistique par Claude ----------

  function aiStatus(text) {
    $('ai-status').textContent = text;
  }

  // Planche contact numérotée : Claude voit tous les dessins d'un coup d'œil.
  async function contactSheet(list, offset) {
    const cols = Math.ceil(Math.sqrt(list.length * 1.3));
    const rows = Math.ceil(list.length / cols);
    const cell = Math.floor(Math.min(1280 / cols, 1000 / rows));
    const c = Extract.makeCanvas(cols * cell, rows * cell);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    list.forEach((d, i) => {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      const src = d.analysis.page;
      const k = Math.min((cell - 8) / src.width, (cell - 8) / src.height);
      ctx.drawImage(src, x + (cell - src.width * k) / 2, y + (cell - src.height * k) / 2, src.width * k, src.height * k);
      ctx.fillStyle = '#000';
      ctx.fillRect(x + 2, y + 2, 34, 24);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(String(offset + i + 1), x + 6, y + 21);
    });
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  }

  // Planche contact des éléments découpés (sur fond blanc), numérotés.
  async function pieceSheet(list, offset) {
    const cols = Math.ceil(Math.sqrt(list.length * 1.3));
    const rows = Math.ceil(list.length / cols);
    const cell = Math.floor(Math.min(1280 / cols, 1000 / rows));
    const c = Extract.makeCanvas(cols * cell, rows * cell);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    list.forEach((e, i) => {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      const src = e.p.canvas;
      const k = Math.min((cell - 10) / src.width, (cell - 10) / src.height);
      ctx.drawImage(src, x + (cell - src.width * k) / 2, y + (cell - src.height * k) / 2, src.width * k, src.height * k);
      ctx.strokeStyle = '#ccc'; ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      ctx.fillStyle = '#000';
      ctx.fillRect(x + 2, y + 2, 34, 24);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(String(offset + i + 1), x + 6, y + 21);
    });
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  }

  /*
   * Second regard de Claude, élément par élément : chaque morceau découpé automatiquement dans les
   * dessins (même petit : un nuage, un soleil, un personnage secondaire) est reconnu, gardé ou
   * écarté, et placé dans la scène. Sans ce passage, tout élément qui ressemble à un sujet reste actif.
   */
  async function directPieces(sample, limits) {
    const list = [];
    state.drawings.forEach((d) => {
      if (roleOf(d) !== 'cutout') return;
      const c = cmPerPx(d);
      (d.analysis.pieces || []).forEach((p) => {
        const ar = p.canvas.width / p.canvas.height;
        if (!p.ai && p.frac > 0.002 && Math.max(p.canvas.width, p.canvas.height) * c >= 3 && p.colorful >= 0.04 && Math.min(ar, 1 / ar) > 0.1) list.push({ p, d });
      });
    });
    if (!list.length) return 0;
    const cap = Math.min(list.length, limits.images.maxCount * 24);
    const chosen = list.slice().sort((a, b) => rank(b.p) - rank(a.p)).slice(0, cap);
    const nSheets = Math.min(limits.images.maxCount, Math.ceil(chosen.length / 20));
    const per = Math.ceil(chosen.length / nSheets);
    aiStatus(tr`Claude regarde les ${chosen.length} éléments découpés un par un…`);
    let n = 0;
    // une planche par appel (charge légère), avec une seconde chance par planche
    for (let i = 0; i < chosen.length; i += per) {
      const batch = chosen.slice(i, i + per);
      const sheet = await pieceSheet(batch, 0);
      const prompt = `Voici ${batch.length} éléments découpés automatiquement aux ciseaux dans des dessins d'enfants (planche contact, le numéro est en haut à gauche de chaque case, de 1 à ${batch.length} ; le blanc autour est le fond de la case, pas le dessin).
Ils serviront à composer une scène de paysage collée sur une toile : ciel en haut, horizon, une ligne de sol où les personnages se tiennent debout, premier plan en bas.

Pour CHAQUE élément, décide :
- "sujet" : ce qu'il représente, en 1 à 3 mots en français (ex. « nuage », « bonhomme », « soleil », « maison », « chat », « fleur », « arbre »).
- "garder" : true si c'est un vrai sujet reconnaissable, même petit (personnage, animal, nuage, soleil, étoile, maison, arbre, fleur, véhicule, objet, cœur, arc-en-ciel…) ; false si c'est un fragment sans sens (tache, bord de feuille, trait isolé, morceau de décor coupé, texte seul, gribouillis d'essai).
- "place" : "ciel" (UNIQUEMENT ce qui vole ou brille : soleil, nuage, oiseau, avion, étoiles, cœur volant, arc-en-ciel), "horizon" (montagnes, mer, paysage lointain), "sol" (debout sur le sol : personnage, enfant, animal, maison, véhicule, bougie, fleur dressée), "arriere" (décor derrière les personnages : arbre, buisson), "avant" (couché au bas : herbe, prairie, bande de fleurs, eau, poissons, bateaux, tout ce qui vit dans l'eau), "soussol" (sous la terre : racines, taupe). Un personnage, un animal ou un poisson ne va JAMAIS au ciel ; dans le doute, "sol".
- "importance" : 3 pour les éléments les plus forts (grands personnages, pièces maîtresses), 2 pour les beaux sujets, 1 pour les petits éléments d'ambiance.

Réponds uniquement avec ce JSON :
{"elements": [{"n": 1, "sujet": "...", "garder": true, "place": "sol", "importance": 2}, ...]}`;
      let res = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try { res = await sample.json(prompt, { images: [sheet], modelTier: 'default', cache: { gcTime: 86400000 } }); }
        catch (e) { if (attempt || (e && e.code === 'not_granted')) throw e; await new Promise((r) => setTimeout(r, 3000)); }
      }
      const items = Array.isArray(res && res.elements) ? res.elements : [];
      items.forEach((it) => {
        const e = batch[Number(it.n) - 1];
        if (!e) return;
        e.p.ai = {
          sujet: String(it.sujet || '').slice(0, 40),
          garder: it.garder !== false,
          place: PLACES.includes(it.place) ? it.place : 'sol',
          importance: [1, 2, 3].includes(Number(it.importance)) ? Number(it.importance) : 1,
        };
        n++;
      });
      aiStatus(tr`Claude regarde les éléments découpés… ${Math.min(i + per, chosen.length)} / ${chosen.length}`);
    }
    return n;
  }

  async function artDirect() {
    const sample = window.claude && window.claude.use ? await window.claude.use('sample') : null;
    if (!sample) { aiStatus(tr('Composition automatique avec les règles intégrées.')); return; }
    const limits = await sample.limits().catch(() => null);
    if (!limits || !limits.images) { aiStatus(tr('Composition automatique avec les règles intégrées.')); return; }
    const all = state.drawings;
    const nSheets = Math.min(limits.images.maxCount, Math.ceil(all.length / 20));
    const per = Math.ceil(all.length / nSheets);
    const sheets = [];
    for (let i = 0; i < all.length; i += per) sheets.push(await contactSheet(all.slice(i, i + per), i));
    aiStatus(tr`Claude regarde les ${all.length} dessins et imagine la composition…`);
    const prompt = `Tu es le directeur artistique d'un collage : une toile faite UNIQUEMENT de dessins d'enfants, tous utilisés, collés à la même échelle (comme une grande œuvre de famille accrochée au salon).
Voici ${all.length} dessins numérotés de 1 à ${all.length} (planches contact, le numéro est en haut à gauche de chaque dessin).
La toile est un paysage : « ciel » en haut, « milieu », « sol » en bas.

Pour CHAQUE dessin, décide :
- "sujet" : ce qu'il représente, en 1 à 4 mots en français (ex. « bougie », « chapiteau de cirque », « montagnes »).
- "role" : "fond" si c'est une page entièrement peinte ou colorée qui servira de grand papier de fond (on la collera entière, sans la découper) ; "decoupe" si c'est un sujet dessiné sur du papier qu'on découpera aux ciseaux autour du dessin.
- "zone" : "ciel", "milieu" ou "sol", là où il a le plus de sens dans la scène (soleil, nuages, oiseaux, cœurs volants → ciel ; terre, herbe, racines, maisons, chapiteau, animaux au sol → sol ; le reste → milieu). Répartis les fonds pour que chaque zone en ait.
- "pose" : true si le sujet repose naturellement sur le sol (maison, arbre, personnage debout, bougie), false s'il flotte.
- "place" : sa place dans une scène de paysage : "ciel" (UNIQUEMENT ce qui vole ou brille : soleil, nuage, oiseau, avion, étoiles, feu d'artifice, cœur volant, arc-en-ciel, et les pages de fond bleues ou claires), "horizon" (un paysage lointain : montagnes, mer, page de paysage avec un horizon), "sol" (debout sur le sol : personnage, enfant, famille, animal, maison, chapiteau, véhicule, bougie, fleur dressée), "arriere" (décor derrière les personnages : arbre, buisson, grand feuillage), "avant" (premier plan couché au bas de la toile : herbe, prairie, bande de fleurs, eau, poissons, bateaux, tout ce qui vit dans l'eau), "soussol" (sous la terre : racines, galeries, taupes), "terre" (pour une page de fond brune, rouge ou sombre qui fera la terre). Un personnage ou un poisson ne va JAMAIS au ciel.
- "texte_seul" : true si la page ne contient que de l'écriture (un texte, une liste, un poème sans dessin), false dès qu'il y a un dessin, même petit ou au crayon.
- "photo_sol" : true si l'image est une PHOTO du dessin posé sur un sol, une table, du parquet, du carrelage, du bois (on voit la surface autour du dessin), false si c'est un scan ou une feuille vue seule.
- "importance" : 3 pour les 3 ou 4 pièces maîtresses les plus fortes visuellement, 2 pour les belles pièces, 1 sinon.

L'œuvre sera proposée dans six styles : « paysage » (ciel, milieu, sol), « tournesol » (tout tourne en spirale autour d'un cœur), « courtepointe » (un patchwork : les pages de fond en carreaux clairs et foncés, une découpe posée en médaillon au centre de chaque carreau), « cabinet » (un cabinet de curiosités : chaque dessin exposé droit, en rangées), « galerie » (une grille régulière de cases blanches cernées de noir, un personnage ou un sujet par case, comme une planche encadrée) et « scene » (une vraie scène : les pages de ciel en haut avec ce qui vole, les pages d'horizon, tout ce qui est debout les pieds sur une même ligne de sol, le premier plan en bas).
Propose pour chacun un titre poétique et court (2 à 6 mots, en français), inspiré des dessins.

Réponds uniquement avec ce JSON :
{"titres": {"paysage": "...", "tournesol": "...", "courtepointe": "...", "cabinet": "...", "galerie": "...", "scene": "..."}, "dessins": [{"n": 1, "sujet": "...", "role": "fond", "zone": "sol", "pose": false, "place": "sol", "texte_seul": false, "photo_sol": false, "importance": 2}, ...]}`;
    try {
      const res = await sample.json(prompt, { images: sheets, modelTier: 'default', cache: { gcTime: 86400000 } });
      const items = Array.isArray(res && res.dessins) ? res.dessins : [];
      let n = 0;
      items.forEach((it) => {
        const d = all[Number(it.n) - 1];
        if (!d) return;
        d.ai = {
          sujet: String(it.sujet || '').slice(0, 40),
          role: it.role === 'fond' ? 'fond' : 'decoupe',
          zone: ZONES.includes(it.zone) ? it.zone : 'milieu',
          pose: it.pose === true,
          texte: it.texte_seul === true,
          place: ['ciel', 'horizon', 'sol', 'arriere', 'avant', 'soussol', 'terre'].includes(it.place) ? it.place : null,
          importance: [1, 2, 3].includes(Number(it.importance)) ? Number(it.importance) : 1,
        };
        // Claude a vu un dessin photographié sur un sol ou une table que la détection a manqué : on force le détourage
        if (it.photo_sol === true && !d.photo && d.photoMode !== 'keep') {
          const a = Extract.analyze(d.original, 0, { photo: true, force: true });
          if (a.photo) {
            d.photoMode = 'force';
            d.base = a; d.analysis = a; d.orientDeg = 0; d.photo = a.photo;
            d.thumb = thumbOf(a.page);
            preparePieces(a.pieces, d);
            if (a.pieces) curateDrawing(d);
            ensureMaterial(d);
          }
        }
        n++;
      });
      if (res && res.titres && typeof res.titres === 'object') {
        state.titles = {};
        STYLES.forEach((st) => { if (res.titres[st.id]) state.titles[st.id] = String(res.titres[st.id]).slice(0, 80); });
      }
      if (res && res.titre) state.title = String(res.titre).slice(0, 80);
      state.drawings.forEach(ensureMaterial);
      curate();
      planCoverage();
      refreshLists();
      regenerate();
      // second passage : chaque élément découpé, un par un
      let np = 0;
      let pieceErr = '';
      try { np = await directPieces(sample, limits); } catch (e) { np = 0; pieceErr = (e && (e.code || e.message)) || 'erreur'; }
      curate();
      planCoverage();
      aiStatus(tr`Direction artistique : Claude a reconnu ${n} dessins sur ${all.length}${np ? tr` et ${np} éléments découpés` : pieceErr ? tr` (éléments découpés non regardés : ${pieceErr})` : ''}, et placé chacun dans la scène.`);
      refreshLists();
      regenerate();
    } catch (e) {
      const why = { not_granted: tr('autorisation refusée'), rate_limited: tr('trop de demandes, réessayez plus tard'), refused: tr('demande refusée') }[e && e.code];
      aiStatus(tr`Composition automatique avec les règles intégrées${why ? ` (Claude : ${why})` : ''}.`);
    }
  }

  // Tout effacer pour repartir de ses propres scans
  function startOver() {
    state.drawings = [];
    state.title = '';
    state.titles = null;
    state.sceneLayout = null;
    state.proposals = null;
    $('proposals').innerHTML = '';
    aiStatus('');
    state.current = null;
    state.comp = null;
    state.selected = null;
    state.bgCache = null;
    ['drawings-section', 'sizes-section', 'compose-section', 'export-section', 'room-section', 'sample-note', 'label', 'restart-offer'].forEach((id) => ($(id).hidden = true));
    $('empty').hidden = false;
    $('sample-offer').hidden = !state.sampleManifest;
    refreshLists();
    updateLabel();
    render();
    selectTab('import-section');
    clearHistory();
    clearTimeout(draftTimer);
    draftEpoch++; draftAgain = false; // un instantané en cours ne doit pas réécrire le brouillon effacé
    dbDel(DRAFT_ID).catch(() => {});
    $('draft-offer').hidden = true;
    if ($('empty-resume')) $('empty-resume').hidden = true;
  }
  $('clear').onclick = startOver;
  $('restart').onclick = startOver;

  // Dessins d'exemple fournis avec la page ou trouvés à côté de l'app : importés sur demande.
  async function loadSamples(m) {
    window.Atelier.track('Exemple');
    try {
      setProgress(0, 1, tr('Chargement des dessins d’exemple…'));
      const files = await Promise.all(m.pages.map(async (p) => {
        const r = await fetch(m.base + p.file);
        if (!r.ok) throw new Error(p.file);
        return new File([await r.blob()], p.name, { type: 'image/jpeg' });
      }));
      const sizes = {};
      m.pages.forEach((p) => { if (p.sizeCm) sizes[p.name] = p.sizeCm; });
      const before = new Set(state.drawings);
      await importFiles(files, sizes, { sample: true });
      state.drawings.forEach((d) => { if (!before.has(d)) d.sample = true; });
      $('sample-note').hidden = false;
      $('sample-offer').hidden = true;
      $('restart-offer').hidden = true; // « repartez de zéro » est déjà proposé dans la note d'exemple
    } catch (e) {
      console.error(e);
      setProgress(1, 1);
      notice(tr('Les dessins d’exemple n’ont pas pu être chargés. Importez vos scans ci-dessus.'));
    }
  }

  // ---------- Compositions sauvegardées (IndexedDB, dans ce navigateur) ----------
  const DB_NAME = 'atelier-gribouille', DB_STORE = 'compositions';
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function dbAll() { return openDb().then((db) => new Promise((res, rej) => { const r = db.transaction(DB_STORE).objectStore(DB_STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); })); }
  function dbPut(rec) { return openDb().then((db) => new Promise((res, rej) => { const t = db.transaction(DB_STORE, 'readwrite'); t.objectStore(DB_STORE).put(rec); t.oncomplete = () => res(); t.onerror = () => rej(t.error); })); }
  function dbGet(id) { return openDb().then((db) => new Promise((res, rej) => { const r = db.transaction(DB_STORE).objectStore(DB_STORE).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); }
  function dbDel(id) { return openDb().then((db) => new Promise((res, rej) => { const t = db.transaction(DB_STORE, 'readwrite'); t.objectStore(DB_STORE).delete(id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); })); }
  const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

  // Brouillon : l'œuvre en cours est gardée d'elle-même dans ce navigateur (dessins compris), pour
  // survivre à un rechargement ou à un onglet fermé par le téléphone. Rouverte à la prochaine visite.
  const DRAFT_ID = 'brouillon';
  let draftTimer = 0, draftBusy = false, draftAgain = false, draftEpoch = 0;
  function scheduleDraft() {
    if (!state.comp || !state.drawings.length || state.restoring) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 2500);
  }
  async function saveDraft() {
    if (!state.comp || !state.drawings.length || state.restoring) return;
    if (draftBusy) { draftAgain = true; return; }
    draftBusy = true;
    try {
      const epoch = draftEpoch;
      const rec = await snapshotComposition(tr('Œuvre en cours'));
      if (epoch !== draftEpoch) return; // « nouvelle œuvre » demandée pendant l'instantané : on n'écrit pas
      rec.id = DRAFT_ID;
      await dbPut(rec);
    } catch (e) { console.warn('brouillon non enregistré', e); }
    finally { draftBusy = false; if (draftAgain) { draftAgain = false; scheduleDraft(); } }
  }
  const AFTER_AUTH_KEY = 'atelier-gribouille:after-auth';
  // Au chargement de la page, l'œuvre en cours (brouillon) est rouverte d'elle-même : actualiser la
  // page ne fait rien perdre. « Commencez une nouvelle œuvre » l'efface pour repartir de zéro.
  async function resumeDraft() {
    const box = $('draft-offer');
    if (!box) return;
    let rec = null;
    try { rec = await dbGet(DRAFT_ID); } catch (e) { rec = null; }
    if (!rec || !rec.drawings || !rec.drawings.length || state.drawings.length) return;
    // retour d'une connexion Google : on revient ensuite à l'export, avec l'action demandée rappelée
    let after = null;
    try { after = sessionStorage.getItem(AFTER_AUTH_KEY); sessionStorage.removeItem(AFTER_AUTH_KEY); } catch (e) { after = null; }
    const big = $('empty-resume');
    box.querySelector('span').textContent = after ? tr('Connexion terminée : votre œuvre est rouverte…') : tr('Réouverture de votre œuvre en cours…');
    box.hidden = false;
    $('draft-forget').hidden = true;
    if (big) big.hidden = false; // aussi sur la scène vide, visible sans ouvrir le tiroir sur téléphone
    $('empty-sample').hidden = true;
    state.resuming = true;
    try { await restoreComposition(DRAFT_ID); } finally { state.resuming = false; }
    if (big) big.hidden = true;
    if (!state.comp || !state.drawings.length) {
      // relecture impossible : on le dit, et on laisse effacer ce brouillon pour ne pas buter dessus à chaque visite
      box.querySelector('span').textContent = tr('L’œuvre en cours n’a pas pu être rouverte.');
      $('draft-forget').hidden = false;
      $('draft-forget').onclick = () => { box.hidden = true; dbDel(DRAFT_ID).catch(() => {}); };
      return;
    }
    box.hidden = true;
    if (after) {
      selectTab('export-section');
      const sec = $('export-section');
      if (sec && sec._expand) sec._expand();
      notice('');
      saveStatus(after === '1' ? tr('Votre œuvre est de retour.') : tr`Votre œuvre est de retour : touchez le bouton pour ${after}.`);
    } else selectTab('compose-section');
  }

  // La composition courante, sérialisée : dessins (images d'origine et réglages) et mise en place.
  const HD_SAVE = 3508; // page de PDF sauvegardée à 300 dpi sur un A4
  async function sourceBytes(d) {
    const src = d.source;
    if (src && src.file && src.file.type && src.file.type.startsWith('image/') && !isHeic(src.file)) return { data: await src.file.arrayBuffer(), type: src.file.type };
    // une photo HEIC est sauvegardée en JPEG (lisible partout, y compris sur un autre ordinateur),
    // convertie une seule fois
    if (d.savedJpeg) return d.savedJpeg;
    if (src && src.file) {
      try {
        const heic = isHeic(src.file);
        const r = await renderSource(src, Math.min(HD_SOURCE_MAX(), HD_SAVE, heic ? 3000 : Infinity));
        const blob = await toBlob(r.canvas, 'image/jpeg', heic ? 0.9 : 0.92);
        const out = { data: await blob.arrayBuffer(), type: 'image/jpeg' };
        if (heic) d.savedJpeg = out;
        return out;
      } catch (e) { console.warn('source haute définition illisible, image de travail sauvegardée', e); }
    }
    const blob = await toBlob(d.original, 'image/jpeg', 0.92);
    return { data: await blob.arrayBuffer(), type: 'image/jpeg' };
  }
  async function editOf(p, d) {
    const page = d.analysis.page;
    const m = Extract.makeCanvas(p.canvas.width, p.canvas.height);
    const ctx = m.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, m.width, m.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(p.canvas, 0, 0);
    const blob = await toBlob(m, 'image/png');
    return { src: { x: p.src.x, y: p.src.y, w: p.src.w, h: p.src.h }, pageW: page.width, pageH: page.height, fp: pagePrint(page), mask: await blob.arrayBuffer() };
  }
  // Empreinte d'une page (16 × 16 niveaux de gris) : vérifie qu'une page relue est bien la même.
  function pagePrint(page) {
    const c = Extract.makeCanvas(16, 16);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(page, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data, out = [];
    for (let i = 0; i < d.length; i += 4) out.push(Math.round(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]));
    return out;
  }
  // La retouche sauvegardée peut-elle être rejouée sur cette page ? Même cadrage (proportions) et,
  // si l'empreinte est connue, même contenu. Sinon elle tomberait à côté du dessin.
  function sameEditPage(page, e) {
    if (Math.abs(page.width / page.height - e.pageW / e.pageH) > 0.01) return false;
    if (!e.fp) return true;
    const fp = pagePrint(page);
    let diff = 0;
    for (let i = 0; i < fp.length; i++) diff += Math.abs(fp[i] - e.fp[i]);
    return diff / fp.length < 10;
  }
  // Rejoue une retouche sauvegardée sur la pièce réimportée : la page (peut-être à une autre
  // résolution) est recoupée à l'endroit retouché, puis masquée par la transparence sauvegardée.
  async function applySavedEdit(p, d, e) {
    const page = d.analysis.page;
    if (!sameEditPage(page, e)) throw new Error(tr('le dessin relu ne correspond plus à la page retouchée'));
    const K = page.width / e.pageW;
    const bw = Math.max(1, Math.round(e.src.w * K)), bh = Math.max(1, Math.round(e.src.h * K));
    const crop = Extract.makeCanvas(bw, bh);
    crop.getContext('2d').drawImage(page, e.src.x * K, e.src.y * K, e.src.w * K, e.src.h * K, 0, 0, bw, bh);
    const img = Extract.enhance(crop, p.src && p.src.paper);
    const mask = await createImageBitmap(new Blob([e.mask], { type: 'image/png' }));
    const ctx = img.getContext('2d');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mask, 0, 0, bw, bh);
    ctx.globalCompositeOperation = 'source-over';
    // carte de clic à la finesse de la pièce d'origine
    const ratio = p.hit && p.src ? p.hit.w / p.src.w : 0.3;
    const hw = Math.max(4, Math.round(bw * ratio)), hh = Math.max(4, Math.round(bh * ratio));
    const hc = Extract.makeCanvas(hw, hh);
    const hctx = hc.getContext('2d', { willReadFrequently: true });
    hctx.drawImage(mask, 0, 0, hw, hh);
    const hd = hctx.getImageData(0, 0, hw, hh).data;
    const hit = new Uint8Array(hw * hh);
    for (let i = 0; i < hit.length; i++) hit[i] = hd[i * 4 + 3] > 127 ? 1 : 0;
    if (mask.close) mask.close();
    p.canvas = img;
    p.hit = { w: hw, h: hh, data: hit };
    p.src = { x: e.src.x * K, y: e.src.y * K, w: bw, h: bh, paper: p.src && p.src.paper };
    p.edited = true;
    p.thumb = thumbOf(p.canvas, 120, true);
  }
  async function snapshotComposition(name) {
    const comp = state.comp;
    const drawings = [];
    for (const d of state.drawings) {
      // image stockée en octets bruts (ArrayBuffer) : les Blob relus depuis IndexedDB sont
      // parfois vides ou illisibles sur certains navigateurs (Safari notamment). On garde la source
      // en haute définition : le fichier image tel quel, ou la page du PDF rendue à 300 dpi (A4).
      const { data, type } = await sourceBytes(d);
      // retouches de découpe : le masque de chaque pièce retouchée (PNG de sa transparence), avec sa
      // position dans la page, pour être rejoué sur la page réimportée
      const edits = [];
      for (const p of d.analysis.pieces || []) edits.push(p.edited ? await editOf(p, d) : null);
      drawings.push({
        name: d.name, data, type, role: roleOf(d), sizeCm: d.sizeCm, orient: d.orient, photoMode: d.photoMode, tone: hasTone(d) ? d.tone : null, work: d.srcLong,
        enabled: (d.analysis.pieces || []).map((p) => !!p.enabled), ai: d.ai || null,
        pieceAi: (d.analysis.pieces || []).map((p) => p.ai || null),
        pieceEdits: edits,
      });
    }
    const idx = (d) => state.drawings.indexOf(d);
    const texOwner = (src) => state.drawings.findIndex((d) => d.analysis.texture && d.analysis.texture.canvas === src);
    const pick = (L, keys) => { const o = {}; keys.forEach((k) => { if (L[k] !== undefined) o[k] = L[k]; }); return o; };
    const items = [];
    for (const L of comp.items) {
      const p = L.piece, orig = p.copyOf || p;
      const it = Object.assign({ d: idx(p.drawing), p: p.drawing.analysis.pieces.indexOf(orig) }, pick(L, ['x', 'y', 'w', 'h', 'rot', 'flip', 'scale', 'plan', 'frame']));
      if (p.copyOf) it.copy = { edit: p.canvas !== orig.canvas ? await editOf(p, p.drawing) : null };
      items.push(it);
    }
    const bg = comp.bg.map((L) => Object.assign({ d: L.paper ? -1 : texOwner(L.src) }, pick(L, ['paper', 'panel', 'scrap', 'whole', 'x', 'y', 'w', 'h', 'rot', 'flip', 'sx', 'sy', 'sw', 'sh', 'clip', 'pageW', 'pageH', 'scale', 'plan', 'frame'])));
    const compData = Object.assign(pick(comp, ['W', 'H', 'ground', 'groundName', 'grain', 'style', 'frames', 'frameWidth', 'paint', 'reduced', 'kept', 'total', 'lead', 'lines', 'f', 'scale']), { items, bg });
    return {
      id: Date.now(), name, date: new Date().toISOString(), thumb: thumbOfComp(comp),
      settings: { format: $('format').value, orient: canvasOrient(), ground: state.ground, grain: $('grain').checked, density: $('density').value, pale: $('pale') ? $('pale').value : 'aside', title: state.title || '', titles: state.titles || null },
      drawings, comp: compData,
    };
  }

  // (les boîtes de dialogue du navigateur sont bloquées dans certains cadres : le nom se saisit sur place)
  function askSaveName() {
    if (!state.comp || !state.drawings.length) { saveStatus(tr('Importez des dessins et choisissez une proposition avant de sauvegarder.')); return; }
    const st = STYLES.find((x) => x.id === state.comp.style);
    const dflt = (state.titles && state.titles[state.comp.style]) || tr`${st ? st.name : 'Composition'} du ${new Date().toLocaleDateString(I18n.locale)}`;
    const form = $('save-form');
    form.hidden = false;
    $('save-name').value = dflt;
    $('save-name').focus();
    $('save-name').select();
  }
  async function saveComposition(name) {
    if (!state.comp || !state.drawings.length) return;
    window.Atelier.track('Sauvegarde');
    $('save-form').hidden = true;
    saveStatus(tr('Sauvegarde de la composition…'));
    try {
      const rec = await snapshotComposition((name || 'Composition').trim().slice(0, 80));
      const A = window.Account;
      if (A && A.enabled) {
        if (!A.user()) throw new Error(tr('Connectez-vous pour sauvegarder.'));
        saveStatus(tr('Envoi dans votre compte…'));
        await A.cloud.put(rec, (n, t) => saveStatus(tr`Envoi dans votre compte : ${n} / ${t} fichiers…`));
        saveStatus(tr`Composition « ${rec.name} » sauvegardée dans votre compte.`);
      } else {
        await dbPut(rec);
        saveStatus(tr`Composition « ${rec.name} » sauvegardée dans ce navigateur.`);
      }
      renderSaved();
    } catch (e) {
      console.error(e);
      saveStatus(tr`La sauvegarde a échoué : ${(e && e.message) || tr('espace de stockage insuffisant ?')}`);
    }
  }

  async function renderSaved() {
    const box = $('saved-list');
    if (!box) return;
    let list = [];
    const A = window.Account;
    const accounts = !!(A && A.enabled);
    const signed = accounts && !!A.user();
    if (!accounts) { try { list = (await dbAll()).filter((r) => r.id !== DRAFT_ID).map((r) => Object.assign(r, { local: true })); } catch (e) { list = []; } }
    if (signed) {
      try { list = await A.cloud.list(); } catch (e) { console.error(e); savedStatus(`Compositions du compte indisponibles : ${e.message}`); }
    }
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    $('saved-count').textContent = list.length ? `(${list.length})` : '';
    if ($('saved-empty')) $('saved-empty').hidden = !!list.length;
    box.innerHTML = '';
    list.forEach((rec) => {
      const el = document.createElement('div');
      el.className = 'saved';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      const when = new Date(rec.date);
      const st = STYLES.find((x) => x.id === rec.comp.style);
      const nD = rec.nDrawings !== undefined ? rec.nDrawings : rec.drawings.length;
      const where = rec.cloud ? tr('<span class="saved-where"><svg class="ico"><use href="#i-cloud"/></svg>mon compte</span>') : '';
      el.innerHTML = tr`<img src="${safeData(rec.thumb)}" alt=""><div><p class="saved-name">${esc(rec.name)}${where}</p><p class="saved-meta">${st ? st.name : esc(rec.comp.style)} · ${nD} dessins · ${fmt(rec.comp.W)} × ${fmt(rec.comp.H)} cm · ${when.toLocaleDateString(I18n.locale)}</p></div><button class="saved-del" title="Supprimer" aria-label="Supprimer"><svg class="ico"><use href="#i-trash"/></svg></button>`;
      // suppression en deux temps, sans boîte de dialogue : un premier clic demande confirmation
      const del = el.querySelector('.saved-del');
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!del.classList.contains('confirm')) { del.classList.add('confirm'); del.innerHTML = tr('Supprimer ?'); setTimeout(() => { del.classList.remove('confirm'); del.innerHTML = '<svg class="ico"><use href="#i-trash"/></svg>'; }, 4000); return; }
        try { if (rec.cloud) await A.cloud.del(rec.id); else await dbDel(rec.id); } catch (e2) { console.error(e2); savedStatus(`Suppression impossible : ${e2.message}`); }
        renderSaved();
      };
      const open = () => restoreComposition(rec.id, el);
      el.onclick = open;
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      box.appendChild(el);
    });
  }

  // Liste des exports gardés dans le compte, avec retéléchargement et suppression.
  const exportsStatus = (t) => { const el = $('exports-status'); if (!el) return; el.textContent = t || ''; el.hidden = !t; };
  async function renderExports() {
    const box = $('exports-box'), list = $('exports-list');
    const A = window.Account;
    if (!box || !(A && A.enabled && A.user())) { if (box) box.hidden = true; return; }
    box.hidden = false;
    let rows = [];
    try { rows = await A.exports.list(); } catch (e) { console.error(e); exportsStatus(`Exports indisponibles : ${e.message}`); return; }
    $('exports-count').textContent = rows.length ? `(${rows.length})` : '';
    list.innerHTML = '';
    if (!rows.length) { list.innerHTML = tr('<p class="hint">Aucun export pour l’instant : téléchargez une œuvre, elle apparaîtra ici.</p>'); return; }
    const KIND = { jpg: 'JPEG', png: 'PNG', pdf: 'PDF', guide: tr('Guide PDF') };
    rows.forEach((r) => {
      const el = document.createElement('div');
      el.className = 'saved';
      const when = new Date(r.created_at);
      const size = r.size ? `${Math.round(r.size / 1024 / 1024 * 10) / 10} Mo` : '';
      const dims = r.width && r.height ? `${r.width} × ${r.height} px` : '';
      const meta = [KIND[r.kind] || r.kind, r.dpi ? `${r.dpi} dpi` : '', dims, size, when.toLocaleDateString(I18n.locale)].filter(Boolean).join(' · ');
      el.innerHTML = tr`${safeData(r.thumb) ? `<img src="${safeData(r.thumb)}" alt="">` : `<span class="saved-kind">${esc(KIND[r.kind] || r.kind)}</span>`}<div><p class="saved-name">${esc(r.comp_name || r.name)}</p><p class="saved-meta">${esc(meta)}</p></div><span class="saved-actions"><button class="saved-dl" title="Retélécharger" aria-label="Retélécharger"><svg class="ico"><use href="#i-download"/></svg></button><button class="saved-del" title="Supprimer" aria-label="Supprimer"><svg class="ico"><use href="#i-trash"/></svg></button></span>`;
      el.querySelector('.saved-dl').onclick = async (e) => {
        e.stopPropagation();
        try { exportsStatus(tr('Téléchargement…')); const blob = await A.exports.blob(r.path); await saveFile(blob, r.name); exportsStatus(''); }
        catch (err) { console.error(err); exportsStatus(`Téléchargement impossible : ${err.message}`); }
      };
      const del = el.querySelector('.saved-del');
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!del.classList.contains('confirm')) { del.classList.add('confirm'); del.innerHTML = tr('Supprimer ?'); setTimeout(() => { del.classList.remove('confirm'); del.innerHTML = '<svg class="ico"><use href="#i-trash"/></svg>'; }, 4000); return; }
        try { await A.exports.del(r.id, r.path); } catch (err) { console.error(err); exportsStatus(`Suppression impossible : ${err.message}`); }
        renderExports();
      };
      list.appendChild(el);
    });
  }

  // Rouvre une composition : les dessins sont réimportés depuis leurs images, puis la mise en place
  // sauvegardée est reposée telle quelle (pas de nouvelle analyse par Claude, rien ne bouge).
  function savedStatus(text) { const el = $('saved-status'); el.textContent = text || ''; el.hidden = !text; }
  // Pendant la réouverture, les sections au-dessus de la liste apparaissent et changent de hauteur :
  // sans ancrage, la ligne touchée file sous le doigt (Safari n'ancre pas le défilement tout seul).
  // On garde l'élément touché à la même hauteur à l'écran jusqu'à la fin.
  function keepAnchored(el) {
    if (!el || !el.getBoundingClientRect) return () => {};
    const scroller = (() => { let n = el.parentElement; while (n && n !== document.body) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; n = n.parentElement; } return null; })();
    let top = el.getBoundingClientRect().top, on = true;
    const frame = () => {
      if (!on) return;
      if (el.isConnected) {
        const d = el.getBoundingClientRect().top - top;
        if (Math.abs(d) > 1) { if (scroller) scroller.scrollTop += d; else window.scrollBy(0, d); }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => { on = false; };
  }

  // une réouverture à la fois : ouvrir une composition sauvegardée pendant que l'œuvre en cours
  // revient d'elle-même attend la fin de celle-ci (la dernière demandée l'emporte)
  let restoreChain = Promise.resolve();
  function restoreComposition(id, anchor) {
    restoreChain = restoreChain.then(() => restoreOne(id, anchor));
    return restoreChain;
  }
  async function restoreOne(id, anchor) {
    const release = keepAnchored(anchor);
    try { await restoreCompositionInner(id); }
    catch (e) { state.restoring = false; console.error(e); savedStatus(`La réouverture a échoué : ${(e && e.message) || e}`); notice(`La composition n’a pas pu être rouverte : ${(e && e.message) || e}`); }
    finally { await tick(); release(); }
  }
  async function restoreCompositionInner(id) {
    savedStatus(tr('Lecture de la composition sauvegardée…'));
    const fromCloud = typeof id === 'string' && id.startsWith('cloud:');
    const rec = fromCloud
      ? await window.Account.cloud.get(id, (n, t) => savedStatus(tr`Téléchargement depuis votre compte : ${n} / ${t} dessins…`))
      : await dbGet(id);
    if (!rec) { savedStatus(fromCloud ? tr('Composition introuvable dans votre compte.') : tr('Composition introuvable dans ce navigateur.')); return; }
    if (!rec.drawings || !rec.drawings.length) { savedStatus(tr('Cette sauvegarde ne contient aucun dessin.')); return; }
    const bytesOf = (d) => d.data || d.blob || null;
    const sizeOf = (d) => { const b = bytesOf(d); return b ? (b.byteLength !== undefined ? b.byteLength : b.size) : 0; };
    const empty = rec.drawings.filter((d) => !sizeOf(d)).length;
    if (empty) { savedStatus(tr`Sauvegarde incomplète : ${empty} image(s) manquante(s).`); return; }
    // les images doivent se relire : un essai sur la première avant de tout vider
    try {
      const probe = await createImageBitmap(new Blob([bytesOf(rec.drawings[0])], { type: rec.drawings[0].type || 'image/jpeg' }));
      if (probe.close) probe.close();
    } catch (e) {
      savedStatus(tr('Les images de cette sauvegarde ne peuvent pas être relues par ce navigateur. Sauvegardez de nouveau la composition.'));
      return;
    }
    savedStatus(tr`Réouverture de « ${rec.name} » : ${rec.drawings.length} dessins à réimporter…`);
    state.restoring = true;
    // réglages d'abord, pour que la toile et le fond soient les mêmes
    const sv = rec.settings || {};
    if (sv.format && [...$('format').options].some((o) => o.value === sv.format)) $('format').value = sv.format;
    if (sv.orient) setCanvasOrient(sv.orient);
    if (sv.ground !== undefined) setGround(sv.ground === 'auto' ? undefined : sv.ground);
    if (sv.grain !== undefined) $('grain').checked = sv.grain;
    if (sv.density !== undefined) $('density').value = sv.density;
    if (sv.pale && $('pale')) $('pale').value = sv.pale;
    state.drawings = [];
    state.title = sv.title || '';
    state.titles = sv.titles || null;
    const files = rec.drawings.map((d) => new File([bytesOf(d)], d.name, { type: d.type || 'image/jpeg' }));
    const sizes = {};
    rec.drawings.forEach((d) => { sizes[d.name] = d.sizeCm; });
    try { await importFiles(files, sizes, { quiet: true, longs: rec.drawings.map((sd) => sd.work || 0) }); } finally { state.restoring = false; }
    if (!state.drawings.length) { savedStatus(tr('Aucun dessin n’a pu être relu depuis la sauvegarde.')); return; }
    // réglages par dessin
    rec.drawings.forEach((sd, i) => {
      const d = state.drawings[i];
      if (!d) return;
      d.ai = sd.ai || null;
      if (sd.photoMode && sd.photoMode !== d.photoMode) setPhotoMode(d, sd.photoMode);
      if (sd.orient && sd.orient !== d.orient) { d.orient = sd.orient; }
      if (sd.tone) d.tone = sd.tone; else delete d.tone;
      d.role = sd.role; // rôle effectif figé : la composition compte dessus
      ensureMaterial(d);
      (d.analysis.pieces || []).forEach((p, k) => { if (sd.enabled && sd.enabled[k] !== undefined) p.enabled = sd.enabled[k]; if (sd.pieceAi && sd.pieceAi[k]) p.ai = sd.pieceAi[k]; });
    });
    applyOrientations();
    // retouches de découpe, rejouées sur les pages réimportées (après l'orientation : même page)
    let nEdits = 0, nSkipped = 0;
    for (let i = 0; i < rec.drawings.length; i++) {
      const sd = rec.drawings[i], d = state.drawings[i];
      if (!d || !sd.pieceEdits) continue;
      for (let k = 0; k < sd.pieceEdits.length; k++) {
        const e = sd.pieceEdits[k], p = (d.analysis.pieces || [])[k];
        if (!e || !p || !e.mask) continue;
        try { await applySavedEdit(p, d, e); nEdits++; } catch (err) { nSkipped++; console.warn(`retouche non rejouée sur « ${d.name} »`, err); }
      }
    }
    if (nEdits) savedStatus(tr`${nEdits} retouche(s) de découpe rejouée(s)…`);
    planCoverage();
    refreshLists();
    regenerate();
    // la mise en place sauvegardée
    const c = rec.comp;
    const comp = Object.assign({}, c, { bg: [], items: [] });
    c.bg.forEach((L) => {
      if (L.paper || L.d < 0) { comp.bg.push(Object.assign({ kind: 'bg', paper: true }, L, { src: Compose.paperLayer ? Compose.paperLayer(c.W, c.H).src : null })); return; }
      const d = state.drawings[L.d];
      if (!d) return;
      ensureMaterial(d);
      const t = d.analysis.texture;
      if (!t) return;
      comp.bg.push(Object.assign({ kind: 'bg' }, L, { src: t.canvas, sw: L.sw || t.canvas.width, sh: L.sh || t.canvas.height, sx: L.sx || 0, sy: L.sy || 0 }));
    });
    comp.bg = comp.bg.filter((L) => L.src);
    for (const L of c.items) {
      const d = state.drawings[L.d];
      let p = d && d.analysis.pieces ? d.analysis.pieces[L.p] : null;
      if (!p) continue;
      p.enabled = true; p.placed = true;
      // copie dupliquée sur l'œuvre : sa propre découpe, rejouée sur elle seule
      if (L.copy) {
        p = copyPiece(p);
        if (L.copy.edit) try { await applySavedEdit(p, d, L.copy.edit); } catch (err) { nSkipped++; console.warn(`découpe de copie non rejouée sur « ${d.name} »`, err); }
      }
      const item = Object.assign({ kind: 'piece', piece: p }, L);
      delete item.copy;
      comp.items.push(item);
    }
    state.pinned = comp;
    regenerate();
    const i = STYLES.findIndex((st) => st.id === comp.style);
    selectProposal(i >= 0 ? i : 0);
    clearHistory();
    savedStatus(tr`Composition « ${rec.name} » rouverte : ${comp.items.length} découpes et ${comp.bg.length} pages reposées${nEdits ? tr`, ${nEdits} retouche(s) rejouée(s)` : ''}${nSkipped ? tr`, ${nSkipped} retouche(s) non rejouée(s) : dessin relu différemment, découpe automatique gardée` : ''}. L’œuvre est affichée sur la toile.`);
    if (nSkipped) notice(tr`${nSkipped} retouche(s) de découpe n’ont pas pu être replacées sur le dessin relu : la découpe automatique est gardée pour ce(s) dessin(s).`);
  }

  $('save-comp').onclick = requireAccount(tr('sauvegarder votre composition'), askSaveName);
  $('save-form').onsubmit = (e) => { e.preventDefault(); saveComposition($('save-name').value); };
  $('save-cancel').onclick = () => { $('save-form').hidden = true; };
  renderSaved();
  resumeDraft();

  // ---------- Compte utilisateur (voir js/account.js) ----------
  (function accountUi() {
    const A = window.Account;
    const box = $('account'), sec = $('account-section');
    if (!A || !A.enabled) { if (sec) sec.remove(); return; }
    A.init();
    box.hidden = false;
    const status = (t, bad) => { const el = $('acc-status'); el.textContent = t || ''; el.hidden = !t; el.classList.toggle('bad', !!bad); };
    let mode = 'signin';
    const setMode = (m) => {
      mode = m;
      document.querySelectorAll('.auth-tabs button').forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      $('auth-name-field').hidden = m !== 'signup';
      $('auth-submit').textContent = m === 'signup' ? tr('Créer mon compte') : 'Se connecter';
      $('acc-title').textContent = m === 'signup' ? tr('Bienvenue à l’atelier') : tr('Content de vous revoir');
      $('acc-sub').textContent = m === 'signup' ? tr('Gardez vos compositions et retrouvez-les sur tous vos appareils.') : tr('Connectez-vous pour retrouver vos compositions.');
      $('auth-password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
      $('auth-password').placeholder = m === 'signup' ? tr('10 caractères au moins') : tr('Votre mot de passe');
      if ($('auth-meter')._update) $('auth-meter')._update();
      $('auth-forgot').hidden = m === 'signup';
      status('');
    };
    document.querySelectorAll('.auth-tabs button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
    updateExportNote();
    const openPanel = (open) => {
      sec.hidden = !open;
      $('acc-menu').setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('acc-open', open);
      if (open) { const first = sec.querySelector('input:not([hidden]):not([type=hidden])'); if (first && window.matchMedia('(min-width: 601px)').matches) setTimeout(() => first.focus(), 50); }
    };
    $('acc-open').onclick = () => openPanel(true);
    $('acc-menu').onclick = () => openPanel(sec.hidden);
    window.openAccount = (hint) => { openPanel(true); if (hint) status(hint); };
    $('acc-close').onclick = () => openPanel(false);
    sec.addEventListener('click', (e) => { if (e.target === sec) openPanel(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sec.hidden) openPanel(false); });
    // solidité du mot de passe, en direct, pour les trois champs de création
    const meterFor = (inputId, meterId, ctxFn) => {
      const inp = $(inputId), m = $(meterId);
      if (!inp || !m) return;
      const update = () => {
        const pw = inp.value;
        if (!pw || (inputId === 'auth-password' && mode !== 'signup')) { m.hidden = true; return; }
        const r = A.checkPassword(pw, ctxFn());
        m.hidden = false;
        m.dataset.score = String(r.score);
        m.querySelector('.pw-label').textContent = r.label;
        m.querySelector('.pw-tips').textContent = r.problems.length ? tr`À améliorer : ${r.problems.join(' ; ')}.` : tr('Ce mot de passe convient.');
      };
      inp.addEventListener('input', update);
      inp.addEventListener('focus', update);
      m._update = update;
    };
    meterFor('auth-password', 'auth-meter', () => ({ email: $('auth-email').value, name: $('auth-name').value }));
    meterFor('recover-password', 'recover-meter', () => ({ email: (A.user() || {}).email }));
    meterFor('profile-password', 'profile-meter', () => ({ email: (A.user() || {}).email, name: $('profile-name').value }));
    const strongOrThrow = (pw, ctx) => { const r = A.checkPassword(pw, ctx); if (!r.ok) throw new Error(tr`Mot de passe trop faible : ${r.problems.join(' ; ')}.`); };
    // afficher / masquer les mots de passe
    sec.querySelectorAll('.pw-eye').forEach((b) => {
      b.onclick = () => { const inp = $(b.dataset.for); const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; b.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye'); b.setAttribute('aria-label', show ? tr('Masquer le mot de passe') : tr('Afficher le mot de passe')); };
    });
    const busy = async (fn, okMsg) => {
      try { status(tr('Un instant…')); await fn(); if (okMsg !== null) status(okMsg || ''); }
      catch (e) { console.error(e); status(e.message || 'Une erreur est survenue.', true); }
    };
    // La connexion Google quitte la page : l'œuvre en cours est mise en brouillon juste avant, et
    // reprise d'elle-même au retour (voir resumeDraft), avec l'action demandée rappelée.
    document.querySelectorAll('.social-btn').forEach((b) => { b.onclick = () => {
      window.Atelier.track('Inscription', { via: b.dataset.provider });
      busy(async () => {
        if (state.comp && state.drawings.length) {
          clearTimeout(draftTimer);
          await saveDraft();
          try { sessionStorage.setItem(AFTER_AUTH_KEY, state.afterSignInLabel || '1'); } catch (e) { /* ignoré */ }
        }
        await A.signInWith(b.dataset.provider);
      }, tr('Redirection vers la connexion…'));
    }; });
    $('auth-form').onsubmit = (e) => {
      e.preventDefault();
      const email = $('auth-email').value.trim(), pw = $('auth-password').value;
      if (!email || !pw) { status(tr('Indiquez votre e-mail et votre mot de passe.'), true); return; }
      if (mode === 'signup') {
        busy(async () => {
          strongOrThrow(pw, { email, name: $('auth-name').value });
          const r = await A.signUpEmail(email, pw, $('auth-name').value.trim());
          window.Atelier.track('Inscription', { via: 'email' });
          if (r.needsConfirm) { setMode('signin'); status(tr`Compte créé : confirmez votre e-mail avec le lien envoyé à ${email}, puis connectez-vous.`); }
        }, null);
      } else {
        busy(() => A.signInEmail(email, pw), '');
      }
    };
    $('auth-forgot').onclick = () => { const email = $('auth-email').value.trim(); if (!email) { status(tr('Indiquez d’abord votre e-mail.'), true); return; } busy(() => A.resetPassword(email), tr`Un lien pour choisir un nouveau mot de passe a été envoyé à ${email}.`); };
    $('auth-magic').onclick = () => { const email = $('auth-email').value.trim(); if (!email) { status(tr('Indiquez d’abord votre e-mail.'), true); return; } busy(() => A.magicLink(email), tr`Un lien de connexion a été envoyé à ${email}. Ouvrez-le sur cet appareil.`); };
    $('recover-form').onsubmit = (e) => { e.preventDefault(); const pw = $('recover-password').value; busy(async () => { strongOrThrow(pw, { email: (A.user() || {}).email }); await A.updatePassword(pw); }, tr('Nouveau mot de passe enregistré.')); };
    $('profile-form').onsubmit = (e) => {
      e.preventDefault();
      const u = A.user(); if (!u) return;
      const name = $('profile-name').value.trim(), email = $('profile-email').value.trim(), pw = $('profile-password').value;
      busy(async () => {
        const done = [];
        if (name && name !== A.displayName(u)) { await A.updateProfile({ name }); done.push(tr('nom enregistré')); }
        if (email && email !== u.email) { await A.updateEmail(email); done.push(tr`un lien de confirmation a été envoyé à ${email}`); }
        if (pw) { strongOrThrow(pw, { email: u.email, name }); await A.updatePassword(pw); $('profile-password').value = ''; $('profile-meter').hidden = true; done.push(tr('mot de passe changé')); }
        status(done.length ? `${done.join(', ')}.` : tr('Rien à enregistrer.'));
      }, null);
    };
    $('acc-signout').onclick = () => busy(() => A.signOut(), tr('Vous êtes déconnecté.'));
    const del = $('acc-delete');
    del.onclick = () => {
      if (!del.classList.contains('confirm')) {
        del.classList.add('confirm'); del.textContent = tr('Confirmer la suppression définitive');
        setTimeout(() => { del.classList.remove('confirm'); del.textContent = tr('Supprimer mon compte'); }, 6000);
        return;
      }
      busy(() => A.deleteAccount(), tr('Compte supprimé. Vos sauvegardes locales sont conservées.'));
    };
    const PROVIDERS = { google: 'Google', email: tr('votre e-mail') };
    let wasSigned = null;
    A.onChange((u, info) => {
      updateExportNote();
      const signed = !!u, recovering = !!(info && info.recovering);
      $('acc-open').hidden = signed;
      $('acc-menu').hidden = !signed;
      $('auth-box').hidden = signed || recovering;
      $('profile-box').hidden = !signed || recovering;
      $('recover-form').hidden = !recovering;
      if (signed) {
        const name = A.displayName(u);
        $('acc-menu').querySelector('.acc-name').textContent = name;
        const av = $('acc-menu').querySelector('.acc-avatar');
        const pic = u.user_metadata && (u.user_metadata.avatar_url || u.user_metadata.picture);
        [av, $('profile-avatar')].forEach((a) => { a.textContent = pic ? '' : (name[0] || '?').toUpperCase(); a.style.backgroundImage = pic ? `url("${pic}")` : ''; });
        $('profile-title').textContent = name ? tr`Bonjour ${name}` : tr('Mon compte');
        $('profile-name').value = name;
        $('profile-email').value = u.email || '';
        $('profile-meta').textContent = tr`Connecté avec ${PROVIDERS[A.providerOf(u)] || A.providerOf(u)}${u.email ? ` (${u.email})` : ''}.`;
        $('profile-password-field').hidden = A.providerOf(u) !== 'email';
      }
      if (recovering) openPanel(true);
      else if (wasSigned === false && signed) {
        openPanel(false); status('');
        const next = state.afterSignIn; state.afterSignIn = null;
        if (next) setTimeout(next, 150); // l'action demandée avant la connexion reprend
      }
      else if (wasSigned === true && !signed) { openPanel(false); setMode('signin'); }
      wasSigned = signed;
      $('saved-hint').textContent = signed
        ? tr('Vos compositions et vos exports sont enregistrés dans votre compte : retrouvez-les sur tous vos appareils.')
        : tr('Connectez-vous pour sauvegarder vos compositions, télécharger vos œuvres et les retrouver sur tous vos appareils.');
      renderSaved();
      renderExports();
    });
  })();

  // Sections repliables : un clic sur le titre replie ou développe la section, le choix est mémorisé.
  (function collapsibleSections() {
    let saved = [];
    // à la première visite, seules les étapes essentielles sont ouvertes (importer, propositions, exporter)
    const DEFAULT_COLLAPSED = ['drawings-section', 'room-section'];
    try { const v = localStorage.getItem('atelier.collapsed'); saved = v === null ? DEFAULT_COLLAPSED : JSON.parse(v); } catch (e) { saved = DEFAULT_COLLAPSED; }
    document.querySelectorAll('aside section.step').forEach((sec) => {
      const h = sec.querySelector(':scope > h2');
      if (!h || !sec.id) return;
      const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chev.setAttribute('class', 'chev'); chev.setAttribute('viewBox', '0 0 24 24'); chev.setAttribute('aria-hidden', 'true');
      chev.innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
      h.appendChild(chev);
      h.setAttribute('role', 'button'); h.setAttribute('tabindex', '0');
      const apply = (collapsed) => { sec.classList.toggle('collapsed', collapsed); h.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); h.title = collapsed ? tr('Développer') : tr('Réduire'); };
      sec._expand = () => apply(false);
      apply(saved.includes(sec.id));
      const toggle = () => {
        apply(!sec.classList.contains('collapsed'));
        const list = [...document.querySelectorAll('aside section.step.collapsed')].map((x) => x.id);
        try { localStorage.setItem('atelier.collapsed', JSON.stringify(list)); } catch (e) { /* ignoré */ }
      };
      h.addEventListener('click', toggle);
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
  })();

  // Les étapes sont numérotées d'après ce qui est visible : pas de « 05 » juste après « 01 ».
  function renumberSteps() {
    let n = 0;
    document.querySelectorAll('aside section.step').forEach((sec) => {
      const num = sec.querySelector(':scope > h2 .num');
      if (!num || sec.hidden) return;
      num.textContent = String(++n).padStart(2, '0');
    });
  }

  // Téléphone : le carnet est un tiroir à onglets sous l'œuvre ; un onglet par étape.
  const TAB_OF = { more: ['saved-section', 'room-section'] };
  function selectTab(id) {
    const panel = document.querySelector('.panel');
    const tabs = $('sheet-tabs');
    if (!panel || !tabs) return;
    if (!mobileQuery.matches) { panel.classList.remove('tabbed'); panel.removeAttribute('data-tab'); return; }
    const btn = tabs.querySelector(`[data-tab="${id}"]`);
    if (!btn || (!TAB_OF[id] && $(id).hidden)) return;
    btn.disabled = false;
    // la fiche d'un dessin (tiroir à mi-hauteur) ne reste ouverte que dans l'onglet Dessins
    document.body.classList.toggle('sheet-detail', id === 'drawings-section' && !!state.current);
    panel.classList.add('tabbed');
    panel.dataset.tab = id;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    const show = TAB_OF[id] || [id];
    document.querySelectorAll('aside section.step').forEach((sec) => {
      const on = show.includes(sec.id);
      sec.classList.toggle('tab-on', on);
      if (on && sec._expand) sec._expand();
    });
    panel.scrollTop = 0;
  }
  function syncTabs() {
    const tabs = $('sheet-tabs');
    if (!tabs) return;
    tabs.querySelectorAll('button').forEach((b) => {
      const id = b.dataset.tab;
      if (TAB_OF[id]) return;
      b.disabled = !!$(id).hidden;
    });
    renumberSteps();
    const panel = document.querySelector('.panel');
    if (mobileQuery.matches) {
      const cur = panel.dataset.tab;
      const curBtn = cur && tabs.querySelector(`[data-tab="${cur}"]`);
      if (!cur || !curBtn || curBtn.disabled) selectTab(state.drawings.length ? 'compose-section' : 'import-section');
    } else { panel.classList.remove('tabbed'); panel.removeAttribute('data-tab'); }
  }
  (function sheetTabs() {
    const tabs = $('sheet-tabs');
    if (!tabs) return;
    tabs.querySelectorAll('button').forEach((b) => { b.onclick = () => selectTab(b.dataset.tab); });
    // la poignée (double-clic ou glissement vertical) agrandit ou réduit le tiroir
    tabs.addEventListener('dblclick', () => document.body.classList.toggle('sheet-tall'));
    let ty = null;
    tabs.addEventListener('touchstart', (e) => { ty = e.touches[0].clientY; }, { passive: true });
    tabs.addEventListener('touchend', (e) => {
      if (ty === null) return;
      const dy = e.changedTouches[0].clientY - ty; ty = null;
      if (Math.abs(dy) < 48) return; // un vrai glissement, pas un début de défilement
      document.body.classList.toggle('sheet-tall', dy < 0);
    }, { passive: true });
    const obs = new MutationObserver(syncTabs);
    document.querySelectorAll('aside section.step').forEach((sec) => obs.observe(sec, { attributes: true, attributeFilter: ['hidden'] }));
    const onMedia = () => syncTabs();
    if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onMedia); else mobileQuery.addListener(onMedia);
    syncTabs();
  })();

  // Navigateur en anglais mais français parmi ses langues (ou fuseau francophone) : on propose la
  // version française, une seule fois.
  (function langOffer() {
    const el = $('lang-offer');
    if (!el || !window.I18n || I18n.lang !== 'en') return;
    let chosen = null, seen = null;
    try { chosen = localStorage.getItem('atelier-gribouille:lang'); seen = localStorage.getItem('atelier-gribouille:lang-offer'); } catch (e) { /* ignoré */ }
    if (chosen || seen) return;
    const langs = navigator.languages || [navigator.language];
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    const french = langs.some((l) => /^fr\b/i.test(l)) || /^Europe\/(Paris|Brussels|Zurich|Luxembourg|Monaco)$|^America\/Montreal$/.test(tz);
    if (!french) return;
    el.hidden = false;
    document.body.classList.add('has-lang-offer');
    $('lang-offer-close').onclick = () => { el.hidden = true; document.body.classList.remove('has-lang-offer'); try { localStorage.setItem('atelier-gribouille:lang-offer', '1'); } catch (e) { /* ignoré */ } };
  })();

  fillFormats();
  fillGround();

  // accès pour le débogage depuis la console
  window.AtelierGribouille = { state, options, selectProposal, curate, planCoverage, regenerate, hydrateHD, releaseHD, exportSize, editPiece, estimateSizes, render, undo, redo };
  // Dessins d'exemple : proposés (jamais chargés d'office) s'ils sont fournis avec la page ou
  // présents dans samples/manifest.json à côté de l'app ; un clic sur « exemple » les importe.
  (async function offerSamples() {
    let m = window.COLLAGE_SAMPLES || null;
    if (!m) {
      try { const r = await fetch('samples/manifest.json', { cache: 'no-store' }); if (r.ok) m = await r.json(); } catch (e) { m = null; }
    }
    if (!m || !m.pages || !m.pages.length) return;
    state.sampleManifest = m;
    $('sample-offer').hidden = false;
    if (!state.resuming) $('empty-sample').hidden = false; // pas pendant la réouverture de l'œuvre en cours
    let busy = false;
    const go = async () => { if (busy) return; busy = true; try { await loadSamples(m); } finally { busy = false; } };
    $('load-sample').onclick = go;
    $('empty-sample').onclick = go;
    if (window.COLLAGE_AUTOLOAD || /[?&]exemple\b/.test(location.search)) go();
  })();

  render();
})();
