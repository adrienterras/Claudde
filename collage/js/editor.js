/*
 * Éditeur de découpe : zoom sur le dessin, gomme pour retirer, pinceau « restaurer » pour
 * remettre du dessin d'origine (y compris au-delà de la découpe initiale), défaire / refaire.
 * Le masque de découpe est édité en pixels de la page ; à la validation, la pièce est recalculée.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const HISTORY = 20;
  let S = null; // état de l'éditeur ouvert

  function alphaOf(canvas) {
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    const a = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return a;
  }

  function putAlpha(canvas, a) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < a.length; i++) {
      const j = i * 4;
      img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
      img.data[j + 3] = a[i];
    }
    ctx.putImageData(img, 0, 0);
  }

  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  /*
   * piece : la pièce à retoucher ; opts : { title, onApply(piece, oldSrc, newSrc) }
   */
  function open(piece, opts) {
    const d = piece.drawing;
    const page = d.analysis.page;
    const src = piece.src;
    if (!src) return;
    // zone de travail : la découpe plus une marge, pour pouvoir restaurer autour
    const m = Math.round(Math.max(src.w, src.h) * 0.3) + 24;
    const x0 = Math.max(0, Math.floor(src.x - m)), y0 = Math.max(0, Math.floor(src.y - m));
    const x1 = Math.min(page.width, Math.ceil(src.x + src.w + m)), y1 = Math.min(page.height, Math.ceil(src.y + src.h + m));
    const R = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const crop = Extract.makeCanvas(R.w, R.h);
    crop.getContext('2d').drawImage(page, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
    const img = Extract.enhance(crop, src.paper);
    const mask = Extract.makeCanvas(R.w, R.h);
    mask.getContext('2d', { willReadFrequently: true }).drawImage(piece.canvas, src.x - R.x, src.y - R.y, src.w, src.h);

    S = {
      piece, opts, R, img, mask,
      initial: alphaOf(mask),
      cut: Extract.makeCanvas(R.w, R.h),
      sil: Extract.makeCanvas(R.w, R.h),
      tool: 'erase', size: Number($('ed-size').value) || 28,
      z: 1, ox: 0, oy: 0,
      undo: [], redo: [],
      dirty: true, raf: 0,
      pointers: new Map(), stroke: null, pinch: null, space: false, cursor: null,
    };
    $('ed-title').textContent = opts.title || 'Découpe';
    $('ed-msg').textContent = '';
    $('editor').hidden = false;
    document.body.classList.add('editing');
    setTool('erase');
    requestAnimationFrame(() => { fit(); history(); });
  }

  function close() {
    if (!S) return;
    cancelAnimationFrame(S.raf);
    S = null;
    $('editor').hidden = true;
    document.body.classList.remove('editing');
  }

  // ---------- Vue ----------

  function canvasSize() {
    const c = $('ed-canvas');
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth * dpr, h = c.clientHeight * dpr;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { c, dpr, w, h };
  }

  function fit() {
    if (!S) return;
    const { w, h } = canvasSize();
    S.z = Math.min(w / S.R.w, h / S.R.h) * 0.92;
    S.ox = (w - S.R.w * S.z) / 2;
    S.oy = (h - S.R.h * S.z) / 2;
    render();
  }

  function zoomAt(f, px, py) {
    const nz = Math.max(0.05, Math.min(24, S.z * f));
    S.ox = px - ((px - S.ox) / S.z) * nz;
    S.oy = py - ((py - S.oy) / S.z) * nz;
    S.z = nz;
    render();
  }

  function render() {
    if (!S || S.raf) return;
    S.raf = requestAnimationFrame(draw);
  }

  function rebuild() {
    const { cut, sil, img, mask } = S;
    const c = cut.getContext('2d');
    c.globalCompositeOperation = 'copy';
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(mask, 0, 0);
    c.globalCompositeOperation = 'source-over';
    const s = sil.getContext('2d');
    s.globalCompositeOperation = 'copy';
    s.drawImage(mask, 0, 0);
    s.globalCompositeOperation = 'source-in';
    s.fillStyle = '#e5007d';
    s.fillRect(0, 0, sil.width, sil.height);
    s.globalCompositeOperation = 'source-over';
    S.dirty = false;
  }

  function draw() {
    if (!S) return;
    S.raf = 0;
    if (S.dirty) rebuild();
    const { c, dpr, w, h } = canvasSize();
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = cssVar('--wall', '#e6e4df');
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(S.ox, S.oy);
    ctx.scale(S.z, S.z);
    ctx.imageSmoothingEnabled = S.z < 3;
    // le dessin entier, estompé : ce qu'on peut restaurer
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, S.R.w, S.R.h);
    ctx.globalAlpha = 0.28;
    ctx.drawImage(S.img, 0, 0);
    ctx.globalAlpha = 1;
    // trait de coupe magenta, d'épaisseur constante à l'écran
    const r = (2.4 * dpr) / S.z;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      ctx.drawImage(S.sil, Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.drawImage(S.cut, 0, 0);
    ctx.restore();
    // aperçu du pinceau
    if (S.cursor && S.tool !== 'pan' && !S.space) {
      ctx.beginPath();
      ctx.arc(S.cursor.x, S.cursor.y, (S.size * dpr) / 2, 0, Math.PI * 2);
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = S.tool === 'erase' ? '#e5007d' : cssVar('--accent', '#2f49d1');
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    $('ed-zval').textContent = `${Math.round(S.z * 100 / (dpr || 1))} %`;
  }

  // ---------- Outils ----------

  function setTool(t) {
    if (!S) return;
    S.tool = t;
    document.querySelectorAll('#editor [data-tool]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tool === t);
      b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false');
    });
    $('ed-canvas').style.cursor = t === 'pan' ? 'grab' : 'none';
    render();
  }

  function history() {
    if (!S) return;
    $('ed-undo').disabled = !S.undo.length;
    $('ed-redo').disabled = !S.redo.length;
  }

  function pushUndo() {
    S.undo.push(alphaOf(S.mask));
    if (S.undo.length > HISTORY) S.undo.shift();
    S.redo = [];
    history();
  }

  function undo() {
    if (!S || !S.undo.length) return;
    S.redo.push(alphaOf(S.mask));
    putAlpha(S.mask, S.undo.pop());
    S.dirty = true;
    history();
    render();
  }

  function redo() {
    if (!S || !S.redo.length) return;
    S.undo.push(alphaOf(S.mask));
    putAlpha(S.mask, S.redo.pop());
    S.dirty = true;
    history();
    render();
  }

  function reset() {
    if (!S) return;
    pushUndo();
    putAlpha(S.mask, S.initial);
    S.dirty = true;
    render();
  }

  function toLocal(e) {
    const r = $('ed-canvas').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    return { px, py, x: (px - S.ox) / S.z, y: (py - S.oy) / S.z };
  }

  function paint(from, to) {
    const ctx = S.mask.getContext('2d', { willReadFrequently: true });
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.globalCompositeOperation = S.stroke.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = '#fff';
    ctx.lineWidth = (S.size * dpr) / S.z;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    ctx.restore();
    S.dirty = true;
    render();
  }

  function onDown(e) {
    if (!S) return;
    const c = $('ed-canvas');
    c.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    S.pointers.set(e.pointerId, p);
    if (S.pointers.size === 2) {
      // deux doigts : on abandonne le trait commencé et on passe en zoom / déplacement
      if (S.stroke) { undo(); S.redo.pop(); history(); S.stroke = null; }
      const [a, b] = [...S.pointers.values()];
      S.pinch = { d: Math.hypot(a.px - b.px, a.py - b.py), mx: (a.px + b.px) / 2, my: (a.py + b.py) / 2 };
      return;
    }
    const pan = S.tool === 'pan' || S.space || e.button === 1 || e.button === 2;
    if (pan) { S.drag = { px: p.px, py: p.py }; c.style.cursor = 'grabbing'; return; }
    pushUndo();
    S.stroke = { tool: S.tool, last: p };
    paint(p, p);
  }

  function onMove(e) {
    if (!S) return;
    const p = toLocal(e);
    S.cursor = { x: p.px, y: p.py };
    if (S.pointers.has(e.pointerId)) S.pointers.set(e.pointerId, p);
    if (S.pinch && S.pointers.size >= 2) {
      const [a, b] = [...S.pointers.values()];
      const d = Math.hypot(a.px - b.px, a.py - b.py), mx = (a.px + b.px) / 2, my = (a.py + b.py) / 2;
      S.ox += mx - S.pinch.mx;
      S.oy += my - S.pinch.my;
      zoomAt(d / Math.max(1, S.pinch.d), mx, my);
      S.pinch = { d, mx, my };
      return;
    }
    if (S.drag) {
      S.ox += p.px - S.drag.px;
      S.oy += p.py - S.drag.py;
      S.drag = { px: p.px, py: p.py };
      render();
      return;
    }
    if (S.stroke) {
      paint(S.stroke.last, p);
      S.stroke.last = p;
      return;
    }
    render();
  }

  function onUp(e) {
    if (!S) return;
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.pinch = null;
    S.stroke = null;
    if (S.drag) { S.drag = null; $('ed-canvas').style.cursor = S.tool === 'pan' ? 'grab' : 'none'; }
  }

  // ---------- Validation ----------

  function apply() {
    if (!S) return;
    const { R, mask, img, piece } = S;
    const a = alphaOf(mask);
    let minX = R.w, minY = R.h, maxX = -1, maxY = -1, count = 0;
    for (let y = 0; y < R.h; y++) {
      for (let x = 0; x < R.w; x++) {
        const v = a[y * R.w + x];
        if (v > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (v > 127) count++;
        }
      }
    }
    if (maxX < 0) { $('ed-msg').textContent = 'La découpe est vide : restaurez une partie du dessin avant de valider.'; return; }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const canvas = Extract.makeCanvas(bw, bh);
    const cx = canvas.getContext('2d');
    cx.drawImage(img, minX, minY, bw, bh, 0, 0, bw, bh);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(mask, minX, minY, bw, bh, 0, 0, bw, bh);
    // carte de clic à la même finesse qu'avant
    const ratio = piece.hit.w / piece.src.w;
    const hw = Math.max(4, Math.round(bw * ratio)), hh = Math.max(4, Math.round(bh * ratio));
    const hc = Extract.makeCanvas(hw, hh);
    const hctx = hc.getContext('2d', { willReadFrequently: true });
    hctx.drawImage(mask, minX, minY, bw, bh, 0, 0, hw, hh);
    const hd = hctx.getImageData(0, 0, hw, hh).data;
    const hit = new Uint8Array(hw * hh);
    for (let i = 0; i < hit.length; i++) hit[i] = hd[i * 4 + 3] > 127 ? 1 : 0;
    let before = 0;
    for (let i = 0; i < S.initial.length; i++) if (S.initial[i] > 127) before++;

    const oldSrc = Object.assign({}, piece.src);
    const newSrc = { x: R.x + minX, y: R.y + minY, w: bw, h: bh, paper: oldSrc.paper };
    piece.canvas = canvas;
    piece.hit = { w: hw, h: hh, data: hit };
    piece.src = newSrc;
    if (before) piece.frac *= count / before;
    const opts = S.opts;
    close();
    opts.onApply && opts.onApply(piece, oldSrc, newSrc);
  }

  // ---------- Branchements ----------

  function init() {
    const c = $('ed-canvas');
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('pointerleave', () => { if (S) { S.cursor = null; render(); } });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      if (!S) return;
      e.preventDefault();
      const p = toLocal(e);
      zoomAt(Math.exp(-e.deltaY * 0.0015), p.px, p.py);
    }, { passive: false });
    document.querySelectorAll('#editor [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    $('ed-size').addEventListener('input', (e) => { if (S) { S.size = Number(e.target.value); render(); } });
    const center = (f) => { const { w, h } = canvasSize(); zoomAt(f, w / 2, h / 2); };
    $('ed-zin').onclick = () => center(1.3);
    $('ed-zout').onclick = () => center(1 / 1.3);
    $('ed-fit').onclick = fit;
    $('ed-undo').onclick = undo;
    $('ed-redo').onclick = redo;
    $('ed-reset').onclick = reset;
    $('ed-cancel').onclick = close;
    $('ed-apply').onclick = apply;
    window.addEventListener('resize', () => S && render());
    window.addEventListener('keydown', (e) => {
      if (!S) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter') { e.preventDefault(); apply(); }
      else if (e.key === ' ') { e.preventDefault(); S.space = true; $('ed-canvas').style.cursor = 'grab'; render(); }
      else if (e.key === 'e' || e.key === 'E') setTool('erase');
      else if (e.key === 'r' || e.key === 'R') setTool('restore');
      else if (e.key === 'h' || e.key === 'H') setTool('pan');
      else if (e.key === '[' || e.key === ']') {
        const s = $('ed-size');
        s.value = Math.max(Number(s.min), Math.min(Number(s.max), Number(s.value) + (e.key === ']' ? 6 : -6)));
        S.size = Number(s.value);
        render();
      }
      e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => {
      if (S && e.key === ' ') { S.space = false; $('ed-canvas').style.cursor = S.tool === 'pan' ? 'grab' : 'none'; render(); }
    });
  }

  init();
  window.Editor = { open, isOpen: () => !!S };
})();
