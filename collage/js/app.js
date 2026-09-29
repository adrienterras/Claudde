/* Atelier Gribouille — interface : import des scans, gestion des dessins, édition interactive et export. */
(function () {
  'use strict';

  const SOURCE_MAX = 1400; // résolution conservée pour chaque page scannée (plus grand côté)
  const $ = (id) => document.getElementById(id);

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

  function setProgress(done, total, label) {
    const p = $('progress');
    p.hidden = done >= total;
    p.querySelector('div').style.width = `${(100 * done) / Math.max(1, total)}%`;
    p.querySelector('span').textContent = label || `${done} / ${total}`;
  }

  async function pagesFromFile(file) {
    const pages = [];
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        pages.push({
          name: `${file.name} — p.${i}`,
          render: async () => {
            const page = await pdf.getPage(i);
            const vp0 = page.getViewport({ scale: 1 });
            const long = Math.max(vp0.width, vp0.height);
            const vp = page.getViewport({ scale: SOURCE_MAX / long });
            const c = Extract.makeCanvas(vp.width, vp.height);
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            // Un PDF de scanner à plat donne la vraie taille de la feuille ;
            // un scan de téléphone donne seulement une taille en pixels.
            const short = Math.min(vp0.width, vp0.height);
            const physical = PHYSICAL_PT.some(([a, b]) => Math.abs(short / a - 1) < 0.012 && Math.abs(long / b - 1) < 0.012);
            return { canvas: c, origLong: long, origShort: short, physCm: physical ? (long / 72) * 2.54 : null };
          },
        });
      }
    } else if (file.type.startsWith('image/')) {
      pages.push({
        name: file.name,
        render: async () => {
          const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
          const c = Extract.scaleTo(bmp, SOURCE_MAX);
          const origLong = Math.max(bmp.width, bmp.height), origShort = Math.min(bmp.width, bmp.height);
          bmp.close && bmp.close();
          return { canvas: c, origLong, origShort, physCm: null };
        },
      });
    }
    return pages;
  }

  // Vignette ; en PNG pour les pièces découpées, qui ont un fond transparent.
  function thumbOf(canvas, max, png) {
    return Extract.scaleTo(canvas, max || 160).toDataURL(png ? 'image/png' : 'image/jpeg', 0.8);
  }

  async function importFiles(files, sizes) {
    let pages = [];
    notice('');
    setProgress(0, 1, 'Lecture des fichiers…');
    for (const f of files) {
      try {
        pages = pages.concat(await pagesFromFile(f));
      } catch (e) {
        console.error(e);
        notice(`Impossible de lire « ${f.name} ». Vérifiez qu’il s’agit d’un PDF, JPG ou PNG.`);
      }
    }
    for (let i = 0; i < pages.length; i++) {
      setProgress(i, pages.length, `Analyse du dessin ${i + 1} / ${pages.length}…`);
      await tick();
      try {
        const src = await pages[i].render();
        const analysis = Extract.analyze(src.canvas);
        const d = {
          id: ++state.seq, name: pages[i].name, thumb: thumbOf(analysis.page), analysis, role: 'auto',
          srcLong: Math.max(src.canvas.width, src.canvas.height), origLong: src.origLong, origShort: src.origShort || 1, physCm: src.physCm,
          sizeCm: 29.7, sizeMode: 'auto',
        };
        preparePieces(analysis.pieces, d);
        loadSize(d);
        if (sizes && sizes[d.name]) { d.sizeCm = sizes[d.name]; d.sizeMode = 'manual'; }
        state.drawings.push(d);
      } catch (e) {
        console.error(e);
      }
    }
    setProgress(1, 1);
    estimateSizes();
    state.drawings.forEach(ensureMaterial);
    curate();
    planCoverage();
    if (state.drawings.length) {
      ['drawings-section', 'compose-section', 'export-section'].forEach((id) => ($(id).hidden = false));
      $('empty').hidden = true;
    }
    refreshLists();
    regenerate();
    artDirect();
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
    state.drawings.forEach((d) => {
      d.uncertain = false;
      if (d.sizeMode !== 'auto') return;
      if (d.physCm) { d.sizeCm = d.physCm; return; }
      const est = (d.origLong / median) * 29.7;
      const ratio = d.origLong / Math.max(1, d.origShort);
      const sheetLike = ratio > 1.15 && ratio < 1.75; // proportions plausibles d'une feuille
      const snap = SHEETS.find(([, cm]) => Math.abs(est / cm - 1) < 0.15);
      // on n'arrondit à un format standard que si la feuille en a les proportions ;
      // un rouleau, une bande ou un très grand format restent à leur estimation, à vérifier
      d.sizeCm = sheetLike && snap ? snap[1] : Math.round(est);
      d.uncertain = !(sheetLike && snap) || est > 45 || est < 15;
    });
  }

  // Bandeau « tailles à vérifier » : les feuilles dont la taille n'a pas pu être reconnue.
  function renderUncertain() {
    const box = $('sizes-check');
    const list = state.drawings.filter((d) => d.uncertain && d.sizeMode === 'auto');
    box.hidden = !list.length;
    if (!list.length) return;
    box.innerHTML = `<p class="sizes-title">Tailles à vérifier <small>(${list.length})</small></p>
      <p class="hint">Ces feuilles n’ont pas un format standard : indiquez leur plus grand côté, en cm. C’est ce qui fixe leur taille dans l’œuvre.</p>
      <div class="sizes-list"></div>`;
    const wrap = box.querySelector('.sizes-list');
    list.forEach((d) => {
      const row = document.createElement('label');
      row.className = 'sizes-row';
      row.innerHTML = `<img src="${d.thumb}" alt=""><span class="sizes-name">Dessin ${state.drawings.indexOf(d) + 1}<small>estimé ${fmt(d.sizeCm)} cm</small></span>
        <span class="sizes-input"><input type="number" min="3" max="300" step="0.5" placeholder="${fmt(d.sizeCm).replace(',', '.')}" aria-label="Plus grand côté en cm"><em>cm</em></span>`;
      const input = row.querySelector('input');
      input.onchange = () => {
        const cm = Number(input.value);
        if (!(cm > 0)) return;
        d.sizeCm = cm;
        d.sizeMode = 'manual';
        saveSize(d);
        refreshLists();
        regenerate();
      };
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

  function sheetName(cm) {
    const s = SHEETS.find(([, v]) => Math.abs(v - cm) < 0.05);
    return s ? s[0] : `${fmt(cm)} cm`;
  }

  const fmt = (v) => (Math.round(v * 10) / 10).toLocaleString('fr-FR');

  // ---------- Dessins & pièces ----------

  const ROLES = ['cutout', 'texture', 'off'];
  const ROLE_LABEL = { cutout: 'découpe', texture: 'fond', off: 'ignoré' };

  // Rôle d'un dessin : choix de l'utilisateur, sinon celui du directeur artistique (Claude),
  // sinon celui de l'analyse d'image.
  function roleOf(d) {
    if (d.role !== 'auto') return d.role;
    if (d.auto) return d.auto; // choix du plan de couverture
    if (d.ai) return d.ai.role === 'fond' ? 'texture' : 'cutout';
    // Un dessin au crayon gris (souvent avec du texte) se découpe mal : on le colle en page entière.
    if (d.analysis.kind === 'cutout' && pale(d)) return 'texture';
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
    return painted * 1.2 + (t.colorful || 0) * 0.6 + Math.min(1, d.sizeCm / 42) * 0.3 - subject * 1.5 + ai;
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
  function planCoverage() {
    const v = $('format').value;
    const auto = v.startsWith('auto:');
    const density = Number($('density').value);
    const cands = state.drawings.filter((d) => d.role === 'auto');
    cands.forEach((d) => { d.auto = null; });
    const ranked = cands.slice().sort((a, b) => bgMerit(b) - bgMerit(a));
    const forcedBg = state.drawings.filter((d) => d.role === 'texture').reduce((sum, d) => sum + pageAreaCm2(d), 0);
    const minBg = ranked.length ? Math.min(ranked.length, Math.max(2, ranked.filter((d) => roleOf(d) === 'texture').length)) : 0;
    let chosen = { nBg: minBg, area: 7000 };
    if (auto) {
      for (let nBg = minBg; nBg <= ranked.length; nBg++) {
        ranked.forEach((d, i) => { d.auto = i < nBg ? 'texture' : 'cutout'; });
        const { bgArea, pieceArea } = paperAreas(state.drawings);
        const canvasArea = (bgArea + forcedBg * 0) / 1.15;
        chosen = { nBg, area: canvasArea };
        if (pieceArea <= 0.5 * density * canvasArea || nBg >= ranked.length) break;
      }
      state.canvasArea = Math.max(chosen.area, 900);
      state.coverage = 1.15;
    } else {
      const [w, h] = v.split('x').map(Number);
      const canvasArea = w * h;
      let nBg = minBg;
      for (; nBg <= ranked.length; nBg++) {
        ranked.forEach((d, i) => { d.auto = i < nBg ? 'texture' : 'cutout'; });
        const { bgArea } = paperAreas(state.drawings);
        if (bgArea >= canvasArea * 1.15) break;
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
      a.pieces = Extract.cutPieces(a.page, a.seg);
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
  const EXTRAS_PER_DRAWING = 4;
  function curate() {
    state.drawings.forEach((d) => {
      const ps = d.analysis.pieces || [];
      const main = ps.reduce((a, b) => (!a || b.frac > a.frac ? b : a), null);
      ps.slice().sort((a, b) => rank(b) - rank(a)).filter((p) => p !== main && eligible(p))
        .forEach((p, i) => { p.enabled = i < EXTRAS_PER_DRAWING; p.main = false; });
      ps.forEach((p) => { if (p !== main && !eligible(p)) { p.enabled = false; p.main = false; } });
      if (main) { main.enabled = true; main.main = true; }
    });
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

  function refreshLists() {
    renderUncertain();
    const dEl = $('drawings');
    dEl.innerHTML = '';
    state.drawings.forEach((d) => {
      const role = roleOf(d);
      const el = document.createElement('div');
      el.className = `thumb ${role}${state.current === d ? ' current' : ''}`;
      el.title = d.ai ? `${d.ai.sujet} — ${d.name}` : d.name;
      el.innerHTML = `<img src="${d.thumb}" alt=""><b class="tag ${role}">${ROLE_LABEL[role]}</b><i class="size${d.uncertain && d.sizeMode === 'auto' ? ' unsure' : ''}">${d.uncertain && d.sizeMode === 'auto' ? '? ' : ''}${sheetName(d.sizeCm)}</i>`;
      el.onclick = () => { state.current = state.current === d ? null : d; refreshLists(); };
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
    box.innerHTML = `
      <img src="${d.thumb}" alt="">
      <div>
        <p class="name">${d.ai ? `${d.ai.sujet} <small>· ${d.ai.zone}</small><br>` : ''}<small>${d.name}</small></p>
        <div class="seg">${ROLES.map((r) => `<button data-role="${r}" class="${r === role ? 'on ' + r : ''}">${ROLE_LABEL[r]}</button>`).join('')}</div>
        <label class="row">Taille réelle
          <select data-size>
            ${SHEETS.map(([n, cm]) => `<option value="${cm}" ${Math.abs(cm - d.sizeCm) < 0.05 ? 'selected' : ''}>${n} · ${fmt(cm)}</option>`).join('')}
            <option value="custom" ${SHEETS.some(([, cm]) => Math.abs(cm - d.sizeCm) < 0.05) ? '' : 'selected'}>Autre…</option>
          </select>
        </label>
        <label class="row" data-custom ${SHEETS.some(([, cm]) => Math.abs(cm - d.sizeCm) < 0.05) ? 'hidden' : ''}>Plus grand côté (cm)
          <input type="number" min="3" max="200" step="0.5" value="${fmt(d.sizeCm).replace(',', '.')}">
        </label>
        ${mainPiece(d) ? `<label class="row" data-subject>Ou taille du sujet (cm)
          <input type="number" min="1" max="200" step="0.5" placeholder="${fmt(subjectCm(d))}" title="Plus grand côté du sujet découpé, mesuré sur le dessin original">
        </label>` : ''}
        <p class="hint">${d.sizeMode === 'auto' ? (d.physCm ? 'Taille lue dans le PDF.' : 'Taille estimée d’après le scan — corrigez-la si besoin.') : 'Taille saisie.'}
          Sur l’œuvre : ${fmt(aw)} × ${fmt(ah)} cm, à sa taille réelle.${mainPiece(d) ? ` Sujet principal : ${fmt(subjectCm(d))} cm.` : ''}</p>
      </div>`;
    box.querySelectorAll('[data-role]').forEach((b) => (b.onclick = () => {
      d.role = b.dataset.role;
      ensureMaterial(d);
      refreshLists();
      regenerate();
    }));
    const sel = box.querySelector('[data-size]');
    const custom = box.querySelector('[data-custom]');
    const setSize = (cm) => {
      if (!(cm > 0)) return;
      d.sizeCm = cm;
      d.sizeMode = 'manual';
      saveSize(d);
      refreshLists();
      regenerate();
    };
    const subject = box.querySelector('[data-subject] input');
    if (subject) {
      // taille connue du sujet → taille de la feuille entière, par simple proportion
      subject.onchange = () => {
        const cm = Number(subject.value);
        const p = mainPiece(d);
        if (cm > 0 && p) setSize((cm * d.srcLong) / Math.max(p.canvas.width, p.canvas.height));
      };
    }
    sel.onchange = () => {
      if (sel.value === 'custom') { custom.hidden = false; custom.querySelector('input').focus(); return; }
      setSize(Number(sel.value));
    };
    custom.querySelector('input').onchange = (e) => setSize(Number(e.target.value));
  }

  // Le sujet principal d'un dessin découpé : sa plus grande pièce.
  function mainPiece(d) {
    if (roleOf(d) !== 'cutout') return null;
    const ps = d.analysis.pieces || [];
    return ps.reduce((a, b) => (!a || b.canvas.width * b.canvas.height > a.canvas.width * a.canvas.height ? b : a), null);
  }

  function subjectCm(d) {
    const p = mainPiece(d);
    return p ? Math.max(p.canvas.width, p.canvas.height) * cmPerPx(d) : 0;
  }

  function refreshPieces() {
    const pEl = $('pieces');
    pEl.innerHTML = '';
    const pieces = activePieces();
    pieces.forEach((p) => {
      const el = document.createElement('div');
      const unplaced = p.enabled && state.comp && !p.placed;
      el.className = `thumb${p.enabled ? '' : ' off'}${unplaced ? ' unplaced' : ''}`;
      el.title = !p.enabled ? 'Retirée — cliquer pour l’ajouter' : unplaced ? 'Pas de place à cette échelle — cliquer pour l’ajouter quand même' : 'Dans l’œuvre — cliquer pour la retirer';
      el.innerHTML = `<img src="${p.thumb}" alt=""><button class="edit-piece" title="Retoucher la découpe" aria-label="Retoucher la découpe"><svg class="ico"><use href="#i-scissors"/></svg></button>`;
      el.onclick = () => togglePiece(p);
      el.querySelector('.edit-piece').onclick = (e) => { e.stopPropagation(); editPiece(p); };
      pEl.appendChild(el);
    });
    const inArt = state.comp ? state.comp.items.length : 0;
    $('pieces-count').textContent = `(${inArt} dans l’œuvre / ${pieces.length})`;
  }

  function togglePiece(p) {
    if (!state.comp) return;
    const inArt = state.comp.items.some((L) => L.piece === p);
    if (inArt) {
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
  function formatCm() {
    const v = $('format').value;
    if (v.startsWith('auto:')) {
      const ratio = Number(v.slice(5));
      const A = state.canvasArea || 7000;
      return { w: Math.round(Math.sqrt(A * ratio)), h: Math.round(Math.sqrt(A / ratio)), auto: true };
    }
    const [w, h] = v.split('x').map(Number);
    return { w, h, auto: false };
  }

  // Formats de toile courants, pour suggérer le plus proche de la taille calculée
  const STOCK = [[100, 70], [120, 80], [150, 100], [180, 120], [200, 140], [80, 60], [60, 60], [80, 80], [100, 100], [120, 120], [70, 100], [80, 120], [100, 150]];
  function nearestStock(w, h) {
    let best = null;
    STOCK.forEach(([a, b]) => {
      [[a, b], [b, a]].forEach(([x, y]) => {
        const d = Math.abs(x - w) / w + Math.abs(y - h) / h;
        if (!best || d < best.d) best = { w: x, h: y, d };
      });
    });
    return best;
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
    let txt;
    if (f.auto) {
      const near = nearestStock(f.w, f.h);
      txt = `Toile calculée : ${f.w} × ${f.h} cm, pour que le fond (${nBg} pages, ${fmt(bgArea / 1e4, 2)} m²) couvre tout avec 15 % de recouvrement et que les découpes (${fmt(pieceArea / 1e4, 2)} m²) restent aérées. Format du commerce le plus proche : ${near.w} × ${near.h} cm.`;
    } else {
      const cov = (state.coverage || 0) * 100;
      txt = cov >= 114
        ? `Toile de ${f.w} × ${f.h} cm : le fond (${nBg} pages) la couvre avec ${Math.round(cov - 100)} % de recouvrement.`
        : cov >= 100
          ? `Toile de ${f.w} × ${f.h} cm : le fond (${nBg} pages) la couvre tout juste (${Math.round(cov)} %) ; les déchirures laisseront de petits jours.`
          : `Toile de ${f.w} × ${f.h} cm : il manque du papier, le fond ne couvre que ${Math.round(cov)} % de la toile. Choisissez une toile plus petite ou « taille adaptée aux dessins ».`;
    }
    $('scale-info').textContent = txt;
  }

  function sizePiece(p, k) {
    const c = cmPerPx(p.drawing) * k;
    p.wcm = p.canvas.width * c;
    p.hcm = p.canvas.height * c;
  }

  // ---------- Composition ----------

  // Où va chaque élément dans la scène : décision de Claude si disponible, sinon règles simples.
  const ZONES = ['ciel', 'milieu', 'sol'];
  function direct(textures, pieces) {
    const noAi = textures.filter((t) => !t.drawing.ai);
    const sky = (t) => t.lum / 255 + (t.color[2] - t.color[0]) / 255;
    noAi.sort((a, b) => sky(b) - sky(a)).forEach((t, i) => {
      t.zone = i < noAi.length / 3 ? 'ciel' : i >= (2 * noAi.length) / 3 ? 'sol' : 'milieu';
    });
    textures.forEach((t) => {
      if (t.drawing.ai) { t.zone = t.drawing.ai.zone; t.importance = t.drawing.ai.importance; }
      // une page pâle (crayon gris) reste au milieu, sous les autres
      if ((t.colorful || 0) < 0.12) { t.zone = 'milieu'; t.importance = 0; }
    });
    const ranked = pieces.slice().sort((a, b) => rank(b) - rank(a));
    pieces.forEach((p) => {
      const ai = p.drawing.ai;
      if (ai) {
        p.zone = ai.zone;
        p.grounded = p.main ? ai.pose : false;
        p.importance = p.main ? ai.importance : 1;
      } else {
        p.grounded = p.base > 0.55 && p.frac > 0.05;
        p.zone = p.grounded ? (p.frac > 0.3 ? 'sol' : 'milieu') : (p.frac < 0.06 ? 'ciel' : 'milieu');
        p.importance = ranked.indexOf(p) < 3 ? 3 : 1;
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
      rotation: Number($('rotation').value),
      grain: $('grain').checked,
      seed: state.seed,
      textures,
      pieces,
    };
  }

  // Trois styles proposés à chaque fois, avec tous les dessins.
  const STYLES = [
    { id: 'paysage', name: 'Paysage', hint: 'ciel, milieu, sol' },
    { id: 'tournesol', name: 'Tournesol', hint: 'spirale depuis le cœur' },
    { id: 'cabinet', name: 'Cabinet de curiosités', hint: 'rangées alignées' },
  ];

  function regenerate() {
    if (!state.drawings.length) return;
    planCoverage();
    updateScaleLabel();
    activePieces().forEach((p) => (p.placed = false));
    const o = options();
    state.proposals = STYLES.map((st, i) => ({ style: st, comp: Compose.generate(Object.assign({}, o, { style: st.id, seed: o.seed + i * 7919 })) }));
    state.active = Math.min(state.active || 0, 2);
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

  // Cartel sous l'œuvre, comme au musée.
  function updateLabel() {
    const el = $('label');
    if (!state.comp) { el.hidden = true; return; }
    el.hidden = false;
    const st = STYLES.find((x) => x.id === state.comp.style) || STYLES[0];
    const t = titleFor(st.id);
    $('label-title').textContent = t ? `« ${t} »` : 'Sans titre';
    $('label-meta').textContent = `${st.name} · collage de ${state.drawings.filter((d) => roleOf(d) !== 'off').length} dessins d’enfants · ${fmt(state.comp.W)} × ${fmt(state.comp.H)} cm · dessins à taille réelle`;
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
      b.innerHTML = `<img src="${thumbOfComp(pr.comp)}" alt=""><b>${pr.style.name}</b><small>${t ? `« ${t} »` : pr.style.hint}</small>`;
      b.onclick = () => selectProposal(i);
      box.appendChild(b);
    });
  }

  function selectProposal(i) {
    state.active = i;
    state.zoom = { z: 1, px: 0, py: 0 };
    state.comp = state.proposals[i].comp;
    state.selected = null;
    state.bgCache = null;
    renderProposals();
    refreshPieces();
    render();
    updateExportInfo();
    updateLabel();
  }

  // après une retouche, la vignette de la proposition active suit
  let thumbTimer = 0;
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
  }

  function draw() {
    raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth * dpr, ch = canvas.clientHeight * dpr;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const comp = state.comp;
    updateToolbar();
    if (!comp) return;
    const pad = (document.body.classList.contains('stage-full') ? 12 : 36) * dpr;
    const fitS = Math.min((cw - 2 * pad) / comp.W, (ch - 2 * pad) / comp.H);
    const Z = state.zoom;
    const s = fitS * Z.z;
    // on garde toujours un morceau de l'œuvre à l'écran
    const mx = Math.max(0, (comp.W * s - cw) / 2 + cw * 0.4), my = Math.max(0, (comp.H * s - ch) / 2 + ch * 0.4);
    Z.px = Math.max(-mx, Math.min(mx, Z.px));
    Z.py = Math.max(-my, Math.min(my, Z.py));
    const ox = (cw - comp.W * s) / 2 + Z.px, oy = (ch - comp.H * s) / 2 + Z.py;
    view = { s, ox, oy, dpr, fitS };
    const shadows = $('shadows').checked;
    $('zoom-val').textContent = `${Math.round(Z.z * 100)} %`;

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
    const items = state.comp.items;
    for (let i = items.length - 1; i >= 0; i--) if (Compose.hitItem(items[i], p.X, p.Y)) return items[i];
    return null;
  }

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
        drag = { mode: 'rotate', L, a0: Math.atan2(p.Y - L.y, p.X - L.x), r0: L.rot };
        return;
      }
    }
    const hit = hitAt(p);
    if (hit) {
      state.selected = hit;
      drag = { mode: 'move', L: hit, dx: p.X - hit.x, dy: p.Y - hit.y, x0: hit.x, y0: hit.y };
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
    if (drag && drag.mode !== 'pan') refreshActiveThumb();
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
    L.rot += e.deltaY * 0.002;
    render();
  }, { passive: false });

  // double-clic / double-tap : sur une pièce, on la retouche ; ailleurs, on zoome ou on revient
  canvas.addEventListener('dblclick', (e) => {
    if (!state.comp) return;
    const hit = hitAt(toComp(e));
    if (hit) { state.selected = hit; editPiece(hit.piece); return; }
    if (state.zoom.z > 1.05) resetZoom();
    else { const d = devicePoint(e); zoomAt(2.5, d.px, d.py); }
  });

  $('zoom-in').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(1.4, (r.width * view.dpr) / 2, (r.height * view.dpr) / 2); };
  $('zoom-out').onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(1 / 1.4, (r.width * view.dpr) / 2, (r.height * view.dpr) / 2); };
  $('zoom-fit').onclick = resetZoom;
  $('zoom-full').onclick = () => {
    const on = document.body.classList.toggle('stage-full');
    $('zoom-full').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('zoom-full').title = on ? 'Quitter le plein écran' : 'Plein écran';
    state.bgCache = null;
    render();
  };

  // ---------- Retouche d'une découpe ----------

  function pieceName(p) {
    const d = p.drawing;
    const n = state.drawings.indexOf(d) + 1;
    const base = d.ai && d.ai.sujet ? d.ai.sujet.charAt(0).toUpperCase() + d.ai.sujet.slice(1) : `Dessin ${n}`;
    const ps = d.analysis.pieces || [];
    return ps.length > 1 ? `${base} · pièce ${ps.indexOf(p) + 1}` : base;
  }

  function editPiece(p) {
    if (!p || !p.src || !window.Editor) return;
    Editor.open(p, { title: pieceName(p), onApply: applyPieceEdit });
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
    p.thumb = thumbOf(p.canvas, 120, true);
    refreshPieces();
    renderProposals();
    render();
  }

  function act(name) {
    const comp = state.comp, L = state.selected;
    if (!comp || !L) return;
    if (name === 'edit') { editPiece(L.piece); return; }
    const i = comp.items.indexOf(L);
    if (name === 'front') { comp.items.splice(i, 1); comp.items.push(L); }
    if (name === 'back') { comp.items.splice(i, 1); comp.items.unshift(L); }
    if (name === 'flip') L.flip = !L.flip;
    if (name === 'dup') {
      const c = Object.assign({}, L, { x: L.x + L.w * 0.15, y: L.y + L.h * 0.15, rot: L.rot + 0.1 });
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
    document.querySelectorAll('#toolbar button').forEach((b) => (b.disabled = !state.selected));
  }

  document.querySelectorAll('#toolbar button').forEach((b) => (b.onclick = () => act(b.dataset.act)));

  window.addEventListener('keydown', (e) => {
    if (window.Editor && Editor.isOpen()) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') act('del');
    if (e.key === 'Escape') {
      if (document.body.classList.contains('stage-full')) $('zoom-full').click();
      state.selected = null;
      render();
    }
  });

  window.addEventListener('resize', render);

  // ---------- Export ----------

  function exportSize() {
    const comp = state.comp;
    const v = $('dpi').value;
    if (v === 'screen') {
      const k = 2400 / Math.max(comp.W, comp.H);
      return { w: Math.round(comp.W * k), h: Math.round(comp.H * k) };
    }
    const dpi = Number(v);
    return { w: Math.round((comp.W / 2.54) * dpi), h: Math.round((comp.H / 2.54) * dpi) };
  }

  function updateExportInfo() {
    if (!state.comp) return;
    const { w, h } = exportSize();
    $('export-info').textContent = `${w} × ${h} px pour une toile de ${fmt(state.comp.W)} × ${fmt(state.comp.H)} cm`;
  }

  // Page publiée : le téléchargement passe par la demande d'enregistrement du visualiseur ;
  // en local, par un lien de téléchargement classique.
  async function saveFile(blob, filename) {
    const downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
      } catch (err) {
        if (err && err.code === 'too_large') notice('Fichier trop lourd pour cet appareil : choisissez une qualité plus faible.');
        else if (!err || err.code !== 'declined') notice('Enregistrement impossible ici. Réessayez dans un instant.');
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // Guide de création : planches de découpe à taille réelle et ordre de collage.
  async function exportGuide() {
    if (!state.comp) return;
    if (!window.Guide || !window.jspdf) { notice('Le module de création du guide n’a pas pu se charger. Rechargez la page.'); return; }
    const btn = $('guide');
    const label = btn.querySelector('span');
    btn.disabled = true;
    state.selected = null;
    render();
    try {
      const st = STYLES.find((x) => x.id === state.comp.style) || STYLES[0];
      const res = await Guide.build(state.comp, {
        drawings: state.drawings,
        numberOf: (d) => state.drawings.indexOf(d) + 1,
        nameOf: (d) => {
          const n = state.drawings.indexOf(d) + 1;
          return d.ai && d.ai.sujet ? d.ai.sujet.charAt(0).toUpperCase() + d.ai.sujet.slice(1) : `Dessin ${n}`;
        },
        title: titleFor(st.id),
        styleName: st.name,
        onProgress: (t) => { label.textContent = t; },
      });
      label.textContent = 'Enregistrement…';
      await saveFile(res.blob, 'guide-de-creation-atelier-gribouille.pdf');
      $('guide-info').textContent = `${res.pages} pages : ${res.steps} étapes de collage, ${res.sheets} fiches de découpe sur les originaux.`;
    } catch (e) {
      console.error(e);
      notice('Le guide n’a pas pu être créé sur cet appareil. Réessayez sur un ordinateur.');
    } finally {
      btn.disabled = false;
      label.textContent = 'Créer le guide de création';
    }
  }

  async function exportImage() {
    if (!state.comp) return;
    const btn = $('export');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Préparation…';
    await tick();
    try {
      const { w } = exportSize();
      const s = w / state.comp.W;
      const c = Extract.makeCanvas(state.comp.W * s, state.comp.H * s);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      const shadows = $('shadows').checked;
      Compose.renderBg(x, state.comp, s, shadows);
      Compose.renderItems(x, state.comp, s, shadows);
      Compose.renderFinish(x, state.comp, s);
      const type = $('fmt').value;
      const blob = await new Promise((r) => c.toBlob(r, type, 0.92));
      if (!blob) throw new Error('toBlob');
      await saveFile(blob, `oeuvre-atelier-gribouille.${type === 'image/png' ? 'png' : 'jpg'}`);
    } catch (e) {
      console.error(e);
      notice('Export impossible à cette taille sur cet appareil. Choisissez une qualité plus faible.');
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Télécharger l’œuvre';
    }
  }

  // ---------- Branchements ----------

  const drop = $('drop');
  $('file').addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length) importFiles(files);
  });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length) importFiles(files);
  });
  // on accepte aussi un dépôt n'importe où sur la page
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    if (drop.contains(e.target)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) importFiles(files);
  });

  $('generate').onclick = () => { state.seed = (Math.random() * 1e9) | 0; regenerate(); };
  ['format', 'density', 'rotation', 'grain'].forEach((id) => $(id).addEventListener('change', regenerate));
  $('shadows').addEventListener('change', render);
  $('dpi').addEventListener('change', updateExportInfo);
  $('export').onclick = exportImage;
  $('guide').onclick = exportGuide;

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

  async function artDirect() {
    const sample = window.claude && window.claude.use ? await window.claude.use('sample') : null;
    if (!sample) { aiStatus('Composition automatique avec les règles intégrées.'); return; }
    const limits = await sample.limits().catch(() => null);
    if (!limits || !limits.images) { aiStatus('Composition automatique avec les règles intégrées.'); return; }
    const all = state.drawings;
    const nSheets = Math.min(limits.images.maxCount, Math.ceil(all.length / 20));
    const per = Math.ceil(all.length / nSheets);
    const sheets = [];
    for (let i = 0; i < all.length; i += per) sheets.push(await contactSheet(all.slice(i, i + per), i));
    aiStatus(`Claude regarde les ${all.length} dessins et imagine la composition…`);
    const prompt = `Tu es le directeur artistique d'un collage : une toile faite UNIQUEMENT de dessins d'enfants, tous utilisés, collés à la même échelle (comme une grande œuvre de famille accrochée au salon).
Voici ${all.length} dessins numérotés de 1 à ${all.length} (planches contact, le numéro est en haut à gauche de chaque dessin).
La toile est un paysage : « ciel » en haut, « milieu », « sol » en bas.

Pour CHAQUE dessin, décide :
- "sujet" : ce qu'il représente, en 1 à 4 mots en français (ex. « bougie », « chapiteau de cirque », « montagnes »).
- "role" : "fond" si c'est une page entièrement peinte ou colorée qui servira de grand papier de fond (on la verra en entier, déchirée sur les bords) ; "decoupe" si c'est un sujet dessiné sur du papier qu'on découpera aux ciseaux autour du dessin.
- "zone" : "ciel", "milieu" ou "sol", là où il a le plus de sens dans la scène (soleil, nuages, oiseaux, cœurs volants → ciel ; terre, herbe, racines, maisons, chapiteau, animaux au sol → sol ; le reste → milieu). Répartis les fonds pour que chaque zone en ait.
- "pose" : true si le sujet repose naturellement sur le sol (maison, arbre, personnage debout, bougie), false s'il flotte.
- "importance" : 3 pour les 3 ou 4 pièces maîtresses les plus fortes visuellement, 2 pour les belles pièces, 1 sinon.

L'œuvre sera proposée dans trois styles : « paysage » (ciel, milieu, sol), « tournesol » (tout tourne en spirale autour d'un cœur) et « cabinet » (un cabinet de curiosités : chaque dessin exposé droit, en rangées).
Propose pour chacun un titre poétique et court (2 à 6 mots, en français), inspiré des dessins.

Réponds uniquement avec ce JSON :
{"titres": {"paysage": "...", "tournesol": "...", "cabinet": "..."}, "dessins": [{"n": 1, "sujet": "...", "role": "fond", "zone": "sol", "pose": false, "importance": 2}, ...]}`;
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
          importance: [1, 2, 3].includes(Number(it.importance)) ? Number(it.importance) : 1,
        };
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
      aiStatus(`Direction artistique : Claude a reconnu ${n} dessins sur ${all.length} et placé chacun dans la scène.`);
      refreshLists();
      regenerate();
    } catch (e) {
      const why = { not_granted: 'autorisation refusée', rate_limited: 'trop de demandes, réessayez plus tard', refused: 'demande refusée' }[e && e.code];
      aiStatus(`Composition automatique avec les règles intégrées${why ? ` (Claude : ${why})` : ''}.`);
    }
  }

  // Tout effacer pour repartir de ses propres scans
  $('clear').onclick = () => {
    state.drawings = [];
    state.title = '';
    state.titles = null;
    state.proposals = null;
    $('proposals').innerHTML = '';
    aiStatus('');
    state.current = null;
    state.comp = null;
    state.selected = null;
    state.bgCache = null;
    ['drawings-section', 'compose-section', 'export-section', 'sample-note', 'label'].forEach((id) => ($(id).hidden = true));
    $('empty').hidden = false;
    refreshLists();
    render();
  };

  // Dessins d'exemple fournis avec la page (version publiée) : chargés à l'ouverture.
  async function loadSamples(m) {
    try {
      setProgress(0, 1, 'Chargement des dessins d’exemple…');
      const files = await Promise.all(m.pages.map(async (p) => {
        const r = await fetch(m.base + p.file);
        if (!r.ok) throw new Error(p.file);
        return new File([await r.blob()], p.name, { type: 'image/jpeg' });
      }));
      const sizes = {};
      m.pages.forEach((p) => { if (p.sizeCm) sizes[p.name] = p.sizeCm; });
      await importFiles(files, sizes);
      $('sample-note').hidden = false;
    } catch (e) {
      console.error(e);
      setProgress(1, 1);
      notice('Les dessins d’exemple n’ont pas pu être chargés. Importez vos scans ci-dessus.');
    }
  }

  // accès pour le débogage depuis la console
  window.AtelierGribouille = { state };
  if (window.COLLAGE_SAMPLES) loadSamples(window.COLLAGE_SAMPLES);

  render();
})();
