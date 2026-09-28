/* Interface : import des scans, gestion des dessins, édition interactive et export. */
(function () {
  'use strict';

  const SOURCE_MAX = 1400; // résolution conservée pour chaque page scannée (plus grand côté)
  const $ = (id) => document.getElementById(id);

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const state = {
    drawings: [],   // { id, name, thumb, analysis, role }
    comp: null,
    seed: 1,
    selected: null,
    bgCache: null,
    seq: 0,
  };

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
            const vp = page.getViewport({ scale: SOURCE_MAX / Math.max(vp0.width, vp0.height) });
            const c = Extract.makeCanvas(vp.width, vp.height);
            await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            return c;
          },
        });
      }
    } else if (file.type.startsWith('image/')) {
      pages.push({
        name: file.name,
        render: async () => {
          const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
          const c = Extract.scaleTo(bmp, SOURCE_MAX);
          bmp.close && bmp.close();
          return c;
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
        const analysis = Extract.analyze(src);
        preparePieces(analysis.pieces);
        state.drawings.push({ id: ++state.seq, name: pages[i].name, thumb: thumbOf(analysis.page), analysis, role: 'auto' });
      } catch (e) {
        console.error(e);
      }
    }
    setProgress(1, 1);
    curate();
    if (state.drawings.length) {
      ['drawings-section', 'compose-section', 'export-section'].forEach((id) => ($(id).hidden = false));
      $('empty').hidden = true;
    }
    refreshLists();
    regenerate();
  }

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
      preparePieces(a.pieces);
    }
    if (role === 'texture' && !a.texture) a.texture = Extract.textureFrom(a.page);
  }

  function preparePieces(pieces) {
    (pieces || []).forEach((p) => {
      p.id = ++state.seq;
      p.enabled = true;
      p.thumb = thumbOf(p.canvas, 120);
    });
  }

  // Sélection automatique : les sujets les plus grands et les plus colorés d'abord,
  // au plus 3 par dessin et une quarantaine au total, pour une œuvre lisible.
  const MAX_PIECES = 40;
  function curate() {
    const ranked = [];
    state.drawings.forEach((d) => {
      (d.analysis.pieces || [])
        .slice()
        .sort((a, b) => rank(b) - rank(a))
        .forEach((p, i) => { p.enabled = false; if (i < 3 && p.frac > 0.02) ranked.push(p); });
    });
    ranked.sort((a, b) => rank(b) - rank(a)).slice(0, MAX_PIECES).forEach((p) => (p.enabled = true));
  }

  function rank(p) {
    return Math.sqrt(p.frac) * (0.4 + p.colorful);
  }

  function activePieces() {
    return state.drawings.filter((d) => roleOf(d) === 'cutout').flatMap((d) => d.analysis.pieces || []);
  }

  function textures() {
    return state.drawings.filter((d) => roleOf(d) === 'texture').map((d) => d.analysis.texture);
  }

  function refreshLists() {
    const dEl = $('drawings');
    dEl.innerHTML = '';
    state.drawings.forEach((d) => {
      const role = roleOf(d);
      const el = document.createElement('div');
      el.className = `thumb ${role}`;
      el.title = `${d.name}\nClic : changer le rôle`;
      el.innerHTML = `<img src="${d.thumb}" alt=""><b class="tag ${role}">${ROLE_LABEL[role]}</b>`;
      el.onclick = () => {
        d.role = ROLES[(ROLES.indexOf(role) + 1) % ROLES.length];
        ensureMaterial(d);
        refreshLists();
        regenerate();
      };
      dEl.appendChild(el);
    });
    $('drawings-count').textContent = `(${state.drawings.length})`;

    const pEl = $('pieces');
    pEl.innerHTML = '';
    const pieces = activePieces();
    pieces.forEach((p) => {
      const el = document.createElement('div');
      el.className = `thumb${p.enabled ? '' : ' off'}`;
      el.innerHTML = `<img src="${p.thumb}" alt="">`;
      el.onclick = () => togglePiece(p, el);
      pEl.appendChild(el);
    });
    $('pieces-count').textContent = `(${pieces.filter((p) => p.enabled).length} / ${pieces.length})`;
  }

  function togglePiece(p, el) {
    p.enabled = !p.enabled;
    el.classList.toggle('off', !p.enabled);
    if (!state.comp) return;
    if (p.enabled) {
      state.selected = Compose.addPiece(state.comp, p, ++state.seq);
    } else {
      state.comp.items = state.comp.items.filter((L) => L.piece !== p);
      if (state.selected && state.selected.piece === p) state.selected = null;
    }
    const all = activePieces();
    $('pieces-count').textContent = `(${all.filter((q) => q.enabled).length} / ${all.length})`;
    render();
  }

  // ---------- Composition ----------

  function options() {
    const [w, h] = $('format').value.split('x').map(Number);
    return {
      format: { w, h },
      bgMode: $('bg-mode').value,
      density: Number($('density').value),
      rotation: Number($('rotation').value),
      seed: state.seed,
      textures: textures(),
      pieces: activePieces().filter((p) => p.enabled),
    };
  }

  function regenerate() {
    if (!state.drawings.length) return;
    state.comp = Compose.generate(options());
    state.selected = null;
    state.bgCache = null;
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
    return { X: (px - view.ox) / view.s, Y: (py - view.oy) / view.s, px, py };
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
        drag = { mode: 'transform', L, d0: Math.hypot(p.X - L.x, p.Y - L.y), a0: Math.atan2(p.Y - L.y, p.X - L.x), w0: L.w, h0: L.h, r0: L.rot };
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
      const f = Math.max(0.1, Math.hypot(p.X - L.x, p.Y - L.y) / Math.max(1, drag.d0));
      L.w = drag.w0 * f;
      L.h = drag.h0 * f;
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
    if (e.shiftKey) {
      L.rot += e.deltaY * 0.002;
    } else {
      const f = Math.pow(1.0015, -e.deltaY);
      L.w *= f;
      L.h *= f;
    }
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
    if (name === 'del') { comp.items.splice(i, 1); state.selected = null; }
    render();
  }

  function updateToolbar() {
    document.querySelectorAll('#toolbar button').forEach((b) => (b.disabled = !state.selected));
  }

  document.querySelectorAll('#toolbar button').forEach((b) => (b.onclick = () => act(b.dataset.act)));

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') act('del');
    if (e.key === 'Escape') { state.selected = null; render(); }
  });

  window.addEventListener('resize', render);

  // ---------- Export ----------

  function exportSize() {
    const comp = state.comp;
    const [wcm, hcm] = $('format').value.split('x').map(Number);
    const v = $('dpi').value;
    if (v === 'screen') {
      const k = 2400 / Math.max(comp.W, comp.H);
      return { w: Math.round(comp.W * k), h: Math.round(comp.H * k) };
    }
    const dpi = Number(v);
    return { w: Math.round((wcm / 2.54) * dpi), h: Math.round((hcm / 2.54) * dpi) };
  }

  function updateExportInfo() {
    if (!state.comp) return;
    const { w, h } = exportSize();
    $('export-info').textContent = `${w} × ${h} px`;
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
  ['format', 'bg-mode', 'density', 'rotation'].forEach((id) => $(id).addEventListener('change', regenerate));
  $('shadows').addEventListener('change', render);
  $('dpi').addEventListener('change', updateExportInfo);
  $('export').onclick = exportImage;

  render();
})();
