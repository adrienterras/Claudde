/*
 * Composition du collage.
 * L'œuvre n'est faite QUE des dessins, et utilise TOUS les dessins.
 * Toutes les dimensions sont en centimètres sur l'œuvre finale.
 * Chaque dessin arrive déjà à sa taille réelle multipliée par une échelle unique
 * (wcm / hcm) : la composition ne l'agrandit ni ne le réduit jamais,
 * elle se contente de recadrer les pages de fond et de placer les découpes.
 *
 * Une composition = { W, H, bg: [calques de fond], items: [découpes], grain }.
 */
(function () {
  'use strict';

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

  /*
   * Zones de la scène (paysage) : ciel en haut, milieu, sol en bas.
   * En mode « mosaïque libre », une seule zone : toute la toile.
   */
  function zonesFor(W, H, useZones) {
    if (!useZones) return { ciel: [0, H], milieu: [0, H], sol: [0, H], horizon: H * 0.3, ground: H * 0.72 };
    const horizon = H * 0.3, ground = H * 0.72;
    return { ciel: [0, horizon], milieu: [horizon, ground], sol: [ground, H], horizon, ground };
  }

  /*
   * Spirale du tournesol (phyllotaxie) : l'élément n° i sur n est posé à l'angle d'or i × 137,5°,
   * à une distance du centre en √i. Le premier élément est au cœur.
   */
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  function spiralPoint(W, H, i, n, reach) {
    const t = Math.sqrt((i + 0.5) / Math.max(1, n)) * (reach || 1);
    const a = i * GOLDEN;
    // légère inclinaison dans le sens de la rotation, pour l'effet de tourbillon
    let tan = ((a + Math.PI / 2) % Math.PI) - Math.PI / 2;
    tan = clamp(tan, -1.2, 1.2) * 0.3 * t;
    return { x: W / 2 + W * 0.47 * t * Math.cos(a), y: H / 2 + H * 0.47 * t * Math.sin(a), rot: tan, r: t, a };
  }

  /*
   * Tournesol : le fond en couronne de pétales. Chaque page de fond est tournée pour pointer vers le
   * centre (son grand côté dans l'axe du rayon) et posée en anneau, se chevauchant comme des pétales ;
   * les plus chaudes et saturées près du cœur, les plus claires à l'extérieur, jusqu'à déborder des bords.
   */
  function backgroundPetals(W, H, texs, R, out) {
    const cov = Coverage(W, H);
    const warmth = (t) => (t.colorful || 0) * 0.7 + (t.color[0] - t.color[2]) / 255 * 0.3 - t.lum / 255 * 0.4;
    const pages = texs.slice().sort((a, b) => warmth(a) - warmth(b)); // les plus claires d'abord (dessous, dehors)
    const cx0 = W / 2, cy0 = H / 2;
    const n = pages.length;
    const rings = n > 8 ? 2 : 1;
    const panels = [], scrapPool = [];
    pages.forEach((t, i) => {
      const cut = tearPage(t, R, W, H);
      const k = cut.k;
      const w = cut.panel.w / k, h = cut.panel.h / k;
      const ring = rings === 2 && i >= Math.ceil(n / 2) ? 1 : 0; // anneau intérieur pour les plus chaudes
      const idxInRing = ring ? i - Math.ceil(n / 2) : i;
      const nInRing = ring ? n - Math.ceil(n / 2) : rings === 2 ? Math.ceil(n / 2) : n;
      const a = (idxInRing / nInRing) * Math.PI * 2 + (ring ? Math.PI / nInRing : 0) + (R() - 0.5) * 0.15;
      const long = Math.max(w, h);
      // rayon : le pétale extérieur touche le bord, l'intérieur laisse le cœur
      // distance du centre au bord dans la direction du pétale : le pétale extérieur dépasse le bord
      const dEdge = Math.min(W / 2 / Math.max(1e-6, Math.abs(Math.cos(a))), H / 2 / Math.max(1e-6, Math.abs(Math.sin(a))));
      const dist = ring ? Math.min(W, H) * 0.22 + long * 0.35 : Math.max(dEdge - long * 0.38, Math.min(W, H) * 0.3);
      const cx = cx0 + Math.cos(a) * dist, cy = cy0 + Math.sin(a) * dist;
      // le grand côté du pétale suit le rayon
      const rot = (w >= h ? a : a - Math.PI / 2) + (R() - 0.5) * 0.12;
      panels.push({
        kind: 'bg', panel: true, whole: cut.whole, src: t.canvas, pageW: t.wcm, pageH: t.hcm,
        sx: cut.panel.x, sy: cut.panel.y, sw: cut.panel.w, sh: cut.panel.h,
        x: cx, y: cy, w, h, rot, flip: false, clip: tornPolygon(w, h, R, TEAR, cut.whole ? {} : null),
      });
      cov.mark(cx, cy, w, h, rot);
      cut.scraps.forEach((sc) => scrapPool.push({ t, k, ...sc }));
    });
    // les pétales glissent un peu pour boucher les trous, sans défaire la fleur
    spreadPanels(W, H, panels, 14);
    cov.cells.fill(0);
    panels.forEach((p) => cov.mark(p.x, p.y, p.w, p.h, p.rot));
    // lambeaux : ils bouchent les trous, en priorité vers les coins
    const scrapsOut = [];
    scrapPool.sort((a, b) => b.w * b.h - a.w * a.h);
    scrapPool.forEach((sc) => {
      const fw = sc.w / sc.k, fh = sc.h / sc.k;
      let best = null;
      for (let c = 0; c < 70; c++) {
        const i = Math.floor(R() * cov.cells.length);
        if (cov.cells[i]) continue;
        const px = (i % cov.gw) + 0.5, py = Math.floor(i / cov.gw) + 0.5;
        const a = Math.atan2(py - cy0, px - cx0);
        const rot = (fw >= fh ? a : a - Math.PI / 2) + (R() - 0.5) * 0.3;
        const s2 = cov.score(px, py, fw, fh, rot);
        const score = s2.over + s2.out * 0.4 + R() * 0.02;
        if (!best || score < best.score) best = { cx: px, cy: py, rot, score };
      }
      if (!best) return;
      scrapsOut.push({ kind: 'bg', scrap: true, src: sc.t.canvas, sx: sc.x, sy: sc.y, sw: sc.w, sh: sc.h, x: best.cx, y: best.cy, w: fw, h: fh, rot: best.rot, flip: false, clip: tornPolygon(fw, fh, R, TEAR) });
      cov.mark(best.cx, best.cy, fw * 1.05, fh * 1.05, best.rot);
    });
    out.push(...scrapsOut, ...panels);
  }


  /*
   * Les pages entières se répartissent pour boucher les trous : chaque page peut glisser un peu
   * (au plus `maxShift` cm, et sans quitter sa bande) si cela couvre davantage de toile nue.
   */
  function spreadPanels(W, H, panels, maxShift) {
    const gw = Math.ceil(W), gh = Math.ceil(H);
    const cnt = new Uint16Array(gw * gh);
    const each = (p, cx, cy, fn) => {
      const c = Math.cos(p.rot), s = Math.sin(p.rot), r = Math.hypot(p.w, p.h) / 2;
      for (let gy = Math.max(0, Math.floor(cy - r)); gy <= Math.min(gh - 1, Math.ceil(cy + r)); gy++) {
        for (let gx = Math.max(0, Math.floor(cx - r)); gx <= Math.min(gw - 1, Math.ceil(cx + r)); gx++) {
          const dx = gx + 0.5 - cx, dy = gy + 0.5 - cy;
          const lx = dx * c + dy * s, ly = -dx * s + dy * c;
          if (Math.abs(lx) > p.w * 0.49 || Math.abs(ly) > p.h * 0.49) continue;
          fn(gy * gw + gx);
        }
      }
    };
    const add = (p, v) => each(p, p.x, p.y, (i) => { cnt[i] += v; });
    const alone = (p, cx, cy) => { let n = 0; each(p, cx, cy, (i) => { if (!cnt[i]) n++; }); return n; };
    panels.forEach((p) => add(p, 1));
    const home = panels.map((p) => ({ x: p.x, y: p.y }));
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    for (let round = 0; round < 8; round++) {
      let moved = 0;
      panels.forEach((p, i) => {
        add(p, -1);
        const base = alone(p, p.x, p.y);
        let best = { x: p.x, y: p.y, gain: 0.5 };
        dirs.forEach(([ux, uy]) => [2, 4, 7, 11, 16, 22].forEach((d) => {
          const x = p.x + ux * d, y = p.y + uy * d;
          if (Math.hypot(x - home[i].x, y - home[i].y) > maxShift) return;
          if (p.band && (y < p.band[0] + p.h * 0.1 || y > p.band[1] - p.h * 0.1)) return;
          const gain = alone(p, x, y) - base;
          if (gain > best.gain) best = { x, y, gain };
        }));
        if (best.gain > 0.5) { p.x = best.x; p.y = best.y; moved++; }
        add(p, 1);
      });
      if (!moved) break;
    }
  }

  // Grille de couverture au centimètre.
  function Coverage(W, H) {
    const gw = Math.ceil(W), gh = Math.ceil(H);
    const cells = new Uint8Array(gw * gh);
    // parcourt les cellules à l'intérieur d'un rectangle tourné (légèrement rétréci)
    function each(cx, cy, w, h, rot, fn) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const r = Math.hypot(w, h) / 2;
      for (let gy = Math.floor(cy - r); gy <= Math.ceil(cy + r); gy++) {
        for (let gx = Math.floor(cx - r); gx <= Math.ceil(cx + r); gx++) {
          const dx = gx + 0.5 - cx, dy = gy + 0.5 - cy;
          const lx = dx * c + dy * s, ly = -dx * s + dy * c;
          if (Math.abs(lx) > w * 0.46 || Math.abs(ly) > h * 0.46) continue;
          fn(gx, gy, gx >= 0 && gy >= 0 && gx < gw && gy < gh ? gy * gw + gx : -1);
        }
      }
    }
    return {
      gw, gh, cells,
      score(cx, cy, w, h, rot) {
        let n = 0, over = 0, out = 0;
        each(cx, cy, w, h, rot, (x, y, i) => { n++; if (i < 0) out++; else if (cells[i]) over++; });
        return n ? { over: over / n, out: out / n } : { over: 1, out: 1 };
      },
      mark(cx, cy, w, h, rot) { each(cx, cy, w, h, rot, (x, y, i) => { if (i >= 0) cells[i] = 1; }); },
    };
  }

  /*
   * Fond : UNIQUEMENT les dessins, chaque page UNE SEULE FOIS, et chaque page EN ENTIER.
   *  1. chaque page de fond est déchirée en un grand morceau (un coin, 70 à 88 % de la page) ;
   *  2. (seulement si la page dépasse la toile) le reste est déchiré en lambeaux, sans rien jeter ;
   *  3. les grands morceaux sont posés d'abord (dans leur zone), puis les lambeaux vont boucher
   *     les trous, du plus grand au plus petit, jusqu'à ce que tout le papier soit collé.
   */
  function tearPage(t, R, W, H) {
    const pw = t.canvas.width, ph = t.canvas.height, k = pw / t.wcm;
    // Une page de fond n'est pas découpée : elle est collée entière (les pages se chevauchent,
    // et ce qui dépasse de la toile se rogne à la pose). On ne la réduit que si elle est plus
    // grande que la toile elle-même ; le surplus devient alors des lambeaux.
    const maxW = W ? W * 1.02 : Infinity, maxH = H ? H * 1.02 : Infinity;
    const fits = (t.wcm <= maxW && t.hcm <= maxH) || (t.wcm <= maxH && t.hcm <= maxW);
    if (fits) return { panel: { x: 0, y: 0, w: pw, h: ph }, scraps: [], k, whole: true };
    // trop grande pour la toile : on garde le plus grand morceau qui tient, dans le sens qui perd le moins
    const swap = Math.min(t.wcm, maxH) * Math.min(t.hcm, maxW) > Math.min(t.wcm, maxW) * Math.min(t.hcm, maxH);
    const sw = Math.round(Math.min(pw, (swap ? maxH : maxW) * k));
    const sh = Math.round(Math.min(ph, (swap ? maxW : maxH) * k));
    const left = R() < 0.5, top = R() < 0.5;
    const panel = { x: left ? 0 : pw - sw, y: top ? 0 : ph - sh, w: sw, h: sh };
    const strips = [];
    if (pw - sw > 0) strips.push({ x: left ? sw : 0, y: 0, w: pw - sw, h: ph });
    if (ph - sh > 0) strips.push({ x: panel.x, y: top ? sh : 0, w: sw, h: ph - sh });
    // lambeaux : on découpe chaque bande en morceaux le long de sa longueur, puis en 1 ou 2 dans l'épaisseur
    const scraps = [];
    strips.forEach((st) => {
      const horizontal = st.w >= st.h;
      const along = horizontal ? st.w : st.h, thick = horizontal ? st.h : st.w;
      // lambeaux larges (8 à 18 cm), l'épaisseur entière : un fond calme, pas des confettis
      const nThick = thick / k > 14 ? 2 : 1;
      const tPx = Math.floor(thick / nThick);
      let pos = 0;
      while (pos < along) {
        const len = Math.min(along - pos, Math.round((8 + R() * 8) * k));
        if (len < 4 * k && scraps.length) { // trop petit : on l'ajoute au précédent
          const prev = scraps[scraps.length - 1];
          if (horizontal) prev.w += len; else prev.h += len;
          pos += len; continue;
        }
        for (let j = 0; j < nThick; j++) {
          scraps.push(horizontal
            ? { x: st.x + pos, y: st.y + j * tPx, w: len, h: j === nThick - 1 ? thick - j * tPx : tPx }
            : { x: st.x + j * tPx, y: st.y + pos, w: j === nThick - 1 ? thick - j * tPx : tPx, h: len });
        }
        pos += len;
      }
    });
    return { panel, scraps, k, whole: false };
  }

  function backgroundFree(W, H, texs, Z, R, out, spiral) {
    const cov = Coverage(W, H);
    const panels = [], scrapPool = [];
    // les pages pâles d'abord (dessous), puis les pages colorées par-dessus
    const imp = (t) => (t.importance === undefined ? 1 : t.importance);
    const order = texs.slice().sort((a, b) => imp(a) - imp(b) || (a.colorful || 0) - (b.colorful || 0));
    order.forEach((t, i) => {
      const cut = tearPage(t, R, W, H);
      const k = cut.k;
      const w = cut.panel.w / k, h = cut.panel.h / k;
      const band = Z[t.zone] || [0, H];
      // en spirale, la page la plus forte (posée en dernier) est au centre
      const target = spiral ? spiralPoint(W, H, order.length - 1 - i, order.length) : null;
      let best = null;
      for (let c = 0; c < 90 && target; c++) {
        const kk = 0.15 + c / 90;
        const cx = target.x + (R() - 0.5) * w * kk, cy = target.y + (R() - 0.5) * h * kk;
        const rot = target.rot + (R() - 0.5) * 0.1;
        const sc = cov.score(cx, cy, w, h, rot);
        const score = sc.over + sc.out * 1.5 + Math.hypot(cx - target.x, cy - target.y) / (W * 0.3) + R() * 0.03;
        if (!best || score < best.score) best = { cx, cy, rot, score };
      }
      for (let c = 0; c < 90 && !target; c++) {
        // le papier peut déborder de la toile (il sera rogné au bord), comme sur un vrai collage
        const cx = w * 0.3 + R() * Math.max(1, W - w * 0.6);
        // de préférence dans sa zone, mais une page peut déborder pour ne pas laisser de trou
        const inZone = c % 3 !== 2;
        const lo = inZone ? band[0] + h * 0.3 : h * 0.3, hi = inZone ? band[1] - h * 0.3 : H - h * 0.3;
        const cy = clamp(lo + R() * Math.max(0, hi - lo), h * 0.3, H - h * 0.3);
        const rot = (R() - 0.5) * 0.08;
        const sc = cov.score(cx, cy, w, h, rot);
        const off = cy < band[0] || cy > band[1] ? 0.35 : 0;
        const score = sc.over + sc.out * 0.8 + off + R() * 0.03;
        if (!best || score < best.score) best = { cx, cy, rot, score };
      }
      panels.push({
        kind: 'bg', panel: true, whole: cut.whole, src: t.canvas, pageW: t.wcm, pageH: t.hcm,
        sx: cut.panel.x, sy: cut.panel.y, sw: cut.panel.w, sh: cut.panel.h,
        x: best.cx, y: best.cy, w, h, rot: best.rot, flip: false,
        clip: tornPolygon(w, h, R, TEAR, cut.whole ? {} : null),
      });
      cov.mark(best.cx, best.cy, w, h, best.rot);
      cut.scraps.forEach((sc) => scrapPool.push({ t, k, ...sc }));
    });

    // lambeaux : tout le papier restant est collé, les plus grands dans les plus grands trous
    const scrapsOut = [];
    scrapPool.sort((a, b) => b.w * b.h - a.w * a.h);
    for (const sc of scrapPool) {
      const fw = sc.w / sc.k, fh = sc.h / sc.k;
      // on cherche le trou : cellule vide dont le voisinage est le plus vide
      let best = null;
      for (let c = 0; c < 60; c++) {
        const i = Math.floor(R() * cov.cells.length);
        if (cov.cells[i]) continue;
        const cx = (i % cov.gw) + 0.5, cy = Math.floor(i / cov.gw) + 0.5;
        const rot = (R() - 0.5) * (fw > fh ? 0.5 : 0.5) + (c % 2 ? Math.PI / 2 : 0);
        const s2 = cov.score(cx, cy, fw, fh, rot);
        const score = s2.over + s2.out * 0.5 + R() * 0.02;
        if (!best || score < best.score) best = { cx, cy, rot, score };
      }
      if (!best) {
        // plus de cellule vide : on pose quand même le papier, là où il gêne le moins
        for (let c = 0; c < 30; c++) {
          const cx = fw / 2 + R() * Math.max(1, W - fw), cy = fh / 2 + R() * Math.max(1, H - fh);
          const rot = (R() - 0.5) * 1.2;
          const s2 = cov.score(cx, cy, fw, fh, rot);
          const score = s2.over + s2.out * 0.5 + R() * 0.02;
          if (!best || score < best.score) best = { cx, cy, rot, score };
        }
      }
      const L = {
        kind: 'bg', scrap: true, src: sc.t.canvas,
        sx: sc.x, sy: sc.y, sw: sc.w, sh: sc.h,
        x: best.cx, y: best.cy, w: fw, h: fh, rot: best.rot, flip: false,
        clip: tornPolygon(fw, fh, R, TEAR),
      };
      scrapsOut.push(L);
      cov.mark(L.x, L.y, L.w * 1.05, L.h * 1.05, best.rot);
    }
    // les lambeaux passent sous les grandes pages
    out.push(...scrapsOut, ...panels);
  }

  /*
   * Fond en bandes (paysage) : les pages sont réparties en trois bandes selon leur valeur et leur
   * couleur (claires et froides en haut, sombres et chaudes en bas), puis posées en tuiles qui se
   * chevauchent, presque droites, comme des papiers collés bord à bord. Les lambeaux restent dans la
   * bande de leur page et bouchent les trous ; le sol recouvre le milieu, qui recouvre le ciel.
   */
  function backgroundBands(W, H, texs, R, out) {
    const cov = Coverage(W, H);
    const bands = { ciel: [], milieu: [], sol: [] };
    texs.forEach((t) => (bands[t.zone] || bands.milieu).push(t));
    const areaOf = (list) => list.reduce((sum, t) => sum + t.wcm * t.hcm, 0);
    // chaque bande doit exister : on prélève dans le milieu si besoin
    const skyness = (t) => t.lum / 255 + (t.color[2] - t.color[0]) / 255;
    if (!bands.ciel.length && bands.milieu.length > 1) bands.ciel.push(bands.milieu.splice(bands.milieu.reduce((bi, t, i, a) => (skyness(t) > skyness(a[bi]) ? i : bi), 0), 1)[0]);
    if (!bands.sol.length && bands.milieu.length > 1) bands.sol.push(bands.milieu.splice(bands.milieu.reduce((bi, t, i, a) => (skyness(t) < skyness(a[bi]) ? i : bi), 0), 1)[0]);
    const zones = ['ciel', 'milieu', 'sol'].filter((z) => bands[z].length);
    const total = zones.reduce((sum, z) => sum + areaOf(bands[z]), 0) || 1;
    // hauteur de bande proportionnelle à sa surface de papier, bornée
    // le ciel, souvent fait de papiers pâles qui se recouvrent, reste une bande modérée
    let heights = zones.map((z) => clamp((H * areaOf(bands[z])) / total, H * 0.08, z === 'ciel' ? H * 0.34 : H * 0.62));
    const hsum = heights.reduce((a, b) => a + b, 0);
    heights = heights.map((h) => (h * H) / hsum);
    const scrapPool = [];
    const panels = [];
    let y0 = 0;
    const lines = { horizon: H * 0.3, ground: H * 0.72 };
    zones.forEach((z, zi) => {
      const bh = heights[zi];
      if (z === 'ciel') lines.horizon = y0 + bh;
      if (z === 'sol') lines.ground = y0;
      // pâles dessous, colorées dessus
      const pages = bands[z].slice().sort((a, b) => (a.colorful || 0) - (b.colorful || 0));
      const cuts = pages.map((t) => ({ t, cut: tearPage(t, R, W, H) }));
      cuts.forEach(({ t, cut }) => cut.scraps.forEach((sc) => scrapPool.push({ t, k: cut.k, ...sc, zone: z })));
      const widths = cuts.map(({ cut }) => cut.panel.w / cut.k);
      const rows = Math.max(1, Math.round(widths.reduce((a, b) => a + b, 0) / (W * 1.1)));
      const rowH = bh / rows;
      // répartition en rangées : en serpentin, les plus larges d'abord
      const byW = cuts.map((c, i) => ({ c, w: widths[i] })).sort((a, b) => b.w - a.w);
      const rowsList = Array.from({ length: rows }, () => []);
      byW.forEach((it, i) => rowsList[Math.floor(i / rows) % 2 ? rows - 1 - (i % rows) : i % rows].push(it));
      rowsList.forEach((row, ri) => {
        const order = shuffle(row, R);
        const sumW = order.reduce((a, it) => a + it.w, 0);
        // espacement : chevauchement si la rangée déborde, sinon un peu d'air (les lambeaux boucheront)
        const gap = clamp((W * 1.06 - sumW) / Math.max(1, order.length), -Math.min(...order.map((it) => it.w)) * 0.4, 2);
        let x = -W * 0.03 + (R() - 0.5) * 4;
        order.forEach(({ c, w }) => {
          const h = c.cut.panel.h / c.cut.k;
          const cx = x + w / 2;
          // la première rangée s'aligne sur le haut de la bande, la dernière sur le bas (avec débord),
          // pour ne pas laisser de vide aux lisières
          let cy = y0 + (ri + 0.5) * rowH;
          if (ri === 0) cy = Math.min(cy, y0 + h / 2 - 1);
          if (ri === rowsList.length - 1) cy = Math.max(cy, y0 + bh - h / 2 + 1);
          cy += (R() - 0.5) * rowH * 0.1;
          const rot = z === 'ciel' ? 0 : (R() - 0.5) * 0.05;
          panels.push({
            kind: 'bg', panel: true, whole: c.cut.whole, src: c.t.canvas, pageW: c.t.wcm, pageH: c.t.hcm,
            sx: c.cut.panel.x, sy: c.cut.panel.y, sw: c.cut.panel.w, sh: c.cut.panel.h,
            x: cx, y: cy, w, h, rot, flip: false,
            clip: tornPolygon(w, h, R, TEAR, c.cut.whole ? {} : z === 'ciel' ? { b: 1 } : z === 'sol' ? { t: 1 } : null),
          });
          panels[panels.length - 1].band = [y0, y0 + bh];
          cov.mark(cx, cy, w, h, rot);
          x += w + gap;
        });
      });
      y0 += bh;
    });
    // les pages entières glissent un peu pour boucher les trous de leur bande
    spreadPanels(W, H, panels, 26);
    cov.cells.fill(0);
    panels.forEach((p) => cov.mark(p.x, p.y, p.w, p.h, p.rot));

    // lambeaux : d'abord dans leur bande, les plus grands dans les plus grands trous
    const scrapsOut = [];
    const bandY = {};
    let yy = 0;
    zones.forEach((z, i) => { bandY[z] = [yy, yy + heights[i]]; yy += heights[i]; });
    scrapPool.sort((a, b) => b.w * b.h - a.w * a.h);
    const tryPlace = (sc, y0b, y1b, tries) => {
      const fw = sc.w / sc.k, fh = sc.h / sc.k;
      let best = null;
      for (let c = 0; c < tries; c++) {
        const cx = fw * 0.3 + R() * Math.max(1, W - fw * 0.6);
        const cy = y0b + fh * 0.3 + R() * Math.max(1, y1b - y0b - fh * 0.6);
        const rot = (R() - 0.5) * 0.4;
        const s2 = cov.score(cx, cy, fw, fh, rot);
        const score = s2.over + s2.out * 0.5 + R() * 0.02;
        if (!best || score < best.score) best = { cx, cy, rot, score };
      }
      return best;
    };
    scrapPool.forEach((sc) => {
      const [a, b] = bandY[sc.zone] || [0, H];
      let best = tryPlace(sc, a, b, 50);
      if (!best || best.score > 0.6) { const alt = tryPlace(sc, 0, H, 40); if (alt && alt.score < (best ? best.score : 9)) best = alt; }
      const fw = sc.w / sc.k, fh = sc.h / sc.k;
      scrapsOut.push({
        kind: 'bg', scrap: true, src: sc.t.canvas, sx: sc.x, sy: sc.y, sw: sc.w, sh: sc.h,
        x: best.cx, y: best.cy, w: fw, h: fh, rot: best.rot, flip: false, clip: tornPolygon(fw, fh, R, TEAR),
      });
      cov.mark(best.cx, best.cy, fw * 1.05, fh * 1.05, best.rot);
    });
    out.push(...scrapsOut, ...panels);
    return { ciel: [0, lines.horizon], milieu: [lines.horizon, lines.ground], sol: [lines.ground, H], horizon: lines.horizon, ground: lines.ground };
  }


  /*
   * Courtepointe : les pages de fond sont les carreaux d'un patchwork, posées bord à bord, presque
   * droites, en alternant claires et foncées comme un damier cousu. Retourne les centres des carreaux.
   */
  function backgroundQuilt(W, H, texs, R, out) {
    const cov = Coverage(W, H);
    const byLum = texs.slice().sort((a, b) => a.lum - b.lum);
    // alternance clair / foncé : on pioche aux deux bouts
    const order = [];
    for (let i = 0, j = byLum.length - 1; i <= j; i++, j--) { order.push(byLum[j]); if (i !== j) order.push(byLum[i]); }
    const cuts = order.map((t) => ({ t, cut: tearPage(t, R, W, H) }));
    const widths = cuts.map(({ cut }) => cut.panel.w / cut.k);
    const rows = Math.max(1, Math.round(widths.reduce((a, b) => a + b, 0) / (W * 1.08)));
    const rowH = H / rows;
    // répartition en rangées : chaque page va dans la rangée la moins remplie (les larges d'abord),
    // pour que toutes les rangées couvrent la largeur ; l'alternance clair / foncé se garde dans la rangée
    const rowsList = Array.from({ length: rows }, () => []);
    const sums = new Array(rows).fill(0);
    cuts.map((c, i) => ({ c, w: widths[i] })).sort((a, b) => b.w - a.w).forEach((it) => {
      let ri = 0;
      for (let r = 1; r < rows; r++) if (sums[r] < sums[ri]) ri = r;
      rowsList[ri].push(it); sums[ri] += it.w;
    });
    rowsList.forEach((row) => row.sort((a, b) => order.indexOf(a.c.t) - order.indexOf(b.c.t)));
    const panels = [], tiles = [];
    rowsList.forEach((row, ri) => {
      const sumW = row.reduce((a, it) => a + it.w, 0);
      const gap = clamp((W * 1.04 - sumW) / Math.max(1, row.length), -Math.min(...row.map((it) => it.w)) * 0.45, 1.0);
      let x = -W * 0.02 + (ri % 2 ? -4 : 0);
      row.forEach(({ c, w }) => {
        const h = c.cut.panel.h / c.cut.k;
        const cx = x + w / 2;
        let cy = ri * rowH + rowH / 2;
        if (ri === 0) cy = Math.min(cy, h / 2 - 0.5);
        if (ri === rows - 1) cy = Math.max(cy, H - h / 2 + 0.5);
        const rot = (R() - 0.5) * 0.03;
        panels.push({
          kind: 'bg', panel: true, whole: c.cut.whole, src: c.t.canvas, pageW: c.t.wcm, pageH: c.t.hcm,
          sx: c.cut.panel.x, sy: c.cut.panel.y, sw: c.cut.panel.w, sh: c.cut.panel.h,
          x: cx, y: cy, w, h, rot, flip: false, clip: tornPolygon(w, h, R, TEAR, c.cut.whole ? {} : null), band: [ri * rowH, (ri + 1) * rowH],
        });
        x += w + gap;
      });
    });
    spreadPanels(W, H, panels, 22);
    panels.forEach((p) => { cov.mark(p.x, p.y, p.w, p.h, p.rot); tiles.push({ x: p.x, y: p.y, w: p.w, h: p.h, lum: 0 }); });
    out.push(...panels);
    return tiles;
  }

  /*
   * Vitrail : chaque page de fond est un fragment tourné d'un angle franc, posé sur une trame de
   * cellules ; entre les fragments, de fines lignes de toile nue (peintes en noir : le plomb).
   */
  function backgroundShards(W, H, texs, R, out) {
    const pages = texs.slice().sort((a, b) => (b.colorful || 0) - (a.colorful || 0)); // les plus colorées au centre
    const n = pages.length;
    const cols = Math.max(1, Math.round(Math.sqrt(n * W / H))), rows = Math.max(1, Math.ceil(n / cols));
    const cw = W / cols, ch = H / rows;
    // cellules triées par distance au centre : la page la plus colorée au milieu
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: (c + 0.5) * cw, y: (r + 0.5) * ch });
    cells.sort((a, b) => Math.hypot(a.x - W / 2, a.y - H / 2) - Math.hypot(b.x - W / 2, b.y - H / 2));
    const panels = [];
    pages.forEach((t, i) => {
      const cell = cells[i % cells.length];
      const cut = tearPage(t, R, W, H);
      const w = cut.panel.w / cut.k, h = cut.panel.h / cut.k;
      const rot = (R() - 0.5) * 0.5 + (i % 2 ? 0.28 : -0.28);
      panels.push({
        kind: 'bg', panel: true, whole: cut.whole, src: t.canvas, pageW: t.wcm, pageH: t.hcm,
        sx: cut.panel.x, sy: cut.panel.y, sw: cut.panel.w, sh: cut.panel.h,
        x: cell.x + (R() - 0.5) * cw * 0.2, y: cell.y + (R() - 0.5) * ch * 0.2, w, h, rot, flip: false,
        clip: tornPolygon(w, h, R, TEAR, cut.whole ? {} : null),
      });
    });
    spreadPanels(W, H, panels, 12);
    out.push(...panels);
  }

  // Carte de charge visuelle et de clarté du fond, au centimètre : pour poser les sujets au calme.
  function backgroundMaps(W, H, bg) {
    const gw = Math.ceil(W), gh = Math.ceil(H);
    const c = Extract.makeCanvas(gw, gh);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    renderBg(ctx, { W, H, bg }, 1, false);
    const d = ctx.getImageData(0, 0, gw, gh).data;
    const lum = new Float32Array(gw * gh), busy = new Float32Array(gw * gh);
    for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        let s2 = 0, n = 0;
        if (x > 0) { s2 += Math.abs(lum[i] - lum[i - 1]); n++; }
        if (y > 0) { s2 += Math.abs(lum[i] - lum[i - gw]); n++; }
        busy[i] = n ? s2 / n : 0;
      }
    }
    return { gw, gh, lum, busy };
  }

  // ---------- Placement des découpes ----------

  /*
   * TOUTES les découpes sont placées. Règles de composition :
   *  - chaque sujet va dans la zone décidée (ciel / milieu / sol) ; les sujets « posés »
   *    reposent sur une ligne de sol de leur zone, les autres flottent ;
   *  - les pièces maîtresses vont sur les points forts (règle des tiers) ;
   *  - équilibre des masses, couleurs voisines variées, sujets répartis sur toute la toile ;
   *  - chevauchements réduits au minimum ; profondeur : ce qui est plus bas passe devant.
   */
  // mode : null (libre, par zones) ou { targets(idx, n, piece) → {x, y, rot, r}, byRadius, tight }
  function placePieces(W, H, pieces, o, Z, R, mode, maps) {
    const spiral = !!mode;
    const targetsFn = mode ? mode.targets : null;
    const gw = Math.ceil(W), gh = Math.ceil(H);
    const occ = new Uint8Array(gw * gh);
    const pieceLum = (p) => 0.299 * p.color[0] + 0.587 * p.color[1] + 0.114 * p.color[2];
    const thirds = [[W / 3, H / 3], [(2 * W) / 3, H / 3], [W / 3, (2 * H) / 3], [(2 * W) / 3, (2 * H) / 3]];
    const usedThirds = new Set();
    const placed = [];
    let mass = 0, mx = 0, my = 0;
    const maxRot = (o.rotation * Math.PI) / 180;
    const weight = (p) => Math.sqrt(p.wcm * p.hcm) * Math.pow(Math.max(0.05, p.colorful), 1.3) * (p.importance || 1);
    const sorted = pieces.slice().sort((a, b) => weight(b) - weight(a));
    const stars = new Set(sorted.filter((p) => (p.importance || 1) >= 3).slice(0, 4));
    if (!stars.size) sorted.slice(0, 3).forEach((p) => stars.add(p));
    // les découpes couvrent au plus ~45 % de la toile (× densité) : au-delà, les sujets restent en attente
    // densité : le curseur règle directement le nombre de sujets posés, des plus forts aux plus faibles
    // (de 20 % au minimum jusqu'à tous au maximum), avec un plafond de couverture qui suit ;
    // au maximum (« tout »), plus de plafond et un sujet sans place libre se pose quand même
    const t = o.densityT === undefined ? 0.46 : clamp(o.densityT, 0, 1);
    const maxCount = o.everything ? sorted.length : Math.max(1, Math.round(sorted.length * (0.2 + 0.8 * t)));
    // tolérance de chevauchement entre découpes : nulle à faible densité, franche vers le maximum
    const overMax = 0.12 + 0.55 * t;
    const targetCover = o.everything ? Infinity : (0.3 + 0.55 * t) * W * H;
    let covered = 0;

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

    sorted.forEach((p, idx) => {
      p.placed = false;
      if (idx >= maxCount || covered >= targetCover) return;
      const grounded = !spiral && !!p.grounded;
      const pHue = hue(p.color);
      const w8 = p.wcm * p.hcm * (0.3 + p.colorful);
      const star = !spiral && stars.has(p);
      let best = null, fallback = null;
      // Tournesol : chaque sujet vise son point de la spirale, les pièces maîtresses au cœur.
      // graines : elles restent dans le disque central (70 % du rayon), la couronne de pétales reste visible
      const target = targetsFn ? targetsFn(idx, sorted.length, p) : null;
      for (let c = 0; c < 110 && target; c++) {
        const k = target.r === 0 ? 0.05 : 0.1 + (c / 110) * (mode.spread || (mode.tight === false ? 2.2 : 1.2));
        const cx = target.x + (R() - 0.5) * p.wcm * k, cy = target.y + (R() - 0.5) * p.hcm * k;
        let cells = 0, over = 0, out = 0;
        footprint(p, cx, cy, (gx, gy) => {
          cells++;
          if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) out++;
          else if (occ[gy * gw + gx]) over++;
        });
        if (!cells) continue;
        const score = (over / cells) * 6 + (out / cells) * 5 + Math.hypot(cx - target.x, cy - target.y) / (W * 0.15) + R() * 0.03;
        if (!fallback || score < fallback.score) fallback = { cx, cy, score, r: target.r, rot: target.rot };
        if (over / cells > overMax || out / cells > 0.15) continue;
        if (!best || score < best.score) best = { cx, cy, score, r: target.r, rot: target.rot };
      }
      for (let c = 0; c < 170 && !target; c++) {
        // un sujet posé peut aussi se tenir sur le bas du milieu, pas seulement dans la bande du sol
        const band = grounded && c % 2 ? [Z.milieu[0], Z.sol[1]] : Z[p.zone] || [0, H];
        let cx = p.wcm * 0.35 + R() * Math.max(1, W - p.wcm * 0.7);
        let cy;
        if (grounded) {
          // le bas du sujet repose dans la moitié basse de sa zone
          const bottom = band[0] + (band[1] - band[0]) * (0.55 + R() * 0.45);
          cy = Math.min(bottom, H + p.hcm * 0.08) - p.hcm / 2;
        } else {
          cy = band[0] + R() * (band[1] - band[0]);
        }
        if (star && c < 40) {
          const [tx, ty] = thirds[c % 4];
          cx = tx + (R() - 0.5) * W * 0.1;
          if (!grounded) cy = ty + (R() - 0.5) * H * 0.1;
        }
        cy = clamp(cy, p.hcm * 0.3, H - p.hcm * 0.3);
        let cells = 0, over = 0, out = 0, busySum = 0, lumSum = 0;
        footprint(p, cx, cy, (gx, gy) => {
          cells++;
          if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) out++;
          else {
            if (occ[gy * gw + gx]) over++;
            if (maps) { busySum += maps.busy[gy * gw + gx]; lumSum += maps.lum[gy * gw + gx]; }
          }
        });
        if (!cells) continue;
        let score = (over / cells) * 6 + (out / cells) * 5;
        if (maps) {
          // zone calme, et contraste clair / foncé entre le sujet et le fond
          const inside = Math.max(1, cells - out);
          score += Math.min(1.2, busySum / inside / 30) * (star ? 1.2 : 0.7);
          score -= Math.min(1, Math.abs(pieceLum(p) - lumSum / inside) / 120) * 0.5;
        }
        // respiration autour des pièces maîtresses déjà posées
        for (const q of placed) {
          if (!q.star) continue;
          const d = Math.hypot(q.x - cx, q.y - cy);
          const reach = (Math.max(q.w, q.h) + Math.max(p.wcm, p.hcm)) * 0.55 + 6;
          if (d < reach) score += (1 - d / reach) * (star ? 2 : 1.2);
        }
        // les petits éléments se groupent en constellation près d'une grande pièce d'une autre couleur
        if (Math.max(p.wcm, p.hcm) < 9) {
          let bestNear = Infinity;
          for (const q of placed) {
            if (Math.max(q.w, q.h) < 14) continue;
            const d = Math.hypot(q.x - cx, q.y - cy) - Math.max(q.w, q.h) * 0.5;
            if (d > 2 && d < bestNear) bestNear = d;
          }
          if (bestNear < 16) score -= 0.45;
        }
        const nm = mass + w8;
        score += Math.hypot(((mx + cx * w8) / nm - W / 2) / W, ((my + cy * w8) / nm - H / 2) / H) * (placed.length > 3 ? 2 : 0.5);
        let near = Infinity;
        for (const q of placed) {
          const d = Math.hypot(q.x - cx, q.y - cy);
          near = Math.min(near, d);
          if (d < (Math.max(p.wcm, p.hcm) + Math.max(q.w, q.h)) * 0.7 && p.colorful > 0.2 && q.piece.colorful > 0.2) {
            const dh = Math.abs(pHue - hue(q.piece.color));
            if (Math.min(dh, 360 - dh) < 35) score += 0.3;
          }
        }
        if (near < Infinity) score -= Math.min(near / (W * 0.25), 1) * 0.5;
        if (star) {
          let dmin = Infinity;
          thirds.forEach(([tx, ty], i) => { if (!usedThirds.has(i)) dmin = Math.min(dmin, Math.hypot(tx - cx, (ty - cy) * (grounded ? 0.3 : 1))); });
          if (dmin < Infinity) score += (dmin / W) * 2.5;
        }
        score += R() * 0.04;
        if (!fallback || score < fallback.score) fallback = { cx, cy, score };
        if (over / cells > overMax || out / cells > 0.15) continue; // pas de vrai chevauchement
        if (!best || score < best.score) best = { cx, cy, score };
      }
      // pas de place sans empiler : le sujet reste en attente (sauf en spirale, où l'on serre)
      if (!best) { if ((spiral && idx === 0 && mode.tight !== false) || o.everything || t > 0.85) best = fallback; if (!best) return; }
      footprint(p, best.cx, best.cy, (gx, gy) => { if (gx >= 0 && gy >= 0 && gx < gw && gy < gh && !occ[gy * gw + gx]) { occ[gy * gw + gx] = 1; covered++; } });
      if (star) {
        let bi = -1, bd = Infinity;
        thirds.forEach(([tx, ty], i) => { const d = Math.hypot(tx - best.cx, ty - best.cy); if (!usedThirds.has(i) && d < bd) { bd = d; bi = i; } });
        if (bi >= 0 && bd < W * 0.15) usedThirds.add(bi);
      }
      mass += w8; mx += best.cx * w8; my += best.cy * w8;
      p.placed = true;
      // rotation retenue : les pièces maîtresses et les grandes pièces restent presque droites
      const limit = star ? Math.min(maxRot, 0.06) : Math.max(p.wcm, p.hcm) > 25 ? Math.min(maxRot, 0.1) : maxRot;
      const rot = best.rot !== undefined ? best.rot + (R() - 0.5) * limit : (R() - 0.5) * 2 * (grounded ? Math.min(limit, 0.05) : limit);
      placed.push({ kind: 'piece', piece: p, x: best.cx, y: best.cy, w: p.wcm, h: p.hcm, rot, flip: false, grounded, star, r: best.r });
    });

    // cibles : l'extérieur d'abord, le cœur par-dessus (ou les grandes pièces dessous)
    if (spiral) return mode.byRadius ? placed.sort((a, b) => b.r - a.r) : placed.sort((a, b) => b.w * b.h - a.w * a.h);
    const g = placed.filter((L) => L.grounded).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
    const f = placed.filter((L) => !L.grounded).sort((a, b) => b.w * b.h - a.w * a.h);
    return g.concat(f);
  }

  /*
   * Cabinet de curiosités : chaque dessin exposé droit, en rangées alignées sur des « étagères »,
   * sur papier blanc et sans chevauchement. On cherche la plus grande échelle (toujours la même
   * pour tous, jamais plus grande que la taille réelle) qui fait tout tenir.
   */
  /*
   * Cabinet de curiosités : la même toile que les autres styles, à taille réelle, sans chevauchement.
   * Tout ne peut pas y tenir : on retient les plus beaux dessins (note de Claude, puis couleur et
   * taille du sujet), un par dessin d'abord, par ordre de beauté, tant qu'ils entrent en rangées.
   */
  function cabinet(W, H, texs, pieces, o, R) {
    const gap = 1.5, margin = 3;
    const beauty = (it) => {
      const imp = it.t ? (it.t.importance === undefined ? 1 : it.t.importance) : (it.p.importance || 1);
      const col = it.t ? (it.t.colorful || 0) : (it.p.colorful || 0);
      const area = it.w * it.h;
      return imp * 2 + col * 1.5 + Math.min(1, area / 900) * 0.6 + (it.p && it.p.main ? 0.8 : 0);
    };
    const cands = texs.map((t) => ({ t, w: t.wcm, h: t.hcm, d: t.drawing }))
      .concat(pieces.map((p) => ({ p, w: p.wcm, h: p.hcm, d: p.drawing })))
      .filter((it) => it.w <= W - 2 * margin && it.h <= H - 2 * margin)
      .sort((a, b) => beauty(b) - beauty(a));
    // un sujet par dessin d'abord, puis les seconds sujets
    const seen = new Set();
    const firsts = [], seconds = [];
    cands.forEach((it) => { if (it.d && seen.has(it.d)) seconds.push(it); else { if (it.d) seen.add(it.d); firsts.push(it); } });
    const order = firsts.concat(seconds);

    // rangées : on ajoute les dessins un à un, du plus beau au moins beau, tant que tout tient en hauteur
    const fits = (list) => {
      const sorted = list.slice().sort((a, b) => b.h - a.h);
      const rows = [];
      let row = [], x = margin;
      for (const it of sorted) {
        if (row.length && x + it.w + margin > W) { rows.push(row); row = []; x = margin; }
        row.push(it);
        x += it.w + gap;
      }
      if (row.length) rows.push(row);
      const need = rows.reduce((s2, r) => s2 + Math.max(...r.map((it) => it.h)), 0) + gap * (rows.length - 1) + 2 * margin;
      return need <= H ? rows : null;
    };
    const chosen = [];
    let rows = [];
    for (const it of order) {
      const r = fits(chosen.concat([it]));
      if (r) { chosen.push(it); rows = r; }
    }
    // pièces retenues : marquées placées ; les autres restent disponibles
    const heights = rows.map((r) => Math.max(...r.map((it) => it.h)));
    const free = H - 2 * margin - heights.reduce((a, b) => a + b, 0);
    const vgap = rows.length > 1 ? free / (rows.length - 1) : 0;
    const bg = [], items = [];
    let y = margin + (rows.length > 1 ? 0 : free / 2);
    rows.forEach((row, ri) => {
      const r = shuffle(row, R);
      const rowW = r.reduce((s2, it) => s2 + it.w, 0);
      const hgap = Math.min((W - 2 * margin - rowW) / Math.max(1, r.length - 1), 10);
      let x = (W - rowW - hgap * (r.length - 1)) / 2;
      r.forEach((it) => {
        const w = it.w, h = it.h;
        const cx = x + w / 2, cy = y + heights[ri] - h / 2; // posé sur l'étagère
        if (it.t) bg.push({ kind: 'bg', panel: true, src: it.t.canvas, pageW: it.t.wcm, pageH: it.t.hcm, sx: 0, sy: 0, sw: it.t.canvas.width, sh: it.t.canvas.height, x: cx, y: cy, w, h, rot: 0, flip: false, clip: null, whole: true });
        else { it.p.placed = true; items.push({ kind: 'piece', piece: it.p, x: cx, y: cy, w, h, rot: 0, flip: false }); }
        x += w + hgap;
      });
      y += heights[ri] + vgap;
    });
    const drawingsOf = (list) => new Set(list.map((it) => it.d).filter(Boolean)).size;
    return { bg, items, f: 1, W, H, kept: drawingsOf(chosen), total: drawingsOf(texs.map((t) => ({ d: t.drawing })).concat(pieces.map((p) => ({ d: p.drawing })))) };
  }


  /*
   * Galerie : une grille régulière de cases carrées, cernées d'un trait noir fin, un dessin par case,
   * comme une planche de personnages encadrée. On retient les sujets les plus adaptés (un par
   * dessin, colorés, plutôt dressés) et le plus grand nombre de cases que la toile permet en
   * gardant chaque sujet à sa taille réelle ; le nombre de dessins dépend donc de la toile.
   */
  function gallery(W, H, pieces, o, R) {
    const M = 3, gap = 1.6, pad = 1.6;
    const beauty = (p) => (p.importance || 1) * 2 + (p.colorful || 0) * 2 + (p.main ? 1 : 0)
      + (p.hcm / p.wcm >= 0.8 && p.hcm / p.wcm <= 2.4 ? 0.6 : 0) + Math.min(1, (p.wcm * p.hcm) / 600) * 0.5;
    // un sujet par dessin : le meilleur de chaque
    const byDrawing = new Map();
    pieces.forEach((p) => { const d = p.drawing || p; if (!byDrawing.has(d) || beauty(p) > beauty(byDrawing.get(d))) byDrawing.set(d, p); });
    const cands = [...byDrawing.values()].sort((a, b) => beauty(b) - beauty(a));
    if (!cands.length) return { items: [], frames: [], kept: 0 };
    // le curseur de densité règle le nombre de cases visées (toutes au maximum)
    const t = o.densityT === undefined ? 0.46 : clamp(o.densityT, 0, 1);
    const target = o.everything ? cands.length : Math.max(1, Math.round(cands.length * (0.2 + 0.8 * t)));
    // cases carrées : pour N cases, la grille la plus proche des proportions de la toile, et le plus
    // grand côté de case qui tient ; si les sujets ne tiennent pas à taille réelle, on vise moins de cases
    let best = null;
    for (let N = target; N >= 1 && !best; N--) {
      const cols = Math.max(1, Math.round(Math.sqrt((N * W) / H)));
      const rows = Math.ceil(N / cols);
      const side = Math.min((W - 2 * M - (cols - 1) * gap) / cols, (H - 2 * M - (rows - 1) * gap) / rows);
      if (side < 6) continue;
      const fillOf = (p) => Math.max(p.wcm, p.hcm) / (side - 2 * pad);
      const cellScore = (p) => { const f = fillOf(p); return beauty(p) + 3 * clamp((f - 0.4) / 0.4, 0, 1) - (f < 0.4 ? 4 : 0); };
      const fit = cands.filter((p) => fillOf(p) <= 1).sort((a, b) => cellScore(b) - cellScore(a));
      if (fit.length >= N) best = { N, cols, rows, side, fit: fit.slice(0, N) };
    }
    if (!best) return { items: [], frames: [], kept: 0 };
    // grille centrée sur la toile ; la dernière rangée, si elle est incomplète, est centrée aussi
    const { N, cols, side } = best;
    const rows = Math.ceil(N / cols);
    const gridW = cols * side + (cols - 1) * gap, gridH = rows * side + (rows - 1) * gap;
    const x0g = (W - gridW) / 2, y0g = (H - gridH) / 2;
    const order = shuffle(best.fit, R);
    const items = [], frames = [];
    order.forEach((p, i) => {
      const r = Math.floor(i / cols);
      const inRow = r === rows - 1 ? N - r * cols : cols;
      const c = i - r * cols;
      const x0 = x0g + (cols - inRow) * (side + gap) / 2 + c * (side + gap), y0 = y0g + r * (side + gap);
      frames.push({ x: x0, y: y0, w: side, h: side });
      p.placed = true;
      items.push({ kind: 'piece', piece: p, x: x0 + side / 2, y: y0 + side / 2, w: p.wcm, h: p.hcm, rot: 0, flip: false });
    });
    return { items, frames, kept: items.length, cols, rows };
  }

  function paperLayer(W, H) {
    const c = paperTexture();
    return { kind: 'bg', paper: true, src: c, x: W / 2, y: H / 2, w: W, h: H, rot: 0, flip: false, clip: null, sx: 0, sy: 0, sw: c.width, sh: c.height };
  }

  // Styles : 'paysage' (ciel, milieu, sol), 'tournesol' (spirale), 'courtepointe' (patchwork), 'galerie' (grille de cadres), 'cabinet' (rangées alignées).
  function generate(o) {
    const W = o.format.w, H = o.format.h;
    const R = rng(o.seed);
    const style = o.style || 'paysage';
    if (style === 'galerie') {
      const g = gallery(W, H, o.pieces, o, R);
      const total = new Set(o.textures.map((t) => t.drawing).concat(o.pieces.map((p) => p.drawing)).filter(Boolean)).size;
      // fond blanc, sans finition toile : une planche encadrée, pas une toile peinte
      // fond blanc, fixe : ni couleur ni effet peinture, ni finition toile — une planche encadrée
      return { W, H, bg: [], items: g.items, frames: g.frames, frameWidth: 0.15, ground: '#fbfaf6', paint: false, grain: false, style, f: 1, scale: 1, kept: g.kept, total };
    }
    if (style === 'cabinet') {
      const cab = cabinet(W, H, o.textures, o.pieces, o, R);
      // toile nue (papier) ou aplat de peinture choisi
      return { W, H, bg: [...(o.ground ? [] : [paperLayer(W, H)]), ...cab.bg], items: cab.items, ground: o.ground || null, groundName: o.groundName || null, grain: o.grain, style, f: 1, scale: 1, kept: cab.kept, total: cab.total };
    }
    const bg = [];
    let Z = zonesFor(W, H, true);
    let mode = null, ground = null, lines = null;
    if (style === 'tournesol') {
      Z = zonesFor(W, H, false);
      if (o.textures.length) backgroundPetals(W, H, o.textures, R, bg); else bg.push(paperLayer(W, H));
      mode = { targets: (idx, n) => (idx === 0 ? { x: W / 2, y: H / 2, rot: 0, r: 0 } : spiralPoint(W, H, idx, n, 0.7)), byRadius: true };
    } else if (style === 'courtepointe') {
      // un médaillon par carreau : les plus grandes découpes sur les plus grands carreaux
      Z = zonesFor(W, H, false);
      const tiles = o.textures.length ? backgroundQuilt(W, H, o.textures, R, bg) : [];
      if (!tiles.length) { bg.push(paperLayer(W, H)); }
      const byArea = tiles.slice().sort((a, b) => b.w * b.h - a.w * a.h);
      mode = { targets: (idx) => { const t = byArea.length ? byArea[idx % byArea.length] : { x: W / 2, y: H / 2 }; return { x: t.x, y: t.y, rot: 0, r: idx }; }, byRadius: false, tight: false, spread: 0.9 };
    } else if (style === 'cerfsvolants') {
      // le ciel en bandes, incliné par le vent ; les découpes s'envolent sur une diagonale montante
      if (o.textures.length) Z = backgroundBands(W, H, o.textures, R, bg); else bg.push(paperLayer(W, H));
      bg.forEach((L) => { if (L.panel) L.rot += 0.06; });
      Z = zonesFor(W, H, false);
      mode = { targets: (idx, n) => { const t = n > 1 ? idx / (n - 1) : 0.5; const side = idx % 2 ? 1 : -1; return { x: W * (0.14 + 0.72 * t) + side * W * 0.06 * (t > 0.2 ? 1 : 0), y: H * (0.8 - 0.62 * t) - side * H * 0.08 * (t > 0.2 ? 1 : 0), rot: -0.3 + (R() - 0.5) * 0.15, r: 1 - t }; }, byRadius: false, tight: false };
    } else if (style === 'vitrail') {
      // toile peinte en noir, fragments tournés, et un trait de plomb noir peint le long de chaque fragment
      Z = zonesFor(W, H, false);
      ground = '#1c1b15';
      if (o.textures.length) backgroundShards(W, H, o.textures, R, bg);
      // rosace : la pièce maîtresse au centre, puis deux anneaux
      mode = { targets: (idx, n) => { if (idx === 0) return { x: W / 2, y: H / 2, rot: 0, r: 0 }; const ring = idx <= 6 ? 1 : 2; const k = ring === 1 ? idx - 1 : idx - 7; const m = ring === 1 ? 6 : Math.max(1, n - 7); const a = (k / m) * Math.PI * 2 + (ring === 2 ? Math.PI / m : -Math.PI / 2); const rad = ring === 1 ? Math.min(W, H) * 0.27 : Math.min(W, H) * 0.44; return { x: W / 2 + Math.cos(a) * rad * (W / Math.min(W, H)) * 0.85, y: H / 2 + Math.sin(a) * rad, rot: 0, r: ring }; }, byRadius: true, tight: false };
    } else if (style === 'constellation') {
      if (o.textures.length) Z = backgroundBands(W, H, o.textures, R, bg); else bg.push(paperLayer(W, H));
      Z = zonesFor(W, H, false);
      // des étoiles semées avec un espacement minimal ; la plus grande au centre
      const pts = [{ x: W / 2, y: H / 2 }];
      for (let tries = 0; tries < 4000 && pts.length < 40; tries++) {
        const q = { x: W * (0.08 + R() * 0.84), y: H * (0.08 + R() * 0.84) };
        if (pts.every((p) => Math.hypot(p.x - q.x, p.y - q.y) > Math.min(W, H) * 0.19)) pts.push(q);
      }
      mode = { targets: (idx) => ({ x: pts[idx % pts.length].x, y: pts[idx % pts.length].y, rot: 0, r: idx }), byRadius: false, tight: false };
      lines = 'chain';
    } else {
      if (o.textures.length) Z = backgroundBands(W, H, o.textures, R, bg); else bg.push(paperLayer(W, H));
    }
    const maps = backgroundMaps(W, H, bg);
    const items = placePieces(W, H, o.pieces, o, Z, R, mode, maps);
    // sans fond de peinture, la toile nue (papier) apparaît là où il n'y a pas de page
    if (o.ground) { for (let i = bg.length - 1; i >= 0; i--) if (bg[i].paper) bg.splice(i, 1); }
    const comp = { W, H, bg, items, grain: o.grain, style, f: 1, scale: 1 };
    if (ground) comp.ground = ground;
    else if (o.ground) { comp.ground = o.ground; comp.groundName = o.groundName || null; }
    if (style === 'vitrail') comp.lead = 0.5; // largeur du trait de plomb, en cm
    if (lines === 'chain') {
      // la constellation : chaque étoile reliée à sa plus proche voisine non encore reliée
      const pts = items.map((L) => ({ x: L.x, y: L.y }));
      const segs = [];
      const left = pts.slice(1);
      let cur = pts[0];
      while (cur && left.length) {
        let bi = 0;
        left.forEach((q, i) => { if (Math.hypot(q.x - cur.x, q.y - cur.y) < Math.hypot(left[bi].x - cur.x, left[bi].y - cur.y)) bi = i; });
        const nxt = left.splice(bi, 1)[0];
        segs.push([cur.x, cur.y, nxt.x, nxt.y]);
        cur = nxt;
      }
      comp.lines = segs;
    }
    return comp;
  }

  // Ajoute une découpe (à l'échelle) dans une composition existante.
  function addPiece(comp, piece, seed) {
    const R = rng(seed);
    const item = { kind: 'piece', piece, x: comp.W * (0.25 + R() * 0.5), y: comp.H * (0.25 + R() * 0.5), w: piece.wcm * (comp.f || 1), h: piece.hcm * (comp.f || 1), rot: (R() - 0.5) * 0.2, flip: false };
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


  /*
   * Aplat de peinture acrylique sur toute la toile, sans répétition : de longs coups de brosse qui
   * traversent la toile, légèrement plus clairs ou plus foncés que la teinte, en deux couches — une
   * première en biais, une seconde horizontale — avec les traces fines des poils et une couche
   * inégale par endroits. Calculé à la résolution du rendu (même dessin à toutes les échelles,
   * grâce à un germe fixe), puis mis en cache.
   */
  const paintCache = new Map();
  function paintCanvas(color, W, H, s) {
    const key = `${color}|${W}|${H}|${Math.round(s * 4)}`;
    if (paintCache.has(key)) return paintCache.get(key);
    const pw = Math.max(1, Math.round(W * s)), ph = Math.max(1, Math.round(H * s));
    const c = Extract.makeCanvas(pw, ph);
    const ctx = c.getContext('2d');
    const rgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
    const light = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 200;
    // sur une teinte très claire, on ne peut pas éclaircir : les coups de brosse se lisent en plus foncé
    const shade = (k0) => { const k = light ? 0.955 + (clamp(k0, 0.84, 1.18) - 0.84) * 0.12 : k0; return `rgb(${rgb.map((v) => clamp(Math.round(v * k + (k > 1 ? (255 - v) * (k - 1) * 0.6 : 0)), 0, 255)).join(',')})`; };
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, pw, ph);
    const R = rng(7 + rgb[0] + rgb[1] * 3 + rgb[2] * 7 + Math.round(W) * 13 + Math.round(H) * 29);
    const diag = Math.hypot(W, H);
    // un coup de brosse : un ruban qui ondule légèrement, en cm, dessiné à l'échelle s
    const stroke = (x, y, len, ang, width, k, alpha, bristles) => {
      ctx.save();
      ctx.translate(x * s, y * s);
      ctx.rotate(ang);
      ctx.lineCap = 'round';
      const wave = (R() - 0.5) * len * 0.05, wave2 = (R() - 0.5) * len * 0.05;
      const ribbon = (off, w, col, a) => {
        ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = w * s;
        ctx.beginPath();
        ctx.moveTo((-len / 2) * s, off * s);
        ctx.bezierCurveTo((-len / 6) * s, (off + wave) * s, (len / 6) * s, (off + wave2) * s, (len / 2) * s, off * s);
        ctx.stroke();
      };
      ribbon(0, width, shade(k), alpha);
      // traces des poils : quelques lignes fines, un peu plus claires et plus foncées, sur une partie du ruban
      for (let i = 0; i < bristles; i++) ribbon((R() - 0.5) * width * 0.9, Math.max(0.6 / s, width * 0.06), shade(i % 2 ? k * 1.06 : k * 0.94), alpha * 0.8);
      ctx.restore();
    };
    // première couche : en biais, larges, qui traversent la toile
    const n1 = Math.round(diag / 2.2);
    for (let i = 0; i < n1; i++) stroke(R() * W, R() * H, diag * (0.5 + R() * 0.6), -0.75 + (R() - 0.5) * 0.35, 1.6 + R() * 2.2, 0.86 + R() * 0.3, 0.1 + R() * 0.08, 5);
    // seconde couche : presque horizontale, plus marquée, en passes qui se recouvrent
    const n2 = Math.round(H / 1.1);
    for (let i = 0; i < n2; i++) {
      const y = (i + 0.5) * (H / n2) + (R() - 0.5) * 2;
      const len = W * (0.45 + R() * 0.7);
      stroke(R() * W, y, len, (R() - 0.5) * 0.06, 1.2 + R() * 1.8, 0.88 + R() * 0.26, 0.12 + R() * 0.12, 7);
    }
    // couche inégale : de larges zones à peine plus claires ou plus foncées
    for (let i = 0; i < 10; i++) {
      const cx = R() * pw, cy = R() * ph, rad = Math.max(pw, ph) * (0.15 + R() * 0.3);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, shade(R() < 0.5 ? 0.93 : 1.07)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, pw, ph);
    }
    ctx.globalAlpha = 1;
    if (paintCache.size > 6) paintCache.delete(paintCache.keys().next().value);
    paintCache.set(key, c);
    return c;
  }

  // Le fond de la toile : toile nue (papier) ou aplat de peinture avec ses coups de brosse.
  function renderGround(ctx, comp, s) {
    ctx.fillStyle = comp.ground || '#f8f5ef';
    ctx.fillRect(0, 0, comp.W * s, comp.H * s);
    if (comp.ground && comp.paint !== false) {
      ctx.drawImage(paintCanvas(comp.ground, comp.W, comp.H, s), 0, 0, comp.W * s, comp.H * s);
    }
  }

  function renderBg(ctx, comp, s, shadows) {
    renderGround(ctx, comp, s);
    comp.bg.forEach((L) => drawLayer(ctx, L, s, shadows));
    if (comp.frames) {
      // galerie : le cadre noir de chaque case, peint au trait
      ctx.save();
      ctx.strokeStyle = '#1c1b15';
      ctx.lineWidth = (comp.frameWidth || 0.3) * s;
      comp.frames.forEach((f) => ctx.strokeRect(f.x * s, f.y * s, f.w * s, f.h * s));
      ctx.restore();
    }
    if (comp.lead) {
      // vitrail : le plomb, un trait noir peint le long des bords de chaque fragment
      ctx.save();
      ctx.strokeStyle = 'rgba(22,20,16,0.92)';
      ctx.lineWidth = comp.lead * s;
      ctx.lineJoin = 'round';
      comp.bg.forEach((L) => {
        if (!L.panel) return;
        ctx.save();
        ctx.translate(L.x * s, L.y * s);
        ctx.rotate(L.rot);
        ctx.beginPath();
        const pts = L.clip || [[-L.w / 2, -L.h / 2], [L.w / 2, -L.h / 2], [L.w / 2, L.h / 2], [-L.w / 2, L.h / 2]];
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      });
      ctx.restore();
    }
    if (comp.lines) {
      // traits de crayon reliant les étoiles de la constellation
      ctx.save();
      ctx.strokeStyle = 'rgba(40,25,10,0.55)';
      ctx.lineWidth = 0.18 * s;
      ctx.setLineDash([1.2 * s, 0.8 * s]);
      ctx.beginPath();
      comp.lines.forEach(([x0, y0, x1, y1]) => { ctx.moveTo(x0 * s, y0 * s); ctx.lineTo(x1 * s, y1 * s); });
      ctx.stroke();
      ctx.restore();
    }
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

  window.Compose = { generate, addPiece, renderBg, renderGround, renderItems, renderFinish, drawLayer, hitItem, rng };
})();
