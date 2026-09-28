/*
 * Composition du collage.
 * Une composition = { W, H, bg: [calques de fond], items: [découpes] }.
 * Les coordonnées sont en « unités œuvre » (le plus grand côté mesure 2000).
 */
(function () {
  'use strict';

  const UNIT = 2000;
  const KID_PALETTE = ['#f2c14e', '#e4572e', '#29a19c', '#3b5bdb', '#8cc63f', '#f78fb3', '#7b4bb7', '#ff8c42'];

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, R) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

  // Contour de papier déchiré autour d'un rectangle centré.
  function tornPolygon(w, h, R, jit) {
    const pts = [];
    const step = Math.max(10, Math.min(w, h) / 9);
    const edge = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.round(len / step));
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const j = (R() - 0.5) * 2 * jit;
        pts.push([x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j]);
      }
    };
    const a = -w / 2, b = -h / 2;
    edge(a, b, -a, b);
    edge(-a, b, -a, -b);
    edge(-a, -b, a, -b);
    edge(a, -b, a, b);
    return pts;
  }

  // Recadrage aléatoire d'une texture ayant le ratio w/h.
  function cropFor(src, w, h, R) {
    const ar = w / h;
    const maxW = Math.min(src.width, src.height * ar);
    // les grands aplats gardent toute la page pour rester nets à l'impression
    const f = w > UNIT * 0.4 ? 1 : 0.55 + 0.45 * R();
    const sw = maxW * f, sh = sw / ar;
    return { sx: R() * (src.width - sw), sy: R() * (src.height - sh), sw, sh };
  }

  function bgLayer(tex, x, y, w, h, rot, R, jit) {
    return Object.assign(
      { kind: 'bg', src: tex.canvas, x: x + w / 2, y: y + h / 2, w, h, rot, flip: false, clip: jit ? tornPolygon(w, h, R, jit) : null },
      cropFor(tex.canvas, w, h, R)
    );
  }

  // Texture « gouache » générée quand on n'a aucune page peinte.
  function paintedTexture(colors, R) {
    const c = Extract.makeCanvas(900, 650);
    const ctx = c.getContext('2d');
    ctx.fillStyle = colors[Math.floor(R() * colors.length)];
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = colors[Math.floor(R() * colors.length)];
      ctx.globalAlpha = 0.35 + R() * 0.5;
      ctx.lineWidth = 12 + R() * 50;
      ctx.beginPath();
      let x = R() * c.width, y = R() * c.height;
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        const nx = x + (R() - 0.5) * 400, ny = y + (R() - 0.5) * 200;
        ctx.quadraticCurveTo(x + (R() - 0.5) * 300, y + (R() - 0.5) * 300, nx, ny);
        x = nx; y = ny;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const color = Extract.averageColor(c);
    return { canvas: c, color, lum: Extract.lum(color), colorful: 0.5 };
  }

  function paperTexture() {
    const c = Extract.makeCanvas(1024, 1024);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    const R = rng(7);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (R() - 0.5) * 14;
      img.data[i] = 246 + n; img.data[i + 1] = 241 + n; img.data[i + 2] = 231 + n; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: c, color: [246, 241, 231], lum: 240 };
  }

  function palette(pieces) {
    const cols = pieces
      .filter((p) => p.colorful > 0.25)
      .map((p) => rgb(p.color));
    return cols.length >= 3 ? cols : KID_PALETTE;
  }

  function score(t) {
    return (t.colorful || 0.3) * (t.lum > 215 ? 0.3 : 1);
  }

  // Fond façon « paysage » comme l'œuvre d'exemple : bande de ciel, milieu, sol.
  function bandsLayout(W, H, texs, R, out) {
    const byLight = texs.slice().sort((a, b) => b.lum - a.lum);
    const h1 = H * (0.2 + R() * 0.08);
    const h3 = H * (0.16 + R() * 0.08);
    const midH = H - h1 - h3;
    const jit = W * 0.006;
    // la base du milieu : une page colorée plutôt qu'une page presque blanche
    const mids = shuffle(texs, R).sort((a, b) => score(b) - score(a));

    out.push(bgLayer(mids[0], -W * 0.03, h1 - H * 0.06, W * 1.06, midH + H * 0.12, 0, R, jit));

    // fragments de papier peint froissés dans la zone du milieu
    const nf = 14 + Math.floor(R() * 12);
    for (let i = 0; i < nf; i++) {
      const fw = W * (0.04 + R() * 0.08);
      const fh = fw * (0.45 + R() * 0.8);
      out.push(bgLayer(mids[(i + 1) % mids.length], R() * (W - fw), h1 + R() * (midH - fh), fw, fh, (R() - 0.5) * 1.4, R, fw * 0.07));
    }

    // grands aplats sur les côtés
    const ns = 1 + Math.floor(R() * 2);
    for (let i = 0; i < ns; i++) {
      const pw = W * (0.14 + R() * 0.1), ph = midH * (0.55 + R() * 0.35);
      const left = (i + Math.floor(R() * 2)) % 2 === 0;
      const x = left ? -pw * 0.1 : W - pw * 0.9;
      out.push(bgLayer(mids[(i + 2) % mids.length], x, h1 + R() * (midH - ph), pw, ph, (R() - 0.5) * 0.06, R, jit));
    }

    const row = (y0, hh, pool, extendUp) => {
      const n = 3 + Math.floor(R() * 3);
      const ws = Array.from({ length: n }, () => 0.5 + R());
      const sum = ws.reduce((a, b) => a + b, 0);
      let x = -W * 0.015;
      const order = shuffle(pool, R);
      ws.forEach((wi, i) => {
        const w = (W * 1.03 * wi) / sum;
        const y = extendUp ? y0 - H * 0.03 : y0;
        out.push(bgLayer(order[i % order.length], x - W * 0.006, y, w + W * 0.012, hh + H * 0.03, (R() - 0.5) * 0.015, R, jit));
        x += w;
      });
    };
    const half = Math.max(1, Math.ceil(byLight.length / 2));
    row(0, h1, byLight.slice(0, half), true);
    row(H - h3, h3, byLight.slice(byLight.length - half), false);
  }

  // Fond en mosaïque de papiers déchirés.
  function mosaicLayout(W, H, texs, R, out) {
    const target = clamp(texs.length * 2, 7, 16);
    let rects = [{ x: 0, y: 0, w: W, h: H }];
    while (rects.length < target) {
      rects.sort((a, b) => b.w * b.h - a.w * a.h);
      const r = rects.shift();
      const t = 0.35 + R() * 0.3;
      if (r.w > r.h) rects.push({ x: r.x, y: r.y, w: r.w * t, h: r.h }, { x: r.x + r.w * t, y: r.y, w: r.w * (1 - t), h: r.h });
      else rects.push({ x: r.x, y: r.y, w: r.w, h: r.h * t }, { x: r.x, y: r.y + r.h * t, w: r.w, h: r.h * (1 - t) });
    }
    const order = shuffle(texs, R);
    shuffle(rects, R).forEach((r, i) => {
      const e = W * 0.008;
      out.push(bgLayer(order[i % order.length], r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, (R() - 0.5) * 0.02, R, W * 0.005));
    });
  }

  // Place les découpes en évitant qu'elles se recouvrent trop.
  function placePieces(W, H, pieces, o, R) {
    const A = W * H;
    const cover = 0.5 * o.density;
    const weights = pieces.map((p) => Math.sqrt(p.frac));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const G = 40, cell = W / G, rows = Math.max(1, Math.round(H / cell));
    const occ = new Float32Array(G * rows);
    const cells = (cx, cy, w, h, fn) => {
      const gx0 = clamp(Math.floor((cx - w / 2) / cell), 0, G - 1), gx1 = clamp(Math.floor((cx + w / 2) / cell), 0, G - 1);
      const gy0 = clamp(Math.floor((cy - h / 2) / cell), 0, rows - 1), gy1 = clamp(Math.floor((cy + h / 2) / cell), 0, rows - 1);
      for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) fn(y * G + x);
    };
    const items = pieces
      .map((p, i) => ({ p, a: clamp((cover * A * weights[i]) / sum, A * 0.004, A * 0.1) }))
      .sort((a, b) => b.a - a.a);
    const maxRot = (o.rotation * Math.PI) / 180;
    return items.map(({ p, a }) => {
      const ar = p.canvas.width / p.canvas.height;
      const h = Math.sqrt(a / ar), w = h * ar;
      let best = null;
      for (let c = 0; c < 60; c++) {
        const cx = w * 0.4 + R() * Math.max(1, W - w * 0.8);
        const cy = h * 0.4 + R() * Math.max(1, H - h * 0.8);
        let s = 0, n = 0;
        cells(cx, cy, w * 0.7, h * 0.7, (k) => { s += occ[k]; n++; });
        const score = s / Math.max(1, n) + R() * 0.08;
        if (!best || score < best.score) best = { cx, cy, score };
      }
      cells(best.cx, best.cy, w * 0.75, h * 0.75, (k) => { occ[k] += 1; });
      return { kind: 'piece', piece: p, x: best.cx, y: best.cy, w, h, rot: (R() - 0.5) * 2 * maxRot, flip: false };
    });
  }

  function generate(o) {
    const u = UNIT / Math.max(o.format.w, o.format.h);
    const W = Math.round(o.format.w * u), H = Math.round(o.format.h * u);
    const R = rng(o.seed);
    const bg = [];
    let texs = o.textures.slice();
    if (o.bgMode === 'paper') {
      const t = paperTexture();
      bg.push({ kind: 'bg', src: t.canvas, x: W / 2, y: H / 2, w: W, h: H, rot: 0, flip: false, clip: null, sx: 0, sy: 0, sw: t.canvas.width, sh: t.canvas.height });
    } else {
      if (texs.length < 3) {
        const cols = palette(o.pieces);
        while (texs.length < 3) texs.push(paintedTexture(cols, R));
      }
      if (o.bgMode === 'mosaic') mosaicLayout(W, H, texs, R, bg);
      else bandsLayout(W, H, texs, R, bg);
    }
    const items = placePieces(W, H, o.pieces, o, R);
    return { W, H, bg, items };
  }

  // Ajoute une découpe au hasard dans une composition existante.
  function addPiece(comp, piece, seed) {
    const R = rng(seed);
    const a = comp.W * comp.H * clamp(Math.sqrt(piece.frac) * 0.1, 0.01, 0.06);
    const ar = piece.canvas.width / piece.canvas.height;
    const h = Math.sqrt(a / ar), w = h * ar;
    const item = { kind: 'piece', piece, x: comp.W * (0.2 + R() * 0.6), y: comp.H * (0.2 + R() * 0.6), w, h, rot: (R() - 0.5) * 0.3, flip: false };
    comp.items.push(item);
    return item;
  }

  function drawLayer(ctx, L, s, shadows) {
    ctx.save();
    ctx.translate(L.x * s, L.y * s);
    ctx.rotate(L.rot);
    if (L.flip) ctx.scale(-1, 1);
    const w = L.w * s, h = L.h * s;
    if (L.clip) {
      ctx.beginPath();
      L.clip.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
      ctx.closePath();
      if (shadows) {
        ctx.save();
        ctx.shadowColor = 'rgba(40,25,10,0.28)';
        ctx.shadowBlur = 5 * s;
        ctx.shadowOffsetY = 1.5 * s;
        ctx.fillStyle = '#ddd';
        ctx.fill();
        ctx.restore();
      }
      ctx.clip();
    }
    if (L.kind === 'piece') {
      if (shadows) {
        ctx.shadowColor = 'rgba(40,25,10,0.38)';
        ctx.shadowBlur = 9 * s;
        ctx.shadowOffsetX = 2 * s;
        ctx.shadowOffsetY = 4 * s;
      }
      ctx.drawImage(L.piece.canvas, -w / 2, -h / 2, w, h);
    } else {
      ctx.drawImage(L.src, L.sx, L.sy, L.sw, L.sh, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }

  function renderBg(ctx, comp, s, shadows) {
    ctx.fillStyle = '#f6f1e7';
    ctx.fillRect(0, 0, comp.W * s, comp.H * s);
    comp.bg.forEach((L) => drawLayer(ctx, L, s, shadows));
  }

  function renderItems(ctx, comp, s, shadows) {
    comp.items.forEach((L) => drawLayer(ctx, L, s, shadows));
  }

  // Test de clic sur une découpe (coordonnées œuvre), en tenant compte de sa forme.
  function hitItem(L, X, Y) {
    const dx = X - L.x, dy = Y - L.y;
    const c = Math.cos(L.rot), sn = Math.sin(L.rot);
    let lx = dx * c + dy * sn;
    const ly = -dx * sn + dy * c;
    if (L.flip) lx = -lx;
    const u = lx / L.w + 0.5, v = ly / L.h + 0.5;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    const hm = L.piece.hit;
    return hm.data[Math.floor(v * hm.h) * hm.w + Math.floor(u * hm.w)] === 1;
  }

  window.Compose = { generate, addPiece, renderBg, renderItems, drawLayer, hitItem, rng };
})();
