/*
 * Analyse des dessins scannés.
 *  - estime la couleur du papier (blanc, ou papier de couleur),
 *  - détecte la feuille réelle quand le scan a des marges,
 *  - classe la page en « fond » (page entièrement peinte) ou « découpe »,
 *  - découpe les sujets comme avec des ciseaux, en gardant une petite marge de papier.
 */
(function () {
  'use strict';

  const WORK_MAX = 640;          // taille de travail pour l'analyse
  const FINE_MAX = 3000;         // taille de travail pour le contour fin des découpes (suit la page)
  const INK_DIST = 55;           // écart au papier au-delà duquel un pixel est « dessiné »
  const PAPER_DIST = 42;         // écart en deçà duquel un pixel est considéré comme papier
  const TEXTURE_MAX_PAPER = 0.38; // moins de 38 % de papier visible => page peinte => fond
  const MAX_PIECES_PER_PAGE = 8;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // Un canevas qui ne sert plus est vidé tout de suite : Safari (iPhone) compte la mémoire des
  // canevas jusqu'à leur ramassage, et efface la page quand la limite est dépassée.
  function release(c) { if (c && c.width) { c.width = 0; c.height = 0; } }

  function ctx2d(c) {
    return c.getContext('2d', { willReadFrequently: true });
  }

  function scaleTo(src, maxSide) {
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    const c = makeCanvas(src.width * s, src.height * s);
    const ctx = ctx2d(c);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function crop(src, x, y, w, h) {
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    w = Math.min(src.width - x, Math.round(w));
    h = Math.min(src.height - y, Math.round(h));
    const c = makeCanvas(w, h);
    ctx2d(c).drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }

  function lum(c) {
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  }

  function sat(c) {
    const mx = Math.max(c[0], c[1], c[2]);
    const mn = Math.min(c[0], c[1], c[2]);
    return mx === 0 ? 0 : (mx - mn) / mx;
  }

  function forEachBorder(w, h, band, cb) {
    for (let y = 0; y < h; y++) {
      const fullRow = y < band || y >= h - band;
      for (let x = 0; x < w; x++) {
        if (!fullRow && x === band) x = w - band;
        cb(y * w + x);
      }
    }
  }

  // Couleur dominante de la bordure de l'image = couleur du papier.
  function estimatePaper(d, w, h) {
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
    const count = new Uint32Array(512);
    const sums = new Float64Array(512 * 3);
    forEachBorder(w, h, band, (p) => {
      const i = p * 4;
      const k = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
      count[k]++;
      sums[k * 3] += d[i];
      sums[k * 3 + 1] += d[i + 1];
      sums[k * 3 + 2] += d[i + 2];
    });
    let best = 0;
    for (let k = 1; k < 512; k++) if (count[k] > count[best]) best = k;
    const n = count[best] || 1;
    const guess = [sums[best * 3] / n, sums[best * 3 + 1] / n, sums[best * 3 + 2] / n];
    // Affinage : moyenne des pixels de bordure proches de cette couleur.
    let r = 0, g = 0, b = 0, m = 0;
    forEachBorder(w, h, band, (p) => {
      const i = p * 4;
      const dr = d[i] - guess[0], dg = d[i + 1] - guess[1], db = d[i + 2] - guess[2];
      if (dr * dr + dg * dg + db * db < 40 * 40) {
        r += d[i]; g += d[i + 1]; b += d[i + 2]; m++;
      }
    });
    return m ? [r / m, g / m, b / m] : guess;
  }

  // Médiane par canal des pixels de bordure.
  function borderMedian(d, w, h, keep) {
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
    const ch = [[], [], []];
    forEachBorder(w, h, band, (p) => { if (keep && !keep(p)) return; const i = p * 4; ch[0].push(d[i]); ch[1].push(d[i + 1]); ch[2].push(d[i + 2]); });
    return ch.map((arr) => { arr.sort((a, b) => a - b); return arr[arr.length >> 1] || 0; });
  }
  // Pixels de bordure qui ne sont pas du papier blanc : une feuille photographiée de près touche
  // les bords, et la surface (sol, table) n'occupe alors qu'une partie de la bordure.
  function surfaceBorder(d, w, h) {
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
    const paperLike = (p) => {
      const i = p * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      if (!(0.299 * r + 0.587 * g + 0.114 * b > 205)) return false;
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      return (mx === 0 ? 0 : (mx - mn) / mx) < 0.16;
    };
    let n = 0, paper = 0;
    forEachBorder(w, h, band, (p) => { n++; if (paperLike(p)) paper++; });
    const share = paper / Math.max(1, n);
    // la surface doit rester visible sur au moins 10 % de la bordure
    if (share < 0.25 || share > 0.9) return null;
    return (p) => !paperLike(p);
  }

  // Distance (chanfrein) de chaque pixel au plus proche pixel à 1.
  function distanceField(src, w, h) {
    const INF = 1e9;
    const D2 = Math.SQRT2;
    const d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
    // (le minimum des mêmes candidats que Math.min, sans les tests de bord au milieu des lignes :
    // c'est le calcul le plus répété de l'analyse)
    let t, v, i;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      if (y === 0) {
        for (let x = 1; x < w; x++) { i = x; v = d[i]; if (v === 0) continue; t = d[i - 1] + 1; if (t < v) d[i] = t; }
        continue;
      }
      // x = 0
      i = row; v = d[i];
      if (v !== 0) {
        t = d[i - w] + 1; if (t < v) v = t;
        if (w > 1) { t = d[i - w + 1] + D2; if (t < v) v = t; }
        d[i] = v;
      }
      for (let x = 1; x < w - 1; x++) {
        i = row + x; v = d[i];
        if (v === 0) continue;
        t = d[i - 1] + 1; if (t < v) v = t;
        t = d[i - w] + 1; if (t < v) v = t;
        t = d[i - w - 1] + D2; if (t < v) v = t;
        t = d[i - w + 1] + D2; if (t < v) v = t;
        d[i] = v;
      }
      if (w > 1) {
        i = row + w - 1; v = d[i];
        if (v !== 0) {
          t = d[i - 1] + 1; if (t < v) v = t;
          t = d[i - w] + 1; if (t < v) v = t;
          t = d[i - w - 1] + D2; if (t < v) v = t;
          d[i] = v;
        }
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      const row = y * w;
      if (y === h - 1) {
        for (let x = w - 2; x >= 0; x--) { i = row + x; v = d[i]; if (v === 0) continue; t = d[i + 1] + 1; if (t < v) d[i] = t; }
        continue;
      }
      // x = w - 1
      i = row + w - 1; v = d[i];
      if (v !== 0) {
        t = d[i + w] + 1; if (t < v) v = t;
        if (w > 1) { t = d[i + w - 1] + D2; if (t < v) v = t; }
        d[i] = v;
      }
      for (let x = w - 2; x >= 1; x--) {
        i = row + x; v = d[i];
        if (v === 0) continue;
        t = d[i + 1] + 1; if (t < v) v = t;
        t = d[i + w] + 1; if (t < v) v = t;
        t = d[i + w + 1] + D2; if (t < v) v = t;
        t = d[i + w - 1] + D2; if (t < v) v = t;
        d[i] = v;
      }
      if (w > 1) {
        i = row; v = d[i];
        if (v !== 0) {
          t = d[i + 1] + 1; if (t < v) v = t;
          t = d[i + w] + 1; if (t < v) v = t;
          t = d[i + w + 1] + D2; if (t < v) v = t;
          d[i] = v;
        }
      }
    }
    return d;
  }

  function dilate(mask, w, h, r) {
    const d = distanceField(mask, w, h);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = d[i] <= r ? 1 : 0;
    return out;
  }

  function erode(mask, w, h, r) {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
    const d = distanceField(inv, w, h);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = d[i] > r ? 1 : 0;
    return out;
  }

  // Bouche les trous : tout ce qui n'est pas relié au bord par du vide devient plein.
  function fillHoles(mask, w, h) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h); // chaque pixel n'y entre qu'une fois
    let top = 0;
    const push = (i) => {
      if (!mask[i] && !seen[i]) { seen[i] = 1; stack[top++] = i; }
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (top) {
      const i = stack[--top];
      const x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < w * (h - 1)) push(i + w);
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = seen[i] ? 0 : 1;
    return out;
  }

  function components(mask, w, h) {
    const labels = new Int32Array(w * h);
    const comps = [];
    const stack = new Int32Array(w * h); // chaque pixel n'y entre qu'une fois
    let next = 1;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      let area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, top = 0;
      labels[start] = next;
      stack[top++] = start;
      while (top) {
        const i = stack[--top];
        const x = i % w, y = (i - x) / w;
        area++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        let j;
        if (x > 0) { j = i - 1; if (mask[j] && !labels[j]) { labels[j] = next; stack[top++] = j; } }
        if (x < w - 1) { j = i + 1; if (mask[j] && !labels[j]) { labels[j] = next; stack[top++] = j; } }
        if (y > 0) { j = i - w; if (mask[j] && !labels[j]) { labels[j] = next; stack[top++] = j; } }
        if (y < h - 1) { j = i + w; if (mask[j] && !labels[j]) { labels[j] = next; stack[top++] = j; } }
      }
      comps.push({ id: next, area, x0, y0, x1, y1 });
      next++;
    }
    return { labels, comps };
  }

  // Moyenne 3 × 3 d'un masque 0/1 (bord adouci d'un pixel) : les sommes sont entières, donc exactes
  // quel que soit l'ordre ; seuls les bords de l'image ont moins de 9 voisins.
  function softEdge(m, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const edgeRow = y === 0 || y === h - 1;
      for (let x = 0; x < w; x++) {
        if (edgeRow || x === 0 || x === w - 1) {
          let s = 0, c = 0;
          for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; s += m[yy * w + xx]; c++; } }
          out[y * w + x] = s / c;
          continue;
        }
        const i = y * w + x;
        if (!(m[i - w - 1] | m[i - w] | m[i - w + 1] | m[i - 1] | m[i] | m[i + 1] | m[i + w - 1] | m[i + w] | m[i + w + 1])) continue; // 0 / 9 = 0
        out[i] = (m[i - w - 1] + m[i - w] + m[i - w + 1] + m[i - 1] + m[i] + m[i + 1] + m[i + w - 1] + m[i + w] + m[i + w + 1]) / 9;
      }
    }
    return out;
  }

  function boxBlur(a, w, h) {
    const out = new Float32Array(a.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            s += a[yy * w + xx]; n++;
          }
        }
        out[y * w + x] = s / n;
      }
    }
    return out;
  }

  // Segmentation d'une page : papier, pixels dessinés, zones découpables.
  function segment(page) {
    const work = scaleTo(page, WORK_MAX);
    const w = work.width, h = work.height, n = w * h;
    const data = ctx2d(work).getImageData(0, 0, w, h).data;
    const paper = estimatePaper(data, w, h);
    let paperCount = 0;
    const U2 = PAPER_DIST * PAPER_DIST;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const dr = data[i] - paper[0], dg = data[i + 1] - paper[1], db = data[i + 2] - paper[2];
      if (dr * dr + dg * dg + db * db < U2) paperCount++;
    }
    const weakT = weakThreshold(data, w, h, paper);
    const ink = inkMask(data, w, h, paper, INK_DIST, weakT);
    // Les bords du scan (ombres, bord de feuille) ne sont pas du dessin.
    const m = Math.max(2, Math.round(Math.min(w, h) * 0.015));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < m || y < m || x >= w - m || y >= h - m) ink[y * w + x] = 0;
      }
    }
    const unit = Math.max(w, h);
    // regroupe les traits d'un même sujet, puis ne garde qu'une marge de papier de quelques millimètres
    // (≈ 3 mm sur un A4), comme une découpe aux ciseaux qui suit le dessin
    let mask = dilate(ink, w, h, unit * 0.014);
    mask = fillHoles(mask, w, h);
    mask = erode(mask, w, h, unit * 0.005);
    const { labels, comps } = components(mask, w, h);
    comps.sort((a, b) => b.area - a.area);
    return { work, data, w, h, paper, weakT, paperFrac: paperCount / n, labels, comps };
  }

  /*
   * Encre à deux seuils (hystérésis) : un pixel franchement différent du papier est dessiné ; un pixel
   * seulement un peu différent (couleur pâle, crayon léger, dégradé) l'est aussi s'il touche, de
   * proche en proche, un pixel franc. Le bruit du papier, isolé, ne passe pas.
   */
  function weakThreshold(d, w, h, paper) {
    // écart typique du papier lui-même (grain, ombres légères), mesuré sur la bordure
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
    const dist = [];
    forEachBorder(w, h, band, (p) => { const i = p * 4; dist.push(Math.hypot(d[i] - paper[0], d[i + 1] - paper[1], d[i + 2] - paper[2])); });
    dist.sort((a, b) => a - b);
    const q90 = dist[Math.min(dist.length - 1, Math.floor(dist.length * 0.9))] || 0;
    return Math.max(24, Math.min(INK_DIST - 5, q90 * 1.6 + 8));
  }
  function inkMask(d, w, h, paper, strongT, weakT) {
    const n = w * h;
    const weak = new Uint8Array(n);
    const ink = new Uint8Array(n);
    const stack = [];
    const S2 = strongT * strongT, W2 = weakT * weakT;
    const pl = lum(paper);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const dr = d[i] - paper[0], dg = d[i + 1] - paper[1], db = d[i + 2] - paper[2];
      const q = dr * dr + dg * dg + db * db;
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const mx = R > G ? (R > B ? R : B) : (G > B ? G : B), mn = R < G ? (R < B ? R : B) : (G < B ? G : B);
      if (mx - mn < 0.15 * mx) {
        // gris neutre : un reste d'ombre (pli, bord) reste à moins de ≈ 30 du papier ; un trait de
        // crayon descend plus bas
        const dl = pl - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        if (dl > 30) weak[p] = 1;
        if (dl > 45) { ink[p] = 1; stack.push(p); }
        continue;
      }
      if (q > W2) weak[p] = 1;
      if (q > S2) { ink[p] = 1; stack.push(p); }
    }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      let q;
      if (x > 0) { q = p - 1; if (weak[q] && !ink[q]) { ink[q] = 1; stack.push(q); } }
      if (x < w - 1) { q = p + 1; if (weak[q] && !ink[q]) { ink[q] = 1; stack.push(q); } }
      if (p >= w) { q = p - w; if (weak[q] && !ink[q]) { ink[q] = 1; stack.push(q); } }
      if (p < n - w) { q = p + w; if (weak[q] && !ink[q]) { ink[q] = 1; stack.push(q); } }
    }
    return ink;
  }

  /*
   * Éclairage inégal d'un scan ou d'une photo de feuille : ombre d'un pli, bord ombré, lumière qui
   * baisse d'un côté. On estime, case par case, la couleur du papier (les plus clairs des pixels peu
   * saturés de la case), on écarte les cases nettement plus sombres que leurs voisines (un aplat noir
   * n'est pas du papier), on complète les cases sans papier visible à partir de leurs voisines, on
   * lisse, puis on ramène partout le papier au blanc : les ombres disparaissent et ne sont plus prises
   * pour du dessin. Rend null si la page n'a pas assez de papier visible (page peinte) : elle est
   * alors laissée telle quelle.
   */
  function illumination(src) {
    const work = scaleTo(src, 640);
    const w = work.width, h = work.height;
    const d = ctx2d(work).getImageData(0, 0, w, h).data;
    release(work);
    // cases fines (≈ 1/100 de la page) : l’ombre d’un pli est une bande étroite
    const cell = Math.max(4, Math.round(Math.max(w, h) / 100));
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), G = gw * gh;
    const bg = new Float32Array(G * 3), ok = new Uint8Array(G), L = new Float32Array(G);
    const idx = [], lv = [];
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      idx.length = 0; lv.length = 0;
      let total = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++) for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
        total++;
        const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        if (l <= 60) continue;
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        if ((mx === 0 ? 0 : (mx - mn) / mx) < 0.32) { idx.push(i); lv.push(l); }
      }
      if (idx.length < total * 0.15) continue;
      const order = lv.map((l, k) => k).sort((p, q) => lv[p] - lv[q]);
      // du papier (même dans l'ombre) est lisse : entre la médiane et le haut de la case, la clarté
      // varie peu ; un lavis ou une matière (aquarelle grise, crayon) est granuleux
      const lMed = lv[order[order.length >> 1]], lTop = lv[order[Math.floor(order.length * 0.95)]];
      if ((lTop - lMed) / Math.max(1, lTop) > 0.09) continue;
      let r = 0, g = 0, b = 0, m = 0;
      for (let k = Math.floor(order.length * 0.8); k < order.length; k++) { const i = idx[order[k]]; r += d[i]; g += d[i + 1]; b += d[i + 2]; m++; }
      const c0 = gy * gw + gx;
      bg[c0 * 3] = r / m; bg[c0 * 3 + 1] = g / m; bg[c0 * 3 + 2] = b / m;
      L[c0] = lum([r / m, g / m, b / m]);
      ok[c0] = 1;
    }
    let nOk = 0;
    for (let c = 0; c < G; c++) nOk += ok[c];
    if (nOk < G * 0.2) return null;
    // papier de référence : la moitié la plus claire des cases (papier bien éclairé)
    const okL = [];
    for (let c = 0; c < G; c++) if (ok[c]) okL.push(c);
    okL.sort((p, q) => L[q] - L[p]);
    const top = okL.slice(0, Math.max(1, okL.length >> 1));
    const med = (f) => { const v = top.map(f).sort((a, b) => a - b); return v[v.length >> 1]; };
    const chr = (c, k) => bg[c * 3 + k] / Math.max(1, bg[c * 3] + bg[c * 3 + 1] + bg[c * 3 + 2]);
    const refL = med((c) => L[c]), refR = med((c) => chr(c, 0)), refG = med((c) => chr(c, 1));
    // le papier de référence doit être blanc ou crème : une page peinte en couleur pâle (un ciel) n'a
    // pas de papier visible, on n'y touche pas
    const refRGB = [refR, refG, 1 - refR - refG].map((v) => v * 3 * refL);
    if (refL < 150 || sat(refRGB) > 0.14) return null;
    // une case franchement sombre est un aplat neutre (feutre noir, crayon appuyé), pas du papier
    // dans l’ombre : l’ombre d’un pli reste claire (au-dessus de ≈ 62 % du papier voisin)
    const keep = ok.slice();
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const c = gy * gw + gx;
      if (!ok[c]) continue;
      const near = [];
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const yy = gy + dy, xx = gx + dx;
        if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
        const q = yy * gw + xx;
        if (ok[q]) near.push(L[q]);
      }
      near.sort((p, q) => p - q);
      const ref = near[Math.floor(near.length * 0.75)];
      if (L[c] < 100 || L[c] < ref * 0.62) { keep[c] = 0; continue; }
      // une ombre sur le papier fonce et se réchauffe à la fois ; une matière plus froide (feutrine
      // bleue), d'une autre teinte, ou colorée sans être sombre (aplat pâle) n'est pas du papier
      const dark = Math.max(0, 1 - L[c] / refL);
      const dr = chr(c, 0) - refR, dg = chr(c, 1) - refG;
      if (dr < -0.015 || Math.abs(dg) > 0.02 || dr > 0.2 * dark + 0.012) keep[c] = 0;
    }
    // il faut voir du papier sur une bonne part de la page (sinon : page peinte, nuages blancs…)
    let nKeep = 0;
    for (let c = 0; c < G; c++) nKeep += keep[c];
    if (nKeep < G * 0.3) return null;
    // cases sans papier : complétées de proche en proche par la moyenne de leurs voisines connues
    const known = keep.slice();
    for (let pass = 0; pass < gw + gh; pass++) {
      const add = [];
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        const c = gy * gw + gx;
        if (known[c]) continue;
        let r = 0, g = 0, b = 0, m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = gy + dy, xx = gx + dx;
          if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          const q = yy * gw + xx;
          if (known[q]) { r += bg[q * 3]; g += bg[q * 3 + 1]; b += bg[q * 3 + 2]; m++; }
        }
        if (m) add.push([c, r / m, g / m, b / m]);
      }
      if (!add.length) break;
      add.forEach(([c, r, g, b]) => { bg[c * 3] = r; bg[c * 3 + 1] = g; bg[c * 3 + 2] = b; known[c] = 1; });
    }
    // lissage léger (une passe 3 × 3)
    for (let pass = 0; pass < 1; pass++) {
      const nb = new Float32Array(bg.length);
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        let r = 0, g = 0, b = 0, m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const q = Math.min(gh - 1, Math.max(0, gy + dy)) * gw + Math.min(gw - 1, Math.max(0, gx + dx));
          r += bg[q * 3]; g += bg[q * 3 + 1]; b += bg[q * 3 + 2]; m++;
        }
        const c = gy * gw + gx;
        nb[c * 3] = r / m; nb[c * 3 + 1] = g / m; nb[c * 3 + 2] = b / m;
      }
      bg.set(nb);
    }
    return { gw, gh, cell: cell * (src.width / w), bg };
  }

  // Ramène le papier au blanc partout (voir illumination) ; la page est rendue telle quelle si
  // l'éclairage ne peut pas être estimé. inPlace : corrige la page elle-même, sans en faire de copie
  // (la mémoire des images est comptée au plus juste sur téléphone).
  const PAPER_WHITE = 250;
  function flatten(src, inPlace) {
    const ill = illumination(src);
    flatten.debug = null;
    if (!ill) return src;
    const { gw, gh, cell, bg } = ill;
    // gain par case, borné (une case très sombre ne doit pas exploser)
    const gain = new Float32Array(bg.length);
    let lo = Infinity, hi = 0;
    for (let k = 0; k < bg.length; k++) {
      gain[k] = Math.min(2.5, PAPER_WHITE / Math.max(40, bg[k]));
      if (k % 3 === 1) { lo = Math.min(lo, bg[k]); hi = Math.max(hi, bg[k]); }
    }
    flatten.debug = { lo: Math.round(lo), hi: Math.round(hi) };
    const out = inPlace ? src : makeCanvas(src.width, src.height);
    const ctx = ctx2d(out);
    if (!inPlace) ctx.drawImage(src, 0, 0);
    const W = out.width, H = out.height;
    const img = ctx.getImageData(0, 0, W, H), px = img.data;
    const X0 = new Int32Array(W), X1 = new Int32Array(W), TX = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      const fx = Math.min(gw - 1, Math.max(0, x / cell - 0.5)), x0 = Math.floor(fx);
      X0[x] = x0; X1[x] = Math.min(gw - 1, x0 + 1); TX[x] = fx - x0;
    }
    // gains interpolés en x le long des deux rangées de cases encadrant la ligne : recalculés quand
    // ces rangées changent (toutes les ≈ 25 lignes), avec les mêmes opérations qu'avant
    const TOP = new Float64Array(W * 3), BOT = new Float64Array(W * 3);
    let rowY0 = -1, rowY1 = -1;
    for (let y = 0; y < H; y++) {
      const fy = Math.min(gh - 1, Math.max(0, y / cell - 0.5)), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
      if (y0 !== rowY0 || y1 !== rowY1) {
        rowY0 = y0; rowY1 = y1;
        for (let x = 0; x < W; x++) {
          const x0 = X0[x], x1 = X1[x], tx = TX[x];
          const a = (y0 * gw + x0) * 3, b = (y0 * gw + x1) * 3, c = (y1 * gw + x0) * 3, e = (y1 * gw + x1) * 3;
          for (let ch = 0; ch < 3; ch++) {
            TOP[x * 3 + ch] = gain[a + ch] + (gain[b + ch] - gain[a + ch]) * tx;
            BOT[x * 3 + ch] = gain[c + ch] + (gain[e + ch] - gain[c + ch]) * tx;
          }
        }
      }
      for (let x = 0, i = y * W * 4, k = 0; x < W; x++, i += 4, k += 3) {
        let top = TOP[k], bot = BOT[k];
        px[i] = px[i] * (top + (bot - top) * ty);
        top = TOP[k + 1]; bot = BOT[k + 1];
        px[i + 1] = px[i + 1] * (top + (bot - top) * ty);
        top = TOP[k + 2]; bot = BOT[k + 2];
        px[i + 2] = px[i + 2] * (top + (bot - top) * ty);
      }
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  // Blanchit le papier et ravive les couleurs, comme une photo bien exposée.
  function enhance(page, paper) {
    const c = makeCanvas(page.width, page.height);
    const ctx = ctx2d(c);
    ctx.drawImage(page, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const whiten = paper && lum(paper) > 150 && sat(paper) < 0.3;
    const kr = whiten ? 255 / Math.max(paper[0], 1) : 1;
    const kg = whiten ? 255 / Math.max(paper[1], 1) : 1;
    const kb = whiten ? 255 / Math.max(paper[2], 1) : 1;
    const boost = 1.15;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] * kr, g = d[i + 1] * kg, b = d[i + 2] * kb;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * boost; g = l + (g - l) * boost; b = l + (b - l) * boost;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; // Uint8ClampedArray borne à 0..255
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function averageColor(canvas) {
    const s = makeCanvas(1, 1);
    const ctx = ctx2d(s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scaleTo(canvas, 16), 0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }

  // Largeur de la forme près de sa base / largeur maximale :
  // proche de 1 pour une maison ou un chapiteau (posés au sol), faible pour un cœur ou une étoile.
  function baseRatio(a, w, h) {
    const widths = new Float32Array(h);
    let top = -1, bottom = -1, max = 0;
    for (let y = 0; y < h; y++) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < w; x++) if (a[y * w + x]) { if (x0 < 0) x0 = x; x1 = x; }
      if (x0 >= 0) { widths[y] = x1 - x0 + 1; if (top < 0) top = y; bottom = y; max = Math.max(max, widths[y]); }
    }
    if (bottom < 0 || !max) return 0;
    const y = Math.round(bottom - (bottom - top) * 0.08);
    return widths[y] / max;
  }

  function makePiece(page, seg, comp, orig) {
    const { w, h, labels, data } = seg;
    const k = page.width / w;
    const pad = 2;
    const x0 = Math.max(0, comp.x0 - pad), y0 = Math.max(0, comp.y0 - pad);
    const x1 = Math.min(w - 1, comp.x1 + pad), y1 = Math.min(h - 1, comp.y1 + pad);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    let a = new Float32Array(bw * bh);
    let r = 0, g = 0, b = 0, cnt = 0, satSum = 0;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const p = (y0 + y) * w + x0 + x;
        if (labels[p] === comp.id) {
          a[y * bw + x] = 1;
          const i = p * 4;
          const px = [data[i], data[i + 1], data[i + 2]];
          const s = sat(px);
          // couleur moyenne pondérée par la saturation : on veut la couleur du dessin, pas du papier
          r += px[0] * s; g += px[1] * s; b += px[2] * s; satSum += s; cnt++;
        }
      }
    }
    const base = baseRatio(a, bw, bh);

    // Contour fin : on reprend la détection d'encre dans la page à haute résolution, limitée à la zone
    // de cette découpe, pour que la coupe suive le dessin au millimètre (la grille d'analyse de 640 px
    // ne sert qu'à trouver les sujets)
    const pw = Math.max(1, Math.round(bw * k)), ph = Math.max(1, Math.round(bh * k));
    const fk = Math.min(1, FINE_MAX / Math.max(page.width, page.height)); // page → fine
    const fw = Math.max(1, Math.round(pw * fk)), fh = Math.max(1, Math.round(ph * fk));
    const fine = makeCanvas(fw, fh);
    const fctx = ctx2d(fine);
    fctx.imageSmoothingQuality = 'high';
    // la détection d'encre se fait sur la page d'origine (le papier y a sa vraie couleur)
    fctx.drawImage(orig || page, x0 * k, y0 * k, bw * k, bh * k, 0, 0, fw, fh);
    const fd = fctx.getImageData(0, 0, fw, fh).data;
    // zone autorisée : le sujet trouvé, un peu élargi (le reste de la page appartient à d'autres sujets)
    const kf = fw / bw;
    const region = new Uint8Array(fw * fh);
    const colF = new Int32Array(fw);
    for (let x = 0; x < fw; x++) colF[x] = Math.min(bw - 1, Math.floor(x / kf));
    for (let y = 0; y < fh; y++) { const r0 = Math.min(bh - 1, Math.floor(y / kf)) * bw, o = y * fw; for (let x = 0; x < fw; x++) region[o + x] = a[r0 + colF[x]]; }
    const funit = Math.max(fw, fh) / Math.max(bw, bh) * Math.max(seg.w, seg.h); // taille de la page entière, en pixels fins
    const allowed = dilate(region, fw, fh, funit * 0.012);
    const inkF = inkMask(fd, fw, fh, seg.paper, INK_DIST, seg.weakT || 30);
    for (let p = 0; p < inkF.length; p++) if (!allowed[p]) inkF[p] = 0;
    // marge de quelques millimètres autour de l'encre, trous bouchés, puis coupe nette
    let fm = dilate(inkF, fw, fh, funit * 0.011);
    fm = fillHoles(fm, fw, fh);
    fm = erode(fm, fw, fh, funit * 0.003);
    // si la détection fine n'a presque rien trouvé (sujet très pâle), on garde la forme grossière
    let fmCount = 0; for (let p = 0; p < fm.length; p++) fmCount += fm[p];
    let regCount = 0; for (let p = 0; p < region.length; p++) regCount += region[p];
    const useFine = fmCount > regCount * 0.12;
    const alpha = useFine ? fm : region;
    // bord légèrement adouci (anti-crénelage), sans halo
    const soft = softEdge(alpha, fw, fh);
    const mc = makeCanvas(fw, fh);
    const mctx = ctx2d(mc);
    const mimg = mctx.createImageData(fw, fh);
    for (let p = 0; p < soft.length; p++) mimg.data[p * 4 + 3] = Math.round(soft[p] * 255);
    mctx.putImageData(mimg, 0, 0);

    const pc = makeCanvas(pw, ph);
    const ctx = ctx2d(pc);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mc, 0, 0, pw, ph);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(page, x0 * k, y0 * k, bw * k, bh * k, 0, 0, pw, ph);
    ctx.globalCompositeOperation = 'source-over';

    // carte de clic à la résolution d'analyse, d'après le contour fin
    const hit = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const fx = Math.min(fw - 1, Math.floor((x + 0.5) * kf)), fy = Math.min(fh - 1, Math.floor((y + 0.5) * kf));
      hit[y * bw + x] = alpha[fy * fw + fx] ? 1 : 0;
    }
    const color = satSum > 0 ? [r / satSum, g / satSum, b / satSum] : [200, 200, 200];
    return {
      canvas: pc,
      hit: { w: bw, h: bh, data: hit },
      frac: comp.area / (w * h),
      color,
      colorful: cnt ? satSum / cnt : 0,
      base,
      // emplacement de la pièce dans la page (en pixels de page), pour pouvoir retoucher la découpe
      src: { x: x0 * k, y: y0 * k, w: pw, h: ph },
    };
  }

  function cutPieces(page, seg) {
    seg = seg || segment(page);
    const enhanced = enhance(page, seg.paper);
    const minArea = seg.w * seg.h * 0.006;
    return seg.comps
      .filter((c) => c.area >= minArea && c.x1 - c.x0 > 10 && c.y1 - c.y0 > 10)
      .slice(0, MAX_PIECES_PER_PAGE)
      .map((c) => {
        const piece = makePiece(enhanced, seg, c, page);
        piece.src.paper = seg.paper;
        return piece;
      });
  }

  // Indicateurs d'une page comme fond (couleur, colorée, calme), calculés sur une petite copie :
  // ils servent à choisir les fonds sans fabriquer la texture pleine de chaque page.
  function textureStats(page) {
    const mx = page.width * 0.015, my = page.height * 0.015;
    const small = scaleTo(crop(page, mx, my, page.width - 2 * mx, page.height - 2 * my), 256);
    const t = textureFrom(small);
    release(small); release(t.canvas);
    delete t.canvas;
    return t;
  }

  function textureFrom(page) {
    // on rogne un peu les bords du scan (ombres, bord de feuille)
    const mx = page.width * 0.015, my = page.height * 0.015;
    const c = enhance(crop(page, mx, my, page.width - 2 * mx, page.height - 2 * my), null);
    const color = averageColor(c);
    const small = scaleTo(c, 32);
    const d = ctx2d(small).getImageData(0, 0, small.width, small.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += sat([d[i], d[i + 1], d[i + 2]]);
    // calme : part de la page couverte de larges aplats (peu de variation locale à l'échelle du cm)
    const mid = scaleTo(c, 96);
    const md = ctx2d(mid).getImageData(0, 0, mid.width, mid.height).data;
    const mw = mid.width, mh = mid.height;
    let flat = 0, cells = 0;
    for (let y = 1; y < mh - 1; y++) {
      for (let x = 1; x < mw - 1; x++) {
        const i = (y * mw + x) * 4;
        const l0 = 0.299 * md[i] + 0.587 * md[i + 1] + 0.114 * md[i + 2];
        let diff = 0;
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => {
          const j = ((y + dy) * mw + x + dx) * 4;
          diff += Math.abs(l0 - (0.299 * md[j] + 0.587 * md[j + 1] + 0.114 * md[j + 2]));
        });
        if (diff / 4 < 12) flat++;
        cells++;
      }
    }
    return { canvas: c, color, lum: lum(color), colorful: s / (d.length / 4), calm: cells ? flat / cells : 0 };
  }


  /*
   * Bord précis d'un objet photographié sur une surface. Le masque grossier (grille d'analyse) est
   * repris à une résolution fine, dans une bande le long de son bord : chaque pixel de la bande est
   * attribué à l'objet ou à la surface selon les couleurs de l'un et de l'autre (histogrammes
   * appris juste à l'intérieur et juste à l'extérieur de la bande), puis lissé. Rend un masque
   * 0..1 (Float32Array) à la résolution fine, et cette résolution.
   */
  function refineAlpha(src, coarse, cw, ch) {
    const fine = scaleTo(src, 1600);
    const W = fine.width, H = fine.height, N = W * H;
    const d = ctx2d(fine).getImageData(0, 0, W, H).data;
    release(fine);
    const kx = cw / W, ky = ch / H;
    const M = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) M[y * W + x] = coarse[Math.min(ch - 1, Math.floor((y + 0.5) * ky)) * cw + Math.min(cw - 1, Math.floor((x + 0.5) * kx))];
    const band = Math.max(4, Math.round(Math.max(W, H) * 0.012));
    const inv = new Uint8Array(N);
    for (let p = 0; p < N; p++) inv[p] = M[p] ? 0 : 1;
    const dOut = distanceField(M, W, H);   // distance à l'objet (pour les pixels de surface)
    const dIn = distanceField(inv, W, H);  // distance à la surface (pour les pixels d'objet)
    // histogrammes de couleur (16 niveaux par canal) de l'objet et de la surface voisine
    const bin = (i) => ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const hf = new Float32Array(4096), hb = new Float32Array(4096);
    let nf = 0, nb = 0;
    // (la surface est apprise sur le pourtour de la photo, loin de l'objet : une partie de l'objet
    // perdue par le masque grossier, juste à côté de lui, ne doit pas passer pour du sol)
    const edge = Math.max(2, Math.round(Math.min(W, H) * 0.06));
    for (let y = 0, p = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, p++, i += 4) {
      if (M[p] && dIn[p] > band && dIn[p] < band * 6) { hf[bin(i)]++; nf++; }
      else if (!M[p] && dOut[p] > band * 2 && (x < edge || y < edge || x >= W - edge || y >= H - edge)) { hb[bin(i)]++; nb++; }
    }
    if (nf < 200 || nb < 200) return null;
    // lissage des histogrammes (une couleur voisine compte un peu)
    const smooth = (h, n) => {
      const out = new Float32Array(4096);
      for (let r = 0; r < 16; r++) for (let g = 0; g < 16; g++) for (let b = 0; b < 16; b++) {
        let s = 0, w = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
          const rr = r + dr, gg = g + dg, bb = b + db;
          if (rr < 0 || gg < 0 || bb < 0 || rr > 15 || gg > 15 || bb > 15) continue;
          const k = (dr || dg || db) ? 0.35 : 1;
          s += h[(rr << 8) | (gg << 4) | bb] * k; w += k;
        }
        out[(r << 8) | (g << 4) | b] = (s / w + 0.02) / n;
      }
      return out;
    };
    const pf = smooth(hf, nf), pb = smooth(hb, nb);
    // décision dans la bande : vraisemblance des couleurs, avec un léger a priori pour le masque grossier
    const lab = M.slice();
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      const inBand = M[p] ? dIn[p] <= band : dOut[p] <= band;
      if (!inBand) continue;
      const k = bin(i);
      const prior = M[p] ? 1.4 : 1 / 1.4;
      lab[p] = pf[k] * prior > pb[k] ? 1 : 0;
    }
    // ce que le masque grossier a perdu (une partie de l'objet de la couleur du sol) : on étend l'objet,
    // de proche en proche depuis son bord, aux pixels dont la couleur est nettement plus celle de
    // l’objet que celle de la surface, sans s’éloigner de plus de ≈ 4,5 % de la photo
    const reach = Math.round(Math.max(W, H) * 0.045);
    const grow = [];
    for (let p = 0; p < N; p++) if (lab[p]) grow.push(p);
    const strong = (p) => { const k = bin(p * 4); return pf[k] > pb[k] * 4; };
    const tryGrow = (q) => { if (!lab[q] && !M[q] && dOut[q] <= reach && strong(q)) { lab[q] = 1; grow.push(q); } };
    while (grow.length) {
      const p = grow.pop();
      const x = p % W;
      if (x > 0) tryGrow(p - 1);
      if (x < W - 1) tryGrow(p + 1);
      if (p >= W) tryGrow(p - W);
      if (p < N - W) tryGrow(p + W);
    }
    // lissage : vote majoritaire 5 × 5, deux fois, le long des bords
    let cur = lab;
    for (let pass = 0; pass < 2; pass++) {
      const nx = cur.slice();
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const p = y * W + x;
        if (M[p] ? dIn[p] > band + 3 : (dOut[p] > band + 3 && !lab[p])) continue;
        let s = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += cur[p + dy * W + dx];
        nx[p] = s >= 13 ? 1 : 0;
      }
      cur = nx;
    }
    cur = fillHoles(cur, W, H);
    // on ne garde que ce qui touche l'intérieur sûr de l'objet (pas de taches détachées dans la surface)
    const { labels } = components(cur, W, H);
    const keepIds = new Set();
    for (let p = 0; p < N; p++) if (labels[p] && M[p] && dIn[p] > band) keepIds.add(labels[p]);
    const alpha = new Float32Array(N);
    for (let p = 0; p < N; p++) alpha[p] = labels[p] && keepIds.has(labels[p]) ? 1 : 0;
    // bord adouci d'un pixel (anti-crénelage)
    return { alpha: softEdge(alpha, W, H), W, H };
  }

  // Part de son rectangle englobant (le mieux orienté) que remplit une forme : ≈ 1 pour une feuille
  // posée de travers, nettement moins pour une découpe (cœur, bougie, ovale).
  function rectangularity(mask, w, h) {
    const pts = [];
    let area = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { area++; if (!((x + y) & 3)) pts.push([x, y]); }
    if (!area) return 0;
    let best = Infinity;
    for (let a = 0; a < 90; a += 2) {
      const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const [x, y] of pts) { const u = x * c + y * s, v = -x * s + y * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
      best = Math.min(best, (u1 - u0 + 1) * (v1 - v0 + 1));
    }
    return area / best;
  }

  /*
   * Pièces d'un objet découpé photographié (cœur, bougie, ovale sur un bâton…) : l'objet entier, tel
   * qu'il est posé, est la pièce — sa silhouette exacte, papier blanc compris. alpha : masque 0..1
   * (Float32Array, aw × ah) couvrant la page.
   */
  function objectPieces(page, alpha, aw, ah) {
    const w = Math.max(1, Math.round(page.width * Math.min(1, WORK_MAX / Math.max(page.width, page.height))));
    const h = Math.max(1, Math.round(w * page.height / page.width));
    const coarse = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) coarse[y * w + x] = alpha[Math.min(ah - 1, Math.floor((y + 0.5) * ah / h)) * aw + Math.min(aw - 1, Math.floor((x + 0.5) * aw / w))] > 0.5 ? 1 : 0;
    const { labels, comps } = components(coarse, w, h);
    comps.sort((a, b) => b.area - a.area);
    const keep = comps.filter((c) => c.area >= w * h * 0.006).slice(0, MAX_PIECES_PER_PAGE);
    const paper = [250, 250, 250];
    const enhanced = enhance(page, paper);
    const k = page.width / w;
    // masque à la résolution de la page (pour découper les pixels)
    const am = makeCanvas(aw, ah);
    const ai = ctx2d(am).createImageData(aw, ah);
    for (let p = 0; p < alpha.length; p++) ai.data[p * 4 + 3] = Math.round(alpha[p] * 255);
    ctx2d(am).putImageData(ai, 0, 0);
    const md = ctx2d(scaleTo(page, WORK_MAX)).getImageData(0, 0, w, h).data;
    return keep.map((c) => {
      const pad = 2;
      const x0 = Math.max(0, c.x0 - pad), y0 = Math.max(0, c.y0 - pad), x1 = Math.min(w - 1, c.x1 + pad), y1 = Math.min(h - 1, c.y1 + pad);
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const pw = Math.max(1, Math.round(bw * k)), ph = Math.max(1, Math.round(bh * k));
      const pc = makeCanvas(pw, ph);
      const ctx = ctx2d(pc);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(am, x0 * aw / w, y0 * ah / h, bw * aw / w, bh * ah / h, 0, 0, pw, ph);
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(enhanced, x0 * k, y0 * k, bw * k, bh * k, 0, 0, pw, ph);
      ctx.globalCompositeOperation = 'source-over';
      // seule cette forme compte : les autres objets éventuels du même rectangle sont effacés
      const hit = new Uint8Array(bw * bh);
      let r = 0, g = 0, b = 0, cnt = 0, satSum = 0;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const p = (y0 + y) * w + x0 + x;
        if (labels[p] !== c.id) continue;
        hit[y * bw + x] = 1;
        const i = p * 4, px = [md[i], md[i + 1], md[i + 2]], s = sat(px);
        r += px[0] * s; g += px[1] * s; b += px[2] * s; satSum += s; cnt++;
      }
      // (zone gardée un peu élargie, pour ne pas rogner le bord fin)
      const keepMask = dilate(hit, bw, bh, 3);
      const oc = makeCanvas(bw, bh), oi = ctx2d(oc).createImageData(bw, bh);
      for (let p = 0; p < hit.length; p++) oi.data[p * 4 + 3] = keepMask[p] ? 0 : 255;
      ctx2d(oc).putImageData(oi, 0, 0);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(oc, 0, 0, pw, ph);
      ctx.globalCompositeOperation = 'source-over';
      return {
        canvas: pc,
        hit: { w: bw, h: bh, data: hit },
        frac: c.area / (w * h),
        color: satSum > 0 ? [r / satSum, g / satSum, b / satSum] : [200, 200, 200],
        colorful: cnt ? satSum / cnt : 0,
        base: baseRatio(hit, bw, bh),
        object: true,
        src: { x: x0 * k, y: y0 * k, w: pw, h: ph, paper },
      };
    });
  }

  function rotateCanvas(src, deg) {
    const swap = deg === 90 || deg === 270;
    const c = makeCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
    const ctx = ctx2d(c);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }
  /*
   * Page analysée, tournée d'un quart de tour (ou d'un demi-tour) : un objet photographié garde sa
   * silhouette (tournée avec la page) ; un dessin sur papier est simplement réanalysé dans le bon sens.
   */
  function rotated(a, deg) {
    if (!deg) return a;
    const page = rotateCanvas(a.page, deg);
    if (a.objectAlpha) {
      const { alpha, W, H } = a.objectAlpha;
      const ac = makeCanvas(W, H), ai = ctx2d(ac).createImageData(W, H);
      for (let p = 0; p < alpha.length; p++) ai.data[p * 4 + 3] = Math.round(alpha[p] * 255);
      ctx2d(ac).putImageData(ai, 0, 0);
      const rc = rotateCanvas(ac, deg);
      const rd = ctx2d(rc).getImageData(0, 0, rc.width, rc.height).data;
      const ra = new Float32Array(rc.width * rc.height);
      for (let p = 0; p < ra.length; p++) ra[p] = rd[p * 4 + 3] / 255;
      const objectAlpha = { alpha: ra, W: rc.width, H: rc.height };
      return { page, paper: a.paper, texture: null, kind: 'cutout', paperFrac: 1, objectAlpha, pieces: objectPieces(page, ra, rc.width, rc.height), photo: a.photo, original: a.original };
    }
    // (la page est déjà égalisée)
    return analyze(page, 0, { flat: true });
  }

  // Découpe d'office d'une page analysée : l'objet photographié, ou les sujets dessinés.
  function recut(a) {
    if (a.objectAlpha) return objectPieces(a.page, a.objectAlpha.alpha, a.objectAlpha.W, a.objectAlpha.H);
    return cutPieces(a.page, a.seg);
  }

  /*
   * Photo d'un dessin posé sur un sol ou une table (parquet, carrelage, bois, plan de travail…).
   * On reconnaît la surface à la bordure de l'image : une couleur de bois (chaude, moyenne) ou
   * neutre (gris, blanc cassé), puis on isole ce qui s'en détache, en suivant la forme du dessin.
   * Retourne null si l'image n'est pas une photo sur une surface, sinon la page nettoyée :
   * le dessin détouré sur un fond blanc, recadré.
   */
  /*
   * Une photo posée sur une page blanche (PDF d'un scanner de téléphone, page A4 avec marges) :
   * on rogne les marges claires et uniformes pour analyser la photo elle-même.
   */
  function trimMargins(src) {
    const work = scaleTo(src, 400);
    const w = work.width, h = work.height;
    const d = ctx2d(work).getImageData(0, 0, w, h).data;
    const rows = new Uint16Array(h), cols = new Uint16Array(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, c = [d[i], d[i + 1], d[i + 2]];
      if (lum(c) < 225 || sat(c) > 0.12) { rows[y]++; cols[x]++; }
    }
    const first = (arr, n, lim) => { for (let k = 0; k < arr.length; k++) if (arr[k] > n * lim) return k; return -1; };
    const last = (arr, n, lim) => { for (let k = arr.length - 1; k >= 0; k--) if (arr[k] > n * lim) return k; return -1; };
    const y0 = first(rows, w, 0.15), y1 = last(rows, w, 0.15), x0 = first(cols, h, 0.15), x1 = last(cols, h, 0.15);
    trimMargins.debug = { y0, y1, x0, x1 };
    if (y0 < 0 || x0 < 0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const insets = [y0 / h, (h - 1 - y1) / h, x0 / w, (w - 1 - x1) / w];
    const sides = insets.filter((v) => v >= 0.03).length;
    const areaFrac = (bw * bh) / (w * h);
    // la zone rognée doit être dense (une photo), pas un dessin épars sur la feuille,
    // et cernée d'un vrai cadre : ses quatre bords sont presque entièrement non blancs
    let inside = 0;
    for (let y = y0; y <= y1; y++) inside += rows[y];
    const dense = inside / (bw * bh);
    const edgeFill = (fx) => { let c = 0, k = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (fx(x, y)) { k++; const i = (y * w + x) * 4, cc = [d[i], d[i + 1], d[i + 2]]; if (lum(cc) < 225 || sat(cc) > 0.12) c++; } return c / Math.max(1, k); };
    // (un dessin posé sur le bord de la photo peut entamer un ou deux bords du cadre)
    const edges = [edgeFill((x, y) => y <= y0 + 1), edgeFill((x, y) => y >= y1 - 1), edgeFill((x, y) => x <= x0 + 1), edgeFill((x, y) => x >= x1 - 1)];
    const frame = Math.min(...edges), full = edges.filter((v) => v >= 0.85).length;
    Object.assign(trimMargins.debug, { sides, areaFrac: +areaFrac.toFixed(2), dense: +dense.toFixed(2), frame: +frame.toFixed(2), full });
    if (sides < 2 || areaFrac < 0.08 || areaFrac > 0.9) return null;
    if (dense < 0.6 || full < 2 || frame < 0.5) return null;
    const k = src.width / w, m = 0.012;
    const cx0 = Math.round((x0 + (x1 - x0) * m) * k), cy0 = Math.round((y0 + (y1 - y0) * m) * k);
    const cx1 = Math.round((x1 + 1 - (x1 - x0) * m) * k), cy1 = Math.round((y1 + 1 - (y1 - y0) * m) * k);
    return crop(src, cx0, cy0, cx1 - cx0, cy1 - cy0);
  }

  function removeSurface(src, force) {
    const inset = trimMargins(src);
    if (inset) src = inset;
    const work = scaleTo(src, WORK_MAX);
    const w = work.width, h = work.height, n = w * h;
    const d = ctx2d(work).getImageData(0, 0, w, h).data;
    // couleur de la surface : médiane des pixels de bordure (robuste aux reflets du bois et aux joints)
    const onSurf = surfaceBorder(d, w, h);
    const col = borderMedian(d, w, h, onSurf);
    const L = lum(col), S = sat(col);
    const mx = Math.max(col[0], col[1], col[2]), mn = Math.min(col[0], col[1], col[2]);
    let hue = 0;
    if (mx > mn) {
      if (mx === col[0]) hue = ((col[1] - col[2]) / (mx - mn)) % 6;
      else if (mx === col[1]) hue = (col[2] - col[0]) / (mx - mn) + 2;
      else hue = (col[0] - col[1]) / (mx - mn) + 4;
      hue = (hue * 60 + 360) % 360;
    }
    removeSurface.debug = { L: Math.round(L), S: +S.toFixed(2), hue: Math.round(hue), gate: 'couleur' };
    const neutral = S < 0.18 && L < 228;                 // gris, béton, plan de travail
    const wood = S >= 0.15 && S < 0.96 && hue >= 5 && hue <= 55 && L < 230; // bois, parquet, liège, chêne verni (la structure en lames tranche ensuite)
    // forcé par l'utilisateur : on fait confiance à la couleur de bordure, quelle qu'elle soit
    if (!neutral && !wood && !force) return null;

    // chromaticité (indépendante de l'éclairage) et luminance de chaque pixel
    const chroma = (i) => { const t = d[i] + d[i + 1] + d[i + 2] || 1; return [d[i] / t, d[i + 1] / t]; };
    const ct = col[0] + col[1] + col[2] || 1, cr = col[0] / ct, cg = col[1] / ct;
    // tolérances tirées de la bordure elle-même (veines du bois, joints du carrelage)
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
    const dc = [], dl = [];
    forEachBorder(w, h, band, (p) => {
      if (onSurf && !onSurf(p)) return;
      const i = p * 4, c = chroma(i);
      dc.push(Math.hypot(c[0] - cr, c[1] - cg));
      dl.push(Math.abs(lum([d[i], d[i + 1], d[i + 2]]) - L));
    });
    dc.sort((a, b) => a - b); dl.sort((a, b) => a - b);
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
    const cTol = Math.min(0.12, Math.max(0.028, q(dc, 0.9) * 1.6));
    const lTol = Math.min(120, Math.max(48, q(dl, 0.9) * 1.8));
    const obj = new Uint8Array(n), joint = new Uint8Array(n);
    let surfCount = 0, paperCount = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const t = R + G + B || 1;
      const dch = Math.hypot(R / t - cr, G / t - cg);
      const l = 0.299 * R + 0.587 * G + 0.114 * B;
      const mx = R > G ? (R > B ? R : B) : (G > B ? G : B), mn = R < G ? (R < B ? R : B) : (G < B ? G : B);
      const s = mx === 0 ? 0 : (mx - mn) / mx;
      // même teinte que la surface, pas plus clair que sa tolérance ; en plus foncé on accepte
      // large (ombres portées, joints, veines) ; les joints très sombres perdent leur teinte
      const dark = l < L * 0.6 && (s < 0.45 || dch < cTol * 1.5) && dch < cTol * 2.2;
      const same = dch < cTol && l < L + lTol;
      if (same || dark) { surfCount++; if (dark || l < L * 0.62) joint[p] = 1; }
      else { obj[p] = 1; if (s < 0.22 && l > Math.max(165, L + 12)) paperCount++; }
    }
    // part de papier (clair, peu saturé) dans ce qui n'est pas la surface : un dessin posé sur un sol
    // est une feuille blanche ; des traits sur une feuille de couleur n'en contiennent pas
    const paperFrac = paperCount / Math.max(1, n - surfCount);
    const surfFrac = surfCount / n;
    Object.assign(removeSurface.debug, { surfFrac: +surfFrac.toFixed(2), gate: 'surface' });
    if (!force && (surfFrac < 0.05 || surfFrac > 0.97)) return null;
    if (force && (surfFrac < 0.02 || surfFrac > 0.99)) return null;
    // une bordure trop disparate est une page peinte jusqu'aux bords, pas un sol
    // une bordure disparate (lames sombres, veines marquées) n'est acceptée que si elle est structurée
    // par de vrais joints (voir plus bas) ; au-delà, c'est une page peinte jusqu'aux bords
    const noisy = q(dl, 0.9) > 60 || q(dc, 0.9) > 0.09;
    // (un parquet verni avec reflets et joints noirs a une bordure très contrastée : on laisse les joints trancher)
    if (!force && q(dc, 0.9) > (wood ? 0.28 : 0.2)) return null;
    // Une vraie surface est soit très unie (plan de travail), soit structurée par de longs traits
    // sombres (lames de parquet, joints de carrelage). Une page peinte ne l'est pas.
    const uniform = q(dl, 0.9) < 16 && q(dc, 0.9) < 0.02;
    let lines = 0;
    const lineComps = [];
    if (!uniform) {
      // les joints sont souvent coupés par les reflets : on relie les fragments proches avant de mesurer
      const jl = erode(dilate(joint, w, h, Math.max(w, h) * 0.006), w, h, Math.max(w, h) * 0.004);
      const jc = components(jl, w, h).comps;
      const unit0 = Math.max(w, h);
      jc.forEach((c) => {
        const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
        if (Math.max(bw, bh) >= 0.22 * unit0 && (Math.min(bw, bh) <= 0.04 * unit0 || c.area / (bw * bh) < 0.4) && c.area > 0.0006 * n) { lines++; lineComps.push(c); }
      });
    }
    removeSurface.debug = { L: Math.round(L), S: +S.toFixed(2), hue: Math.round(hue), surfFrac: +surfFrac.toFixed(2), paper: +paperFrac.toFixed(2), uniform, lines, dl90: Math.round(q(dl, 0.9)), dc90: +q(dc, 0.9).toFixed(3) };
    if (removeSurface.wantMasks) {
      const mc = makeCanvas(w, h), mi = ctx2d(mc).createImageData(w, h);
      for (let p = 0; p < n; p++) { const i = p * 4; mi.data[i] = obj[p] ? 255 : 0; mi.data[i + 1] = joint[p] ? 255 : 0; mi.data[i + 2] = 0; mi.data[i + 3] = 255; }
      ctx2d(mc).putImageData(mi, 0, 0); removeSurface.debug.maskPng = mc.toDataURL('image/png');
    }
    const unit = Math.max(w, h);
    // fermeture (relie le dessin), bouchage des trous, ouverture (efface les veines isolées)
    let mask = dilate(obj, w, h, unit * 0.008);
    mask = erode(mask, w, h, unit * 0.008);
    mask = fillHoles(mask, w, h);
    mask = erode(mask, w, h, unit * 0.012);
    mask = dilate(mask, w, h, unit * 0.012);
    const { labels, comps } = components(mask, w, h);
    // le dessin : la plus grande forme, et celles qui en sont proches en taille ; des reflets ou des
    // taches claires du sol, petits et isolés, ne comptent pas
    const biggest = comps.reduce((m, c) => (!m || c.area > m.area ? c : m), null);
    const ownFill = (c) => c.area / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1));
    const keep = comps.filter((c) => c.area >= 0.03 * n && (c === biggest || (c.area >= 0.3 * biggest.area && ownFill(c) >= 0.35)));
    if (!keep.length) return null;
    // un dessin posé sur un sol est une forme pleine (feuille ou découpe) ; des traits sur une feuille
    // de couleur ne remplissent qu'une petite part de la forme que la fermeture leur donne
    const kept = new Uint8Array(comps.length + 2); // étiquette → forme gardée
    keep.forEach((c) => { kept[c.id] = 1; });
    let raw = 0, closed = 0;
    for (let p = 0; p < n; p++) if (mask[p] && kept[labels[p]]) { closed++; if (obj[p]) raw++; }
    const solid = raw / Math.max(1, closed);
    Object.assign(removeSurface.debug, { solid: +solid.toFixed(2) });
    if (solid < 0.6 && !force) return null;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    keep.forEach((c) => { x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1); area += c.area; });
    if (area > (force ? 0.985 : 0.92) * n) return null;
    // le dessin posé est une forme compacte (feuille, découpe) qui ne remplit pas toute la bordure ;
    // des taches éparses sur un papier kraft ne sont pas un dessin posé sur un sol
    const touches = [x0 <= 1, y0 <= 1, x1 >= w - 2, y1 >= h - 2].filter(Boolean).length;
    // les joints d'un sol se prolongent au-delà du dessin ; des traits de crayon restent dans la feuille
    const mg = 0.02 * Math.max(w, h);
    const linesOut = lineComps.filter((c) => !(c.x0 >= x0 - mg && c.y0 >= y0 - mg && c.x1 <= x1 + mg && c.y1 <= y1 + mg)).length;
    Object.assign(removeSurface.debug, { linesOut, touches, fill: +(area / ((x1 - x0 + 1) * (y1 - y0 + 1))).toFixed(2), objFrac: +(area / n).toFixed(2) });
    if (!force) {
      // une surface texturée doit montrer au moins un joint hors du dessin, ou un objet franchement papier
      // (un sujet plein et compact posé sur un bois à joints visibles passe même si les joints restent sous lui)
      if (!uniform && linesOut < 1 && paperFrac < 0.45 && !(lines >= 1 && solid >= 0.6)) return null;
      // et le dessin occupe une part raisonnable de la photo (sinon ce sont des taches sur une page de couleur)
      if (area < 0.06 * n) return null;
    }
    // une feuille photographiée de près peut toucher trois bords : on l'accepte si elle est bien du papier
    // ... et qu'un bord entier de la photo montre la surface (le sol file sous la feuille)
    let edgeSurf = 0;
    [[0, 1, 0, w, 1], [h - 1, h, 0, w, 1], [0, h, 0, 1, 2], [0, h, w - 1, w, 2]].forEach(([y0e, y1e, x0e, x1e]) => {
      let c = 0, k = 0;
      for (let y = y0e; y < y1e; y++) for (let x = x0e; x < x1e; x++) { k++; if (!obj[y * w + x]) c++; }
      edgeSurf = Math.max(edgeSurf, c / Math.max(1, k));
    });
    Object.assign(removeSurface.debug, { edgeSurf: +edgeSurf.toFixed(2) });
    if (!force && touches >= 3 && !(paperFrac >= 0.35 && solid >= 0.8 && surfFrac >= 0.12 && edgeSurf >= 0.92)) return null;
    // une forme fine et oblique (une fleur avec sa tige) remplit peu sa boîte : on l'accepte si elle est pleine et posée sur un sol à joints
    const fillBox = area / ((x1 - x0 + 1) * (y1 - y0 + 1));
    if (!force && fillBox < 0.4 && !(fillBox >= 0.2 && solid >= 0.85 && lines >= 1)) return null;
    // masque final, légèrement rétréci pour ne pas garder un liseré de surface
    const finMask = new Uint8Array(n);
    for (let p = 0; p < n; p++) if (mask[p] && kept[labels[p]]) finMask[p] = 1;
    if (wood) {
      // du bois clair pris pour du papier : tout ce qui a la teinte du bois et touche le bord de la photo
      // par une chaîne de pixels de bois est rendu à la surface (un trait orange sur la feuille, isolé
      // dans le blanc, n'est pas touché)
      const woodish = new Uint8Array(n);
      for (let p = 0, i = 0; p < n; p++, i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const mx = R > G ? (R > B ? R : B) : (G > B ? G : B), mn = R < G ? (R < B ? R : B) : (G < B ? G : B);
        if (mx === mn || (mx === 0 ? 0 : (mx - mn) / mx) < 0.28 || 0.299 * R + 0.587 * G + 0.114 * B > 235) continue;
        let hh = mx === R ? ((G - B) / (mx - mn)) % 6 : mx === G ? (B - R) / (mx - mn) + 2 : (R - G) / (mx - mn) + 4;
        hh = (hh * 60 + 360) % 360;
        if (hh >= 8 && hh <= 52) woodish[p] = 1;
      }
      const seen = new Uint8Array(n);
      const stack = [];
      forEachBorder(w, h, 1, (p) => { if (woodish[p] && !seen[p]) { seen[p] = 1; stack.push(p); } });
      // (on ne franchit pas un net changement de couleur : le bord d'un objet orangé ou brun)
      const step = (p, q) => {
        if (woodish[q] && !seen[q] && Math.abs(d[q * 4] - d[p * 4]) + Math.abs(d[q * 4 + 1] - d[p * 4 + 1]) + Math.abs(d[q * 4 + 2] - d[p * 4 + 2]) < 70) { seen[q] = 1; stack.push(q); }
      };
      while (stack.length) {
        const p = stack.pop();
        const x = p % w, y = (p - x) / w;
        if (x + 1 < w) step(p, p + 1);
        if (x > 0) step(p, p - 1);
        if (y + 1 < h) step(p, p + w);
        if (y > 0) step(p, p - w);
      }
      for (let p = 0; p < n; p++) if (seen[p]) finMask[p] = 0;
    }
    const fin = erode(finMask, w, h, unit * 0.004);
    // bord précis : repris à pleine résolution le long du contour (couleurs de l'objet et de la surface)
    const ref = refineAlpha(src, fin, w, h);
    const rectFill = rectangularity(fin, w, h);
    Object.assign(removeSurface.debug, { rect: +rectFill.toFixed(2), refined: !!ref });

    // page nettoyée à la résolution d'origine : hors du dessin, du papier blanc (en fondu sur le bord)
    const k = src.width / w;
    const m = Math.round(0.03 * Math.max(x1 - x0, y1 - y0) * k);
    const cx0 = Math.max(0, Math.round(x0 * k) - m), cy0 = Math.max(0, Math.round(y0 * k) - m);
    const cx1 = Math.min(src.width, Math.round((x1 + 1) * k) + m), cy1 = Math.min(src.height, Math.round((y1 + 1) * k) + m);
    const out = makeCanvas(cx1 - cx0, cy1 - cy0);
    const ctx = ctx2d(out);
    ctx.drawImage(src, cx0, cy0, out.width, out.height, 0, 0, out.width, out.height);
    const img = ctx.getImageData(0, 0, out.width, out.height);
    const od = img.data;
    // masque de l'objet à la résolution de la page nettoyée
    const OW = out.width, OH = out.height;
    const oa = new Float32Array(OW * OH);
    for (let y = 0; y < OH; y++) {
      for (let x = 0; x < OW; x++) {
        let a;
        if (ref) {
          const fx = ((x + cx0 + 0.5) / src.width) * ref.W - 0.5, fy = ((y + cy0 + 0.5) / src.height) * ref.H - 0.5;
          const xa = Math.max(0, Math.min(ref.W - 1, Math.floor(fx))), ya = Math.max(0, Math.min(ref.H - 1, Math.floor(fy)));
          const xb = Math.min(ref.W - 1, xa + 1), yb = Math.min(ref.H - 1, ya + 1), tx = Math.max(0, Math.min(1, fx - xa)), ty = Math.max(0, Math.min(1, fy - ya));
          const A = ref.alpha;
          a = (A[ya * ref.W + xa] * (1 - tx) + A[ya * ref.W + xb] * tx) * (1 - ty) + (A[yb * ref.W + xa] * (1 - tx) + A[yb * ref.W + xb] * tx) * ty;
        } else {
          a = fin[Math.min(h - 1, Math.floor((y + cy0) / k)) * w + Math.min(w - 1, Math.floor((x + cx0) / k))];
        }
        oa[y * OW + x] = a;
        if (a < 1) { const i = (y * OW + x) * 4; od[i] = od[i] * a + 248 * (1 - a); od[i + 1] = od[i + 1] * a + 246 * (1 - a); od[i + 2] = od[i + 2] * a + 241 * (1 - a); od[i + 3] = 255; }
      }
    }
    ctx.putImageData(img, 0, 0);
    // une découpe (forme libre) est la pièce elle-même ; une feuille rectangulaire garde son dessin à découper
    const cutShape = rectFill < 0.9;
    return { canvas: out, surface: { color: col, kind: wood ? 'bois' : 'neutre', frac: surfFrac }, object: cutShape ? { alpha: oa, W: OW, H: OH } : null };
  }

  /*
   * Page d'écriture seule ? L'encre y forme des lignes horizontales régulières (bandes d'encre
   * séparées par des interlignes, de hauteur voisine, qui courent sur une bonne part de la largeur).
   * Un dessin, même au crayon, n'a pas cette régularité.
   */
  function textOnly(src) {
    const work = scaleTo(src, 320);
    const w = work.width, h = work.height;
    const d = ctx2d(work).getImageData(0, 0, w, h).data;
    const rows = new Float32Array(h);
    const cols = new Float32Array(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (lum([d[i], d[i + 1], d[i + 2]]) < 150) { rows[y]++; cols[x]++; }
    }
    const bands = [];
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const ink = y < h && rows[y] > w * 0.015;
      if (ink && start < 0) start = y;
      if (!ink && start >= 0) { bands.push([start, y]); start = -1; }
    }
    const inked = cols.filter((c) => c > 0).length / w;
    if (bands.length < 5 || inked < 0.4) return false;
    const heights = bands.map(([a, b]) => b - a).sort((a, b) => a - b);
    const med = heights[Math.floor(heights.length / 2)];
    if (med < h * 0.012 || med > h * 0.07) return false;
    const regular = heights.filter((v) => v > med * 0.4 && v < med * 2.2).length / heights.length;
    const gaps = bands.slice(1).map((b, i) => b[0] - bands[i][1]);
    const gmed = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    // bandes régulières, interlignes réguliers, et peu d'encre dans les interlignes
    return regular >= 0.7 && gmed > 0 && gmed < med * 2.5;
  }

  /*
   * Analyse complète d'une page scannée.
   * Retourne { page, kind: 'texture' | 'cutout', texture?, pieces? }.
   */
  function analyze(src, depth, opts) {
    depth = depth || 0;
    opts = opts || {};
    if (depth === 0 && opts.photo) {
      // photo d'un dessin posé sur un sol ou une table : on retire la surface
      const cleaned = removeSurface(src, !!opts.force);
      if (cleaned && cleaned.object) {
        // objet découpé posé sur la surface : sa silhouette entière est la pièce
        const page = flatten(cleaned.canvas, true);
        const r = { page, paper: [250, 250, 250], texture: null, kind: 'cutout', paperFrac: 1, objectAlpha: cleaned.object };
        r.pieces = objectPieces(page, cleaned.object.alpha, cleaned.object.W, cleaned.object.H);
        if (r.pieces.length) { r.photo = cleaned.surface; r.original = src; return r; }
      }
      if (cleaned) {
        const r = analyze(cleaned.canvas, 0, {});
        r.photo = cleaned.surface;
        r.original = src;
        return r;
      }
    }
    // éclairage égalisé : le papier est blanc partout avant de chercher le dessin
    if (!opts.flat) { src = flatten(src, true); opts = Object.assign({}, opts, { flat: true }); }
    const seg = segment(src);
    const big = seg.comps[0];
    if (depth === 0 && big) {
      // Feuille plus petite que la vitre du scanner : on recadre sur la feuille.
      const bw = big.x1 - big.x0 + 1, bh = big.y1 - big.y0 + 1;
      const n = seg.w * seg.h;
      if (big.area > 0.3 * n && big.area / (bw * bh) > 0.85 && bw * bh < 0.9 * n) {
        const k = src.width / seg.w;
        const inset = 0.012 * Math.max(bw, bh);
        const sheet = crop(src, (big.x0 + inset) * k, (big.y0 + inset) * k, (bw - 2 * inset) * k, (bh - 2 * inset) * k);
        return analyze(sheet, 1, opts);
      }
    }
    const result = { page: src, paper: seg.paper, texture: null, pieces: null, kind: 'cutout', paperFrac: seg.paperFrac };
    if (seg.paperFrac < TEXTURE_MAX_PAPER) {
      result.kind = 'texture';
      result.texture = textureFrom(src);
      result.seg = seg;
      return result;
    }
    result.pieces = cutPieces(src, seg);
    if (!result.pieces.length) {
      result.kind = 'texture';
      result.texture = textureFrom(src);
    }
    return result;
  }

  window.Extract = { analyze, flatten, recut, rotated, textureStats, release, removeSurface, textOnly, trimMargins, cutPieces, textureFrom, enhance, scaleTo, makeCanvas, averageColor, lum };
})();
