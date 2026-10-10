/*
 * Éditeur de découpe : zoom sur le dessin, gomme pour retirer, pinceau « restaurer » pour
 * remettre du dessin d'origine (y compris au-delà de la découpe initiale), défaire / refaire.
 * Le masque de découpe est édité en pixels de la page ; à la validation, la pièce est recalculée.
 * Lumière et couleurs (luminosité, contraste, saturation) se règlent aussi ici, avec un aperçu
 * direct ; elles valent pour tout le dessin et ne sont appliquées qu'à la validation.
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
   * piece : la pièce à retoucher ; opts : { title, onApply(piece, oldSrc, newSrc),
   *   tone (réglage actuel du dessin), autoTone() → réglage proposé, onTone(tone),
   *   autoPiece() → la pièce telle que l'atelier la découpe d'office (pour « Découpe automatique ») }
   */
  function open(piece, opts) {
    const d = piece.drawing;
    const page = d.analysis.page;
    const src = piece.src;
    if (!src) return;
    // zone de travail : le dessin complet (toute la page scannée), pour pouvoir restaurer n'importe où
    const R = { x: 0, y: 0, w: page.width, h: page.height };
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
      tone0: toneOf(opts.tone), tone: toneOf(opts.tone), timg: null,
      sel: null, selSeeds: [], selAdd: false, selFill: null, selHalo: null,
    };
    syncSel();
    showTone(false);
    syncTone('');
    $('ed-title').textContent = opts.title || tr('Découpe');
    $('ed-msg').textContent = '';
    $('editor').hidden = false;
    document.body.classList.add('editing');
    setTool('erase');
    requestAnimationFrame(() => { fit(); history(); });
    if (window.matchMedia('(max-width: 860px), (pointer: coarse)').matches) tip(tr('Pincez pour zoomer · glissez à deux doigts pour vous déplacer'));
  }

  // ---------- Lumière et couleurs ----------

  const toneOf = (t) => ({ b: (t && t.b) || 0, c: (t && t.c) || 0, s: (t && t.s) || 0 });
  const toneKey = (t) => `${t.b}:${t.c}:${t.s}`;
  const toneText = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
  function showTone(on) {
    $('ed-tone').hidden = !on;
    $('ed-tone-toggle').classList.toggle('on', on);
    $('ed-tone-toggle').setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function syncTone(msg) {
    const t = S.tone;
    document.querySelectorAll('#ed-tone [data-ed-tone]').forEach((r) => { r.value = t[r.dataset.edTone]; r.nextElementSibling.textContent = toneText(t[r.dataset.edTone]); });
    $('ed-tone-reset').hidden = !(t.b || t.c || t.s);
    $('ed-tone-msg').textContent = msg || '';
    $('ed-tone-msg').hidden = !msg;
  }
  function setTone(t, msg) {
    if (!S) return;
    S.tone = toneOf(t);
    S.timg = null; // recalculée au prochain dessin
    S.dirty = true;
    syncTone(msg);
    render();
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
    if (!S.timg) S.timg = window.Compose ? Compose.toned(S.img, S.tone) : S.img;
    const { cut, sil, mask } = S;
    const img = S.timg;
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
    ctx.globalAlpha = 0.4;
    ctx.drawImage(S.timg || S.img, 0, 0);
    ctx.globalAlpha = 1;
    // trait de coupe magenta, d'épaisseur constante à l'écran
    const r = (2.4 * dpr) / S.z;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      ctx.drawImage(S.sil, Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.drawImage(S.cut, 0, 0);
    // sélection de la baguette : contour sombre autour, voile bleu dedans
    if (S.sel && S.selFill) {
      const hr = (1.6 * dpr) / S.z;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.drawImage(S.selHalo, Math.cos(a) * hr, Math.sin(a) * hr); }
      ctx.drawImage(S.selFill, 0, 0);
    }
    ctx.restore();
    // loupe : la zone sous le doigt, grossie deux fois, au-dessus du doigt (ou dessous près du bord)
    if (S.loupe && S.cursor) {
      const R = 62 * dpr, k = 2, gap = 70 * dpr;
      const { x: cx, y: cy } = S.cursor;
      let ly = cy - R - gap;
      if (ly < R + 6 * dpr) ly = cy + R + gap;
      const lx = Math.min(w - R - 6 * dpr, Math.max(R + 6 * dpr, cx));
      // la zone sous le doigt est d'abord copiée à part (dessiner une toile sur elle-même n'est pas
      // fiable dans Safari)
      const sw = Math.max(1, Math.round((2 * R) / k));
      const lens = S.lens && S.lens.width === sw ? S.lens : (S.lens = Extract.makeCanvas(sw, sw));
      const lc = lens.getContext('2d');
      lc.fillStyle = cssVar('--wall', '#e6e4df');
      lc.fillRect(0, 0, sw, sw);
      // (zone bornée à la toile : un ancien Safari ne dessine rien si elle déborde)
      const sx = Math.round(cx - sw / 2), sy = Math.round(cy - sw / 2);
      const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(c.width, sx + sw), y1 = Math.min(c.height, sy + sw);
      if (x1 > x0 && y1 > y0) lc.drawImage(c, x0, y0, x1 - x0, y1 - y0, x0 - sx, y0 - sy, x1 - x0, y1 - y0);
      ctx.save();
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(lens, lx - R, ly - R, 2 * R, 2 * R);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(lx, ly, Math.min(R - 3 * dpr, ((S.size * dpr) / 2) * k), 0, Math.PI * 2);
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = S.tool === 'erase' ? '#e5007d' : cssVar('--accent', '#2f49d1');
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = 'rgba(0, 0, 0, .45)';
      ctx.stroke();
    }
    // aperçu du pinceau
    if (S.cursor && S.tool !== 'pan' && S.tool !== 'wand' && !S.space) {
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
    $('ed-canvas').style.cursor = toolCursor();
    // la baguette se règle en sensibilité, la gomme et le pinceau en taille
    document.querySelector('#editor .ed-size:not(.ed-tol)').hidden = t === 'wand';
    document.querySelector('#editor .ed-tol').hidden = t !== 'wand';
    if (t === 'wand') tip(tr('Touchez une zone pour la sélectionner, puis gommez-la ou restaurez-la.'));
    render();
  }

  const toolCursor = () => (S && S.tool === 'pan' ? 'grab' : S && S.tool === 'wand' ? 'crosshair' : 'none');

  // ---------- Baguette magique ----------

  // Message bref en haut du dessin
  function tip(text) {
    const el = $('ed-tip');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('fade');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.classList.add('fade'); el._t = setTimeout(() => { el.hidden = true; }, 450); }, 3200);
  }

  /*
   * Comme dans Photoshop : à partir du point touché, toute la zone d'un seul tenant dont la couleur
   * reste proche de celle du point (écart inférieur à la sensibilité) est sélectionnée. On choisit
   * ensuite de la gommer ou de la restaurer ; « Ajouter » (ou Maj + clic) ajoute d'autres zones.
   * Changer la sensibilité recalcule la sélection depuis les mêmes points.
   */
  function wand(x, y, add) {
    const { R } = S;
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= R.w || yi >= R.h) return 0;
    const seed = { x: xi, y: yi };
    S.selSeeds = (add || S.selAdd) && S.sel ? S.selSeeds.concat([seed]) : [seed];
    return computeSel();
  }

  function computeSel() {
    const { R } = S;
    if (!S.selSeeds.length) { clearSel(); return 0; }
    if (!S.imgData) S.imgData = S.img.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, R.w, R.h).data;
    const d = S.imgData, W = R.w, N = R.w * R.h;
    const tol = Number($('ed-tol').value) * 1.8, T2 = tol * tol;
    const sel = new Uint8Array(N);
    const stack = [];
    S.selSeeds.forEach(({ x, y }) => {
      const seed = y * W + x;
      if (sel[seed]) return;
      const r0 = d[seed * 4], g0 = d[seed * 4 + 1], b0 = d[seed * 4 + 2];
      sel[seed] = 1;
      stack.push(seed);
      const tryAdd = (q) => {
        if (sel[q]) return;
        const i = q * 4, dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0;
        if (dr * dr + dg * dg + db * db <= T2) { sel[q] = 1; stack.push(q); }
      };
      while (stack.length) {
        const p = stack.pop();
        const px = p % W;
        if (px > 0) tryAdd(p - 1);
        if (px < W - 1) tryAdd(p + 1);
        if (p >= W) tryAdd(p - W);
        if (p < N - W) tryAdd(p + W);
      }
    });
    let n = 0;
    for (let p = 0; p < N; p++) n += sel[p];
    S.sel = sel;
    // calques d'affichage : le voile et le contour
    const fill = S.selFill || Extract.makeCanvas(R.w, R.h), halo = S.selHalo || Extract.makeCanvas(R.w, R.h);
    const fx = fill.getContext('2d'), hx = halo.getContext('2d');
    const im = fx.createImageData(R.w, R.h), hm = hx.createImageData(R.w, R.h);
    for (let p = 0; p < N; p++) {
      const i = p * 4;
      // voile bleu vif dedans (lisible sur le papier comme sur les couleurs)
      if (sel[p]) { im.data[i] = 30; im.data[i + 1] = 110; im.data[i + 2] = 255; im.data[i + 3] = 120; continue; }
      // contour sombre : l'anneau de pixels juste autour de la zone
      const px = p % W;
      if ((px > 0 && sel[p - 1]) || (px < W - 1 && sel[p + 1]) || (p >= W && sel[p - W]) || (p < N - W && sel[p + W])) { hm.data[i] = 20; hm.data[i + 1] = 24; hm.data[i + 2] = 40; hm.data[i + 3] = 255; }
    }
    fx.putImageData(im, 0, 0); hx.putImageData(hm, 0, 0);
    S.selFill = fill; S.selHalo = halo;
    syncSel();
    render();
    return n;
  }

  function clearSel() {
    if (!S) return;
    S.sel = null; S.selSeeds = [];
    syncSel();
    render();
  }

  // la barre d'actions de la sélection ne se montre que quand une zone est sélectionnée
  function syncSel() {
    const bar = $('ed-selbar');
    if (!bar) return;
    bar.hidden = !(S && S.sel);
    $('ed-sel-add').setAttribute('aria-pressed', S && S.selAdd ? 'true' : 'false');
    $('ed-sel-add').classList.toggle('on', !!(S && S.selAdd));
  }

  // Gommer ou restaurer la zone sélectionnée (un pas de « Défaire »), puis désélectionner.
  function applySel(mode) {
    if (!S || !S.sel) return 0;
    const { R, sel } = S;
    const W = R.w, N = R.w * R.h;
    const mctx = S.mask.getContext('2d', { willReadFrequently: true });
    const mimg = mctx.getImageData(0, 0, W, R.h), ma = mimg.data;
    const erase = mode === 'erase';
    pushUndo();
    let n = 0;
    for (let p = 0; p < N; p++) {
      if (sel[p]) { const v = erase ? 0 : 255; if (ma[p * 4 + 3] !== v) n++; ma[p * 4 + 3] = v; continue; }
      if (!erase) continue;
      // gomme élargie d'un pixel, pour ne pas laisser de liseré
      const px = p % W;
      if ((px > 0 && sel[p - 1]) || (px < W - 1 && sel[p + 1]) || (p >= W && sel[p - W]) || (p < N - W && sel[p + W])) ma[p * 4 + 3] = 0;
    }
    mctx.putImageData(mimg, 0, 0);
    S.dirty = true;
    S.selAdd = false;
    clearSel();
    return n;
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

  // retour à la découpe automatique de l'atelier (recalculée), sinon à celle de l'ouverture
  function reset() {
    if (!S) return;
    pushUndo();
    let auto = null;
    try { auto = S.opts.autoPiece ? S.opts.autoPiece() : null; } catch (e) { auto = null; }
    if (auto && auto.src) {
      const m = S.mask.getContext('2d', { willReadFrequently: true });
      m.clearRect(0, 0, S.mask.width, S.mask.height);
      m.drawImage(auto.canvas, auto.src.x - S.R.x, auto.src.y - S.R.y, auto.src.w, auto.src.h);
    } else putAlpha(S.mask, S.initial);
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
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
    const p = toLocal(e);
    S.pointers.set(e.pointerId, p);
    if (S.pointers.size === 2) {
      S.wandTap = null;
      // deux doigts : on abandonne le trait commencé et on passe en zoom / déplacement
      if (S.stroke) { undo(); S.redo.pop(); history(); S.stroke = null; S.loupe = false; }
      const [a, b] = [...S.pointers.values()];
      S.pinch = { d: Math.hypot(a.px - b.px, a.py - b.py), mx: (a.px + b.px) / 2, my: (a.py + b.py) / 2 };
      return;
    }
    const pan = S.tool === 'pan' || S.space || e.button === 1 || e.button === 2;
    if (pan) { S.drag = { px: p.px, py: p.py }; c.style.cursor = 'grabbing'; return; }
    if (S.tool === 'wand') { S.wandTap = { id: e.pointerId, px: p.px, py: p.py, x: p.x, y: p.y, add: e.shiftKey }; return; }
    pushUndo();
    S.stroke = { tool: S.tool, last: p };
    // au doigt, une loupe montre au-dessus ce qui est sous le doigt
    S.loupe = e.pointerType === 'touch' || e.pointerType === 'pen';
    S.cursor = { x: p.px, y: p.py };
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
    const tap = S.wandTap;
    if (tap && tap.id === e.pointerId) {
      S.wandTap = null;
      const p = toLocal(e);
      const dpr = window.devicePixelRatio || 1;
      if (Math.hypot(p.px - tap.px, p.py - tap.py) < 12 * dpr) wand(tap.x, tap.y, tap.add);
    }
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.pinch = null;
    S.stroke = null;
    if (S.loupe) { S.loupe = false; if (e.pointerType === 'touch') S.cursor = null; render(); }
    if (S.drag) { S.drag = null; $('ed-canvas').style.cursor = toolCursor(); }
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
    if (maxX < 0) { $('ed-msg').textContent = tr('La découpe est vide : restaurez une partie du dessin avant de valider.'); return; }
    const toneChanged = toneKey(S.tone) !== toneKey(S.tone0), tone = S.tone;
    let same = a.length === S.initial.length;
    for (let i = 0; same && i < a.length; i++) if (a[i] !== S.initial[i]) same = false;
    if (same) {
      // découpe inchangée : seule la lumière a pu changer, la pièce reste telle quelle
      const o = S.opts;
      close();
      if (toneChanged && o.onTone) o.onTone(tone);
      return;
    }
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
    if (toneChanged && opts.onTone) opts.onTone(tone);
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
    // iOS : un appui long sur la toile lancerait la sélection de texte et sa loupe ; les gestes de
    // l'éditeur passent par les événements « pointer », qui restent émis
    c.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    c.addEventListener('wheel', (e) => {
      if (!S) return;
      e.preventDefault();
      const p = toLocal(e);
      zoomAt(Math.exp(-e.deltaY * 0.0015), p.px, p.py);
    }, { passive: false });
    document.querySelectorAll('#editor [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    $('ed-size').addEventListener('input', (e) => { if (S) { S.size = Number(e.target.value); render(); } });
    $('ed-tol').addEventListener('input', (e) => { $('ed-tol-val').textContent = e.target.value; if (S && S.sel) computeSel(); });
    $('ed-sel-erase').onclick = () => applySel('erase');
    $('ed-sel-restore').onclick = () => applySel('restore');
    $('ed-sel-add').onclick = () => { if (S) { S.selAdd = !S.selAdd; syncSel(); if (S.selAdd) tip(tr('Touchez d’autres zones pour les ajouter à la sélection.')); } };
    $('ed-sel-clear').onclick = () => { if (S) { S.selAdd = false; clearSel(); } };
    const center = (f) => { const { w, h } = canvasSize(); zoomAt(f, w / 2, h / 2); };
    $('ed-zin').onclick = () => center(1.3);
    $('ed-zout').onclick = () => center(1 / 1.3);
    $('ed-fit').onclick = fit;
    $('ed-undo').onclick = undo;
    $('ed-redo').onclick = redo;
    $('ed-reset').onclick = reset;
    $('ed-cancel').onclick = close;
    $('ed-tone-toggle').onclick = () => showTone($('ed-tone').hidden);
    document.querySelectorAll('#ed-tone [data-ed-tone]').forEach((r) => {
      r.addEventListener('input', () => { if (S) setTone(Object.assign({}, S.tone, { [r.dataset.edTone]: Number(r.value) })); });
    });
    $('ed-tone-auto').onclick = () => {
      if (!S || !S.opts.autoTone) return;
      const t = toneOf(S.opts.autoTone());
      setTone(t, t.b || t.c || t.s ? tr('Réglé d’après le dessin : blanc du papier, traits et couleurs. Ajustez à votre goût.') : tr('Ce dessin est déjà bien exposé : rien à corriger.'));
    };
    $('ed-tone-reset').onclick = () => setTone(null);
    $('ed-apply').onclick = apply;
    window.addEventListener('resize', () => S && render());
    window.addEventListener('keydown', (e) => {
      if (!S) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape') { e.preventDefault(); if (S.sel) { S.selAdd = false; clearSel(); } else close(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); applySel('erase'); }
      else if (e.key === 'Enter') { e.preventDefault(); apply(); }
      else if (e.key === ' ') { e.preventDefault(); S.space = true; $('ed-canvas').style.cursor = 'grab'; render(); }
      else if (e.key === 'e' || e.key === 'E') setTool('erase');
      else if (e.key === 'r' || e.key === 'R') setTool('restore');
      else if (e.key === 'h' || e.key === 'H') setTool('pan');
      else if (e.key === 'w' || e.key === 'W') setTool('wand');
      else if (e.key === '[' || e.key === ']') {
        const s = $('ed-size');
        s.value = Math.max(Number(s.min), Math.min(Number(s.max), Number(s.value) + (e.key === ']' ? 6 : -6)));
        S.size = Number(s.value);
        render();
      }
      e.stopPropagation();
    }, true);
    window.addEventListener('keyup', (e) => {
      if (S && e.key === ' ') { S.space = false; $('ed-canvas').style.cursor = toolCursor(); render(); }
    });
  }

  init();
  window.Editor = {
    open, isOpen: () => !!S, loupe: () => !!(S && S.loupe),
    wand: (x, y, add) => (S ? wand(x, y, add) : 0),
    applySelection: (mode) => (S ? applySel(mode) : 0),
    selection: () => (S && S.sel ? S.sel.reduce((a, v) => a + v, 0) : 0),
  };
})();
