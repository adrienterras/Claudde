/*
 * Composition du collage.
 * Toutes les dimensions sont en centimètres sur l'œuvre finale.
 * Chaque dessin arrive déjà à sa taille réelle multipliée par une échelle unique
 * (wcm / hcm) : la composition ne l'agrandit ni ne le réduit jamais,
 * elle se contente de recadrer les pages de fond et de placer les découpes.
 *
 * Une composition = { W, H, bg: [calques de fond], items: [découpes], grain }.
 */
(function () {
  'use strict';

  const KID_PALETTE = ['#f2c14e', '#e4572e', '#29a19c', '#3b5bdb', '#8cc63f', '#f78fb3', '#7b4bb7', '#ff8c42'];
  const TEAR = 0.25; // amplitude des bords déchirés, en cm

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

  function hue(c) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return 0;
    let h;
    if (mx === r) h = ((g - b) / (mx - mn)) % 6;
    else if (mx === g) h = (b - r) / (mx - mn) + 2;
    else h = (r - g) / (mx - mn) + 4;
    return (h * 60 + 360) % 360;
  }

  // Contour de papier déchiré ; `edges` indique quels côtés sont déchirés (les autres restent droits).
  function tornPolygon(w, h, R, jit, edges) {
    edges = edges || { t: 1, r: 1, b: 1, l: 1 };
    const pts = [];
    const step = Math.max(0.6, Math.min(w, h) / 10);
    const edge = (x0, y0, x1, y1, torn) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = torn ? Math.max(1, Math.round(len / step)) : 1;
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const j = torn && i > 0 ? (R() - 0.5) * 2 * jit : 0;
        pts.push([x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j]);
      }
    };
    const a = -w / 2, b = -h / 2;
    edge(a, b, -a, b, edges.t);
    edge(-a, b, -a, -b, edges.r);
    edge(-a, -b, a, -b, edges.b);
    edge(a, -b, a, b, edges.l);
    return pts;
  }

  /*
   * Un morceau de page de fond : on découpe dans la page (à l'échelle) un rectangle
   * d'au plus w × h cm. Jamais d'agrandissement : si la page est plus petite, le morceau aussi.
   */
  function tile(tex, x, y, w, h, rot, R, edges) {
    const k = tex.canvas.width / tex.wcm; // pixels par cm sur l'œuvre
    const sw = Math.min(tex.canvas.width, w * k), sh = Math.min(tex.canvas.height, h * k);
    const tw = sw / k, th = sh / k;
    return {
      kind: 'bg', src: tex.canvas,
      sx: R() * (tex.canvas.width - sw), sy: R() * (tex.canvas.height - sh), sw, sh,
      x: x + tw / 2, y: y + th / 2, w: tw, h: th, rot, flip: false,
      clip: edges === null ? null : tornPolygon(tw, th, R, TEAR, edges),
    };
  }

  // Texture « gouache » générée si l'on n'a pas assez de pages peintes.
  function paintedTexture(colors, R, scale) {
    const c = Extract.makeCanvas(900, 640);
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
    // une feuille A4 paysage, à la même échelle que les vrais dessins
    return { canvas: c, color, lum: Extract.lum(color), colorful: 0.5, wcm: 29.7 * scale, hcm: 21 * scale };
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
    return c;
  }

  function palette(pieces) {
    const cols = pieces.filter((p) => p.colorful > 0.25).map((p) => rgb(p.color));
    return cols.length >= 3 ? cols : KID_PALETTE;
  }

  // « Ciel » : clair et froid. « Terre » : sombre et chaud.
  const skyness = (t) => t.lum / 255 + (t.color[2] - t.color[0]) / 255;
  const earthiness = (t) => (255 - t.lum) / 255 + (t.color[0] - t.color[2]) / 255;

  function saturate(c, f) {
    const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    return c.map((v) => clamp(l + (v - l) * f, 0, 255));
  }

  const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] * (1 - t) + b[i] * t);
  const avg = (list, fallback) => (list.length ? [0, 1, 2].map((i) => list.reduce((s, t) => s + t.color[i], 0) / list.length) : fallback);

  /*
   * Fond peint : un lavis de gouache qui passe du ciel à l'ocre puis à la terre,
   * avec des coups de pinceau visibles. Ses couleurs viennent des dessins eux-mêmes,
   * pour que l'ensemble reste harmonieux. Il sert de liant entre les pages collées.
   */
  function paintedGround(W, H, zones, R) {
    const k = Math.min(14, 2000 / W); // pixels par cm
    const c = Extract.makeCanvas(W * k, H * k);
    const ctx = c.getContext('2d');
    const { horizon, ground, sky, mid, earth } = zones;
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    const soft = 3 / H;
    g.addColorStop(0, rgb(mix(sky, [255, 255, 255], 0.15)));
    g.addColorStop(clamp(horizon / H - soft, 0, 1), rgb(sky));
    g.addColorStop(clamp(horizon / H + soft, 0, 1), rgb(mid));
    g.addColorStop(clamp(ground / H - soft, 0, 1), rgb(mix(mid, earth, 0.25)));
    g.addColorStop(clamp(ground / H + soft, 0, 1), rgb(earth));
    g.addColorStop(1, rgb(mix(earth, [0, 0, 0], 0.15)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);

    // coups de pinceau : chaque trait est un faisceau de poils
    const zoneColor = (y) => (y < horizon ? sky : y < ground ? mid : earth);
    ctx.lineCap = 'round';
    const n = Math.round((W * H) / 10);
    for (let i = 0; i < n; i++) {
      const x = R() * W, y = R() * H;
      const base = zoneColor(y);
      const shade = (R() - 0.5) * 0.3;
      const col = shade > 0 ? mix(base, [255, 255, 255], shade) : mix(base, [0, 0, 0], -shade * 0.8);
      const len = 4 + R() * 14, ang = (R() - 0.5) * 0.5, width = 0.8 + R() * 2.2;
      const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
      const bend = (R() - 0.5) * 3;
      const hairs = 5 + Math.floor(R() * 5);
      for (let hIdx = 0; hIdx < hairs; hIdx++) {
        const off = (hIdx / hairs - 0.5) * width;
        const ox = -Math.sin(ang) * off, oy = Math.cos(ang) * off;
        ctx.strokeStyle = rgb(col);
        ctx.globalAlpha = 0.12 + R() * 0.2;
        ctx.lineWidth = (0.15 + R() * 0.35) * k;
        ctx.beginPath();
        ctx.moveTo((x + ox) * k, (y + oy) * k);
        ctx.quadraticCurveTo((x + ox + dx / 2) * k, (y + oy + dy / 2 + bend) * k, (x + ox + dx * (0.7 + R() * 0.3)) * k, (y + oy + dy) * k);
        ctx.stroke();
      }
    }
    // quelques grands gestes de couleur, pris dans la palette des dessins
    (zones.accents || []).length && (() => {
      const acc = zones.accents;
      const m = 10 + Math.floor(R() * 8);
      for (let i = 0; i < m; i++) {
        ctx.strokeStyle = acc[Math.floor(R() * acc.length)];
        ctx.globalAlpha = 0.12 + R() * 0.14;
        ctx.lineWidth = (0.6 + R() * 1.6) * k;
        let x = R() * W, y = zones.horizon + R() * (zones.ground - zones.horizon);
        ctx.beginPath();
        ctx.moveTo(x * k, y * k);
        for (let j = 0; j < 3; j++) {
          const nx = x + (R() - 0.5) * 30, ny = y + (R() - 0.5) * 10;
          ctx.quadraticCurveTo((x + (R() - 0.5) * 20) * k, (y + (R() - 0.5) * 14) * k, nx * k, ny * k);
          x = nx; y = ny;
        }
        ctx.stroke();
      }
    })();
    ctx.globalAlpha = 1;
    return { kind: 'bg', src: c, x: W / 2, y: H / 2, w: W, h: H, rot: 0, flip: false, clip: null, sx: 0, sy: 0, sw: c.width, sh: c.height };
  }

  /*
   * Pages collées contre un bord (haut ou bas), en partant des deux coins vers le centre.
   * Chaque page n'est utilisée qu'une fois ; on laisse respirer le centre.
   */
  function edgeRow(W, H, pages, R, anchor, maxH, out) {
    let left = -0.5, right = W + 0.5, side = R() < 0.5 ? 0 : 1;
    const rest = [];
    pages.forEach((t) => {
      const w = t.wcm * (0.8 + 0.2 * R());
      const h = Math.min(t.hcm, maxH + 0.5);
      if (right - left - w < W * 0.18) { rest.push(t); return; }
      const x = side === 0 ? left : right - w;
      const y = anchor === 'top' ? -0.5 : H + 0.5 - h;
      const edges = anchor === 'top' ? { b: 1, l: side, r: 1 - side } : { t: 1, l: side, r: 1 - side };
      const L = tile(t, x, y, w, h, 0, R, edges);
      if (side === 0) left += L.w - 0.3; else right -= L.w - 0.3;
      out.push(L);
      side = 1 - side;
    });
    return rest;
  }

  // Pages du milieu : grands papiers déchirés légèrement inclinés, répartis sans s'empiler.
  function midPanels(W, H, pages, zones, R, out) {
    const placed = [];
    pages.forEach((t, i) => {
      const w = t.wcm * (0.75 + 0.25 * R()), h = Math.min(t.hcm, (zones.ground - zones.horizon) * 0.95);
      let best = null;
      for (let c = 0; c < 40; c++) {
        // de préférence contre les bords gauche/droit, comme des pans de décor
        const edge = i < 2 && c < 20;
        const x = edge ? (i % 2 === 0 ? -w * 0.1 : W - w * 0.9) : R() * (W - w);
        const y = zones.horizon - 1 + R() * Math.max(0, zones.ground - zones.horizon - h + 2);
        let score = 0;
        placed.forEach((q) => {
          const ox = Math.max(0, Math.min(x + w, q.x + q.w) - Math.max(x, q.x));
          const oy = Math.max(0, Math.min(y + h, q.y + q.h) - Math.max(y, q.y));
          score += (ox * oy) / (w * h);
        });
        score += R() * 0.05;
        if (!best || score < best.score) best = { x, y, score };
      }
      placed.push({ x: best.x, y: best.y, w, h });
      out.push(tile(t, best.x, best.y, w, h, (R() - 0.5) * 0.1, R));
    });
  }

  // Petits lambeaux de papier peint froissés (ce sont des recadrages, jamais des agrandissements).
  function scraps(W, zones, texs, R, out) {
    const n = 8 + Math.floor(R() * 6);
    for (let i = 0; i < n; i++) {
      const t = texs[Math.floor(R() * texs.length)];
      const fw = 2.5 + R() * 5, fh = fw * (0.5 + R() * 0.7);
      const y = zones.horizon + R() * Math.max(1, zones.ground - zones.horizon - fh);
      out.push(tile(t, R() * (W - fw), y, fw, fh, (R() - 0.5) * 1.4, R));
    }
  }

  function landscape(W, H, texs, R, out, o) {
    const bySky = texs.slice().sort((a, b) => skyness(b) - skyness(a));
    const n = texs.length;
    const nSky = n >= 3 ? Math.max(1, Math.round(n * 0.3)) : Math.min(1, n);
    const sky = bySky.slice(0, nSky);
    const earth = texs.filter((t) => !sky.includes(t)).sort((a, b) => earthiness(b) - earthiness(a)).slice(0, Math.max(n >= 3 ? 1 : 0, Math.round(n * 0.3)));
    const middle = texs.filter((t) => !sky.includes(t) && !earth.includes(t));

    const median = (l) => { const v = l.map((t) => t.hcm).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
    const horizon = clamp(median(sky) * 0.95 || H * 0.24, H * 0.15, H * 0.32);
    const ground = H - clamp(median(earth) * 0.85 || H * 0.2, H * 0.12, H * 0.26);
    const zones = {
      horizon, ground,
      sky: mix(saturate(avg(sky, [170, 205, 235]), 1.5), [196, 224, 246], 0.55),
      mid: mix(saturate(avg(middle, [232, 200, 140]), 1.5), [238, 202, 132], 0.55),
      earth: mix(saturate(avg(earth, [130, 85, 50]), 1.4), [128, 72, 40], 0.5),
      accents: o.accents,
    };

    out.push(paintedGround(W, H, zones, R));
    const extraSky = edgeRow(W, H, sky, R, 'top', horizon, out);
    const extraEarth = edgeRow(W, H, earth, R, 'bottom', H - ground, out);
    midPanels(W, H, middle.concat(extraSky, extraEarth), zones, R, out);
    if (texs.length) scraps(W, zones, texs, R, out);
    return zones;
  }

  // Mosaïque : chaque page une seule fois, épinglée en grille lâche sur un fond peint neutre.
  function mosaic(W, H, texs, R, out) {
    const zones = { horizon: H * 0.5, ground: H * 1.01, sky: [236, 228, 214], mid: [236, 228, 214], earth: [236, 228, 214] };
    out.push(paintedGround(W, H, zones, R));
    const order = shuffle(texs, R);
    const cols = Math.max(1, Math.round(Math.sqrt((order.length * W) / H)));
    const rows = Math.max(1, Math.ceil(order.length / cols));
    order.forEach((t, i) => {
      const cx = ((i % cols) + 0.5) * (W / cols) + (R() - 0.5) * (W / cols) * 0.3;
      const cy = (Math.floor(i / cols) + 0.5) * (H / rows) + (R() - 0.5) * (H / rows) * 0.3;
      out.push(tile(t, cx - t.wcm / 2, cy - t.hcm / 2, t.wcm, t.hcm, (R() - 0.5) * 0.12, R));
    });
    return { horizon: H * 0.3, ground: H * 0.85 };
  }

  // ---------- Placement des découpes ----------

  /*
   * Règles de composition utilisées :
   *  - les sujets « posés » (base large : maison, chapiteau, bougie…) reposent sur une ligne de sol,
   *    les autres (cœurs, étoiles, soleils…) flottent dans le ciel et le milieu ;
   *  - le sujet principal va sur un point fort (règle des tiers), les suivants sur les autres ;
   *  - équilibre des masses visuelles autour du centre ;
   *  - deux sujets voisins de même couleur sont évités ;
   *  - chevauchements limités ; ce qui ne trouve pas de place à l'échelle choisie est laissé de côté ;
   *  - profondeur : ce qui est plus bas passe devant.
   */
  function placePieces(W, H, pieces, o, lines, R) {
    const gw = Math.ceil(W), gh = Math.ceil(H); // grille d'occupation au centimètre
    const occ = new Uint8Array(gw * gh);
    const target = clamp(0.4 * o.density, 0.15, 0.7) * gw * gh;
    let covered = 0;
    const thirds = [[W / 3, H / 3], [(2 * W) / 3, H / 3], [W / 3, (2 * H) / 3], [(2 * W) / 3, (2 * H) / 3]];
    const usedThirds = new Set();
    const placed = [];
    let mass = 0, mx = 0, my = 0;
    const maxRot = (o.rotation * Math.PI) / 180;

    const importance = (p) => Math.sqrt(p.wcm * p.hcm) * Math.pow(p.colorful, 1.3);
    const sorted = pieces.slice().sort((a, b) => importance(b) - importance(a));
    const groundLines = [lines.ground + (H - lines.ground) * 0.6, lines.ground + 0.6, lines.horizon + (lines.ground - lines.horizon) * 0.62];

    // parcourt les cellules couvertes par la forme d'une pièce centrée en (cx, cy)
    function footprint(p, cx, cy, fn) {
      const x0 = cx - p.wcm / 2, y0 = cy - p.hcm / 2;
      const hm = p.hit;
      for (let gy = Math.floor(y0); gy <= Math.floor(y0 + p.hcm); gy++) {
        const v = (gy + 0.5 - y0) / p.hcm;
        if (v < 0 || v >= 1) continue;
        for (let gx = Math.floor(x0); gx <= Math.floor(x0 + p.wcm); gx++) {
          const u = (gx + 0.5 - x0) / p.wcm;
          if (u < 0 || u >= 1) continue;
          if (!hm.data[Math.floor(v * hm.h) * hm.w + Math.floor(u * hm.w)]) continue;
          fn(gx, gy);
        }
      }
    }

    sorted.forEach((p, rankIdx) => {
      p.placed = false;
      if (covered >= target) return;
      const grounded = p.base > 0.55 && p.hcm > 3;
      const pHue = hue(p.color);
      const w8 = p.wcm * p.hcm * (0.3 + p.colorful);
      let best = null;
      for (let c = 0; c < 90; c++) {
        let cx = p.wcm * 0.3 + R() * (W - p.wcm * 0.6);
        let cy;
        if (grounded) {
          const line = groundLines[Math.floor(R() * groundLines.length)];
          cy = line + (R() - 0.5) * 1.5 - p.hcm / 2;
        } else {
          cy = p.hcm * 0.35 + R() * Math.max(1, lines.ground - p.hcm * 0.35);
        }
        if (rankIdx < 4 && c < 30) {
          // les sujets principaux essaient d'abord les points forts
          const [tx, ty] = thirds[c % 4];
          cx = tx + (R() - 0.5) * W * 0.08;
          if (!grounded) cy = ty + (R() - 0.5) * H * 0.08;
        }
        let cells = 0, over = 0, out = 0;
        footprint(p, cx, cy, (gx, gy) => {
          cells++;
          if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) out++;
          else if (occ[gy * gw + gx]) over++;
        });
        if (!cells) continue;
        const overlap = over / cells, outside = out / cells;
        if (overlap > 0.3 || outside > 0.15) continue;
        let score = overlap * 3 + outside * 4;
        // équilibre des masses
        const nm = mass + w8;
        const bx = (mx + cx * w8) / nm, by = (my + cy * w8) / nm;
        score += Math.hypot((bx - W / 2) / W, (by - H / 2) / H) * (placed.length > 3 ? 2 : 0.5);
        // pas deux voisins de la même couleur
        for (const q of placed) {
          const d = Math.hypot(q.x - cx, q.y - cy);
          if (d < (Math.max(p.wcm, p.hcm) + Math.max(q.w, q.h)) * 0.7 && p.colorful > 0.2 && q.piece.colorful > 0.2) {
            const dh = Math.abs(pHue - hue(q.piece.color));
            if (Math.min(dh, 360 - dh) < 35) score += 0.35;
          }
        }
        // point fort pour les sujets principaux
        if (rankIdx < 4) {
          let dmin = Infinity;
          thirds.forEach(([tx, ty], i) => { if (!usedThirds.has(i)) dmin = Math.min(dmin, Math.hypot(tx - cx, (ty - cy) * (grounded ? 0.3 : 1))); });
          if (dmin < Infinity) score += (dmin / W) * 2.5;
        }
        // aller vers les zones encore vides pour répartir les sujets sur toute l'œuvre
        let near = Infinity;
        for (const q of placed) near = Math.min(near, Math.hypot(q.x - cx, q.y - cy));
        if (near < Infinity) score -= Math.min(near / (W * 0.25), 1) * 0.6;
        score += R() * 0.05;
        if (!best || score < best.score) best = { cx, cy, score, grounded };
      }
      if (!best) return;
      footprint(p, best.cx, best.cy, (gx, gy) => {
        if (gx >= 0 && gy >= 0 && gx < gw && gy < gh && !occ[gy * gw + gx]) { occ[gy * gw + gx] = 1; covered++; }
      });
      if (rankIdx < 4) {
        let bi = -1, bd = Infinity;
        thirds.forEach(([tx, ty], i) => { const d = Math.hypot(tx - best.cx, ty - best.cy); if (!usedThirds.has(i) && d < bd) { bd = d; bi = i; } });
        if (bi >= 0 && bd < W * 0.15) usedThirds.add(bi);
      }
      mass += w8; mx += best.cx * w8; my += best.cy * w8;
      p.placed = true;
      const rot = (R() - 0.5) * 2 * (best.grounded ? Math.min(maxRot, 0.05) : maxRot);
      placed.push({ kind: 'piece', piece: p, x: best.cx, y: best.cy, w: p.wcm, h: p.hcm, rot, flip: false, grounded: best.grounded });
    });

    // profondeur : ce qui est posé plus bas passe devant ; les petits éléments flottants au-dessus
    const grounded = placed.filter((L) => L.grounded).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
    const floating = placed.filter((L) => !L.grounded).sort((a, b) => b.w * b.h - a.w * a.h);
    return grounded.concat(floating);
  }

  function generate(o) {
    const W = o.format.w, H = o.format.h;
    const R = rng(o.seed);
    const bg = [];
    let lines = { horizon: H * 0.25, ground: H * 0.8 };
    const texs = o.textures.slice();
    if (o.bgMode === 'paper') {
      const c = paperTexture();
      bg.push({ kind: 'bg', src: c, x: W / 2, y: H / 2, w: W, h: H, rot: 0, flip: false, clip: null, sx: 0, sy: 0, sw: c.width, sh: c.height });
    } else {
      if (!texs.length) {
        const cols = palette(o.pieces);
        for (let i = 0; i < 3; i++) texs.push(paintedTexture(cols, R, o.scale));
      }
      lines = o.bgMode === 'mosaic' ? mosaic(W, H, texs, R, bg) : landscape(W, H, texs, R, bg, { accents: palette(o.pieces) });
    }
    const items = placePieces(W, H, o.pieces, o, lines, R);
    return { W, H, bg, items, grain: o.grain };
  }

  // Ajoute une découpe (à l'échelle) dans une composition existante.
  function addPiece(comp, piece, seed) {
    const R = rng(seed);
    const item = { kind: 'piece', piece, x: comp.W * (0.25 + R() * 0.5), y: comp.H * (0.25 + R() * 0.5), w: piece.wcm, h: piece.hcm, rot: (R() - 0.5) * 0.2, flip: false };
    comp.items.push(item);
    piece.placed = true;
    return item;
  }

  // ---------- Rendu ----------

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
        ctx.shadowBlur = 0.25 * s;
        ctx.shadowOffsetY = 0.07 * s;
        ctx.fillStyle = '#ddd';
        ctx.fill();
        ctx.restore();
      }
      ctx.clip();
    }
    if (L.kind === 'piece') {
      if (shadows) {
        ctx.shadowColor = 'rgba(40,25,10,0.38)';
        ctx.shadowBlur = 0.4 * s;
        ctx.shadowOffsetX = 0.08 * s;
        ctx.shadowOffsetY = 0.18 * s;
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

  // Finition : grain de toile et léger vignettage, pour unifier le tout comme une œuvre.
  let grainTile = null;
  function renderFinish(ctx, comp, s) {
    if (!comp.grain) return;
    const w = comp.W * s, h = comp.H * s;
    if (!grainTile) {
      grainTile = Extract.makeCanvas(256, 256);
      const g = grainTile.getContext('2d');
      const img = g.createImageData(256, 256);
      const R = rng(11);
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const i = (y * 256 + x) * 4;
          const weave = ((x % 4 < 2) !== (y % 4 < 2)) ? 12 : 0; // trame de toile
          const v = 128 + (R() - 0.5) * 50 + weave;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.14;
    const pat = ctx.createPattern(grainTile, 'repeat');
    // la trame garde la même taille physique quelle que soit la résolution
    pat.setTransform(new DOMMatrix().scale(Math.max(0.2, s / 60)));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(225,210,190,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Test de clic sur une découpe (coordonnées en cm), en tenant compte de sa forme.
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

  window.Compose = { generate, addPiece, renderBg, renderItems, renderFinish, drawLayer, hitItem, rng };
})();
