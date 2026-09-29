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
  function spiralPoint(W, H, i, n) {
    const t = Math.sqrt((i + 0.5) / Math.max(1, n));
    const a = i * GOLDEN;
    // légère inclinaison dans le sens de la rotation, pour l'effet de tourbillon
    let tan = ((a + Math.PI / 2) % Math.PI) - Math.PI / 2;
    tan = clamp(tan, -1.2, 1.2) * 0.3 * t;
    return { x: W / 2 + W * 0.47 * t * Math.cos(a), y: H / 2 + H * 0.47 * t * Math.sin(a), rot: tan, r: t };
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
   *  2. le reste de la page est déchiré en lambeaux de 4 à 9 cm, sans rien jeter ;
   *  3. les grands morceaux sont posés d'abord (dans leur zone), puis les lambeaux vont boucher
   *     les trous, du plus grand au plus petit, jusqu'à ce que tout le papier soit collé.
   */
  function tearPage(t, R) {
    const pw = t.canvas.width, ph = t.canvas.height, k = pw / t.wcm;
    const sw = Math.round(pw * (0.7 + 0.18 * R())), sh = Math.round(ph * (0.74 + 0.14 * R()));
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
      const nThick = thick / k > 7 ? 2 : 1;
      const tPx = Math.floor(thick / nThick);
      let pos = 0;
      while (pos < along) {
        const len = Math.min(along - pos, Math.round((4 + R() * 5) * k));
        if (len < 1.5 * k && scraps.length) { // trop petit : on l'ajoute au précédent
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
    return { panel, scraps, k };
  }

  function background(W, H, texs, Z, R, out, spiral) {
    const cov = Coverage(W, H);
    const panels = [], scrapPool = [];
    // les pages pâles d'abord (dessous), puis les pages colorées par-dessus
    const imp = (t) => (t.importance === undefined ? 1 : t.importance);
    const order = texs.slice().sort((a, b) => imp(a) - imp(b) || (a.colorful || 0) - (b.colorful || 0));
    order.forEach((t, i) => {
      const cut = tearPage(t, R);
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
        kind: 'bg', panel: true, src: t.canvas, pageW: t.wcm, pageH: t.hcm,
        sx: cut.panel.x, sy: cut.panel.y, sw: cut.panel.w, sh: cut.panel.h,
        x: best.cx, y: best.cy, w, h, rot: best.rot, flip: false,
        clip: tornPolygon(w, h, R, TEAR),
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

  // ---------- Placement des découpes ----------

  /*
   * TOUTES les découpes sont placées. Règles de composition :
   *  - chaque sujet va dans la zone décidée (ciel / milieu / sol) ; les sujets « posés »
   *    reposent sur une ligne de sol de leur zone, les autres flottent ;
   *  - les pièces maîtresses vont sur les points forts (règle des tiers) ;
   *  - équilibre des masses, couleurs voisines variées, sujets répartis sur toute la toile ;
   *  - chevauchements réduits au minimum ; profondeur : ce qui est plus bas passe devant.
   */
  function placePieces(W, H, pieces, o, Z, R, spiral) {
    const gw = Math.ceil(W), gh = Math.ceil(H);
    const occ = new Uint8Array(gw * gh);
    const thirds = [[W / 3, H / 3], [(2 * W) / 3, H / 3], [W / 3, (2 * H) / 3], [(2 * W) / 3, (2 * H) / 3]];
    const usedThirds = new Set();
    const placed = [];
    let mass = 0, mx = 0, my = 0;
    const maxRot = (o.rotation * Math.PI) / 180;
    const weight = (p) => Math.sqrt(p.wcm * p.hcm) * Math.pow(Math.max(0.05, p.colorful), 1.3) * (p.importance || 1);
    const sorted = pieces.slice().sort((a, b) => weight(b) - weight(a));
    const stars = new Set(sorted.filter((p) => (p.importance || 1) >= 3).slice(0, 4));
    if (!stars.size) sorted.slice(0, 3).forEach((p) => stars.add(p));

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
      const band = Z[p.zone] || [0, H];
      const grounded = !spiral && !!p.grounded;
      const pHue = hue(p.color);
      const w8 = p.wcm * p.hcm * (0.3 + p.colorful);
      const star = !spiral && stars.has(p);
      let best = null;
      // Tournesol : chaque sujet vise son point de la spirale, les pièces maîtresses au cœur.
      const target = spiral ? spiralPoint(W, H, idx, sorted.length) : null;
      for (let c = 0; c < 110 && target; c++) {
        const k = 0.1 + (c / 110) * 1.2;
        const cx = target.x + (R() - 0.5) * p.wcm * k, cy = target.y + (R() - 0.5) * p.hcm * k;
        let cells = 0, over = 0, out = 0;
        footprint(p, cx, cy, (gx, gy) => {
          cells++;
          if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) out++;
          else if (occ[gy * gw + gx]) over++;
        });
        if (!cells) continue;
        const score = (over / cells) * 3 + (out / cells) * 5 + Math.hypot(cx - target.x, cy - target.y) / (W * 0.15) + R() * 0.03;
        if (!best || score < best.score) best = { cx, cy, score, r: target.r, rot: target.rot };
      }
      for (let c = 0; c < 110 && !target; c++) {
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
        let cells = 0, over = 0, out = 0;
        footprint(p, cx, cy, (gx, gy) => {
          cells++;
          if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) out++;
          else if (occ[gy * gw + gx]) over++;
        });
        if (!cells) continue;
        let score = (over / cells) * 3 + (out / cells) * 5;
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
        if (!best || score < best.score) best = { cx, cy, score };
      }
      if (!best) best = { cx: W / 2, cy: H / 2 };
      footprint(p, best.cx, best.cy, (gx, gy) => { if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) occ[gy * gw + gx] = 1; });
      if (star) {
        let bi = -1, bd = Infinity;
        thirds.forEach(([tx, ty], i) => { const d = Math.hypot(tx - best.cx, ty - best.cy); if (!usedThirds.has(i) && d < bd) { bd = d; bi = i; } });
        if (bi >= 0 && bd < W * 0.15) usedThirds.add(bi);
      }
      mass += w8; mx += best.cx * w8; my += best.cy * w8;
      p.placed = true;
      const rot = best.rot !== undefined ? best.rot + (R() - 0.5) * maxRot : (R() - 0.5) * 2 * (grounded ? Math.min(maxRot, 0.05) : maxRot);
      placed.push({ kind: 'piece', piece: p, x: best.cx, y: best.cy, w: p.wcm, h: p.hcm, rot, flip: false, grounded, r: best.r });
    });

    // spirale : l'extérieur d'abord, le cœur par-dessus
    if (spiral) return placed.sort((a, b) => b.r - a.r);
    const g = placed.filter((L) => L.grounded).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
    const f = placed.filter((L) => !L.grounded).sort((a, b) => b.w * b.h - a.w * a.h);
    return g.concat(f);
  }

  /*
   * Cabinet de curiosités : chaque dessin exposé droit, en rangées alignées sur des « étagères »,
   * sur papier blanc et sans chevauchement. On cherche la plus grande échelle (toujours la même
   * pour tous, jamais plus grande que la taille réelle) qui fait tout tenir.
   */
  function cabinet(W, H, texs, pieces, o, R) {
    const gap = 1.2;
    const all = texs.map((t) => ({ t, w: t.wcm, h: t.hcm })).concat(pieces.map((p) => ({ p, w: p.wcm, h: p.hcm })));
    all.sort((a, b) => b.h - a.h);
    const shelve = (f) => {
      const rows = [];
      let row = [], x = gap;
      for (const it of all) {
        const w = it.w * f;
        if (w > W - 2 * gap) return null;
        if (row.length && x + w + gap > W) { rows.push(row); row = []; x = gap; }
        row.push(it);
        x += w + gap;
      }
      if (row.length) rows.push(row);
      const height = rows.reduce((s, r) => s + Math.max(...r.map((it) => it.h * f)), 0) + gap * (rows.length + 1);
      return height <= H ? rows : null;
    };
    let lo = 0.05, hi = Math.min(3, 1 / Math.max(0.01, o.scale));
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (shelve(mid)) lo = mid; else hi = mid; }
    const f = lo;
    const rows = shelve(f) || [];
    const heights = rows.map((r) => Math.max(...r.map((it) => it.h * f)));
    const free = H - heights.reduce((a, b) => a + b, 0);
    const vgap = free / (rows.length + 1);
    const bg = [], items = [];
    let y = vgap;
    rows.forEach((row, ri) => {
      const r = shuffle(row, R);
      const rowW = r.reduce((s, it) => s + it.w * f, 0);
      const hgap = Math.min((W - rowW) / (r.length + 1), 6);
      let x = (W - rowW - hgap * (r.length - 1)) / 2;
      r.forEach((it) => {
        const w = it.w * f, h = it.h * f;
        const cx = x + w / 2, cy = y + heights[ri] - h / 2; // posé sur l'étagère
        if (it.t) bg.push({ kind: 'bg', panel: true, src: it.t.canvas, pageW: it.t.wcm, pageH: it.t.hcm, sx: 0, sy: 0, sw: it.t.canvas.width, sh: it.t.canvas.height, x: cx, y: cy, w, h, rot: 0, flip: false, clip: null });
        else { it.p.placed = true; items.push({ kind: 'piece', piece: it.p, x: cx, y: cy, w, h, rot: 0, flip: false }); }
        x += w + hgap;
      });
      y += heights[ri] + vgap;
    });
    return { bg, items, f };
  }

  function paperLayer(W, H) {
    const c = paperTexture();
    return { kind: 'bg', paper: true, src: c, x: W / 2, y: H / 2, w: W, h: H, rot: 0, flip: false, clip: null, sx: 0, sy: 0, sw: c.width, sh: c.height };
  }

  // Styles : 'paysage' (ciel, milieu, sol), 'tournesol' (spirale), 'cabinet' (rangées alignées).
  function generate(o) {
    const W = o.format.w, H = o.format.h;
    const R = rng(o.seed);
    const style = o.style || 'paysage';
    if (style === 'cabinet') {
      const cab = cabinet(W, H, o.textures, o.pieces, o, R);
      return { W, H, bg: [paperLayer(W, H), ...cab.bg], items: cab.items, grain: o.grain, style, f: cab.f, scale: o.scale * cab.f };
    }
    const spiral = style === 'tournesol';
    const Z = zonesFor(W, H, !spiral);
    const bg = [];
    if (o.textures.length) background(W, H, o.textures, Z, R, bg, spiral);
    else bg.push(paperLayer(W, H));
    const items = placePieces(W, H, o.pieces, o, Z, R, spiral);
    return { W, H, bg, items, grain: o.grain, style, f: 1, scale: o.scale };
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

  function renderBg(ctx, comp, s, shadows) {
    ctx.fillStyle = '#f8f5ef';
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
