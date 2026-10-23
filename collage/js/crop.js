/*
 * Recadrer une page de fond (fiche du dessin, « Recadrer la page »).
 *
 * La page s'affiche entière ; le cadre se règle par ses coins et ses bords, ou se déplace en entier
 * (au clavier : flèches pour le déplacer, Maj+flèches pour le réduire ou l'agrandir). « Toute la
 * page » reprend la feuille entière, « Rétablir » le cadrage d'origine. Valider rend le cadre en
 * fractions de la page ; Annuler (ou Échap) ne change rien.
 *
 *   Crop.open(page, rect, { initial, onApply: (rect) => {} })
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MIN = 0.08; // le cadre garde au moins 8 % de chaque côté de la page
  const HANDLE = 14; // rayon de prise d'une poignée (pixels CSS ; au doigt, plus large)

  let S = null; // séance en cours
  let view = { k: 1, ox: 0, oy: 0, dpr: 1 };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const same = (a, b) => ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 1e-4);

  function open(page, rect, opts) {
    const box = $('crop');
    S = { page, rect: Object.assign({}, rect), start: Object.assign({}, rect), initial: Object.assign({}, (opts && opts.initial) || rect), opts: opts || {}, drag: null };
    box.hidden = false;
    const c = $('crop-canvas');
    requestAnimationFrame(() => { draw(); c.focus({ preventScroll: true }); });
  }
  function close(apply) {
    if (!S) return;
    const s = S;
    S = null;
    $('crop').hidden = true;
    if (apply && !same(s.rect, s.start) && s.opts.onApply) s.opts.onApply(Object.assign({}, s.rect));
  }

  // ---------- Affichage ----------

  function draw() {
    if (!S) return;
    const canvas = $('crop-canvas'), ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
    if (!cw || !ch) return;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const pad = 16 * dpr, W = S.page.width, H = S.page.height;
    const k = Math.min((cw - 2 * pad) / W, (ch - 2 * pad) / H);
    const ox = (cw - W * k) / 2, oy = (ch - H * k) / 2;
    view = { k, ox, oy, dpr };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.page, ox, oy, W * k, H * k);
    // hors du cadre : assombri
    const r = S.rect;
    const x = ox + r.x * W * k, y = oy + r.y * H * k, w = r.w * W * k, h = r.h * H * k;
    ctx.fillStyle = 'rgba(20, 20, 16, 0.62)';
    ctx.beginPath();
    ctx.rect(ox, oy, W * k, H * k);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255, 255, 255, .35)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) { ctx.moveTo(x + (w * i) / 3, y); ctx.lineTo(x + (w * i) / 3, y + h); ctx.moveTo(x, y + (h * i) / 3); ctx.lineTo(x + w, y + (h * i) / 3); }
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#ffffff';
    const hs = 6 * dpr;
    handles().forEach(([, hx, hy]) => ctx.fillRect(hx * dpr - hs, hy * dpr - hs, hs * 2, hs * 2));
    // (place gardée : la fenêtre ne bouge pas sous le doigt quand le lien apparaît)
    $('crop-reset').style.visibility = same(S.rect, S.initial) ? 'hidden' : '';
  }

  // poignées : [bords tenus, x, y] en pixels CSS du canevas
  function handles() {
    const r = S.rect, W = S.page.width, H = S.page.height, { k, ox, oy, dpr } = view;
    const x0 = (ox + r.x * W * k) / dpr, y0 = (oy + r.y * H * k) / dpr;
    const x1 = x0 + (r.w * W * k) / dpr, y1 = y0 + (r.h * H * k) / dpr, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    return [['nw', x0, y0], ['ne', x1, y0], ['sw', x0, y1], ['se', x1, y1], ['n', xm, y0], ['s', xm, y1], ['w', x0, ym], ['e', x1, ym]];
  }
  function pointOf(e) {
    const b = $('crop-canvas').getBoundingClientRect();
    return { px: e.clientX - b.left, py: e.clientY - b.top };
  }
  // fraction de la page sous un point (pixels CSS du canevas)
  function fracOf(p) {
    const { k, ox, oy, dpr } = view;
    return { u: (p.px * dpr - ox) / (S.page.width * k), v: (p.py * dpr - oy) / (S.page.height * k) };
  }
  function hit(p, touch) {
    const reach = touch ? 26 : HANDLE;
    // la poignée la plus proche (un petit cadre a ses poignées serrées)
    let best = null, bd = reach;
    handles().forEach(([m, x, y]) => { const dd = Math.hypot(p.px - x, p.py - y); if (dd <= bd) { bd = dd; best = m; } });
    if (best) return best;
    const { u, v } = fracOf(p), r = S.rect;
    return u >= r.x && u <= r.x + r.w && v >= r.y && v <= r.y + r.h ? 'move' : null;
  }
  const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize', move: 'move' };

  // ---------- Gestes ----------

  // un bord tiré : le cadre reste dans la page et garde sa taille minimale
  function pull(r0, mode, du, dv) {
    let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
    if (mode === 'move') {
      const dx = clamp(du, -x0, 1 - x1), dy = clamp(dv, -y0, 1 - y1);
      return { x: x0 + dx, y: y0 + dy, w: r0.w, h: r0.h };
    }
    if (mode.includes('w')) x0 = clamp(x0 + du, 0, x1 - MIN);
    if (mode.includes('e')) x1 = clamp(x1 + du, x0 + MIN, 1);
    if (mode.includes('n')) y0 = clamp(y0 + dv, 0, y1 - MIN);
    if (mode.includes('s')) y1 = clamp(y1 + dv, y0 + MIN, 1);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function bind() {
    const box = $('crop'), canvas = $('crop-canvas');
    if (!box || !canvas) return;
    canvas.addEventListener('pointerdown', (e) => {
      if (!S) return;
      const p = pointOf(e), mode = hit(p, e.pointerType === 'touch');
      if (!mode) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      S.drag = { id: e.pointerId, mode, from: fracOf(p), r0: Object.assign({}, S.rect) };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!S) return;
      const p = pointOf(e);
      if (!S.drag) { const m = hit(p); canvas.style.cursor = m ? CURSOR[m] : ''; return; }
      if (e.pointerId !== S.drag.id) return;
      const f = fracOf(p);
      S.rect = pull(S.drag.r0, S.drag.mode, f.u - S.drag.from.u, f.v - S.drag.from.v);
      draw();
    });
    const end = (e) => { if (S && S.drag && e.pointerId === S.drag.id) S.drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', (e) => {
      if (!S) return;
      const step = e.altKey ? 0.002 : 0.01;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        e.preventDefault();
        S.rect = pull(S.rect, e.shiftKey ? 'se' : 'move', d[0], d[1]);
        draw();
      } else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    });
    $('crop-all').onclick = () => { if (!S) return; S.rect = { x: 0, y: 0, w: 1, h: 1 }; draw(); };
    $('crop-reset').onclick = () => { if (!S) return; S.rect = Object.assign({}, S.initial); draw(); };
    $('crop-apply').onclick = () => close(true);
    box.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => close(false)));
    box.addEventListener('click', (e) => { if (e.target === box) close(false); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } });
    window.addEventListener('resize', () => { if (S) draw(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();

  window.Crop = { open, close: () => close(false), isOpen: () => !!S };
})();
