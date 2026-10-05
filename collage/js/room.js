/*
 * Mise en scène : une photo de la pièce (salon, chambre…) et l'œuvre posée sur le mur.
 * On déplace l'œuvre, on la redimensionne, et ses quatre coins se règlent un à un pour suivre la
 * perspective du mur. Le rendu passe par une homographie (le carré unité → les quatre coins),
 * dessinée par petites cellules affines. Export : la photo avec l'œuvre, en JPEG.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  let S = null;

  // Homographie du carré unité vers le quadrilatère (p0 haut-gauche, p1 haut-droit, p2 bas-droit, p3 bas-gauche)
  function homography(q) {
    const [x0, y0] = q[0], [x1, y1] = q[1], [x2, y2] = q[2], [x3, y3] = q[3];
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const det = dx1 * dy2 - dx2 * dy1 || 1e-9;
    const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det;
    const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
    const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
    return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
  }

  // Dessine l'image déformée vers les quatre coins, par cellules (triangles affines) sans couture
  function drawWarped(ctx, img, corners, n) {
    const H = homography(corners);
    const iw = img.width, ih = img.height;
    n = n || 24;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u0 = i / n, v0 = j / n, u1 = (i + 1) / n, v1 = (j + 1) / n;
        const p00 = H(u0, v0), p10 = H(u1, v0), p01 = H(u0, v1), p11 = H(u1, v1);
        // deux triangles par cellule
        tri(ctx, img, [u0 * iw, v0 * ih], [u1 * iw, v0 * ih], [u0 * iw, v1 * ih], p00, p10, p01);
        tri(ctx, img, [u1 * iw, v1 * ih], [u0 * iw, v1 * ih], [u1 * iw, v0 * ih], p11, p01, p10);
      }
    }
  }
  function tri(ctx, img, s0, s1, s2, d0, d1, d2) {
    // transformation affine qui envoie le triangle source sur le triangle destination
    const [sx0, sy0] = s0, [sx1, sy1] = s1, [sx2, sy2] = s2;
    const [dx0, dy0] = d0, [dx1, dy1] = d1, [dx2, dy2] = d2;
    const det = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
    if (Math.abs(det) < 1e-9) return;
    const a = ((dx1 - dx0) * (sy2 - sy0) - (dx2 - dx0) * (sy1 - sy0)) / det;
    const b = ((dy1 - dy0) * (sy2 - sy0) - (dy2 - dy0) * (sy1 - sy0)) / det;
    const c = ((dx2 - dx0) * (sx1 - sx0) - (dx1 - dx0) * (sx2 - sx0)) / det;
    const d = ((dy2 - dy0) * (sx1 - sx0) - (dy1 - dy0) * (sx2 - sx0)) / det;
    const e = dx0 - a * sx0 - c * sy0, f = dy0 - b * sx0 - d * sy0;
    ctx.save();
    ctx.beginPath();
    // le triangle, légèrement dilaté autour de son centre pour éviter les coutures
    const cx = (dx0 + dx1 + dx2) / 3, cy = (dy0 + dy1 + dy2) / 3;
    const grow = (x, y) => { const vx = x - cx, vy = y - cy, l = Math.hypot(vx, vy) || 1; return [x + (vx / l) * 0.7, y + (vy / l) * 0.7]; };
    const g0 = grow(dx0, dy0), g1 = grow(dx1, dy1), g2 = grow(dx2, dy2);
    ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // Composition finale, à la résolution de la photo : photo, ombre douce, œuvre déformée, tranche
  function compose(ctx, scale) {
    const { photo, art, corners } = S;
    const q = corners.map(([x, y]) => [x * scale, y * scale]);
    ctx.drawImage(photo, 0, 0, photo.width * scale, photo.height * scale);
    // ombre portée douce, comme une toile sur châssis à quelques centimètres du mur
    ctx.save();
    ctx.filter = `blur(${Math.max(2, 0.012 * photo.width * scale)}px)`;
    ctx.fillStyle = 'rgba(20,16,10,0.45)';
    const off = 0.006 * photo.width * scale;
    ctx.beginPath();
    q.forEach(([x, y], i) => (i ? ctx.lineTo(x + off, y + off * 1.6) : ctx.moveTo(x + off, y + off * 1.6)));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // tranche de la toile (droite et basse), un peu plus sombre
    ctx.save();
    const t = 0.008 * photo.width * scale;
    ctx.fillStyle = 'rgba(60,50,40,0.9)';
    ctx.beginPath(); ctx.moveTo(q[1][0], q[1][1]); ctx.lineTo(q[1][0] + t, q[1][1] + t * 0.3); ctx.lineTo(q[2][0] + t, q[2][1] + t * 0.3); ctx.lineTo(q[2][0], q[2][1]); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(40,34,26,0.9)';
    ctx.beginPath(); ctx.moveTo(q[3][0], q[3][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.lineTo(q[2][0] + t, q[2][1] + t * 0.3); ctx.lineTo(q[3][0] + t, q[3][1] + t * 0.3); ctx.closePath(); ctx.fill();
    ctx.restore();
    drawWarped(ctx, art, q, 28);
    // léger reflet de la lumière de la pièce sur la toile
    ctx.save();
    ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip();
    const g = ctx.createLinearGradient(q[0][0], q[0][1], q[2][0], q[2][1]);
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, photo.width * scale, photo.height * scale);
    ctx.restore();
  }

  function fitView() {
    const c = $('room-canvas');
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth * dpr, ch = c.clientHeight * dpr;
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const s = Math.min(cw / S.photo.width, ch / S.photo.height);
    S.view = { s, ox: (cw - S.photo.width * s) / 2, oy: (ch - S.photo.height * s) / 2, dpr };
  }

  function draw() {
    if (!S) return;
    S.raf = 0;
    fitView();
    const c = $('room-canvas'), ctx = c.getContext('2d');
    const { s, ox, oy, dpr } = S.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.translate(ox, oy);
    compose(ctx, s);
    // poignées des coins
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    S.corners.forEach(([x, y], i) => {
      const px = ox + x * s, py = oy + y * s;
      ctx.beginPath(); ctx.arc(px, py, 9 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = i === S.active ? '#c26f56' : 'rgba(248,245,239,0.95)'; ctx.fill();
      ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#3b3a2a'; ctx.stroke();
    });
  }
  function render() { if (S && !S.raf) S.raf = requestAnimationFrame(draw); }

  /*
   * Placement automatique : on cherche le mur dégagé (la plus grande zone unie et claire, de la
   * couleur dominante des surfaces planes), on pose l'œuvre au milieu de cette zone, et on l'incline
   * pour suivre la perspective du mur : ses bords haut et bas suivent la ligne du plafond et celle
   * du sol (ou de la plinthe) mesurées sur la photo.
   */
  function findWall(photo) {
    const gw = 96, gh = Math.max(24, Math.round((gw * photo.height) / photo.width));
    const small = Extract.makeCanvas(gw * 4, gh * 4);
    small.getContext('2d').drawImage(photo, 0, 0, gw * 4, gh * 4);
    const d = small.getContext('2d').getImageData(0, 0, gw * 4, gh * 4).data;
    const mean = new Float32Array(gw * gh * 3), sd = new Float32Array(gw * gh), lum = new Float32Array(gw * gh);
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        let r = 0, g = 0, b = 0, l2 = 0, l1 = 0;
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          const i = ((cy * 4 + y) * gw * 4 + cx * 4 + x) * 4;
          const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          r += d[i]; g += d[i + 1]; b += d[i + 2]; l1 += l; l2 += l * l;
        }
        const k = cy * gw + cx;
        mean[k * 3] = r / 16; mean[k * 3 + 1] = g / 16; mean[k * 3 + 2] = b / 16;
        lum[k] = l1 / 16; sd[k] = Math.sqrt(Math.max(0, l2 / 16 - (l1 / 16) ** 2));
      }
    }
    // cellules planes et claires, dans les trois quarts supérieurs : candidates au mur
    const flat = new Uint8Array(gw * gh);
    const hist = new Map();
    for (let k = 0; k < gw * gh; k++) {
      const cy = Math.floor(k / gw);
      if (sd[k] < 9 && lum[k] > 80 && cy < gh * 0.78) {
        flat[k] = 1;
        const key = `${mean[k * 3] >> 4},${mean[k * 3 + 1] >> 4},${mean[k * 3 + 2] >> 4}`;
        hist.set(key, (hist.get(key) || 0) + 1);
      }
    }
    let wallKey = null, wallN = 0;
    hist.forEach((n, key) => { if (n > wallN) { wallN = n; wallKey = key; } });
    if (!wallKey) return null;
    const wc = wallKey.split(',').map((v) => Number(v) * 16 + 8);
    const wall = new Uint8Array(gw * gh);
    for (let k = 0; k < gw * gh; k++) {
      if (!flat[k]) continue;
      const dr = mean[k * 3] - wc[0], dg = mean[k * 3 + 1] - wc[1], db = mean[k * 3 + 2] - wc[2];
      if (dr * dr + dg * dg + db * db < 42 * 42) wall[k] = 1;
    }
    // plus grand rectangle inscrit dans le mur (histogrammes par ligne)
    const hgt = new Int32Array(gw);
    let best = { area: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) hgt[x] = wall[y * gw + x] ? hgt[x] + 1 : 0;
      const stack = [];
      for (let x = 0; x <= gw; x++) {
        const h = x < gw ? hgt[x] : 0;
        let start = x;
        while (stack.length && stack[stack.length - 1][1] > h) {
          const [sx, sh] = stack.pop();
          const area = sh * (x - sx);
          if (area > best.area) best = { area, x0: sx, y0: y - sh + 1, x1: x, y1: y + 1 };
          start = sx;
        }
        stack.push([start, h]);
      }
    }
    if (best.area < gw * gh * 0.04) return null;
    // lignes du sol et du plafond : pour chaque colonne du rectangle, où le mur s'arrête en bas et en haut
    const xs = [], floor = [], ceil = [];
    for (let x = best.x0; x < best.x1; x++) {
      let yb = best.y1; while (yb < gh && wall[yb * gw + x]) yb++;
      let yt = best.y0 - 1; while (yt >= 0 && wall[yt * gw + x]) yt--;
      xs.push(x + 0.5); floor.push(yb); ceil.push(yt + 1);
    }
    const fit = (ys) => { // droite y = a x + b par moindres carrés
      const n = xs.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
      const a = (n * sxy - sx * sy) / Math.max(1e-6, n * sxx - sx * sx);
      return { a, b: (sy - a * sx) / n };
    };
    const k = photo.width / gw;
    const scaleLine = (L) => ({ a: L.a, b: L.b * k });
    return { rect: { x0: best.x0 * k, y0: best.y0 * k, x1: best.x1 * k, y1: best.y1 * k }, floor: scaleLine(fit(floor)), ceil: scaleLine(fit(ceil)) };
  }

  function autoPlace() {
    const { photo, art } = S;
    const wall = findWall(photo);
    const ar = art.height / art.width;
    if (!wall) {
      const w = photo.width * 0.45, h = w * ar;
      const x = (photo.width - w) / 2, y = Math.max(photo.height * 0.08, photo.height * 0.42 - h / 2);
      S.corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      return;
    }
    const { rect, floor, ceil } = wall;
    const rw = rect.x1 - rect.x0, rh = rect.y1 - rect.y0;
    // largeur : 62 % du mur dégagé, bornée par la hauteur disponible
    let w = rw * 0.62;
    if (w * ar > rh * 0.8) w = (rh * 0.8) / ar;
    const xm = (rect.x0 + rect.x1) / 2, xa = xm - w / 2, xb = xm + w / 2;
    const yc = (x) => ceil.a * x + ceil.b, yf = (x) => floor.a * x + floor.b;
    // au centre de la zone dégagée, à hauteur de regard : 45 % entre plafond et sol
    const span = (x) => Math.max(1, yf(x) - yc(x));
    const r = Math.min(0.6, Math.max(0.3, ((rect.y0 + rect.y1) / 2 - yc(xm)) / span(xm)));
    const h0 = w * ar;
    const hAt = (x) => h0 * (span(x) / span(xm));
    const yAt = (x) => yc(x) + span(x) * r;
    S.corners = [[xa, yAt(xa) - hAt(xa) / 2], [xb, yAt(xb) - hAt(xb) / 2], [xb, yAt(xb) + hAt(xb) / 2], [xa, yAt(xa) + hAt(xa) / 2]];
  }

  function resetCorners() {
    autoPlace();
    render();
  }
  // placement fourni de l'extérieur (direction artistique), en coordonnées normalisées 0..1
  function setCorners(norm) {
    if (!S || !Array.isArray(norm) || norm.length !== 4) return;
    S.corners = norm.map(([u, v]) => [u * S.photo.width, v * S.photo.height]);
    render();
  }

  function toPhoto(e) {
    const r = $('room-canvas').getBoundingClientRect();
    const { s, ox, oy, dpr } = S.view;
    return [((e.clientX - r.left) * dpr - ox) / s, ((e.clientY - r.top) * dpr - oy) / s];
  }
  function inside(p) {
    const q = S.corners; let ins = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const [xi, yi] = q[i], [xj, yj] = q[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }

  function onDown(e) {
    if (!S) return;
    e.preventDefault();
    $('room-canvas').setPointerCapture(e.pointerId);
    const p = toPhoto(e);
    S.pointers.set(e.pointerId, p);
    if (S.pointers.size === 2) { // pincement : taille
      const [a, b] = [...S.pointers.values()];
      S.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), corners: S.corners.map((c) => c.slice()) };
      S.drag = null;
      return;
    }
    const grab = (10 * S.view.dpr) / S.view.s * 1.6;
    let best = -1, bd = Infinity;
    S.corners.forEach(([x, y], i) => { const d = Math.hypot(x - p[0], y - p[1]); if (d < grab && d < bd) { bd = d; best = i; } });
    if (best >= 0) { S.drag = { mode: 'corner', i: best }; S.active = best; }
    else if (inside(p)) { S.drag = { mode: 'move', from: p, corners: S.corners.map((c) => c.slice()) }; S.active = -1; }
    else S.drag = null;
    render();
  }
  function onMove(e) {
    if (!S) return;
    const p = toPhoto(e);
    if (S.pointers.has(e.pointerId)) S.pointers.set(e.pointerId, p);
    if (S.pinch && S.pointers.size >= 2) {
      const [a, b] = [...S.pointers.values()];
      const k = Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, S.pinch.d);
      const cx = S.pinch.corners.reduce((t, c) => t + c[0], 0) / 4, cy = S.pinch.corners.reduce((t, c) => t + c[1], 0) / 4;
      S.corners = S.pinch.corners.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
      render();
      return;
    }
    if (!S.drag) return;
    if (S.drag.mode === 'corner') S.corners[S.drag.i] = p;
    else {
      const dx = p[0] - S.drag.from[0], dy = p[1] - S.drag.from[1];
      S.corners = S.drag.corners.map(([x, y]) => [x + dx, y + dy]);
    }
    render();
  }
  function onUp(e) {
    if (!S) return;
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.pinch = null;
    S.drag = null;
  }
  function onWheel(e) {
    if (!S) return;
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015);
    const cx = S.corners.reduce((t, c) => t + c[0], 0) / 4, cy = S.corners.reduce((t, c) => t + c[1], 0) / 4;
    S.corners = S.corners.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
    render();
  }

  async function open(opts) {
    const file = opts.file;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); opts.onError && opts.onError(); return; }
    // la photo est ramenée à 2400 px de côté au plus
    const photo = Extract.scaleTo(img, 2400);
    URL.revokeObjectURL(url);
    const art = opts.artwork();
    S = { photo, art, opts, corners: null, active: -1, drag: null, pointers: new Map(), pinch: null, raf: 0, view: null };
    $('room').hidden = false;
    document.body.classList.add('editing');
    $('room-title').textContent = opts.title || tr('Mise en scène');
    requestAnimationFrame(() => { fitView(); resetCorners(); });
  }
  function close() {
    if (!S) return;
    S = null;
    $('room').hidden = true;
    document.body.classList.remove('editing');
  }
  function refreshArt() {
    if (!S) return;
    S.art = S.opts.artwork();
    render();
  }
  async function save() {
    if (!S) return;
    const { photo } = S;
    const c = Extract.makeCanvas(photo.width, photo.height);
    compose(c.getContext('2d'), 1);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    if (blob && S.opts.onSave) await S.opts.onSave(blob, tr('mise-en-scene-atelier-gribouille.jpg'));
  }

  function init() {
    const c = $('room-canvas');
    if (!c) return;
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    $('room-reset').onclick = resetCorners;
    $('room-close').onclick = close;
    $('room-save').onclick = save;
    window.addEventListener('resize', render);
    window.addEventListener('keydown', (e) => { if (S && e.key === 'Escape') close(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.Room = { open, close, refreshArt, setCorners, photoDataUrl: () => (S ? Extract.scaleTo(S.photo, 1000).toDataURL('image/jpeg', 0.8) : null), isOpen: () => !!S };
})();
