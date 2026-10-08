/*
 * Le livre de dessins — retouche d'un dessin : recadrer et gommer.
 *
 * Le dessin est ouvert en pleine définition. Le cadre se règle par ses coins et ses bords, ou se
 * déplace en entier ; la gomme peint la couleur du papier du dessin (relevée sur ses bords), pour
 * effacer un prénom, une tache ou un bout de table. Tout se fait sur une copie : Défaire revient
 * en arrière geste par geste, « Dessin d'origine » repart du scan importé, Annuler ne change rien.
 * Valider rend le dessin recadré, en JPEG.
 *
 *   LivreEditor.open(drawing, { original: Blob|null, onApply: (blob, w, h) => {} })
 */
(function () {
  'use strict';

  const tr = window.tr || ((s) => s);
  const $ = (id) => document.getElementById(id);
  const box = $('editor'), canvas = $('ed-canvas'), ctx = canvas.getContext('2d');

  let S = null; // séance de retouche en cours

  async function decode(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* repli */ }
    }
    const url = URL.createObjectURL(blob);
    try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
  }
  const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

  // Couleur du papier : la médiane des pixels clairs du pourtour (blanc si le bord est sombre).
  function paperColor(c) {
    const k = Math.min(1, 300 / Math.max(c.width, c.height));
    const s = canvasOf(c.width * k, c.height * k);
    const x = s.getContext('2d', { willReadFrequently: true });
    x.drawImage(c, 0, 0, s.width, s.height);
    const { data, width: w, height: h } = x.getImageData(0, 0, s.width, s.height);
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
    const px = [];
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      if (xx >= band && xx < w - band && y >= band && y < h - band) continue;
      const i = (y * w + xx) * 4;
      px.push([data[i], data[i + 1], data[i + 2]]);
    }
    const light = px.filter((p) => p[0] + p[1] + p[2] > 480);
    if (light.length < px.length * 0.2) return '#ffffff';
    const med = (j) => { const v = light.map((p) => p[j]).sort((a, b) => a - b); return v[v.length >> 1]; };
    return `rgb(${med(0)}, ${med(1)}, ${med(2)})`;
  }

  // ---------- Séance ----------

  async function load(blob) {
    const img = await decode(blob);
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    const base = canvasOf(w, h);
    base.getContext('2d').drawImage(img, 0, 0);
    if (img.close) img.close();
    const work = canvasOf(w, h);
    work.getContext('2d').drawImage(base, 0, 0);
    return { base, work, w, h, crop: { x: 0, y: 0, w, h }, strokes: [], actions: [], paper: paperColor(base) };
  }

  async function open(d, opts) {
    const st = await load(d.blob);
    S = Object.assign(st, { d, opts: opts || {}, tool: 'crop', drag: null, hover: null, changed: false, fromOriginal: false });
    $('ed-orig').hidden = !S.opts.original;
    box.hidden = false;
    document.body.classList.add('editing');
    setTool('crop');
    requestAnimationFrame(draw);
    $('ed-apply').focus({ preventScroll: true });
  }
  function close() {
    if (!S) return;
    S.base.width = S.base.height = 0;
    S.work.width = S.work.height = 0;
    S = null;
    box.hidden = true;
    document.body.classList.remove('editing');
  }

  function setTool(t) {
    if (!S) return;
    S.tool = t;
    document.querySelectorAll('#editor [data-tool]').forEach((b) => { const on = b.dataset.tool === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $('ed-size-box').hidden = t !== 'erase';
    $('ed-help').textContent = t === 'crop'
      ? tr('Tirez les coins ou les bords du cadre ; glissez à l’intérieur pour le déplacer.')
      : tr('Passez sur ce qu’il faut effacer : la gomme peint la couleur du papier du dessin.');
    draw();
  }

  // ---------- Affichage ----------

  let view = { k: 1, ox: 0, oy: 0, dpr: 1 };
  function draw() {
    if (!S) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth * dpr, ch = canvas.clientHeight * dpr;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const pad = 24 * dpr;
    const k = Math.min((cw - 2 * pad) / S.w, (ch - 2 * pad) / S.h);
    const ox = (cw - S.w * k) / 2, oy = (ch - S.h * k) / 2;
    view = { k, ox, oy, dpr };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.work, ox, oy, S.w * k, S.h * k);
    // hors du cadre : assombri
    const c = S.crop;
    const cx = ox + c.x * k, cy = oy + c.y * k, cwk = c.w * k, chk = c.h * k;
    ctx.fillStyle = 'rgba(20, 20, 16, 0.62)';
    ctx.beginPath();
    ctx.rect(ox, oy, S.w * k, S.h * k);
    ctx.rect(cx, cy, cwk, chk);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(cx, cy, cwk, chk);
    if (S.tool === 'crop') {
      // tiers et poignées
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) { ctx.moveTo(cx + (cwk * i) / 3, cy); ctx.lineTo(cx + (cwk * i) / 3, cy + chk); ctx.moveTo(cx, cy + (chk * i) / 3); ctx.lineTo(cx + cwk, cy + (chk * i) / 3); }
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      const hs = 9 * dpr;
      handles().forEach(([hx, hy]) => ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2));
    } else if (S.hover) {
      const r = (Number($('ed-size').value) * dpr) / 2;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(S.hover.x, S.hover.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 0.75 * dpr;
      ctx.beginPath(); ctx.arc(S.hover.x, S.hover.y, r + 1.5 * dpr, 0, Math.PI * 2); ctx.stroke();
    }
    updateButtons();
  }
  function handles() {
    const { k, ox, oy } = view, c = S.crop;
    const x0 = ox + c.x * k, y0 = oy + c.y * k, x1 = x0 + c.w * k, y1 = y0 + c.h * k, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    return [[x0, y0, 'nw'], [xm, y0, 'n'], [x1, y0, 'ne'], [x1, ym, 'e'], [x1, y1, 'se'], [xm, y1, 's'], [x0, y1, 'sw'], [x0, ym, 'w']];
  }
  function updateButtons() {
    $('ed-undo').disabled = !S || !S.actions.length;
    $('ed-full').disabled = !S || (S.crop.x === 0 && S.crop.y === 0 && S.crop.w === S.w && S.crop.h === S.h);
  }

  // ---------- Gestes ----------

  const devicePt = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * view.dpr, y: (e.clientY - r.top) * view.dpr }; };
  const toImage = (p) => ({ x: (p.x - view.ox) / view.k, y: (p.y - view.oy) / view.k });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function paintSegment(a, b, r) {
    const x = S.work.getContext('2d');
    x.strokeStyle = S.paper;
    x.fillStyle = S.paper;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.lineWidth = r * 2;
    x.beginPath();
    if (a.x === b.x && a.y === b.y) { x.arc(a.x, a.y, r, 0, Math.PI * 2); x.fill(); return; }
    x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
  }
  function replay() {
    const x = S.work.getContext('2d');
    x.drawImage(S.base, 0, 0);
    S.strokes.forEach((s) => { for (let i = 0; i < s.pts.length; i++) paintSegment(s.pts[Math.max(0, i - 1)], s.pts[i], s.r); });
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!S) return;
    canvas.setPointerCapture(e.pointerId);
    const p = devicePt(e), q = toImage(p);
    if (S.tool === 'erase') {
      const s = { r: Number($('ed-size').value) * view.dpr / 2 / view.k, pts: [{ x: q.x, y: q.y }] };
      S.strokes.push(s);
      S.actions.push({ type: 'stroke' });
      paintSegment(s.pts[0], s.pts[0], s.r);
      S.drag = { mode: 'erase', s };
      S.changed = true;
      draw();
      return;
    }
    // recadrage : poignée la plus proche, sinon déplacement si on est dans le cadre
    const grab = 22 * view.dpr;
    let best = null;
    handles().forEach(([hx, hy, name]) => { const dd = Math.hypot(hx - p.x, hy - p.y); if (dd < grab && (!best || dd < best.d)) best = { name, d: dd }; });
    const c = S.crop;
    const inside = q.x > c.x && q.x < c.x + c.w && q.y > c.y && q.y < c.y + c.h;
    if (!best && !inside) return;
    S.drag = { mode: best ? best.name : 'move', start: q, crop0: Object.assign({}, c) };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!S) return;
    const p = devicePt(e), q = toImage(p);
    if (S.tool === 'erase') S.hover = p;
    const d = S.drag;
    if (!d) { if (S.tool === 'erase') draw(); return; }
    if (d.mode === 'erase') {
      const last = d.s.pts[d.s.pts.length - 1];
      const pt = { x: q.x, y: q.y };
      d.s.pts.push(pt);
      paintSegment(last, pt, d.s.r);
      draw();
      return;
    }
    const c0 = d.crop0, dx = q.x - d.start.x, dy = q.y - d.start.y;
    const min = Math.max(20, Math.min(S.w, S.h) * 0.05);
    let { x, y, w, h } = c0;
    if (d.mode === 'move') {
      x = clamp(c0.x + dx, 0, S.w - c0.w);
      y = clamp(c0.y + dy, 0, S.h - c0.h);
    } else {
      let x0 = c0.x, y0 = c0.y, x1 = c0.x + c0.w, y1 = c0.y + c0.h;
      if (d.mode.includes('w')) x0 = clamp(c0.x + dx, 0, x1 - min);
      if (d.mode.includes('e')) x1 = clamp(x1 + dx, x0 + min, S.w);
      if (d.mode.includes('n')) y0 = clamp(c0.y + dy, 0, y1 - min);
      if (d.mode.includes('s')) y1 = clamp(y1 + dy, y0 + min, S.h);
      x = x0; y = y0; w = x1 - x0; h = y1 - y0;
    }
    S.crop = { x, y, w, h };
    draw();
  });

  const endDrag = () => {
    if (!S || !S.drag) return;
    const d = S.drag;
    S.drag = null;
    if (d.mode !== 'erase') {
      const c = S.crop, c0 = d.crop0;
      if (c.x !== c0.x || c.y !== c0.y || c.w !== c0.w || c.h !== c0.h) { S.actions.push({ type: 'crop', prev: c0 }); S.changed = true; }
    }
    draw();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (S && !S.drag) { S.hover = null; draw(); } });

  function undo() {
    if (!S || !S.actions.length) return;
    const a = S.actions.pop();
    if (a.type === 'crop') S.crop = a.prev;
    else if (a.type === 'stroke') { S.strokes.pop(); replay(); }
    else if (a.type === 'full') S.crop = a.prev;
    draw();
  }

  // ---------- Boutons ----------

  document.querySelectorAll('#editor [data-tool]').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
  $('ed-size').oninput = () => draw();
  $('ed-undo').onclick = undo;
  $('ed-full').onclick = () => {
    if (!S) return;
    S.actions.push({ type: 'full', prev: Object.assign({}, S.crop) });
    S.crop = { x: 0, y: 0, w: S.w, h: S.h };
    S.changed = true;
    draw();
  };
  $('ed-orig').onclick = async () => {
    if (!S || !S.opts.original) return;
    const keep = { d: S.d, opts: S.opts, tool: S.tool };
    S.base.width = S.base.height = 0; S.work.width = S.work.height = 0;
    const st = await load(S.opts.original);
    S = Object.assign(st, keep, { drag: null, hover: null, changed: true, fromOriginal: true });
    draw();
  };
  $('ed-cancel').onclick = close;
  $('ed-apply').onclick = async () => {
    if (!S) return;
    if (!S.changed) { close(); return; }
    const btn = $('ed-apply');
    btn.disabled = true;
    try {
      const c = S.crop;
      const out = canvasOf(c.w, c.h);
      out.getContext('2d').drawImage(S.work, Math.round(c.x), Math.round(c.y), out.width, out.height, 0, 0, out.width, out.height);
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.9));
      if (!blob) throw new Error('jpeg');
      const { onApply } = S.opts, w = out.width, h = out.height;
      out.width = out.height = 0;
      close();
      if (onApply) await onApply(blob, w, h);
    } catch (e) {
      console.error(e);
      $('ed-help').textContent = tr('Le dessin retouché n’a pas pu être enregistré sur cet appareil.');
    } finally { btn.disabled = false; }
  };
  document.addEventListener('keydown', (e) => {
    if (!S) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); }
  });
  window.addEventListener('resize', () => { if (S) draw(); });

  window.LivreEditor = { open, close, isOpen: () => !!S, session: () => S, undo, setTool };
})();
