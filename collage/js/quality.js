/*
 * Atelier Gribouille — qualité des dessins pour l'impression.
 *
 * Quatre mesures, faites une fois à l'import, sans rien envoyer :
 *  - la définition : pixels réels du scan ou de la photo rapportés à la taille réelle de la
 *    feuille, en dpi (pour un PDF, les pixels de l'image que contient la page) ;
 *  - la compression : qualité JPEG estimée d'après les tables de quantification du fichier
 *    (une image passée par une messagerie est souvent très compressée) ;
 *  - la netteté : sur les bords les plus marqués, pente du contraste rapportée à son amplitude
 *    (un trait net passe du papier à l'encre en un pixel, un trait flou en plusieurs) ;
 *  - l'éclairage : écart de luminosité du papier d'un bout à l'autre de la feuille (ombre, lampe).
 * Les seuils ont été réglés sur de vrais scans de dessins et sur leurs versions floues ou
 * assombries : ils préviennent, ils ne bloquent jamais.
 */
(function () {
  'use strict';

  const tr = window.tr || ((s) => s);
  const SHARP = { warn: 0.30, bad: 0.26 };    // pente / amplitude sur les bords forts
  const LIGHT = { warn: 45, bad: 85 };        // pente d’éclairage du papier, d’un coin à l’autre (0-255)
  const DPI = { warn: 140, bad: 100 };        // 150 dpi suffit pour un tirage regardé à distance
  const JPEG = { warn: 60, bad: 40 };

  // ---------- Mesures sur l'image de travail ----------

  function gray(canvas, maxLong) {
    const k = Math.min(1, maxLong / Math.max(canvas.width, canvas.height));
    const w = Math.max(8, Math.round(canvas.width * k)), h = Math.max(8, Math.round(canvas.height * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    const neutral = new Uint8Array(w * h); // papier probable : clair et sans couleur franche
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      const r = d[j], gg = d[j + 1], b = d[j + 2];
      g[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      neutral[i] = g[i] > 110 && mx - mn < Math.max(28, mx * 0.16) ? 1 : 0;
    }
    c.width = c.height = 0;
    return { g, w, h, neutral };
  }

  function percentile(arr, p) {
    if (!arr.length) return NaN;
    const a = Float32Array.from(arr).sort();
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  }

  // Netteté : médiane, sur les 3 % de pixels au plus fort gradient, de gradient / amplitude 5×5.
  function sharpness({ g, w, h }) {
    const G = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = (g[i + 1] - g[i - 1]) / 2, gy = (g[i + w] - g[i - w]) / 2;
        G[i] = Math.hypot(gx, gy);
      }
    }
    const sample = [];
    for (let i = 0; i < G.length; i += 3) sample.push(G[i]);
    const thr = percentile(sample, 0.97);
    if (!(thr > 2)) return NaN;
    const vals = [];
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const i = y * w + x;
        if (G[i] < thr) continue;
        let lo = 255, hi = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const v = g[i + dy * w + dx]; if (v < lo) lo = v; if (v > hi) hi = v; }
        const r = hi - lo;
        if (r > 40) vals.push(G[i] / r);
      }
    }
    return vals.length > 50 ? percentile(vals, 0.5) : NaN;
  }

  // Éclairage : la feuille découpée en 6 × 6 cases ; dans chaque case, la luminosité médiane des
  // pixels de papier (clairs, sans couleur). Une ombre ou une lampe assombrissent la feuille de façon
  // progressive : on ajuste un plan (luminosité selon x et y) sur les cases de papier, et l'écart
  // compte seulement si ce plan explique bien les différences (un lavis gris, lui, est irrégulier).
  // Rend { range, fit } : écart d'un bord à l'autre du plan, et part des écarts qu'il explique.
  function lighting({ g, w, h, neutral }) {
    const N = 6, cells = [];
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        const x0 = Math.floor((cx * w) / N), x1 = Math.floor(((cx + 1) * w) / N), y0 = Math.floor((cy * h) / N), y1 = Math.floor(((cy + 1) * h) / N);
        const v = [];
        let n = 0;
        for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { n++; const i = y * w + x; if (neutral[i]) v.push(g[i]); }
        if (v.length > n * 0.35) cells.push({ x: (cx + 0.5) / N - 0.5, y: (cy + 0.5) / N - 0.5, v: percentile(v, 0.6) });
      }
    }
    if (cells.length < N * N * 0.5) return NaN;
    // moindres carrés : v = a + b·x + c·y (x, y centrés, de -0,5 à 0,5)
    const n = cells.length;
    let sx = 0, sy = 0, sv = 0, sxx = 0, syy = 0, sxy = 0, sxv = 0, syv = 0;
    cells.forEach(({ x, y, v }) => { sx += x; sy += y; sv += v; sxx += x * x; syy += y * y; sxy += x * y; sxv += x * v; syv += y * v; });
    const mx = sx / n, my = sy / n, mv = sv / n;
    const Sxx = sxx - n * mx * mx, Syy = syy - n * my * my, Sxy = sxy - n * mx * my, Sxv = sxv - n * mx * mv, Syv = syv - n * my * mv;
    const det = Sxx * Syy - Sxy * Sxy;
    if (Math.abs(det) < 1e-9) return NaN;
    const b = (Sxv * Syy - Syv * Sxy) / det, c = (Syv * Sxx - Sxv * Sxy) / det;
    let ssTot = 0, ssRes = 0;
    cells.forEach(({ x, y, v }) => { const f = mv + b * (x - mx) + c * (y - my); ssTot += (v - mv) ** 2; ssRes += (v - f) ** 2; });
    const fit = ssTot > 1e-6 ? 1 - ssRes / ssTot : 0;
    const range = Math.abs(b) + Math.abs(c); // d'un coin à l'autre de la feuille
    return fit > 0.55 ? range : range * (fit / 0.55) ** 2;
  }

  function measure(canvas) {
    try {
      const img = gray(canvas, 1000);
      return { sharp: sharpness(img), light: lighting(img) };
    } catch (e) {
      return { sharp: NaN, light: NaN };
    }
  }

  // ---------- Qualité JPEG estimée (tables de quantification) ----------

  const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
  function jpegQuality(buf) {
    try {
      const b = new Uint8Array(buf);
      if (b[0] !== 0xff || b[1] !== 0xd8) return null;
      let i = 2;
      while (i + 4 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
        if (m === 0xda || m === 0xd9) break;
        if (m === 0xdb) {
          let p = i + 4;
          const end = i + 2 + len;
          while (p < end) {
            const pq = b[p] >> 4, tq = b[p] & 15;
            p++;
            const q = [];
            for (let k = 0; k < 64; k++) { q.push(pq ? (b[p] << 8) | b[p + 1] : b[p]); p += pq ? 2 : 1; }
            if (tq === 0) {
              // échelle par rapport à la table standard de libjpeg, puis qualité (formule inverse)
              let s = 0;
              for (let k = 0; k < 64; k++) s += (q[k] * 100) / STD_LUMA[ZIGZAG[k]];
              s /= 64;
              const Q = s <= 100 ? (200 - s) / 2 : 5000 / s;
              return Math.max(1, Math.min(100, Math.round(Q)));
            }
          }
        }
        i += 2 + len;
      }
    } catch (e) { /* fichier inattendu */ }
    return null;
  }

  // ---------- Verdict ----------

  // d : dessin de l'atelier (d.q = mesures, d.pxLong = pixels réels du grand côté, d.sizeCm)
  function assess(d) {
    const q = d.q || {};
    const issues = [];
    const role = d.role === 'auto' ? d.auto : d.role;
    if (d.pxLong > 0 && d.sizeCm > 0) {
      const dpi = Math.round(d.pxLong / (d.sizeCm / 2.54));
      const cm = (Math.round(d.sizeCm * 10) / 10).toLocaleString(window.I18n ? I18n.locale : 'fr-FR');
      if (dpi < DPI.bad) {
        issues.push({ code: 'dpi', level: 'bad', title: tr('Définition trop faible pour l’impression'),
          text: tr`${Math.round(d.pxLong)} px pour ${cm} cm : environ ${dpi} dpi, le tirage sera flou.`,
          tip: tr('Rescannez le dessin à 300 dpi, ou utilisez la photo d’origine plutôt qu’une capture d’écran ou une image reçue par messagerie.') });
      } else if (dpi < DPI.warn) {
        issues.push({ code: 'dpi', level: 'warn', title: tr('Définition juste'),
          text: tr`Environ ${dpi} dpi à ${cm} cm : correct, un peu doux de près.`,
          tip: tr('Un scan à 300 dpi donnera un tirage plus net.') });
      }
    }
    if (q.jpeg && q.jpeg < JPEG.warn) {
      issues.push({ code: 'jpeg', level: q.jpeg < JPEG.bad ? 'bad' : 'warn', title: tr('Image très compressée'),
        text: tr`Qualité JPEG estimée à ${q.jpeg} sur 100 : des pavés peuvent apparaître à l’impression.`,
        tip: tr('Elle a sans doute été envoyée par une messagerie : utilisez le fichier d’origine.') });
    }
    if (q.sharp < SHARP.warn) {
      const bad = q.sharp < SHARP.bad;
      issues.push({ code: 'flou', level: bad ? 'bad' : 'warn', title: bad ? tr('Photo floue') : tr('Dessin un peu flou'),
        text: tr('Les traits sont moins nets que sur un scan.'),
        tip: tr('Reprenez la photo à la lumière du jour, téléphone bien parallèle à la feuille, en touchant l’écran sur le dessin pour la mise au point ; ou scannez-le.') });
    }
    if (q.light > LIGHT.warn && role !== 'texture') {
      issues.push({ code: 'lumiere', level: q.light > LIGHT.bad ? 'bad' : 'warn', title: tr('Éclairage inégal'),
        text: tr('Une partie de la feuille est plus sombre : ombre ou lumière d’une lampe.'),
        tip: tr('Photographiez près d’une fenêtre, sans vous pencher au-dessus du dessin, ou scannez-le.') });
    }
    const level = issues.some((x) => x.level === 'bad') ? 'bad' : issues.length ? 'warn' : 'ok';
    return { level, issues };
  }

  window.Quality = { measure, jpegQuality, assess, sharpness, lighting, gray, SHARP, LIGHT, DPI, JPEG };
})();
