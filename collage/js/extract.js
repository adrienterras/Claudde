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

  // Distance (chanfrein) de chaque pixel au plus proche pixel à 1.
  function distanceField(src, w, h) {
    const INF = 1e9;
    const D2 = Math.SQRT2;
    const d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = d[i];
        if (v === 0) continue;
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) {
          v = Math.min(v, d[i - w] + 1);
          if (x > 0) v = Math.min(v, d[i - w - 1] + D2);
          if (x < w - 1) v = Math.min(v, d[i - w + 1] + D2);
        }
        d[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let v = d[i];
        if (v === 0) continue;
        if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < h - 1) {
          v = Math.min(v, d[i + w] + 1);
          if (x < w - 1) v = Math.min(v, d[i + w + 1] + D2);
          if (x > 0) v = Math.min(v, d[i + w - 1] + D2);
        }
        d[i] = v;
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
    const stack = [];
    const push = (i) => {
      if (!mask[i] && !seen[i]) { seen[i] = 1; stack.push(i); }
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
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
    const stack = [];
    let next = 1;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      const c = { id: next, area: 0, x0: w, y0: h, x1: 0, y1: 0 };
      labels[start] = next;
      stack.push(start);
      while (stack.length) {
        const i = stack.pop();
        const x = i % w, y = (i - x) / w;
        c.area++;
        if (x < c.x0) c.x0 = x;
        if (x > c.x1) c.x1 = x;
        if (y < c.y0) c.y0 = y;
        if (y > c.y1) c.y1 = y;
        const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const j of nb) {
          if (j >= 0 && mask[j] && !labels[j]) { labels[j] = next; stack.push(j); }
        }
      }
      comps.push(c);
      next++;
    }
    return { labels, comps };
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
    const ink = new Uint8Array(n);
    let paperCount = 0;
    const T2 = INK_DIST * INK_DIST, U2 = PAPER_DIST * PAPER_DIST;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const dr = data[i] - paper[0], dg = data[i + 1] - paper[1], db = data[i + 2] - paper[2];
      const q = dr * dr + dg * dg + db * db;
      if (q < U2) paperCount++;
      if (q > T2) ink[p] = 1;
    }
    // Les bords du scan (ombres, bord de feuille) ne sont pas du dessin.
    const m = Math.max(2, Math.round(Math.min(w, h) * 0.015));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < m || y < m || x >= w - m || y >= h - m) ink[y * w + x] = 0;
      }
    }
    const unit = Math.max(w, h);
    // regroupe les traits, puis garde une marge de papier généreuse (≈ 0,6 cm sur un A4) :
    // la découpe ressort comme un autocollant, comme sur un collage fait main
    let mask = dilate(ink, w, h, unit * 0.026);
    mask = fillHoles(mask, w, h);
    mask = erode(mask, w, h, unit * 0.005);
    const { labels, comps } = components(mask, w, h);
    comps.sort((a, b) => b.area - a.area);
    return { work, data, w, h, paper, paperFrac: paperCount / n, labels, comps };
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

  function makePiece(page, seg, comp) {
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
    a = boxBlur(boxBlur(a, bw, bh), bw, bh);

    // Masque lissé, agrandi à la résolution de la page, puis contour net (effet ciseaux).
    const mc = makeCanvas(bw, bh);
    const mctx = ctx2d(mc);
    const mimg = mctx.createImageData(bw, bh);
    for (let p = 0; p < a.length; p++) mimg.data[p * 4 + 3] = Math.round(a[p] * 255);
    mctx.putImageData(mimg, 0, 0);

    const pw = Math.max(1, Math.round(bw * k)), ph = Math.max(1, Math.round(bh * k));
    const pc = makeCanvas(pw, ph);
    const ctx = ctx2d(pc);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mc, 0, 0, pw, ph);
    const al = ctx.getImageData(0, 0, pw, ph);
    for (let i = 3; i < al.data.length; i += 4) {
      const v = (al.data[i] / 255 - 0.5) * 4 + 0.5;
      al.data[i] = Math.max(0, Math.min(1, v)) * 255;
    }
    ctx.putImageData(al, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(page, x0 * k, y0 * k, bw * k, bh * k, 0, 0, pw, ph);
    ctx.globalCompositeOperation = 'source-over';

    const hit = new Uint8Array(bw * bh);
    for (let p = 0; p < a.length; p++) hit[p] = a[p] > 0.5 ? 1 : 0;
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
        const piece = makePiece(enhanced, seg, c);
        piece.src.paper = seg.paper;
        return piece;
      });
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
   * Photo d'un dessin posé sur un sol ou une table (parquet, carrelage, bois, plan de travail…).
   * On reconnaît la surface à la bordure de l'image : une couleur de bois (chaude, moyenne) ou
   * neutre (gris, blanc cassé), puis on isole ce qui s'en détache, en suivant la forme du dessin.
   * Retourne null si l'image n'est pas une photo sur une surface, sinon la page nettoyée :
   * le dessin détouré sur un fond blanc, recadré.
   */
  function removeSurface(src, force) {
    const work = scaleTo(src, WORK_MAX);
    const w = work.width, h = work.height, n = w * h;
    const d = ctx2d(work).getImageData(0, 0, w, h).data;
    const col = estimatePaper(d, w, h);
    const L = lum(col), S = sat(col);
    const mx = Math.max(col[0], col[1], col[2]), mn = Math.min(col[0], col[1], col[2]);
    let hue = 0;
    if (mx > mn) {
      if (mx === col[0]) hue = ((col[1] - col[2]) / (mx - mn)) % 6;
      else if (mx === col[1]) hue = (col[2] - col[0]) / (mx - mn) + 2;
      else hue = (col[0] - col[1]) / (mx - mn) + 4;
      hue = (hue * 60 + 360) % 360;
    }
    const neutral = S < 0.18 && L < 228;                 // gris, béton, plan de travail
    const wood = S >= 0.15 && S < 0.72 && hue >= 8 && hue <= 50 && L < 215; // bois, parquet, liège, chêne clair (une feuille jaune vif est plus saturée)
    // forcé par l'utilisateur : on fait confiance à la couleur de bordure, quelle qu'elle soit
    if (!neutral && !wood && !force) return null;

    // chromaticité (indépendante de l'éclairage) et luminance de chaque pixel
    const chroma = (i) => { const t = d[i] + d[i + 1] + d[i + 2] || 1; return [d[i] / t, d[i + 1] / t]; };
    const ct = col[0] + col[1] + col[2] || 1, cr = col[0] / ct, cg = col[1] / ct;
    // tolérances tirées de la bordure elle-même (veines du bois, joints du carrelage)
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
    const dc = [], dl = [];
    forEachBorder(w, h, band, (p) => {
      const i = p * 4, c = chroma(i);
      dc.push(Math.hypot(c[0] - cr, c[1] - cg));
      dl.push(Math.abs(lum([d[i], d[i + 1], d[i + 2]]) - L));
    });
    dc.sort((a, b) => a - b); dl.sort((a, b) => a - b);
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
    const cTol = Math.min(0.09, Math.max(0.028, q(dc, 0.9) * 1.6));
    const lTol = Math.min(120, Math.max(48, q(dl, 0.9) * 1.8));
    const obj = new Uint8Array(n), joint = new Uint8Array(n);
    let surfCount = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const c = chroma(i);
      const dch = Math.hypot(c[0] - cr, c[1] - cg);
      const l = lum([d[i], d[i + 1], d[i + 2]]);
      const s = sat([d[i], d[i + 1], d[i + 2]]);
      // même teinte que la surface, pas plus clair que sa tolérance ; en plus foncé on accepte
      // large (ombres portées, joints, veines) ; les joints très sombres perdent leur teinte
      const dark = l < L * 0.6 && (s < 0.45 || dch < cTol * 1.5) && dch < cTol * 2.2;
      const same = dch < cTol && l < L + lTol;
      if (same || dark) { surfCount++; if (dark || l < L * 0.62) joint[p] = 1; }
      else obj[p] = 1;
    }
    const surfFrac = surfCount / n;
    if (surfFrac < 0.15 || surfFrac > 0.97) return null;
    // une bordure trop disparate est une page peinte jusqu'aux bords, pas un sol
    if (!force && (q(dl, 0.9) > (wood ? 85 : 60) || q(dc, 0.9) > (wood ? 0.12 : 0.09))) return null;
    // Une vraie surface est soit très unie (plan de travail), soit structurée par de longs traits
    // sombres (lames de parquet, joints de carrelage). Une page peinte ne l'est pas.
    const uniform = q(dl, 0.9) < 16 && q(dc, 0.9) < 0.02;
    let lines = 0;
    if (!uniform) {
      const jc = components(joint, w, h).comps;
      const unit0 = Math.max(w, h);
      jc.forEach((c) => {
        const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
        if (Math.max(bw, bh) >= 0.22 * unit0 && (Math.min(bw, bh) <= 0.04 * unit0 || c.area / (bw * bh) < 0.4) && c.area > 0.0006 * n) lines++;
      });
    }
    removeSurface.debug = { L: Math.round(L), S: +S.toFixed(2), hue: Math.round(hue), surfFrac: +surfFrac.toFixed(2), uniform, lines, dl90: Math.round(q(dl, 0.9)), dc90: +q(dc, 0.9).toFixed(3) };
    if (!uniform && lines < 1 && !force) return null;
    const unit = Math.max(w, h);
    // fermeture (relie le dessin), bouchage des trous, ouverture (efface les veines isolées)
    let mask = dilate(obj, w, h, unit * 0.008);
    mask = erode(mask, w, h, unit * 0.008);
    mask = fillHoles(mask, w, h);
    mask = erode(mask, w, h, unit * 0.012);
    mask = dilate(mask, w, h, unit * 0.012);
    const { labels, comps } = components(mask, w, h);
    const keep = comps.filter((c) => c.area >= 0.03 * n);
    if (!keep.length) return null;
    const ids = new Set(keep.map((c) => c.id));
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    keep.forEach((c) => { x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1); area += c.area; });
    if (area > 0.92 * n) return null;
    // le dessin posé est une forme compacte (feuille, découpe) qui ne remplit pas toute la bordure ;
    // des taches éparses sur un papier kraft ne sont pas un dessin posé sur un sol
    const touches = [x0 <= 1, y0 <= 1, x1 >= w - 2, y1 >= h - 2].filter(Boolean).length;
    Object.assign(removeSurface.debug, { touches, fill: +(area / ((x1 - x0 + 1) * (y1 - y0 + 1))).toFixed(2), objFrac: +(area / n).toFixed(2) });
    // et il occupe une part raisonnable de la photo (sinon ce sont des taches sur une page de couleur)
    if (touches >= 3 || area / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.4 || (area < 0.1 * n && !force)) return null;
    // masque final, légèrement rétréci pour ne pas garder un liseré de surface
    const fin = erode(new Uint8Array(mask.map((v, i) => (v && ids.has(labels[i]) ? 1 : 0))), w, h, unit * 0.004);

    // page nettoyée à la résolution d'origine : hors du dessin, du papier blanc
    const k = src.width / w;
    const m = Math.round(0.03 * Math.max(x1 - x0, y1 - y0) * k);
    const cx0 = Math.max(0, Math.round(x0 * k) - m), cy0 = Math.max(0, Math.round(y0 * k) - m);
    const cx1 = Math.min(src.width, Math.round((x1 + 1) * k) + m), cy1 = Math.min(src.height, Math.round((y1 + 1) * k) + m);
    const out = makeCanvas(cx1 - cx0, cy1 - cy0);
    const ctx = ctx2d(out);
    ctx.drawImage(src, cx0, cy0, out.width, out.height, 0, 0, out.width, out.height);
    const img = ctx.getImageData(0, 0, out.width, out.height);
    const od = img.data;
    for (let y = 0; y < out.height; y++) {
      const wy = Math.min(h - 1, Math.floor((y + cy0) / k));
      for (let x = 0; x < out.width; x++) {
        const wx = Math.min(w - 1, Math.floor((x + cx0) / k));
        if (!fin[wy * w + wx]) { const i = (y * out.width + x) * 4; od[i] = 248; od[i + 1] = 246; od[i + 2] = 241; od[i + 3] = 255; }
      }
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: out, surface: { color: col, kind: wood ? 'bois' : 'neutre', frac: surfFrac } };
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
      if (cleaned) {
        const r = analyze(cleaned.canvas, 0, {});
        r.photo = cleaned.surface;
        r.original = src;
        return r;
      }
    }
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
        return analyze(sheet, 1);
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

  window.Extract = { analyze, removeSurface, cutPieces, textureFrom, enhance, scaleTo, makeCanvas, averageColor, lum };
})();
