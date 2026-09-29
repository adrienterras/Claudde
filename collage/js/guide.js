/*
 * Guide de création imprimable (PDF) pour réaliser l'œuvre à la main :
 *  - couverture, plan de pose quadrillé, étapes de collage dans l'ordre (du fond vers le dessus) ;
 *  - planches de découpe à TAILLE RÉELLE : chaque élément est reproduit à sa taille dans l'œuvre,
 *    entouré d'un trait de coupe magenta épais et numéroté.
 * Chaque page est dessinée sur un canvas à 150 dpi puis placée dans le PDF à ses dimensions exactes.
 */
(function () {
  'use strict';

  const DPI = 150;
  const PX = DPI / 25.4; // pixels par millimètre
  // Charte Atelier Gribouille ; le trait de coupe reste magenta, pour être visible sur tous les dessins.
  const C = { ink: '#3b3a2a', muted: '#847e6e', line: '#e3d9ca', accent: '#c26f56', olive: '#6b6f4e', cut: '#e5007d', soft: '#f1ebe1', craie: '#f8f5ef' };
  const F = {
    display: '"Playfair Display", Georgia, "Times New Roman", serif',
    body: 'Montserrat, "Helvetica Neue", Arial, sans-serif',
    mono: 'Montserrat, "Helvetica Neue", Arial, sans-serif',
  };
  const A4 = [210, 297], A3 = [297, 420];
  const MARGIN = 12;

  const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR');
  const tick = () => new Promise((r) => setTimeout(r, 0));

  // ---------- Outils de page (on dessine en millimètres) ----------

  function newPage(w, h) {
    const c = Extract.makeCanvas(w * PX, h * PX);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(PX, PX);
    ctx.textBaseline = 'alphabetic';
    return { c, ctx, w, h };
  }

  function text(ctx, s, x, y, size, opts = {}) {
    ctx.font = `${opts.weight || ''} ${size}px ${opts.font || F.body}`.trim();
    ctx.fillStyle = opts.color || C.ink;
    ctx.textAlign = opts.align || 'left';
    ctx.fillText(s, x, y);
    return ctx.measureText(s).width;
  }

  function wrap(ctx, s, x, y, maxW, size, lineH, opts = {}) {
    ctx.font = `${opts.weight || ''} ${size}px ${opts.font || F.body}`.trim();
    const words = s.split(' ');
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) {
        text(ctx, line, x, y, size, opts);
        y += lineH;
        line = w;
      } else line = t;
    }
    if (line) { text(ctx, line, x, y, size, opts); y += lineH; }
    return y;
  }

  // Texte en capitales espacées, centré (style des étiquettes de la charte).
  function spaced(ctx, s, cx, y, size, spacing, font, color) {
    ctx.font = `${size}px ${font}`;
    const widths = [...s].map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (s.length - 1);
    let x = cx - total / 2;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    [...s].forEach((ch, i) => { ctx.fillText(ch, x, y); x += widths[i] + spacing; });
  }

  function tinted(img, color) {
    const c = Extract.makeCanvas(img.width, img.height);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = src;
    });
  }

  function chrome(pg, section, n, total) {
    const { ctx, w, h } = pg;
    if (chrome.logo) ctx.drawImage(chrome.logo, MARGIN, 4.6, 7, (7 * chrome.logo.height) / chrome.logo.width);
    text(ctx, 'ATELIER GRIBOUILLE · GUIDE DE CRÉATION', MARGIN + 9, 9, 2.2, { font: F.body, color: C.muted });
    text(ctx, section.toUpperCase(), w - MARGIN, 9, 2.4, { font: F.mono, color: C.muted, align: 'right' });
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 0.25;
    ctx.beginPath(); ctx.moveTo(MARGIN, 11.5); ctx.lineTo(w - MARGIN, 11.5); ctx.stroke();
    text(ctx, `${n} / ${total}`, w - MARGIN, h - 6, 2.4, { font: F.mono, color: C.muted, align: 'right' });
  }

  function badge(ctx, n, x, y, r, color) {
    ctx.fillStyle = color || C.ink;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.font = `600 ${r * 1.05}px ${F.body}`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + r * 0.05);
    ctx.textBaseline = 'alphabetic';
  }

  // Petit pictogramme de ciseaux, dessiné (pas de dépendance à une police).
  function scissors(ctx, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.12;
    ctx.beginPath(); ctx.arc(-s * 0.35, -s * 0.28, s * 0.18, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(-s * 0.35, s * 0.28, s * 0.18, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, -s * 0.18); ctx.lineTo(s * 0.5, s * 0.22);
    ctx.moveTo(-s * 0.2, s * 0.18); ctx.lineTo(s * 0.5, -s * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  // Règle de contrôle : doit mesurer 10 cm une fois imprimée.
  function ruler(pg, y) {
    const { ctx } = pg;
    const x0 = MARGIN;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 0.3;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + 100, y); ctx.stroke();
    for (let i = 0; i <= 100; i += 5) {
      ctx.beginPath(); ctx.moveTo(x0 + i, y); ctx.lineTo(x0 + i, y - (i % 10 === 0 ? 3 : 1.6)); ctx.stroke();
      if (i % 10 === 0) text(ctx, String(i / 10), x0 + i, y - 4, 2.2, { font: F.mono, align: 'center', color: C.muted });
    }
    text(ctx, 'Imprimez à 100 %, sans « ajuster à la page » :', x0 + 106, y - 3.2, 2.6, { color: C.muted });
    text(ctx, 'cette règle doit mesurer exactement 10 cm.', x0 + 106, y + 0.4, 2.6, { color: C.muted });
  }

  // ---------- Éléments à découper ----------

  /*
   * Rend un élément à taille réelle (sur l'œuvre) avec son trait de coupe :
   * un liseré magenta épais, bordé de blanc, qui suit exactement le contour.
   */
  /*
   * Page de fond entière, à l'échelle, avec le trait de coupe du grand morceau :
   * ce qui reste autour (les chutes) sert aux lambeaux de fond.
   */
  function panelPageCanvas(L) {
    const wmm = L.pageW * 10, hmm = L.pageH * 10, pad = 2.2;
    const W = Math.round(wmm * PX), H = Math.round(hmm * PX), P = Math.round(pad * PX);
    const k = W / L.src.width; // pixels de planche par pixel de page
    const c = Extract.makeCanvas(W + 2 * P, H + 2 * P);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(L.src, P, P, W, H);
    x.strokeStyle = C.line;
    x.lineWidth = 0.25 * PX;
    x.strokeRect(P, P, W, H);
    // contour déchiré du morceau, replacé dans la page
    const cx = P + (L.sx + L.sw / 2) * k, cy = P + (L.sy + L.sh / 2) * k;
    const drawClip = () => {
      x.beginPath();
      (L.clip || [[-L.w / 2, -L.h / 2], [L.w / 2, -L.h / 2], [L.w / 2, L.h / 2], [-L.w / 2, L.h / 2]]).forEach(([px, py], i) => {
        const X = cx + px * 10 * PX, Y = cy + py * 10 * PX;
        i ? x.lineTo(X, Y) : x.moveTo(X, Y);
      });
      x.closePath();
    };
    x.lineJoin = 'round';
    drawClip(); x.strokeStyle = '#ffffff'; x.lineWidth = 3 * PX; x.stroke();
    drawClip(); x.strokeStyle = C.cut; x.lineWidth = 1.8 * PX; x.stroke();
    // les chutes, hachurées légèrement
    x.save();
    x.beginPath();
    x.rect(P, P, W, H);
    // même chemin que le contour, dans le sens inverse : la page moins le morceau
    const pts = L.clip || [[-L.w / 2, -L.h / 2], [L.w / 2, -L.h / 2], [L.w / 2, L.h / 2], [-L.w / 2, L.h / 2]];
    pts.slice().reverse().forEach(([px, py], i) => {
      const X = cx + px * 10 * PX, Y = cy + py * 10 * PX;
      i ? x.lineTo(X, Y) : x.moveTo(X, Y);
    });
    x.closePath();
    x.clip('evenodd');
    x.strokeStyle = 'rgba(59,58,42,0.35)';
    x.lineWidth = 0.15 * PX;
    for (let d = -H; d < W + H; d += 4 * PX) { x.beginPath(); x.moveTo(P + d, P); x.lineTo(P + d + H, P + H); x.stroke(); }
    x.restore();
    return { canvas: c, w: wmm + 2 * pad, h: hmm + 2 * pad };
  }

  function elementCanvas(L) {
    if (L.kind === 'bg' && L.panel && L.pageW) return panelPageCanvas(L);
    const wmm = L.w * 10, hmm = L.h * 10, pad = 2.2;
    const W = Math.max(1, Math.round(wmm * PX)), H = Math.max(1, Math.round(hmm * PX)), P = Math.round(pad * PX);
    const img = Extract.makeCanvas(W, H);
    const ig = img.getContext('2d');
    ig.imageSmoothingQuality = 'high';
    if (L.flip) { ig.translate(W, 0); ig.scale(-1, 1); }
    if (L.kind === 'piece') {
      ig.drawImage(L.piece.canvas, 0, 0, W, H);
    } else {
      if (L.clip) {
        ig.beginPath();
        L.clip.forEach(([x, y], i) => {
          const px = (x + L.w / 2) * 10 * PX, py = (y + L.h / 2) * 10 * PX;
          i ? ig.lineTo(px, py) : ig.moveTo(px, py);
        });
        ig.closePath();
        ig.clip();
      }
      ig.drawImage(L.src, L.sx, L.sy, L.sw, L.sh, 0, 0, W, H);
    }
    const silhouette = (color) => {
      const s = Extract.makeCanvas(W, H);
      const sc = s.getContext('2d');
      sc.drawImage(img, 0, 0);
      sc.globalCompositeOperation = 'source-in';
      sc.fillStyle = color;
      sc.fillRect(0, 0, W, H);
      return s;
    };
    const c = Extract.makeCanvas(W + 2 * P, H + 2 * P);
    const x = c.getContext('2d');
    [[1.5, '#ffffff'], [0.9, C.cut]].forEach(([r, col]) => {
      const s = silhouette(col);
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        x.drawImage(s, P + Math.cos(a) * r * PX, P + Math.sin(a) * r * PX);
      }
    });
    x.drawImage(img, P, P);
    return { canvas: c, w: wmm + 2 * pad, h: hmm + 2 * pad };
  }

  function rotate90(el) {
    const c = Extract.makeCanvas(el.canvas.height, el.canvas.width);
    const x = c.getContext('2d');
    x.translate(c.width, 0);
    x.rotate(Math.PI / 2);
    x.drawImage(el.canvas, 0, 0);
    return { canvas: c, w: el.h, h: el.w, rotated: true };
  }

  // ---------- Construction ----------

  /*
   * opts : { drawings, nameOf(d), numberOf(d), title, styleName, scale, onProgress(text) }
   */
  async function build(comp, opts) {
    const { jsPDF } = window.jspdf;
    if (document.fonts && document.fonts.load) {
      await Promise.all(['400 10px "Playfair Display"', 'italic 400 10px "Playfair Display"', '400 10px Montserrat', '600 10px Montserrat']
        .map((f) => document.fonts.load(f).catch(() => {})));
    }
    const logo = await loadImage('assets/logo-mark.png');
    chrome.logo = logo ? tinted(logo, C.muted) : null;
    const texOwner = new Map();
    opts.drawings.forEach((d) => { if (d.analysis.texture) texOwner.set(d.analysis.texture.canvas, d); });
    const ownerOf = (L) => (L.kind === 'piece' ? L.piece.drawing : texOwner.get(L.src));

    // Étapes dans l'ordre de collage : lambeaux, grandes pages, puis découpes (ordre des calques).
    const scraps = comp.bg.filter((L) => L.scrap);
    const panels = comp.bg.filter((L) => L.panel);
    const steps = [];
    if (scraps.length) steps.push({ kind: 'scraps', layers: scraps });
    panels.forEach((L) => steps.push({ kind: 'panel', layer: L }));
    comp.items.forEach((L) => steps.push({ kind: 'piece', layer: L }));
    steps.forEach((st, i) => { st.n = i + 1; });

    const k = opts.scale; // échelle des dessins sur l'œuvre

    // ---- Planches : rangement des éléments (à taille réelle) sur des pages A4 ----
    opts.onProgress && opts.onProgress('Préparation des planches de découpe…');
    const toPack = [];
    for (const st of steps) {
      if (st.kind === 'scraps') continue;
      toPack.push({ st, label: String(st.n), el: elementCanvas(st.layer) });
      await tick();
    }

    const sheets = []; // { size:[w,h], items:[{x,y,it}], shelves, used, tile? }
    const AW = A4[0] - 2 * MARGIN, AH = A4[1] - 22 - 24; // zone utile A4
    const labelH = 7, gap = 6;
    const oversized = [];
    // Rangement « premier emplacement libre » : les plus grands d'abord, chaque élément va dans
    // la première planche où il tient (sur une étagère existante ou une nouvelle), pour économiser le papier.
    const fits = [];
    toPack.forEach((it) => {
      let el = it.el;
      if (el.w > AW || el.h + labelH > AH) {
        const r = rotate90(el);
        if (r.w <= AW && r.h + labelH <= AH) el = r;
        else { oversized.push(it); return; }
      }
      it.el = el;
      fits.push(it);
    });
    fits.sort((a, b) => b.el.h - a.el.h);
    fits.forEach((it) => {
      const el = it.el, hh = el.h + labelH;
      let placed = false;
      for (const sh of sheets) {
        for (const shelf of sh.shelves) {
          if (hh <= shelf.h && shelf.x + el.w <= AW) {
            sh.items.push({ x: MARGIN + shelf.x, y: 22 + shelf.y, it });
            shelf.x += el.w + gap;
            placed = true;
            break;
          }
        }
        if (placed) break;
        if (sh.used + hh <= AH) {
          sh.shelves.push({ y: sh.used, h: hh, x: el.w + gap });
          sh.items.push({ x: MARGIN, y: 22 + sh.used, it });
          sh.used += hh + gap;
          placed = true;
          break;
        }
      }
      if (!placed) {
        sheets.push({ size: A4, items: [{ x: MARGIN, y: 22, it }], shelves: [{ y: 0, h: hh, x: el.w + gap }], used: hh + gap });
      }
    });
    // numéros de planche, et éléments rangés par numéro d'étape sur chaque planche
    sheets.forEach((sh, i) => sh.items.forEach(({ it }) => { if (it.st) it.st.sheet = i + 1; }));
    // Grands éléments : une page A3, ou plusieurs pages A3 à assembler.
    oversized.forEach((it) => {
      const el = it.el;
      const BW = A3[0] - 2 * MARGIN, BH = A3[1] - 22 - 24 - labelH;
      if (el.w <= BW && el.h <= BH) {
        sheets.push({ size: A3, items: [{ x: MARGIN, y: 22, it }] });
        if (it.st) it.st.sheet = sheets.length;
        return;
      }
      const ov = 10; // recouvrement entre morceaux, en mm
      const nx = Math.ceil((el.w - ov) / (BW - ov)), ny = Math.ceil((el.h - ov) / (BH - ov));
      const first = sheets.length + 1;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          sheets.push({ size: A3, tile: { i, j, nx, ny, ov, BW, BH }, items: [{ x: MARGIN, y: 22, it }] });
        }
      }
      if (it.st) { it.st.sheet = first; it.st.sheetEnd = sheets.length; }
    });

    // ---- Pages ----
    const pages = [];
    const baseThumb = (() => {
      const s = 6; // px par cm pour la miniature
      const c = Extract.makeCanvas(comp.W * s, comp.H * s);
      const x2 = c.getContext('2d');
      Compose.renderBg(x2, comp, s, false);
      Compose.renderItems(x2, comp, s, false);
      return c;
    })();

    // Couverture
    {
      const pg = newPage(...A4);
      const { ctx } = pg;
      const mid = A4[0] / 2;
      ctx.fillStyle = C.craie;
      ctx.fillRect(0, 0, A4[0], A4[1]);
      // logo complet de la charte
      if (logo) {
        const lw = 30, lh = (lw * logo.height) / logo.width;
        ctx.drawImage(tinted(logo, C.ink), mid - lw / 2, 15, lw, lh);
      }
      spaced(ctx, 'ATELIER', mid, 48, 3.4, 2.2, F.body, C.ink);
      text(ctx, 'Gribouille', mid, 61, 14, { font: F.display, align: 'center' });
      spaced(ctx, 'LES DESSINS D’ENFANTS DEVIENNENT DES ŒUVRES D’ART', mid, 68, 2.1, 0.9, F.body, C.ink);
      ctx.fillStyle = C.ink;
      ctx.fillRect(mid - 6, 73, 12, 0.25);
      text(ctx, 'Guide de création', mid, 84, 8, { font: F.display, weight: 'italic', align: 'center' });
      if (opts.title) text(ctx, `« ${opts.title} »`, mid, 92, 4.6, { font: F.display, weight: 'italic', align: 'center', color: C.accent });
      const iw = Math.min(128, (88 * comp.W) / comp.H), ih = iw * comp.H / comp.W;
      ctx.save();
      ctx.shadowColor = 'rgba(59,58,42,0.3)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1.2;
      ctx.drawImage(baseThumb, mid - iw / 2, 98, iw, ih);
      ctx.restore();
      let yy = 98 + ih + 10;
      const nPieces = comp.items.length, nPanels = panels.length;
      const facts = [
        `${opts.styleName} · toile de ${fmt(comp.W)} × ${fmt(comp.H)} cm`,
        `${opts.drawings.length} dessins · échelle ${Math.round(k * 100)} % · ${nPanels} pages de fond · ${nPieces} découpes${scraps.length ? ` · ${scraps.length} lambeaux` : ''}`,
        `${sheets.length} planches à imprimer · ${steps.length} étapes de collage`,
      ];
      facts.forEach((f) => { text(ctx, f, mid, yy, 3.1, { font: F.body, color: C.ink, align: 'center' }); yy += 5; });
      yy += 6;
      const colW = (A4[0] - 2 * MARGIN - 10) / 2;
      text(ctx, 'Matériel', MARGIN, yy, 5, { font: F.display });
      text(ctx, 'Mode d’emploi', MARGIN + colW + 10, yy, 5, { font: F.display });
      let y1 = yy + 7, y2 = yy + 7;
      [
        `Une toile ou un carton de ${fmt(comp.W)} × ${fmt(comp.H)} cm`,
        'Les planches imprimées sur papier mat 120 g ou plus',
        'Ciseaux fins et cutter, tapis de coupe',
        'Colle vinylique ou vernis-colle (type Mod Podge), pinceau plat',
        'Crayon à papier, règle d’un mètre, gomme',
        'Vernis mat pour protéger l’œuvre (facultatif)',
      ].forEach((m) => { y1 = wrap(ctx, '·  ' + m, MARGIN, y1, colW, 3, 4.2); y1 += 0.8; });
      [
        '1. Imprimez les planches à 100 % et vérifiez la règle de 10 cm.',
        '2. Tracez légèrement au crayon la grille de 10 cm du plan de pose sur la toile.',
        `3. Découpez chaque élément en suivant le trait magenta ; gardez-le avec son numéro.`,
        '4. Collez dans l’ordre des étapes : d’abord le fond, puis les découpes, du numéro 1 au dernier. Un papier qui dépasse de la toile se replie sur la tranche ou se rogne au cutter.',
        '5. Laissez sécher sous un poids, puis passez une couche de vernis.',
      ].forEach((m) => { y2 = wrap(ctx, m, MARGIN + colW + 10, y2, colW, 3, 4.2); y2 += 0.8; });
      let y3 = Math.max(y1, y2) + 4;
      y3 = wrap(ctx, `Les planches reproduisent chaque dessin à l’échelle de l’œuvre (${Math.round(k * 100)} %), ce qui permet aussi de réutiliser un même dessin plusieurs fois. Pour coller les dessins originaux eux-mêmes, réglez l’échelle à 100 % avant de créer le guide : les planches servent alors de gabarits à poser sur les originaux.`, MARGIN, y3, A4[0] - 2 * MARGIN, 2.8, 3.9, { color: C.muted });
      pages.push({ pg, section: 'Couverture' });
    }

    // Plan de pose
    {
      const pg = newPage(A4[1], A4[0]); // paysage
      const { ctx, w, h } = pg;
      text(ctx, 'Plan de pose', MARGIN, 22, 7, { font: F.display });
      text(ctx, 'Tracez cette grille de 10 cm au crayon sur la toile. Chaque numéro indique le centre d’un élément et son ordre de collage.', MARGIN, 29, 3, { color: C.muted });
      const top = 38, left = MARGIN + 6;
      const sc = Math.min((w - left - MARGIN) / comp.W, (h - top - 14) / comp.H); // mm par cm
      const iw = comp.W * sc, ih = comp.H * sc;
      ctx.drawImage(baseThumb, left, top, iw, ih);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(left, top, iw, ih);
      ctx.strokeStyle = 'rgba(28,26,33,0.55)';
      ctx.lineWidth = 0.25;
      for (let gx = 0; gx <= comp.W + 0.01; gx += 10) {
        ctx.beginPath(); ctx.moveTo(left + gx * sc, top); ctx.lineTo(left + gx * sc, top + ih); ctx.stroke();
        if (gx < comp.W) text(ctx, String.fromCharCode(65 + gx / 10), left + (gx + 5) * sc, top - 2, 2.6, { font: F.mono, align: 'center', color: C.muted });
      }
      for (let gy = 0; gy <= comp.H + 0.01; gy += 10) {
        ctx.beginPath(); ctx.moveTo(left, top + gy * sc); ctx.lineTo(left + iw, top + gy * sc); ctx.stroke();
        if (gy < comp.H) text(ctx, String(gy / 10 + 1), left - 2.5, top + (gy + 5) * sc + 1, 2.6, { font: F.mono, align: 'right', color: C.muted });
      }
      steps.forEach((st) => {
        if (st.kind === 'scraps') return;
        const L = st.layer;
        badge(ctx, st.n, left + L.x * sc, top + L.y * sc, 2.1, st.kind === 'panel' ? C.olive : C.accent);
      });
      text(ctx, '● pages de fond   ● découpes', MARGIN, h - 7, 2.6, { font: F.mono, color: C.muted });
      pages.push({ pg, section: 'Plan de pose' });
    }

    // Étapes de collage : 6 cartes par page
    const cellName = (cx, cy) => `${String.fromCharCode(65 + Math.floor(cx / 10))}${Math.floor(cy / 10) + 1}`;
    for (let i = 0; i < steps.length; i += 6) {
      const pg = newPage(...A4);
      const { ctx } = pg;
      text(ctx, 'Étapes de collage', MARGIN, 22, 7, { font: F.display });
      text(ctx, 'Du fond vers le dessus. Chaque carte montre où poser l’élément (en couleur) sur l’œuvre.', MARGIN, 29, 3, { color: C.muted });
      steps.slice(i, i + 6).forEach((st, j) => {
        const cw = (A4[0] - 2 * MARGIN - 8) / 2, ch = 82;
        const x0 = MARGIN + (j % 2) * (cw + 8), y0 = 35 + Math.floor(j / 2) * (ch + 4);
        ctx.strokeStyle = C.line; ctx.lineWidth = 0.3;
        ctx.strokeRect(x0, y0, cw, ch);
        // mini-carte : l'œuvre estompée, l'élément de l'étape en couleur
        const mw = cw - 8, mh = Math.min(mw * comp.H / comp.W, 54);
        const s = 8;
        const map = Extract.makeCanvas(comp.W * s, comp.H * s);
        const mx = map.getContext('2d');
        mx.drawImage(baseThumb, 0, 0, map.width, map.height);
        mx.fillStyle = 'rgba(255,255,255,0.72)';
        mx.fillRect(0, 0, map.width, map.height);
        const layers = st.kind === 'scraps' ? st.layers : [st.layer];
        layers.forEach((L) => Compose.drawLayer(mx, L, s, false));
        if (st.kind !== 'scraps') {
          const L = st.layer;
          mx.save();
          mx.translate(L.x * s, L.y * s); mx.rotate(L.rot);
          mx.strokeStyle = C.cut; mx.lineWidth = 3; mx.setLineDash([8, 5]);
          mx.strokeRect((-L.w / 2) * s - 3, (-L.h / 2) * s - 3, L.w * s + 6, L.h * s + 6);
          mx.restore();
        }
        const dw = mh * comp.W / comp.H, dx = x0 + (cw - dw) / 2;
        ctx.drawImage(map, dx, y0 + 4, dw, mh);
        ctx.strokeStyle = C.line; ctx.strokeRect(dx, y0 + 4, dw, mh);
        let ty = y0 + 4 + mh + 6;
        badge(ctx, st.n, x0 + 7.5, ty - 1.2, 3, st.kind === 'piece' ? C.accent : C.olive);
        if (st.kind === 'scraps') {
          text(ctx, 'Lambeaux de fond', x0 + 13, ty, 3.8, { weight: '600' });
          const srcs = [...new Set(st.layers.map((L) => ownerOf(L)).filter(Boolean))].map((d) => opts.numberOf(d));
          ty += 5;
          ty = wrap(ctx, `Après avoir découpé les grands morceaux des pages de fond (étapes ${steps.filter((q) => q.kind === 'panel').map((q) => q.n).slice(0, 1)} à ${steps.filter((q) => q.kind === 'panel').map((q) => q.n).slice(-1)}), déchirez leurs chutes hachurées en morceaux de 3 à 7 cm et collez-les dans les zones en couleur ci-dessus (${st.layers.length} lambeaux, dessins ${srcs.join(', ')}). Pas besoin de précision : ce fond sera en partie recouvert.`, x0 + 4, ty, cw - 8, 2.8, 3.8, { color: C.ink });
          return;
        }
        const L = st.layer;
        const d = ownerOf(L);
        const name = d ? opts.nameOf(d) : 'Élément';
        text(ctx, name.length > 34 ? name.slice(0, 33) + '…' : name, x0 + 13, ty, 3.8, { weight: '600' });
        ty += 5;
        const where = st.sheetEnd ? `planches ${st.sheet} à ${st.sheetEnd}` : `planche ${st.sheet}`;
        text(ctx, `${st.kind === 'panel' ? 'Page de fond' : 'Découpe'} · dessin ${d ? opts.numberOf(d) : '?'} · ${where}`, x0 + 4, ty, 2.8, { color: C.muted });
        ty += 4.4;
        text(ctx, `Case ${cellName(L.x, L.y)} · centre à ${fmt(L.x)} cm de la gauche,`, x0 + 4, ty, 2.7, { font: F.mono });
        ty += 3.9;
        text(ctx, `${fmt(L.y)} cm du haut`, x0 + 4, ty, 2.7, { font: F.mono });
        ty += 3.9;
        const deg = Math.round((L.rot * 180) / Math.PI);
        const rot = Math.abs(deg) < 1 ? 'Bien droit' : `Tourné de ${Math.abs(deg)}° vers la ${deg > 0 ? 'droite' : 'gauche'}`;
        text(ctx, rot + (L.flip ? ' · en miroir' : ''), x0 + 4, ty, 2.7, { font: F.mono });
      });
      pages.push({ pg, section: 'Étapes de collage' });
      opts.onProgress && opts.onProgress(`Étapes de collage… ${Math.min(i + 6, steps.length)} / ${steps.length}`);
      await tick();
    }

    // Planches de découpe
    for (let si = 0; si < sheets.length; si++) {
      const sh = sheets[si];
      const pg = newPage(...sh.size);
      const { ctx, w, h } = pg;
      text(ctx, `Planche ${si + 1}`, MARGIN, 19, 5, { font: F.display });
      scissors(ctx, MARGIN + 30, 17.5, 5, C.cut);
      text(ctx, 'Découpez sur le trait magenta. Le numéro est celui de l’étape de collage.', MARGIN + 36, 19, 2.8, { color: C.muted });
      sh.items.forEach(({ x: ix, y: iy, it }) => {
        const el = it.el;
        const ly = iy + 5;
        if (sh.tile) {
          const t = sh.tile;
          const sx = t.i * (t.BW - t.ov), sy = t.j * (t.BH - t.ov);
          const tw = Math.min(t.BW, el.w - sx), th = Math.min(t.BH, el.h - sy);
          ctx.drawImage(el.canvas, sx * PX, sy * PX, tw * PX, th * PX, ix, ly + 2, tw, th);
          ctx.fillStyle = 'rgba(28,26,33,0.08)';
          if (t.i > 0) ctx.fillRect(ix, ly + 2, t.ov, th);
          if (t.j > 0) ctx.fillRect(ix, ly + 2, tw, t.ov);
          badge(ctx, it.label, ix + 3, iy + 1, 2.8, it.st && it.st.kind === 'panel' ? C.olive : C.accent);
          text(ctx, `partie ${t.j * t.nx + t.i + 1} / ${t.nx * t.ny} · ligne ${t.j + 1}, colonne ${t.i + 1} — superposez les bandes grises de 1 cm`, ix + 8, iy + 2, 2.6, { color: C.muted });
          return;
        }
        ctx.drawImage(el.canvas, ix, ly + 2, el.w, el.h);
        badge(ctx, it.label, ix + 3, iy + 1, 2.8, it.st && it.st.kind === 'panel' ? C.olive : C.accent);
        const d = it.st && ownerOf(it.st.layer);
        const isPanel = it.st && it.st.kind === 'panel';
        const cap = `${d ? opts.nameOf(d) : ''}${isPanel ? ' · page de fond : découpez le morceau, gardez les chutes hachurées pour les lambeaux' : ''}${el.rotated ? ' · couché sur la planche' : ''}`;
        ctx.save();
        ctx.beginPath(); ctx.rect(ix + 7, iy - 3, Math.max(10, el.w - 7), 6); ctx.clip();
        text(ctx, cap, ix + 7, iy + 2, 2.6, { color: C.muted });
        ctx.restore();
      });
      ruler(pg, h - 12);
      pages.push({ pg, section: 'Planches de découpe' });
      if (si % 3 === 2) { opts.onProgress && opts.onProgress(`Planches de découpe… ${si + 1} / ${sheets.length}`); await tick(); }
    }

    // ---- PDF ----
    opts.onProgress && opts.onProgress('Assemblage du PDF…');
    let doc = null;
    for (let i = 0; i < pages.length; i++) {
      const { pg, section } = pages[i];
      chrome(pg, section, i + 1, pages.length);
      const land = pg.w > pg.h;
      const size = [pg.w, pg.h];
      if (!doc) doc = new jsPDF({ unit: 'mm', format: size, orientation: land ? 'landscape' : 'portrait', compress: true });
      else doc.addPage(size, land ? 'landscape' : 'portrait');
      doc.addImage(pg.c.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, pg.w, pg.h, undefined, 'FAST');
      if (i % 4 === 3) await tick();
    }
    doc.setProperties({ title: `Guide de création${opts.title ? ` — ${opts.title}` : ''}`, creator: 'Atelier Gribouille' });
    return { blob: doc.output('blob'), pages: pages.length, sheets: sheets.length, steps: steps.length };
  }

  window.Guide = { build };
})();
