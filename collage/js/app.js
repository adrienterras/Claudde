/* Interface : import des scans, gestion des dessins, édition interactive et export. */
(function () {
  'use strict';

  const SOURCE_MAX = 1400; // résolution conservée pour chaque page scannée (plus grand côté)
  const $ = (id) => document.getElementById(id);

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

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

  async function importFiles(files) {
    let pages = [];
    setProgress(0, 1, 'Lecture des fichiers…');
    for (const f of files) {
      try {
        pages = pages.concat(await pagesFromFile(f));
      } catch (e) {
        console.error(e);
        alert(`Impossible de lire « ${f.name} ».`);
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
        state.drawings.push(d);
      } catch (e) {
        console.error(e);
      }
    }
    setProgress(1, 1);
    estimateSizes();
    curate();
    if (state.drawings.length) {
      ['drawings-section', 'compose-section', 'export-section'].forEach((id) => ($(id).hidden = false));
      $('empty').hidden = true;
    }
    refreshLists();
    regenerate();
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

  function roleOf(d) {
    return d.role === 'auto' ? d.analysis.kind : d.role;
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

  // Présélection : les sujets les plus grands et les plus colorés, au plus 3 par dessin.
  // La composition place ensuite ce qui tient à l'échelle choisie.
  const MAX_PIECES = 45;
  function curate() {
    const ranked = [];
    state.drawings.forEach((d) => {
      (d.analysis.pieces || [])
        .slice()
        .sort((a, b) => rank(b) - rank(a))
        .forEach((p, i) => { p.enabled = false; if (i < 3 && eligible(p)) ranked.push(p); });
    });
    ranked.sort((a, b) => rank(b) - rank(a)).slice(0, MAX_PIECES).forEach((p) => (p.enabled = true));
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
      el.title = d.name;
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
        <p class="name">${d.name}</p>
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
  function autoScale() {
    const tex = state.drawings.filter((d) => roleOf(d) === 'texture');
    const pool = (tex.length ? tex : state.drawings).map((d) => d.sizeCm).sort((a, b) => a - b);
    if (!pool.length) return 0.6;
    const median = pool[Math.floor(pool.length / 2)];
    return Math.max(0.2, Math.min(1, formatCm().w / 5 / median));
  }

  function scale() {
    return $('scale-auto').checked ? autoScale() : Number($('scale').value) / 100;
  }

  function updateScaleLabel() {
    const k = scale();
    if ($('scale-auto').checked) $('scale').value = Math.round(k * 100);
    $('scale').disabled = $('scale-auto').checked;
    $('scale-info').textContent = `${Math.round(k * 100)} % — une feuille A4 mesure ${fmt(29.7 * k)} × ${fmt(21 * k)} cm sur l’œuvre. Tous les dessins sont réduits de la même façon.`;
  }

  function sizePiece(p, k) {
    const c = cmPerPx(p.drawing) * k;
    p.wcm = p.canvas.width * c;
    p.hcm = p.canvas.height * c;
  }

  // ---------- Composition ----------

  function options() {
    const k = scale();
    const pieces = activePieces().filter((p) => p.enabled);
    pieces.forEach((p) => sizePiece(p, k));
    const textures = state.drawings
      .filter((d) => roleOf(d) === 'texture')
      .map((d) => {
        const t = d.analysis.texture;
        const c = cmPerPx(d) * k;
        return Object.assign({}, t, { wcm: t.canvas.width * c, hcm: t.canvas.height * c });
      });
    return {
      format: formatCm(),
      scale: k,
      bgMode: $('bg-mode').value,
      density: Number($('density').value),
      rotation: Number($('rotation').value),
      grain: $('grain').checked,
      seed: state.seed,
      textures,
      pieces,
    };
  }

  function regenerate() {
    if (!state.drawings.length) return;
    updateScaleLabel();
    activePieces().forEach((p) => (p.placed = false));
    state.comp = Compose.generate(options());
    state.selected = null;
    state.bgCache = null;
    refreshPieces();
    renderDetail();
    render();
    updateExportInfo();
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
      ctx.strokeStyle = '#e4572e';
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeRect((-L.w / 2) * s, (-L.h / 2) * s, L.w * s, L.h * s);
      ctx.setLineDash([]);
      ctx.fillStyle = '#e4572e';
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

  const endDrag = () => { drag = null; };
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
    btn.textContent = 'Préparation…';
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
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `oeuvre-collage.${type === 'image/png' ? 'png' : 'jpg'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
      console.error(e);
      alert('Export impossible à cette taille sur cet appareil. Essayez une qualité plus faible.');
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ Télécharger l’œuvre';
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
  ['format', 'bg-mode', 'density', 'rotation', 'scale', 'scale-auto', 'grain'].forEach((id) => $(id).addEventListener('change', regenerate));
  $('scale').addEventListener('input', updateScaleLabel);
  $('shadows').addEventListener('change', render);
  $('dpi').addEventListener('change', updateExportInfo);
  $('export').onclick = exportImage;

  // accès pour le débogage depuis la console
  window.AtelierCollage = { state };

  render();
})();
