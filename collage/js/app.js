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
    seq: 0,
  };

  // Formats de feuille (plus grand côté, en cm)
  const SHEETS = [['A5', 21], ['A4', 29.7], ['A3', 42], ['A2', 59.4]];
  // Tailles de page PDF correspondant à un vrai format physique (plus grand côté, en points)
  const PHYSICAL_PT = [595.3, 841.9, 1190.6, 1683.8, 792, 1008];

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
            const physical = PHYSICAL_PT.some((pt) => Math.abs(long / pt - 1) < 0.02);
            return { canvas: c, origLong: long, physCm: physical ? (long / 72) * 2.54 : null };
          },
        });
      }
    } else if (file.type.startsWith('image/')) {
      pages.push({
        name: file.name,
        render: async () => {
          const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
          const c = Extract.scaleTo(bmp, SOURCE_MAX);
          const origLong = Math.max(bmp.width, bmp.height);
          bmp.close && bmp.close();
          return { canvas: c, origLong, physCm: null };
        },
      });
    }
    return pages;
  }

  function thumbOf(canvas, max) {
    return Extract.scaleTo(canvas, max || 160).toDataURL('image/jpeg', 0.8);
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
          srcLong: Math.max(src.canvas.width, src.canvas.height), origLong: src.origLong, physCm: src.physCm,
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
      if (d.sizeMode !== 'auto') return;
      if (d.physCm) { d.sizeCm = d.physCm; return; }
      const est = (d.origLong / median) * 29.7;
      const snap = SHEETS.find(([, cm]) => Math.abs(est / cm - 1) < 0.18);
      d.sizeCm = snap ? snap[1] : Math.round(est);
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
    if (d.ai) return d.ai.role === 'fond' ? 'texture' : 'cutout';
    // Un dessin au crayon gris (souvent avec du texte) se découpe mal : on le colle en page entière.
    if (d.analysis.kind === 'cutout' && pale(d)) return 'texture';
    return d.analysis.kind;
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
      p.thumb = thumbOf(p.canvas, 120);
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
    const dEl = $('drawings');
    dEl.innerHTML = '';
    state.drawings.forEach((d) => {
      const role = roleOf(d);
      const el = document.createElement('div');
      el.className = `thumb ${role}${state.current === d ? ' current' : ''}`;
      el.title = d.ai ? `${d.ai.sujet} — ${d.name}` : d.name;
      el.innerHTML = `<img src="${d.thumb}" alt=""><b class="tag ${role}">${ROLE_LABEL[role]}</b><i class="size">${sheetName(d.sizeCm)}</i>`;
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
          Sur l’œuvre : ${fmt(aw)} × ${fmt(ah)} cm${mainPiece(d) ? ` (sujet principal : ${fmt(subjectCm(d))} cm en vrai, ${fmt(subjectCm(d) * k)} cm sur l’œuvre)` : ''}.</p>
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
      el.innerHTML = `<img src="${p.thumb}" alt="">`;
      el.onclick = () => togglePiece(p);
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

  function formatCm() {
    const [w, h] = $('format').value.split('x').map(Number);
    return { w, h };
  }

  // Échelle automatique : comme dans l'œuvre de référence, environ cinq feuilles
  // de fond côte à côte sur la largeur de la toile.
  // Échelle automatique : la même pour tous, choisie pour que TOUS les sujets tiennent sur la toile
  // (ils en couvrent environ 60 %, les pages de fond et les lambeaux font le reste).
  function autoScale() {
    let area = 0;
    activePieces().filter((p) => p.enabled).forEach((p) => {
      const c = cmPerPx(p.drawing);
      let fill = 0;
      for (let i = 0; i < p.hit.data.length; i++) fill += p.hit.data[i];
      area += p.canvas.width * c * p.canvas.height * c * (fill / p.hit.data.length);
    });
    if (!area) return 0.6;
    const f = formatCm();
    const k = Math.sqrt((0.55 * Number($('density').value) * f.w * f.h) / area);
    return Math.max(0.15, Math.min(1, k));
  }

  function scale() {
    return $('scale-auto').checked ? autoScale() : Number($('scale').value) / 100;
  }

  function updateScaleLabel() {
    const k = scale();
    if ($('scale-auto').checked) $('scale').value = Math.round(k * 100);
    $('scale').disabled = $('scale-auto').checked;
    $('scale-info').textContent = `${Math.round(k * 100)} % — une feuille A4 mesure ${fmt(29.7 * k)} × ${fmt(21 * k)} cm sur l’œuvre. Tous les dessins sont réduits de la même façon${$('scale-auto').checked ? ', juste assez pour qu’ils tiennent tous' : ''}.`;
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
    $('label-meta').textContent = `${st.name} · collage de ${state.drawings.filter((d) => roleOf(d) !== 'off').length} dessins d’enfants · ${fmt(state.comp.W)} × ${fmt(state.comp.H)} cm · échelle ${Math.round((state.comp.scale || scale()) * 100)} %`;
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
    const pad = 36 * dpr;
    const s = Math.min((cw - 2 * pad) / comp.W, (ch - 2 * pad) / comp.H);
    const ox = (cw - comp.W * s) / 2, oy = (ch - comp.H * s) / 2;
    view = { s, ox, oy, dpr };
    const shadows = $('shadows').checked;

    // fond mis en cache : il ne change pas pendant qu'on déplace les découpes
    if (!state.bgCache || state.bgCache.s !== s || state.bgCache.shadows !== shadows) {
      const c = Extract.makeCanvas(comp.W * s, comp.H * s);
      Compose.renderBg(c.getContext('2d'), comp, s, shadows);
      state.bgCache = { canvas: c, s, shadows };
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
    ctx.drawImage(state.bgCache.canvas, ox, oy);
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

  canvas.addEventListener('pointerdown', (e) => {
    if (!state.comp) return;
    const p = toComp(e);
    const L = state.selected;
    if (L) {
      const h = handlePos(L);
      if (Math.hypot(h.x - p.X, h.y - p.Y) * view.s < 16 * view.dpr) {
        // la poignée tourne la pièce, sans changer sa taille : l'échelle reste juste
        drag = { mode: 'rotate', L, a0: Math.atan2(p.Y - L.y, p.X - L.x), r0: L.rot };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    const items = state.comp.items;
    let hit = null;
    for (let i = items.length - 1; i >= 0; i--) {
      if (Compose.hitItem(items[i], p.X, p.Y)) { hit = items[i]; break; }
    }
    state.selected = hit;
    if (hit) {
      drag = { mode: 'move', L: hit, dx: p.X - hit.x, dy: p.Y - hit.y };
      canvas.setPointerCapture(e.pointerId);
    }
    render();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
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

  const endDrag = () => { if (drag) refreshActiveThumb(); drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    const L = state.selected;
    if (!L) return;
    e.preventDefault();
    L.rot += e.deltaY * 0.002;
    render();
  }, { passive: false });

  function act(name) {
    const comp = state.comp, L = state.selected;
    if (!comp || !L) return;
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
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') act('del');
    if (e.key === 'Escape') { state.selected = null; render(); }
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
      const filename = `oeuvre-collage.${type === 'image/png' ? 'png' : 'jpg'}`;
      // Page publiée : le téléchargement passe par la demande d'enregistrement du visualiseur.
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
  ['format', 'density', 'rotation', 'scale', 'scale-auto', 'grain'].forEach((id) => $(id).addEventListener('change', regenerate));
  $('scale').addEventListener('input', updateScaleLabel);
  $('shadows').addEventListener('change', render);
  $('dpi').addEventListener('change', updateExportInfo);
  $('export').onclick = exportImage;

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
