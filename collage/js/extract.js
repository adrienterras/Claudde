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
  const MAX_PIECES_PER_PAGE = 24;
  // Préférences de découpe, apprises des retouches de l'utilisateur (voir learnCut), en fraction du
  // grand côté de la page : marge de papier gardée autour de l'encre, rayon de fermeture (traits
  // distants de moins de 2 × close font un même sujet), lissage du contour ; ink : sensibilité aux
  // traits pâles (1 = normale ; < 1 : seuils plus bas, plus de traits pâles gardés)
  const CUT_DEFAULT = { margin: 0.009, close: 0.03, smooth: 0.008, ink: 1 };
  let CUT = Object.assign({}, CUT_DEFAULT);
  function setCutPrefs(p) {
    CUT = Object.assign({}, CUT_DEFAULT, p || {});
    CUT.margin = Math.max(0.002, Math.min(0.03, CUT.margin));
    CUT.close = Math.max(CUT.margin + 0.005, Math.min(0.06, CUT.close));
    CUT.smooth = Math.max(0.002, Math.min(0.02, CUT.smooth));
    CUT.ink = Math.max(0.5, Math.min(1.6, CUT.ink));
    return Object.assign({}, CUT);
  }
  const cutPrefs = () => Object.assign({}, CUT);
  const cutIsDefault = () => Object.keys(CUT_DEFAULT).every((k) => Math.abs(CUT[k] - CUT_DEFAULT[k]) < 1e-6);

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

  /*
   * Netteté pour l'impression : masque flou (« unsharp mask ») appliqué à la résolution d'export,
   * bande par bande pour ménager la mémoire. La luminance est comparée à sa version floutée (flou
   * en boîte en deux passes, pondéré par l'opacité pour ne pas créer de halo au bord des découpes) ;
   * l'écart, au-delà d'un seuil qui épargne le grain du papier, est amplifié, teinte conservée. Les
   * tons sombres sont en plus un peu renforcés : le noir du feutre et du crayon ressort plus franc.
   */
  function sharpen(c, o) {
    const { radius = 1, amount = 0.6, threshold = 6, ink = 0.1 } = o || {};
    const W = c.width, H = c.height;
    if (W < 4 || H < 4) return c;
    const ctx = ctx2d(c);
    const R = Math.max(1, Math.round(radius));
    const pad = 2 * R;
    const BAND = Math.max(pad * 4, Math.floor(3e6 / W));
    // flou en boîte séparable, deux passes, bords répliqués
    const blur = (src, w, h) => {
      let a = new Float32Array(src), b = new Float32Array(src.length);
      const inv = 1 / (2 * R + 1);
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < h; y++) {
          const row = y * w;
          let sum = 0;
          for (let k = -R; k <= R; k++) sum += a[row + Math.min(w - 1, Math.max(0, k))];
          for (let x = 0; x < w; x++) {
            b[row + x] = sum * inv;
            sum += a[row + Math.min(w - 1, x + R + 1)] - a[row + Math.max(0, x - R)];
          }
        }
        const col = new Float32Array(w);
        for (let k = -R; k <= R; k++) { const r = Math.min(h - 1, Math.max(0, k)) * w; for (let x = 0; x < w; x++) col[x] += b[r + x]; }
        for (let y = 0; y < h; y++) {
          const row = y * w, add = Math.min(h - 1, y + R + 1) * w, sub = Math.max(0, y - R) * w;
          for (let x = 0; x < w; x++) { a[row + x] = col[x] * inv; col[x] += b[add + x] - b[sub + x]; }
        }
      }
      return a;
    };
    for (let y0 = 0; y0 < H; y0 += BAND) {
      const top = Math.max(0, y0 - pad), bottom = Math.min(H, y0 + BAND + pad), h = bottom - top;
      const img = ctx.getImageData(0, top, W, h);
      const d = img.data, n = W * h;
      const L = new Float32Array(n), A = new Float32Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const a = d[j + 3] / 255;
        A[i] = a;
        L[i] = a ? (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) * a : 0;
      }
      const BL = blur(L, W, h), BA = blur(A, W, h);
      const from = y0 - top, to = Math.min(H, y0 + BAND) - top;
      for (let i = from * W, j = i * 4; i < to * W; i++, j += 4) {
        const a = A[i];
        if (!a) continue;
        const l = L[i] / a;
        const b = BA[i] > 1e-3 ? BL[i] / BA[i] : l;
        const diff = l - b, ad = Math.abs(diff);
        let gain = ad > threshold ? amount * diff * Math.min(1, (ad - threshold) / threshold) : 0;
        if (ink) gain -= l * ink * Math.max(0, Math.min(1, (120 - l) / 120));
        if (!gain) continue;
        d[j] += gain; d[j + 1] += gain; d[j + 2] += gain; // Uint8ClampedArray borne à 0..255
      }
      ctx.putImageData(img, 0, top, 0, from, W, to - from);
    }
    return c;
  }

  // Un liseré transparent d'un pixel autour d'une pièce : son image, rééchantillonnée et tournée sur
  // la toile, a alors un bord stable quel que soit le clip de redessin (un pixel opaque au ras du
  // bord serait filtré différemment selon le clip).
  function clearFrame(c) {
    const x = ctx2d(c);
    x.clearRect(0, 0, c.width, 1); x.clearRect(0, c.height - 1, c.width, 1);
    x.clearRect(0, 0, 1, c.height); x.clearRect(c.width - 1, 0, 1, c.height);
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
  // maxArea (facultatif) : un trou plus grand n'est pas bouché (l'intérieur d'un cadre dessiné autour
  // d'une feuille n'est pas le sujet)
  function fillHoles(mask, w, h, maxArea) {
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
    if (maxArea > 0) {
      // trous : les plages non atteintes depuis le bord et hors du masque ; les grands restent ouverts
      const holes = new Uint8Array(w * h);
      for (let i = 0; i < holes.length; i++) holes[i] = !mask[i] && !seen[i] ? 1 : 0;
      const { labels, comps } = components(holes, w, h);
      const big = new Uint8Array(comps.length + 1);
      comps.forEach((c) => { if (c.area > maxArea) big[c.id] = 1; });
      for (let i = 0; i < out.length; i++) if (holes[i] && big[labels[i]]) out[i] = 0;
    }
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
    const paper = estimatePaper(data, w, h), tint = paperTint(paper);
    // papier de couleur : sa couleur case par case (ombres des plis, éclairage)
    const field = tint ? paperField(data, w, h, paper) : null;
    // une copie à 1600 px : les traits fins de couleur pâle (un feutre jaune clair) y sont encore
    // visibles, alors qu'ils se fondent dans le papier sur la grille d'analyse ; cette encre colorée
    // (sur papier blanc : les gris — crayon, ombres, poussières — restent jugés sur la grille, moins
    // sensible) est reportée sur la grille (un pixel de la grille est encré dès qu'un de ses pixels
    // l'est), sans les points minuscules (moins de ≈ 0,4 mm²)
    const mid = scaleTo(page, 1600), mw = mid.width, mh = mid.height, md = ctx2d(mid).getImageData(0, 0, mw, mh).data, mn = mw * mh;
    release(mid);
    const midMap = { x0: 0, y0: 0, k: mw / w };
    const poolInk = (m) => {
      const cc = components(m, mw, mh), tiny = new Uint8Array(cc.comps.length + 1), minPx = mn * 0.00002;
      for (const c of cc.comps) if (c.area < minPx) tiny[c.id] = 1;
      const out = new Uint8Array(n), cx = new Int32Array(mw), cy = new Int32Array(mh);
      for (let x = 0; x < mw; x++) cx[x] = Math.min(w - 1, Math.floor(x * w / mw));
      for (let y = 0; y < mh; y++) cy[y] = Math.min(h - 1, Math.floor(y * h / mh)) * w;
      for (let y = 0, p = 0; y < mh; y++) for (let x = 0; x < mw; x++, p++) if (m[p] && !tiny[cc.labels[p]]) out[cy[y] + cx[x]] = 1;
      return out;
    };
    let paperCount = 0, rawCount = 0;
    const U2 = PAPER_DIST * PAPER_DIST;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const dr = data[i] - paper[0], dg = data[i + 1] - paper[1], db = data[i + 2] - paper[2];
      const raw = dr * dr + dg * dg + db * db;
      if (raw < U2) { paperCount++; rawCount++; } else if (tint && paperDist2(data[i], data[i + 1], data[i + 2], paper, tint) < U2) paperCount++;
    }
    let weakT = Math.max(10, weakThreshold(data, w, h, paper) * CUT.ink);
    // dessin pâle (crayon léger, feutre pastel) : presque rien ne dépasse le seuil franc alors que
    // beaucoup dépasse le seuil faible ; le seuil franc descend, sans tomber dans le bruit du papier
    let strong = 0, faint = 0;
    const S2 = INK_DIST * INK_DIST, W2 = weakT * weakT;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const q = paperDist2(data[i], data[i + 1], data[i + 2], paper, tint);
      if (q > S2) strong++; else if (q > W2) faint++;
    }
    let strongT = Math.max(20, (strong < n * 0.02 && faint > strong * 1.5 && faint > n * 0.008 ? Math.max(28, weakT + 6) : INK_DIST) * CUT.ink);
    const unit = Math.max(w, h);
    const m = Math.max(2, Math.round(Math.min(w, h) * 0.015));
    // drop : pixels d'encre ignorés (traits de partage) ; cut : frontières que les sujets ne franchissent pas
    // papier quadrillé ou ligné : beaucoup de traits fins, pâles et droits sur toute la feuille. Trop
    // pâles pour la grille d'analyse, ils sont nets à 1600 px et à la résolution de la découpe fine, où
    // ils relieraient les sujets et dentelleraient les contours ; repérés ici, ils sont retirés de
    // l'encre (tout trait fin et droit qui traverse la feuille, un trait épais du dessin n'est pas touché)
    let grid = false, gridMask = null;
    {
      const lv = inkLevels(md, mw, mh, paper, strongT, weakT, field, midMap), weakOnly = new Uint8Array(mn), pale = new Uint8Array(mn);
      for (let p = 0; p < mn; p++) { if (lv[p] === 1) weakOnly[p] = 1; if (lv[p]) pale[p] = 1; }
      const g = ruledLines(weakOnly, mw, mh, { len: 0.5 });
      let cnt = 0; for (let p = 0; p < mn; p++) cnt += g[p];
      grid = cnt > 0.01 * mn;
      // les lignes elles-mêmes (longues : au moins 40 % de la feuille), reportées sur la grille d'analyse
      // pour en être retirées (un cahier aux lignes plus marquées les y montre, et les traits de partage
      // d'une planche seraient vus partout)
      // (fines : ≈ 0,3 % de la feuille ; un trait de feutre posé sur une ligne est plus épais et reste)
      if (grid) gridMask = poolInk(ruledLines(pale, mw, mh, { len: 0.4, thick: 0.003 }));
    }
    const masks = (sT, wT, closeR, holeMax, drop, cut) => {
      // (sur un cahier ou un papier de couleur, l'encre vient de la grille d'analyse seule : les lignes
      // du cahier y sont invisibles, alors qu'à 1600 px elles relieraient tous les sujets ; les ombres
      // d'un papier de couleur y sont plus calmes)
      const ink = inkMask(data, w, h, paper, sT, wT, field);
      if (gridMask) for (let p = 0; p < n; p++) if (gridMask[p]) ink[p] = 0;
      if (!grid && !tint) { const hi = poolInk(inkMask(md, mw, mh, paper, sT, wT, null, null, true)); for (let p = 0; p < n; p++) if (hi[p]) ink[p] = 1; }
      if (drop) for (let p = 0; p < n; p++) if (drop[p]) ink[p] = 0;
      // Les bords du scan (ombres, bord de feuille) ne sont pas du dessin.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x < m || y < m || x >= w - m || y >= h - m) ink[y * w + x] = 0;
        }
      }
      // regroupe les traits d'un même sujet, puis ne garde qu'une marge de papier de quelques millimètres
      // (≈ 3 mm sur un A4), comme une découpe aux ciseaux : on ne rentre pas dans chaque creux d'un
      // contour ouvert, on contourne le sujet ; les traits distants de moins de ≈ 2 × closeR sont un même sujet
      let mask = dilate(ink, w, h, unit * closeR);
      mask = fillHoles(mask, w, h, holeMax ? holeMax * n : 0);
      mask = erode(mask, w, h, unit * (closeR - CUT.margin));
      if (cut) for (let p = 0; p < n; p++) if (cut[p]) mask[p] = 0;
      const { labels, comps } = components(mask, w, h);
      comps.sort((a, b) => b.area - a.area);
      return { ink, labels, comps };
    };
    let r = masks(strongT, weakT, CUT.close);
    // page « pontée » : un seul sujet couvre presque toute la feuille alors que l'encre y est rare
    // (lignes de texte, carreaux du cahier, cadre dessiné reliés par la fermeture, puis l'intérieur
    // bouché) ; la feuille entière serait posée comme une pièce. On referme de moins loin pour que
    // les vrais sujets (personnages, objets) se séparent du reste.
    const bridged = (rr) => {
      const c = rr.comps[0];
      if (!c) return false;
      const bb = (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
      if (bb < 0.6 * n) return false;
      let ink = 0;
      for (let p = 0; p < n; p++) if (rr.labels[p] === c.id && rr.ink[p]) ink++;
      return ink < 0.3 * c.area;
    };
    if (bridged(r)) {
      for (const f of [0.5, 0.3]) {
        const cr = Math.max(CUT.margin + 0.004, CUT.close * f);
        const r2 = masks(strongT, weakT, cr, 0.08);
        if (r2.comps.length && !bridged(r2)) { r = r2; r.closeR = cr; r.holeMax = 0.08; break; }
      }
    }
    // feuille partagée par de longs traits droits (cases d'une planche, lignes de partage, cadre tracé
    // autour) : ils relient tous les sujets en un seul bloc qui s'étend sur la feuille. On les retire de
    // l'encre avant de regrouper ; gardé seulement si les sujets se détachent vraiment
    const box = (c) => (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1);
    const some = (m) => { for (let p = 0; p < n; p++) if (m[p]) return true; return false; };
    const or = (a, b) => { const c = new Uint8Array(n); for (let p = 0; p < n; p++) c[p] = a[p] | b[p]; return c; };
    if (r.comps[0] && Math.max(...r.comps.map(box)) >= 0.6 * n && some(ruledLines(r.ink, w, h))) {
      // un grand trait de partage : la feuille est une planche ; ses traits de partage deviennent des
      // frontières (boardLines), y compris là où un sujet est posé dessus
      const bl = boardLines(r.ink, w, h);
      const cr = r.closeR || CUT.close, hm = r.holeMax || 0;
      let r2 = bl && masks(strongT, weakT, cr, hm, bl.drop, bl.cut);
      if (r2 && r2.comps.length >= r.comps.length + 2 && Math.max(...r2.comps.map(box)) < 0.5 * n) {
        // dans une case encore d'un seul tenant, les longs traits fins qui relient ses sujets
        // (collines, sol, chemin tracés au trait) sont retirés aussi : chaque personnage, chaque
        // objet se détache
        let drop = bl.drop;
        let extra = new Uint8Array(n);
        r2.comps.filter((c) => box(c) >= 0.06 * n)
          .forEach((c) => { extra = or(extra, longStrokes(r2.ink, w, h, c)); });
        // et les sujets d'une case se séparent quand ils ne se touchent pas (fermeture trois fois moins loin)
        const cr2 = Math.max(CUT.margin + 0.004, cr * 0.35);
        let closeUsed = cr;
        const r3 = masks(strongT, weakT, cr2, hm, or(drop, extra), bl.cut);
        if (r3.comps.length > r2.comps.length) {
          // les sujets trop petits pour faire une pièce seuls (bonshommes, sapins d'une case) restent
          // ensemble, une pièce par case, au lieu d'être perdus
          const cellOf = new Map(), groups = new Map();
          for (let p = 0; p < n; p++) { const l = r3.labels[p]; if (l && !cellOf.has(l)) cellOf.set(l, r2.labels[p]); }
          r3.comps.forEach((c) => {
            const cell = cellOf.get(c.id);
            if (c.area < 0.006 * n && cell) { if (!groups.has(cell)) groups.set(cell, []); groups.get(cell).push(c); }
          });
          const into = new Map();
          groups.forEach((g) => {
            if (g.length < 2) return;
            const k = g[0];
            k.group = true;
            g.slice(1).forEach((c) => {
              into.set(c.id, k.id); k.area += c.area;
              k.x0 = Math.min(k.x0, c.x0); k.y0 = Math.min(k.y0, c.y0); k.x1 = Math.max(k.x1, c.x1); k.y1 = Math.max(k.y1, c.y1);
            });
          });
          if (into.size) {
            for (let p = 0; p < n; p++) { const t = into.get(r3.labels[p]); if (t) r3.labels[p] = t; }
            r3.comps = r3.comps.filter((c) => !into.has(c.id)).sort((a, b) => b.area - a.area);
          }
          r2 = r3; drop = or(drop, extra); closeUsed = cr2;
        }
        r2.closeR = closeUsed; r2.holeMax = r.holeMax; r2.lines = or(drop, bl.cut);
        r = r2;
      }
    }
    // dessin très pâle (crayon léger sur papier blanc) : la première passe ne trouve que des miettes
    // éparses ; on refait avec des seuils plus bas, juste au-dessus du grain du papier, et des traits
    // reliés de plus loin
    let total = 0; r.comps.forEach((c) => { total += c.area; });
    if (r.comps.length >= 3 && total < n * 0.2 && r.comps[0].area < n * 0.08 && weakT < 30) {
      const wT2 = Math.max(10, Math.round(weakT * 0.7)), sT2 = Math.max(20, wT2 + 6);
      const r2 = masks(sT2, wT2, CUT.close + 0.01, 0, r.lines); // (sans les traits de partage retirés plus haut)
      let total2 = 0; r2.comps.forEach((c) => { total2 += c.area; });
      if (r2.comps.length && r2.comps[0].area > r.comps[0].area * 1.5 && total2 < n * 0.6) { r2.lines = r.lines; r = r2; weakT = wT2; strongT = sT2; }
    }
    return { work, data, w, h, paper, weakT, strongT, closeR: r.closeR || CUT.close, holeMax: r.holeMax || 0, lines: r.lines || null, grid, field, paperFrac: paperCount / n, rawPaperFrac: rawCount / n, labels: r.labels, comps: r.comps };
  }

  /*
   * Longs traits droits et fins qui partagent une feuille (cases d'une planche, lignes de partage,
   * cadre tracé autour) : horizontaux ou verticaux, longs d'au moins 60 % de la feuille dans leur sens,
   * épais de quelques pixels ; ils peuvent pencher un peu, s'interrompre, ou passer sous un sujet posé
   * dessus (on les suit à travers, sans retirer le sujet). Un trait plus court (jambe, tronc, mur
   * d'une maison) n'en est pas un. Rend les pixels de ces traits.
   */
  // o (facultatif) : len, la longueur minimale (fraction de la feuille, ou de la zone box) ; drift,
  // la pente permise d'un bout à l'autre ; box ({ x0, y0, x1, y1 }), la zone où chercher ; un long
  // trait courbe (colline, sol) se suit aussi, tant qu'il ne monte pas plus qu'il n'avance
  function ruledLines(ink, w, h, o) {
    const n = w * h, out = new Uint8Array(n);
    const len0 = (o && o.len) || 0.6, drift = (o && o.drift) || 0.08, bx = (o && o.box) || { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    const T = Math.max(2, Math.round(Math.max(w, h) * ((o && o.thick) || 0.008))); // épaisseur maximale (thick : fraction du grand côté)
    const GAP = Math.max(3, T * 2); // interruption permise
    const scan = (horiz) => {
      const A = horiz ? w : h, B = horiz ? h : w; // le long du trait, et en travers
      const a0min = horiz ? bx.x0 : bx.y0, a0max = horiz ? bx.x1 : bx.y1, b0min = horiz ? bx.y0 : bx.x0, b0max = horiz ? bx.y1 : bx.x1;
      const L = Math.round((a0max - a0min + 1) * len0); // longueur minimale
      const at = horiz ? (a, b) => b * w + a : (a, b) => a * w + b;
      // les pixels d'encre où le trait est fin, en travers
      const thin = new Uint8Array(n);
      for (let a = a0min; a <= a0max; a++) {
        let b = 0;
        while (b < B) {
          if (!ink[at(a, b)]) { b++; continue; }
          let b1 = b;
          while (b1 < B && ink[at(a, b1)]) b1++;
          if (b1 - b <= T) for (let k = b; k < b1; k++) thin[at(a, k)] = 1;
          b = b1;
        }
      }
      // un suivi part de chaque début de trait (rien de fin juste avant lui) : un trait croisé ou
      // longé par un autre est quand même suivi depuis son début
      const startsAt = (a, b) => !(a > a0min && [-1, 0, 1].some((d) => b + d >= 0 && b + d < B && thin[at(a - 1, b + d)]));
      for (let b0 = b0min; b0 <= b0max; b0++) {
        for (let a0 = a0min; a0 <= a0max; a0++) {
          const p0 = at(a0, b0);
          if (!thin[p0] || !startsAt(a0, b0)) continue;
          // on suit le trait pas à pas, à un pixel près en travers ; sous un sujet (encre épaisse), on
          // continue tout droit ; un vrai blanc peut l'interrompre un peu
          const pts = [[a0, b0]];
          let a = a0, b = b0, miss = 0, end = a0;
          while (a + 1 <= a0max && miss <= GAP) {
            a++;
            let nb = -1;
            for (const d of [0, -1, 1]) { const bb = b + d; if (bb >= 0 && bb < B && thin[at(a, bb)]) { nb = bb; break; } }
            if (nb >= 0 && nb >= b0min && nb <= b0max) { miss = 0; b = nb; pts.push([a, b]); end = a; continue; }
            if (ink[at(a, b)]) { miss = 0; continue; }
            miss++;
          }
          const len = end - a0;
          const eb = pts[pts.length - 1][1];
          // assez long, droit, et fin sur au moins la moitié de sa longueur
          if (len < L || Math.abs(eb - b0) > len * drift || pts.length < len * 0.5) continue;
          pts.forEach(([pa, pb]) => {
            for (let k = pb; k >= 0 && k > pb - T - 1 && ink[at(pa, k)]; k--) out[at(pa, k)] = 1;
            for (let k = pb + 1; k < B && k < pb + T + 1 && ink[at(pa, k)]; k++) out[at(pa, k)] = 1;
          });
        }
      }
    };
    scan(true);
    scan(false);
    // avec le liseré pâle du trait (une passe aux seuils plus bas le verrait encore)
    return dilate(out, w, h, 2);
  }

  /*
   * Les traits de partage d'une planche (cases), comme des droites un peu penchées : d'abord ceux qui
   * traversent la feuille (au moins 55 % de leur longueur tracée au trait fin), puis, dans chaque
   * partie qu'ils délimitent, ceux qui la traversent (au moins 45 %) — un trait de partage s'arrête
   * souvent à un autre. Une droite est cherchée parmi les pentes de ±10 % (transformée de Hough
   * réduite aux pixels fins). Rend cut (la bande de chaque droite, d'un bout à l'autre de sa partie :
   * une frontière, même sous un sujet posé dessus) et drop (l'encre du trait), ou null.
   */
  function boardLines(ink, w, h) {
    const n = w * h, T = Math.max(2, Math.round(Math.max(w, h) * 0.008));
    const thinOf = (horiz) => {
      const A = horiz ? w : h, B = horiz ? h : w, at = horiz ? (a, b) => b * w + a : (a, b) => a * w + b;
      const t = new Uint8Array(n);
      for (let a = 0; a < A; a++) {
        let b = 0;
        while (b < B) {
          if (!ink[at(a, b)]) { b++; continue; }
          let b1 = b;
          while (b1 < B && ink[at(a, b1)]) b1++;
          if (b1 - b <= T) for (let k = b; k < b1; k++) t[at(a, k)] = 1;
          b = b1;
        }
      }
      return t;
    };
    const thin = { true: thinOf(true), false: thinOf(false) };
    const cut = new Uint8Array(n), drop = new Uint8Array(n);
    // les droites d'une orientation dans une partie R ({ x0, y0, x1, y1 }) ; frac : part minimale tracée
    const find = (horiz, R, frac, most) => {
      const A0 = horiz ? R.x0 : R.y0, A1 = horiz ? R.x1 : R.y1, B0 = horiz ? R.y0 : R.x0, B1 = horiz ? R.y1 : R.x1;
      const at = horiz ? (a, b) => b * w + a : (a, b) => a * w + b;
      const t = thin[horiz].slice();
      const span = A1 - A0 + 1, step = 2, out = [];
      for (let k = 0; k < most; k++) {
        let best = null;
        for (let si = -17; si <= 17; si++) {
          const sl = si * 0.006;
          for (let b = B0; b <= B1; b++) {
            let cnt = 0;
            for (let a = A0; a <= A1; a += step) {
              const bb = Math.round(b + sl * (a - A0));
              if (bb < B0 || bb > B1) continue;
              if (t[at(a, bb)] || (bb > B0 && t[at(a, bb - 1)]) || (bb < B1 && t[at(a, bb + 1)])) cnt++;
            }
            if (!best || cnt > best.cnt) best = { cnt, b, sl };
          }
        }
        if (!best || best.cnt * step < frac * span) break;
        const line = { horiz, A0, A1, B0, B1, b: best.b, sl: best.sl };
        out.push(line);
        // (la suivante est cherchée ailleurs)
        for (let a = A0; a <= A1; a++) {
          const bb = Math.round(line.b + line.sl * (a - A0));
          for (let d = -3 * T; d <= 3 * T; d++) if (bb + d >= B0 && bb + d <= B1) t[at(a, bb + d)] = 0;
        }
      }
      return out;
    };
    const mark = (line) => {
      const at = line.horiz ? (a, b) => b * w + a : (a, b) => a * w + b, B = line.horiz ? h : w;
      for (let a = line.A0; a <= line.A1; a++) {
        const bb = Math.round(line.b + line.sl * (line.a0 === undefined ? a - line.A0 : a - line.A0));
        for (let d = -T; d <= T; d++) { const q = bb + d; if (q >= 0 && q < B) cut[at(a, q)] = 1; }
        for (let d = -T - 2; d <= T + 2; d++) { const q = bb + d; if (q >= 0 && q < B && ink[at(a, q)]) drop[at(a, q)] = 1; }
      }
    };
    const page = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    const big = { true: find(true, page, 0.55, 3), false: find(false, page, 0.55, 3) };
    if (!big.true.length && !big.false.length) return null;
    // les parties entre les grandes droites d'une orientation : on y cherche celles de l'autre
    const parts = (lines, horiz) => {
      // (horiz : droites horizontales, parties empilées de haut en bas ; sinon côte à côte)
      const pos = lines.map((l) => [Math.min(l.b, l.b + l.sl * (l.A1 - l.A0)), Math.max(l.b, l.b + l.sl * (l.A1 - l.A0))]).sort((p, q) => p[0] - q[0]);
      const out = [];
      let from = 0;
      const max = horiz ? h - 1 : w - 1;
      pos.forEach(([lo, hi]) => { if (lo - T - from > 8) out.push([from, Math.floor(lo) - T]); from = Math.ceil(hi) + T; });
      if (max - from > 8) out.push([from, max]);
      return out.map(([u, v]) => (horiz ? { x0: 0, x1: w - 1, y0: u, y1: v } : { x0: u, x1: v, y0: 0, y1: h - 1 }));
    };
    const all = [...big.true, ...big.false];
    // (une seule par partie : le trait souligné d'une étiquette n'est pas une frontière)
    if (big.false.length) parts(big.false, false).forEach((R) => all.push(...find(true, R, 0.45, 1)));
    if (big.true.length) parts(big.true, true).forEach((R) => all.push(...find(false, R, 0.45, 1)));
    all.forEach(mark);
    return { cut, drop: dilate(drop, w, h, 2) };
  }

  /*
   * Longs tracés fins dans une zone (une case d'une planche) : collines, sol, chemin dessinés d'un
   * trait, droits ou courbes, qui relient ses sujets. Ce sont les morceaux d'un seul tenant de l'encre
   * fine (épaisse de quelques pixels dans un sens ou dans l'autre) qui s'étendent sur au moins 40 % de
   * la zone, ou sur 22 % s'ils sont nettement allongés (une colline coupée par un sujet posé dessus) ;
   * un contour de personnage ou un flocon, plus courts ou plus ronds, restent. Rend leurs pixels.
   */
  function longStrokes(ink, w, h, c) {
    const n = w * h, T = Math.max(2, Math.round(Math.max(w, h) * 0.008));
    const thin = new Uint8Array(n);
    // fin en hauteur
    for (let x = c.x0; x <= c.x1; x++) {
      let y = c.y0;
      while (y <= c.y1) {
        if (!ink[y * w + x]) { y++; continue; }
        let y1 = y;
        while (y1 <= c.y1 && ink[y1 * w + x]) y1++;
        if (y1 - y <= T) for (let k = y; k < y1; k++) thin[k * w + x] = 1;
        y = y1;
      }
    }
    // ou en largeur
    for (let y = c.y0; y <= c.y1; y++) {
      let x = c.x0;
      while (x <= c.x1) {
        if (!ink[y * w + x]) { x++; continue; }
        let x1 = x;
        while (x1 <= c.x1 && ink[y * w + x1]) x1++;
        if (x1 - x <= T) for (let k = x; k < x1; k++) thin[y * w + k] = 1;
        x = x1;
      }
    }
    const out = new Uint8Array(n), seen = new Uint8Array(n);
    const ext = 0.4 * Math.max(c.x1 - c.x0 + 1, c.y1 - c.y0 + 1);
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const p0 = y * w + x;
        if (!thin[p0] || seen[p0]) continue;
        // un morceau d'un seul tenant (voisins en diagonale compris)
        const st = [p0], part = [];
        seen[p0] = 1;
        let x0 = x, x1 = x, y0 = y, y1 = y;
        while (st.length) {
          const p = st.pop();
          part.push(p);
          const px = p % w, py = (p - px) / w;
          if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const qx = px + dx, qy = py + dy;
              if (qx < c.x0 || qx > c.x1 || qy < c.y0 || qy > c.y1) continue;
              const q = qy * w + qx;
              if (thin[q] && !seen[q]) { seen[q] = 1; st.push(q); }
            }
          }
        }
        // assez long ; ou, interrompu par un sujet posé dessus, un morceau nettement allongé
        const big = Math.max(x1 - x0 + 1, y1 - y0 + 1), small = Math.min(x1 - x0 + 1, y1 - y0 + 1);
        if (big >= ext || (big >= ext * 0.55 && small <= big * 0.3)) part.forEach((p) => { out[p] = 1; });
      }
    }
    return dilate(out, w, h, 1.5);
  }

  /*
   * Encre à deux seuils (hystérésis) : un pixel franchement différent du papier est dessiné ; un pixel
   * seulement un peu différent (couleur pâle, crayon léger, dégradé) l'est aussi s'il touche, de
   * proche en proche, un pixel franc. Le bruit du papier, isolé, ne passe pas.
   */
  // Écart d'un pixel au papier. Papier coloré (feuille verte, bleue, jaune…) : l'ombre d'un pli, c'est la
  // même couleur en plus sombre ; le pixel est ramené à la clarté du papier avant la comparaison, pour
  // que l'ombre reste du papier (un trait noir, bien plus sombre, ou une autre couleur restent de l'encre).
  function paperTint(paper) {
    const mx = Math.max(paper[0], paper[1], paper[2]), mn = Math.min(paper[0], paper[1], paper[2]);
    return mx > 0 && (mx - mn) / mx > 0.18 && lum(paper) > 80 ? lum(paper) : 0;
  }
  /*
   * Papier de couleur photographié ou froissé : sa couleur varie d'un endroit à l'autre (ombre d'un
   * pli, lumière qui baisse d'un côté) plus que la distance au papier moyen ne le tolère, et ces
   * ombres passeraient pour du dessin. On estime la couleur du papier case par case (les plus clairs
   * des pixels de la teinte du papier), les cases sans papier visible (sous le dessin) prennent celle
   * de leurs voisines, puis le tout est lissé. Rend { gw, gh, cell, bg, tint } (bg : rgb par case,
   * tint : clarté du papier de la case pour la comparaison insensible à l'ombre).
   */
  function paperField(d, w, h, paper) {
    const cell = Math.max(4, Math.round(Math.max(w, h) / 60));
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), G = gw * gh;
    const bg = new Float32Array(G * 3), ok = new Uint8Array(G);
    const ps = paper[0] + paper[1] + paper[2] || 1, pr = paper[0] / ps, pg = paper[1] / ps, pl = lum(paper);
    const idx = [], lv = [];
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      idx.length = 0; lv.length = 0;
      let total = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++) for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
        total++;
        const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2], sm = r + g + b || 1;
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        // la teinte du papier (à l'ombre près), pas trop sombre
        if (l >= 0.4 * pl && Math.abs(r / sm - pr) < 0.035 && Math.abs(g / sm - pg) < 0.035) { idx.push(i); lv.push(l); }
      }
      if (idx.length < total * 0.15) continue;
      const order = lv.map((l, k) => k).sort((a, b) => lv[a] - lv[b]);
      let r = 0, g = 0, b = 0, m = 0;
      for (let k = Math.floor(order.length * 0.7); k < order.length; k++) { const i = idx[order[k]]; r += d[i]; g += d[i + 1]; b += d[i + 2]; m++; }
      const c = gy * gw + gx;
      bg[c * 3] = r / m; bg[c * 3 + 1] = g / m; bg[c * 3 + 2] = b / m; ok[c] = 1;
    }
    let nOk = 0;
    for (let c = 0; c < G; c++) nOk += ok[c];
    if (nOk < G * 0.2) return null;
    // les cases sans papier visible prennent la couleur de leurs voisines, de proche en proche
    for (let pass = 0; pass < gw + gh && nOk < G; pass++) {
      const add = [];
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        const c = gy * gw + gx;
        if (ok[c]) continue;
        let r = 0, g = 0, b = 0, m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = gy + dy, xx = gx + dx;
          if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          const q = yy * gw + xx;
          if (ok[q]) { r += bg[q * 3]; g += bg[q * 3 + 1]; b += bg[q * 3 + 2]; m++; }
        }
        if (m) add.push([c, r / m, g / m, b / m]);
      }
      if (!add.length) break;
      add.forEach(([c, r, g, b]) => { bg[c * 3] = r; bg[c * 3 + 1] = g; bg[c * 3 + 2] = b; ok[c] = 1; nOk++; });
    }
    // lissage (deux passes 3 × 3)
    for (let pass = 0; pass < 2; pass++) {
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
    const tint = new Float32Array(G);
    for (let c = 0; c < G; c++) tint[c] = paperTint([bg[c * 3], bg[c * 3 + 1], bg[c * 3 + 2]]);
    return { gw, gh, cell, bg, tint };
  }
  // Les cases du champ de papier pour chaque colonne et chaque ligne d'une image (map : x0, y0, k —
  // le pixel (x, y) de l'image est le point (x0 + x / k, y0 + y / k) de l'image où le champ a été estimé)
  function fieldIndex(field, w, h, map) {
    const m = map || { x0: 0, y0: 0, k: 1 };
    const cx = new Int32Array(w), cy = new Int32Array(h);
    for (let x = 0; x < w; x++) cx[x] = Math.min(field.gw - 1, Math.max(0, Math.floor((m.x0 + x / m.k) / field.cell)));
    for (let y = 0; y < h; y++) cy[y] = Math.min(field.gh - 1, Math.max(0, Math.floor((m.y0 + y / m.k) / field.cell))) * field.gw;
    return { cx, cy };
  }
  function paperDist2(R, G, B, paper, tint) {
    const dr = R - paper[0], dg = G - paper[1], db = B - paper[2];
    const q = dr * dr + dg * dg + db * db;
    if (!tint) return q;
    const k = (0.299 * R + 0.587 * G + 0.114 * B) / tint;
    if (k <= 0.5 || k >= 1.2) return q;
    const f = 1 / k, er = R * f - paper[0], eg = G * f - paper[1], eb = B * f - paper[2];
    return Math.min(q, er * er + eg * eg + eb * eb);
  }
  function weakThreshold(d, w, h, paper) {
    // écart typique du papier lui-même (grain, ombres légères), mesuré sur la bordure
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
    const dist = [];
    const tint = paperTint(paper);
    forEachBorder(w, h, band, (p) => { const i = p * 4; dist.push(Math.sqrt(paperDist2(d[i], d[i + 1], d[i + 2], paper, tint))); });
    dist.sort((a, b) => a - b);
    const q90 = dist[Math.min(dist.length - 1, Math.floor(dist.length * 0.9))] || 0;
    // (un scan propre descend bas : un crayon pâle y est encore séparé du grain du papier)
    return Math.max(14, Math.min(INK_DIST - 5, q90 * 1.8 + 8));
  }
  // Chaque pixel face au papier : 0 (papier), 1 (encre pâle : couleur claire, crayon léger, liseré d'un
  // trait), 2 (encre franche). Un gris neutre se juge à sa luminosité (un reste d'ombre reste à moins
  // de ≈ 30 du papier ; un trait de crayon descend plus bas), une couleur à sa distance au papier.
  // field, map (facultatifs) : la couleur du papier case par case (voir paperField) plutôt que la
  // couleur moyenne, sur un papier de couleur ombré
  // colorOnly : seules les couleurs franches comptent (saturation ≥ 0,25) ; les gris et les teintes à
  // peine colorées (crayon, ombres, poussières) ne comptent pas
  function inkLevels(d, w, h, paper, strongT, weakT, field, map, colorOnly) {
    const n = w * h, lv = new Uint8Array(n);
    const S2 = strongT * strongT, W2 = weakT * weakT;
    const pl0 = lum(paper), tint0 = paperTint(paper);
    const gStrong = Math.round(strongT * 0.82), gWeak = Math.min(30, gStrong - 6);
    const fi = field ? fieldIndex(field, w, h, map) : null, pp = [0, 0, 0];
    // sur papier blanc, une couleur pâle (jaune clair, rose pâle) reste proche du papier en distance
    // mais s'en distingue par sa saturation
    const ps = !tint0 ? sat(paper) : 1;
    let paperAt = paper, pl = pl0, tint = tint0;
    for (let y = 0, p = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++, i += 4) {
        if (fi) {
          const c = fi.cy[y] + fi.cx[x];
          pp[0] = field.bg[c * 3]; pp[1] = field.bg[c * 3 + 1]; pp[2] = field.bg[c * 3 + 2];
          paperAt = pp; pl = 0.299 * pp[0] + 0.587 * pp[1] + 0.114 * pp[2]; tint = field.tint[c];
        }
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const mx = R > G ? (R > B ? R : B) : (G > B ? G : B), mn = R < G ? (R < B ? R : B) : (G < B ? G : B);
        if (colorOnly && mx - mn < 0.25 * mx) { lv[p] = 0; continue; }
        if (mx - mn < 0.15 * mx) {
          const dl = pl - (0.299 * R + 0.587 * G + 0.114 * B);
          lv[p] = dl > gStrong ? 2 : dl > gWeak ? 1 : 0;
        } else {
          const q = paperDist2(R, G, B, paperAt, tint);
          let L = q > S2 ? 2 : q > W2 ? 1 : 0;
          if (L < 2 && !tint) { const ds = (mx - mn) / mx - ps; if (ds > 0.3) L = 2; else if (ds > 0.2 && L < 1) L = 1; }
          lv[p] = L;
        }
      }
    }
    return lv;
  }
  function inkMask(d, w, h, paper, strongT, weakT, field, map, colorOnly) {
    const n = w * h;
    const lv = inkLevels(d, w, h, paper, strongT, weakT, field, map, colorOnly);
    const weak = new Uint8Array(n);
    const ink = new Uint8Array(n);
    const stack = [];
    for (let p = 0; p < n; p++) {
      if (lv[p]) weak[p] = 1;
      if (lv[p] === 2) { ink[p] = 1; stack.push(p); }
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

  /*
   * Coupe arrondie au bord de la page. Pour chaque côté du cadre qui est un bord de la page, les
   * tronçons où la découpe touche ce bord (deux tronçons séparés de moins de ≈ 6 mm n'en font
   * qu'un) sont remplacés par un dôme : une demi-ellipse qui touche le bord en son milieu et
   * remonte vers l'intérieur aux deux extrémités du tronçon, sur une profondeur de 35 % de sa
   * longueur, au plus ≈ 4 % du grand côté de la page (12 mm sur un A4). On ne fait qu'enlever.
   */
  function roundPageEdges(m, W, H, edges, unit) {
    const gapMax = unit * 0.02, dMax = unit * 0.04;
    const side = (n, depthMax, at) => {
      const on = new Uint8Array(n);
      for (let i = 0; i < n; i++) on[i] = m[at(i, 0)] || (depthMax > 1 && m[at(i, 1)]) ? 1 : 0;
      const runs = [];
      let s = -1, last = -1;
      for (let i = 0; i < n; i++) {
        if (!on[i]) continue;
        if (s < 0) s = i;
        else if (i - last > gapMax) { runs.push([s, last]); s = i; }
        last = i;
      }
      if (s >= 0) runs.push([s, last]);
      runs.forEach(([a, b]) => {
        const L = b - a + 1;
        if (L < 2) return;
        const c = (a + b) / 2, half = L / 2, d = Math.max(2, Math.min(L * 0.35, dMax));
        for (let i = a; i <= b; i++) {
          const u = (i - c) / half;
          const cut = Math.min(depthMax, Math.ceil(d * (1 - Math.sqrt(Math.max(0, 1 - u * u)))));
          for (let dd = 0; dd < cut; dd++) m[at(i, dd)] = 0;
        }
      });
    };
    if (edges.t) side(W, H, (i, d) => d * W + i);
    if (edges.b) side(W, H, (i, d) => (H - 1 - d) * W + i);
    if (edges.l) side(H, W, (i, d) => i * W + d);
    if (edges.r) side(H, W, (i, d) => i * W + (W - 1 - d));
    // fines pointes restées au ras du bord (trait du scanner, ombre de la feuille) : une ouverture de
    // ≈ 1 mm, dans la bande proche du bord seulement
    if (!(edges.t || edges.b || edges.l || edges.r)) return;
    const rr = Math.max(1, unit * 0.004), band = Math.ceil(dMax + rr * 2);
    const op = dilate(erode(m, W, H, rr), W, H, rr);
    for (let y = 0; y < H; y++) {
      const nearY = (edges.t && y < band) || (edges.b && y >= H - band);
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (!m[p] || op[p]) continue;
        if (nearY || (edges.l && x < band) || (edges.r && x >= W - band)) m[p] = 0;
      }
    }
  }

  function makePiece(page, seg, comp, orig) {
    const { w, h, labels, data } = seg;
    const k = page.width / w;
    // marge autour du sujet : la fermeture (rayon close) doit pouvoir s'étaler puis se rétracter sans
    // buter sur le bord du cadre (un masque collé au bord n'y serait pas érodé) ; la pièce garde
    // ainsi un bord transparent et sa vraie marge
    const pad = Math.ceil(Math.max(w, h) * (CUT.close + 0.006)) + 2;
    const x0 = Math.max(0, comp.x0 - pad), y0 = Math.max(0, comp.y0 - pad);
    const x1 = Math.min(w - 1, comp.x1 + pad), y1 = Math.min(h - 1, comp.y1 + pad);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    let a = new Float32Array(bw * bh);
    let r = 0, g = 0, b = 0, cnt = 0, satSum = 0;
    // l'encre seule (pixels loin du papier) : sa saturation moyenne et sa part sombre, pour distinguer
    // un petit sujet au feutre ou au crayon (coloré, ou noir) d'une ombre de pli ou d'un bord de feuille
    // (pâle et terne), que « colorful » (moyenne sur toute la pièce, marge de papier comprise) ne sépare pas
    const tint = paperTint(seg.paper), W2 = (seg.weakT || 30) * (seg.weakT || 30);
    const psum = seg.paper[0] + seg.paper[1] + seg.paper[2] || 1, pr = seg.paper[0] / psum, pg = seg.paper[1] / psum;
    let inkCnt = 0, inkSat = 0, inkDark = 0, inkPaper = 0;
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
          if (paperDist2(px[0], px[1], px[2], seg.paper, tint) > W2) {
            inkCnt++; inkSat += s; if (lum(px) < 120) inkDark++;
            // de la teinte du papier (un pli, un bord de feuille de couleur dans l'ombre) ?
            const sm = px[0] + px[1] + px[2] || 1;
            if (tint && Math.abs(px[0] / sm - pr) < 0.035 && Math.abs(px[1] / sm - pg) < 0.035) inkPaper++;
          }
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
    const fmap = { x0, y0, k: kf };
    const inkF = inkMask(fd, fw, fh, seg.paper, seg.strongT || INK_DIST, seg.weakT || 30, seg.field, fmap);
    for (let p = 0; p < inkF.length; p++) if (!allowed[p]) inkF[p] = 0;
    // papier quadrillé : ses traits fins et pâles, suivis ici à la résolution fine (ceux de l'analyse
    // grossière ne les couvrent pas pixel à pixel), ne font pas partie du sujet ; l'encre franche reste
    if (seg.grid) {
      // (les lignes se suivent sur toute l'encre pâle de la zone, pas seulement sur ce qui touche un trait)
      const lv = inkLevels(fd, fw, fh, seg.paper, seg.strongT || INK_DIST, seg.weakT || 30, seg.field, fmap), pale = new Uint8Array(lv.length);
      for (let p = 0; p < lv.length; p++) pale[p] = lv[p] ? 1 : 0;
      // (une ligne du cahier peut être aussi contrastée qu'un trait : tout trait fin et droit qui
      // traverse une bonne part de la zone est retiré ; un trait épais du dessin n'est pas touché)
      const rl = ruledLines(pale, fw, fh, { len: 0.4, thick: Math.max(0.003, 0.003 * funit / Math.max(fw, fh)) });
      for (let p = 0; p < rl.length; p++) if (rl[p]) inkF[p] = 0;
    }
    // feuille partagée par des traits (voir ruledLines) : ils ne font pas partie du sujet
    if (seg.lines) {
      for (let y = 0; y < fh; y++) {
        const r0 = (y0 + Math.min(bh - 1, Math.floor(y / kf))) * w + x0, o = y * fw;
        for (let x = 0; x < fw; x++) if (seg.lines[r0 + colF[x]]) inkF[o + x] = 0;
      }
    }
    // La coupe serre le dessin au plus près : l'encre élargie de la marge (≈ 3 mm), les trous bouchés
    // (l'intérieur d'un contour fermé est le dessin). Les creux ouverts (entre les jambes, entre un bras
    // et le corps) sont découpés, comme aux ciseaux. Si la pièce se retrouve en plusieurs îlots (des
    // traits qui ne se touchent pas), la fermeture est élargie juste assez pour les relier, et seuls les
    // ponts entre îlots sont gardés — pas les creux qu'une grande fermeture boucherait partout.
    const closeR = seg.closeR || CUT.close;
    const holeMax = seg.holeMax ? seg.holeMax * seg.w * seg.h * kf * kf : 0;
    const closing = (r) => erode(dilate(inkF, fw, fh, funit * r), fw, fh, funit * (r - CUT.margin));
    let fm = keepInsides(dilate(inkF, fw, fh, funit * CUT.margin), inkF, fw, fh, funit, holeMax);
    fm = bridgeIslands(fm, fw, fh, closing, CUT.margin, closeR);
    // si la détection fine n'a presque rien trouvé (sujet très pâle), on garde la forme grossière
    let fmCount = 0; for (let p = 0; p < fm.length; p++) fmCount += fm[p];
    let regCount = 0; for (let p = 0; p < region.length; p++) regCount += region[p];
    const useFine = fmCount > regCount * 0.12;
    let alpha = useFine ? fm : region;
    // coupe lisse, comme aux ciseaux : les petites dents et encoches du contour (≈ 2 mm) sont
    // gommées (ouverture puis fermeture, qui arrondissent aussi les angles), sans jamais entamer
    // l'encre, qui garde au moins ≈ 1 mm de papier autour d'elle
    if (useFine) {
      const rs = funit * CUT.smooth;
      let sm = dilate(erode(alpha, fw, fh, rs), fw, fh, rs);
      // la fermeture est courte (≈ 0,7 mm) : elle comble les petites encoches et les fentes (moins de
      // ≈ 1,5 mm) et adoucit les angles rentrants, sans boucher un creux plus large (entre deux jambes,
      // entre deux têtes), qui reste découpé
      const rc = rs * 0.3;
      sm = erode(dilate(sm, fw, fh, rc), fw, fh, rc);
      const guard = dilate(inkF, fw, fh, funit * Math.min(0.004, CUT.margin * 0.5));
      for (let p = 0; p < sm.length; p++) if (guard[p]) sm[p] = 1;
      alpha = sm;
    }
    // un dessin qui sort de la feuille : là où la découpe touche le bord de la page, la coupe
    // s'arrondit au lieu de suivre le bord en ligne droite
    if (useFine) roundPageEdges(alpha, fw, fh, { t: y0 === 0, b: y1 === h - 1, l: x0 === 0, r: x1 === w - 1 }, funit);
    // bord adouci sur ≈ 2 pixels (anti-crénelage), sans halo
    const soft = boxBlur(softEdge(alpha, fw, fh), fw, fh);
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
    clearFrame(pc);

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
      inkSat: inkCnt ? inkSat / inkCnt : 0,
      inkDark: inkCnt ? inkDark / inkCnt : 0,
      inkPaper: inkCnt ? inkPaper / inkCnt : 0,
      inkPx: inkCnt,
      base,
      // emplacement de la pièce dans la page (en pixels de page), pour pouvoir retoucher la découpe
      src: { x: x0 * k, y: y0 * k, w: pw, h: ph },
    };
  }

  // Bouche les trous d'une découpe serrée (l'encre élargie de la marge), sauf les poches : un espace
  // blanc que seules les marges referment (entre deux têtes qui ne se touchent pas, entre un bras et
  // le corps) n'est pas l'intérieur du dessin et reste découpé. Un vrai intérieur est clos par l'encre
  // elle-même (à ≈ 3 mm près : un trait interrompu reste un contour) ; une petite poche (moins de
  // ≈ 0,5 cm²) reste bouchée.
  function keepInsides(tight, ink, w, h, funit, holeMax) {
    const filled = fillHoles(tight, w, h, holeMax);
    const n = w * h, holes = new Uint8Array(n);
    let any = 0;
    for (let p = 0; p < n; p++) if (filled[p] && !tight[p]) { holes[p] = 1; any = 1; }
    if (!any) return filled;
    const hc = components(holes, w, h);
    const closed = fillHoles(dilate(ink, w, h, funit * 0.005), w, h, holeMax);
    const leak = new Float64Array(hc.comps.length + 1);
    for (let p = 0; p < n; p++) if (holes[p] && !closed[p]) leak[hc.labels[p]]++;
    const minArea = (funit * 0.025) * (funit * 0.025), drop = new Uint8Array(hc.comps.length + 1);
    for (const c of hc.comps) if (c.area > minArea && leak[c.id] > c.area * 0.05) drop[c.id] = 1;
    const out = filled.slice();
    for (let p = 0; p < n; p++) if (holes[p] && drop[hc.labels[p]]) out[p] = 0;
    return out;
  }

  // Relie les îlots d'une découpe serrée (tight) par les ponts de la plus petite fermeture qui la rend
  // d'un seul tenant (dichotomie entre la marge et le rayon de fermeture) ; les creux que cette
  // fermeture boucherait sans relier deux îlots restent ouverts. Ce qui ne se relie pas même à la
  // fermeture entière reste tel quel (c'était déjà en plusieurs morceaux).
  function bridgeIslands(tight, w, h, closing, rMin, rMax) {
    const isl = components(tight, w, h);
    if (isl.comps.length <= 1) return tight;
    const full = closing(rMax);
    const nFull = components(full, w, h).comps.length;
    if (nFull >= isl.comps.length) return tight;
    let lo = rMin, hi = rMax;
    for (let it = 0; it < 4; it++) {
      const mid = (lo + hi) / 2;
      if (components(closing(mid), w, h).comps.length <= nFull) hi = mid; else lo = mid;
    }
    // un peu plus que le strict minimum : des ponts francs, pas des fils
    const best = hi + 0.004 < rMax ? closing(hi + 0.004) : full;
    // les ajouts de la fermeture : gardés s'ils touchent au moins deux îlots (un pont), écartés sinon (un creux)
    const n = w * h, add = new Uint8Array(n);
    for (let p = 0; p < n; p++) add[p] = best[p] && !tight[p] ? 1 : 0;
    const ac = components(add, w, h);
    const touch = new Map();
    for (let p = 0; p < n; p++) {
      const l = ac.labels[p];
      if (!l) continue;
      const x = p % w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
      for (const q of nb) if (q >= 0 && tight[q]) { if (!touch.has(l)) touch.set(l, new Set()); touch.get(l).add(isl.labels[q]); }
    }
    const out = tight.slice();
    for (let p = 0; p < n; p++) { const l = ac.labels[p]; if (l && touch.has(l) && touch.get(l).size >= 2) out[p] = 1; }
    return out;
  }
  function cutPieces(page, seg) {
    seg = seg || segment(page);
    const enhanced = enhance(page, seg.paper);
    const minArea = seg.w * seg.h * 0.0008;
    return seg.comps
      // (un groupe de petits sujets d'une case est gardé un peu plus petit)
      .filter((c) => c.area >= (c.group ? minArea / 2 : minArea) && c.x1 - c.x0 > 10 && c.y1 - c.y0 > 10)
      // (une feuille partagée en cases en a davantage : chaque case a ses sujets)
      .slice(0, seg.lines ? 2 * MAX_PIECES_PER_PAGE : MAX_PIECES_PER_PAGE)
      .map((c) => {
        const piece = makePiece(enhanced, seg, c, page);
        piece.src.paper = seg.paper;
        if (c.group) piece.group = true;
        // au bord de la feuille (bande de ≈ 3 % du petit côté)
        const m = Math.round(Math.min(seg.w, seg.h) * 0.03);
        piece.edge = c.x0 <= m || c.y0 <= m || c.x1 >= seg.w - 1 - m || c.y1 >= seg.h - 1 - m;
        return piece;
      })
      // petite et terne : ombre d'un pli, bord de feuille, reste de table, pas un sujet. Un petit sujet
      // (cœur au crayon, étoile au feutre, animal noir) a une encre colorée ou sombre, une ombre non.
      .filter((q) => {
        // (sur une feuille de couleur, un petit morceau au bord de la page qui a en partie la teinte du
        // papier est un coin relevé ou un bord dans l'ombre)
        const dull = (q.colorful < (q.group ? 0.05 : 0.2) && q.inkSat < 0.25 && q.inkDark < 0.25) || q.inkPaper > 0.6 || (q.edge && paperTint(seg.paper) && q.inkPaper > 0.3)
          || q.inkPx < Math.pow(0.01 * Math.max(seg.w, seg.h), 2); // un point de poussière (≈ 3 mm d'encre au plus)
        if (q.frac < 0.012 && dull) { release(q.canvas); return false; }
        return true;
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

  function textureFrom(page, rect) {
    // on rogne un peu les bords du scan (ombres, bord de feuille) ; rect (fractions de la page) : le
    // cadrage choisi à la main
    const mx = page.width * 0.015, my = page.height * 0.015;
    const c = enhance(rect
      ? crop(page, page.width * rect.x, page.height * rect.y, Math.max(1, page.width * rect.w), Math.max(1, page.height * rect.h))
      : crop(page, mx, my, page.width - 2 * mx, page.height - 2 * my), null);
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
      clearFrame(pc);
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
  /*
   * Apprentissage d'une retouche de découpe. La découpe faite à la main (after) est comparée à la
   * découpe automatique de la même pièce (before), toutes deux en pixels de page, et les préférences
   * de découpe en sont déduites :
   *  - la marge de papier gardée autour de l'encre, mesurée sur le contour retouché ;
   *  - la sensibilité aux traits pâles : des zones restaurées pleines d'encre faible (sous le seuil)
   *    la font monter ; des zones effacées pleines de traces grises la font baisser ;
   *  - les traits reliés : une zone effacée pleine d'encre franche et colorée est un sujet voisin que
   *    la fermeture avait rattaché, le rayon de fermeture baisse.
   * Rend { prefs, changes } (changes : liste de mots-clés) ou null si la retouche n'apprend rien.
   */
  function learnCut(page, cut, before, after) {
    if (!cut || !before || !after || !before.canvas || !after.canvas) return null;
    const unit = Math.max(page.width, page.height);
    const pad = unit * 0.02;
    const x0 = Math.max(0, Math.floor(Math.min(before.src.x, after.src.x) - pad)), y0 = Math.max(0, Math.floor(Math.min(before.src.y, after.src.y) - pad));
    const x1 = Math.min(page.width, Math.ceil(Math.max(before.src.x + before.src.w, after.src.x + after.src.w) + pad));
    const y1 = Math.min(page.height, Math.ceil(Math.max(before.src.y + before.src.h, after.src.y + after.src.h) + pad));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 8 || bh < 8) return null;
    const k = Math.min(1, 1000 / Math.max(bw, bh));
    const w = Math.max(1, Math.round(bw * k)), h = Math.max(1, Math.round(bh * k)), n = w * h;
    const raster = (piece) => {
      const c = makeCanvas(w, h), x = ctx2d(c);
      x.drawImage(piece.canvas, (piece.src.x - x0) * k, (piece.src.y - y0) * k, piece.src.w * k, piece.src.h * k);
      const d = x.getImageData(0, 0, w, h).data, m = new Uint8Array(n);
      for (let p = 0; p < n; p++) m[p] = d[p * 4 + 3] > 127 ? 1 : 0;
      release(c);
      return m;
    };
    const A = raster(before), U = raster(after);
    // encre de la zone, aux seuils de l'analyse
    const crop = makeCanvas(w, h);
    ctx2d(crop).drawImage(page, x0, y0, bw, bh, 0, 0, w, h);
    const d = ctx2d(crop).getImageData(0, 0, w, h).data;
    release(crop);
    const ink = inkMask(d, w, h, cut.paper, cut.strongT, cut.weakT);
    const dist = (i) => Math.hypot(d[i] - cut.paper[0], d[i + 1] - cut.paper[1], d[i + 2] - cut.paper[2]);
    let areaA = 0, areaU = 0, changed = 0;
    const diff = new Uint8Array(n);
    for (let p = 0; p < n; p++) { areaA += A[p]; areaU += U[p]; if (A[p] !== U[p]) { diff[p] = 1; changed++; } }
    if (!areaA || !areaU || changed < 0.01 * Math.max(areaA, areaU)) return null;
    const prefs = cutPrefs();
    const changes = [];
    // 1. marge : distance à l'encre du contour retouché (là où la retouche a changé la forme)
    const near = dilate(diff, w, h, 3);
    const dInk = distanceField(ink, w, h);
    const ds = [];
    let boundaryN = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!U[p] || (U[p - 1] && U[p + 1] && U[p - w] && U[p + w])) continue;
      boundaryN++;
      if (near[p] && dInk[p] < unit * k * 0.08) ds.push(dInk[p]);
    }
    if (ds.length >= Math.max(30, boundaryN * 0.1)) {
      ds.sort((a, b) => a - b);
      const mUser = ds[ds.length >> 1] / (unit * k);
      if (Math.abs(mUser - prefs.margin) > 0.25 * prefs.margin) { prefs.margin = Math.max(0.002, Math.min(0.03, mUser)); changes.push('margin'); }
    }
    // 2. zones restaurées (hors marge) : de l'encre pâle que les seuils avaient laissée ?
    let rest = 0, restFaint = 0, erased = 0, erasedInk = 0, erasedSat = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (U[p] && !A[p]) {
        if (dInk[p] <= prefs.margin * unit * k * 1.5) continue; // simple élargissement de la marge
        rest++;
        const q = dist(i);
        if (!ink[p] && q > cut.weakT * 0.45) restFaint++;
      } else if (A[p] && !U[p]) {
        erased++;
        if (ink[p]) { erasedInk++; erasedSat += sat([d[i], d[i + 1], d[i + 2]]); }
      }
    }
    if (rest >= 0.01 * areaU && restFaint >= 0.15 * rest) { prefs.ink = Math.max(0.5, prefs.ink * 0.8); changes.push('faint'); }
    if (erased >= 0.05 * areaA && erasedInk >= 0.3 * erased) {
      if (erasedSat / erasedInk > 0.2) { prefs.close = Math.max(prefs.margin + 0.005, prefs.close * 0.7); changes.push('split'); }
      else { prefs.ink = Math.min(1.6, prefs.ink * 1.2); changes.push('grey'); }
    }
    return changes.length ? { prefs, changes } : null;
  }

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

  /*
   * Feuille photographiée (sur une table, un mur, une nappe…) : on cherche la feuille elle-même, non
   * la surface. Le papier est une plage claire et peu saturée, bornée de tous côtés par un contour
   * franc (le bord de la feuille et son ombre), même quand la surface a presque sa couleur (mur
   * clair). On remplit donc le papier depuis l'intérieur sans franchir les contours, on bouche les
   * cases fermées par les traits du dessin, puis on ajuste un quadrilatère sur l'enveloppe de la plage.
   * Une feuille rectangulaire est redressée (perspective corrigée) et recadrée juste à l'intérieur de
   * son bord ; une forme libre (feuille découpée, froissée) posée sur un bois ou un sol neutre devient
   * un objet dont la silhouette entière est la pièce. Un cadre dessiné au crayon (bordure colorée)
   * n'est pas une surface : il est refusé par la couleur de la bordure de la photo.
   */
  /*
   * Page nettoyée autour d'un objet (masque grossier fin, w × h) : hors de l'objet, du papier blanc
   * (en fondu sur le bord), le bord repris à pleine résolution d'après les couleurs de part et d'autre.
   */
  function cutObject(src, fin, w, h) {
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fin[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
    const ref = refineAlpha(src, fin, w, h);
    const rectFill = rectangularity(fin, w, h);
    const k = src.width / w;
    const m = Math.round(0.03 * Math.max(x1 - x0, y1 - y0) * k);
    const cx0 = Math.max(0, Math.round(x0 * k) - m), cy0 = Math.max(0, Math.round(y0 * k) - m);
    const cx1 = Math.min(src.width, Math.round((x1 + 1) * k) + m), cy1 = Math.min(src.height, Math.round((y1 + 1) * k) + m);
    const out = makeCanvas(cx1 - cx0, cy1 - cy0);
    const ctx = ctx2d(out);
    ctx.drawImage(src, cx0, cy0, out.width, out.height, 0, 0, out.width, out.height);
    const img = ctx.getImageData(0, 0, out.width, out.height);
    const od = img.data;
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
    return { canvas: out, alpha: oa, W: OW, H: OH, rectFill, refined: !!ref };
  }

  // L'intérieur d'une forme trouvée sur la surface est-il surtout du papier (clair, peu saturé) ?
  // Une « forme » blanche est alors une feuille, pas un objet découpé : ses sujets se découpent.
  function paperish(alpha, canvas) {
    const W = canvas.width, H = canvas.height;
    const step = Math.max(1, Math.round(Math.max(W, H) / 220));
    const d = ctx2d(canvas).getImageData(0, 0, W, H).data;
    let n = 0, pap = 0;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const p = y * W + x;
      if (alpha[p] < 0.5) continue;
      n++;
      const i = p * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 185 && (mx - mn) / Math.max(1, mx) < 0.22) pap++;
    }
    paperish.last = { n, ratio: n ? +(pap / n).toFixed(2) : null, W, H };
    return n > 0 && pap / n >= 0.6;
  }

  function convexHull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  function polyArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
  // enveloppe convexe → quadrilatère : l'enveloppe est d'abord simplifiée (Douglas-Peucker), puis le
  // quadrilatère de plus grande surface est choisi parmi ses sommets (les coins d'une feuille)
  function simplify(poly, tol) {
    const dist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    const dp = (pts) => {
      if (pts.length < 3) return pts;
      let bi = 0, bd = -1;
      for (let i = 1; i < pts.length - 1; i++) { const d = dist(pts[i], pts[0], pts[pts.length - 1]); if (d > bd) { bd = d; bi = i; } }
      if (bd <= tol) return [pts[0], pts[pts.length - 1]];
      return dp(pts.slice(0, bi + 1)).slice(0, -1).concat(dp(pts.slice(bi)));
    };
    // polygone fermé : on part du sommet le plus éloigné du premier
    let far = 0, fd = -1;
    poly.forEach((q, i) => { const d = Math.hypot(q[0] - poly[0][0], q[1] - poly[0][1]); if (d > fd) { fd = d; far = i; } });
    const a = dp(poly.slice(0, far + 1)), b = dp(poly.slice(far).concat([poly[0]]));
    return a.slice(0, -1).concat(b.slice(0, -1));
  }
  function quadOf(hull, size) {
    let poly = hull;
    let tol = 0.008 * size;
    while (poly.length > 14) { poly = simplify(hull, tol); tol *= 1.5; }
    let best = null, bestA = -1;
    const m = poly.length;
    for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) for (let c = b + 1; c < m; c++) for (let d = c + 1; d < m; d++) {
      const q = [poly[a], poly[b], poly[c], poly[d]];
      const A = polyArea(q);
      if (A > bestA) { bestA = A; best = q; }
    }
    if (!best) return hull.slice(0, 4);
    return orderQuad(best);
  }
  // ordre : haut-gauche, haut-droit, bas-droit, bas-gauche
  function orderQuad(poly) {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    poly = poly.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let start = 0, best = Infinity;
    poly.forEach((p, i) => { const v = p[0] + p[1]; if (v < best) { best = v; start = i; } });
    return poly.slice(start).concat(poly.slice(0, start));
  }
  // chaque bord du quadrilatère est réajusté sur les points du contour de la plage qui lui sont
  // les plus proches, par une droite robuste (médiane des pentes : une fuite locale vers un mur de
  // même couleur ne la dévie pas) ; les coins sont les intersections des quatre droites
  function refineQuad(quad, boundary, w, h) {
    const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    let q = quad;
    for (let it = 0; it < 2; it++) {
      const sides = [[], [], [], []];
      const maxD = 0.06 * Math.max(w, h);
      for (const p of boundary) {
        let bi = -1, bd = maxD;
        for (let i = 0; i < 4; i++) { const d = segDist(p, q[i], q[(i + 1) % 4]); if (d < bd) { bd = d; bi = i; } }
        if (bi >= 0) sides[bi].push(p);
      }
      const lines = [];
      for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        const horiz = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
        const pts = sides[i];
        if (pts.length < 8) { lines.push(null); continue; }
        // sous-échantillon, puis médiane des pentes de paires tirées au hasard (déterministe)
        const step = Math.max(1, Math.floor(pts.length / 160)), sm = [];
        for (let k = 0; k < pts.length; k += step) sm.push(pts[k]);
        const slopes = [];
        let seed = 7;
        const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        for (let k = 0; k < 1500; k++) {
          const p1 = sm[Math.floor(rnd() * sm.length)], p2 = sm[Math.floor(rnd() * sm.length)];
          const du = horiz ? p2[0] - p1[0] : p2[1] - p1[1];
          if (Math.abs(du) < 4) continue;
          slopes.push(horiz ? (p2[1] - p1[1]) / du : (p2[0] - p1[0]) / du);
        }
        if (slopes.length < 20) { lines.push(null); continue; }
        slopes.sort((x, y) => x - y);
        const sl = slopes[slopes.length >> 1];
        const inter = sm.map((p) => (horiz ? p[1] - sl * p[0] : p[0] - sl * p[1])).sort((x, y) => x - y);
        const ic = inter[inter.length >> 1];
        // droite sous la forme ax + by = c
        lines.push(horiz ? { a: -sl, b: 1, c: ic } : { a: 1, b: -sl, c: ic });
      }
      const next = [];
      for (let i = 0; i < 4; i++) {
        const l1 = lines[(i + 3) % 4], l2 = lines[i];
        if (!l1 || !l2) { next.push(q[i]); continue; }
        const det = l1.a * l2.b - l2.a * l1.b;
        if (Math.abs(det) < 1e-6) { next.push(q[i]); continue; }
        const x = (l1.c * l2.b - l2.c * l1.b) / det, y = (l1.a * l2.c - l2.a * l1.c) / det;
        next.push([Math.max(-0.02 * w, Math.min(1.02 * w, x)), Math.max(-0.02 * h, Math.min(1.02 * h, y))]);
      }
      q = orderQuad(next);
    }
    return q;
  }
  // homographie (x, y) destination → source, par résolution du système 8 × 8
  function homography(dst, src) {
    const A = [], B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = dst[i], [u, v] = src[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
    }
    const n = 8;
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
      const d = A[c][c] || 1e-12;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / d;
        if (!f) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        B[r] -= f * B[c];
      }
    }
    const h = B.map((b, i) => b / (A[i][i] || 1e-12));
    return (x, y) => { const z = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / z, (h[3] * x + h[4] * y + h[5]) / z]; };
  }
  function warpQuad(src, quad, outW, outH) {
    const sw = src.width, sh = src.height;
    const sd = ctx2d(src).getImageData(0, 0, sw, sh).data;
    const out = makeCanvas(outW, outH);
    const img = ctx2d(out).createImageData(outW, outH), od = img.data;
    const H = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const [u, v] = H(x + 0.5, y + 0.5);
        const fx = Math.min(sw - 1.001, Math.max(0, u - 0.5)), fy = Math.min(sh - 1.001, Math.max(0, v - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const i00 = (y0 * sw + x0) * 4, i01 = i00 + 4, i10 = i00 + sw * 4, i11 = i10 + 4;
        const o = (y * outW + x) * 4;
        for (let c = 0; c < 3; c++) od[o + c] = (sd[i00 + c] * (1 - tx) + sd[i01 + c] * tx) * (1 - ty) + (sd[i10 + c] * (1 - tx) + sd[i11 + c] * tx) * ty;
        od[o + 3] = 255;
      }
    }
    ctx2d(out).putImageData(img, 0, 0);
    return out;
  }
  function findSheet(src, force) {
    const work = scaleTo(src, WORK_MAX);
    const w = work.width, h = work.height, n = w * h;
    const raw = ctx2d(work).getImageData(0, 0, w, h).data;
    release(work);
    // image légèrement lissée (bruit du capteur, grain du papier)
    const L = new Float32Array(n), S = new Float32Array(n), CR = new Float32Array(n), CG = new Float32Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const r = raw[i], g = raw[i + 1], b = raw[i + 2], t = r + g + b || 1;
      L[p] = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      S[p] = mx ? (mx - mn) / mx : 0;
      CR[p] = r / t; CG[p] = g / t;
    }
    const Ls = boxBlur(L, w, h);
    // contours : gradient de clarté (Sobel), seuil adapté au bruit
    const G = new Float32Array(n);
    const gs = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (Ls[i - w + 1] + 2 * Ls[i + 1] + Ls[i + w + 1]) - (Ls[i - w - 1] + 2 * Ls[i - 1] + Ls[i + w - 1]);
      const gy = (Ls[i + w - 1] + 2 * Ls[i + w] + Ls[i + w + 1]) - (Ls[i - w - 1] + 2 * Ls[i - w] + Ls[i - w + 1]);
      G[i] = Math.hypot(gx, gy) / 8;
      if (!((x + y) & 7)) gs.push(G[i]);
    }
    gs.sort((a, b) => a - b);
    const gMed = gs[gs.length >> 1] || 0;
    const gT = Math.max(3.5, gMed * 3.5);
    // couleur du papier : parmi les pixels calmes et peu saturés du centre, les plus clairs
    const cand = [];
    for (let y = Math.floor(h * 0.2); y < h * 0.8; y++) for (let x = Math.floor(w * 0.2); x < w * 0.8; x++) {
      const i = y * w + x;
      if (S[i] < 0.25 && G[i] < gT) cand.push(i);
    }
    if (cand.length < n * 0.02) return null;
    cand.sort((a, b) => L[a] - L[b]);
    const top = cand.slice(Math.floor(cand.length * 0.55));
    const med = (f) => { const v = top.map(f).sort((a, b) => a - b); return v[v.length >> 1]; };
    const pL = med((i) => L[i]), pR = med((i) => CR[i]), pG = med((i) => CG[i]);
    if (pL < 90) return null;
    const attempts = [];
    findSheet.attempts = attempts;
    const attempt = (lTol, cTol) => {
      const P = new Uint8Array(n);
      for (let p = 0; p < n; p++) P[p] = G[p] < gT && Math.abs(L[p] - pL) < lTol && S[p] < 0.3 && Math.hypot(CR[p] - pR, CG[p] - pG) < cTol ? 1 : 0;
      // un peu de tolérance aux contours fins (grain, trait léger), puis la plus grande plage ; un
      // pan de papier isolé par un trait (rayons d'un soleil) reste couvert par l'enveloppe convexe
      const rc = 1.5;
      const closed = erode(dilate(P, w, h, rc), w, h, rc);
      const { labels, comps } = components(closed, w, h);
      if (!comps.length) return null;
      comps.sort((a, b) => b.area - a.area);
      const big = comps[0], second = comps[1] ? comps[1].area : 0;
      if (big.area < n * 0.08) return null;
      const region = new Uint8Array(n);
      for (let p = 0; p < n; p++) if (labels[p] === big.id && (P[p] || closed[p])) region[p] = 1;
      const filled = fillHoles(region, w, h);
      let area = 0; for (let p = 0; p < n; p++) area += filled[p];
      findSheet.debug = { pL: Math.round(pL), gT: +gT.toFixed(1), lTol: Math.round(lTol), area: +(area / n).toFixed(2), second: +(second / big.area).toFixed(2) };
      attempts.push(findSheet.debug);
      // la feuille s'est fragmentée (éclairage inégal, tolérance trop stricte) : un fragment n'est pas la feuille
      if (second > 0.3 * big.area) return null;
      if (findSheet.wantMasks) {
        const mc = makeCanvas(w, h), mi = ctx2d(mc).createImageData(w, h);
        for (let p = 0; p < n; p++) { const i = p * 4; mi.data[i] = P[p] ? 255 : 0; mi.data[i + 1] = filled[p] ? 255 : 0; mi.data[i + 2] = G[p] >= gT ? 255 : 0; mi.data[i + 3] = 255; }
        ctx2d(mc).putImageData(mi, 0, 0);
        findSheet.debug.maskPng = mc.toDataURL('image/png');
        findSheet.debug.maskCanvas = mc;
      }
      // la page entière (scan, photo cadrée au bord) : rien à recadrer
      if (area > 0.93 * n) return null;
      // enveloppe convexe et quadrilatère
      const pts = [];
      for (let y = 0; y < h; y++) {
        let x0 = -1, x1 = -1;
        for (let x = 0; x < w; x++) if (filled[y * w + x]) { if (x0 < 0) x0 = x; x1 = x; }
        if (x0 >= 0) { pts.push([x0, y]); pts.push([x1 + 1, y]); pts.push([x0, y + 1]); pts.push([x1 + 1, y + 1]); }
      }
      const hull = convexHull(pts);
      if (hull.length < 4) return null;
      const hullArea = polyArea(hull);
      const hullFill = area / Math.max(1, hullArea);
      // contour de la plage (pixels de la plage voisins du vide)
      const boundary = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!filled[i]) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !filled[i - 1] || !filled[i + 1] || !filled[i - w] || !filled[i + w]) boundary.push([x + 0.5, y + 0.5]);
      }
      // seuls les points proches de l'enveloppe comptent (un contour intérieur ouvert sur le bord,
      // comme un soleil dont les rayons touchent le bord de la feuille, ne doit pas tirer le bord)
      const hullD = (p) => { let best = Infinity; for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); if (d < best) best = d; } return best; };
      const nearHull = boundary.filter((p) => hullD(p) <= 0.02 * Math.max(w, h));
      const quad = refineQuad(quadOf(hull, Math.max(w, h)), nearHull, w, h);
      const quadArea = polyArea(quad);
      const inQuad = (x, y) => { let inside = true; for (let i = 0; i < 4; i++) { const a = quad[i], b = quad[(i + 1) % 4]; if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) { inside = false; break; } } return inside; };
      let inter = 0, leak = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!filled[y * w + x]) continue; if (inQuad(x + 0.5, y + 0.5)) inter++; else leak++; }
      const quadFill = inter / Math.max(1, quadArea), quadLeak = leak / Math.max(1, quadArea);
    const hullQuad = Math.min(hullArea / Math.max(1, quadArea), quadArea / Math.max(1, hullArea));
      // rectitude : y a-t-il un contour franc (le bord de la feuille, son ombre) tout le long de chaque
      // côté du quadrilatère ? Une plage de ciel cernée d'arbres dessinés a un contour sinueux qui ne
      // suit pas une droite ; un côté passant dans un mur de même couleur n'a pas de contour du tout
      // (ou, à défaut de contour franc — ombre douce sur un mur clair —, le bord de la plage elle-même)
      const emask = new Uint8Array(n), bmask = new Uint8Array(n);
      for (let p = 0; p < n; p++) emask[p] = G[p] >= gT ? 1 : 0;
      boundary.forEach(([x, y]) => { bmask[Math.min(h - 1, Math.floor(y)) * w + Math.min(w - 1, Math.floor(x))] = 1; });
      const nearE = dilate(emask, w, h, 0.012 * Math.max(w, h)), nearB = dilate(bmask, w, h, 0.015 * Math.max(w, h));
      const sideStraight = [];
      for (let i = 0; i < 4; i++) {
        const a = quad[i], b = quad[(i + 1) % 4];
        let okE = 0, okB = 0, tot = 0;
        for (let t = 0.04; t <= 0.96; t += 0.02) {
          const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
          tot++;
          if (x < 0 || y < 0 || x >= w || y >= h) { okE++; okB++; continue; } // bord hors photo : feuille coupée par le cadre
          if (nearE[y * w + x]) okE++;
          if (nearB[y * w + x]) okB++;
        }
        sideStraight.push(Math.max(okE, okB) / Math.max(1, tot));
      }
      const straight = sideStraight.reduce((p, q) => p + q, 0) / 4;
      const straightSides = sideStraight.filter((v) => v >= 0.7).length;
      // la feuille ne peut pas être la photo entière à peine rognée
      const corners = [[0, 0], [w, 0], [w, h], [0, h]];
      const nearCorner = quad.filter((p, i) => Math.hypot(p[0] - corners[i][0], p[1] - corners[i][1]) < 0.03 * Math.max(w, h)).length;
      // surface : bordure de la photo hors de la feuille (médiane), acceptée si bois ou peu saturée
      const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
      const ch = [[], [], []];
      let outN = 0, borderN = 0, outPaper = 0;
      forEachBorder(w, h, band, (p) => {
        borderN++;
        const x = p % w, y = (p - x) / w;
        if (filled[p] || inQuad(x + 0.5, y + 0.5)) return;
        outN++;
        const i = p * 4; ch[0].push(raw[i]); ch[1].push(raw[i + 1]); ch[2].push(raw[i + 2]);
        // du papier (même couleur que la feuille) hors de la feuille : ce n'est pas une surface
        if (Math.abs(L[p] - pL) < lTol && S[p] < 0.3 && Math.hypot(CR[p] - pR, CG[p] - pG) < cTol) outPaper++;
      });
      if (outN < borderN * 0.08) return null;
      outPaper /= outN;
      const col = ch.map((a) => { const c = a.slice().sort((p, q) => p - q); return c[c.length >> 1]; });
      const sL = lum(col), sS = sat(col);
      // la surface (bois, mur, nappe) est d'une seule couleur, à son grain près ; une page peinte
      // jusqu'aux bords (dont une plage blanche aurait été prise pour une feuille) ne l'est pas
      const scr = col[0] / (col[0] + col[1] + col[2] || 1), scg = col[1] / (col[0] + col[1] + col[2] || 1);
      let same = 0;
      for (let k = 0; k < ch[0].length; k++) {
        const r = ch[0][k], g = ch[1][k], b = ch[2][k], t = r + g + b || 1;
        if (Math.abs(0.299 * r + 0.587 * g + 0.114 * b - sL) < 32 && Math.hypot(r / t - scr, g / t - scg) < 0.05) same++;
      }
      const uniform = same / Math.max(1, ch[0].length);
      const mx = Math.max(col[0], col[1], col[2]), mn = Math.min(col[0], col[1], col[2]);
      let hue = 0;
      if (mx > mn) { hue = mx === col[0] ? ((col[1] - col[2]) / (mx - mn)) % 6 : mx === col[1] ? (col[2] - col[0]) / (mx - mn) + 2 : (col[0] - col[1]) / (mx - mn) + 4; hue = (hue * 60 + 360) % 360; }
      const wood = sS >= 0.15 && hue >= 5 && hue <= 55 && sL < 230;
      const neutral = sS < 0.35;
      const distinct = Math.abs(sL - pL) > 8 || Math.hypot(col[0] / (col[0] + col[1] + col[2] || 1) - pR, col[1] / (col[0] + col[1] + col[2] || 1) - pG) > 0.02;
      Object.assign(findSheet.debug, { hullFill: +hullFill.toFixed(2), hullQuad: +hullQuad.toFixed(2), quadFill: +quadFill.toFixed(2), quadLeak: +quadLeak.toFixed(2), straight: +straight.toFixed(2), straightSides, nearCorner, sL: Math.round(sL), sS: +sS.toFixed(2), hue: Math.round(hue), wood, neutral, distinct, uniform: +uniform.toFixed(2), outPaper: +outPaper.toFixed(2) });
      if (findSheet.wantMasks && findSheet.debug.maskCanvas) {
        const mc = findSheet.debug.maskCanvas;
        const cx = ctx2d(mc); cx.strokeStyle = '#ff00ff'; cx.lineWidth = 2; cx.beginPath(); quad.forEach((q, i) => (i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1]))); cx.closePath(); cx.stroke();
        cx.strokeStyle = '#ffff00'; cx.lineWidth = 1; cx.beginPath(); hull.forEach((q, i) => (i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1]))); cx.closePath(); cx.stroke();
        findSheet.debug.maskPng = mc.toDataURL('image/png');
        delete findSheet.debug.maskCanvas;
      }
      if (!force && !(wood || neutral)) return null;
      if (!distinct || (nearCorner >= 3 && area > 0.95 * n)) return null;
      if (!force && (outPaper > 0.2 || uniform < 0.45)) return null;
      const k = src.width / w;
      if (hullQuad >= 0.88 && quadFill >= 0.7 && quadLeak <= 0.15 && straight >= 0.75 && straightSides >= 3) {
        // feuille rectangulaire : redressée, recadrée juste à l'intérieur de son bord
        const cx = quad.reduce((s, p) => s + p[0], 0) / 4, cy = quad.reduce((s, p) => s + p[1], 0) / 4;
        const inset = 0.98;
        const q = quad.map(([x, y]) => [(cx + (x - cx) * inset) * k, (cy + (y - cy) * inset) * k]);
        const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        let outW = Math.round(Math.max(len(q[0], q[1]), len(q[3], q[2]))), outH = Math.round(Math.max(len(q[0], q[3]), len(q[1], q[2])));
        const cap = Math.min(FINE_MAX, Math.max(src.width, src.height));
        const sc = Math.min(1, cap / Math.max(outW, outH));
        outW = Math.max(8, Math.round(outW * sc)); outH = Math.max(8, Math.round(outH * sc));
        const canvas = warpQuad(src, q, outW, outH);
        // feuille redressée : ses bords doivent être du papier (une feuille découpée en biais ou une
        // plage prise pour une feuille montrerait la surface, ou autre chose, le long d'un bord)
        const chk = scaleTo(canvas, 320);
        const cw = chk.width, chh = chk.height, cd = ctx2d(chk).getImageData(0, 0, cw, chh).data;
        release(chk);
        // (une feuille découpée en biais montrerait la surface le long d'un bord ; un dessin qui
        // touche le bord n'est pas la surface)
        const bw = Math.max(2, Math.round(Math.min(cw, chh) * 0.04));
        const lt = Math.min(30, Math.max(6, Math.abs(pL - sL) * 0.5)), ct = Math.min(0.04, Math.max(0.01, Math.hypot(scr - pR, scg - pG) * 0.5));
        const sideSurf = [0, 0, 0, 0], sideN = [0, 0, 0, 0];
        for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
          const sideIdx = y < bw ? 0 : y >= chh - bw ? 2 : x < bw ? 3 : x >= cw - bw ? 1 : -1;
          if (sideIdx < 0) continue;
          const i = (y * cw + x) * 4, r = cd[i], g = cd[i + 1], b = cd[i + 2], t = r + g + b || 1;
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          sideN[sideIdx]++;
          if (Math.abs(l - sL) < lt && Math.hypot(r / t - scr, g / t - scg) < ct) sideSurf[sideIdx]++;
        }
        const sides = sideSurf.map((v, i) => v / Math.max(1, sideN[i]));
        Object.assign(findSheet.debug, { sides: sides.map((v) => +v.toFixed(2)) });
        // (sans objet quand la surface a presque la couleur du papier : un mur clair ; le papier dans
        // l'ombre du bord passerait pour la surface)
        const similar = Math.abs(pL - sL) < 25 && Math.hypot(scr - pR, scg - pG) < 0.02;
        if (similar || (sides.every((v) => v <= 0.15) && !(quadFill < 0.8 && Math.max(...sides) > 0.1))) {
          findSheet.debug.result = 'sheet';
          return { kind: 'sheet', canvas, quad: q, surface: { color: col, kind: wood ? 'bois' : 'neutre', frac: outN / borderN, sheet: true } };
        }
        release(canvas);
      }
      // (seulement sur une surface franchement colorée : sur un mur clair, une feuille mal cernée
      // passerait pour une forme libre)
      if (hullFill >= 0.75 && uniform >= 0.85 && wood && sS >= 0.3 && area >= 0.1 * n && straight < 0.95) {
        // forme libre posée sur la surface : sa silhouette est la pièce
        const fin = erode(filled, w, h, Math.max(w, h) * 0.003);
        findSheet.debug.result = 'object';
        return { kind: 'object', mask: fin, w, h, surface: { color: col, kind: wood ? 'bois' : 'neutre', frac: outN / borderN } };
      }
      return null;
    };
    // tolérance large d'abord (feuille inégalement éclairée), stricte ensuite (mur presque de la
    // même clarté que le papier, vers lequel la plage large aurait fui)
    const loose = attempt(Math.max(22, pL * 0.16), 0.035);
    if (loose) return loose;
    const medium = attempt(Math.max(15, pL * 0.11), 0.028);
    if (medium) return medium;
    const strict = attempt(Math.max(11, pL * 0.07), 0.02);
    if (strict) return strict;
    return null;
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
    // mur ou table clairs, de la couleur du papier : la feuille ne se distingue pas de la surface, il
    // ne resterait que l'encre (et un short noir passerait pour une ombre, les jambes seraient
    // perdues). La photo est alors traitée comme un scan : le papier est partout, les sujets se
    // découpent à l'encre.
    if (!force && neutral && L >= 170 && paperFrac < 0.1) { removeSurface.debug.gate = 'feuille≈surface'; return null; }
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
    const cut = cutObject(src, fin, w, h);
    Object.assign(removeSurface.debug, { rect: +cut.rectFill.toFixed(2), refined: cut.refined });
    // une découpe (forme libre) est la pièce elle-même ; une feuille rectangulaire garde son dessin à découper
    const cutShape = cut.rectFill < 0.9;
    return { canvas: cut.canvas, surface: { color: col, kind: wood ? 'bois' : 'neutre', frac: surfFrac }, object: cutShape ? { alpha: cut.alpha, W: cut.W, H: cut.H } : null };
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
      // photo d'une feuille (table, mur, nappe…) : la feuille est trouvée, redressée, recadrée ;
      // une forme libre posée sur un bois ou un sol neutre devient un objet (sa silhouette est la pièce)
      const sheet = findSheet(src, !!opts.force);
      if (sheet && sheet.kind === 'sheet') {
        const r = analyze(sheet.canvas, 1, { flat: false });
        r.photo = sheet.surface;
        r.original = src;
        return r;
      }
      if (sheet && sheet.kind === 'object') {
        const cut = cutObject(src, sheet.mask, sheet.w, sheet.h);
        if (cut.rectFill >= 0.85 && paperish(cut.alpha, cut.canvas)) {
          // une feuille blanche à peu près rectangulaire prise pour une forme : c'est une page, à
          // découper comme les autres (ses personnages et objets posés, pas la feuille entière)
          const r = analyze(cut.canvas, 1, { flat: false });
          r.photo = Object.assign({}, sheet.surface, { sheet: true });
          r.original = src;
          return r;
        }
        const page = flatten(cut.canvas, true);
        const r = { page, paper: [250, 250, 250], texture: null, kind: 'cutout', paperFrac: 1, objectAlpha: { alpha: cut.alpha, W: cut.W, H: cut.H } };
        r.pieces = objectPieces(page, cut.alpha, cut.W, cut.H);
        if (r.pieces.length) { r.photo = sheet.surface; r.original = src; return r; }
      }
      // photo d'un dessin posé sur un sol ou une table : on retire la surface
      const cleaned = removeSurface(src, !!opts.force);
      // (sur un mur ou une table clairs, la silhouette d'une feuille blanche est incertaine : si la
      // « forme » est surtout du papier, c'est une feuille, à découper comme une page)
      if (cleaned && cleaned.object && cleaned.surface.kind !== 'bois' && paperish(cleaned.object.alpha, cleaned.canvas)) cleaned.object = null;
      if (cleaned && removeSurface.debug) removeSurface.debug.paperish = paperish.last || null;
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
    // (page peinte sur feuille de couleur : la part peinte se mesure sans la tolérance aux ombres,
    // ses coups de pinceau plus clairs ou plus sombres sont de la peinture, pas du papier)
    const asTexture = () => {
      result.kind = 'texture';
      result.texture = textureFrom(src);
      result.seg = seg;
      if (paperTint(seg.paper) && seg.rawPaperFrac !== undefined) result.paperFrac = seg.rawPaperFrac;
      return result;
    };
    if (seg.paperFrac < TEXTURE_MAX_PAPER) return asTexture();
    result.pieces = cutPieces(src, seg);
    result.cut = { paper: seg.paper, weakT: seg.weakT, strongT: seg.strongT };
    // page peinte (aquarelle, gouache, gribouillage qui couvre la feuille) : la découpe principale
    // engloberait presque toute la page, bords déchiquetés ; c'est un fond, pas une découpe. Une
    // feuille au fond majoritairement blanc reste une découpe : ses sujets sont faits pour être posés.
    // Sur une feuille de couleur (ses ombres comptées comme papier), une pièce qui couvre plus de la
    // moitié de la page est un lavis qui la remplit (un ciel peint), pas un sujet : un fond.
    const bigFrac = result.pieces.reduce((m, q) => Math.max(m, q.frac), 0);
    if (!result.pieces.length || (bigFrac > 0.55 && (seg.paperFrac < 0.5 || paperTint(seg.paper)))) {
      result.pieces.forEach((q) => release(q.canvas));
      result.pieces = null;
      return asTexture();
    }
    return result;
  }

  window.Extract = { analyze, segment, flatten, recut, learnCut, setCutPrefs, cutPrefs, cutIsDefault, CUT_DEFAULT, rotated, rotateCanvas, textureStats, release, removeSurface, findSheet, textOnly, trimMargins, cutPieces, textureFrom, enhance, sharpen, scaleTo, makeCanvas, averageColor, lum };
})();
